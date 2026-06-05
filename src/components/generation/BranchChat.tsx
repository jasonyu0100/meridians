"use client";
// BranchChat — conversational interface for querying and steering a branch's timeline.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  EXAMPLE_QUERIES,
  streamBranchChatTurn,
  type BranchScope,
} from "@/lib/ai/branch-chat";
import { resolveEntrySequence } from "@/lib/forces/narrative-utils";
import { useStore } from "@/lib/state/store";
import { logError } from "@/lib/core/system-logger";
import type {
  Branch,
  BranchChatThread,
  NarrativeState,
  BranchChatMessage,
} from "@/types/narrative";
import {
  BranchScopeChips,
  BranchScopeSliders,
  DEFAULT_SCOPE_STATE,
  resolveScopes,
  type BranchSequenceInfo,
  type ScopeState,
} from "./BranchScopeControl";
import { ReasoningCollapsed, ReasoningInline } from "./ReasoningStream";
import { Markdown } from "@/components/ui/Markdown";

/**
 * Branch Chat — multi-branch analytical chat with controlled scopes.
 *
 * Lab interface for evaluating candidate branches at user-controlled windows.
 * Conversations persist on the narrative as `branchChatThreads` so prior
 * cross-branch analysis can be revisited later. Foundation for v2 experiments
 * (controlled-variable simulation across the same scope primitives).
 */

type Props = {
  narrative: NarrativeState;
  allBranches: Branch[];
  compareBranchIds: string[];
  branchColor: (id: string) => string;
  /** Called when a thread is opened or created with a stored set of compare
   *  branches — lets the parent (BranchModal) sync its own selection state so
   *  the chip header reflects the active thread. */
  onRestoreCompareBranches: (ids: string[]) => void;
};

