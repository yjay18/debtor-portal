"use client";

import { KeyboardEvent, useEffect, useRef, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  Clock3,
  CreditCard,
  Euro,
  LayoutGrid,
  Mail,
  MapPin,
  MessageSquare,
  Phone,
  SendHorizonal,
  UserRound,
  UsersRound,
} from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  normalizeLegacyFixture,
  type AccountContext,
  type CallAppointment,
  type LegacyAccountFixture,
  type PromiseToPay,
  type RelatedPerson,
  type Transaction,
} from "@/lib/account/types";
import type { ChatResponse } from "@/lib/chat/types";
import { cn } from "@/lib/utils";

type PortalProps = {
  fixture: LegacyAccountFixture;
};

type View = "dashboard" | "conversations";
type DashboardDataTab =
  | "contact"
  | "people"
  | "promises"
  | "transactions"
  | "calls";
type ChatMessage = {
  id: string;
  role: "customer" | "agent";
  content: string;
};

function formatCurrency(amountCents: number, currency: string) {
  return new Intl.NumberFormat("en-IE", {
    style: "currency",
    currency,
  }).format(amountCents / 100);
}

function formatDate(date: string) {
  return new Intl.DateTimeFormat("en-IE", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(new Date(date));
}

function formatDateTime(date: string) {
  return new Intl.DateTimeFormat("en-IE", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(date));
}

function formatAddress(address: AccountContext["account"]["address"]) {
  return [
    address.line1,
    address.line2,
    address.city,
    address.postalCode,
    address.country,
  ]
    .filter(Boolean)
    .join(", ");
}

function formatStatus(value: string) {
  return value
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getInitials(firstName: string, lastName: string) {
  return `${firstName[0] ?? ""}${lastName[0] ?? ""}`;
}

export function DebtorPortal({ fixture }: PortalProps) {
  const [activeView, setActiveView] = useState<View>("dashboard");
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const accountContext = normalizeLegacyFixture(fixture);
  const fullName = `${accountContext.account.accountHolderFirstName} ${accountContext.account.accountHolderLastName}`;

  const handleSendMessage = async () => {
    const nextMessage = draft.trim();

    if (!nextMessage || isSending) {
      return;
    }

    const sentAt = Date.now();
    setMessages((currentMessages) => [
      ...currentMessages,
      {
        id: `customer-${sentAt}`,
        role: "customer",
        content: nextMessage,
      },
    ]);
    setDraft("");
    setIsSending(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          accountId: accountContext.account.accountId,
          message: nextMessage,
          conversationId: "starter-conversation",
        }),
      });
      const body = (await response.json()) as
        | ChatResponse
        | { error?: string };
      const assistantReply =
        "message" in body
          ? body.message.content
          : body.error ?? "The chat API did not return a usable response.";

      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: `agent-${sentAt + 1}`,
          role: "agent",
          content: assistantReply,
        },
      ]);
    } catch {
      setMessages((currentMessages) => [
        ...currentMessages,
        {
          id: `agent-${sentAt + 1}`,
          role: "agent",
          content:
            "The chat API could not be reached. Check the API route and dev server logs.",
        },
      ]);
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="min-h-screen overflow-hidden bg-[linear-gradient(135deg,#eef5fb_0%,#dcecf3_52%,#d8f0ec_100%)] p-4 text-slate-900 sm:p-6 lg:p-8">
      <div className="mx-auto flex h-[calc(100vh-2rem)] max-w-[1700px] overflow-hidden rounded-[2rem] border border-slate-200/70 bg-white/45 shadow-[0_28px_80px_rgba(15,23,42,0.14)] backdrop-blur-sm lg:h-[calc(100vh-3rem)]">
        <aside className="flex w-full shrink-0 flex-col justify-between border-b border-slate-200/80 bg-[linear-gradient(180deg,#dfe8f2_0%,#d7e2ed_100%)] p-5 lg:w-[300px] lg:border-r lg:border-b-0 lg:p-7">
          <div className="space-y-8">
            <div className="flex items-start gap-4">
              <div className="flex size-14 items-center justify-center rounded-2xl border border-slate-300/70 bg-white/80 text-slate-700 shadow-sm">
                <LayoutGrid className="size-6" />
              </div>
              <div>
                <h1 className="text-3xl font-semibold tracking-tight text-slate-900">
                  Account Portal
                </h1>
                <p className="mt-2 max-w-[14rem] text-sm leading-6 text-slate-600">
                  Simple account summary and message view for self-service.
                </p>
              </div>
            </div>

            <nav className="space-y-3">
              <NavItem
                active={activeView === "dashboard"}
                icon={LayoutGrid}
                label="Dashboard"
                onClick={() => setActiveView("dashboard")}
              />
              <NavItem
                active={activeView === "conversations"}
                icon={MessageSquare}
                label="Conversations"
                onClick={() => setActiveView("conversations")}
              />
            </nav>
          </div>

          <div className="mt-10 rounded-[1.75rem] border border-slate-300/60 bg-white/80 p-4 shadow-[0_18px_40px_rgba(15,23,42,0.08)]">
            <div className="flex items-center gap-3">
              <Avatar size="lg" className="shadow-sm after:border-slate-300/70">
                <AvatarFallback className="bg-[linear-gradient(135deg,#3b82f6,#0f172a)] font-semibold text-white">
                  {getInitials(
                    accountContext.account.accountHolderFirstName,
                    accountContext.account.accountHolderLastName,
                  )}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate text-lg font-semibold text-slate-900">
                  {fullName}
                </p>
                <p className="truncate text-sm text-slate-600">
                  {accountContext.account.email}
                </p>
              </div>
            </div>
          </div>
        </aside>

        <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[linear-gradient(180deg,rgba(255,255,255,0.52),rgba(246,250,252,0.8))] p-4 sm:p-6 lg:p-8">
          {activeView === "dashboard" ? (
            <DashboardView accountContext={accountContext} fullName={fullName} />
          ) : (
            <ConversationView
              draft={draft}
              isSending={isSending}
              messages={messages}
              onDraftChange={setDraft}
              onSendMessage={handleSendMessage}
            />
          )}
        </main>
      </div>
    </div>
  );
}

