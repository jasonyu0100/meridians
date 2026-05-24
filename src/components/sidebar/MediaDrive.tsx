'use client';

import { useMemo, useState, useCallback, useRef } from 'react';
import { useStore } from '@/lib/store';
import { useImageUrl } from '@/hooks/useAssetUrl';
import { resolveEntry } from '@/types/narrative';
import { apiHeaders } from '@/lib/api-headers';
import { logApiCall, updateApiLog } from '@/lib/api-logger';
import { useFeatureAccess } from '@/hooks/useFeatureAccess';
import { assetManager } from '@/lib/asset-manager';
import MediaPreview from '@/components/sidebar/MediaPreview';
import { IconSpinner, IconImage, IconSettings } from '@/components/icons';
import type { MediaItem } from '@/components/sidebar/MediaPreview';
import type { Scene, Character, Location, Artifact, ImageRef } from '@/types/narrative';

type AssetTab = 'characters' | 'locations' | 'artifacts';

type BatchItem =
  | { kind: 'character'; char: Character }
  | { kind: 'location'; loc: Location }
  | { kind: 'artifact'; artifact: Artifact };

type BatchPreset = {
  key: string;
  label: string;
  items: BatchItem[];
};

type BatchState = {
  label: string;
  total: number;
  completed: number;
};

// Sliding window — N workers pull from a shared queue until empty.
// Matches PROSE_CONCURRENCY; Replicate handles its own rate limiting.
const BATCH_CONCURRENCY = 10;