export function BranchChat({
  narrative,
  allBranches,
  compareBranchIds,
  branchColor,
  onRestoreCompareBranches,
}: Props) {
  const { state, dispatch } = useStore();
  const activeThreadId = state.viewState.activeBranchChatThreadId;
  const threads = narrative.branchChatThreads ?? {};
  const activeThread =
    activeThreadId && threads[activeThreadId] ? threads[activeThreadId] : null;

  const [scopeState, setScopeState] = useState<ScopeState>(
    activeThread?.scopeState ?? DEFAULT_SCOPE_STATE,
  );
  const [messages, setMessages] = useState<BranchChatMessage[]>(
    activeThread?.messages ?? [],
  );
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [reasoningText, setReasoningText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  // Track scope-change between turns so the next turn carries an injected
  // notice. Reset after the turn completes.
  const lastTurnScopeKey = useRef<string>("");
  const conversationRef = useRef<HTMLDivElement>(null);

  // ── Thread hydration ───────────────────────────────────────────────────
  // When the active thread switches (or a stored thread becomes available
  // after a refresh), pull its messages + scope state into local state and
  // ask the parent to restore the saved compare-branch selection so the
  // chip header reflects the thread's context.
  const lastHydratedRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeThread && lastHydratedRef.current !== activeThread.id) {
      lastHydratedRef.current = activeThread.id;
      setMessages(activeThread.messages);
      setScopeState(activeThread.scopeState);
      setError(null);
      lastTurnScopeKey.current = "";
      if (activeThread.compareBranchIds.length > 0) {
        onRestoreCompareBranches(activeThread.compareBranchIds);
      }
    }
  }, [activeThread, onRestoreCompareBranches]);

  const selectedBranches = useMemo(
    () =>
      compareBranchIds
        .map((id) => allBranches.find((b) => b.id === id))
        .filter((b): b is Branch => !!b),
    [compareBranchIds, allBranches],
  );

  const branchInfos: BranchSequenceInfo[] = useMemo(
    () =>
      selectedBranches.map((b) => ({
        branchId: b.id,
        name: b.name,
        color: branchColor(b.id),
        length: resolveEntrySequence(narrative.branches, b.id).length,
      })),
    [selectedBranches, narrative.branches, branchColor],
  );

  // Compute divergence start (1-based) — first index where branches diverge.
  const divergenceStart = useMemo(() => {
    if (selectedBranches.length < 2) return 1;
    const sequences = selectedBranches.map((b) =>
      resolveEntrySequence(narrative.branches, b.id),
    );
    const min = Math.min(...sequences.map((s) => s.length));
    let lcp = 0;
    while (lcp < min) {
      const v = sequences[0][lcp];
      if (sequences.some((s) => s[lcp] !== v)) break;
      lcp++;
    }
    return lcp + 1;
  }, [selectedBranches, narrative.branches]);

  const resolvedScopes: BranchScope[] = useMemo(
    () => resolveScopes(scopeState, branchInfos, divergenceStart),
    [scopeState, branchInfos, divergenceStart],
  );

  const scopeKey = useMemo(
    () => resolvedScopes.map((s) => `${s.branchId}:${s.start}-${s.end}`).join("|"),
    [resolvedScopes],
  );

  // Auto-scroll the conversation to bottom on new content.
  useEffect(() => {
    const el = conversationRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, streamText]);

  // Ensure an active thread exists before persisting a turn. If none, create
  // one seeded from the first user message; the auto-name keeps thread lists
  // legible without requiring the operator to title every session.
  const ensureThread = useCallback(
    (firstUserContent: string): string => {
      if (activeThreadId && threads[activeThreadId]) return activeThreadId;
      const id = crypto.randomUUID();
      const now = Date.now();
      const trimmed = firstUserContent.trim();
      const autoName =
        trimmed.length > 50 ? `${trimmed.slice(0, 50)}…` : trimmed || "New analysis";
      const thread: BranchChatThread = {
        id,
        name: autoName,
        messages: [],
        compareBranchIds,
        scopeState,
        createdAt: now,
        updatedAt: now,
      };
      dispatch({ type: "CREATE_BRANCH_CHAT_THREAD", thread });
      lastHydratedRef.current = id;
      return id;
    },
    [activeThreadId, threads, compareBranchIds, scopeState, dispatch],
  );

  async function dispatchTurn(content: string) {
    if (!content.trim() || streaming) return;
    if (selectedBranches.length === 0) return;

    const userMsg: BranchChatMessage = { role: "user", content: content.trim() };
    const history = messages;
    const scopeChanged = lastTurnScopeKey.current !== "" && lastTurnScopeKey.current !== scopeKey;

    const threadId = ensureThread(content);

    const afterUser = [...messages, userMsg];
    setMessages(afterUser);
    setInput("");
    setStreaming(true);
    setStreamText("");
    setReasoningText("");
    setError(null);

    // Track reasoning + duration locally — onReasoning fires off the latest
    // state value, but we also need the final concatenation for persistence.
    let reasoningAcc = "";
    const startedAt = performance.now();

    try {
      const full = await streamBranchChatTurn({
        narrative,
        scopes: resolvedScopes,
        history,
        newTurn: content.trim(),
        scopeChangedSinceLastTurn: scopeChanged,
        onToken: (tok) => setStreamText((prev) => prev + tok),
        onReasoning: (tok) => {
          reasoningAcc += tok;
          setReasoningText((prev) => prev + tok);
        },
      });
      const durationMs = Math.round(performance.now() - startedAt);
      const finalMessages: BranchChatMessage[] = [
        ...afterUser,
        {
          role: "assistant",
          content: full,
          reasoning: reasoningAcc || undefined,
          durationMs,
        },
      ];
      setMessages(finalMessages);
      lastTurnScopeKey.current = scopeKey;
      // Persist — full message log + the scope/branch selection captured at
      // turn time so the thread re-opens to the same configuration.
      dispatch({
        type: "UPSERT_BRANCH_CHAT_THREAD",
        threadId,
        messages: finalMessages,
        compareBranchIds,
        scopeState,
      });
    } catch (err) {
      logError("Branch chat turn failed", err, {
        source: "branch-chat",
        operation: "branch-chat-turn",
        details: { branchCount: selectedBranches.length },
      });
      setError(err instanceof Error ? err.message : String(err));
      // Roll back the user message so they can edit & retry without
      // half-state in the conversation.
      setMessages(history);
    } finally {
      setStreaming(false);
      setStreamText("");
      setReasoningText("");
    }
  }

  function handleSubmit() {
    dispatchTurn(input);
  }

  function handleNewThread() {
    dispatch({ type: "SET_ACTIVE_BRANCH_CHAT_THREAD", threadId: null });
    lastHydratedRef.current = null;
    setMessages([]);
    setError(null);
    lastTurnScopeKey.current = "";
    setPickerOpen(false);
  }

  function handleSelectThread(id: string) {
    dispatch({ type: "SET_ACTIVE_BRANCH_CHAT_THREAD", threadId: id });
    setPickerOpen(false);
  }

  function handleDeleteThread(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    dispatch({ type: "DELETE_BRANCH_CHAT_THREAD", threadId: id });
  }

  const sortedThreads = useMemo(
    () => Object.values(threads).sort((a, b) => b.updatedAt - a.updatedAt),
    [threads],
  );

  if (selectedBranches.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs text-text-dim px-6">
        Select branches above to open the chat.
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">
      {/* ── Top row — thread picker on the left, scope chips on the right ── */}
      <div className="px-6 py-2.5 shrink-0 flex items-center gap-3 relative">
        <button
          onClick={() => setPickerOpen((v) => !v)}
          className={`flex items-center gap-1.5 text-[12px] font-medium px-2.5 py-1 rounded-md border transition-colors shrink-0 ${
            pickerOpen
              ? "bg-white/10 border-white/15 text-text-primary"
              : "bg-white/5 border-white/8 text-text-primary hover:bg-white/8 hover:border-white/12"
          }`}
          title="Switch analysis thread"
        >
          <span className="text-text-dim/70 text-[10px]">
            {pickerOpen ? "▾" : "▸"}
          </span>
          <span className="truncate max-w-50">
            {activeThread?.name ?? "New analysis"}
          </span>
          {sortedThreads.length > 0 && (
            <span className="text-[10px] text-text-dim/70 font-mono ml-1 px-1 rounded bg-white/8">
              {sortedThreads.length}
            </span>
          )}
        </button>
        <button
          onClick={handleNewThread}
          disabled={!activeThread && messages.length === 0}
          className="flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-md bg-white/5 border border-white/8 text-text-secondary hover:text-text-primary hover:bg-white/10 hover:border-white/15 transition-colors disabled:opacity-30 disabled:cursor-not-allowed shrink-0"
          title="Start a fresh analysis thread"
        >
          <span className="text-[13px] leading-none">+</span>
          <span>New</span>
        </button>
        {/* Vertical divider between thread management and scope */}
        <div className="w-px h-5 bg-white/8 shrink-0" />
        <div className="flex-1 min-w-0">
          <BranchScopeChips
            branches={branchInfos}
            divergenceStart={divergenceStart}
            state={scopeState}
            onChange={setScopeState}
          />
        </div>

        {pickerOpen && (
          <div className="absolute top-full left-6 mt-1 w-80 rounded-lg border border-white/10 bg-bg-panel shadow-xl z-20 max-h-72 overflow-y-auto">
            {sortedThreads.length === 0 ? (
              <div className="px-3 py-3 text-[11px] text-text-dim text-center">
                No saved threads yet — your first turn creates one.
              </div>
            ) : (
              <ul className="py-1">
                {sortedThreads.map((t) => (
                  <li key={t.id}>
                    <button
                      onClick={() => handleSelectThread(t.id)}
                      className={`group w-full flex items-center justify-between gap-2 px-3 py-2 text-left transition-colors ${
                        t.id === activeThreadId
                          ? "bg-white/8"
                          : "hover:bg-white/4"
                      }`}
                    >
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="text-[12px] text-text-primary truncate">
                          {t.name}
                        </span>
                        <span className="text-[10px] text-text-dim/60 font-mono">
                          {relativeTime(t.updatedAt)} · {t.messages.length} msg
                          {t.messages.length === 1 ? "" : "s"}
                          {t.compareBranchIds.length > 0
                            ? ` · ${t.compareBranchIds.length} branch${t.compareBranchIds.length === 1 ? "" : "es"}`
                            : ""}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={(e) => handleDeleteThread(t.id, e)}
                        className="opacity-0 group-hover:opacity-100 text-[10px] text-text-dim/60 hover:text-red-400 transition-opacity px-1.5 py-0.5 rounded hover:bg-white/6"
                        title="Delete thread"
                      >
                        ✕
                      </button>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* ── Custom-mode sliders ───────────────────────────────────────────
          Only mounts when scope mode is 'custom'. The chips above stay
          inline with the thread picker; sliders need their own row. */}
      {scopeState.mode === "custom" && (
        <div className="px-6 pb-3 border-b border-white/6 shrink-0">
          <BranchScopeSliders
            branches={branchInfos}
            divergenceStart={divergenceStart}
            state={scopeState}
            onChange={setScopeState}
          />
        </div>
      )}
      {scopeState.mode !== "custom" && (
        <div className="border-b border-white/6 shrink-0" />
      )}

      {/* ── Conversation ──────────────────────────────────────────────────── */}
      <div ref={conversationRef} className="flex-1 overflow-y-auto px-6 py-4 min-h-0 space-y-4">
        {messages.length === 0 && !streaming && (
          <div className="flex flex-col items-center justify-center h-full gap-1.5 text-center">
            <div className="text-[10px] uppercase tracking-[0.18em] text-text-dim/50 font-mono">
              Chat
            </div>
            <p className="text-[11px] text-text-dim/60 max-w-xs leading-relaxed">
              Birdseye comparison of scoped branches. Outline-only context — no
              engine deltas, no narrative bias.
            </p>
          </div>
        )}

        {messages.map((m, i) => (
          <Message key={i} message={m} />
        ))}

        {streaming && (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-text-dim/60 font-mono">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Analyst
            </div>
            {reasoningText && (
              <ReasoningInline text={reasoningText} active={!streamText} />
            )}
            {streamText ? (
              <Markdown text={streamText} entities />
            ) : !reasoningText ? (
              <div className="text-[13.5px] inline-flex gap-1 items-center text-text-dim/50">
                <span className="w-1 h-1 rounded-full bg-text-dim/40 animate-pulse" />
                thinking
              </div>
            ) : null}
          </div>
        )}

        {error && !streaming && (
          <div className="text-[11px] text-red-400/80 px-3 py-2 rounded-md bg-red-500/8 border border-red-500/15">
            {error}
          </div>
        )}
      </div>

      {/* ── Compose zone — suggestions marquee + input share one frame ───── */}
      <div className="border-t border-white/8 shrink-0 flex flex-col">
        <SuggestionsMarquee
          queries={EXAMPLE_QUERIES}
          onSelect={(q) => dispatchTurn(q)}
          disabled={streaming || selectedBranches.length === 0}
        />
        <div className="px-6 pt-1 pb-3 flex flex-col gap-2">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
            }}
            placeholder={
              selectedBranches.length === 1
                ? "Ask about this branch's scoped window…"
                : `Ask about these ${selectedBranches.length} branches…`
            }
            rows={2}
            disabled={streaming}
            className="flex-1 bg-white/4 border border-white/8 rounded-lg px-3 py-2 text-[12.5px] text-text-primary outline-none focus:border-white/20 resize-none placeholder:text-text-dim/40 disabled:opacity-50"
          />
          <button
            onClick={handleSubmit}
            disabled={streaming || !input.trim()}
            className="h-9 px-4 rounded-lg bg-white/10 hover:bg-white/16 text-text-primary text-[12px] font-semibold transition disabled:opacity-30"
          >
            {streaming ? "…" : "Send →"}
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}


// ── Message renderer ────────────────────────────────────────────────────────

function Message({ message }: { message: BranchChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-text-dim/60 font-mono">
          <div className="w-1.5 h-1.5 rounded-full bg-white/40" />
          You
        </div>
        <div className="text-text-primary/90">
          <Markdown text={message.content} entities />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-text-dim/60 font-mono">
        <div className="w-1.5 h-1.5 rounded-full bg-emerald-400/80" />
        Analyst
      </div>
      {message.reasoning && (
        <ReasoningCollapsed text={message.reasoning} durationMs={message.durationMs} />
      )}
      <Markdown text={message.content} entities />
    </div>
  );
}

// ── Suggestions marquee ─────────────────────────────────────────────────────
//
// Continuous horizontal scroll of example queries above the message input.
// Always visible (no empty-state takeover); pauses on hover so the operator
// can read and click. Track contains two copies of the queries for a seamless
// loop with translateX(-50%) to the duplicate.

function SuggestionsMarquee({
  queries,
  onSelect,
  disabled,
}: {
  queries: string[];
  onSelect: (q: string) => void;
  disabled: boolean;
}) {
  if (queries.length === 0) return null;
  const doubled = [...queries, ...queries];
  return (
    <div className="px-6 py-2 shrink-0 marquee-frame relative overflow-hidden">
      <div className="marquee-track flex items-center gap-1.5 w-max">
        {doubled.map((q, i) => (
          <button
            key={`${q}-${i}`}
            onClick={() => onSelect(q)}
            disabled={disabled}
            className="shrink-0 text-[11px] text-text-dim hover:text-text-primary px-2.5 py-1 rounded-full border border-white/8 bg-white/2 hover:bg-white/6 transition-colors whitespace-nowrap disabled:opacity-30 disabled:cursor-not-allowed"
          >
            {q}
          </button>
        ))}
      </div>
      {/* Edge fade so chips dissolve in/out rather than hard-cropping at the
          panel edges. Subtle but makes the motion feel intentional. */}
      <div className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-linear-to-r from-bg-panel to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-linear-to-l from-bg-panel to-transparent" />
      <style jsx>{`
        .marquee-track {
          animation: branch-chat-marquee 60s linear infinite;
        }
        .marquee-frame:hover .marquee-track {
          animation-play-state: paused;
        }
        @keyframes branch-chat-marquee {
          from {
            transform: translateX(0);
          }
          to {
            transform: translateX(-50%);
          }
        }
      `}</style>
    </div>
  );
}

// ── Relative time helper ────────────────────────────────────────────────────

function relativeTime(ts: number): string {
  const dt = Date.now() - ts;
  if (dt < 60_000) return "just now";
  if (dt < 3_600_000) return `${Math.floor(dt / 60_000)}m ago`;
  if (dt < 86_400_000) return `${Math.floor(dt / 3_600_000)}h ago`;
  if (dt < 604_800_000) return `${Math.floor(dt / 86_400_000)}d ago`;
  return new Date(ts).toLocaleDateString();
}
