"use client";

import { type KeyboardEvent, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowUp,
  Camera,
  Check,
  ChevronRight,
  History,
  LoaderCircle,
  LockKeyhole,
  Mic,
  PiggyBank,
  Plus,
  ReceiptText,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  SquarePen,
  Trash2,
  Wrench,
} from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  type AgentApplied,
  type AnswerFeedback,
  agentApi,
  type AgentPlan,
  ApiError,
  type AppStep,
  type BudgetSuggestion,
  coachApi,
  type CoachBrief,
  type CoachBudgetPlan,
  type CoachProposal,
  type CoachReply,
  type CoachRole,
  type Dashboard,
  type MissionKind,
  type MissionRun,
  agentsApi,
  type PennyAiAllowance,
  type SavedConversation,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { type CaptureStart } from "./agent-capture";
import { AnswerFeedbackRow } from "./answer-feedback";
import { AGENT_PRESETS, MissionMessage } from "./agents-view";
import { PlanCard } from "./plan-card";
import { confetti, play } from "./game-fx";
import { Mascot } from "./mascot";
import type { SaveChange } from "./settings-view";
import { cad, describeError, type View } from "./shared";
import { PlanBreakdown } from "./smart-cards";
import { StatementImport } from "./statement-import";

/** Messages sent per request; the API accepts at most 12, ending with the new question. */
const HISTORY_LIMIT = 11;
const MAX_QUESTION_LENGTH = 600;

type ProposalState = "approving" | "approved" | "dismissed";
/** A plan from Penny's agent shown in the chat: open (waiting for Do it), done, undone, or
 * replaced by a newer plan after the user added something ("it was $45"). */
type AgentState = "open" | "done" | "undone" | "replaced";
type AgentMessage = { plan: AgentPlan; state: AgentState; done?: string[]; undoId?: string };
/** A mission Penny's agents are working on (or finished), shown live in the chat. */
type MissionRef = { id: string };
type CoachMessage = {
  id: string;
  role: CoachRole;
  content: string;
  reply?: CoachReply;
  agent?: AgentMessage;
  mission?: MissionRef;
  /** Was this answer helpful? Saved with the chat (in the reply slot). */
  feedback?: AnswerFeedback;
};
type AppRunner = { current: ((step: AppStep) => void) | null };
type ChatError = { title: string; detail: string };
type Conversation = {
  id: string;
  title: string;
  updated_at: string;
  messages: CoachMessage[];
  proposals: Record<string, ProposalState>;
};

/** Resolves once the app is on screen. */
function whenVisible(): Promise<void> {
  if (document.visibilityState === "visible") return Promise.resolve();
  return new Promise((resolve) => {
    const shown = () => {
      if (document.visibilityState !== "visible") return;
      document.removeEventListener("visibilitychange", shown);
      resolve();
    };
    document.addEventListener("visibilitychange", shown);
  });
}

/** iOS drops a request when the app goes to the background. If the app was hidden while Penny
 * was answering and the connection failed, ask again once the app is back on screen. */
async function chatThroughBackground(messages: { role: CoachRole; content: string }[]): Promise<CoachReply> {
  let hidden = document.visibilityState === "hidden";
  const changed = () => {
    if (document.visibilityState === "hidden") hidden = true;
  };
  document.addEventListener("visibilitychange", changed);
  try {
    return await coachApi.chat(messages);
  } catch (reason) {
    if (!hidden || reason instanceof ApiError) throw reason;
    await whenVisible();
    return await coachApi.chat(messages);
  } finally {
    document.removeEventListener("visibilitychange", changed);
  }
}

const STORAGE_KEY = "penny-coach-chats";
/** Set once this device's older, device-only chats have been uploaded to the account. */
const UPLOADED_KEY = "penny-coach-chats-uploaded";
const MAX_SAVED_CHATS = 30;
/** The server keeps at most this many messages per chat. */
const MAX_SAVED_MESSAGES = 200;

/** Saved chats from this device. Storage can be blocked or hold old data, so failures are ignored. */
function loadConversations(): Conversation[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((item): item is Conversation => typeof item?.id === "string" && Array.isArray(item?.messages))
      : [];
  } catch {
    return [];
  }
}

function saveConversations(conversations: Conversation[]) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(conversations.slice(0, MAX_SAVED_CHATS)));
  } catch {
    /* Keep chats in memory. */
  }
}

function uploadedBefore(): boolean {
  try {
    return window.localStorage.getItem(UPLOADED_KEY) === "1";
  } catch {
    return true;
  }
}

function fromSaved(saved: SavedConversation): Conversation {
  return {
    ...saved,
    messages: saved.messages.map(({ reply, ...message }) => {
      // Agent plans and missions are saved in the reply slot as { agent } or { mission }.
      const slot = reply as { agent?: AgentMessage; mission?: MissionRef } | null | undefined;
      if (slot?.agent) return { ...message, agent: slot.agent };
      if (slot?.mission) return { ...message, mission: slot.mission };
      if (!reply) return message;
      const { feedback, ...rest } = reply as CoachReply & { feedback?: AnswerFeedback };
      return feedback ? { ...message, reply: rest, feedback } : { ...message, reply: rest };
    }),
  };
}

/** Saves a chat to the account. "Approving" is momentary, so it isn't kept. */
function upload(conversation: Conversation): Promise<unknown> {
  const proposals = Object.fromEntries(
    Object.entries(conversation.proposals).filter(([, state]) => state !== "approving"),
  );
  return coachApi.saveConversation({
    ...conversation,
    messages: conversation.messages
      .slice(-MAX_SAVED_MESSAGES)
      .map(({ agent, mission, feedback, ...message }) =>
        agent || mission
          ? { ...message, reply: (agent ? { agent } : { mission }) as unknown as CoachReply }
          : feedback && message.reply
            ? { ...message, reply: { ...message.reply, feedback } as CoachReply }
            : message,
      ),
    proposals,
  });
}

const newest = (a: Conversation, b: Conversation) => b.updated_at.localeCompare(a.updated_at);

/**
 * Conversation state, owned by the app shell so chats survive switching tabs. Every chat is
 * kept in a history list saved to the account (and cached on this device for offline use);
 * "New chat" starts a fresh one.
 */
