'use client';
// Stage — center-view workspace shell that routes between the active Stage surfaces (board, graphs, scene, etc.).

import { useRef, useEffect, useCallback, useMemo, useState } from 'react';
import * as d3 from 'd3';
import { useStore } from '@/lib/state/store';
import { EmptyState } from '@/components/shared/EmptyState';
import { IconReasoning, IconPlan, IconProse, IconWaveform, IconQuestion, IconScorecard, IconUser } from '@/components/icons';
import { getEffectivePovId } from '@/lib/forces/narrative-utils';
import { computeCumulativePositions } from '@/lib/forces/positions';
import { getRelationshipsAtScene, getOwnershipAtScene, getTiesAtScene } from '@/lib/graph/scene-filter';
import type {
  Character,
  Location,
  RelationshipEdge,
  GraphViewMode,
} from '@/types/narrative';
import EvalBar from '@/components/timeline/EvalBar';
import SystemGraphView, { FullscreenButton } from './SystemGraphView';
import WorldGraphView from './WorldGraphView';
import ThreadGraphView from './ThreadGraphView';
import SankeyView from './SankeyView';
import ThreadLogGraphView from './ThreadLogGraphView';
import { ScenePlanView } from './ScenePlanView';
import { SceneProseView } from './SceneProseView';
import { SceneLearningView } from './SceneLearningView';
import { ScenePerspectivesView } from './ScenePerspectivesView';
import { SceneAudioView } from './SceneAudioView';
import { DecisionView } from './DecisionView';
import { CaptureView } from '@/components/capture/CaptureView';
import { ReasoningGraphView } from './ReasoningGraphView';
import { PhaseGraphView } from './PhaseGraphView';
import { CurriculumView } from './CurriculumView';
import NetworkView from './NetworkView';
import { BoardView } from './BoardView';
import { StreamsView } from './StreamsView';
import { MergesView } from './MergesView';
import BeliefView from './BeliefView';
import StreamBeliefView from './StreamBeliefView';
import CompassView from './CompassView';
import {
  type GraphNode,
  type GraphLink,
  type NodeKind,
  computeGroups,
  computeCharacterPositions,
  buildGraphData,
  buildOverviewGraphData,
  getSceneArtifactIds,
  heatColor,
  ROLE_RADIUS,
  LOCATION_SIZE,
  LOCATION_RX,
  WORLD_FILL,
  resolveGraphNeutrals,
  roleFill,
} from './graph-utils';
import { useTheme } from '@/lib/state/theme-context';
import { useImageUrlMap } from '@/hooks/useAssetUrl';
import { buildMapTreeLayout } from '@/lib/map/map-tree-layout';
import { edgeWidthFor, GRAPH_ZOOM_EXTENT, GRAPH_INITIAL_SCALE, FOCUS_OPACITY_ACTIVE, FOCUS_OPACITY_DIM, FOCUS_NODE_OPACITY_ACTIVE, FOCUS_NODE_OPACITY_DIM, FOCUS_WIDTH_FACTOR_DIM } from '@/lib/graph/graph-styling';

