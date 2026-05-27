"use client";

import {
  IconChevronDown,
  IconEdit,
  IconSend,
  IconTrash,
} from "@/components/icons";
import { useFeatureAccess } from "@/hooks/useFeatureAccess";
import {
  compassContext,
  gameTheoryContext,
  hasCompassScenarios,
  hasGameTheory,
  hasInvestigation,
  hasMode,
  investigationContext,
  modeContext,
  narrativeContext,
  outlineContext,
  sceneContext,
} from "@/lib/ai";
import {
  buildEntityPersonaPrompt,
  buildFatePersonaPrompt,
  buildCompassChatPrompt,
  buildGameTheoryChatPrompt,
  buildInvestigationChatPrompt,
  buildModeChatPrompt,
  buildNarrativeChatPrompt,
  buildOutlineChatPrompt,
  buildSceneAnchor,
  buildSceneChatPrompt,
  buildSystemPersonaPrompt,
  buildWorldPersonaPrompt,
} from "@/lib/prompts/chat";
import { callGenerateStream, resolveReasoningBudget, resolveWebsearch } from "@/lib/ai/api";
import { DEFAULT_MODEL, MAX_TOKENS_DEFAULT } from "@/lib/constants";
import {
  ReasoningCollapsed,
  ReasoningInline,
} from "@/components/generation/ReasoningStream";
import { useStore } from "@/lib/store";
import type {
  Artifact,
  Character,
  Location,
  NarrativeState,
} from "@/types/narrative";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** Sentinel persona IDs for the two force-entities. These coalesce all of
 *  a narrative's threads (FATE) or system graph (SYSTEM) into a single
 *  conversational entity. Prefixed so they can't collide with real
 *  character IDs (which are "C-1", "C-2", ...). */
const PERSONA_FATE = "__fate__";
const PERSONA_SYSTEM = "__system__";
const PERSONA_WORLD = "__world__";


/** Render chat text with **bold** spans. Scoped to bold only — asterisks are
 *  common in prose ("10 * 5"), so we intentionally skip italic support.
 *  Bold runs don't cross newlines, so multi-line messages won't accidentally
 *  bold-wrap unrelated text. */
function FormattedMessage({ text }: { text: string }) {
  const parts = text.split(/(\*\*[^*\n]+?\*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        const match = /^\*\*([^*\n]+?)\*\*$/.exec(part);
        return match ? <strong key={i}>{match[1]}</strong> : part;
      })}
    </>
  );
}