export function useCoachChat(appRunner?: AppRunner) {
  const [conversations, setConversations] = useState<Conversation[]>(loadConversations);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ChatError | null>(null);
  const [allowance, setAllowance] = useState<PennyAiAllowance | null>(null);
  const latest = useRef({ conversations, activeId });
  // Chats changed here since the last save, and every chat touched this session.
  const unsaved = useRef(new Set<string>());
  const touched = useRef(new Set<string>());
  useEffect(() => {
    latest.current = { conversations, activeId };
  }, [conversations, activeId]);
  useEffect(() => {
    saveConversations(conversations);
  }, [conversations]);

  // The account's chats replace this device's cache. The first time, chats that were only ever
  // on this device are uploaded so they aren't lost. Offline, the cached copy stays.
  useEffect(() => {
    let active = true;
    coachApi
      .conversations()
      .then(async (saved) => {
        const account = saved.map(fromSaved);
        if (!uploadedBefore()) {
          const deviceOnly = loadConversations().filter((item) => !account.some((other) => other.id === item.id));
          await Promise.all(deviceOnly.map((item) => upload(item).catch(() => undefined)));
          account.push(...deviceOnly);
          try {
            window.localStorage.setItem(UPLOADED_KEY, "1");
          } catch {
            /* Uploads again next time; ids keep it harmless. */
          }
        }
        if (!active) return;
        setConversations((current) =>
          [
            ...current.filter((item) => touched.current.has(item.id) && !account.some((other) => other.id === item.id)),
            ...account,
          ].sort(newest),
        );
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    for (const id of unsaved.current) {
      const conversation = conversations.find((item) => item.id === id);
      if (conversation) void upload(conversation).catch(() => undefined);
    }
    unsaved.current.clear();
  }, [conversations]);

  /** Today's Penny AI questions left, read again after each one is asked. */
  const refreshAllowance = useCallback(() => {
    coachApi
      .allowance()
      .then(setAllowance)
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    refreshAllowance();
  }, [refreshAllowance]);

  const active = conversations.find((item) => item.id === activeId) ?? null;
  const messages = active?.messages ?? [];

  /** Applies a change to one conversation and moves it to the top of the list. */
  const update = useCallback((id: string, change: (conversation: Conversation) => Conversation) => {
    unsaved.current.add(id);
    touched.current.add(id);
    setConversations((current) => {
      const target = current.find((item) => item.id === id);
      if (!target) return current;
      return [{ ...change(target), updated_at: new Date().toISOString() }, ...current.filter((item) => item.id !== id)];
    });
  }, []);

  const send = useCallback(
    /** `direct` skips the agent: the question goes straight to the coach. `after` sends it
     * straight to Penny's agents as a follow-up to that mission (an option the user picked). */
    async (text: string, options?: { direct?: boolean; after?: string }) => {
      const question = text.trim().slice(0, MAX_QUESTION_LENGTH);
      if (!question || pending) return;
      const userMessage: CoachMessage = { id: crypto.randomUUID(), role: "user", content: question };
      let id = latest.current.activeId;
      const existing = latest.current.conversations.find((item) => item.id === id);
      const thread = [...(existing?.messages ?? []), userMessage];
      if (!existing) {
        id = crypto.randomUUID();
        const created: Conversation = {
          id,
          title: question.length > 60 ? `${question.slice(0, 57)}…` : question,
          updated_at: new Date().toISOString(),
          messages: thread,
          proposals: {},
        };
        unsaved.current.add(id);
        touched.current.add(id);
        setConversations((current) => [created, ...current]);
        setActiveId(id);
      } else {
        update(existing.id, (conversation) => ({ ...conversation, messages: thread }));
      }
      const conversationId = id as string;
      setPending(true);
      setError(null);
      const addMissionMessage = (run: MissionRun) =>
        update(conversationId, (conversation) => ({
          ...conversation,
          messages: [
            ...conversation.messages,
            { id: crypto.randomUUID(), role: "assistant", content: run.title, mission: { id: run.id } },
          ],
        }));
      try {
        if (options?.after) {
          addMissionMessage(await agentsApi.start("custom", question, options.after));
          return;
        }
        // Penny's agent reads it first: things to do become a plan to approve right here;
        // questions and conversation go on to the coach.
        if (!options?.direct) {
          const before = existing?.messages ?? [];
          const lastAssistant = before.findLast((message) => message.role === "assistant");
          const open = lastAssistant?.agent?.state === "open" ? lastAssistant : undefined;
          const context = before
            .slice(-6)
            .map(
              (message) =>
                `${message.role === "user" ? "User" : "Penny"}: ${message.agent ? message.agent.plan.heard : message.content}`,
            )
            .join("\n")
            .slice(-2500);
          const plan = await agentApi
            .plan({
              text: (open ? `${open.agent!.plan.heard}. ${question}` : question).slice(0, 1000),
              receipt: open?.agent?.plan.receipt ?? [],
              context,
            })
            .catch(() => null);
          // Work for Penny's agents runs right here in the chat.
          const mission = plan && !plan.steps.length ? plan.app.find((step) => step.kind === "mission") : undefined;
          if (mission) {
            const [kind, ...words] = mission.value.split("|");
            addMissionMessage(await agentsApi.start(kind as MissionKind, words.join("|") || question));
            return;
          }
          // Right after the agents answered, anything that isn't a change to make is a follow-up
          // for them too: one conversation, one set of numbers.
          const previous = before.at(-1)?.mission;
          const onDeviceOnly = plan?.app.filter((step) => step.kind !== "ask") ?? [];
          if (previous && !plan?.steps.length && !onDeviceOnly.length) {
            addMissionMessage(await agentsApi.start("custom", question, previous.id));
            return;
          }
          if (plan) {
            const asks = plan.app.filter((step) => step.kind === "ask");
            const onDevice = plan.app.filter((step) => step.kind !== "ask");
            if (plan.steps.length || onDevice.length || (plan.question && !asks.length)) {
              const shown = { ...plan, app: onDevice };
              let agent: AgentMessage = { plan: shown, state: "open" };
              // Only things on this device (a page, the theme): nothing to approve, so do them now.
              if (!plan.steps.length && !plan.question) {
                onDevice.forEach((step) => appRunner?.current?.(step));
                agent = { plan: shown, state: "done", done: onDevice.map((step) => `${step.emoji} ${step.title}`) };
              }
              update(conversationId, (conversation) => ({
                ...conversation,
                messages: [
                  ...conversation.messages.map((message) =>
                    open && message.id === open.id
                      ? { ...message, agent: { ...message.agent!, state: "replaced" as const } }
                      : message,
                  ),
                  {
                    id: crypto.randomUUID(),
                    role: "assistant",
                    content: plan.question ?? (plan.steps.length ? "Here’s what I’ll do" : "Done"),
                    agent,
                  },
                ],
              }));
              if (!asks.length) return;
            }
          }
        }
        const history = thread
          .filter((message) => !message.agent && !message.mission)
          .slice(-HISTORY_LIMIT - 1)
          .map(({ role, content }) => ({ role, content }));
        while (history[0]?.role === "assistant") history.shift();
        const reply = await chatThroughBackground(history);
        update(conversationId, (conversation) => ({
          ...conversation,
          messages: [
            ...conversation.messages,
            { id: crypto.randomUUID(), role: "assistant", content: reply.reply, reply },
          ],
        }));
      } catch (reason) {
        setError(describeError(reason, "Penny couldn’t answer"));
      } finally {
        setPending(false);
        refreshAllowance();
      }
    },
    [pending, update, appRunner, refreshAllowance],
  );

  /** Opens a new chat with a mission in it: one started elsewhere (a preset, the voice orb), or
   * one Penny started herself (Autopilot, Watch). `said` is shown as the user's message. */
  const addMission = useCallback((run: MissionRun, said?: string) => {
    const existing = latest.current.conversations.find((item) =>
      item.messages.some((message) => message.mission?.id === run.id),
    );
    if (existing) {
      setActiveId(existing.id);
      return;
    }
    const id = crypto.randomUUID();
    const messages: CoachMessage[] = [
      ...(said ? [{ id: crypto.randomUUID(), role: "user" as const, content: said }] : []),
      { id: crypto.randomUUID(), role: "assistant", content: run.title, mission: { id: run.id } },
    ];
    const title = said ?? run.title;
    unsaved.current.add(id);
    touched.current.add(id);
    setConversations((current) => [
      {
        id,
        title: title.length > 60 ? `${title.slice(0, 57)}…` : title,
        updated_at: new Date().toISOString(),
        messages,
        proposals: {},
      },
      ...current,
    ]);
    setActiveId(id);
    setError(null);
  }, []);

  /** Starts a mission in a new chat. */
  const startMission = useCallback(
    async (kind: MissionKind, words: string, said: string) => {
      setPending(true);
      setError(null);
      try {
        addMission(await agentsApi.start(kind, words), said);
      } catch (reason) {
        setError(describeError(reason, "The agents couldn’t start"));
      } finally {
        setPending(false);
        refreshAllowance();
      }
    },
    [addMission, refreshAllowance],
  );

  /** A finished mission's answer becomes the message's text, so follow-ups have the context. */
  const finishMission = useCallback(
    (messageId: string, run: MissionRun) => {
      const id = latest.current.conversations.find((item) => item.messages.some((m) => m.id === messageId))?.id;
      const answer = run.brief?.answer ?? run.summary ?? run.title;
      const message = latest.current.conversations.flatMap((item) => item.messages).find((m) => m.id === messageId);
      if (!id || !message || message.content === answer) return;
      update(id, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((item) => (item.id === messageId ? { ...item, content: answer } : item)),
      }));
    },
    [update],
  );

  /** Records what happened to a plan in the chat (done, undone). */
  const updateAgent = useCallback(
    (messageId: string, change: Partial<AgentMessage>) => {
      const id = latest.current.activeId;
      if (!id) return;
      update(id, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) =>
          message.id === messageId && message.agent ? { ...message, agent: { ...message.agent, ...change } } : message,
        ),
      }));
    },
    [update],
  );

  /** Records whether a chat answer helped, saved with the chat. */
  const rate = useCallback(
    (messageId: string, feedback: AnswerFeedback) => {
      const id = latest.current.conversations.find((item) => item.messages.some((m) => m.id === messageId))?.id;
      if (!id) return;
      update(id, (conversation) => ({
        ...conversation,
        messages: conversation.messages.map((message) =>
          message.id === messageId ? { ...message, feedback } : message,
        ),
      }));
    },
    [update],
  );

  /** Resends the last question after a failure. */
  const retry = useCallback(() => {
    const id = latest.current.activeId;
    const conversation = latest.current.conversations.find((item) => item.id === id);
    const last = conversation?.messages.at(-1);
    if (!conversation || last?.role !== "user") return;
    const trimmed = { ...conversation, messages: conversation.messages.slice(0, -1) };
    latest.current = {
      ...latest.current,
      conversations: latest.current.conversations.map((item) => (item.id === trimmed.id ? trimmed : item)),
    };
    update(conversation.id, () => trimmed);
    void send(last.content);
  }, [send, update]);

  const newChat = useCallback(() => {
    setActiveId(null);
    setError(null);
  }, []);
  const open = useCallback((id: string) => {
    setActiveId(id);
    setError(null);
  }, []);
  const remove = useCallback((id: string) => {
    void coachApi.deleteConversation(id).catch(() => undefined);
    setConversations((current) => current.filter((item) => item.id !== id));
    setActiveId((current) => (current === id ? null : current));
  }, []);
  const setProposal = useCallback(
    (proposalId: string, state: ProposalState | null) => {
      const id = latest.current.activeId;
      if (!id) return;
      update(id, (conversation) => {
        const next = { ...conversation.proposals };
        if (state) next[proposalId] = state;
        else delete next[proposalId];
        return { ...conversation, proposals: next };
      });
    },
    [update],
  );

  return {
    conversations,
    activeId,
    messages,
    proposals: active?.proposals ?? {},
    pending,
    error,
    allowance,
    rate,
    send,
    retry,
    newChat,
    open,
    remove,
    setProposal,
    updateAgent,
    addMission,
    startMission,
    finishMission,
  };
}