function DashboardView({
  accountContext,
  fullName,
}: {
  accountContext: AccountContext;
  fullName: string;
}) {
  const {
    account,
    billing,
    callAppointments,
    promisesToPay,
    relatedPeople,
    transactions,
  } = accountContext;
  const [activeDataTab, setActiveDataTab] =
    useState<DashboardDataTab>("contact");

  return (
    <div className="flex h-full min-h-0 flex-col gap-6 overflow-y-auto pr-1">
      <section className="rounded-[1.5rem] border border-white/75 bg-white/72 p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur-sm sm:p-8">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.22em] text-slate-500">
              Dashboard
            </p>
            <h2 className="mt-3 text-4xl font-semibold tracking-tight text-slate-950">
              {fullName}
            </h2>
            <p className="mt-3 max-w-2xl text-base leading-7 text-slate-600">
              Account details the chatbot should be able to read, update, and
              explain through the conversation flow.
            </p>
          </div>

          <div className="rounded-full border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-700">
            {formatStatus(account.status)}
          </div>
        </div>

        <div className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            icon={Euro}
            label="Current balance"
            value={formatCurrency(
              account.balanceCents,
              account.currency,
            )}
          />
          <MetricCard
            icon={CalendarDays}
            label="Due date"
            value={formatDate(billing.dueDate)}
          />
          <MetricCard
            icon={LayoutGrid}
            label="Reference"
            value={account.reference}
          />
          <MetricCard
            icon={UserRound}
            label="Days overdue"
            value={`${account.daysPastDue} days`}
          />
        </div>
      </section>

      <section className="rounded-[1.5rem] border border-white/75 bg-white/78 p-6 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur-sm sm:p-8">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <h3 className="text-2xl font-semibold tracking-tight text-slate-950">
              Account Data
            </h3>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              The core records the chatbot should be able to read and update.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <DashboardTabButton
              active={activeDataTab === "contact"}
              icon={UserRound}
              label="Contact"
              onClick={() => setActiveDataTab("contact")}
            />
            <DashboardTabButton
              active={activeDataTab === "people"}
              icon={UsersRound}
              label={`People ${relatedPeople.length}`}
              onClick={() => setActiveDataTab("people")}
            />
            <DashboardTabButton
              active={activeDataTab === "promises"}
              icon={CheckCircle2}
              label={`Promises ${promisesToPay.length}`}
              onClick={() => setActiveDataTab("promises")}
            />
            <DashboardTabButton
              active={activeDataTab === "transactions"}
              icon={CreditCard}
              label={`Transactions ${transactions.length}`}
              onClick={() => setActiveDataTab("transactions")}
            />
            <DashboardTabButton
              active={activeDataTab === "calls"}
              icon={Clock3}
              label={`Calls ${callAppointments.length}`}
              onClick={() => setActiveDataTab("calls")}
            />
          </div>
        </div>

        <div className="mt-7">
          {activeDataTab === "contact" ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <InfoRow icon={UserRound} label="Customer" value={fullName} />
              <InfoRow icon={Mail} label="Email" value={account.email} />
              <InfoRow icon={Phone} label="Phone" value={account.phone} />
              <InfoRow
                icon={LayoutGrid}
                label="Preferred contact"
                value={account.preferredContactMethod.toUpperCase()}
              />
              <InfoRow
                icon={LayoutGrid}
                label="Creditor"
                value={account.creditorName}
              />
              <InfoRow
                icon={MapPin}
                label="Address"
                value={formatAddress(account.address)}
              />
              <InfoRow
                icon={CalendarDays}
                label="Last payment"
                value={`${formatCurrency(
                  account.lastPaymentAmountCents,
                  account.currency,
                )} on ${formatDate(account.lastPaymentDate)}`}
              />
            </div>
          ) : null}

          {activeDataTab === "people" ? (
            <DataRows emptyText="No related people are currently saved.">
              {relatedPeople.map((person) => (
                <RelatedPersonRow key={person.id} person={person} />
              ))}
            </DataRows>
          ) : null}

          {activeDataTab === "promises" ? (
            <DataRows emptyText="No promises to pay are currently saved.">
              {promisesToPay.map((promise) => (
                <PromiseRow key={promise.id} promise={promise} />
              ))}
            </DataRows>
          ) : null}

          {activeDataTab === "transactions" ? (
            <DataRows emptyText="No transactions are currently saved.">
              {transactions.map((transaction) => (
                <TransactionRow
                  key={transaction.id}
                  transaction={transaction}
                />
              ))}
            </DataRows>
          ) : null}

          {activeDataTab === "calls" ? (
            <DataRows emptyText="No future call appointments are currently saved.">
              {callAppointments.map((appointment) => (
                <CallAppointmentRow
                  appointment={appointment}
                  key={appointment.id}
                />
              ))}
            </DataRows>
          ) : null}
        </div>
      </section>
    </div>
  );
}

