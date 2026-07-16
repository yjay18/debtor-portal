import { NextResponse } from "next/server";
import { z } from "zod";

import { SupabaseAccountRepo, type AccountRepo } from "@/lib/account/repo";
import type { AccountContext } from "@/lib/account/types";
import { ConversationStore, type Conversation, type PersistedChatMessage } from "@/lib/chat/conversation";
import { isReadIntent, routeAccountHolderUpdate, routeReadAction } from "@/lib/chat/router";
import type { ChatActionResult, ChatRequest, ChatResponse } from "@/lib/chat/types";
import { parseMessage, type ParserInput } from "@/lib/llm/parser";
import type { ParsedIntent } from "@/lib/llm/parser-schema";
import { processQueuedNotifications, type NotificationBatchStatus } from "@/lib/notifications/processor";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const chatRequestSchema = z.object({
  accountId: z.string().trim().min(1),
  message: z.string().trim().min(1),
  conversationId: z.uuid().optional(),
}).strict();

export function parseChatRequest(input: unknown): ChatRequest {
  return chatRequestSchema.parse(input);
}
// builds the input for the parser
export function buildParserInput(input: {
  account: AccountContext;
  conversation: Pick<Conversation, "dialogState">;
  history: Array<Pick<PersistedChatMessage, "role" | "content">>;
  message: string;
  nowIso: string;
}): ParserInput {
  const holder = input.account.account;
  return {
    message: input.message,
    history: input.history.map(({ role, content }) => ({ role, content })),
    dialogState: input.conversation.dialogState,
    account: {
      holderName: `${holder.accountHolderFirstName} ${holder.accountHolderLastName}`.trim(),
      email: holder.email,
      phone: holder.phone,
      currency: holder.currency,
      relatedPeopleCount: input.account.relatedPeople.length,
    },
    nowIso: input.nowIso,
  };
}

type ReadTurnLoaders = {
  conversations: Pick<ConversationStore, "loadOrCreate" | "loadMessages">;
  repo: Pick<AccountRepo, "getAccountContextByAccountId">;
  now: () => string;
};

type ReadTurnDependencies = Omit<ReadTurnLoaders, "conversations" | "repo"> & {
  conversations: Pick<ConversationStore, "loadOrCreate" | "loadMessages" | "addMessage">;
  repo: Pick<AccountRepo, "getAccountContextByAccountId" | "updateAccountHolder">;
  parse: (input: ParserInput) => Promise<ParsedIntent>;
  processNotifications: (accountHolderId: string) => ReturnType<typeof processQueuedNotifications>;
};

type ReadTurnExecutor = (
  request: ChatRequest,
  deps: ReadTurnDependencies,
) => Promise<ChatResponse>;

export async function loadReadTurnContext(request: ChatRequest, deps: ReadTurnLoaders) {
  const conversation = await deps.conversations.loadOrCreate(
    request.accountId, request.conversationId,
  );
  const [history, account] = await Promise.all([
    deps.conversations.loadMessages(conversation.id),
    deps.repo.getAccountContextByAccountId(request.accountId),
  ]);
  if (!account) throw new Error("Account not found.");

  const nowIso = deps.now();
  const parserInput = buildParserInput({
    account, conversation, history, message: request.message, nowIso,
  });
  return { conversation, history, account, nowIso, parserInput };
}
//for prompt caching
export async function routeLoadedReadIntent(input: {
  accountId: string;
  account: AccountContext;
  intent: ParsedIntent;
  nowIso: string;
}): Promise<ChatActionResult> {
  if (!isReadIntent(input.intent)) {
    return {
      action: "unsupported",
      success: false,
      reply: "That change isn't available yet. I can currently help with read-only account questions.",
    };
  }

  return routeReadAction({
    accountId: input.accountId,
    intent: input.intent,
    repo: {
      getAccountContextByAccountId: async (accountId) =>
        accountId === input.accountId ? input.account : null,
    },
    nowIso: input.nowIso,
  });
}

