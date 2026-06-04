"use client";
// CopyButton — button that copies text to the clipboard with transient confirmation state.

import { useState } from "react";
import { copyToClipboard } from "@/lib/utils/clipboard";

/**
 * Copy-to-clipboard button with a brief "Copied" confirmation. Used by
 * research panels (surveys, interviews) and the canvas top bar. `getText`
 * is a thunk so the caller can format the payload lazily on click — no
 * Markdown generation happens until the user actually presses the button.
 */
export function CopyButton({
  getText,
  label = "Copy",
  title = "Copy as Markdown",
  className,
}: {
  getText: () => string;
  label?: string;
  title?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  const onClick = async () => {
    const ok = await copyToClipboard(getText());
    if (!ok) return;
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <button
      onClick={onClick}
      className={
        className ??
        "text-[10px] px-2 py-1 rounded text-text-dim hover:text-text-primary hover:bg-white/5 transition-colors"
      }
      title={title}
    >
      {copied ? "Copied" : label}
    </button>
  );
}
