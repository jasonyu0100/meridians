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
import { IconSpinner, IconImage, IconSettings, IconMapPin, IconLocationPin, IconTrash } from '@/components/icons';
import type { MediaItem } from '@/components/sidebar/MediaPreview';
import type { Scene, Character, Location, Artifact, ImageRef, Board, MapEdge } from '@/types/narrative';
import {
  computeLocationClusters,
  clusterSignature,
  GLOBAL_MAP_ROOT,
  GLOBAL_MAP_TITLE,
  type LocationCluster,
} from '@/lib/location-clusters';
import { computeMapScope, buildMapScope } from '@/lib/map-layout';
import { BoardAnnotator } from '@/components/sidebar/BoardAnnotator';
import { HierarchyModal } from '@/components/sidebar/HierarchyModal';

type AssetTab = 'characters' | 'locations' | 'artifacts' | 'maps';

type BatchItem =
  | { kind: 'character'; char: Character }
  | { kind: 'location'; loc: Location }
  | { kind: 'artifact'; artifact: Artifact }
  | { kind: 'map'; rootId: string };

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
  type: 'character' | 'location' | 'artifact' | 'map',
  payload: Record<string, unknown>,
  narrativeId: string,
): Promise<{ imageUrl: string; visualPrompt?: string }> {
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

    // Surface the REAL image-gen prompts the route built (the request body alone
    // hides them): System tab = the image-gen system prompt + cartographer user
    // prompt; Response tab = the final prompt actually sent to the image model.
    const systemPromptPreview = [
      data.systemPrompt && `=== IMAGE-GEN SYSTEM PROMPT ===\n${data.systemPrompt}`,
      data.userPrompt && `=== CARTOGRAPHER USER PROMPT ===\n${data.userPrompt}`,
    ].filter(Boolean).join('\n\n') || undefined;
    const responsePreview = data.finalPrompt
      ? `=== FINAL IMAGE PROMPT (→ image model${data.mapView ? `, view: ${data.mapView}` : ''}) ===\n${data.finalPrompt}\n\n→ image stored (${assetId})`
      : `image stored (${assetId})`;

    updateApiLog(logId, { status: 'success', durationMs: Math.round(performance.now() - start), systemPromptPreview, responsePreview });
    return { imageUrl: assetId, visualPrompt: data.visualPrompt };
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
  // The map currently open in the drag-drop label annotator (null = closed).
  const [annotateMap, setAnnotateMap] = useState<Board | null>(null);
  const [batchState, setBatchState] = useState<BatchState | null>(null);
  const batchCancelRef = useRef(false);
  const batchBusy = batchState !== null;
  // Rebuild-hierarchy modal (AI re-parents every location into a balanced map
  // tree; streams reasoning + a review/edit step before applying).
  const [showHierarchy, setShowHierarchy] = useState(false);

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

  // Location clusters — connected components of the location parent/child
  // graph. Each is a map candidate; size ≥ 2 (a lone location is not a map).
  const clusters = useMemo<LocationCluster[]>(() => {
    if (!narrative) return [];
    return computeLocationClusters(narrative.locations);
  }, [narrative]);

  // Candidate map roots — any location with at least one child can anchor a
  // map. Cluster roots come first (the natural top-level territories), then
  // the rest, so the picker reads top-down.
  const mapParents = useMemo<Location[]>(() => {
    const withChild = new Set<string>();
    for (const l of locations) if (l.parentId) withChild.add(l.parentId);
    const clusterRoots = new Set(clusters.map((c) => c.rootId));
    return locations
      .filter((l) => withChild.has(l.id))
      .sort((a, b) =>
        (clusterRoots.has(b.id) ? 1 : 0) - (clusterRoots.has(a.id) ? 1 : 0)
        || a.name.localeCompare(b.name));
  }, [locations, clusters]);


  // Saved maps, newest first. A map is keyed by its root location.
  const savedMaps = useMemo<Board[]>(() => {
    if (!narrative?.boards) return [];
    return Object.values(narrative.boards).sort((a, b) => b.updatedAt - a.updatedAt);
  }, [narrative]);

  // Top-level (parentless) locations = the sub-regions of the GLOBAL map and the
  // natural top-level territories of the map tree. The Global map only makes
  // sense with ≥2 of them (a single root IS its own top map — Global would just
  // duplicate it).
  const topLevelLocs = useMemo<Location[]>(() => {
    if (!narrative) return [];
    return locations.filter((l) => !l.parentId || !narrative.locations[l.parentId]);
  }, [narrative, locations]);
  const showGlobal = topLevelLocs.length >= 2;
  const globalMap = useMemo(
    () => savedMaps.find((m) => m.rootLocationId === GLOBAL_MAP_ROOT),
    [savedMaps],
  );

  // A saved map is outdated when its parent's direct children (maps are one
  // layer deep) no longer match the snapshot it was generated from — i.e. a
  // child was added or removed under the parent.
  const savedMapStatus = useCallback((map: Board): 'current' | 'outdated' => {
    if (!narrative) return 'current';
    // The Global map's membership is every top-level location, not a subtree.
    const current = map.rootLocationId === GLOBAL_MAP_ROOT
      ? clusterSignature(
          Object.values(narrative.locations)
            .filter((l) => !l.parentId || !narrative.locations[l.parentId])
            .map((l) => l.id),
        )
      : clusterSignature(computeMapScope(narrative.locations, map.rootLocationId, 1));
    return current === map.signature ? 'current' : 'outdated';
  }, [narrative]);

  // Every possible 1-depth map = each parent territory (a location with
  // children) joined to its saved map and live status. Walked in LOCATION-TREE
  // order so the list mirrors the map hierarchy: top-level (parentless) maps
  // first, each child map listed under its parent. `depth` is the map-tree
  // depth (number of ancestor maps), surfaced as a D0/D1/… badge per row. A
  // parent is a map and also a sub-region inside its own parent's map.
  const mapRows = useMemo(() => {
    if (!narrative) return [];
    const childrenOf = new Map<string, Location[]>();
    for (const l of locations) {
      if (!l.parentId) continue;
      const b = childrenOf.get(l.parentId);
      if (b) b.push(l);
      else childrenOf.set(l.parentId, [l]);
    }
    const byName = (a: Location, b: Location) => a.name.localeCompare(b.name);
    const roots = locations
      .filter((l) => !l.parentId || !narrative.locations[l.parentId])
      .sort(byName);
    const rows: {
      parent: Location;
      childCount: number;
      depth: number;
      map: Board | undefined;
      status: 'current' | 'outdated' | null;
    }[] = [];
    const seen = new Set<string>();
    const visit = (loc: Location, depth: number) => {
      if (seen.has(loc.id)) return; // defensive against cycles
      seen.add(loc.id);
      const kids = childrenOf.get(loc.id) ?? [];
      const isMap = kids.length > 0;
      if (isMap) {
        const map = savedMaps.find((m) => m.rootLocationId === loc.id);
        rows.push({ parent: loc, childCount: kids.length, depth, map, status: map ? savedMapStatus(map) : null });
      }
      for (const k of [...kids].sort(byName)) visit(k, isMap ? depth + 1 : depth);
    };
    // When a Global map sits above them (≥2 top-level locations), the natural
    // top-level territories are sub-regions of Global, so they indent one tier.
    const base = roots.length >= 2 ? 1 : 0;
    for (const r of roots) visit(r, base);
    // Sort by map-tree depth ascending (D0/D1/D2…). Stable sort keeps the
    // location-tree order within each depth tier.
    return rows.sort((a, b) => a.depth - b.depth);
  }, [narrative, locations, savedMaps, savedMapStatus]);

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

    if (tab === 'maps') {
      // Every map in ascending map-tree depth (D0 Global first, then mapRows
      // which are already depth-sorted) so a batch fills in top-to-bottom.
      const all: { rootId: string; depth: number; status: 'current' | 'outdated' | null }[] = [];
      if (showGlobal) all.push({ rootId: GLOBAL_MAP_ROOT, depth: 0, status: globalMap ? savedMapStatus(globalMap) : null });
      for (const r of mapRows) all.push({ rootId: r.parent.id, depth: r.depth, status: r.status });
      const toItems = (rows: typeof all): BatchItem[] => rows.map((m) => ({ kind: 'map', rootId: m.rootId }));
      const depths = [...new Set(all.map((m) => m.depth))].sort((a, b) => a - b);
      return [
        { key: 'missing', label: 'Missing', items: toItems(all.filter((m) => m.status === null)) },
        { key: 'outdated', label: 'Outdated', items: toItems(all.filter((m) => m.status === 'outdated')) },
        { key: 'all', label: 'All', items: toItems(all) },
        // Per-depth tiers so the operator can generate one level at a time.
        ...depths.map((d) => ({ key: `d${d}`, label: `Depth ${d}`, items: toItems(all.filter((m) => m.depth === d)) })),
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
  }, [tab, narrative, characters, locations, artifacts, scenes, mapRows, showGlobal, globalMap, savedMapStatus]);

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
    if (tab === 'maps') {
      return savedMaps
        .filter((m) => m.imageUrl)
        .map((m) => ({
          id: m.rootLocationId,
          imageUrl: m.imageUrl!,
          label: m.name,
          sublabel: `${m.locationIds.length} locations${m.depth ? ` · depth ${m.depth}` : ''}`,
          prompt: m.prompt,
          aspectClass: 'aspect-[4/3]',
        }));
    }
    // artifacts
    return artifacts.filter((a) => a.imageUrl).map((a) => {
      const ownerName = a.parentId
        ? (narrative?.characters[a.parentId]?.name ?? narrative?.locations[a.parentId]?.name)
        : undefined;
      const sublabel = ownerName ? `${a.significance} · of ${ownerName}` : a.significance;
      return {
        id: a.id,
        imageUrl: a.imageUrl!,
        label: a.name,
        sublabel,
        prompt: a.imagePrompt,
        aspectClass: 'aspect-square',
      };
    });
  }, [tab, characters, locations, artifacts, savedMaps, narrative]);

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

  // Generate (or regenerate) the 1-depth map for a parent territory. We resolve
  // the parent + its direct children and hand the image model the region
  // structure plus each location's own image prompt — it paints the textless
  // map (parent title only); labels are placed by hand in the annotator. On
  // regenerate, label positions for still-present members are carried over.
  const runScopedMapGen = useCallback(async (rootId: string): Promise<void> => {
    if (!narrative) return;
    const isGlobal = rootId === GLOBAL_MAP_ROOT;
    const root = isGlobal ? undefined : narrative.locations[rootId];
    if (!isGlobal && !root) return;

    let memberIds: string[];
    let edges: MapEdge[];
    let signature: string;
    let regions: { name: string; prominence: string; parentName?: string; imagePrompt?: string }[];
    let displayName: string;

    if (isGlobal) {
      // Global = one tier: the synthetic "Global" title encloses every top-level
      // location as a sub-region. No real edges (the root is synthetic); members
      // are the top-level locations, which the annotator labels by hand.
      const tops = Object.values(narrative.locations).filter(
        (l) => !l.parentId || !narrative.locations[l.parentId],
      );
      memberIds = [...tops.map((l) => l.id)].sort();
      edges = [];
      signature = clusterSignature(memberIds);
      displayName = GLOBAL_MAP_TITLE;
      regions = [
        { name: GLOBAL_MAP_TITLE, prominence: 'domain' },
        ...tops.map((l) => ({
          name: l.name,
          prominence: l.prominence,
          parentName: GLOBAL_MAP_TITLE,
          imagePrompt: l.imagePrompt,
        })),
      ];
    } else {
      const scope = buildMapScope(narrative.locations, rootId, 1);
      memberIds = scope.memberIds;
      edges = scope.edges;
      signature = scope.signature;
      displayName = root!.name;
      regions = memberIds.map((id) => {
        const loc = narrative.locations[id];
        const parent = loc.parentId ? narrative.locations[loc.parentId] : undefined;
        return {
          name: loc.name,
          prominence: loc.prominence,
          parentName: parent && memberIds.includes(parent.id) ? parent.name : undefined,
          imagePrompt: loc.imagePrompt,
        };
      });
    }
    const { imageUrl, visualPrompt } = await generateImage('map', {
      name: displayName,
      regions,
      imageStyle: narrative.imageStyle,
    }, narrative.id);
    const existing = Object.values(narrative.boards ?? {}).find((m) => m.rootLocationId === rootId);
    const keptLabels = (existing?.labels ?? []).filter((lb) => memberIds.includes(lb.locationId));
    const now = Date.now();
    const map: Board = {
      id: existing?.id ?? `map-${rootId}-${now}`,
      rootLocationId: rootId,
      name: displayName,
      locationIds: memberIds,
      edges,
      signature,
      depth: 1,
      imageUrl,
      prompt: visualPrompt,
      labels: keptLabels.length > 0 ? keptLabels : undefined,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    dispatch({ type: 'SAVE_BOARD', board: map });
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

  const generateMapImage = useCallback(async (rootId: string) => {
    if (!narrative || generating || batchBusy || requireKeys()) return;
    setGenerating(rootId);
    try { await runScopedMapGen(rootId); }
    catch (err) { console.error('Failed to generate map:', err); }
    finally { setGenerating(null); }
  }, [narrative, generating, batchBusy, requireKeys, runScopedMapGen]);

  // Open the rebuild-hierarchy modal (it owns the AI run, streaming + review).
  const openHierarchy = useCallback(() => {
    if (!narrative || generating || batchBusy || requireKeys()) return;
    setShowHierarchy(true);
  }, [narrative, generating, batchBusy, requireKeys]);

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
          else if (item.kind === 'artifact') await runArtifactGen(item.artifact);
          else await runScopedMapGen(item.rootId);
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
  }, [narrative, batchBusy, generating, requireKeys, runCharacterGen, runLocationGen, runArtifactGen, runScopedMapGen]);

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
          ['maps', 'Maps'],
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
              {(() => {
                const parentName = loc.parentId ? narrative.locations[loc.parentId]?.name : undefined;
                const sub = parentName ? `${loc.prominence} · in ${parentName}` : loc.prominence;
                return <p className="text-[10px] text-text-dim truncate">{sub}</p>;
              })()}
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
              {(() => {
                const ownerName = artifact.parentId
                  ? (narrative.characters[artifact.parentId]?.name ?? narrative.locations[artifact.parentId]?.name)
                  : undefined;
                const sub = ownerName ? `${artifact.significance} · of ${ownerName}` : artifact.significance;
                return <p className="text-[10px] text-text-dim truncate">{sub}</p>;
              })()}
            </button>
            <GenerateButton onClick={() => generateArtifactImage(artifact)} disabled={generating !== null || batchBusy} generating={generating === artifact.id} />
          </div>
        ))}

        {/* ── Maps ── one row per parent territory = every possible 1-depth map.
            Maps are a single layer deep (a parent + its direct children) and are
            drawn textless except the parent title; place names are added by hand
            in the annotator. Ungenerated parents offer Generate; generated ones
            offer Label (drag-drop annotator) / Regenerate, with outdated status
            when the parent's children have changed since generation. */}

        {/* Rebuild-hierarchy — AI re-parents every location into a balanced map
            tree. The map tree IS the location containment tree, so this reshapes
            every map at once. */}
        {tab === 'maps' && Object.keys(narrative.locations).length > 0 && (
          <div className="mb-2 rounded-lg border border-border bg-white/3 px-2.5 py-2">
            <div className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-text-primary font-medium">Rebuild hierarchy</p>
                <p className="text-[9px] text-text-dim/70 leading-snug">
                  AI re-nests all locations into a balanced containment tree. Reshapes the whole map tree.
                </p>
              </div>
              <button
                onClick={openHierarchy}
                disabled={generating !== null || batchBusy}
                className="shrink-0 flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-accent/15 text-accent hover:bg-accent/25 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                title="Rebuild the location hierarchy with AI"
              >
                Rebuild
              </button>
            </div>
          </div>
        )}

        {tab === 'maps' && mapParents.length === 0 && !showGlobal && (
          <div className="px-3 py-8 text-center">
            <p className="text-[11px] text-text-dim/85 mb-1">No parent locations yet.</p>
            <p className="text-[10px] text-text-dim/55 leading-relaxed">
              Maps are built from a parent territory and the locations nested
              inside it. Give a location a parent (containment) and it can be mapped.
            </p>
          </div>
        )}

        {/* Global map — the synthetic top of the map tree, above every natural
            top-level territory. Only shown with ≥2 top-level locations (one root
            is already its own top map). Its sub-regions are those top-level
            locations; the rows below are one depth tier deeper (D1+). */}
        {tab === 'maps' && showGlobal && (() => {
          const busy = generating !== null || batchBusy;
          const status = globalMap ? savedMapStatus(globalMap) : null;
          return (
            <div className="flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-bg-elevated transition-colors">
              {/* Global is the synthetic top of the map tree → depth 0. */}
              <span
                title="Map-tree depth 0"
                className="shrink-0 px-1 py-0.5 rounded bg-white/6 text-[9px] font-bold text-text-dim/80 tabular-nums"
              >
                D0
              </span>
              {globalMap?.imageUrl ? (
                <button onClick={() => setAnnotateMap(globalMap)} className="shrink-0" title="Label this map">
                  <ThumbnailImage imageRef={globalMap.imageUrl} alt={GLOBAL_MAP_TITLE} className="w-8 h-8 rounded object-cover border border-border hover:border-accent/50 transition-colors" />
                </button>
              ) : (
                <div className="w-8 h-8 rounded bg-white/6 shrink-0 flex items-center justify-center border border-border border-dashed">
                  <IconMapPin size={12} className="text-text-dim" />
                </div>
              )}
              <div className="flex-1 text-left min-w-0">
                <p className="text-xs text-text-primary truncate">{GLOBAL_MAP_TITLE}</p>
                <p className="text-[10px] text-text-dim truncate flex items-center gap-1">
                  {topLevelLocs.length} top-level {topLevelLocs.length === 1 ? 'territory' : 'territories'}
                  {status ? (
                    <span className={status === 'outdated' ? 'text-amber-300/90' : 'text-emerald-300/80'}>
                      · {status === 'current' ? 'up to date' : 'outdated'}
                    </span>
                  ) : (
                    <span className="text-text-dim/50">· not generated</span>
                  )}
                </p>
              </div>
              {globalMap && (
                <>
                  <button
                    onClick={() => setAnnotateMap(globalMap)}
                    disabled={busy}
                    title="Label this map"
                    className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-text-dim hover:text-accent hover:bg-accent/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <IconLocationPin size={11} />
                  </button>
                  <button
                    onClick={() => dispatch({ type: 'DELETE_BOARD', boardId: globalMap.id })}
                    disabled={busy}
                    title="Delete map"
                    className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-text-dim hover:text-red-300 hover:bg-red-500/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <IconTrash size={11} />
                  </button>
                </>
              )}
              <GenerateButton
                onClick={() => generateMapImage(GLOBAL_MAP_ROOT)}
                disabled={busy}
                generating={generating === GLOBAL_MAP_ROOT}
              />
            </div>
          );
        })()}

        {tab === 'maps' && mapRows.map(({ parent, childCount, depth, map, status }) => {
          const busy = generating !== null || batchBusy;
          return (
            <div
              key={parent.id}
              className="flex items-center gap-1.5 rounded px-1.5 py-1 hover:bg-bg-elevated transition-colors"
            >
              {/* Depth badge — how deep this territory sits in the map tree
                  (D0 = top level), replacing tree indentation so every row
                  shares the same left edge. */}
              <span
                title={`Map-tree depth ${depth}`}
                className="shrink-0 px-1 py-0.5 rounded bg-white/6 text-[9px] font-bold text-text-dim/80 tabular-nums"
              >
                D{depth}
              </span>
              {map?.imageUrl ? (
                <button onClick={() => setAnnotateMap(map)} className="shrink-0" title="Label this map">
                  <ThumbnailImage imageRef={map.imageUrl} alt={parent.name} className="w-8 h-8 rounded object-cover border border-border hover:border-accent/50 transition-colors" />
                </button>
              ) : (
                <div className="w-8 h-8 rounded bg-white/6 shrink-0 flex items-center justify-center border border-border border-dashed">
                  <IconMapPin size={12} className="text-text-dim" />
                </div>
              )}
              <button
                onClick={() => dispatch({ type: 'SET_INSPECTOR', context: { type: 'location', locationId: parent.id } })}
                className="flex-1 text-left min-w-0"
              >
                <p className="text-xs text-text-primary truncate">{parent.name}</p>
                <p className="text-[10px] text-text-dim truncate flex items-center gap-1">
                  {childCount} {childCount === 1 ? 'location' : 'locations'}
                  {status ? (
                    <span className={status === 'outdated' ? 'text-amber-300/90' : 'text-emerald-300/80'}>
                      · {status === 'current' ? 'up to date' : 'outdated'}
                    </span>
                  ) : (
                    <span className="text-text-dim/50">· not generated</span>
                  )}
                </p>
              </button>
              {map && (
                <>
                  <button
                    onClick={() => setAnnotateMap(map)}
                    disabled={busy}
                    title="Label this map"
                    className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-text-dim hover:text-accent hover:bg-accent/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <IconLocationPin size={11} />
                  </button>
                  <button
                    onClick={() => dispatch({ type: 'DELETE_BOARD', boardId: map.id })}
                    disabled={busy}
                    title="Delete map"
                    className="shrink-0 w-6 h-6 flex items-center justify-center rounded text-text-dim hover:text-red-300 hover:bg-red-500/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  >
                    <IconTrash size={11} />
                  </button>
                </>
              )}
              <GenerateButton
                onClick={() => generateMapImage(parent.id)}
                disabled={busy || childCount < 1}
                generating={generating === parent.id}
              />
            </div>
          );
        })}
      </div>

      {previewIndex !== null && previewItems.length > 0 && (
        <MediaPreview
          items={previewItems}
          currentIndex={previewIndex}
          onNavigate={setPreviewIndex}
          onClose={() => setPreviewIndex(null)}
        />
      )}

      {annotateMap && (
        <BoardAnnotator
          map={annotateMap}
          onClose={() => setAnnotateMap(null)}
        />
      )}

      {showHierarchy && <HierarchyModal onClose={() => setShowHierarchy(false)} />}
    </div>
  );
}
