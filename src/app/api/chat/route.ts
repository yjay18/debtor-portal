import { NextResponse } from "next/server";

import type { ChatRequest, ChatResponse } from "@/lib/chat/types";

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<ChatRequest>;
  const accountId = body.accountId?.trim();
  const message = body.message?.trim();

  if (!accountId || !message) {
    return NextResponse.json(
      { error: "accountId and message are required." },
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
