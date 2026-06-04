#!/usr/bin/env node
// Generates TREE.md — a complete XML map of the repo file structure with a
// purpose annotation per file.
//
// Fully generalisable: the structure is read from the filesystem, and each
// file's description is DERIVED from the file itself —
//   1. its leading comment / JSDoc header (the author's own one-liner), else
//   2. a heuristic from the filename + folder (e.g. "FooView.tsx" → "foo view",
//      "route.ts" under api/x → "x API route", "*.test.ts" → "test: …").
// No hand-maintained path→description map, so renames/new files just work.
// Re-run after structural changes:  node scripts/gen-tree.mjs

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const IGNORE = new Set(["node_modules", ".next", ".git", ".turbo", "dist", "out", "coverage"]);
const EXT = /\.(tsx?|mjs|mts|cjs|md)$/;

// Root docs are markdown without code headers — a tiny label set keeps them
// readable. Everything under src/ and scripts/ is derived from the files.
const DOC_LABELS = {
  "README.md": "project readme",
  "CLAUDE.md": "project instructions + engine concepts",
  "MERMAID.md": "whole-app connection diagrams (top-down)",
  "TREE.md": "this file — generated XML file-structure map",
  "ROADMAP.md": "build spec — iterative features → platform changes",
  "LANGUAGE.md": "canonical glossary / vocabulary",
  "DEFINITIONS.md": "game-theory + technical taxonomy definitions",
  "NAMING.md": "naming convention + rename plan",
  "INFRASTRUCTURE.md": "(legacy) infrastructure diagram",
};

const MAX_LEN = 110;

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const collapse = (s) => s.replace(/\s+/g, " ").trim();

/** Trim to one sentence / MAX_LEN, on a word boundary. */
function tidy(s) {
  s = collapse(s).replace(/^[-–—•*]\s*/, "");
  const dot = s.search(/[.](\s|$)/);
  if (dot >= 24 && dot <= MAX_LEN) s = s.slice(0, dot);
  if (s.length > MAX_LEN) s = s.slice(0, MAX_LEN - 1).replace(/\s\S*$/, "") + "…";
  return s.replace(/[.]$/, "");
}

/** PascalCase / kebab / snake → spaced lower words. */
function spaced(base) {
  return collapse(
    base
      .replace(/[-_]/g, " ")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2"),
  ).toLowerCase();
}

