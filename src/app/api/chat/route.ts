import { NextResponse } from "next/server";
import { z } from "zod";

import { SupabaseAccountRepo, type AccountRepo } from "@/lib/account/repo";
import type { AccountContext, RelatedPerson } from "@/lib/account/types";
import { ConversationStore, type Conversation, type PersistedChatMessage } from "@/lib/chat/conversation";
import { isReadIntent, routeAccountHolderUpdate, routeCallAppointmentCreate, routeMockPayment, routePreferredContactMethodUpdate, routePromiseToPayCreate, routeReadAction, routeRelatedPersonCreate, routeRelatedPersonRemovalConfirmed, routeRelatedPersonRemovalRequest, routeRelatedPersonUpdate } from "@/lib/chat/router";
import type { ChatActionResult, ChatRequest, ChatResponse } from "@/lib/chat/types";
import { parseMessage, type ParserInput } from "@/lib/llm/parser";
import type { ParsedIntent } from "@/lib/llm/parser-schema";
import { processQueuedNotifications, type NotificationBatchStatus } from "@/lib/notifications/processor";
import { createServerSupabaseClient } from "@/lib/supabase/server";

const chatRequestSchema = z.object({
  accountId: z.string().trim().min(1),
  message: z.string().trim().min(1),
  conversationId: z.uuid().optional(),
  idempotencyKey: z.uuid(),
}).strict();

type ValidatedChatRequest = ChatRequest & { idempotencyKey: string };

export function parseChatRequest(input: unknown): ValidatedChatRequest {
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
  conversations: Pick<ConversationStore, "loadOrCreate" | "loadMessages" | "addMessage" | "updateDialogState">;
  repo: Pick<AccountRepo, "getAccountContextByAccountId" | "updateAccountHolder" | "addRelatedPerson" | "updateRelatedPerson" | "deleteRelatedPerson" | "addPromiseToPay" | "recordPayment" | "addCallAppointment">;
  parse: (input: ParserInput) => Promise<ParsedIntent>;
  processNotifications: (accountHolderId: string) => ReturnType<typeof processQueuedNotifications>;
};

type ReadTurnExecutor = (
  request: ValidatedChatRequest,
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
  rawMessage: string;
  idempotencyKey: string;
  repo: Pick<AccountRepo, "updateAccountHolder" | "addRelatedPerson" | "updateRelatedPerson" | "addPromiseToPay" | "recordPayment" | "addCallAppointment">;
}): Promise<ChatActionResult> {
  if (input.intent.action === "update_account_holder") {
    return routeAccountHolderUpdate({
      accountId: input.accountId,
      account: input.account,
      intent: input.intent,
      repo: input.repo,
    });
  }
  //contact method update code 
  if (input.intent.action === "update_preferred_contact_method") {
    return routePreferredContactMethodUpdate({
      accountId: input.accountId,
      account: input.account,
      intent: input.intent,
      repo: input.repo,
    });
  }
  if (input.intent.action === "add_related_person") {
    return routeRelatedPersonCreate({
      accountId: input.accountId,
      account: input.account,
      intent: input.intent,
      repo: input.repo,
    });
  }
  if (input.intent.action === "update_related_person") {
    return routeRelatedPersonUpdate({
      accountId: input.accountId,
      account: input.account,
      intent: input.intent,
      repo: input.repo,
    });
  }
  if (input.intent.action === "remove_related_person") {
    return routeRelatedPersonRemovalRequest({
      account: input.account,
      intent: input.intent,
    });
  }
  if (input.intent.action === "create_promise_to_pay") {
    return routePromiseToPayCreate({
      accountId: input.accountId,
      account: input.account,
      intent: input.intent,
      rawMessage: input.rawMessage,
      nowIso: input.nowIso,
      repo: input.repo,
    });
  }
  if (input.intent.action === "mock_payment") {
    return routeMockPayment({ accountId: input.accountId, account: input.account, intent: input.intent,
      idempotencyKey: input.idempotencyKey, repo: input.repo });
  }
  if (input.intent.action === "book_call_appointment") {
    return routeCallAppointmentCreate({ accountId: input.accountId, account: input.account, intent: input.intent,
      rawMessage: input.rawMessage, nowIso: input.nowIso, repo: input.repo });
  }
  return routeLoadedReadIntent(input);
}
//only one related person can be removed at a time and we ask for confirmation
function isPersistedMutation(action: ChatActionResult["action"]) {
  return action === "update_account_holder"
    || action === "update_preferred_contact_method"
    || action === "add_related_person"
    || action === "update_related_person"
    || action === "remove_related_person"
    || action === "create_promise_to_pay"
    || action === "mock_payment"
    || action === "book_call_appointment";
}

