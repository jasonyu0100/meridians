"use client";

import { useState, useMemo } from "react";
import type { ProseVersion, PlanVersion } from "@/types/narrative";

type VersionTreeNode = {
  version: string;
  versionType: "generate" | "rewrite" | "edit";
  timestamp: number;
  children: VersionTreeNode[];
  data: ProseVersion | PlanVersion;
};

function buildVersionTree<T extends ProseVersion | PlanVersion>(
  versions: T[]
): VersionTreeNode[] {
  // Sort versions by timestamp
  const sorted = [...versions].sort((a, b) => a.timestamp - b.timestamp);

  // Group by major version
  const majorGroups = new Map<string, T[]>();
  for (const v of sorted) {
    const major = v.version.split(".")[0];
    const existing = majorGroups.get(major) ?? [];
    existing.push(v);
    majorGroups.set(major, existing);
  }

  // Build tree structure
  const tree: VersionTreeNode[] = [];

  for (const [major, versions] of majorGroups) {
    // Find the major version (no minor)
    const majorVersion = versions.find((v) => v.version === major);
    const minorVersions = versions.filter(
      (v) => v.version !== major && v.version.split(".").length === 2
    );
    const editVersions = versions.filter(
      (v) => v.version.split(".").length === 3
    );

    // Build minor children
    const minorNodes: VersionTreeNode[] = [];

    // Group edits by their minor version
    const editsByMinor = new Map<string, T[]>();
    for (const ev of editVersions) {
      const parts = ev.version.split(".");
      const minorKey = `${parts[0]}.${parts[1]}`;
      const existing = editsByMinor.get(minorKey) ?? [];
      existing.push(ev);
      editsByMinor.set(minorKey, existing);
    }

    for (const mv of minorVersions) {
      const editsForMinor = editsByMinor.get(mv.version) ?? [];
      minorNodes.push({
        version: mv.version,
        versionType: mv.versionType,
        timestamp: mv.timestamp,
        data: mv,
        children: editsForMinor.map((ev) => ({
          version: ev.version,
          versionType: ev.versionType,
          timestamp: ev.timestamp,
          data: ev,
          children: [],
        })),
      });
    }

    // Also check for edits on the major version directly (e.g., V1.0.1)
    const editsOnMajor = editVersions.filter((ev) => {
      const parts = ev.version.split(".");
      return parts[1] === "0";
    });

    if (majorVersion) {
      tree.push({
        version: majorVersion.version,
        versionType: majorVersion.versionType,
        timestamp: majorVersion.timestamp,
        data: majorVersion,
        children: [
          ...editsOnMajor.map((ev) => ({
            version: ev.version,
            versionType: ev.versionType,
            timestamp: ev.timestamp,
            data: ev,
            children: [],
          })),
          ...minorNodes,
        ],
      });
    } else if (minorNodes.length > 0) {
      // No major version node, just minors
      for (const mn of minorNodes) {
        tree.push(mn);
      }
    }
  }

  return tree;
}

const VERSION_TYPE_COLORS = {
  generate: "text-emerald-400",
  rewrite: "text-sky-400",
  edit: "text-amber-400",
};

// Softer variant for label text so the type colour still reads but doesn't
// fight with the white V-number. Written as full Tailwind classes so the
// JIT can statically detect them (string-concat would silently drop).
const VERSION_TYPE_LABEL_COLORS = {
  generate: "text-emerald-400/80",
  rewrite: "text-sky-400/80",
  edit: "text-amber-400/80",
};

const VERSION_TYPE_BG_COLORS = {
  generate: "bg-emerald-400",
  rewrite: "bg-sky-400",
  edit: "bg-amber-400",
};

// Left-border accent for the active version — mirrors the type's hue so the
// active state communicates both "selected" AND "which type" simultaneously.
const VERSION_TYPE_BORDER_COLORS = {
  generate: "border-emerald-400/70",
  rewrite: "border-sky-400/70",
  edit: "border-amber-400/70",
};