type CoachChat = ReturnType<typeof useCoachChat>;

export function CoachView({
  chat,
  dashboard,
  onDashboardChange,
  onApproved,
  onApplyBudgets,
  save,
  onCapture,
  onApp,
  onNavigate,
}: {
  chat: CoachChat;
  dashboard: Dashboard;
  onDashboardChange: (dashboard: Dashboard) => void;
  onApproved: (message: string) => void;
  onApplyBudgets: (month: string, picked: BudgetSuggestion[]) => Promise<string | null>;
  save: SaveChange;
  /** Opens Penny's agent: snap a receipt or say what happened. With `onText`, the voice note
   * comes back as text (the chat's mic). */
  onCapture: (how: CaptureStart, onText?: (text: string) => void) => void;
  /** Runs a plan step on this device (a page, the theme, sound). */
  onApp: (step: AppStep) => void;
  onNavigate: (view: View) => void;
}) {
  const [brief, setBrief] = useState<CoachBrief | null>(null);
  const [approvalError, setApprovalError] = useState<ChatError | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const { messages, pending, error } = chat;

  // The greeting and suggested questions follow the latest data (for example after an approval).
  useEffect(() => {
    let active = true;
    coachApi
      .brief()
      .then((data) => {
        if (active) setBrief(data);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [dashboard]);

  /** Brings a message's top into view, scrolling only the chat (or the page on phones). */
  const showMessage = useCallback((id: string) => {
    window.requestAnimationFrame(() => {
      const element = document.querySelector(`[data-message="${id}"]`);
      const scroller = scrollerRef.current;
      if (!element) return;
      const top = element.getBoundingClientRect().top;
      if (scroller && scroller.scrollHeight > scroller.clientHeight + 1) {
        const offset = top - scroller.getBoundingClientRect().top - 12;
        scroller.scrollBy({ top: offset, behavior: "smooth" });
      } else {
        window.scrollBy({ top: top - 96, behavior: "smooth" });
      }
    });
  }, []);

  // Follow the conversation by scrolling only the chat itself (laptops), or the page (phones):
  // scrolling an element into view would move every scrolling parent, the whole app included.
  useEffect(() => {
    if (!messages.length) return;
    const scroller = scrollerRef.current;
    if (scroller && scroller.scrollHeight > scroller.clientHeight + 1) {
      scroller.scrollTo({ top: scroller.scrollHeight, behavior: "smooth" });
    } else {
      window.scrollTo({ top: document.documentElement.scrollHeight, behavior: "smooth" });
    }
  }, [messages.length, pending]);

  async function approve(proposal: CoachProposal) {
    chat.setProposal(proposal.id, "approving");
    setApprovalError(null);
    try {
      const response = await coachApi.approve(proposal);
      chat.setProposal(proposal.id, "approved");
      onDashboardChange(response.dashboard);
      onApproved(proposal.title);
    } catch (reason) {
      chat.setProposal(proposal.id, null);
      setApprovalError(describeError(reason, "That change couldn’t be applied"));
    }
  }

  const lastAssistant = messages.findLast((message) => message.role === "assistant");
  const historyList = <ChatHistory chat={chat} onPicked={() => setHistoryOpen(false)} />;

  return (
    // Phones scroll the whole page. Laptops get a full-height chat like ChatGPT: chats on the left,
    // the conversation scrolling on its own, and the composer pinned to the bottom.
    // Past chats open from the Chats button, so the conversation gets the whole width.
    <div className="lg:h-full">
      <div className="flex min-w-0 flex-col gap-4 lg:h-full lg:min-h-0 lg:gap-0">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-2 lg:max-w-none lg:border-b lg:border-line/70 lg:px-8 lg:py-3">
          <h2 className="truncate text-sm font-semibold text-ink-muted">
            {chat.activeId ? chat.conversations.find((item) => item.id === chat.activeId)?.title : "New chat"}
          </h2>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" size="sm" onClick={() => setHistoryOpen(true)}>
              <History className="size-4" aria-hidden="true" />
              Chats
              {chat.conversations.length > 0 && (
                <span className="tabular text-ink-subtle">{chat.conversations.length}</span>
              )}
            </Button>
            {messages.length > 0 && (
              <Button variant="ghost" size="sm" onClick={chat.newChat} disabled={pending}>
                <SquarePen className="size-4" aria-hidden="true" />
                New chat
              </Button>
            )}
          </div>
        </div>

        <div ref={scrollerRef} className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl space-y-4 lg:px-8 lg:py-6">
            {messages.length === 0 && (
              <Welcome
                name={dashboard.profile.display_name.split(" ")[0]}
                questions={brief?.suggested_questions}
                disabled={pending}
                onAsk={(text) => void chat.send(text)}
                onMission={(kind, title) => void chat.startMission(kind, "", title)}
                onScan={() => setScanOpen(true)}
                onCapture={() => onCapture("menu")}
              />
            )}

            <div
              role="log"
              aria-live="polite"
              aria-busy={pending}
              aria-label="Conversation with Penny AI"
              className="space-y-4"
            >
              {messages.map((message) =>
                message.role === "user" ? (
                  <UserBubble key={message.id} text={message.content} />
                ) : message.mission ? (
                  <div key={message.id} data-message={message.id}>
                    <MissionMessage
                      runId={message.mission.id}
                      dashboard={dashboard}
                      applyChange={onDashboardChange}
                      onNavigate={onNavigate}
                      onSend={(text, after) => void chat.send(text, { after })}
                      onFinished={(run, live) => {
                        chat.finishMission(message.id, run);
                        if (live) showMessage(message.id);
                      }}
                    />
                  </div>
                ) : message.agent ? (
                  <AgentReply
                    key={message.id}
                    agent={message.agent}
                    dashboard={dashboard}
                    onDashboardChange={onDashboardChange}
                    onApp={onApp}
                    onSay={(text) => void chat.send(text)}
                    onVoice={() => onCapture("voice", (text) => void chat.send(text))}
                    onChange={(change) => chat.updateAgent(message.id, change)}
                  />
                ) : (
                  <AssistantMessage
                    key={message.id}
                    reply={message.reply!}
                    proposalState={message.reply?.proposal ? chat.proposals[message.reply.proposal.id] : undefined}
                    planState={chat.proposals[`plan:${message.id}`]}
                    onAddPlan={async (month, picked) => {
                      chat.setProposal(`plan:${message.id}`, "approving");
                      const failed = await onApplyBudgets(month, picked);
                      chat.setProposal(`plan:${message.id}`, failed ? null : "approved");
                      return failed;
                    }}
                    showFollowUps={message === lastAssistant && !pending}
                    disabled={pending}
                    onAsk={(text) => void chat.send(text)}
                    onApprove={(proposal) => void approve(proposal)}
                    onDismiss={(proposal) => chat.setProposal(proposal.id, "dismissed")}
                    feedback={message.feedback}
                    onRate={(feedback) => chat.rate(message.id, feedback)}
                  />
                ),
              )}
              {pending && <Thinking />}
              {error && (
                <div
                  role="alert"
                  className="flex flex-col gap-3 rounded-2xl border border-danger/25 bg-danger-soft p-4 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-semibold text-danger">{error.title}</p>
                    <p className="mt-1 text-sm text-ink-muted">{error.detail}</p>
                  </div>
                  <Button variant="outline" size="sm" onClick={chat.retry}>
                    <RotateCcw className="size-4" aria-hidden="true" />
                    Try again
                  </Button>
                </div>
              )}
              {approvalError && (
                <p role="alert" className="rounded-xl bg-danger-soft p-3 text-sm text-danger">
                  {approvalError.title}: {approvalError.detail}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* No box on phones, so the composer can stick above the tab bar while the page scrolls. */}
        <div className="contents lg:mx-auto lg:block lg:w-full lg:max-w-3xl lg:space-y-3 lg:px-8 lg:pb-4 lg:pt-2">
          <Composer
            disabled={pending}
            onSend={(text) => void chat.send(text)}
            onCamera={() => onCapture("camera")}
            onVoice={() => onCapture("voice", (text) => void chat.send(text))}
          />
          {chat.allowance && <AllowanceMeter allowance={chat.allowance} />}
          <p className="flex items-start gap-2 px-1 text-xs leading-relaxed text-ink-subtle">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            Educational guidance using fictional data. Every amount Penny quotes is checked against your records, and
            nothing changes without your approval. Chats are saved to your account.
          </p>
        </div>
      </div>

      <Dialog open={scanOpen} onOpenChange={setScanOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Scan a receipt or statement</DialogTitle>
            <DialogDescription>
              Snap a receipt and Penny AI sorts it into one purchase per category, or upload a bank or card statement
              (PDF, Excel, or CSV). Nothing is added until you check it.
            </DialogDescription>
          </DialogHeader>
          <StatementImport dashboard={dashboard} save={save} />
        </DialogContent>
      </Dialog>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Your chats</DialogTitle>
            <DialogDescription>Saved to your account, so they follow you to other devices.</DialogDescription>
          </DialogHeader>
          {historyList}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Today's Penny AI questions: a dot each, and when more come back once they're used up. */
function AllowanceMeter({ allowance }: { allowance: PennyAiAllowance }) {
  if (allowance.unlimited)
    return (
      <p role="status" className="flex items-center gap-2 px-1 text-xs text-ink-subtle">
        <Sparkles className="size-3.5 shrink-0" aria-hidden="true" />
        Demo account: no daily limit on Penny AI questions.
      </p>
    );
  const { limit, left } = allowance;
  const hours = allowance.frees_in_seconds === null ? null : Math.max(1, Math.round(allowance.frees_in_seconds / 3600));
  return (
    <div
      role="status"
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl px-3 py-2 text-sm",
        left === 0 ? "bg-gold-soft text-ink" : "text-ink-muted",
      )}
    >
      <span className="flex gap-1" aria-hidden="true">
        {Array.from({ length: limit }, (_, index) => (
          <span
            key={index}
            className={cn("size-2.5 rounded-full", index < left ? "bg-accent-strong" : "bg-line-strong")}
          />
        ))}
      </span>
      {left > 0 ? (
        <span>
          <span className="font-semibold tabular-nums text-ink">
            {left} of {limit}
          </span>{" "}
          Penny AI questions left today
        </span>
      ) : (
        <span>
          <span className="font-semibold text-ink">You’ve used today’s {limit} Penny AI questions.</span>
          {hours !== null && ` More in about ${hours} hour${hours === 1 ? "" : "s"}.`} Lessons, budgets and everything
          else still work.
        </span>
      )}
    </div>
  );
}

/** Past conversations, newest first, with a button to start a new one. */
function ChatHistory({ chat, onPicked }: { chat: CoachChat; onPicked: () => void }) {
  return (
    <nav aria-label="Past chats" className="space-y-3">
      <Button
        className="w-full"
        onClick={() => {
          chat.newChat();
          onPicked();
        }}
        disabled={chat.pending}
      >
        <SquarePen className="size-4" aria-hidden="true" />
        New chat
      </Button>
      {chat.conversations.length === 0 ? (
        <p className="px-1 text-sm text-ink-subtle">Your chats will appear here.</p>
      ) : (
        <ul className="space-y-1">
          {chat.conversations.map((conversation) => {
            const current = conversation.id === chat.activeId;
            return (
              <li
                key={conversation.id}
                className={cn(
                  "group flex items-center rounded-xl transition-colors",
                  current ? "bg-primary-soft" : "hover:bg-sage-soft",
                )}
              >
                <button
                  type="button"
                  aria-current={current ? "true" : undefined}
                  onClick={() => {
                    chat.open(conversation.id);
                    onPicked();
                  }}
                  className="min-h-12 min-w-0 flex-1 px-3 py-2 text-left"
                >
                  <span className={cn("block truncate text-sm", current ? "font-semibold text-ink" : "text-ink")}>
                    {conversation.title}
                  </span>
                  <span className="block text-xs text-ink-subtle">
                    {relativeDay(conversation.updated_at)} · {Math.ceil(conversation.messages.length / 2)} question
                    {conversation.messages.length > 2 ? "s" : ""}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => chat.remove(conversation.id)}
                  className="grid size-10 shrink-0 place-items-center rounded-lg text-ink-subtle opacity-70 hover:bg-danger-soft hover:text-danger group-hover:opacity-100"
                  aria-label={`Delete chat: ${conversation.title}`}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </nav>
  );
}

function relativeDay(iso: string): string {
  const then = new Date(iso);
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days <= 0) return then.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" });
  if (days === 1) return "Yesterday";
  if (days < 7) return then.toLocaleDateString("en-CA", { weekday: "long" });
  return then.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

const FALLBACK_QUESTIONS = [
  "What should I focus on this week?",
  "Where am I overspending?",
  "Can I afford a $150 concert ticket?",
];
const AGENT_IDEAS = ["I’m moving to Toronto in September", "Can I afford a $1,299 laptop?"];

/** A short welcome and a few questions to start with. */
function Welcome({
  name,
  questions = FALLBACK_QUESTIONS,
  disabled,
  onAsk,
  onMission,
  onScan,
  onCapture,
}: {
  name: string;
  questions?: string[];
  disabled: boolean;
  onAsk: (text: string) => void;
  onMission: (kind: MissionKind, title: string) => void;
  onScan: () => void;
  onCapture: () => void;
}) {
  return (
    <section aria-labelledby="welcome-title" className="space-y-4">
      <div className="rounded-[var(--radius-card)] bg-hero p-5 text-white shadow-[var(--shadow-raised)] sm:p-6">
        <div className="flex items-start gap-3">
          <Mascot className="size-16 shrink-0 animate-bob" />
          <div>
            <h2 id="welcome-title" className="text-xl font-semibold tracking-tight sm:text-2xl">
              Hi {name}, how can I help?
            </h2>
            <p className="mt-1 text-sm text-white/75">
              Ask me anything about your money, or give me a job. My agents research it, check it against your numbers,
              and do the work. Nothing changes without your OK.
            </p>
          </div>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-2" aria-label="Give your agents a job">
          {AGENT_PRESETS.map((preset) => (
            <button
              key={preset.kind}
              type="button"
              disabled={disabled}
              onClick={() => onMission(preset.kind, preset.title)}
              className="group flex min-h-14 flex-col items-start gap-2 rounded-2xl border border-white/15 bg-white/[0.07] p-3 text-left transition-colors hover:border-white/30 hover:bg-white/[0.12] focus-visible:outline-2 focus-visible:outline-white disabled:opacity-50 sm:flex-row sm:items-center sm:gap-3"
            >
              <span
                className="grid size-9 shrink-0 place-items-center rounded-xl bg-white/90 transition-transform group-hover:scale-110"
                style={{ color: preset.color }}
                aria-hidden="true"
              >
                <preset.icon className="size-[18px]" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold leading-tight">{preset.title}</span>
                <span className="mt-0.5 hidden truncate text-xs text-white/65 sm:block">{preset.detail}</span>
              </span>
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {AGENT_IDEAS.map((idea) => (
            <button
              key={idea}
              type="button"
              disabled={disabled}
              onClick={() => onAsk(idea)}
              className="min-h-9 rounded-full border border-white/20 px-3 text-xs font-medium text-white/85 transition-colors hover:bg-white/10 disabled:opacity-50"
            >
              “{idea}”
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-2.5 sm:grid-cols-2" aria-label="Suggested questions">
        {questions.map((question) => (
          <button
            key={question}
            type="button"
            disabled={disabled}
            onClick={() => onAsk(question)}
            className="flex min-h-16 items-center gap-3 rounded-[var(--radius-card)] border border-line bg-surface p-3 text-left text-sm font-medium text-ink transition-colors hover:border-accent hover:bg-accent-soft disabled:opacity-60"
          >
            <span
              className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-strong"
              aria-hidden="true"
            >
              <Sparkles className="size-4" />
            </span>
            {question}
          </button>
        ))}
        <button
          type="button"
          onClick={onCapture}
          className="flex min-h-16 items-center gap-3 rounded-[var(--radius-card)] border border-accent/40 bg-accent-soft p-3 text-left text-sm font-medium text-ink transition-colors hover:border-accent"
        >
          <span
            className="grid size-9 shrink-0 place-items-center rounded-xl bg-[conic-gradient(from_200deg,#15977f,#356fc4,#8b5cf6,#ef6f6c,#efad3d,#15977f)] text-white"
            aria-hidden="true"
          >
            <Sparkles className="size-4" />
          </span>
          <span>
            Snap or say what you did
            <span className="block text-xs font-normal text-ink-subtle">Penny adds it, splits it, and budgets it</span>
          </span>
        </button>
        <button
          type="button"
          onClick={onScan}
          className="flex min-h-16 items-center gap-3 rounded-[var(--radius-card)] border border-dashed border-line-strong bg-surface p-3 text-left text-sm font-medium text-ink transition-colors hover:border-accent hover:bg-accent-soft"
        >
          <span
            className="grid size-9 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent-strong"
            aria-hidden="true"
          >
            <ReceiptText className="size-4" />
          </span>
          <span>
            Import a statement
            <span className="block text-xs font-normal text-ink-subtle">PDF, Excel, or CSV. Penny sorts it</span>
          </span>
        </button>
      </div>
    </section>
  );
}

function Composer({
  disabled,
  onSend,
  onCamera,
  onVoice,
}: {
  disabled: boolean;
  onSend: (text: string) => void;
  onCamera: () => void;
  /** Talk instead of typing: the words are sent like a typed message. */
  onVoice: () => void;
}) {
  const [text, setText] = useState("");
  const submit = () => {
    if (!text.trim() || disabled) return;
    onSend(text);
    setText("");
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
      className="sticky bottom-[calc(5rem+env(safe-area-inset-bottom))] z-10 lg:static"
    >
      <label htmlFor="coach-question" className="sr-only">
        Ask Penny AI about your money
      </label>
      <div className="flex items-end gap-2 rounded-2xl border border-line-strong bg-surface p-2 shadow-[var(--shadow-raised)] focus-within:border-accent focus-within:ring-4 focus-within:ring-accent/15">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onCamera}
          aria-label="Snap a receipt"
          title="Snap a receipt: Penny adds it for you"
          className="text-ink-subtle hover:text-ink"
        >
          <Camera className="size-5" aria-hidden="true" />
        </Button>
        <textarea
          id="coach-question"
          rows={1}
          value={text}
          maxLength={MAX_QUESTION_LENGTH}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          enterKeyHint="send"
          placeholder="Ask anything, or tell me what to do"
          className="max-h-40 min-h-11 flex-1 resize-none bg-transparent px-2 py-2.5 text-base text-ink [field-sizing:content] placeholder:text-ink-subtle/80 focus:outline-none"
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={onVoice}
          disabled={disabled}
          aria-label="Talk to Penny"
          title="Talk to Penny: ask anything, or tell her what to do"
          className="text-ink-subtle hover:text-ink"
        >
          <Mic className="size-5" aria-hidden="true" />
        </Button>
        <Button type="submit" size="icon" disabled={disabled || !text.trim()} aria-label="Send question">
          {disabled ? (
            <LoaderCircle className="size-5 animate-spin" aria-hidden="true" />
          ) : (
            <ArrowUp className="size-5" aria-hidden="true" />
          )}
        </Button>
      </div>
    </form>
  );
}

/** A plan from Penny's agent, inside the chat: approve it here, then see what was done (with Undo). */
function AgentReply({
  agent,
  dashboard,
  onDashboardChange,
  onApp,
  onSay,
  onVoice,
  onChange,
}: {
  agent: AgentMessage;
  dashboard: Dashboard;
  onDashboardChange: (dashboard: Dashboard) => void;
  onApp: (step: AppStep) => void;
  onSay: (text: string) => void;
  onVoice: () => void;
  onChange: (change: Partial<AgentMessage>) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const finish = (done: string[], applied?: AgentApplied) => {
    agent.plan.app.forEach(onApp);
    onChange({ state: "done", done, undoId: applied?.undo_id });
    play("win");
    confetti({ y: 0.5, pieces: 120 });
  };
  async function undo() {
    if (!agent.undoId) return;
    setBusy(true);
    setError("");
    try {
      onDashboardChange(await agentApi.undo(agent.undoId));
      onChange({ state: "undone" });
    } catch (reason) {
      setError(describeError(reason, "Couldn’t undo").detail);
    } finally {
      setBusy(false);
    }
  }
  if (agent.state === "replaced")
    // Penny's question stays in the conversation; an older plan just points to the newer one.
    return agent.plan.question && !agent.plan.steps.length ? (
      <div className="flex items-start gap-3">
        <Avatar />
        <p className="rounded-2xl rounded-tl-md border border-line bg-surface px-4 py-3 text-sm text-ink">
          {agent.plan.question}
        </p>
      </div>
    ) : (
      <p className="pl-12 text-xs text-ink-subtle">↻ Updated below</p>
    );
  return (
    <div className="flex items-start gap-3">
      <Avatar />
      <div className="min-w-0 flex-1 rounded-2xl rounded-tl-md border border-line bg-surface p-4 shadow-[var(--shadow-card)]">
        {agent.state === "open" ? (
          <PlanCard
            compact
            plan={agent.plan}
            photo={null}
            dashboard={dashboard}
            applyChange={onDashboardChange}
            onRefine={onSay}
            onVoice={onVoice}
            onDone={(applied) => finish(applied.done, applied)}
            onAppOnly={() => finish(agent.plan.app.map((step) => `${step.emoji} ${step.title}`))}
          />
        ) : (
          <div className="space-y-2">
            <p className="font-semibold text-ink">
              {agent.state === "undone" ? "Undone, all back how it was" : "Done!"}
            </p>
            <ul className="space-y-1.5">
              {(agent.done ?? []).map((line) => (
                <li
                  key={line}
                  className={cn(
                    "flex items-center gap-2 text-sm text-ink",
                    agent.state === "undone" && "text-ink-subtle line-through",
                  )}
                >
                  <Check className="size-4 shrink-0 text-zone-green" aria-hidden="true" />
                  {line}
                </li>
              ))}
            </ul>
            {agent.state === "done" && agent.undoId && (
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void undo()}>
                <RotateCcw className="size-4" aria-hidden="true" />
                Undo
              </Button>
            )}
            {error && (
              <p role="alert" className="text-sm font-medium text-danger">
                {error}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function UserBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] whitespace-pre-wrap rounded-3xl rounded-br-md bg-[linear-gradient(135deg,#15977f,#356fc4)] px-4 py-3 text-[15px] font-medium text-white shadow-[0_6px_20px_rgb(53_111_196/0.25)] animate-enter">
        {text}
      </p>
    </div>
  );
}

function Thinking() {
  return (
    <div className="flex items-center gap-3" role="status">
      <Avatar />
      <p className="flex items-center gap-2 rounded-3xl rounded-tl-md border border-line bg-surface px-4 py-3 text-sm text-ink-muted">
        <span className="flex gap-1" aria-hidden="true">
          {[0, 150, 300].map((delay) => (
            <span
              key={delay}
              className="size-1.5 animate-bounce rounded-full bg-accent"
              style={{ animationDelay: `${delay}ms` }}
            />
          ))}
        </span>
        Penny is thinking…
      </p>
    </div>
  );
}

function Avatar() {
  return (
    <span className="grid size-9 shrink-0 place-items-center" aria-hidden="true">
      <Mascot face className="size-9 drop-shadow-sm" />
    </span>
  );
}

function AssistantMessage({
  reply,
  proposalState,
  planState,
  showFollowUps,
  disabled,
  onAsk,
  onApprove,
  onDismiss,
  onAddPlan,
  feedback,
  onRate,
}: {
  reply: CoachReply;
  proposalState: ProposalState | undefined;
  planState: ProposalState | undefined;
  showFollowUps: boolean;
  disabled: boolean;
  onAsk: (text: string) => void;
  onApprove: (proposal: CoachProposal) => void;
  onDismiss: (proposal: CoachProposal) => void;
  onAddPlan: (month: string, picked: BudgetSuggestion[]) => Promise<string | null>;
  feedback: AnswerFeedback | undefined;
  onRate: (feedback: AnswerFeedback) => void;
}) {
  return (
    <article className="flex gap-3" aria-label="Penny AI reply">
      <Avatar />
      <div className="min-w-0 flex-1 space-y-3">
        <div className="rounded-2xl rounded-tl-md border border-line bg-surface p-4 shadow-[var(--shadow-card)]">
          <RichText text={reply.reply} />
          {reply.tools_used.length > 0 && (
            <p className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-subtle">
              <Wrench className="size-3.5" aria-hidden="true" />
              {reply.tools_used.map((tool, index) => (
                <span key={`${tool.name}-${index}`}>{tool.label}</span>
              ))}
            </p>
          )}
          {reply.facts.length > 0 && <Facts reply={reply} />}
          <SourceLine reply={reply} />
          <div className="mt-3 border-t border-line pt-3">
            <AnswerFeedbackRow value={feedback} onRate={async (next) => onRate(next)} />
          </div>
        </div>
        {reply.proposal && proposalState !== "dismissed" && (
          <ProposalCard proposal={reply.proposal} state={proposalState} onApprove={onApprove} onDismiss={onDismiss} />
        )}
        {reply.budget_plan && reply.budget_plan.lines.length > 0 && (
          <BudgetPlanCard plan={reply.budget_plan} state={planState} onAdd={onAddPlan} />
        )}
        {showFollowUps && reply.follow_ups.length > 0 && (
          <div className="flex flex-wrap gap-2" aria-label="Follow-up questions">
            {reply.follow_ups.map((question) => (
              <Chip key={question} disabled={disabled} onClick={() => onAsk(question)}>
                {question}
              </Chip>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

function Facts({ reply }: { reply: CoachReply }) {
  return (
    <details className="group mt-3 rounded-xl bg-sage-soft">
      <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 px-3 text-xs font-semibold text-ink-muted [&::-webkit-details-marker]:hidden">
        <ShieldCheck className="size-3.5 text-accent" aria-hidden="true" />
        Numbers behind this answer · {reply.facts.length}
        <ChevronRight className="ml-auto size-4 transition-transform group-open:rotate-90" aria-hidden="true" />
      </summary>
      <dl className="divide-y divide-line px-3 pb-2">
        {reply.facts.map((fact) => (
          <div key={`${fact.label}-${fact.display}`} className="flex justify-between gap-3 py-1.5 text-sm">
            <dt className="text-ink-muted">{fact.label}</dt>
            <dd
              className={cn(
                "tabular font-semibold",
                fact.cents !== null && fact.cents < 0 ? "text-danger" : "text-ink",
              )}
            >
              {fact.display}
            </dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

const FALLBACK_LABEL: Record<NonNullable<CoachReply["fallback_reason"]>, string> = {
  no_api_key: "Answered from your numbers",
  model_error: "Penny AI was busy, so this came straight from your numbers",
  timeout: "Penny AI took too long, so this came straight from your numbers",
  unverified_numbers: "Penny double-checked the numbers and answered from your records",
  ai_limit: "You’ve asked a lot today, so this came straight from your numbers. Penny AI is back soon.",
};

function SourceLine({ reply }: { reply: CoachReply }) {
  if (reply.source === "ai") {
    return (
      <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-subtle">
        <Badge tone="accent">
          <Sparkles className="size-3" aria-hidden="true" />
          Penny AI
        </Badge>
      </p>
    );
  }
  return (
    <p className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-subtle">
      <Badge tone="gold">Quick answer</Badge>
      {reply.fallback_reason ? FALLBACK_LABEL[reply.fallback_reason] : null}
    </p>
  );
}

function ProposalCard({
  proposal,
  state,
  onApprove,
  onDismiss,
}: {
  proposal: CoachProposal;
  state: ProposalState | undefined;
  onApprove: (proposal: CoachProposal) => void;
  onDismiss: (proposal: CoachProposal) => void;
}) {
  const approved = state === "approved";
  const label = proposal.kind === "goal_contribution" ? "Saved" : "Limit";
  return (
    <Card className="border-accent/30 bg-accent-soft p-4">
      <div className="flex items-center gap-2">
        <LockKeyhole className="size-4 text-accent-strong" aria-hidden="true" />
        <h3 className="font-semibold text-ink">{approved ? "Change applied" : "Review this change"}</h3>
      </div>
      <p className="mt-1 text-sm font-medium text-ink">{proposal.title}</p>
      {proposal.reason && <p className="mt-1 text-sm text-ink-muted">{proposal.reason}</p>}
      <p className="tabular mt-2 text-sm text-ink-muted">
        {proposal.target_name}: {label} {cad(proposal.current_cents)} →{" "}
        <span className="font-semibold text-ink">{cad(proposal.proposed_cents)}</span>
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={() => onApprove(proposal)} disabled={state !== undefined}>
          {state === "approving" ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          ) : approved ? (
            <Check className="size-4" aria-hidden="true" />
          ) : null}
          {approved ? "Approved" : "Approve"}
        </Button>
        {!approved && (
          <Button variant="ghost" onClick={() => onDismiss(proposal)} disabled={state === "approving"}>
            Not now
          </Button>
        )}
      </div>
    </Card>
  );
}

/**
 * A whole budget Penny AI built: where the money goes, then a limit per category the user can
 * untick. "Add to my budgets" applies the ticked ones as normal budget changes; nothing changes
 * before that. Every figure comes from the API (app/domain/smart_budget.py).
 */
function BudgetPlanCard({
  plan,
  state,
  onAdd,
}: {
  plan: CoachBudgetPlan;
  state: ProposalState | undefined;
  onAdd: (month: string, picked: BudgetSuggestion[]) => Promise<string | null>;
}) {
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const added = state === "approved";
  const picked = plan.lines.filter((line) => !skipped.has(line.category_id));
  async function add() {
    setError("");
    const failed = await onAdd(plan.month, picked);
    if (failed) setError(failed);
  }
  return (
    <Card className="border-accent/30 bg-accent-soft/50 p-4">
      <div className="flex items-center gap-2">
        <PiggyBank className="size-4 text-accent-strong" aria-hidden="true" />
        <h3 className="font-semibold text-ink">{added ? "Added to your budgets" : "Your budget plan"}</h3>
      </div>
      <p className="mt-1 text-sm text-ink-muted">{plan.summary}</p>
      <div className="mt-3">
        <PlanBreakdown plan={plan} />
      </div>
      <ul className="mt-3 divide-y divide-line rounded-xl border border-line bg-surface" aria-label="Category budgets">
        {plan.lines.map((line) => {
          const on = !skipped.has(line.category_id);
          return (
            <li key={line.category_id}>
              <label
                className={cn(
                  "flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2",
                  (!on || added) && "opacity-70",
                )}
              >
                <input
                  type="checkbox"
                  checked={on}
                  disabled={added || state === "approving"}
                  onChange={() =>
                    setSkipped((current) => {
                      const next = new Set(current);
                      if (next.has(line.category_id)) next.delete(line.category_id);
                      else next.add(line.category_id);
                      return next;
                    })
                  }
                  className="size-5 shrink-0 accent-[var(--color-accent)]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">{line.category_name}</span>
                  <span className="tabular block text-xs text-ink-subtle">
                    Usually {cad(line.average_cents)}
                    {line.current_limit_cents !== null && <> · now {cad(line.current_limit_cents)}</>}
                  </span>
                </span>
                <span className="tabular shrink-0 text-sm font-semibold text-ink">{cad(line.suggested_cents)}</span>
              </label>
            </li>
          );
        })}
      </ul>
      {error && (
        <p role="alert" className="mt-2 rounded-xl bg-danger-soft px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button onClick={() => void add()} disabled={added || state === "approving" || picked.length === 0}>
          {state === "approving" ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          ) : added ? (
            <Check className="size-4" aria-hidden="true" />
          ) : (
            <Plus className="size-4" aria-hidden="true" />
          )}
          {added ? "Added" : `Add to my budgets${picked.length < plan.lines.length ? ` (${picked.length})` : ""}`}
        </Button>
        {!added && (
          <span className="text-xs text-ink-subtle">
            Nothing changes until you add it. You can edit any budget later.
          </span>
        )}
      </div>
    </Card>
  );
}

function Chip({ children, disabled, onClick }: { children: ReactNode; disabled: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="min-h-11 rounded-full border border-line bg-sage-soft px-3 text-left text-sm font-medium text-ink-muted transition-colors hover:border-accent hover:bg-accent-soft hover:text-ink disabled:opacity-50"
    >
      {children}
    </button>
  );
}

/** Renders the coach's light formatting: paragraphs, "- " bullet lists, and **bold**. */
function RichText({ text }: { text: string }) {
  const blocks = text.split(/\n\s*\n/).map((block) => block.split("\n").filter((line) => line.trim()));
  return (
    <div className="space-y-2.5 text-sm leading-relaxed text-ink">
      {blocks.map((lines, index) => {
        const isList = lines.every((line) => /^\s*[-•*]\s+/.test(line));
        if (isList)
          return (
            <ul key={index} className="list-disc space-y-1 pl-5 marker:text-accent">
              {lines.map((line, i) => (
                <li key={i}>{inline(line.replace(/^\s*[-•*]\s+/, ""))}</li>
              ))}
            </ul>
          );
        return lines.map((line, i) =>
          /^\s*[-•*]\s+/.test(line) ? (
            <ul key={`${index}-${i}`} className="list-disc pl-5 marker:text-accent">
              <li>{inline(line.replace(/^\s*[-•*]\s+/, ""))}</li>
            </ul>
          ) : (
            <p key={`${index}-${i}`}>{inline(line)}</p>
          ),
        );
      })}
    </div>
  );
}

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, index) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4 ? (
      <strong key={index} className="font-semibold">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part
    ),
  );
}