function ConversationView({
  draft,
  isSending,
  messages,
  onDraftChange,
  onSendMessage,
}: {
  draft: string;
  isSending: boolean;
  messages: ChatMessage[];
  onDraftChange: (value: string) => void;
  onSendMessage: () => void | Promise<void>;
}) {
  const hasMessages = messages.length > 0;
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      void onSendMessage();
    }
  };

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  return (
    <section className="mx-auto flex h-full min-h-0 w-full max-w-[1120px] flex-col overflow-hidden rounded-[2rem] border border-white/75 bg-white/72 shadow-[0_24px_60px_rgba(15,23,42,0.08)] backdrop-blur-sm">
      <div className="shrink-0 border-b border-slate-200/80 px-6 py-5 sm:px-8">
        <p className="text-sm font-medium uppercase tracking-[0.22em] text-slate-500">
          Conversations
        </p>
        <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight text-slate-950">
              Chat with AI Assistant
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              Send a message through the backend chat API boundary.
            </p>
          </div>
          <div className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700">
            Open
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 sm:px-8">
        {hasMessages ? (
          <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 pb-2">
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  "flex",
                  message.role === "customer" ? "justify-end" : "justify-start",
                )}
              >
                <div
                  className={cn(
                    "max-w-[min(100%,36rem)] rounded-[1.5rem] px-5 py-4 text-sm leading-7 shadow-sm",
                    message.role === "customer"
                      ? "bg-[linear-gradient(135deg,#0f1d3d,#213a6b)] text-white"
                      : "border border-slate-200 bg-slate-50 text-slate-700",
                  )}
                >
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.2em] opacity-70">
                    {message.role === "customer" ? "You" : "AI Support"}
                  </p>
                  <p>{message.content}</p>
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>
        ) : (
          <div className="flex min-h-full items-center justify-center">
            <div className="flex w-full max-w-2xl flex-col items-center justify-center rounded-[2rem] border border-dashed border-slate-300 bg-slate-50/70 px-8 py-10 text-center">
              <div className="flex size-14 items-center justify-center rounded-full bg-white text-slate-700 shadow-sm">
                <MessageSquare className="size-6" />
              </div>
              <h3 className="mt-5 text-2xl font-semibold text-slate-900">
                No conversation yet
              </h3>
              <p className="mt-3 max-w-md text-sm leading-7 text-slate-600">
                Send the first message and the thread will call the starter
                chat API route.
              </p>
            </div>
          </div>
        )}
      </div>

      <form
        className="shrink-0 border-t border-slate-200/80 bg-white/90 px-6 py-5 sm:px-8"
        onSubmit={(event) => {
          event.preventDefault();
          void onSendMessage();
        }}
      >
        <div className="mx-auto max-w-4xl rounded-[1.5rem] border border-slate-200 bg-white p-3 shadow-[0_18px_40px_rgba(15,23,42,0.06)]">
          <textarea
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={handleComposerKeyDown}
            placeholder="Message the AI assistant..."
            className="min-h-24 w-full resize-none border-0 bg-transparent px-2 py-2 text-base text-slate-900 outline-none placeholder:text-slate-400"
          />
          <div className="mt-2 flex items-center justify-between gap-3 px-2">
            <p className="text-xs text-slate-500">
              Send with <span className="font-medium text-slate-700">Cmd/Ctrl + Enter</span>
            </p>
            <Button
              type="submit"
              disabled={!draft.trim() || isSending}
              className={cn(
                "h-10 rounded-full px-4 text-sm font-medium text-white shadow-none",
                draft.trim() && !isSending
                  ? "bg-slate-500 hover:bg-slate-600"
                  : "bg-slate-400 hover:bg-slate-400",
              )}
            >
              {isSending ? "Sending" : "Send"}
              <SendHorizonal className="ml-2 size-4" />
            </Button>
          </div>
        </div>
      </form>
    </section>
  );
}