function confirmationAnswer(message: string) {
  const normalized = message.trim().toLocaleLowerCase("en");
  if (["yes", "y", "confirm", "go ahead"].includes(normalized)) return "yes";
  if (["no", "n", "cancel"].includes(normalized)) return "no";
  return undefined;
}

function removalConfirmationPerson(result: ChatActionResult): RelatedPerson | undefined {
  return result.action === "remove_related_person" && !result.success && result.relatedPeople?.length === 1
    ? result.relatedPeople[0]
    : undefined;
}

function withoutConfirmation(conversation: Conversation) {
  return {
    ...(conversation.dialogState.pendingAction ? { pendingAction: conversation.dialogState.pendingAction } : {}),
    queuedIntents: conversation.dialogState.queuedIntents,
  };
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
  const mutation = isPersistedMutation(input.result.action);
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
      touchedIds: mutationChanged && input.result.account
        ? [input.result.account.account.accountId, ...(input.result.relatedPeople?.map((person) => person.id) ?? []),
            ...(input.result.promisesToPay?.map((promise) => promise.id) ?? []),
            ...(input.result.transaction ? [input.result.transaction.id] : []),
            ...(input.result.callAppointments?.map((call) => call.id) ?? [])]
        : [],
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
  request: ValidatedChatRequest,
  deps: ReadTurnDependencies,
): Promise<ChatResponse> {
  const loaded = await loadReadTurnContext(request, deps);
  await deps.conversations.addMessage({
    conversationId: loaded.conversation.id,
    role: "account_holder",
    content: request.message,
  });
  //confirmation for removal
  const pendingRemoval = loaded.conversation.dialogState.awaitingConfirmation;
  let result: ChatActionResult;
  if (pendingRemoval?.kind === "remove_related_person") {
    const answer = confirmationAnswer(request.message);
    if (answer === "yes") {
      result = await routeRelatedPersonRemovalConfirmed({
        accountId: request.accountId,
        account: loaded.account,
        personId: pendingRemoval.personId,
        repo: deps.repo,
      });
      await deps.conversations.updateDialogState(loaded.conversation, withoutConfirmation(loaded.conversation));
    } else if (answer === "no") {
      result = { action: "remove_related_person", success: false, reply: `Removal of ${pendingRemoval.personName} was cancelled.` };
      await deps.conversations.updateDialogState(loaded.conversation, withoutConfirmation(loaded.conversation));
    } else {
      result = { action: "clarify", success: false, reply: `Please reply yes to remove ${pendingRemoval.personName}, or no to cancel.` };
    }
  } else {
    const intent = await deps.parse(loaded.parserInput);
    result = await routeLoadedIntent({
      accountId: request.accountId,
      account: loaded.account,
      intent,
      nowIso: loaded.nowIso,
      rawMessage: request.message,
      idempotencyKey: request.idempotencyKey,
      repo: deps.repo,
    });
    const person = removalConfirmationPerson(result);
    if (person) {
      await deps.conversations.updateDialogState(loaded.conversation, {
        ...loaded.conversation.dialogState,
        awaitingConfirmation: {
          kind: "remove_related_person",
          personId: person.id,
          personName: person.name,
        },
      });
    }
  }
  //we process after database commit
  let notificationStatus: NotificationBatchStatus | "queued" | undefined;
  if (isPersistedMutation(result.action) && result.success && result.notificationQueued) {
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
  request: ValidatedChatRequest,
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
  let body: ValidatedChatRequest;
  try {
    body = parseChatRequest(await request.json());
  } catch {
    return NextResponse.json(
      { error: "A valid accountId, message, and idempotencyKey are required." },
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