const VERSION_TYPE_LABELS = {
  generate: "Gen",
  rewrite: "Rewrite",
  edit: "Edit",
};

function VersionNode({
  node,
  currentVersion,
  pinnedVersion,
  depth,
  onSelect,
  onPin,
  type,
  planVersions,
}: {
  node: VersionTreeNode;
  currentVersion: string | undefined;
  pinnedVersion: string | undefined;
  depth: number;
  onSelect: (version: string) => void;
  onPin: (version: string | undefined) => void;
  type: "prose" | "plan";
  planVersions?: PlanVersion[];
}) {
  const [expanded, setExpanded] = useState(true);
  const isActive = currentVersion === node.version;
  const isPinned = pinnedVersion === node.version;
  const hasChildren = node.children.length > 0;

  const date = new Date(node.timestamp);
  const dateStr = date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });

  // For prose versions, show the source plan version
  const sourcePlanVersion =
    type === "prose" ? (node.data as ProseVersion).sourcePlanVersion : undefined;

  // Active state earns a coloured left border in the version type's hue so
  // "what version am I on?" and "what kind of version is it?" read at a
  // glance from the same affordance.
  const activeAccentBorder = VERSION_TYPE_BORDER_COLORS[node.versionType];

  return (
    <div className="select-none">
      <div
        className={`group relative flex items-center gap-2 pr-2.5 py-1.5 rounded-md cursor-pointer transition-all border-l-2 ${
          isActive
            ? `bg-white/8 text-text-primary shadow-sm ${activeAccentBorder}`
            : isPinned
              ? "bg-amber-400/5 text-text-secondary border-transparent"
              : "hover:bg-white/4 text-text-secondary border-transparent"
        }`}
        style={{ paddingLeft: `${depth * 12 + 10}px` }}
        onClick={() => onSelect(node.version)}
      >
        {/* Expand/collapse indicator */}
        {hasChildren ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              setExpanded(!expanded);
            }}
            className="w-3 h-3 flex items-center justify-center text-text-dim/60 hover:text-text-secondary transition-colors"
          >
            <svg className="w-2 h-2" fill="currentColor" viewBox="0 0 8 8">
              <path d={expanded ? "M1 2.5 L4 5.5 L7 2.5" : "M2.5 1 L5.5 4 L2.5 7"} strokeWidth="1.5" stroke="currentColor" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ) : (
          <span className="w-3" />
        )}

        {/* Version number with colour indicator */}
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${VERSION_TYPE_BG_COLORS[node.versionType]}`} />
          <span className="text-[11px] font-mono font-medium text-text-primary">
            V{node.version}
          </span>
        </div>

        {/* Type label — coloured + readable (was text-[8px] dim/40). */}
        <span className={`text-[9px] uppercase tracking-wider font-medium ${VERSION_TYPE_LABEL_COLORS[node.versionType]}`}>
          {VERSION_TYPE_LABELS[node.versionType]}
        </span>

        {/* Source plan reference */}
        {sourcePlanVersion && (
          <span className="text-[9px] text-text-dim/70 font-mono" title={`Generated from Plan V${sourcePlanVersion}`}>
            P{sourcePlanVersion}
          </span>
        )}

        <div className="flex-1" />

        {/* Timestamp */}
        <span className="text-[9px] text-text-dim/70 font-mono tabular-nums">
          {dateStr}
        </span>

        {/* Pin button — visible when pinned (filled), hover-only otherwise.
            Doubles as the pin-state indicator; no separate dot needed. */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onPin(isPinned ? undefined : node.version);
          }}
          className={`w-4 h-4 flex items-center justify-center rounded transition-all ${
            isPinned
              ? "text-amber-400/70"
              : "text-text-dim/30 opacity-0 group-hover:opacity-100 hover:text-amber-400/80"
          }`}
          title={isPinned ? "Unpin version" : "Pin version"}
        >
          <svg className="w-3 h-3" viewBox="0 0 12 12" fill={isPinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5">
            <circle cx="6" cy="6" r="4" />
          </svg>
        </button>
      </div>

      {expanded && hasChildren && (
        <div className="mt-0.5">
          {node.children.map((child) => (
            <VersionNode
              key={child.version}
              node={child}
              currentVersion={currentVersion}
              pinnedVersion={pinnedVersion}
              depth={depth + 1}
              onSelect={onSelect}
              onPin={onPin}
              type={type}
              planVersions={planVersions}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function VersionHistoryTree({
  versions,
  currentVersion,
  pinnedVersion,
  onSelectVersion,
  onPinVersion,
  type,
  planVersions,
}: {
  versions: ProseVersion[] | PlanVersion[];
  currentVersion: string | undefined;
  pinnedVersion: string | undefined;
  onSelectVersion: (version: string) => void;
  onPinVersion: (version: string | undefined) => void;
  type: "prose" | "plan";
  planVersions?: PlanVersion[];
}) {
  const tree = useMemo(
    () => buildVersionTree(versions as (ProseVersion | PlanVersion)[]),
    [versions],
  );

  if (versions.length === 0) {
    return (
      <div className="text-[11px] text-text-dim/60 py-4 text-center">
        No version history yet
      </div>
    );
  }

  return (
    <div className="py-2">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 mb-2">
        <span className="text-[10px] uppercase tracking-wider text-text-secondary font-semibold">
          {type === "prose" ? "Prose" : "Plan"} Versions
        </span>
        <span className="text-[10px] text-text-dim/70 font-mono">({versions.length})</span>
        {pinnedVersion && (
          <div className="flex items-center gap-1 ml-auto">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            <span className="text-[10px] text-amber-400/80 font-mono">V{pinnedVersion}</span>
          </div>
        )}
      </div>

      {/* Version list */}
      <div className="space-y-0.5 max-h-80 overflow-y-auto px-1" style={{ scrollbarWidth: "thin" }}>
        {tree.map((node) => (
          <VersionNode
            key={node.version}
            node={node}
            currentVersion={currentVersion}
            pinnedVersion={pinnedVersion}
            depth={0}
            onSelect={onSelectVersion}
            onPin={onPinVersion}
            type={type}
            planVersions={planVersions}
          />
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-3 px-3 pt-2.5 border-t border-white/8">
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${VERSION_TYPE_BG_COLORS.generate}`} />
          <span className={`text-[10px] font-medium ${VERSION_TYPE_LABEL_COLORS.generate}`}>Gen</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${VERSION_TYPE_BG_COLORS.rewrite}`} />
          <span className={`text-[10px] font-medium ${VERSION_TYPE_LABEL_COLORS.rewrite}`}>Rewrite</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${VERSION_TYPE_BG_COLORS.edit}`} />
          <span className={`text-[10px] font-medium ${VERSION_TYPE_LABEL_COLORS.edit}`}>Edit</span>
        </div>
      </div>
    </div>
  );
}

/** Compact version badge for displaying current version */
export function VersionBadge({
  version,
  versionType,
  isPinned,
  onClick,
}: {
  version: string | undefined;
  versionType?: "generate" | "rewrite" | "edit";
  isPinned?: boolean;
  onClick?: () => void;
}) {
  if (!version) return null;

  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[9px] font-mono transition-colors ${
        onClick ? "hover:bg-white/10 cursor-pointer" : ""
      } ${isPinned ? "ring-1 ring-inset ring-amber-400/40" : ""}`}
    >
      <span className={versionType ? VERSION_TYPE_COLORS[versionType] : "text-text-dim"}>
        V{version}
      </span>
      {isPinned && <span className="text-amber-400">{"\u25C9"}</span>}
    </button>
  );
}