export async function routeLoadedIntent(input: {
  accountId: string;
  account: AccountContext;
  intent: ParsedIntent;
  nowIso: string;
  repo: Pick<AccountRepo, "updateAccountHolder">;
}): Promise<ChatActionResult> {
  if (input.intent.action === "update_account_holder") {
    return routeAccountHolderUpdate({
      accountId: input.accountId,
      account: input.account,
      intent: input.intent,
      repo: input.repo,
    });
  }
  return routeLoadedReadIntent(input);
}
//persists the result of a read turn using an assistant message to store metadata
// this makes it three actions 
// Successful phone update → mutation_succeeded
//Successful account read → read_succeeded
//Clarify/unsupported     → not_completed
export async function persistAssistantResult(input: {
  conversationId: string;
  result: ChatActionResult;
  conversations: Pick<ConversationStore, "addMessage">;
  notificationStatus?: NotificationBatchStatus | "queued";
}): Promise<ChatResponse> {
  const mutation = input.result.action === "update_account_holder";
  const mutationChanged = mutation && (input.result.changeSummary?.length ?? 0) > 0;
  const saved = await input.conversations.addMessage({
    conversationId: input.conversationId,
    role: "assistant",
    content: input.result.reply,
    action: input.result.action,
    metadata: {
      validationOutcome: input.result.success
        ? mutation ? mutationChanged ? "mutation_succeeded" : "mutation_noop" : "read_succeeded"
        : "not_completed",
      touchedIds: mutationChanged && input.result.account ? [input.result.account.account.accountId] : [],
      ...(input.result.notificationQueued
        ? { notificationStatus: input.notificationStatus ?? "queued" }
        : {}),
    },
  });

  return {
    conversationId: input.conversationId,
    message: {
      id: saved.id,
      role: "assistant",
      content: saved.content,
      createdAt: saved.createdAt,
    },
    result: input.result,
  };
}
//coordinates persistent context, message,parser and routing for the read turn
//parser is kept as a dependency to allow for mocking and other provider specific implementations
export async function executeReadChatTurn(
  request: ChatRequest,
  deps: ReadTurnDependencies,
): Promise<ChatResponse> {
  const loaded = await loadReadTurnContext(request, deps);
  await deps.conversations.addMessage({
    conversationId: loaded.conversation.id,
    role: "account_holder",
    content: request.message,
  });
  const intent = await deps.parse(loaded.parserInput);
  const result = await routeLoadedIntent({
    accountId: request.accountId,
    account: loaded.account,
    intent,
    nowIso: loaded.nowIso,
    repo: deps.repo,
  });
  //we process after database commit
  let notificationStatus: NotificationBatchStatus | "queued" | undefined;
  if (result.action === "update_account_holder" && result.success && result.notificationQueued) {
    try {
      const processed = await deps.processNotifications(loaded.conversation.accountHolderId);
      notificationStatus = processed.status === "none" ? "failed" : processed.status;
    } catch {
      notificationStatus = "failed";
    }
  }
  const completedResult = notificationStatus && result.notificationQueued
    ? { ...result, reply: `${result.reply} ${notificationStatus === "sent"
      ? "The confirmation email was sent."
      : notificationStatus === "logged"
        ? "The notification attempt was logged because email delivery is not configured."
        : "Your change was saved, but the confirmation notification could not be delivered."}` }
    : result;
  return persistAssistantResult({
    conversationId: loaded.conversation.id,
    result: completedResult,
    conversations: deps.conversations,
    notificationStatus,
  });
}
//https wrapper for the read turn executor (and to handle errors)
export async function respondToReadChatTurn(
  request: ChatRequest,
  deps: ReadTurnDependencies,
  execute: ReadTurnExecutor = executeReadChatTurn,
) {
  try {
    return NextResponse.json(await execute(request, deps));
  } catch {
    return NextResponse.json(
      { error: "Unable to process the chat request safely." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  // to catch malformed or invalid fields
  let body: ChatRequest;
  try {
    body = parseChatRequest(await request.json());
  } catch {
    return NextResponse.json(
      { error: "A valid accountId and message are required." },
      { status: 400 },
    );
  }

  try {
    const client = createServerSupabaseClient();
    return respondToReadChatTurn(body, {
      conversations: new ConversationStore(client),
      repo: new SupabaseAccountRepo(client),
      parse: parseMessage,
      processNotifications: (accountHolderId) => processQueuedNotifications(client, accountHolderId),
      now: () => new Date().toISOString(),
    });
  } catch {
    return NextResponse.json(
      { error: "Unable to process the chat request safely." },
      { status: 500 },
    );
  }
}
