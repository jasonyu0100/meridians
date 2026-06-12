/**
 * React hook for resolving asset references to blob URLs
 *
 * Handles:
 * - ImageRef: "img_abc123" → blob URL, "https://..." → passthrough, undefined → null
 * - AudioRef: "audio_xyz789" → blob URL, undefined → null
 * - Caching: blob URLs are cached and reused
 * - Cleanup: URLs are revoked when component unmounts
 */

import { useState, useEffect } from 'react';
import { assetManager } from '@/lib/storage/asset-manager';
import type { ImageRef, AudioRef } from '@/types/narrative';

/**
 * Resolve an ImageRef to a usable URL
 * @param imageRef Asset reference, external URL, or undefined
 * @returns Blob URL for local assets, external URL as-is, or null
 */
export function useImageUrl(imageRef: ImageRef): string | null {
  // Synchronous passthrough values (no asset resolution needed) are derived
  // during render so the effect only ever sets state from an async callback.
  const passthrough = resolvePassthroughUrl(imageRef);
  const needsResolve = imageRef && passthrough === undefined;
  const [resolved, setResolved] = useState<string | null>(null);

  useEffect(() => {
    if (!needsResolve) return;

    // Asset reference - resolve to blob URL
    // Note: blob URLs are cached and owned by assetManager — do NOT revoke here
    let cancelled = false;

    assetManager.getImageUrl(imageRef).then((resolvedUrl) => {
      if (!cancelled) {
        setResolved(resolvedUrl);
      }
    }).catch((err) => {
      console.warn(`[useImageUrl] Failed to resolve ${imageRef}:`, err);
      if (!cancelled) setResolved(null);
    });

    return () => {
      cancelled = true;
    };
  }, [imageRef, needsResolve]);

  if (passthrough !== undefined) return passthrough;
  return needsResolve ? resolved : null;
}

/**
 * Resolve an asset ref to a synchronous URL when no async lookup is needed.
 * Returns the URL for external/data refs, null for empty refs, or `undefined`
 * to signal that an async asset-manager resolution is required.
 */
function resolvePassthroughUrl(ref: ImageRef | AudioRef): string | null | undefined {
  if (!ref) return null;
  if (ref.startsWith('http://') || ref.startsWith('https://')) return ref;
  if (ref.startsWith('data:')) return ref;
  return undefined;
}

/**
 * Resolve an AudioRef to a usable URL
 * @param audioRef Asset reference or undefined
 * @returns Blob URL or null
 */
/**
 * Batch resolve multiple ImageRefs to usable URLs
 * Useful for D3 rendering where we need all URLs resolved before rendering
 * @param imageRefs Array of asset references, external URLs, or undefined
 * @returns Map of original ref → resolved URL (only includes resolved entries)
 */
export function useImageUrlMap(imageRefs: ImageRef[]): Map<string, string> {
  const [urlMap, setUrlMap] = useState<Map<string, string>>(EMPTY_URL_MAP);

  // Stable dependency using joined string (extracted so it can be statically checked)
  const refsKey = imageRefs.join(',');

  useEffect(() => {
    // Filter to only refs that need resolution. `refsKey` is the join of
    // `imageRefs` and is the real dependency; we read the array here for the
    // exact values (a ref may contain commas, so we can't split refsKey).
    const refsToResolve = imageRefs.filter((ref): ref is string => !!ref);
    if (refsToResolve.length === 0) {
      // Reset to the shared empty map only when we're not already empty,
      // so the effect doesn't set state synchronously on every render.
      setUrlMap((prev) => (prev.size === 0 ? prev : EMPTY_URL_MAP));
      return;
    }

    let cancelled = false;

    // Resolve all refs in parallel
    Promise.all(
      refsToResolve.map(async (ref) => {
        // External URL - use as-is
        if (ref.startsWith('http://') || ref.startsWith('https://')) {
          return { ref, url: ref };
        }
        // Data URL - use as-is
        if (ref.startsWith('data:')) {
          return { ref, url: ref };
        }
        // Asset reference - resolve
        try {
          const url = await assetManager.getImageUrl(ref);
          return { ref, url };
        } catch {
          return { ref, url: null };
        }
      })
    ).then((results) => {
      if (cancelled) return;
      const newMap = new Map<string, string>();
      for (const { ref, url } of results) {
        if (url) newMap.set(ref, url);
      }
      setUrlMap(newMap);
    });

    return () => {
      cancelled = true;
    };
    // refsKey is the stable serialization of imageRefs; imageRefs itself is
    // read inside but is a new array each render, so we key off refsKey only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refsKey]);

  return urlMap;
}

/** Shared empty map so the "no refs" path doesn't allocate or trigger renders. */
const EMPTY_URL_MAP: Map<string, string> = new Map();

/**
 * Resolve an AudioRef to a usable URL
 * @param audioRef Asset reference or undefined
 * @returns Blob URL or null
 */
export function useAudioUrl(audioRef: AudioRef): string | null {
  // Data URLs / empty refs resolve synchronously during render; only true
  // asset references need the async effect (which sets state in its callback).
  const passthrough = audioRef
    ? audioRef.startsWith('data:')
      ? audioRef
      : undefined
    : null;
  const needsResolve = !!audioRef && passthrough === undefined;
  const [resolved, setResolved] = useState<string | null>(null);

  useEffect(() => {
    if (!needsResolve) return;

    // Asset reference - resolve to blob URL
    // Note: blob URLs are cached and owned by assetManager — do NOT revoke here
    let cancelled = false;

    assetManager.getAudioUrl(audioRef).then((resolvedUrl) => {
      if (!cancelled) {
        setResolved(resolvedUrl);
      }
    }).catch((err) => {
      console.warn(`[useAudioUrl] Failed to resolve ${audioRef}:`, err);
      if (!cancelled) setResolved(null);
    });

    return () => {
      cancelled = true;
    };
  }, [audioRef, needsResolve]);

  if (passthrough !== undefined) return passthrough;
  return needsResolve ? resolved : null;
}