async function generateImage(
  type: 'character' | 'location' | 'artifact',
  payload: Record<string, unknown>,
  narrativeId: string,
): Promise<{ imageUrl: string }> {
  const body = JSON.stringify({ type, ...payload });
  const logId = logApiCall(`MediaDrive.generateImage(${type})`, body.length, body, 'replicate/seedream-4.5');
  const start = performance.now();

  try {
    const res = await fetch('/api/generate-image', {
      method: 'POST',
      headers: apiHeaders(),
      body,
    });
    if (!res.ok) {
      const err = await res.json();
      const message = err.error || 'Image generation failed';
      updateApiLog(logId, { status: 'error', error: message, durationMs: Math.round(performance.now() - start) });
      throw new Error(message);
    }
    const data = await res.json();

    // Download the image from Replicate and store in IndexedDB
    const replicateUrl = data.imageUrl;
    const imgRes = await fetch(replicateUrl);
    if (!imgRes.ok) throw new Error('Failed to download generated image');

    const blob = await imgRes.blob();
    const assetId = await assetManager.storeImage(blob, blob.type, undefined, narrativeId);

    updateApiLog(logId, { status: 'success', durationMs: Math.round(performance.now() - start), responsePreview: `image stored (${assetId})` });
    return { imageUrl: assetId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateApiLog(logId, { status: 'error', error: message, durationMs: Math.round(performance.now() - start) });
    throw err;
  }
}

function Spinner() {
  return (
    <IconSpinner size={10} className="animate-spin" />
  );
}

function GenerateButton({ onClick, disabled, generating }: { onClick: () => void; disabled: boolean; generating: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="shrink-0 w-6 h-6 flex items-center justify-center rounded bg-white/6 text-text-dim hover:text-accent hover:bg-accent/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      title="Generate image"
    >
      {generating ? <Spinner /> : (
        <IconImage size={10} />
      )}
    </button>
  );
}

function ThumbnailImage({ imageRef, alt, className }: { imageRef: ImageRef; alt: string; className: string }) {
  const resolvedUrl = useImageUrl(imageRef);
  if (!resolvedUrl) return null;
  return <img src={resolvedUrl} alt={alt} className={className} />;
}

export default function MediaDrive() {
  const { state, dispatch } = useStore();
  const access = useFeatureAccess();
  const narrative = state.activeNarrative;
  const [tab, setTab] = useState<AssetTab>('characters');
  const [generating, setGenerating] = useState<string | null>(null);
  const [showStyleEditor, setShowStyleEditor] = useState(false);
  const [styleDraft, setStyleDraft] = useState(narrative?.imageStyle ?? '');
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [batchState, setBatchState] = useState<BatchState | null>(null);
  const batchCancelRef = useRef(false);
  const batchBusy = batchState !== null;

  const characters = useMemo(() => {
    if (!narrative) return [];
    return Object.values(narrative.characters).sort((a, b) => {
      const roleOrder = { anchor: 0, recurring: 1, transient: 2 };
      return (roleOrder[a.role] ?? 3) - (roleOrder[b.role] ?? 3);
    });
  }, [narrative]);

  const locations = useMemo(() => {
    if (!narrative) return [];
    return Object.values(narrative.locations);
  }, [narrative]);

  const artifacts = useMemo(() => {
    if (!narrative) return [];
    return Object.values(narrative.artifacts ?? {});
  }, [narrative]);

  // Scenes (resolved up to head) — used to derive POV / "in scenes" filters
  // for the batch presets below. Not rendered directly.
  const scenes = useMemo(() => {
    if (!narrative) return [];
    const keys = state.resolvedEntryKeys.slice(0, state.viewState.currentSceneIndex + 1);
    return keys
      .map((k) => resolveEntry(narrative, k))
      .filter((e): e is Scene => e?.kind === 'scene');
  }, [narrative, state.resolvedEntryKeys, state.viewState.currentSceneIndex]);

  // Batch presets — filter options per tab. Each preset shows a count, so
  // the user sees the scope before starting. Presets with zero items are
  // filtered out at render time.
  const batchPresets = useMemo((): BatchPreset[] => {
    if (!narrative) return [];

    if (tab === 'characters') {
      const missing = characters.filter((c) => !c.imageUrl);
      const povIds = new Set(scenes.map((s) => s.povId).filter(Boolean));
      const participantIds = new Set<string>();
      for (const s of scenes) for (const id of s.participantIds) participantIds.add(id);
      return [
        { key: 'pov', label: 'POV', items: missing.filter((c) => povIds.has(c.id)).map((c) => ({ kind: 'character', char: c })) },
        { key: 'used', label: 'In scenes', items: missing.filter((c) => participantIds.has(c.id)).map((c) => ({ kind: 'character', char: c })) },
        { key: 'all', label: 'All', items: missing.map((c) => ({ kind: 'character', char: c })) },
      ];
    }

    if (tab === 'locations') {
      const missing = locations.filter((l) => !l.imageUrl);
      const usedIds = new Set(scenes.map((s) => s.locationId).filter(Boolean));
      return [
        { key: 'used', label: 'In scenes', items: missing.filter((l) => usedIds.has(l.id)).map((l) => ({ kind: 'location', loc: l })) },
        { key: 'all', label: 'All', items: missing.map((l) => ({ kind: 'location', loc: l })) },
      ];
    }

    // artifacts
    const missing = artifacts.filter((a) => !a.imageUrl);
    const usedIds = new Set<string>();
    for (const s of scenes) {
      for (const u of s.artifactUsages ?? []) usedIds.add(u.artifactId);
    }
    return [
      { key: 'used', label: 'In scenes', items: missing.filter((a) => usedIds.has(a.id)).map((a) => ({ kind: 'artifact', artifact: a })) },
      { key: 'key', label: 'Key only', items: missing.filter((a) => a.significance === 'key').map((a) => ({ kind: 'artifact', artifact: a })) },
      { key: 'all', label: 'All', items: missing.map((a) => ({ kind: 'artifact', artifact: a })) },
    ];
  }, [tab, narrative, characters, locations, artifacts, scenes]);

  // Build preview items for current tab (only items with images)
  const previewItems = useMemo((): MediaItem[] => {
    if (tab === 'characters') {
      return characters.filter((c) => c.imageUrl).map((c) => ({
        id: c.id,
        imageUrl: c.imageUrl!,
        label: c.name,
        sublabel: c.role,
        prompt: c.imagePrompt,
        aspectClass: 'aspect-[3/4]',
      }));
    }
    if (tab === 'locations') {
      return locations.filter((l) => l.imageUrl).map((l) => {
        // Always lead with the prominence label (domain / place / margin)
        // — same shape as characters' role + artifacts' significance.
        // Parent location, when present, follows as a secondary clause.
        const parentName = l.parentId ? narrative?.locations[l.parentId]?.name : undefined;
        const sublabel = parentName ? `${l.prominence} · in ${parentName}` : l.prominence;
        return {
          id: l.id,
          imageUrl: l.imageUrl!,
          label: l.name,
          sublabel,
          prompt: l.imagePrompt,
          aspectClass: 'aspect-video',
        };
      });
    }
    // artifacts
    return artifacts.filter((a) => a.imageUrl).map((a) => ({
      id: a.id,
      imageUrl: a.imageUrl!,
      label: a.name,
      sublabel: a.significance,
      prompt: a.imagePrompt,
      aspectClass: 'aspect-square',
    }));
  }, [tab, characters, locations, artifacts, narrative]);

  const openPreview = useCallback((id: string) => {
    const idx = previewItems.findIndex((item) => item.id === id);
    if (idx >= 0) setPreviewIndex(idx);
  }, [previewItems]);

  const requireKeys = useCallback(() => {
    if (access.userApiKeys && !access.hasReplicateKey) {
      window.dispatchEvent(new Event('open-api-keys'));
      return true;
    }
    return false;
  }, [access.userApiKeys, access.hasReplicateKey]);

  // ── Pure runners — dispatch on success, throw on failure. These have no
  // concurrency-control guards so the batch runner can drive them directly.
  // The single-call wrappers below add the generating-state guards for
  // click-driven use.

  const runCharacterGen = useCallback(async (char: Character): Promise<void> => {
    if (!narrative) return;
    const hints = Object.values(char.world.nodes).map((n) => `${n.type}: ${n.content}`);
    const { imageUrl } = await generateImage('character', {
      name: char.name,
      role: char.role,
      worldSummary: narrative.worldSummary,
      continuityHints: hints.slice(0, 5),
      imagePrompt: char.imagePrompt,
      imageStyle: narrative.imageStyle,
    }, narrative.id);
    dispatch({ type: 'SET_CHARACTER_IMAGE', characterId: char.id, imageUrl });
  }, [narrative, dispatch]);

  const runLocationGen = useCallback(async (loc: Location): Promise<void> => {
    if (!narrative) return;
    const parentName = loc.parentId ? narrative.locations[loc.parentId]?.name : undefined;
    const hints = Object.values(loc.world.nodes).map((n) => `${n.type}: ${n.content}`);
    const { imageUrl } = await generateImage('location', {
      name: loc.name,
      parentName,
      worldSummary: narrative.worldSummary,
      continuityHints: hints.slice(0, 5),
      imagePrompt: loc.imagePrompt,
      imageStyle: narrative.imageStyle,
    }, narrative.id);
    dispatch({ type: 'SET_LOCATION_IMAGE', locationId: loc.id, imageUrl });
  }, [narrative, dispatch]);

  const runArtifactGen = useCallback(async (artifact: Artifact): Promise<void> => {
    if (!narrative) return;
    const hints = Object.values(artifact.world.nodes).map((n) => `${n.type}: ${n.content}`);
    const ownerName = artifact.parentId
      ? (narrative.characters[artifact.parentId]?.name ?? narrative.locations[artifact.parentId]?.name ?? undefined)
      : undefined;
    const { imageUrl } = await generateImage('artifact', {
      name: artifact.name,
      significance: artifact.significance,
      ownerName,
      worldSummary: narrative.worldSummary,
      continuityHints: hints.slice(0, 5),
      imagePrompt: artifact.imagePrompt,
      imageStyle: narrative.imageStyle,
    }, narrative.id);
    dispatch({ type: 'SET_ARTIFACT_IMAGE', artifactId: artifact.id, imageUrl });
  }, [narrative, dispatch]);

  // ── Single-call wrappers (click-driven). Guard against overlapping work.

  const generateCharacterImage = useCallback(async (char: Character) => {
    if (!narrative || generating || batchBusy || requireKeys()) return;
    setGenerating(char.id);
    try { await runCharacterGen(char); }
    catch (err) { console.error('Failed to generate character image:', err); }
    finally { setGenerating(null); }
  }, [narrative, generating, batchBusy, requireKeys, runCharacterGen]);

  const generateLocationImage = useCallback(async (loc: Location) => {
    if (!narrative || generating || batchBusy || requireKeys()) return;
    setGenerating(loc.id);
    try { await runLocationGen(loc); }
    catch (err) { console.error('Failed to generate location image:', err); }
    finally { setGenerating(null); }
  }, [narrative, generating, batchBusy, requireKeys, runLocationGen]);

  const generateArtifactImage = useCallback(async (artifact: Artifact) => {
    if (!narrative || generating || batchBusy || requireKeys()) return;
    setGenerating(artifact.id);
    try { await runArtifactGen(artifact); }
    catch (err) { console.error('Failed to generate artifact image:', err); }
    finally { setGenerating(null); }
  }, [narrative, generating, batchBusy, requireKeys, runArtifactGen]);

  // ── Batch runner — bounded concurrency, cancellable mid-flight.

  const runBatch = useCallback(async (label: string, items: BatchItem[]) => {
    if (!narrative || batchBusy || generating || requireKeys()) return;
    if (items.length === 0) return;

    batchCancelRef.current = false;
    setBatchState({ label, total: items.length, completed: 0 });

    const queue = [...items];

    const worker = async () => {
      while (queue.length > 0) {
        if (batchCancelRef.current) return;
        const item = queue.shift();
        if (!item) return;
        try {
          if (item.kind === 'character') await runCharacterGen(item.char);
          else if (item.kind === 'location') await runLocationGen(item.loc);
          else await runArtifactGen(item.artifact);
        } catch (err) {
          console.error('Batch item failed:', err);
        }
        setBatchState((s) => (s ? { ...s, completed: s.completed + 1 } : null));
      }
    };

    const workers = Array.from(
      { length: Math.min(BATCH_CONCURRENCY, items.length) },
      () => worker(),
    );
    await Promise.allSettled(workers);
    setBatchState(null);
  }, [narrative, batchBusy, generating, requireKeys, runCharacterGen, runLocationGen, runArtifactGen]);

  const cancelBatch = useCallback(() => {
    batchCancelRef.current = true;
  }, []);

  if (!narrative) {
    return (
      <div className="flex-1 flex items-center justify-center px-3">
        <p className="text-xs text-text-dim text-center">Select a world view</p>
      </div>
    );
  }



  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Style settings */}
      <div className="shrink-0 border-b border-border">
        <button
          onClick={() => setShowStyleEditor(!showStyleEditor)}
          className="w-full flex items-center gap-1.5 px-2 py-1.5 text-[10px] text-text-dim hover:text-text-secondary transition-colors"
        >
          <IconSettings size={10} />
          <span className="flex-1 text-left truncate">
            {narrative.imageStyle ? `Style: ${narrative.imageStyle.slice(0, 30)}...` : 'Set image style'}
          </span>
          <span className="text-[8px]" style={{ transform: showStyleEditor ? 'rotate(180deg)' : 'none' }}>
            ▼
          </span>
        </button>
        {showStyleEditor && (
          <div className="px-2 pb-2 space-y-1">
            <textarea
              value={styleDraft}
              onChange={(e) => setStyleDraft(e.target.value)}
              placeholder="e.g. Dark medieval fantasy, gritty realism, muted palette, cinematic lighting, HBO-inspired"
              rows={3}
              className="w-full bg-white/5 border border-border rounded px-2 py-1.5 text-[10px] text-text-primary placeholder:text-text-dim resize-none focus:outline-none focus:border-white/20 transition-colors"
            />
            <button
              onClick={() => {
                dispatch({ type: 'SET_IMAGE_STYLE', style: styleDraft });
                setShowStyleEditor(false);
              }}
              className="text-[10px] px-2 py-0.5 rounded bg-accent/10 text-accent hover:bg-accent/20 transition-colors"
            >
              Save style
            </button>
          </div>
        )}
      </div>

      {/* Asset type tabs */}
      <div className="shrink-0 flex border-b border-border">
        {([
          ['characters', 'Characters'],
          ['locations', 'Locations'],
          ['artifacts', 'Artifacts'],
        ] as [AssetTab, string][]).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 px-1 py-1.5 text-[10px] font-medium transition-colors ${
              tab === key
                ? 'text-text-primary border-b border-accent'
                : 'text-text-dim hover:text-text-secondary'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Batch generation controls — filter chips when idle, progress + cancel when running */}
      {batchState ? (
        <div className="shrink-0 border-b border-border px-2 py-1.5">
          <div className="flex items-center gap-2">
            <Spinner />
            <p className="text-[10px] text-text-dim flex-1 truncate">
              {batchState.label} · {batchState.completed}/{batchState.total}
            </p>
            <button
              onClick={cancelBatch}
              className="text-[10px] text-text-dim hover:text-text-primary transition-colors"
              title="Stop after current items finish"
            >
              Cancel
            </button>
          </div>
          <div className="mt-1 h-0.5 w-full bg-white/6 rounded overflow-hidden">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${batchState.total > 0 ? (batchState.completed / batchState.total) * 100 : 0}%` }}
            />
          </div>
        </div>
      ) : (
        batchPresets.some((p) => p.items.length > 0) && (
          <div className="shrink-0 border-b border-border px-2 py-1.5 flex flex-wrap gap-1 items-center">
            <span className="text-[9px] uppercase tracking-wider text-text-dim/60 mr-1">
              Generate
            </span>
            {batchPresets.map((p) => p.items.length > 0 && (
              <button
                key={p.key}
                onClick={() => runBatch(`${p.label} (${tab})`, p.items)}
                disabled={generating !== null || batchBusy}
                className="text-[10px] px-1.5 py-0.5 rounded bg-white/6 text-text-secondary hover:bg-accent/20 hover:text-accent disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                title={`Generate ${p.items.length} missing ${tab}`}
              >
                {p.label} <span className="text-text-dim tabular-nums">{p.items.length}</span>
              </button>
            ))}
          </div>
        )
      )}

      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
        {/* ── Characters ── */}
        {tab === 'characters' && characters.map((char) => (
          <div key={char.id} className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-bg-elevated transition-colors">
            {char.imageUrl ? (
              <button onClick={() => openPreview(char.id)} className="shrink-0">
                <ThumbnailImage imageRef={char.imageUrl} alt={char.name} className="w-8 h-8 rounded-full object-cover border border-border hover:border-accent/50 transition-colors" />
              </button>
            ) : (
              <div className="w-8 h-8 rounded-full bg-white/6 shrink-0 flex items-center justify-center border border-border border-dashed">
                <span className="text-[10px] text-text-dim">{char.name[0]}</span>
              </div>
            )}
            <button
              onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'character', characterId: char.id } })}
              className="flex-1 text-left min-w-0"
            >
              <p className="text-xs text-text-primary truncate">{char.name}</p>
              <p className="text-[10px] text-text-dim">{char.role}</p>
            </button>
            <GenerateButton onClick={() => generateCharacterImage(char)} disabled={generating !== null || batchBusy} generating={generating === char.id} />
          </div>
        ))}

        {/* ── Locations ── */}
        {tab === 'locations' && locations.map((loc) => (
          <div key={loc.id} className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-bg-elevated transition-colors">
            {loc.imageUrl ? (
              <button onClick={() => openPreview(loc.id)} className="shrink-0">
                <ThumbnailImage imageRef={loc.imageUrl} alt={loc.name} className="w-8 h-8 rounded object-cover border border-border hover:border-accent/50 transition-colors" />
              </button>
            ) : (
              <div className="w-8 h-8 rounded bg-white/6 shrink-0 flex items-center justify-center border border-border border-dashed">
                <span className="text-[10px] text-text-dim">{loc.name[0]}</span>
              </div>
            )}
            <button
              onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'location', locationId: loc.id } })}
              className="flex-1 text-left min-w-0"
            >
              <p className="text-xs text-text-primary truncate">{loc.name}</p>
              {loc.parentId && narrative.locations[loc.parentId] && (
                <p className="text-[10px] text-text-dim truncate">in {narrative.locations[loc.parentId].name}</p>
              )}
            </button>
            <GenerateButton onClick={() => generateLocationImage(loc)} disabled={generating !== null || batchBusy} generating={generating === loc.id} />
          </div>
        ))}

        {/* ── Artifacts ── */}
        {tab === 'artifacts' && artifacts.map((artifact) => (
          <div key={artifact.id} className="flex items-center gap-2 rounded px-1.5 py-1 hover:bg-bg-elevated transition-colors">
            {artifact.imageUrl ? (
              <button onClick={() => openPreview(artifact.id)} className="shrink-0">
                <ThumbnailImage imageRef={artifact.imageUrl} alt={artifact.name} className="w-8 h-8 rounded object-cover border border-border hover:border-accent/50 transition-colors" />
              </button>
            ) : (
              <div className="w-8 h-8 rounded bg-white/6 shrink-0 flex items-center justify-center border border-border border-dashed">
                <span className="text-[10px] text-text-dim">{artifact.name[0]}</span>
              </div>
            )}
            <button
              onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'artifact', artifactId: artifact.id } })}
              className="flex-1 text-left min-w-0"
            >
              <p className="text-xs text-text-primary truncate">{artifact.name}</p>
              <p className="text-[10px] text-text-dim">{artifact.significance}</p>
            </button>
            <GenerateButton onClick={() => generateArtifactImage(artifact)} disabled={generating !== null || batchBusy} generating={generating === artifact.id} />
          </div>
        ))}
      </div>

      {previewIndex !== null && previewItems.length > 0 && (
        <MediaPreview
          items={previewItems}
          currentIndex={previewIndex}
          onNavigate={setPreviewIndex}
          onClose={() => setPreviewIndex(null)}
        />
      )}
    </div>
  );
}