/** Pull the author's leading comment / heading from the file's top. */
function leadingComment(text, name) {
  const lines = text.split("\n");
  let i = 0;
  const skippable = (l) => {
    const t = l.trim();
    return (
      t === "" ||
      t === "'use client';" ||
      t === '"use client";' ||
      t.startsWith("#!") ||
      /^\/\/\s*(eslint|@ts-|prettier|biome)/i.test(t)
    );
  };
  while (i < lines.length && skippable(lines[i])) i++;
  const line = (lines[i] ?? "").trim();
  if (!line) return "";

  // Block comment /** … */ or /* … */
  if (line.startsWith("/*")) {
    const buf = [];
    for (let j = i; j < lines.length; j++) {
      const end = lines[j].indexOf("*/");
      let seg = end >= 0 ? lines[j].slice(0, end) : lines[j];
      seg = seg.replace(/^\s*\/\*\*?/, "").replace(/^\s*\*\/?/, "").trim();
      if (seg.startsWith("@")) break; // stop at JSDoc tags (@param, …)
      if (seg) buf.push(seg);
      if (end >= 0 || buf.length >= 6) break;
    }
    return buf.join(" "); // tidy() then clips to the first sentence / MAX_LEN
  }
  // Line comment(s)
  if (line.startsWith("//")) return line.replace(/^\/\/+\s?/, "");
  // Markdown heading / first line
  if (/\.md$/.test(name)) return line.replace(/^#+\s*/, "").replace(/^>\s*/, "");
  return "";
}

/** Heuristic when there's no usable leading comment. */
function heuristic(name, relDir) {
  const base = name.replace(/\.(tsx?|mjs|mts|cjs|md)$/, "");
  const dir = relDir.split("/").pop() || "";
  if (/\.test$/.test(base)) return `test: ${spaced(base.replace(/\.test$/, ""))}`;
  if (base === "route") return `${dir} API route`;
  if (base === "index") return `${dir} barrel`;
  if (base === "page") return `${dir || "root"} route page`;
  if (base === "layout") return "layout";
  if (base === "providers") return "provider stack";
  const suffixes = [
    ["View", "view"], ["Modal", "modal"], ["Panel", "panel"], ["Bar", "bar"],
    ["Slide", "slide"], ["Detail", "detail"], ["Chart", "chart"], ["Icons", "icon set"],
    ["Popover", "popover"], ["Dashboard", "dashboard"], ["Shell", "shell"],
    ["Context", "context"], ["Provider", "provider"],
  ];
  for (const [s, word] of suffixes) {
    if (base.endsWith(s) && base.length > s.length) return `${spaced(base.slice(0, -s.length))} ${word}`;
  }
  if (/^use[A-Z]/.test(base)) return `${spaced(base.replace(/^use/, ""))} hook`;
  return spaced(base);
}

let total = 0;
let fromComment = 0;

function describe(absPath, name, relDir) {
  if (relDir === "" && DOC_LABELS[name]) return DOC_LABELS[name];
  let text = "";
  try {
    text = readFileSync(absPath, "utf8").slice(0, 4000);
  } catch {
    /* unreadable — fall through to heuristic */
  }
  const comment = tidy(leadingComment(text, name));
  // Reject useless comments (single bare word, or too short to be informative).
  if (comment && comment.length > 6 && !/^[A-Za-z]+$/.test(comment)) {
    fromComment++;
    return comment;
  }
  return heuristic(name, relDir);
}

function walk(absDir, relDir, indent) {
  const entries = readdirSync(absDir, { withFileTypes: true })
    .filter((e) => !IGNORE.has(e.name) && !e.name.startsWith("."))
    .filter((e) => e.isDirectory() || EXT.test(e.name))
    .sort((a, b) =>
      a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name) : a.isDirectory() ? -1 : 1,
    );
  const pad = "  ".repeat(indent);
  const lines = [];
  for (const e of entries) {
    const rel = relDir ? `${relDir}/${e.name}` : e.name;
    if (e.isDirectory()) {
      const inner = walk(join(absDir, e.name), rel, indent + 1);
      if (inner.length) {
        lines.push(`${pad}<dir name="${esc(e.name)}">`);
        lines.push(...inner);
        lines.push(`${pad}</dir>`);
      }
    } else {
      total++;
      const d = describe(join(absDir, e.name), e.name, relDir);
      lines.push(d ? `${pad}<file name="${esc(e.name)}" desc="${esc(d)}"/>` : `${pad}<file name="${esc(e.name)}"/>`);
    }
  }
  return lines;
}

const body = ['<repo name="meridians">'];
body.push("  <docs>");
for (const doc of Object.keys(DOC_LABELS)) {
  if (existsSync(join(ROOT, doc))) {
    total++;
    body.push(`    <file name="${doc}" desc="${esc(DOC_LABELS[doc])}"/>`);
  }
}
body.push("  </docs>");
for (const top of ["src", "scripts"]) {
  if (!existsSync(join(ROOT, top))) continue;
  body.push(`  <dir name="${top}">`);
  body.push(...walk(join(ROOT, top), top, 2));
  body.push("  </dir>");
}
body.push("</repo>");

const out = `# Meridians — File Tree

> **Generated** by \`scripts/gen-tree.mjs\` — structure is read from the filesystem and each file's description is derived from its own leading comment (else a name-based heuristic). No hand-maintained map; re-run after adding files: \`node scripts/gen-tree.mjs\`. Companion to [MERMAID.md](MERMAID.md). Stack: Next.js 16 · React 19 · TypeScript · Tailwind v4 · D3 · IndexedDB.
>
> ${total} files · ${fromComment} described from their own header comment, the rest from filename heuristics.

\`\`\`xml
${body.join("\n")}
\`\`\`
`;

writeFileSync(join(ROOT, "TREE.md"), out);
process.stderr.write(`TREE.md written — ${total} files, ${fromComment} from header comments.\n`);