function NavItem({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof LayoutGrid;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-3 rounded-[1.4rem] px-5 py-4 text-left text-base font-medium transition",
        active
          ? "bg-[linear-gradient(135deg,#0f1d3d,#15294f)] text-white shadow-[0_18px_38px_rgba(15,29,61,0.24)]"
          : "bg-white/55 text-slate-700 hover:bg-white/80",
      )}
    >
      <Icon className="size-5" />
      <span>{label}</span>
    </button>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof LayoutGrid;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[1rem] border border-slate-200/75 bg-slate-50/75 p-5">
      <div className="flex size-11 items-center justify-center rounded-2xl bg-white text-slate-700 shadow-sm">
        <Icon className="size-5" />
      </div>
      <p className="mt-4 text-sm text-slate-500">{label}</p>
      <p className="mt-2 text-xl font-semibold tracking-tight text-slate-950">
        {value}
      </p>
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof LayoutGrid;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[1rem] border border-slate-200/75 bg-slate-50/75 p-5">
      <div className="flex items-center gap-3">
        <div className="flex size-10 items-center justify-center rounded-xl bg-white text-slate-700 shadow-sm">
          <Icon className="size-4" />
        </div>
        <span className="text-sm font-medium text-slate-500">{label}</span>
      </div>
      <p className="mt-4 text-base font-medium leading-7 text-slate-900">
        {value}
      </p>
    </div>
  );
}

function DashboardTabButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof LayoutGrid;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-medium transition",
        active
          ? "border-slate-900 bg-slate-900 text-white"
          : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-white",
      )}
    >
      <Icon className="size-4" />
      <span>{label}</span>
    </button>
  );
}

function DataRows({
  children,
  emptyText,
}: {
  children: React.ReactNode[];
  emptyText: string;
}) {
  return (
    <div className="grid gap-3">
      {children.length > 0 ? (
        children
      ) : (
        <p className="rounded-[1rem] border border-dashed border-slate-300 bg-slate-50/75 p-4 text-sm text-slate-500">
          {emptyText}
        </p>
      )}
    </div>
  );
}

function RelatedPersonRow({ person }: { person: RelatedPerson }) {
  return (
    <div className="rounded-[1rem] border border-slate-200/75 bg-slate-50/75 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-slate-950">
            {person.name}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            {person.relationship ? formatStatus(person.relationship) : "Related person"}
          </p>
        </div>
        <span
          className={cn(
            "w-fit rounded-full border px-3 py-1 text-xs font-medium",
            person.authorizedToAct
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : "border-slate-200 bg-white text-slate-600",
          )}
        >
          {person.authorizedToAct ? "Authorized" : "Not authorized"}
        </span>
      </div>
      <div className="mt-4 grid gap-2 text-sm text-slate-600">
        <p className="truncate">{person.email}</p>
        <p>{person.phone}</p>
      </div>
    </div>
  );
}

function PromiseRow({ promise }: { promise: PromiseToPay }) {
  return (
    <div className="rounded-[1rem] border border-slate-200/75 bg-slate-50/75 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-base font-semibold text-slate-950">
            {formatCurrency(promise.amountCents, promise.currency)}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            Due {formatDate(promise.dueDate)}
          </p>
        </div>
        <StatusPill status={promise.status} />
      </div>
      <p className="mt-3 text-xs text-slate-500">
        Created {formatDateTime(promise.createdAt)}
      </p>
    </div>
  );
}

function TransactionRow({ transaction }: { transaction: Transaction }) {
  return (
    <div className="rounded-[1rem] border border-slate-200/75 bg-slate-50/75 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-slate-950">
            {transaction.description}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            {formatStatus(transaction.type)} on{" "}
            {formatDate(transaction.transactionDate)}
          </p>
        </div>
        <div className="text-left sm:text-right">
          <p className="text-base font-semibold text-slate-950">
            {formatCurrency(transaction.amountCents, transaction.currency)}
          </p>
          <StatusPill status={transaction.status} />
        </div>
      </div>
    </div>
  );
}

function CallAppointmentRow({
  appointment,
}: {
  appointment: CallAppointment;
}) {
  return (
    <div className="rounded-[1rem] border border-slate-200/75 bg-slate-50/75 p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-base font-semibold text-slate-950">
            {formatDateTime(appointment.scheduledAt)}
          </p>
          <p className="mt-1 text-sm text-slate-500">{appointment.phone}</p>
        </div>
        <StatusPill status={appointment.status} />
      </div>
      {appointment.reason ? (
        <p className="mt-3 text-sm leading-6 text-slate-600">
          {appointment.reason}
        </p>
      ) : null}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  return (
    <span className="inline-flex w-fit rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600">
      {formatStatus(status)}
    </span>
  );
}