export default function Stage() {
  const { state, dispatch } = useStore();
  const { theme } = useTheme();
  const svgRef = useRef<SVGSVGElement | null>(null);
  const simulationRef = useRef<d3.Simulation<GraphNode, GraphLink> | null>(null);
  const gRef = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null);
  const nodesRef = useRef<GraphNode[]>([]);
  const handleCharacterClickRef = useRef<(id: string) => void>(() => {});
  const handleLocationClickRef = useRef<(id: string) => void>(() => {});

  const [showEdgeLabels, setShowEdgeLabels] = useState(false);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [showEval, setShowEval] = useState(true);
  const [showCharacters, setShowCharacters] = useState(true);
  const [showLocations, setShowLocations] = useState(true);
  const [showArtifacts, setShowArtifacts] = useState(true);
  const [showRelationships, setShowRelationships] = useState(false);
  const [showTies, setShowTies] = useState(false);
  const [showSpatial, setShowSpatial] = useState(true);
  const [showVicinity, setShowVicinity] = useState(false);
  const [showMapTree, setShowMapTree] = useState(false);
  // Anchors of the currently-pinned location nodes (map-tree mode) — read by the
  // drag handler so a dragged location snaps back to its map slot on release.
  const pinnedAnchorsRef = useRef<Record<string, { x: number; y: number }>>({});
  const [groups, setGroups] = useState<GraphNode[][]>([]);
  const [focusedGroupIndex, setFocusedGroupIndex] = useState<number | null>(null);
  const [nodeTooltip, setNodeTooltip] = useState<{ x: number; y: number; label: string; kind: string; imagePrompt: string } | null>(null);
  const zoomRef = useRef<d3.ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  const narrative = state.activeNarrative;
  const inspectorContext = state.viewState.inspectorContext;
  const selectedKnowledgeEntity = state.viewState.selectedKnowledgeEntity;
  const selectedThreadLog = state.viewState.selectedThreadLog;
  const graphViewMode = state.viewState.graphViewMode;
  // arcFocus is driven by the topbar's Scene/Arc/Full scope: when the
  // active mode is `world-arc`, widen to the whole active arc (every
  // location + character it touched); otherwise scene-focus (scene.locationId
  // + POV location, characters positioned there). The local Arc Focus
  // checkbox dispatches a mode swap (world-scene ↔ world-arc) so the two
  // controls stay in sync.
  const arcFocus = graphViewMode === 'world-arc';
  const setArcFocus = (next: boolean) => {
    dispatch({ type: 'SET_GRAPH_VIEW_MODE', mode: next ? 'world-arc' : 'world-scene' });
  };

  const resolvedEntryKeys = state.resolvedEntryKeys;

  const currentSceneKey = resolvedEntryKeys[state.viewState.currentSceneIndex] ?? null;

  const activeArcId = useMemo(() => {
    if (!narrative || !currentSceneKey) return null;
    return Object.values(narrative.arcs).find((a) => a.sceneIds.includes(currentSceneKey))?.id ?? null;
  }, [narrative, currentSceneKey]);

  // Maps attached to the current scene's arc, ordered oldest → newest
  // so the cycle UI reads chronologically.
  const arcMaps = useMemo(() => {
    if (!narrative || !activeArcId) return [];
    return Object.values(narrative.maps ?? {})
      .filter((inv) => inv.arcId === activeArcId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }, [narrative, activeArcId]);

  // Currently-selected investigation: honor viewState.selectedMapId
  // when it belongs to the visible arc, otherwise fall back to the first.
  const activeMap = useMemo(() => {
    if (arcMaps.length === 0) return null;
    const selectedId = state.viewState.selectedMapId;
    return (
      arcMaps.find((inv) => inv.id === selectedId) ??
      arcMaps[0]
    );
  }, [arcMaps, state.viewState.selectedMapId]);

  // Legacy arc/world-build CRG snapshots — kept for coordination-plan visuals
  // even though the per-arc CRG generation path is being retired.
  const currentArcWithReasoning = useMemo(() => {
    if (!narrative || !activeArcId) return null;
    const arc = narrative.arcs[activeArcId];
    if (!arc?.reasoningGraph || arc.reasoningGraph.nodes.length === 0) return null;
    return { arc, reasoningGraph: arc.reasoningGraph };
  }, [narrative, activeArcId]);

  const currentWorldBuildWithReasoning = useMemo(() => {
    if (!narrative) return null;
    const key = resolvedEntryKeys[state.viewState.currentSceneIndex];
    if (!key) return null;
    const worldBuild = narrative.worldBuilds[key];
    if (!worldBuild?.reasoningGraph || worldBuild.reasoningGraph.nodes.length === 0) return null;
    return { worldBuild, reasoningGraph: worldBuild.reasoningGraph };
  }, [narrative, resolvedEntryKeys, state.viewState.currentSceneIndex]);

  const currentScene = useMemo(() => {
    if (!narrative || !currentSceneKey) return null;
    return narrative.scenes[currentSceneKey] ?? null;
  }, [narrative, currentSceneKey]);

  // Collect all image refs from entities for batch resolution
  const allImageRefs = useMemo(() => {
    if (!narrative) return [];
    const refs: string[] = [];
    for (const char of Object.values(narrative.characters)) {
      if (char.imageUrl) refs.push(char.imageUrl);
    }
    for (const loc of Object.values(narrative.locations)) {
      if (loc.imageUrl) refs.push(loc.imageUrl);
    }
    for (const art of Object.values(narrative.artifacts ?? {})) {
      if (art.imageUrl) refs.push(art.imageUrl);
    }
    // Map images — needed so the map-tree overlay can paint board backdrops.
    for (const map of Object.values(narrative.boards ?? {})) {
      if (map.imageUrl) refs.push(map.imageUrl);
    }
    return refs;
  }, [narrative]);

  // Resolve all image refs to blob URLs
  const resolvedImageUrls = useImageUrlMap(allImageRefs);

  // Node ids touched by the current scene — POV + participants + scene
  // location + scene-touched artifacts. Edges connected to any of these
  // render at full opacity; others dim. Same focus primitive KGV and TGV
  // apply in their scene-focused modes. Computed at component level so
  // both the main rebuild and the selection-highlight effect can read
  // the same set without duplicating the calculation.
  const activeSceneNodeIds = useMemo(() => {
    const ids = new Set<string>();
    if (!narrative || !currentScene) return ids;
    if (currentScene.povId) ids.add(currentScene.povId);
    for (const pid of currentScene.participantIds) ids.add(pid);
    if (currentScene.locationId) ids.add(currentScene.locationId);
    for (const aid of getSceneArtifactIds(currentScene, narrative.artifacts)) {
      ids.add(aid);
    }
    return ids;
  }, [narrative, currentScene]);

  // Background image for the graph canvas — the current scene's location
  // image if one is available. Rendered as a faded layer behind the SVG so
  // the graph stays legible while the place stays present.
  const locationBackgroundUrl = useMemo(() => {
    if (!currentScene || !narrative) return null;
    const loc = narrative.locations[currentScene.locationId];
    if (!loc?.imageUrl) return null;
    return resolvedImageUrls.get(loc.imageUrl) ?? null;
  }, [currentScene, narrative, resolvedImageUrls]);

  // Determine which node is selected for highlight
  const selectedNodeId = useMemo(() => {
    if (!inspectorContext) return null;
    switch (inspectorContext.type) {
      case 'character':
        return inspectorContext.characterId;
      case 'location':
        return inspectorContext.locationId;
      default:
        return null;
    }
  }, [inspectorContext]);

  const handleCharacterClick = useCallback(
    (characterId: string) => {
      setNodeTooltip(null);
      dispatch({
        type: 'SELECT_KNOWLEDGE_ENTITY',
        entityId: selectedKnowledgeEntity === characterId ? null : characterId,
      });
      dispatch({
        type: 'SET_INSPECTOR',
        context: { type: 'character', characterId },
      });
    },
    [dispatch, selectedKnowledgeEntity],
  );
  handleCharacterClickRef.current = handleCharacterClick;

  const handleLocationClick = useCallback(
    (locationId: string) => {
      setNodeTooltip(null);
      dispatch({
        type: 'SELECT_KNOWLEDGE_ENTITY',
        entityId: selectedKnowledgeEntity === locationId ? null : locationId,
      });
      dispatch({
        type: 'SET_INSPECTOR',
        context: { type: 'location', locationId },
      });
    },
    [dispatch, selectedKnowledgeEntity],
  );
  handleLocationClickRef.current = handleLocationClick;


  // Track the current world build ID (or null) — triggers full rebuild when navigating between world builds
  const currentWorldBuildId = useMemo(() => {
    if (!narrative) return null;
    const key = resolvedEntryKeys[state.viewState.currentSceneIndex];
    return key && narrative.worldBuilds[key] ? key : null;
  }, [narrative, resolvedEntryKeys, state.viewState.currentSceneIndex]);

  // ── Full rebuild: only on arc change or knowledge entity selection ────
  useEffect(() => {
    if (!svgRef.current || !narrative) return;

    const svg = d3.select(svgRef.current);
    const width = svgRef.current.clientWidth || 800;
    const height = svgRef.current.clientHeight || 600;

    // Theme-aware grayscale palette (anchors, locations, edges, default fills).
    // `theme` is in this effect's deps so the graph re-resolves on theme swap.
    const neutrals = resolveGraphNeutrals();

    // Capture the current zoom transform before wiping the SVG so a
    // mid-rebuild scene change doesn't yank the user back to the
    // default pan/zoom. Null means "no previous transform — use the
    // initial centred 0.9 scale".
    const previousTransform = svgRef.current
      ? d3.zoomTransform(svgRef.current)
      : null;
    const hadPreviousTransform = previousTransform != null && (
      previousTransform.k !== 1 || previousTransform.x !== 0 || previousTransform.y !== 0
    );

    // Clear previous
    svg.selectAll('*').remove();

    // SVG defs for clip paths (used for node images)
    const defs = svg.append('defs');

    // Shared arrowhead marker for directed edges (charloc, spatial, ownership).
    // context-stroke makes the marker inherit each line's colour, so we keep
    // a single marker definition instead of duplicating per link kind.
    defs.append('marker')
      .attr('id', 'wg-arrow')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 9)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', 'context-stroke');

    let nodes: GraphNode[];
    let links: GraphLink[];

    // Scene-local artifact set: only those used in, or introduced at, the current scene.
    // Overview mode accumulates across the full timeline inside buildOverviewGraphData.
    const sceneArtifactIds = new Set<string>();
    const currentKey = resolvedEntryKeys[state.viewState.currentSceneIndex];
    const currentSceneForArtifacts = currentKey ? narrative.scenes[currentKey] : null;
    const currentWBForArtifacts = currentKey ? narrative.worldBuilds[currentKey] : null;
    if (currentSceneForArtifacts) {
      for (const id of getSceneArtifactIds(currentSceneForArtifacts, narrative.artifacts)) {
        sceneArtifactIds.add(id);
      }
    }
    if (currentWBForArtifacts) {
      for (const a of currentWBForArtifacts.expansionManifest.newArtifacts ?? []) sceneArtifactIds.add(a.id);
    }
    const sceneArtifacts = Object.fromEntries(
      Object.entries(narrative.artifacts ?? {}).filter(([id]) => sceneArtifactIds.has(id))
    );

    // Entity visibility filters
    const filteredCharacters = showCharacters ? narrative.characters : {};
    const filteredLocations = showLocations ? narrative.locations : {};
    const filteredArtifacts = showArtifacts ? sceneArtifacts : {};
    const filteredArtifactsAll = showArtifacts ? (narrative.artifacts ?? {}) : {};

    // Scene-filtered ownership and ties for timeline-accurate graph connections
    const currentSceneIndex = state.viewState.currentSceneIndex;
    const sceneOwnership = getOwnershipAtScene(narrative, resolvedEntryKeys, currentSceneIndex);
    const sceneTies = getTiesAtScene(narrative, resolvedEntryKeys, currentSceneIndex);

    if (graphViewMode === 'world-full') {
      // Overview mode: all characters/locations/artifacts sized by usage across the timeline
      // For overview, use ownership/ties at the current viewing position (not end of timeline)
      const result = buildOverviewGraphData(
        filteredCharacters,
        filteredLocations,
        narrative.relationships,
        narrative.scenes,
        narrative.worldBuilds,
        resolvedEntryKeys,
        currentSceneIndex,
        filteredArtifactsAll,
        sceneOwnership,
        sceneTies,
      );
      nodes = result.nodes;
      links = result.links;
    } else {
      // Check if current scene is a world expansion. With Focus ON we narrow
      // to "what did this WB introduce" — useful for inspecting an expansion.
      // With Focus OFF we want the full arc view to persist across WB nav, so
      // we skip the narrowing and fall through to the arc-wide branch below.
      const currentKey = resolvedEntryKeys[state.viewState.currentSceneIndex];
      const currentWorldBuild = currentKey ? narrative.worldBuilds[currentKey] : null;

      if (currentWorldBuild && !arcFocus) {
        // Expansion mode: show expansion elements + connected existing entities
        const manifest = currentWorldBuild.expansionManifest;
        const expandedCharIds = new Set(manifest.newCharacters.map((c: Character) => c.id));
        const expandedLocIds = new Set(manifest.newLocations.map((l: Location) => l.id));

        // Relationships filtered to current timeline position, then to expansion entities
        const timelineRels = getRelationshipsAtScene(narrative, resolvedEntryKeys, state.viewState.currentSceneIndex);
        const filteredRels = timelineRels.filter(
          (r) => expandedCharIds.has(r.from) || expandedCharIds.has(r.to),
        );

        // Collect existing character IDs that are connected via relationships
        const connectedCharIds = new Set(expandedCharIds);
        for (const rel of filteredRels) {
          connectedCharIds.add(rel.from);
          connectedCharIds.add(rel.to);
        }

        // Include characters/locations that own artifacts from this expansion
        for (const art of manifest.newArtifacts ?? []) {
          if (art.parentId && narrative.characters[art.parentId]) connectedCharIds.add(art.parentId);
          if (art.parentId && narrative.locations[art.parentId]) expandedLocIds.add(art.parentId);
        }

        // Collect existing location IDs that are parents of new locations
        const connectedLocIds = new Set(expandedLocIds);
        for (const locId of expandedLocIds) {
          const loc = narrative.locations[locId];
          if (loc?.parentId && narrative.locations[loc.parentId]) {
            connectedLocIds.add(loc.parentId);
          }
        }

        const filteredChars = Object.fromEntries(
          Object.entries(narrative.characters).filter(([id]) => connectedCharIds.has(id)),
        );
        const filteredLocs = Object.fromEntries(
          Object.entries(narrative.locations).filter(([id]) => connectedLocIds.has(id)),
        );

        const result = buildGraphData(
          filteredChars,
          filteredLocs,
          filteredRels,
          {},
          filteredArtifacts,
          sceneOwnership,
          sceneTies,
        );
        nodes = result.nodes;
        links = result.links;
      } else {
        // Scene mode: scoped to active arc
        const activeArc = activeArcId
          ? narrative.arcs[activeArcId]
          : undefined;

        let filteredCharacters: Record<string, Character>;
        let filteredLocations: Record<string, Location>;
        let filteredRelationships: RelationshipEdge[];

        // Relationships filtered to current scene (valence + visibility)
        const sceneRelationships = getRelationshipsAtScene(
          narrative,
          resolvedEntryKeys,
          state.viewState.currentSceneIndex,
        );

        // Vicinity: expand a seed set of locationIds to every location
        // reachable through the parent-child hierarchy in either direction.
        // Used by both scene-focus (one seed cluster) and arc-focus (multiple
        // seeds, one per arc location — each grows its own cluster).
        const expandVicinity = (seedIds: Iterable<string>): Set<string> => {
          const result = new Set(seedIds);
          if (!showVicinity) return result;
          const childrenByParent = new Map<string, string[]>();
          for (const loc of Object.values(narrative.locations)) {
            if (loc.parentId) {
              const list = childrenByParent.get(loc.parentId) ?? [];
              list.push(loc.id);
              childrenByParent.set(loc.parentId, list);
            }
          }
          const queue = [...result];
          while (queue.length > 0) {
            const id = queue.shift()!;
            const loc = narrative.locations[id];
            if (loc?.parentId && !result.has(loc.parentId)) {
              result.add(loc.parentId);
              queue.push(loc.parentId);
            }
            for (const childId of childrenByParent.get(id) ?? []) {
              if (!result.has(childId)) {
                result.add(childId);
                queue.push(childId);
              }
            }
          }
          return result;
        };

        if (!arcFocus && currentScene && activeArc) {
          // Scene focus: show scene location + POV character's location (if different)
          // and all characters at either location
          const charPositions = computeCharacterPositions(activeArc, narrative.scenes, state.viewState.currentSceneIndex, resolvedEntryKeys);

          const sceneLocId = currentScene.locationId;
          const effectivePovId = getEffectivePovId(currentScene);
          const povLocId = effectivePovId
            ? (charPositions[effectivePovId] ?? sceneLocId)
            : sceneLocId;
          const focusLocIds = expandVicinity([sceneLocId, povLocId]);

          // Characters: scene participants + anyone positioned at either location
          const focusCharIds = new Set(currentScene.participantIds);
          if (effectivePovId) focusCharIds.add(effectivePovId);
          for (const [charId, locId] of Object.entries(charPositions)) {
            if (focusLocIds.has(locId)) focusCharIds.add(charId);
          }

          filteredCharacters = Object.fromEntries(
            Object.entries(narrative.characters).filter(([id]) => focusCharIds.has(id)),
          );
          filteredLocations = Object.fromEntries(
            Object.entries(narrative.locations).filter(([id]) => focusLocIds.has(id)),
          );
          filteredRelationships = sceneRelationships.filter(
            (r) => focusCharIds.has(r.from) && focusCharIds.has(r.to),
          );
        } else if (activeArc) {
          // Arc focus: expand every location the arc touched into its full
          // cluster — arcs can span multiple disconnected location clusters,
          // each grows independently.
          const activeCharIds = new Set(activeArc.activeCharacterIds);
          const activeLocIds = expandVicinity(activeArc.locationIds);

          // Also include any character whose cumulative position (the
          // last scene that placed them anywhere, regardless of arc)
          // lands in the arc's location cluster. Without this, residents
          // of an arc location who didn't actively participate in the
          // arc's scenes disappear from view — the arc reads as empty of
          // its supporting cast. Position-only members render without
          // their own edges, just sitting at their location.
          const allPositions = computeCumulativePositions(narrative, resolvedEntryKeys, state.viewState.currentSceneIndex);
          for (const [charId, locId] of Object.entries(allPositions)) {
            if (activeLocIds.has(locId)) activeCharIds.add(charId);
          }

          filteredCharacters = Object.fromEntries(
            Object.entries(narrative.characters).filter(([id]) => activeCharIds.has(id)),
          );
          filteredLocations = Object.fromEntries(
            Object.entries(narrative.locations).filter(([id]) => activeLocIds.has(id)),
          );
          filteredRelationships = sceneRelationships.filter(
            (r) => activeCharIds.has(r.from) && activeCharIds.has(r.to),
          );
        } else {
          filteredCharacters = narrative.characters;
          filteredLocations = narrative.locations;
          filteredRelationships = sceneRelationships;
        }

        const characterPositions = activeArc
          ? computeCharacterPositions(activeArc, narrative.scenes, state.viewState.currentSceneIndex, resolvedEntryKeys)
          : {};

        const result = buildGraphData(
          filteredCharacters,
          filteredLocations,
          filteredRelationships,
          characterPositions,
          filteredArtifacts,
          sceneOwnership,
          sceneTies,
        );
        nodes = result.nodes;
        links = result.links;
      }
    }

    // Backfill usageCount for scene / arc modes (world-full already sets it)
    if (graphViewMode !== 'world-full') {
      const charUsage: Record<string, number> = {};
      const locUsage: Record<string, number> = {};
      const artUsage: Record<string, number> = {};
      for (const scene of Object.values(narrative.scenes)) {
        for (const pid of scene.participantIds) charUsage[pid] = (charUsage[pid] ?? 0) + 1;
        if (scene.locationId) locUsage[scene.locationId] = (locUsage[scene.locationId] ?? 0) + 1;
        for (const aid of getSceneArtifactIds(scene, narrative.artifacts)) {
          artUsage[aid] = (artUsage[aid] ?? 0) + 1;
        }
      }
      for (const n of nodes) {
        if (n.kind === 'character') n.usageCount = charUsage[n.id] ?? 1;
        if (n.kind === 'location') n.usageCount = locUsage[n.id] ?? 1;
        if (n.kind === 'artifact') n.usageCount = artUsage[n.id] ?? 1;
      }
    }

    // Apply entity visibility filters
    const hiddenKinds = new Set<string>();
    if (!showCharacters) hiddenKinds.add('character');
    if (!showLocations) hiddenKinds.add('location');
    if (!showArtifacts) hiddenKinds.add('artifact');
    if (hiddenKinds.size > 0) {
      const hiddenIds = new Set(nodes.filter(n => hiddenKinds.has(n.kind)).map(n => n.id));
      nodes = nodes.filter(n => !hiddenKinds.has(n.kind));
      links = links.filter(l => !hiddenIds.has(l.source as string) && !hiddenIds.has(l.target as string));
    }

    // Edge-kind visibility filters. Spatial covers both location→parent
    // (location-to-location) and character→location position edges — they
    // belong to the same "where things sit in space" category.
    const hiddenLinkKinds = new Set<string>();
    if (!showRelationships) hiddenLinkKinds.add('relationship');
    if (!showTies) hiddenLinkKinds.add('tie');
    if (!showSpatial) {
      hiddenLinkKinds.add('spatial');
      hiddenLinkKinds.add('character-location');
    }
    if (hiddenLinkKinds.size > 0) {
      links = links.filter(l => !hiddenLinkKinds.has(l.linkKind));
    }

    // Preserve positions across rebuilds so toggles like arcFocus, vicinity,
    // and entity-kind filters don't restart the layout from scratch. Any new
    // node that wasn't in the previous build starts unpositioned and the
    // simulation settles it around the existing layout.
    const prevPositions = new Map(nodesRef.current.map((n) => [n.id, { x: n.x, y: n.y }]));
    for (const n of nodes) {
      const prev = prevPositions.get(n.id);
      if (prev?.x != null && prev?.y != null) {
        n.x = prev.x;
        n.y = prev.y;
      }
    }

    // Store nodes ref for intra-arc updates
    nodesRef.current = nodes;

    // ── Map-tree overlay ────────────────────────────────────────────────────
    // When enabled, build the tree of map boards applicable to the locations
    // present in this build, then PIN each location node (fx/fy) onto its label
    // position. Pinned anchors are stashed so the drag handler can snap a
    // dragged location back to its slot on release. When off, clear any pins so
    // the force layout resumes from the preserved positions.
    const mapTree = showMapTree && narrative
      ? buildMapTreeLayout({
          maps: narrative.boards ?? {},
          locations: narrative.locations,
          presentLocationIds: new Set(nodes.filter((n) => n.kind === 'location').map((n) => n.id)),
        })
      : null;
    pinnedAnchorsRef.current = mapTree?.anchors ?? {};
    for (const n of nodes) {
      if (n.kind !== 'location') continue;
      const anchor = mapTree?.anchors[n.id];
      if (anchor) { n.x = anchor.x; n.y = anchor.y; n.fx = anchor.x; n.fy = anchor.y; }
      else { n.fx = null; n.fy = null; }
    }

    // Compute connected groups and reset focus
    setGroups(computeGroups(nodes, links));
    setFocusedGroupIndex(null);

    // Validate links
    const nodeIds = new Set(nodes.map((n) => n.id));
    const validLinks = links.filter((l) => {
      const srcId = typeof l.source === 'string' ? l.source : (l.source as GraphNode).id;
      const tgtId = typeof l.target === 'string' ? l.target : (l.target as GraphNode).id;
      return nodeIds.has(srcId) && nodeIds.has(tgtId);
    });

    // Deduplicate bidirectional relationship edges into a single link with directedLabels
    const relSeen = new Map<string, GraphLink>();
    const deduped: GraphLink[] = [];
    for (const l of validLinks) {
      if (l.linkKind !== 'relationship') {
        deduped.push(l);
        continue;
      }
      const srcId = typeof l.source === 'string' ? l.source : (l.source as GraphNode).id;
      const tgtId = typeof l.target === 'string' ? l.target : (l.target as GraphNode).id;
      const pairKey = [srcId, tgtId].sort().join('|');
      const existing = relSeen.get(pairKey);
      if (existing) {
        // Merge: store both directed labels
        existing.directedLabels = existing.directedLabels ?? {};
        existing.directedLabels[srcId] = l.label ?? '';
      } else {
        l.directedLabels = { [srcId]: l.label ?? '' };
        relSeen.set(pairKey, l);
        deduped.push(l);
      }
    }
    const validLinksDeduped = deduped;

    // Root group for zoom/pan
    const g = svg.append('g');
    gRef.current = g;

    // ── Map-tree boards layer ───────────────────────────────────────────────
    // Appended first so it renders BEHIND links and nodes. Boards are static in
    // graph space (drawn once, no per-tick work): containment edges, then each
    // board's image + border + title. Location nodes are pinned onto these via
    // the anchors computed above.
    if (mapTree && mapTree.boards.length > 0) {
      const boardsG = g.append('g').attr('class', 'map-boards');
      const boardByRoot = new Map(mapTree.boards.map((b) => [b.rootId, b]));

      boardsG.append('g').attr('class', 'board-edges')
        .selectAll('line')
        .data(mapTree.edges.filter((e) => boardByRoot.has(e.parentRootId) && boardByRoot.has(e.childRootId)))
        .join('line')
        .attr('x1', (e) => { const b = boardByRoot.get(e.parentRootId)!; return b.x + b.w / 2; })
        .attr('y1', (e) => { const b = boardByRoot.get(e.parentRootId)!; return b.y + b.h; })
        .attr('x2', (e) => { const b = boardByRoot.get(e.childRootId)!; return b.x + b.w / 2; })
        .attr('y2', (e) => { const b = boardByRoot.get(e.childRootId)!; return b.y; })
        .attr('stroke', neutrals.edge)
        .attr('stroke-width', 2)
        .attr('vector-effect', 'non-scaling-stroke')
        .attr('opacity', 0.4);

      const boardG = boardsG.selectAll('g.board')
        .data(mapTree.boards, (b) => (b as typeof mapTree.boards[number]).rootId)
        .join('g')
        .attr('class', 'board')
        .attr('transform', (b) => `translate(${b.x},${b.y})`);

      boardG.filter((b) => !!b.map.imageUrl && resolvedImageUrls.has(b.map.imageUrl))
        .append('image')
        .attr('href', (b) => resolvedImageUrls.get(b.map.imageUrl!)!)
        .attr('width', (b) => b.w)
        .attr('height', (b) => b.h)
        .attr('preserveAspectRatio', 'xMidYMid slice')
        .attr('opacity', 0.85);

      boardG.append('rect')
        .attr('width', (b) => b.w)
        .attr('height', (b) => b.h)
        .attr('rx', 8)
        .attr('fill', 'none')
        .attr('stroke', neutrals.location)
        .attr('stroke-width', 1.5)
        .attr('vector-effect', 'non-scaling-stroke')
        .attr('opacity', 0.5);

      boardG.append('text')
        .attr('x', (b) => b.w / 2)
        .attr('y', 22)
        .attr('text-anchor', 'middle')
        .attr('class', 'graph-label')
        .attr('font-weight', 700)
        .text((b) => b.map.name);
    }

    // Zoom behavior
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent(GRAPH_ZOOM_EXTENT)
      .on('zoom', (event: d3.D3ZoomEvent<SVGSVGElement, unknown>) => {
        g.attr('transform', event.transform.toString());
      });

    svg.call(zoom);
    zoomRef.current = zoom;
    // Restore the user's pan/zoom across scene-change rebuilds so the
    // viewport stays where they left it. Only fall back to the default
    // centred 0.9 scale on the very first build (no prior transform).
    const initialTransform = hadPreviousTransform
      ? previousTransform!
      : d3.zoomIdentity.translate(width / 2, height / 2).scale(GRAPH_INITIAL_SCALE);
    svg.call(zoom.transform, initialTransform);

    // Click on empty canvas → revert inspector to current scene
    svg.on('click', (event: MouseEvent) => {
      // Only fire when clicking the SVG background, not a node
      if (event.target === svgRef.current) {
        const currentKey = resolvedEntryKeys[state.viewState.currentSceneIndex];
        if (currentKey) {
          dispatch({ type: 'SET_INSPECTOR', context: { type: 'scene', sceneId: currentKey } });
          dispatch({ type: 'SELECT_KNOWLEDGE_ENTITY', entityId: null });
        }
      }
    });

    // Character / location usage stats for sizing and heatmap
    const scaleByUsage = true;
    const charNodes = nodes.filter((n) => n.kind === 'character');
    const locNodes = nodes.filter((n) => n.kind === 'location');
    const charUsages = charNodes.map((n) => n.usageCount ?? 1);
    const locUsages = locNodes.map((n) => n.usageCount ?? 1);
    const minCharUsage = scaleByUsage && charUsages.length > 0 ? Math.min(...charUsages) : 1;
    const maxCharUsage = scaleByUsage && charUsages.length > 0 ? Math.max(...charUsages) : 1;
    const minLocUsage = scaleByUsage && locUsages.length > 0 ? Math.min(...locUsages) : 1;
    const maxLocUsage = scaleByUsage && locUsages.length > 0 ? Math.max(...locUsages) : 1;
    const charRange = Math.max(1, maxCharUsage - minCharUsage);
    const locRange = Math.max(1, maxLocUsage - minLocUsage);
    const normChar = (d: GraphNode) => ((d.usageCount ?? 1) - minCharUsage) / charRange;
    const normLoc = (d: GraphNode) => ((d.usageCount ?? 1) - minLocUsage) / locRange;
    const artNodes = nodes.filter((n) => n.kind === 'artifact');
    const artUsages = artNodes.map((n) => n.usageCount ?? 1);
    const minArtUsage = artUsages.length > 0 ? Math.min(...artUsages) : 1;
    const maxArtUsage = artUsages.length > 0 ? Math.max(...artUsages) : 1;
    const artRange = Math.max(1, maxArtUsage - minArtUsage);
    const normArt = (d: GraphNode) => ((d.usageCount ?? 1) - minArtUsage) / artRange;
    const CHAR_MIN_R = 20;
    const CHAR_MAX_R = 44;
    const LOC_MIN_SCALE = 0.6;
    const LOC_MAX_SCALE = 1.4;
    const ARTIFACT_SIZES: Record<string, number> = { key: 22, notable: 16, minor: 11 };

    // Edges that should show a directional arrowhead at their midpoint.
    const arrowedKinds = new Set<GraphLink['linkKind']>(['character-location', 'spatial', 'ownership']);
    const isArrowed = (l: GraphLink) => arrowedKinds.has(l.linkKind);

    // Force simulation
    const simulation = d3
      .forceSimulation<GraphNode>(nodes)
      .force(
        'link',
        d3
          .forceLink<GraphNode, GraphLink>(validLinksDeduped)
          .id((d) => d.id)
          .distance(160),
      )
      .force('charge', d3.forceManyBody<GraphNode>().strength(-400))
      .force('center', d3.forceCenter(0, 0))
      .force('x', d3.forceX(0).strength(0.05))
      .force('y', d3.forceY(0).strength(0.05))
      .force(
        'collide',
        d3.forceCollide<GraphNode>().radius((d) => {
          if (d.kind === 'knowledge') return 28;
          if (d.kind === 'artifact') return (d.significance === 'key' ? 22 : d.significance === 'minor' ? 11 : 16) + 14;
          if (scaleByUsage) {
            if (d.kind === 'character') {
              const t = charRange > 0 ? ((d.usageCount ?? 1) - minCharUsage) / charRange : 0;
              return (CHAR_MIN_R + (CHAR_MAX_R - CHAR_MIN_R) * t) + 16;
            }
            const t = locRange > 0 ? ((d.usageCount ?? 1) - minLocUsage) / locRange : 0;
            const s = LOC_MIN_SCALE + (LOC_MAX_SCALE - LOC_MIN_SCALE) * t;
            return (LOCATION_SIZE * s) / 2 + 16;
          }
          if (d.kind === 'character') return (ROLE_RADIUS[d.role ?? 'recurring'] ?? 18) + 20;
          return LOCATION_SIZE / 2 + 20;
        }),
      );

    simulationRef.current = simulation;

    // In map-tree mode ONLY the location nodes are fixed (pinned to their map
    // slots above). Everything else stays fluid — characters/artifacts settle
    // naturally around their pinned locations via the existing
    // character-location / relationship / ownership links, with no extra
    // positional force (a hard pull made actors collapse onto a single point).

    // ── Links ─────────────────────────────────────────────────────────────
    const nonRelLinks = validLinksDeduped.filter((l) => l.linkKind !== 'relationship');
    const relLinks = validLinksDeduped.filter((l) => l.linkKind === 'relationship');

    // Focus effect: edges that touch a current-scene node read at the
    // shared active opacity; everything else stays at the dim baseline.
    // When there's no scene context at all (world-build view, no current
    // scene), edges remain at the dim baseline rather than reverting to
    // bright — "no activations at this step" should read as quiet, not
    // loud. Same primitive KGV / TGV / NetworkView use.
    // Per-kind activation semantics — each edge kind encodes a different
    // relationship, so what counts as "active" differs. The general
    // principle: an edge lights up only when the entity DOING something
    // this scene is the source. A character-location edge shows where
    // the character is RIGHT NOW; if the character isn't in the scene,
    // that position fact isn't part of this scene's action — dim.
    //
    //   character-location: source (character) must be scene-active
    //   tie:               source (character) must be scene-active
    //   knowledge:         source (character) must be scene-active
    //   ownership:         source (artifact)  must be scene-active
    //   relationship:      BOTH characters scene-active (joint action)
    //   spatial:           BOTH locations scene-active (joint structure)
    const isEdgeActive = (l: GraphLink): boolean => {
      const srcId = typeof l.source === 'string' ? l.source : (l.source as GraphNode).id;
      const tgtId = typeof l.target === 'string' ? l.target : (l.target as GraphNode).id;
      const srcActive = activeSceneNodeIds.has(srcId);
      const tgtActive = activeSceneNodeIds.has(tgtId);
      if (l.linkKind === 'spatial' || l.linkKind === 'relationship') {
        return srcActive && tgtActive;
      }
      // character-location, tie, knowledge, ownership all key off source.
      return srcActive;
    };
    const scopedEdgeOpacity = (l: GraphLink): number =>
      isEdgeActive(l) ? FOCUS_OPACITY_ACTIVE : FOCUS_OPACITY_DIM;
    const scopedEdgeWidth = (l: GraphLink): number => {
      const base = edgeWidthFor(0.85);
      return isEdgeActive(l) ? base : base * FOCUS_WIDTH_FACTOR_DIM;
    };

    // Adjacency for hover highlighting — built from the (deduped) link
    // set so every edge incident to the hovered node can be lit
    // independently of the scene-focus baseline. Same primitive
    // KGV / TGV / Network use for hover.
    const adjacency = new Map<string, Set<string>>();
    for (const l of validLinksDeduped) {
      const a = typeof l.source === 'string' ? l.source : (l.source as GraphNode).id;
      const b = typeof l.target === 'string' ? l.target : (l.target as GraphNode).id;
      if (!adjacency.has(a)) adjacency.set(a, new Set());
      if (!adjacency.has(b)) adjacency.set(b, new Set());
      adjacency.get(a)!.add(b);
      adjacency.get(b)!.add(a);
    }
    const incidentTo = (id: string) => (l: GraphLink): boolean => {
      const s = typeof l.source === 'string' ? l.source : (l.source as GraphNode).id;
      const t = typeof l.target === 'string' ? l.target : (l.target as GraphNode).id;
      return s === id || t === id;
    };

    // Non-relationship links — solid, bright, thick. Node SHAPE carries the
    // type signal; we only vary stroke colour by linkKind, not weight or dash.
    // Polylines so we can drop an arrowhead at the midpoint of arrowed kinds
    // (charloc, spatial, ownership) without sacrificing the centre-to-centre
    // straight-line geometry — the midpoint vertex is invisible, just an
    // anchor for marker-mid.
    const linkSelection = g
      .append('g')
      .attr('class', 'links')
      .selectAll<SVGPolylineElement, GraphLink>('polyline')
      .data(nonRelLinks)
      .join('polyline')
      .attr('class', 'graph-edge')
      .attr('fill', 'none')
      .attr('vector-effect', 'non-scaling-stroke')
      .attr('stroke', (d) => {
        if (d.linkKind === 'character-location') return '#3B82F6';  // Blue - current position
        if (d.linkKind === 'tie') return '#A855F7';                 // Purple - permanent affiliation
        if (d.linkKind === 'ownership') return '#FBBF24';           // Amber - artifact ownership
        if (d.linkKind === 'knowledge') return neutrals.edge;
        return neutrals.edge;
      })
      // Group opacity (not stroke-opacity) so the arrowhead fades together
      // with its line — context-stroke inherits colour only, not opacity.
      // .style() (inline) instead of .attr() because the .graph-edge class
      // historically had a CSS rule that pinned stroke-width to 1px;
      // inline style wins over any cached CSS that may still be lingering.
      // Per-edge: bright when touching a current-scene node, dim otherwise
      // (matches the focus effect in KGV/TGV).
      .style('opacity', (d) => scopedEdgeOpacity(d))
      .style('stroke-width', (d) => scopedEdgeWidth(d))
      .attr('marker-mid', (d) => (isArrowed(d) ? 'url(#wg-arrow)' : null));

    // Relationship links — solid, bright, thick. Valence sign drives colour.
    const relLinkSelection = g
      .select('g.links')
      .selectAll<SVGLineElement, GraphLink>('line.graph-rel-edge')
      .data(relLinks)
      .join('line')
      .attr('class', 'graph-edge graph-rel-edge')
      .attr('vector-effect', 'non-scaling-stroke')
      .attr('stroke', (d) => {
        const v = d.valence ?? 0;
        return v >= 0 ? '#4ADE80' : '#F87171';
      })
      .style('stroke-opacity', (d) => scopedEdgeOpacity(d))
      .style('stroke-width', (d) => scopedEdgeWidth(d));

    // Relationship labels at midpoints
    const linkLabelSelection = g
      .append('g')
      .attr('class', 'link-labels')
      .style('display', showEdgeLabels ? '' : 'none')
      .selectAll<SVGTextElement, GraphLink>('text')
      .data(relLinks)
      .join('text')
      .attr('class', 'graph-label graph-rel-label')
      .attr('text-anchor', 'middle')
      .attr('dy', '-6')
      .style('font-size', '9px')
      .style('fill', '#999999')
      .text((d) => d.label ?? '');

    // ── Node groups ───────────────────────────────────────────────────────
    // Node opacity follows the same focus primitive as edges: characters,
    // locations, and artifacts in the current scene's active set read at
    // full opacity; everything else dims to FOCUS_NODE_OPACITY_DIM so
    // the activity-over-time cue is visible as the user navigates.
    // Knowledge nodes are left at full opacity because they only appear
    // in a different (entity-inspector) context.
    const nodeGroup = g
      .append('g')
      .attr('class', 'nodes')
      .selectAll<SVGGElement, GraphNode>('g')
      .data(nodes, (d) => d.id)
      .join('g')
      .attr('class', 'graph-node')
      .style('opacity', (d) => {
        if (d.kind === 'knowledge') return FOCUS_NODE_OPACITY_ACTIVE;
        return activeSceneNodeIds.has(d.id)
          ? FOCUS_NODE_OPACITY_ACTIVE
          : FOCUS_NODE_OPACITY_DIM;
      })
      .on('click', (_event, d) => {
        _event.stopPropagation();
        if (d.kind === 'character') handleCharacterClickRef.current(d.id);
        if (d.kind === 'location') handleLocationClickRef.current(d.id);
        if (d.kind === 'artifact') {
          setNodeTooltip(null);
          dispatch({ type: 'SELECT_KNOWLEDGE_ENTITY', entityId: selectedKnowledgeEntity === d.id ? null : d.id });
          dispatch({ type: 'SET_INSPECTOR', context: { type: 'artifact', artifactId: d.id } });
        }
      })
      .on('mouseenter', (event, d) => {
        if ((d.kind === 'character' || d.kind === 'location' || d.kind === 'artifact') && d.imagePrompt) {
          const rect = svgRef.current?.getBoundingClientRect();
          if (rect) {
            setNodeTooltip({ x: event.clientX - rect.left, y: event.clientY - rect.top - 10, label: d.label, kind: d.kind, imagePrompt: d.imagePrompt });
          }
        }
        // Hover focus — activate edges incident to the hovered node and
        // collapse the rest below the dim baseline so the focal star
        // reads as the only structure on screen. Same primitive
        // KGV / TGV / Network use.
        const touches = incidentTo(d.id);
        g.select<SVGGElement>('g.links')
          .selectAll<SVGPolylineElement, GraphLink>('polyline.graph-edge')
          .style('opacity', (l) => touches(l) ? Math.max(FOCUS_OPACITY_ACTIVE + 0.15, 0.65) : 0.03)
          .style('stroke-width', (l) => touches(l) ? edgeWidthFor(0.85) : edgeWidthFor(0.85) * FOCUS_WIDTH_FACTOR_DIM);
        g.select<SVGGElement>('g.links')
          .selectAll<SVGLineElement, GraphLink>('line.graph-rel-edge')
          .style('stroke-opacity', (l) => touches(l) ? Math.max(FOCUS_OPACITY_ACTIVE + 0.15, 0.65) : 0.03)
          .style('stroke-width', (l) => touches(l) ? edgeWidthFor(0.85) : edgeWidthFor(0.85) * FOCUS_WIDTH_FACTOR_DIM);
        const neighbors = adjacency.get(d.id) ?? new Set<string>();
        g.select<SVGGElement>('g.nodes')
          .selectAll<SVGGElement, GraphNode>('g.graph-node')
          .style('opacity', (o) => {
            if (o.kind === 'knowledge') return FOCUS_NODE_OPACITY_ACTIVE;
            return (o.id === d.id || neighbors.has(o.id)) ? FOCUS_NODE_OPACITY_ACTIVE : 0.18;
          });
      })
      .on('mouseleave', () => {
        setNodeTooltip(null);
        g.select<SVGGElement>('g.links')
          .selectAll<SVGPolylineElement, GraphLink>('polyline.graph-edge')
          .style('opacity', (l) => scopedEdgeOpacity(l))
          .style('stroke-width', (l) => scopedEdgeWidth(l));
        g.select<SVGGElement>('g.links')
          .selectAll<SVGLineElement, GraphLink>('line.graph-rel-edge')
          .style('stroke-opacity', (l) => scopedEdgeOpacity(l))
          .style('stroke-width', (l) => scopedEdgeWidth(l));
        g.select<SVGGElement>('g.nodes')
          .selectAll<SVGGElement, GraphNode>('g.graph-node')
          .style('opacity', (o) => {
            if (o.kind === 'knowledge') return FOCUS_NODE_OPACITY_ACTIVE;
            return activeSceneNodeIds.has(o.id) ? FOCUS_NODE_OPACITY_ACTIVE : FOCUS_NODE_OPACITY_DIM;
          });
      })
      .call(
        d3
          .drag<SVGGElement, GraphNode>()
          .on('start', (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on('drag', (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on('end', (event, d) => {
            if (!event.active) simulation.alphaTarget(0);
            // Map-tree pinned locations snap back to their map slot; everything
            // else releases to the force layout as usual.
            const pinned = pinnedAnchorsRef.current[d.id];
            if (pinned) { d.fx = pinned.x; d.fy = pinned.y; }
            else { d.fx = null; d.fy = null; }
          }),
      );

    // Character circles
    nodeGroup
      .filter((d) => d.kind === 'character')
      .append('circle')
      .attr('r', (d) => {
        if (scaleByUsage) return CHAR_MIN_R + (CHAR_MAX_R - CHAR_MIN_R) * normChar(d);
        return ROLE_RADIUS[d.role as keyof typeof ROLE_RADIUS] ?? ROLE_RADIUS.recurring;
      })
      .attr('fill', (d) =>
        showHeatmap ? heatColor(normChar(d)) : roleFill(d.role, neutrals),
      );

    // Location rounded rects
    nodeGroup
      .filter((d) => d.kind === 'location')
      .each(function (d) {
        const sel = d3.select(this);
        const scale = scaleByUsage
          ? LOC_MIN_SCALE + (LOC_MAX_SCALE - LOC_MIN_SCALE) * normLoc(d)
          : 1;
        const size = LOCATION_SIZE * scale;
        sel.append('rect')
          .attr('x', -size / 2)
          .attr('y', -size / 2)
          .attr('width', size)
          .attr('height', size)
          .attr('rx', LOCATION_RX)
          .attr('fill', showHeatmap ? heatColor(normLoc(d)) : neutrals.location);
      });

    // ── Node images (clip-masked portraits & location photos) ──────────
    // Use resolved blob URLs from the map (asset IDs like "img_abc123" → blob URLs)
    nodeGroup
      .filter((d) => !showHeatmap && d.kind === 'character' && !!d.imageUrl && resolvedImageUrls.has(d.imageUrl))
      .each(function (d) {
        const sel = d3.select(this);
        const r = scaleByUsage
          ? CHAR_MIN_R + (CHAR_MAX_R - CHAR_MIN_R) * normChar(d)
          : ROLE_RADIUS[d.role ?? 'recurring'];
        const clipId = `clip-${d.id}`;
        defs.append('clipPath').attr('id', clipId)
          .append('circle').attr('r', r);
        sel.append('image')
          .attr('href', resolvedImageUrls.get(d.imageUrl!)!)
          .attr('x', -r).attr('y', -r)
          .attr('width', r * 2).attr('height', r * 2)
          .attr('preserveAspectRatio', 'xMidYMid slice')
          .attr('clip-path', `url(#${clipId})`);
      });

    nodeGroup
      .filter((d) => !showHeatmap && d.kind === 'location' && !!d.imageUrl && resolvedImageUrls.has(d.imageUrl))
      .each(function (d) {
        const sel = d3.select(this);
        const scale = scaleByUsage
          ? LOC_MIN_SCALE + (LOC_MAX_SCALE - LOC_MIN_SCALE) * normLoc(d)
          : 1;
        const size = LOCATION_SIZE * scale;
        const clipId = `clip-${d.id}`;
        defs.append('clipPath').attr('id', clipId)
          .append('rect')
          .attr('x', -size / 2).attr('y', -size / 2)
          .attr('width', size).attr('height', size)
          .attr('rx', LOCATION_RX);
        sel.append('image')
          .attr('href', resolvedImageUrls.get(d.imageUrl!)!)
          .attr('x', -size / 2).attr('y', -size / 2)
          .attr('width', size).attr('height', size)
          .attr('preserveAspectRatio', 'xMidYMid slice')
          .attr('clip-path', `url(#${clipId})`);
      });

    // Knowledge nodes
    nodeGroup
      .filter((d) => d.kind === 'knowledge')
      .append('circle')
      .attr('r', 8)
      .attr('fill', (d) => WORLD_FILL[d.worldType ?? 'trait'] ?? neutrals.defaultFill);

    // Artifact diamonds — sized by significance (ARTIFACT_SIZES defined above).
    const ARTIFACT_FILLS: Record<string, string> = { key: '#F59E0B', notable: '#D97706', minor: '#92400E' };
    nodeGroup
      .filter((d) => d.kind === 'artifact')
      .append('rect')
      .attr('x', (d) => -(ARTIFACT_SIZES[d.significance ?? 'notable'] ?? 10))
      .attr('y', (d) => -(ARTIFACT_SIZES[d.significance ?? 'notable'] ?? 10))
      .attr('width', (d) => (ARTIFACT_SIZES[d.significance ?? 'notable'] ?? 10) * 2)
      .attr('height', (d) => (ARTIFACT_SIZES[d.significance ?? 'notable'] ?? 10) * 2)
      .attr('rx', 2)
      .attr('transform', 'rotate(45)')
      .attr('fill', (d) => showHeatmap ? heatColor(normArt(d)) : (ARTIFACT_FILLS[d.significance ?? 'notable'] ?? '#D97706'));

    // Artifact images — clipped to diamond shape
    // The diamond is a rect rotated 45°. To fill it fully the image must
    // cover the diagonal, so we scale by √2 and counter-rotate it upright
    // inside the rotated clip region.
    nodeGroup
      .filter((d) => !showHeatmap && d.kind === 'artifact' && !!d.imageUrl && resolvedImageUrls.has(d.imageUrl))
      .each(function (d) {
        const sel = d3.select(this);
        const sz = ARTIFACT_SIZES[d.significance ?? 'notable'] ?? 16;
        const imgSz = sz * Math.SQRT2; // cover the full diagonal
        const clipId = `clip-${d.id}`;
        defs.append('clipPath').attr('id', clipId)
          .append('rect')
          .attr('x', -sz).attr('y', -sz)
          .attr('width', sz * 2).attr('height', sz * 2)
          .attr('rx', 2)
          .attr('transform', 'rotate(45)');
        sel.append('image')
          .attr('href', resolvedImageUrls.get(d.imageUrl!)!)
          .attr('x', -imgSz).attr('y', -imgSz)
          .attr('width', imgSz * 2).attr('height', imgSz * 2)
          .attr('preserveAspectRatio', 'xMidYMid slice')
          .attr('clip-path', `url(#${clipId})`);
      });

    // ── Letter-fallback avatars ────────────────────────────────────────────
    // Entities (character / location / artifact) with no resolved image show
    // their initial centred inside the node shape — the map-style avatar
    // fallback. Skipped in heatmap mode (same as the image overlays) so the
    // heat reads clean, and skipped where an image already covers the shape.
    const hasNodeImage = (d: GraphNode) => !!d.imageUrl && resolvedImageUrls.has(d.imageUrl);
    const nodeInitial = (d: GraphNode) => d.label?.trim()?.[0]?.toUpperCase() ?? '?';
    nodeGroup
      .filter((d) => !showHeatmap && d.kind !== 'knowledge' && !hasNodeImage(d))
      .append('text')
      .attr('class', 'graph-node-initial')
      .attr('text-anchor', 'middle')
      .attr('dy', '0.34em')
      .attr('pointer-events', 'none')
      .style('font-weight', '700')
      .style('fill', 'rgba(255,255,255,0.92)')
      .style('font-size', (d) => {
        if (d.kind === 'character') {
          const r = scaleByUsage ? CHAR_MIN_R + (CHAR_MAX_R - CHAR_MIN_R) * normChar(d) : (ROLE_RADIUS[d.role ?? 'recurring'] ?? 18);
          return `${Math.round(r * 0.9)}px`;
        }
        if (d.kind === 'artifact') {
          const sz = ARTIFACT_SIZES[d.significance ?? 'notable'] ?? 16;
          return `${Math.round(sz * 0.85)}px`;
        }
        const s = LOC_MIN_SCALE + (LOC_MAX_SCALE - LOC_MIN_SCALE) * normLoc(d);
        return `${Math.round((LOCATION_SIZE * s) * 0.42)}px`;
      })
      .text((d) => nodeInitial(d));

    // Character / location labels
    nodeGroup
      .filter((d) => d.kind !== 'knowledge')
      .append('text')
      .attr('class', 'graph-label')
      .attr('text-anchor', 'middle')
      .attr('dy', (d) => {
        if (d.kind === 'character') {
          const r = CHAR_MIN_R + (CHAR_MAX_R - CHAR_MIN_R) * normChar(d);
          return r + 14;
        }
        if (d.kind === 'artifact') {
          const sz = ARTIFACT_SIZES[d.significance ?? 'notable'] ?? 10;
          return sz + 18;
        }
        const s = LOC_MIN_SCALE + (LOC_MAX_SCALE - LOC_MIN_SCALE) * normLoc(d);
        return (LOCATION_SIZE * s) / 2 + 14;
      })
      .text((d) => d.label);

    // Knowledge node labels (tiny)
    nodeGroup
      .filter((d) => d.kind === 'knowledge')
      .append('text')
      .attr('class', 'graph-label')
      .attr('text-anchor', 'middle')
      .attr('dy', 18)
      .style('font-size', '8px')
      .style('fill', '#666666')
      .text((d) => d.label);

    // ── Tick ──────────────────────────────────────────────────────────────
    simulation.on('tick', () => {
      linkSelection
        .attr('points', (d) => {
          const sx = (d.source as GraphNode).x ?? 0;
          const sy = (d.source as GraphNode).y ?? 0;
          const tx = (d.target as GraphNode).x ?? 0;
          const ty = (d.target as GraphNode).y ?? 0;
          return `${sx},${sy} ${(sx + tx) / 2},${(sy + ty) / 2} ${tx},${ty}`;
        });

      relLinkSelection
        .attr('x1', (d) => ((d.source as GraphNode).x ?? 0))
        .attr('y1', (d) => ((d.source as GraphNode).y ?? 0))
        .attr('x2', (d) => ((d.target as GraphNode).x ?? 0))
        .attr('y2', (d) => ((d.target as GraphNode).y ?? 0));

      linkLabelSelection
        .attr('x', (d) => {
          const sx = (d.source as GraphNode).x ?? 0;
          const tx = (d.target as GraphNode).x ?? 0;
          return (sx + tx) / 2;
        })
        .attr('y', (d) => {
          const sy = (d.source as GraphNode).y ?? 0;
          const ty = (d.target as GraphNode).y ?? 0;
          return (sy + ty) / 2;
        });

      nodeGroup.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    return () => {
      simulation.stop();
      simulationRef.current = null;
      gRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme, narrative, activeArcId, graphViewMode, currentWorldBuildId, showHeatmap, arcFocus, currentScene, resolvedImageUrls.size, selectedKnowledgeEntity, showCharacters, showLocations, showArtifacts, showRelationships, showTies, showSpatial, showVicinity, showMapTree]);

  // ── Lightweight: update selected node highlight + relationship edges ──
  useEffect(() => {
    const g = gRef.current;
    if (!g) return;
    g.select('g.nodes')
      .selectAll<SVGGElement, GraphNode>('g')
      .classed('node-selected', (d) => d.id === selectedNodeId);

    // Show relationship edges only for the selected character/location
    const isConnected = (d: GraphLink) => {
      if (!selectedNodeId) return false;
      const srcId = typeof d.source === 'string' ? d.source : (d.source as GraphNode).id;
      const tgtId = typeof d.target === 'string' ? d.target : (d.target as GraphNode).id;
      return srcId === selectedNodeId || tgtId === selectedNodeId;
    };

    // Highlight connected relationship edges. When nothing is selected,
    // restore the per-edge scoped opacity (current-scene focus) rather
    // than a flat bright value.
    g.select('g.links')
      .selectAll<SVGLineElement, GraphLink>('line.graph-rel-edge')
      .style('stroke-opacity', (d) => {
        if (!selectedNodeId) {
          const srcId = typeof d.source === 'string' ? d.source : (d.source as GraphNode).id;
          const tgtId = typeof d.target === 'string' ? d.target : (d.target as GraphNode).id;
          return activeSceneNodeIds.has(srcId) || activeSceneNodeIds.has(tgtId)
            ? FOCUS_OPACITY_ACTIVE
            : FOCUS_OPACITY_DIM;
        }
        return isConnected(d) ? 1 : 0.15;
      });

    // Update labels: show directional label when a node is selected
    g.select('g.link-labels')
      .selectAll<SVGTextElement, GraphLink>('text.graph-rel-label')
      .attr('fill-opacity', (d) => {
        if (!selectedNodeId) return 1;
        return isConnected(d) ? 1 : 0.3;
      })
      .text((d) => {
        if (!selectedNodeId || !d.directedLabels) return d.label ?? '';
        return d.directedLabels[selectedNodeId] ?? d.label ?? '';
      });
  }, [selectedNodeId, activeSceneNodeIds]);

  // ── Toggle edge label visibility ──
  useEffect(() => {
    const g = gRef.current;
    if (!g) return;
    g.select('g.link-labels').style('display', showEdgeLabels ? '' : 'none');
  }, [showEdgeLabels]);

  // ── Lightweight: toggle knowledge subgraph without full rebuild ──
  // Entity continuity graphs are rendered by WorldGraphView (separate component).
  // No inline D3 manipulation needed — the SVG is simply hidden when an entity is selected.
  // (Old inline knowledge expansion code removed — was corrupting D3 simulation on back nav)

  // ── Lightweight intra-arc update: character-location links on scene change ──
  useEffect(() => {
    const g = gRef.current;
    const simulation = simulationRef.current;
    if (!g || !simulation || !narrative || !activeArcId) return;

    const activeArc = narrative.arcs[activeArcId];
    if (!activeArc) return;

    const linksGroup = g.select<SVGGElement>('g.links');

    // Always wipe stale character-location polylines first; if the toggle is
    // off we leave nothing in their place.
    linksGroup.selectAll<SVGPolylineElement, GraphLink>('polyline')
      .filter((d) => d.linkKind === 'character-location')
      .remove();

    if (!showSpatial) {
      const currentLinks = (simulation.force('link') as d3.ForceLink<GraphNode, GraphLink>).links();
      const nonCharLocLinks = currentLinks.filter((l) => (l as GraphLink).linkKind !== 'character-location');
      (simulation.force('link') as d3.ForceLink<GraphNode, GraphLink>).links(nonCharLocLinks);
      simulation.on('tick.charloc', null);
      return;
    }

    const positions = computeCharacterPositions(activeArc, narrative.scenes, state.viewState.currentSceneIndex, resolvedEntryKeys);

    // Resolve new links against existing simulation nodes
    const nodeMap = new Map(nodesRef.current.map((n) => [n.id, n]));
    const resolvedNewLinks: GraphLink[] = [];
    for (const [charId, locId] of Object.entries(positions)) {
      const charNode = nodeMap.get(charId);
      const locNode = nodeMap.get(locId);
      if (charNode && locNode) {
        resolvedNewLinks.push({
          id: `charloc-${charId}-${locId}`,
          source: charNode,
          target: locNode,
          linkKind: 'character-location',
        });
      }
    }

    // Active scene-node set for the focus effect — same primitive the
    // main rebuild uses. Recomputed here because this effect runs on a
    // narrower dep set than the rebuild.
    const activeIds = new Set<string>();
    if (narrative && currentScene) {
      if (currentScene.povId) activeIds.add(currentScene.povId);
      for (const pid of currentScene.participantIds) activeIds.add(pid);
      if (currentScene.locationId) activeIds.add(currentScene.locationId);
    }
    const newLinkEls = linksGroup
      .selectAll<SVGPolylineElement, GraphLink>('polyline.charloc')
      .data(resolvedNewLinks, (d) => d.id)
      .join('polyline')
      .attr('class', 'graph-edge charloc')
      .attr('fill', 'none')
      .attr('vector-effect', 'non-scaling-stroke')
      .attr('stroke', '#3B82F6')
      // Charloc edges (character → current location) activate only when
      // the CHARACTER (source) is in the scene's active set — same
      // primitive as the main rebuild's source-keyed activation. A
      // character not in the scene shouldn't light their position edge
      // just because the destination location happens to be the scene
      // location.
      .style('opacity', (d) => {
        const srcId = (d.source as GraphNode).id;
        return activeIds.has(srcId) ? FOCUS_OPACITY_ACTIVE : FOCUS_OPACITY_DIM;
      })
      .style('stroke-width', (d) => {
        const srcId = (d.source as GraphNode).id;
        const base = edgeWidthFor(0.85);
        return activeIds.has(srcId) ? base : base * FOCUS_WIDTH_FACTOR_DIM;
      })
      .attr('marker-mid', 'url(#wg-arrow)');

    // Swap char-loc links in the simulation force
    const currentLinks = (simulation.force('link') as d3.ForceLink<GraphNode, GraphLink>).links();
    const nonCharLocLinks = currentLinks.filter((l) => (l as GraphLink).linkKind !== 'character-location');
    const allLinks = [...nonCharLocLinks, ...resolvedNewLinks];

    (simulation.force('link') as d3.ForceLink<GraphNode, GraphLink>)
      .links(allLinks);

    // Gentle reheat — no jarring re-layout
    simulation.alpha(0.1).restart();

    // Tick handler for new link elements
    simulation.on('tick.charloc', () => {
      newLinkEls
        .attr('points', (d) => {
          const sx = (d.source as GraphNode).x ?? 0;
          const sy = (d.source as GraphNode).y ?? 0;
          const tx = (d.target as GraphNode).x ?? 0;
          const ty = (d.target as GraphNode).y ?? 0;
          return `${sx},${sy} ${(sx + tx) / 2},${(sy + ty) / 2} ${tx},${ty}`;
        });
    });
    // Mirror the main rebuild's deps so char-loc lines are re-attached after
    // every full graph rebuild (arcFocus, vicinity, entity-kind toggles all
    // wipe the SVG; the char-loc layer has to follow).
  }, [narrative, activeArcId, state.viewState.currentSceneIndex, showSpatial, graphViewMode, currentWorldBuildId, showHeatmap, arcFocus, currentScene, resolvedImageUrls.size, selectedKnowledgeEntity, showCharacters, showLocations, showArtifacts, showRelationships, showTies, showVicinity, showMapTree, resolvedEntryKeys]);

  // ── Zoom to focused group ──
  useEffect(() => {
    const svg = svgRef.current;
    const zoom = zoomRef.current;
    if (!svg || !zoom || focusedGroupIndex === null || !groups[focusedGroupIndex]) return;

    const group = groups[focusedGroupIndex];
    const width = svg.clientWidth || 800;
    const height = svg.clientHeight || 600;

    // Compute bounding box of group nodes
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of group) {
      const x = n.x ?? 0;
      const y = n.y ?? 0;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }

    const padding = 80;
    minX -= padding;
    minY -= padding;
    maxX += padding;
    maxY += padding;

    const bw = maxX - minX;
    const bh = maxY - minY;
    const scale = Math.min(width / bw, height / bh, 2);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    const transform = d3.zoomIdentity
      .translate(width / 2, height / 2)
      .scale(scale)
      .translate(-cx, -cy);

    d3.select(svg)
      .transition()
      .duration(500)
      .call(zoom.transform as unknown as (t: d3.Transition<SVGSVGElement, unknown, null, undefined>) => void, transform);
  }, [focusedGroupIndex, groups]);

  const navigateGroup = useCallback(
    (direction: 'next' | 'prev' | 'reset') => {
      if (groups.length === 0) return;
      if (direction === 'reset') {
        setFocusedGroupIndex(null);
        // Reset zoom
        const svg = svgRef.current;
        const zoom = zoomRef.current;
        if (svg && zoom) {
          d3.select(svg)
            .transition()
            .duration(500)
            .call(zoom.transform as unknown as (t: d3.Transition<SVGSVGElement, unknown, null, undefined>) => void, d3.zoomIdentity);
        }
        return;
      }
      setFocusedGroupIndex((prev) => {
        if (prev === null) return 0;
        if (direction === 'next') return (prev + 1) % groups.length;
        return (prev - 1 + groups.length) % groups.length;
      });
    },
    [groups],
  );

  // No active narrative placeholder
  if (!narrative) {
    return (
      <div className="relative h-full w-full flex items-center justify-center">
        <span className="text-text-dim text-sm">
          Create a narrative to begin
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full overflow-hidden">
      {/* Legend strip — only for the World domain (any scope) when NOT viewing
          an entity's inner graph */}
      {(graphViewMode === 'world-scene' || graphViewMode === 'world-arc' || graphViewMode === 'world-full') && !selectedKnowledgeEntity && (
        <div className="shrink-0 flex items-center gap-0 px-2 h-7 border-b border-border glass-panel">
          {([
            { key: 'labels', label: 'Labels', checked: showEdgeLabels, toggle: () => setShowEdgeLabels((v) => !v) },
            { key: 'heat', label: 'Heat', checked: showHeatmap, toggle: () => setShowHeatmap((v) => !v) },
            { key: 'eval', label: 'Eval', checked: showEval, toggle: () => setShowEval((v) => !v) },
            ...(graphViewMode === 'world-scene' || graphViewMode === 'world-arc' ? [
              { key: 'focus', label: 'Arc Focus', checked: arcFocus, toggle: () => setArcFocus(!arcFocus) },
              { key: 'vicinity', label: 'Vicinity', checked: showVicinity, toggle: () => setShowVicinity((v) => !v) },
            ] : []),
          ] as { key: string; label: string; checked: boolean; toggle: () => void }[]).map(({ key, label, checked, toggle }) => (
            <button
              key={key}
              onClick={toggle}
              className={`text-[9px] px-2 py-1 rounded transition-colors select-none ${
                checked ? 'text-text-secondary' : 'text-text-dim/40 hover:text-text-dim'
              }`}
            >
              {label}
            </button>
          ))}
          <div className="w-px h-3 bg-border mx-1" />
          {([
            { key: 'chars', label: 'Characters', checked: showCharacters, toggle: () => setShowCharacters((v) => !v) },
            { key: 'locs', label: 'Locations', checked: showLocations, toggle: () => setShowLocations((v) => !v) },
            { key: 'arts', label: 'Artifacts', checked: showArtifacts, toggle: () => setShowArtifacts((v) => !v) },
          ] as { key: string; label: string; checked: boolean; toggle: () => void }[]).map(({ key, label, checked, toggle }) => (
            <button
              key={key}
              onClick={toggle}
              className={`text-[9px] px-2 py-1 rounded transition-colors select-none ${
                checked ? 'text-text-secondary' : 'text-text-dim/40 hover:text-text-dim'
              }`}
            >
              {label}
            </button>
          ))}
          <div className="w-px h-3 bg-border mx-1" />
          {([
            { key: 'rels', label: 'Relationships', checked: showRelationships, toggle: () => setShowRelationships((v) => !v) },
            { key: 'ties', label: 'Ties', checked: showTies, toggle: () => setShowTies((v) => !v) },
            { key: 'spatial', label: 'Spatial', checked: showSpatial, toggle: () => setShowSpatial((v) => !v) },
            { key: 'map', label: 'Map', checked: showMapTree, toggle: () => setShowMapTree((v) => !v) },
          ] as { key: string; label: string; checked: boolean; toggle: () => void }[]).map(({ key, label, checked, toggle }) => (
            <button
              key={key}
              onClick={toggle}
              className={`text-[9px] px-2 py-1 rounded transition-colors select-none ${
                checked ? 'text-text-secondary' : 'text-text-dim/40 hover:text-text-dim'
              }`}
            >
              {label}
            </button>
          ))}
          {showHeatmap && (
            <>
              <div className="w-px h-3 bg-border mx-1" />
              <div className="flex items-center gap-1">
                <span className="text-[8px] text-text-dim/40">Low</span>
                <div className="h-1.5 w-12 rounded-full" style={{ background: 'linear-gradient(to right, #3B82F6, #22C55E, #EF4444)' }} />
                <span className="text-[8px] text-text-dim/40">High</span>
              </div>
            </>
          )}
        </div>
      )}

      {/* Canvas area */}
      <div className="relative flex-1 overflow-hidden">
      {showEval && (graphViewMode === 'world-scene' || graphViewMode === 'world-arc' || graphViewMode === 'world-full') && <EvalBar />}
      {graphViewMode === 'plan' ? (
        currentScene ? (
          <ScenePlanView narrative={narrative} scene={currentScene} resolvedKeys={resolvedEntryKeys} />
        ) : (
          <EmptyState
            icon={IconPlan}
            title="No scene selected."
            hint="Select a scene from the timeline to view its plan."
          />
        )
      ) : graphViewMode === 'prose' ? (
        currentScene ? (
          <SceneProseView narrative={narrative} scene={currentScene} resolvedKeys={resolvedEntryKeys} />
        ) : (
          <EmptyState
            icon={IconProse}
            title="No scene selected."
            hint="Select a scene from the timeline to read its prose."
          />
        )
      ) : graphViewMode === 'audio' ? (
        currentScene ? (
          <SceneAudioView narrative={narrative} scene={currentScene} />
        ) : (
          <EmptyState
            icon={IconWaveform}
            title="No scene selected."
            hint="Select a scene from the timeline to play its audio."
          />
        )
      ) : graphViewMode === 'learning' ? (
        currentScene ? (
          <SceneLearningView narrative={narrative} scene={currentScene} />
        ) : (
          <EmptyState
            icon={IconQuestion}
            title="No scene selected."
            hint="Select a scene from the timeline to view its questions."
          />
        )
      ) : graphViewMode === 'perspective' ? (
        currentScene ? (
          <ScenePerspectivesView narrative={narrative} scene={currentScene} />
        ) : (
          <EmptyState
            icon={IconUser}
            title="No scene selected."
            hint="Select a scene from the timeline to view its perspectives."
          />
        )
      ) : graphViewMode === 'decision' ? (
        currentScene ? (
          <DecisionView narrative={narrative} scene={currentScene} />
        ) : (
          <EmptyState
            icon={IconScorecard}
            title="No scene selected."
            hint="Select a scene from the timeline to view its decision matrix."
          />
        )
      ) : graphViewMode === 'threads-scene' || graphViewMode === 'threads-arc' || graphViewMode === 'threads-full' ? (
        selectedThreadLog && narrative.threads[selectedThreadLog] ? (
          <ThreadLogGraphView
            threadId={selectedThreadLog}
            threadDescription={narrative.threads[selectedThreadLog].description}
            fullThreadLog={narrative.threads[selectedThreadLog].threadLog ?? { nodes: {}, edges: [] }}
            scenes={narrative.scenes}
            resolvedKeys={state.resolvedEntryKeys}
            currentIndex={state.viewState.currentSceneIndex}
          />
        ) : (
          <ThreadGraphView
            narrative={narrative!}
            resolvedKeys={state.resolvedEntryKeys}
            currentIndex={state.viewState.currentSceneIndex}
            mode={graphViewMode}
            onSelectThread={(id) => {
              dispatch({ type: 'SELECT_THREAD_LOG', threadId: id });
              dispatch({ type: 'SET_INSPECTOR', context: { type: 'thread', threadId: id } });
            }}
            hideControls hideLegend
          />
        )
      ) : graphViewMode === 'fate-influence' || graphViewMode === 'world-influence' || graphViewMode === 'system-influence' || graphViewMode === 'streams-influence' ? (
        // Influence — log-based alluvial of force volume over time. Source
        // (Fate / World / System / Streams) from the topbar; mode (Individual /
        // Tags), span (Full / Window), window + bucket size in the bar below.
        <SankeyView
          narrative={narrative!}
          resolvedKeys={state.resolvedEntryKeys}
          currentIndex={state.viewState.currentSceneIndex}
          source={
            graphViewMode === 'streams-influence' ? 'streams'
            : graphViewMode === 'world-influence' ? 'world'
            : graphViewMode === 'system-influence' ? 'system'
            : 'fate'
          }
          branchId={state.viewState.activeBranchId}
          onSelectThread={(id: string) => {
            dispatch({ type: 'SELECT_THREAD_LOG', threadId: id });
            dispatch({ type: 'SET_INSPECTOR', context: { type: 'thread', threadId: id } });
          }}
          onSelectStream={(id: string) => {
            dispatch({ type: 'SET_INSPECTOR', context: { type: 'stream', streamId: id } });
          }}
          onSelectEntity={(id: string) => {
            const ctx = narrative!.characters?.[id]
              ? { type: 'character' as const, characterId: id }
              : narrative!.locations?.[id]
                ? { type: 'location' as const, locationId: id }
                : narrative!.artifacts?.[id]
                  ? { type: 'artifact' as const, artifactId: id }
                  : null;
            if (ctx) dispatch({ type: 'SET_INSPECTOR', context: ctx });
          }}
        />
      ) : graphViewMode === 'search' || graphViewMode === 'vision' ? (
        // Capture canvas owns both — the sub-tab switcher inside reads the
        // mode and renders Entry or Search. Routing both modes through
        // CaptureView means external "go to search" callers land in
        // Capture/Search tab cleanly.
        <CaptureView />
      ) : graphViewMode === 'streams' ? (
        <StreamsView />
      ) : graphViewMode === 'merges' ? (
        <MergesView />
      ) : graphViewMode === 'network-scene' || graphViewMode === 'network-arc' || graphViewMode === 'network-full' ? (
        <NetworkView />
      ) : graphViewMode === 'belief' ? (
        state.viewState.beliefSource === 'stream' ? <StreamBeliefView /> : <BeliefView />
      ) : graphViewMode === 'present' ? (
        <CompassView mode="present" />
      ) : graphViewMode === 'compass' ? (
        <CompassView mode="compass" />
      ) : graphViewMode === 'mode' ? (
        <PhaseGraphView />
      ) : graphViewMode === 'curriculum' ? (
        <CurriculumView view="tree" />
      ) : graphViewMode === 'curriculum-list' ? (
        <CurriculumView view="list" />
      ) : graphViewMode === 'board' ? (
        <BoardView />
      ) : graphViewMode === 'map' ? (
        // Scene investigation takes priority. Falls back to legacy arc / world-
        // build CRGs (still produced via the coordination plan path) when the
        // current scene has no investigation of its own.
        activeMap ? (
          <ReasoningGraphView
            graph={activeMap.graph}
            arcId={activeMap.arcId}
          />
        ) : currentWorldBuildWithReasoning ? (
          <ReasoningGraphView
            graph={currentWorldBuildWithReasoning.reasoningGraph}
            worldBuildId={currentWorldBuildWithReasoning.worldBuild.id}
          />
        ) : currentArcWithReasoning ? (
          <ReasoningGraphView
            graph={currentArcWithReasoning.reasoningGraph}
            arcId={currentArcWithReasoning.arc.id}
          />
        ) : (
          <EmptyState
            icon={IconReasoning}
            title="No map yet."
            hint="Generate one from the palette."
          />
        )
      ) : graphViewMode === 'system-scene' || graphViewMode === 'system-arc' || graphViewMode === 'system-full' ? (
        <SystemGraphView
          narrative={narrative!}
          resolvedKeys={state.resolvedEntryKeys}
          currentIndex={state.viewState.currentSceneIndex}
          mode={graphViewMode}
          hideControls hideLegend
        />
      ) : selectedKnowledgeEntity ? (
        <WorldGraphView
          entityId={selectedKnowledgeEntity}
          entityName={(narrative.characters[selectedKnowledgeEntity] ?? narrative.locations[selectedKnowledgeEntity] ?? narrative.artifacts[selectedKnowledgeEntity])?.name ?? selectedKnowledgeEntity}
          world={(narrative.characters[selectedKnowledgeEntity] ?? narrative.locations[selectedKnowledgeEntity] ?? narrative.artifacts[selectedKnowledgeEntity])?.world ?? { nodes: {}, edges: [] }}
          scenes={narrative.scenes}
          resolvedKeys={resolvedEntryKeys}
          currentIndex={state.viewState.currentSceneIndex}
        />
      ) : (
        <div className="relative h-full w-full">
          {locationBackgroundUrl && !showMapTree && (
            <>
              <div
                aria-hidden="true"
                className="absolute inset-0 pointer-events-none"
                style={{
                  backgroundImage: `url(${locationBackgroundUrl})`,
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }}
              />
              <div
                aria-hidden="true"
                className="absolute inset-0 pointer-events-none bg-black/60"
              />
            </>
          )}
          <svg
            ref={svgRef}
            className="relative h-full w-full"
            style={{ background: 'transparent' }}
          />
        </div>
      )}
      {/* Group navigation (bottom-left) */}
      {(graphViewMode === 'world-scene' || graphViewMode === 'world-arc' || graphViewMode === 'world-full') && groups.length > 1 && (
        <div className="absolute bottom-4 left-2 z-10">
        <div className="flex items-center gap-1 rounded bg-bg-surface text-[11px] leading-none">
          <button
            className="px-1.5 py-1.5 text-text-dim hover:text-text-default transition-colors"
            onClick={() => navigateGroup('prev')}
            title="Previous group"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
          </button>
          <span className="text-text-dim px-0.5 tabular-nums">
            {focusedGroupIndex !== null
              ? `${focusedGroupIndex + 1}/${groups.length} (${groups[focusedGroupIndex].length})`
              : `${groups.length} groups`}
          </span>
          <button
            className="px-1.5 py-1.5 text-text-dim hover:text-text-default transition-colors"
            onClick={() => navigateGroup('next')}
            title="Next group"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
          </button>
          {focusedGroupIndex !== null && (
            <>
              <div className="w-px h-3.5 bg-border" />
              <button
                className="px-1.5 py-1.5 text-text-dim hover:text-text-default transition-colors"
                onClick={() => navigateGroup('reset')}
                title="Reset view"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" /><path d="M3 3v5h5" /></svg>
              </button>
            </>
          )}
        </div>
      </div>
      )}
      {/* Fullscreen toggle — hidden on the variable control views
          (present/compass) where the chrome is already roomy and the
          button would compete with the sidebar layout. */}
      {graphViewMode !== 'present' && graphViewMode !== 'compass' && <FullscreenButton />}
      {/* Character/location image prompt tooltip — hidden when viewing entity inner graph */}
      {nodeTooltip && !selectedKnowledgeEntity && (
        <div
          className="absolute z-40 pointer-events-none"
          style={{ left: nodeTooltip.x, top: nodeTooltip.y - 12, transform: 'translate(-50%, -100%)' }}
        >
          <div className="bg-bg-elevated border border-border rounded-lg px-3 py-2 shadow-xl max-w-sm">
            <div className="text-xs font-semibold text-text-primary mb-1 whitespace-normal wrap-break-word">{nodeTooltip.label}</div>
            <div className="text-[10px] text-text-dim leading-relaxed whitespace-normal wrap-break-word">{nodeTooltip.imagePrompt}</div>
          </div>
          <div className="flex justify-center"><div className="w-2.5 h-2.5 bg-bg-elevated border-r border-b border-border rotate-45 -mt-1.5" /></div>
        </div>
      )}
      </div>
    </div>
  );
}
