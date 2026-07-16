import { NextResponse } from "next/server";
import { z } from "zod";

import type { AccountRepo } from "@/lib/account/repo";
import type { AccountContext } from "@/lib/account/types";
import type { Conversation, ConversationStore, PersistedChatMessage } from "@/lib/chat/conversation";
import { isReadIntent, routeReadAction } from "@/lib/chat/router";
import type { ChatActionResult, ChatRequest, ChatResponse } from "@/lib/chat/types";
import type { ParserInput } from "@/lib/llm/parser";
import type { ParsedIntent } from "@/lib/llm/parser-schema";

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

  const response: ChatResponse = {
    conversationId: body.conversationId ?? "starter-conversation",
    message: {
      id: "starter-message",
      role: "assistant",
      content:
        "The chat API boundary is wired, but the action router has not been implemented yet.",
      createdAt: new Date().toISOString(),
    },
    result: {
      action: "unsupported",
      success: false,
      reply:
        "The chat API boundary is wired, but the action router has not been implemented yet.",
    },
  };

  return NextResponse.json(response, { status: 501 });
}