export default function ChatPanel() {
  const { state, dispatch } = useStore();
  const access = useFeatureAccess();
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streamText, setStreamText] = useState("");
  const [reasoningText, setReasoningText] = useState("");
  const [contextMode, setContextMode] = useState<
    "narrative" | "outline" | "scene" | "compass" | "mode" | "investigation" | "game-theory"
  >("narrative");
  // personaId: null (Assistant), PERSONA_FATE, PERSONA_SYSTEM, or a real
  // character ID. The two sentinels coalesce all threads / all system-graph
  // nodes into force-level entities the user can converse with.
  const [personaId, setPersonaId] = useState<string | null>(null);
  const [personaPickerOpen, setPersonaPickerOpen] = useState(false);
  const personaPickerRef = useRef<HTMLDivElement>(null);
  const [contextPickerOpen, setContextPickerOpen] = useState(false);
  const contextPickerRef = useRef<HTMLDivElement>(null);
  const [threadPickerOpen, setThreadPickerOpen] = useState(false);
  const [renamingThreadId, setRenamingThreadId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const threadPickerRef = useRef<HTMLDivElement>(null);

  // Track which scene index the context was built for
  const [contextSceneIndex, setContextSceneIndex] = useState(
    state.viewState.currentSceneIndex,
  );

  // Active thread messages from store
  const activeThread = state.viewState.activeChatThreadId
    ? (state.activeNarrative?.chatThreads?.[state.viewState.activeChatThreadId] ?? null)
    : null;
  const messages = activeThread?.messages ?? [];

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Close thread picker on outside click
  useEffect(() => {
    if (!threadPickerOpen) return;
    function handleClick(e: MouseEvent) {
      if (
        threadPickerRef.current &&
        !threadPickerRef.current.contains(e.target as Node)
      ) {
        setThreadPickerOpen(false);
        setRenamingThreadId(null);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [threadPickerOpen]);

  // Update context scene index when user navigates
  useEffect(() => {
    setContextSceneIndex(state.viewState.currentSceneIndex);
  }, [state.viewState.currentSceneIndex]);

  // Reset persona when the user switches narrative — a character from
  // narrative A shouldn't carry over into narrative B.
  useEffect(() => {
    setPersonaId(null);
    setPersonaPickerOpen(false);
  }, [state.activeNarrative?.id]);

  // Clear the persona pointer if the underlying entity no longer exists
  // (e.g. the user deleted them while the chat was open). The two force
  // sentinels (__fate__, __system__) are always valid as long as there's a
  // narrative, so we skip them here.
  useEffect(() => {
    if (!personaId) return;
    if (personaId === PERSONA_FATE || personaId === PERSONA_SYSTEM || personaId === PERSONA_WORLD) return;
    const exists =
      !!state.activeNarrative?.characters[personaId] ||
      !!state.activeNarrative?.locations[personaId] ||
      !!state.activeNarrative?.artifacts?.[personaId];
    if (!exists) {
      setPersonaId(null);
    }
  }, [state.activeNarrative, personaId]);

  // Close persona picker on outside click.
  useEffect(() => {
    if (!personaPickerOpen) return;
    function handleClick(e: MouseEvent) {
      if (
        personaPickerRef.current &&
        !personaPickerRef.current.contains(e.target as Node)
      ) {
        setPersonaPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [personaPickerOpen]);

  // Close context-mode picker on outside click.
  useEffect(() => {
    if (!contextPickerOpen) return;
    function handleClick(e: MouseEvent) {
      if (
        contextPickerRef.current &&
        !contextPickerRef.current.contains(e.target as Node)
      ) {
        setContextPickerOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [contextPickerOpen]);

  // activePersona resolves the current personaId into a richer object the UI
  // and system-prompt builder can switch on. null = default "Assistant" mode.
  type ActivePersona =
    | { kind: "fate"; name: "Fate" }
    | { kind: "system"; name: "System" }
    | { kind: "world"; name: "World" }
    | { kind: "character"; name: string; character: Character }
    | { kind: "location"; name: string; location: Location }
    | { kind: "artifact"; name: string; artifact: Artifact };
  const activePersona: ActivePersona | null = useMemo(() => {
    if (!personaId || !state.activeNarrative) return null;
    if (personaId === PERSONA_FATE) return { kind: "fate", name: "Fate" };
    if (personaId === PERSONA_SYSTEM) return { kind: "system", name: "System" };
    if (personaId === PERSONA_WORLD) return { kind: "world", name: "World" };
    const char = state.activeNarrative.characters[personaId];
    if (char) return { kind: "character", name: char.name, character: char };
    const loc = state.activeNarrative.locations[personaId];
    if (loc) return { kind: "location", name: loc.name, location: loc };
    const art = state.activeNarrative.artifacts?.[personaId];
    if (art) return { kind: "artifact", name: art.name, artifact: art };
    return null;
  }, [personaId, state.activeNarrative]);

  const personaCharacters = useMemo(() => {
    if (!state.activeNarrative) return [];
    const roleOrder = { anchor: 0, recurring: 1, transient: 2 } as const;
    return Object.values(state.activeNarrative.characters).sort(
      (a, b) => (roleOrder[a.role] ?? 3) - (roleOrder[b.role] ?? 3),
    );
  }, [state.activeNarrative]);

  const personaLocations = useMemo(() => {
    if (!state.activeNarrative) return [];
    const order = { domain: 0, place: 1, margin: 2 } as const;
    return Object.values(state.activeNarrative.locations).sort(
      (a, b) =>
        (order[a.prominence] ?? 3) - (order[b.prominence] ?? 3) ||
        a.name.localeCompare(b.name),
    );
  }, [state.activeNarrative]);

  const personaArtifacts = useMemo(() => {
    if (!state.activeNarrative) return [];
    const order = { key: 0, notable: 1, minor: 2 } as const;
    return Object.values(state.activeNarrative.artifacts ?? {}).sort(
      (a, b) =>
        (order[a.significance] ?? 3) - (order[b.significance] ?? 3) ||
        a.name.localeCompare(b.name),
    );
  }, [state.activeNarrative]);

  /** Sectioned persona list for the picker dropdown. Empty sections are
   *  filtered so the menu only shows what's actually present in the
   *  narrative. */
  const personaSections = useMemo(() => {
    const sections: Array<{
      title: string;
      items: Array<{ id: string; name: string; subtitle: string }>;
    }> = [
      {
        title: "Forces",
        items: [
          { id: PERSONA_FATE, name: "Fate", subtitle: "All threads, coalesced" },
          { id: PERSONA_SYSTEM, name: "System", subtitle: "All rules, coalesced" },
          { id: PERSONA_WORLD, name: "World", subtitle: "All entities, coalesced" },
        ],
      },
    ];
    if (personaCharacters.length > 0) {
      sections.push({
        title: "Characters",
        items: personaCharacters.map((c) => ({
          id: c.id,
          name: c.name,
          subtitle: c.role,
        })),
      });
    }
    if (personaLocations.length > 0) {
      sections.push({
        title: "Locations",
        items: personaLocations.map((l) => ({
          id: l.id,
          name: l.name,
          subtitle: l.prominence,
        })),
      });
    }
    if (personaArtifacts.length > 0) {
      sections.push({
        title: "Artifacts",
        items: personaArtifacts.map((a) => ({
          id: a.id,
          name: a.name,
          subtitle: a.significance,
        })),
      });
    }
    return sections;
  }, [personaCharacters, personaLocations, personaArtifacts]);

  const buildSystemPrompt = useCallback(() => {
    if (!state.activeNarrative) return "";
    const n = state.activeNarrative;

    // Persona mode — the user is talking TO an entity (character, location,
    // artifact) or one of the three force-entities (Fate / System / World).
    // Every persona is enriched with the outline context: the three forces
    // are coalescences of live state and the outline shapes what they
    // currently express; entities live inside the timeline and use the
    // outline as enrichment they still filter through their own continuity.
    if (activePersona) {
      const outline = outlineContext(n, state.resolvedEntryKeys, contextSceneIndex);
      if (activePersona.kind === "fate") return buildFatePersonaPrompt(n, outline);
      if (activePersona.kind === "system") return buildSystemPersonaPrompt(n, outline);
      if (activePersona.kind === "world") return buildWorldPersonaPrompt(n, outline);
      if (activePersona.kind === "character")
        return buildEntityPersonaPrompt(n, "character", activePersona.character, outline);
      if (activePersona.kind === "location")
        return buildEntityPersonaPrompt(n, "location", activePersona.location, outline);
      return buildEntityPersonaPrompt(n, "artifact", activePersona.artifact, outline);
    }

    const sceneAnchor = buildSceneAnchor(n, state.resolvedEntryKeys, contextSceneIndex);
    const currentSceneId = state.resolvedEntryKeys[contextSceneIndex];
    const currentScene = currentSceneId ? n.scenes[currentSceneId] : null;

    if (contextMode === "scene" && currentScene) {
      const ctx = sceneContext(n, currentScene, state.resolvedEntryKeys, contextSceneIndex);
      return buildSceneChatPrompt(n, sceneAnchor, ctx);
    }
    if (contextMode === "outline") {
      const outline = outlineContext(n, state.resolvedEntryKeys, contextSceneIndex);
      return buildOutlineChatPrompt(n, sceneAnchor, outline);
    }
    if (contextMode === "compass") {
      const outline = outlineContext(n, state.resolvedEntryKeys, contextSceneIndex);
      const compass = compassContext(n, state.resolvedEntryKeys, contextSceneIndex);
      return buildCompassChatPrompt(n, sceneAnchor, outline, compass);
    }
    if (contextMode === "investigation") {
      const outline = outlineContext(n, state.resolvedEntryKeys, contextSceneIndex);
      const investigation = investigationContext(
        n,
        state.resolvedEntryKeys,
        contextSceneIndex,
        state.viewState.selectedInvestigationId,
      );
      return buildInvestigationChatPrompt(n, sceneAnchor, outline, investigation);
    }
    if (contextMode === "mode") {
      const outline = outlineContext(n, state.resolvedEntryKeys, contextSceneIndex);
      const mode = modeContext(n);
      return buildModeChatPrompt(n, sceneAnchor, outline, mode);
    }
    if (contextMode === "game-theory") {
      const gameTheory = gameTheoryContext(n, state.resolvedEntryKeys, contextSceneIndex);
      return buildGameTheoryChatPrompt(n, sceneAnchor, gameTheory);
    }

    const narrativeBlock = narrativeContext(n, state.resolvedEntryKeys, contextSceneIndex);
    return buildNarrativeChatPrompt(n, sceneAnchor, narrativeBlock);
  }, [
    state.activeNarrative,
    state.resolvedEntryKeys,
    state.viewState.selectedInvestigationId,
    contextSceneIndex,
    contextMode,
    activePersona,
  ]);

  // Ensure there is an active thread; create one if needed. Returns thread id.
  const ensureThread = useCallback(() => {
    if (
      state.viewState.activeChatThreadId &&
      state.activeNarrative?.chatThreads?.[state.viewState.activeChatThreadId]
    ) {
      return state.viewState.activeChatThreadId;
    }
    const id = crypto.randomUUID();
    const now = Date.now();
    dispatch({
      type: "CREATE_CHAT_THREAD",
      thread: {
        id,
        name: "New thread",
        messages: [],
        createdAt: now,
        updatedAt: now,
      },
    });
    return id;
  }, [state.viewState.activeChatThreadId, state.activeNarrative, dispatch]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || loading) return;

    const threadId = ensureThread();
    const prevMessages =
      state.activeNarrative?.chatThreads?.[threadId]?.messages ?? messages;
    const userMsg = { role: "user" as const, content: text };
    const newMessages = [...prevMessages, userMsg];

    // Auto-name thread from first user message
    const isFirstMessage = prevMessages.length === 0;
    const autoName = isFirstMessage
      ? text.slice(0, 40) + (text.length > 40 ? "…" : "")
      : undefined;

    dispatch({
      type: "UPSERT_CHAT_THREAD",
      threadId,
      messages: newMessages,
      name: autoName,
    });
    setInput("");
    setLoading(true);
    setStreamText("");
    setReasoningText("");

    const sysPrompt = buildSystemPrompt();
    // Serialise prior turns into a single prompt — callGenerateStream takes
    // {prompt, systemPrompt}, so we flatten the chat history into the prompt
    // body with simple role tags. The system prompt carries persona + context.
    const userPrompt = newMessages
      .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
      .join("\n\n");
    const reasoningBudget = resolveReasoningBudget(state.activeNarrative);
    const websearch = resolveWebsearch(state.activeNarrative);
    const start = performance.now();

    let reasoningAcc = "";

    try {
      const full = await callGenerateStream(
        userPrompt,
        sysPrompt,
        (tok) => setStreamText((prev) => prev + tok),
        MAX_TOKENS_DEFAULT,
        "ChatPanel.send",
        DEFAULT_MODEL,
        reasoningBudget,
        (tok) => {
          reasoningAcc += tok;
          setReasoningText((prev) => prev + tok);
        },
        undefined,
        websearch,
      );
      const durationMs = Math.round(performance.now() - start);
      dispatch({
        type: "UPSERT_CHAT_THREAD",
        threadId,
        messages: [
          ...newMessages,
          {
            role: "assistant",
            content: full,
            reasoning: reasoningAcc || undefined,
            durationMs,
          },
        ],
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      dispatch({
        type: "UPSERT_CHAT_THREAD",
        threadId,
        messages: [
          ...newMessages,
          { role: "assistant", content: `Error: ${message}` },
        ],
      });
    } finally {
      setLoading(false);
      setStreamText("");
      setReasoningText("");
    }
  }, [
    input,
    loading,
    messages,
    buildSystemPrompt,
    ensureThread,
    state.activeNarrative,
    dispatch,
  ]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  if (access.userApiKeys && !access.hasOpenRouterKey) {
    return (
      <div className="flex h-full items-center justify-center flex-col gap-2">
        <p className="text-xs text-text-dim">
          Add an API key to start chatting
        </p>
        <button
          onClick={() => window.dispatchEvent(new Event("open-api-keys"))}
          className="text-[11px] px-3 py-1.5 rounded bg-accent/20 text-accent hover:bg-accent/30 transition-colors"
        >
          Add API Key
        </button>
      </div>
    );
  }

  if (!state.activeNarrative) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-text-dim">Open a world view to start</p>
      </div>
    );
  }

  const sortedThreads = useMemo(() => {
    const all = Object.values(state.activeNarrative?.chatThreads ?? {});
    all.sort((a, b) => b.updatedAt - a.updatedAt);
    return all;
  }, [state.activeNarrative?.chatThreads]);

  function recencyGroup(ts: number): string {
    const diff = Date.now() - ts;
    const day = 86400000;
    if (diff < day) return "Today";
    if (diff < 2 * day) return "Yesterday";
    if (diff < 7 * day) return "This Week";
    return "Older";
  }

  function createNewThread() {
    const id = crypto.randomUUID();
    const now = Date.now();
    dispatch({
      type: "CREATE_CHAT_THREAD",
      thread: {
        id,
        name: "New thread",
        messages: [],
        createdAt: now,
        updatedAt: now,
      },
    });
    setThreadPickerOpen(false);
  }

  // Estimate token count for the full prompt (system + messages)
  const systemPrompt = buildSystemPrompt();
  const messagesText = messages.map((m) => m.content).join("");
  const estimatedChars = systemPrompt.length + messagesText.length;
  const estimatedTokens = Math.round(estimatedChars / 4);
  const tokenLabel =
    estimatedTokens >= 1000
      ? `~${(estimatedTokens / 1000).toFixed(0)}k tokens`
      : `~${estimatedTokens} tokens`;

  return (
    <div className="flex flex-col h-full">
      {/* Thread header */}
      <div
        className="shrink-0 border-b border-border px-3 py-2 flex items-center gap-2 relative"
        ref={threadPickerRef}
      >
        <button
          onClick={() => setThreadPickerOpen((o) => !o)}
          className="flex-1 flex items-center gap-1.5 min-w-0 group"
        >
          <span className="text-[11px] font-medium text-text-secondary truncate group-hover:text-text-primary transition-colors">
            {activeThread ? activeThread.name : "No thread"}
          </span>
          <IconChevronDown
            size={10}
            className={`shrink-0 text-text-dim transition-transform ${threadPickerOpen ? "rotate-180" : ""}`}
          />
        </button>
        <button
          onClick={createNewThread}
          title="New thread"
          className="shrink-0 w-5 h-5 flex items-center justify-center rounded text-text-dim hover:text-text-primary hover:bg-white/8 transition-colors text-sm"
        >
          +
        </button>

        {threadPickerOpen && (
          <div className="absolute top-full left-0 right-0 z-50 rounded-b-xl glass overflow-hidden">
            <div className="max-h-64 overflow-y-auto py-1">
              {sortedThreads.length === 0 ? (
                <p className="text-xs text-text-dim px-3 py-3 text-center">
                  No threads yet
                </p>
              ) : (
                ["Today", "Yesterday", "This Week", "Earlier"].flatMap(
                  (group) => {
                    const items = sortedThreads.filter(
                      (t) => recencyGroup(t.updatedAt) === group,
                    );
                    if (items.length === 0) return [];
                    return [
                      <div key={`hdr-${group}`} className="px-3 pt-2 pb-0.5">
                        <span className="text-[9px] font-semibold uppercase tracking-widest text-text-dim">
                          {group}
                        </span>
                      </div>,
                      ...items.map((thread) => {
                        const isActive = state.viewState.activeChatThreadId === thread.id;
                        const isRenaming = renamingThreadId === thread.id;
                        return (
                          <div
                            key={thread.id}
                            className={`mx-1.5 rounded-lg ${isActive ? "bg-white/8" : ""}`}
                          >
                            {isRenaming ? (
                              <div className="px-2 py-1.5">
                                <input
                                  autoFocus
                                  value={renameValue}
                                  onChange={(e) =>
                                    setRenameValue(e.target.value)
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      dispatch({
                                        type: "RENAME_CHAT_THREAD",
                                        threadId: thread.id,
                                        name: renameValue.trim() || thread.name,
                                      });
                                      setRenamingThreadId(null);
                                    } else if (e.key === "Escape") {
                                      setRenamingThreadId(null);
                                    }
                                  }}
                                  onBlur={() => {
                                    dispatch({
                                      type: "RENAME_CHAT_THREAD",
                                      threadId: thread.id,
                                      name: renameValue.trim() || thread.name,
                                    });
                                    setRenamingThreadId(null);
                                  }}
                                  className="w-full bg-white/8 border border-white/15 rounded px-2 py-1 text-xs text-text-primary outline-none"
                                />
                              </div>
                            ) : (
                              <div className="flex items-center group/row">
                                <button
                                  onClick={() => {
                                    dispatch({
                                      type: "SET_ACTIVE_CHAT_THREAD",
                                      threadId: thread.id,
                                    });
                                    setThreadPickerOpen(false);
                                  }}
                                  className="flex-1 text-left px-3 py-1.5 min-w-0"
                                >
                                  <div
                                    className={`text-[11px] truncate ${isActive ? "text-text-primary" : "text-text-secondary"}`}
                                  >
                                    {thread.name}
                                  </div>
                                  <div className="text-[9px] text-text-dim">
                                    {thread.messages.length} msg
                                    {thread.messages.length !== 1 ? "s" : ""}
                                  </div>
                                </button>
                                <div className="flex items-center gap-0.5 mr-1.5 opacity-0 group-hover/row:opacity-100 transition-opacity">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setRenamingThreadId(thread.id);
                                      setRenameValue(thread.name);
                                    }}
                                    className="p-1 rounded text-text-dim hover:text-text-secondary hover:bg-white/8 transition-colors"
                                    title="Rename"
                                  >
                                    <IconEdit size={9} />
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      dispatch({
                                        type: "DELETE_CHAT_THREAD",
                                        threadId: thread.id,
                                      });
                                    }}
                                    className="p-1 rounded text-text-dim hover:text-fate hover:bg-white/8 transition-colors"
                                    title="Delete"
                                  >
                                    <IconTrash size={9} />
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      }),
                    ];
                  },
                )
              )}
            </div>
          </div>
        )}
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto px-3 py-2 space-y-3 min-h-0"
      >
        {activePersona && (
          <div className="rounded-md border border-accent/30 bg-accent/5 px-2.5 py-1.5 text-[10px] text-accent/80">
            {activePersona.kind === "fate" ? (
              <>
                Speaking as{" "}
                <span className="font-semibold text-accent">Fate</span>
                . The sum of every thread in this narrative — what remains
                owed, what has been paid.
              </>
            ) : activePersona.kind === "system" ? (
              <>
                Speaking as{" "}
                <span className="font-semibold text-accent">System</span>
                . The coalesced logic of this world — every rule, principle,
                and constraint.
              </>
            ) : activePersona.kind === "location" ? (
              <>
                Speaking as{" "}
                <span className="font-semibold text-accent">
                  {activePersona.name}
                </span>
                . The place itself — what its ground has witnessed, who passes
                through, what the air still carries.
              </>
            ) : activePersona.kind === "artifact" ? (
              <>
                Speaking as{" "}
                <span className="font-semibold text-accent">
                  {activePersona.name}
                </span>
                . The object itself — its provenance, its use, the hands that
                have wielded it.
              </>
            ) : (
              <>
                In character as{" "}
                <span className="font-semibold text-accent">
                  {activePersona.name}
                </span>
                . Their inner continuity shapes their voice — but the natural
                filters are on. Guarded with strangers, warmer with trust.
              </>
            )}
          </div>
        )}
        {messages.length === 0 && !activePersona && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center">
            <p className="text-sm text-text-secondary font-medium mb-1">
              World View Q&A
            </p>
            <p className="text-[11px] text-text-dim mb-2">
              Ask anything about your world view so far
            </p>
            <div className="flex flex-wrap gap-1 justify-center max-w-55">
              {[
                "Active threads?",
                "Next scene idea",
                "Character dynamics",
                "Plot holes?",
              ].map((q) => (
                <button
                  key={q}
                  onClick={() => {
                    setInput(q);
                    inputRef.current?.focus();
                  }}
                  className="text-[10px] px-2 py-1 rounded-full border border-border text-text-dim hover:text-text-secondary hover:border-white/20 transition-colors"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.length === 0 && activePersona && (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-center mt-4">
            <p className="text-xs text-text-dim max-w-60">
              {activePersona.kind === "fate"
                ? "Ask Fate what remains open, what must resolve, what has been paid."
                : activePersona.kind === "system"
                  ? "Ask System how the world works — what is possible, what is not, what enables what."
                  : activePersona.kind === "location"
                    ? `Ask ${activePersona.name} what it has seen, who walks it, what it remembers.`
                    : activePersona.kind === "artifact"
                      ? `Ask ${activePersona.name} about its making, its history, the hands that have held it.`
                      : `Say something to ${activePersona.name}. They answer from who they are, with their natural filters on.`}
            </p>
          </div>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div className="max-w-[85%] flex flex-col gap-1.5">
              {msg.role === "assistant" && msg.reasoning && (
                <ReasoningCollapsed text={msg.reasoning} durationMs={msg.durationMs} />
              )}
              <div
                className={`rounded-lg px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap ${
                  msg.role === "user"
                    ? "bg-accent/20 text-text-primary"
                    : "bg-white/5 text-text-secondary"
                }`}
              >
                <FormattedMessage text={msg.content} />
              </div>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="max-w-[85%] flex flex-col gap-1.5">
              {reasoningText && (
                <ReasoningInline text={reasoningText} active={!streamText} />
              )}
              {/* Only render the answer bubble once we have answer tokens, OR
                  when there's no reasoning at all (the dots placeholder is
                  the only signal that work is happening). Avoids an empty
                  bubble appearing alongside the reasoning stream. */}
              {streamText ? (
                <div className="bg-white/5 rounded-lg px-3 py-2 text-xs text-text-secondary leading-relaxed whitespace-pre-wrap">
                  {streamText}
                </div>
              ) : !reasoningText ? (
                <div className="bg-white/5 rounded-lg px-3 py-2 text-xs text-text-dim">
                  <span className="inline-flex gap-1">
                    <span className="animate-pulse">.</span>
                    <span
                      className="animate-pulse"
                      style={{ animationDelay: "0.2s" }}
                    >
                      .
                    </span>
                    <span
                      className="animate-pulse"
                      style={{ animationDelay: "0.4s" }}
                    >
                      .
                    </span>
                  </span>
                </div>
              ) : null}
            </div>
          </div>
        )}
      </div>

      {/* Input + persona + context mode */}
      <div className="shrink-0 border-t border-border p-2 space-y-1.5">
        {/* Persona + context mode row */}
        <div
          className="flex items-center gap-2 relative"
          ref={personaPickerRef}
        >
          <button
            onClick={() => setPersonaPickerOpen((o) => !o)}
            className={`flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md border transition-colors ${
              activePersona
                ? "border-accent/50 bg-accent/10 text-accent"
                : "border-border text-text-dim hover:text-text-secondary"
            }`}
            title={
              activePersona
                ? `In character as ${activePersona.name}`
                : "Choose who you're talking to"
            }
          >
            <span className="truncate max-w-32">
              {activePersona ? activePersona.name : "Assistant"}
            </span>
            <IconChevronDown
              size={9}
              className={`shrink-0 transition-transform ${personaPickerOpen ? "rotate-180" : ""}`}
            />
          </button>

          {!activePersona && (() => {
            // Compass is offered only when the currently-viewed scene's
            // arc carries a Compass cohort — hidden for world commits
            // and arcs that haven't had Compass generated.
            const compassAvailable = !!state.activeNarrative
              && hasCompassScenarios(state.activeNarrative, state.resolvedEntryKeys, contextSceneIndex);
            const modeAvailable = !!state.activeNarrative && hasMode(state.activeNarrative);
            const investigationAvailable = !!state.activeNarrative
              && hasInvestigation(state.activeNarrative, state.resolvedEntryKeys, contextSceneIndex);
            const gameTheoryAvailable = !!state.activeNarrative
              && hasGameTheory(state.activeNarrative, state.resolvedEntryKeys, contextSceneIndex);
            const modes: Array<{
              value: "narrative" | "outline" | "scene" | "compass" | "mode" | "investigation" | "game-theory";
              label: string;
              hint: string;
            }> = [
              { value: "narrative", label: "Narrative", hint: "Full tiered branch state up to the current scene." },
              { value: "outline",   label: "Outline",   hint: "Condensed arc-by-arc recap." },
              { value: "scene",     label: "Scene",     hint: "Scene-level deltas + immediate context." },
            ];
            if (compassAvailable) {
              modes.push({
                value: "compass",
                label: "Compass",
                hint: "Cohort of feasible next directions with logits + softmax probabilities — precision prediction in simulation, recommendation otherwise.",
              });
            }
            if (modeAvailable) {
              modes.push({
                value: "mode",
                label: "Mode",
                hint: "Active Phase Reasoning Graph — the META machinery of the world.",
              });
            }
            if (investigationAvailable) {
              modes.push({
                value: "investigation",
                label: "Investigation",
                hint: "Active per-arc Causal Reasoning Graph — in-arc inference.",
              });
            }
            if (gameTheoryAvailable) {
              modes.push({
                value: "game-theory",
                label: "Game theory",
                hint: "Outline enriched with per-scene game decompositions + ELO rankings.",
              });
            }
            // If the user had Compass / Mode / Investigation / Game theory
            // selected and it's no longer available (world commit, active
            // PRG cleared, navigated to an arc without investigations or
            // games), drop back to narrative on next render.
            if (contextMode === "compass" && !compassAvailable) {
              setContextMode("narrative");
            }
            if (contextMode === "mode" && !modeAvailable) {
              setContextMode("narrative");
            }
            if (contextMode === "investigation" && !investigationAvailable) {
              setContextMode("narrative");
            }
            if (contextMode === "game-theory" && !gameTheoryAvailable) {
              setContextMode("narrative");
            }
            const currentLabel = modes.find((m) => m.value === contextMode)?.label
              ?? "Narrative";
            return (
              <div className="relative" ref={contextPickerRef}>
                <button
                  onClick={() => setContextPickerOpen((o) => !o)}
                  className="flex items-center gap-1 text-[10px] font-medium px-2 py-1 rounded-md border border-border text-text-dim hover:text-text-secondary transition-colors"
                  title="Context mode for the assistant"
                >
                  <span className="truncate">{currentLabel}</span>
                  <IconChevronDown
                    size={9}
                    className={`shrink-0 transition-transform ${contextPickerOpen ? "rotate-180" : ""}`}
                  />
                </button>
                {contextPickerOpen && (
                  <div className="absolute bottom-full left-0 mb-1 z-50 rounded-lg glass overflow-hidden min-w-56">
                    <div className="py-1.5">
                      {modes.map((m) => (
                        <button
                          key={m.value}
                          onClick={() => {
                            setContextMode(m.value);
                            setContextPickerOpen(false);
                          }}
                          className={`w-full text-left px-3 py-1.5 transition-colors ${
                            contextMode === m.value
                              ? "bg-white/8 text-text-primary"
                              : "text-text-secondary hover:bg-white/5"
                          }`}
                        >
                          <div className="text-[11px] font-medium">{m.label}</div>
                          <div className="text-[9px] text-text-dim/70 leading-snug mt-0.5">{m.hint}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          <p className="text-[10px] text-text-dim truncate flex-1 opacity-60 text-right">
            {tokenLabel}
          </p>

          {personaPickerOpen && (
            <div className="absolute bottom-full left-0 mb-1 z-50 rounded-lg glass overflow-hidden min-w-60">
              <div className="max-h-80 overflow-y-auto py-1.5">
                <button
                  onClick={() => {
                    setPersonaId(null);
                    setPersonaPickerOpen(false);
                  }}
                  className={`w-full text-left px-3 py-1.5 text-[11px] transition-colors ${
                    !activePersona
                      ? "bg-white/8 text-text-primary"
                      : "text-text-secondary hover:bg-white/5"
                  }`}
                >
                  <div className="font-medium">Assistant</div>
                  <div className="text-[9px] text-text-dim">
                    World view consultant — full context
                  </div>
                </button>
                {personaSections.map((section) => (
                  <div key={section.title} className="mt-1">
                    <div className="px-3 pt-2 pb-1">
                      <span className="text-[9px] font-semibold uppercase tracking-widest text-text-dim">
                        {section.title}
                      </span>
                    </div>
                    {section.items.map((item) => {
                      const isActive = personaId === item.id;
                      return (
                        <button
                          key={item.id}
                          onClick={() => {
                            setPersonaId(item.id);
                            setPersonaPickerOpen(false);
                          }}
                          className={`w-full text-left px-3 py-1.5 text-[11px] transition-colors ${
                            isActive
                              ? "bg-accent/15 text-accent"
                              : "text-text-secondary hover:bg-white/5"
                          }`}
                        >
                          <div className="font-medium truncate">
                            {item.name}
                          </div>
                          <div className="text-[9px] text-text-dim capitalize">
                            {item.subtitle}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything..."
            rows={1}
            className="flex-1 bg-white/5 border border-border rounded-lg px-3 py-2 text-xs text-text-primary placeholder:text-text-dim resize-none focus:outline-none focus:border-white/20 transition-colors"
            style={{ maxHeight: 80 }}
          />
          <button
            onClick={send}
            disabled={!input.trim() || loading}
            className="shrink-0 w-7 h-7 flex items-center justify-center rounded-lg bg-accent/20 text-accent hover:bg-accent/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <IconSend size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}
