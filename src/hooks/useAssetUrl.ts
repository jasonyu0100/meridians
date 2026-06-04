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
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!imageRef) {
      setUrl(null);
      return;
    }

    // External URL (starts with http:// or https://) - use as-is
    if (imageRef.startsWith('http://') || imageRef.startsWith('https://')) {
      setUrl(imageRef);
      return;
    }

    // Data URL (base64) - use as-is (legacy support)
    if (imageRef.startsWith('data:')) {
      setUrl(imageRef);
      return;
    }

    // Asset reference - resolve to blob URL
    // Note: blob URLs are cached and owned by assetManager — do NOT revoke here
    let cancelled = false;

    assetManager.getImageUrl(imageRef).then((resolvedUrl) => {
      if (!cancelled) {
        setUrl(resolvedUrl);
      }
    }).catch((err) => {
      console.warn(`[useImageUrl] Failed to resolve ${imageRef}:`, err);
      if (!cancelled) setUrl(null);
    });

    return () => {
      cancelled = true;
    };
  }, [imageRef]);

  return url;
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
  const [urlMap, setUrlMap] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    // Filter to only refs that need resolution
    const refsToResolve = imageRefs.filter((ref): ref is string => !!ref);
    if (refsToResolve.length === 0) {
      setUrlMap(new Map());
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
  }, [imageRefs.join(',')]); // Stable dependency using joined string

  return urlMap;
}

/**
 * Resolve an AudioRef to a usable URL
 * @param audioRef Asset reference or undefined
 * @returns Blob URL or null
 */
export function useAudioUrl(audioRef: AudioRef): string | null {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!audioRef) {
      setUrl(null);
      return;
    }

    // Data URL (base64) - use as-is (legacy support)
    if (audioRef.startsWith('data:')) {
      setUrl(audioRef);
      return;
    }

    // Asset reference - resolve to blob URL
    // Note: blob URLs are cached and owned by assetManager — do NOT revoke here
    let cancelled = false;

    assetManager.getAudioUrl(audioRef).then((resolvedUrl) => {
      if (!cancelled) {
        setUrl(resolvedUrl);
      }
    }).catch((err) => {
      console.warn(`[useAudioUrl] Failed to resolve ${audioRef}:`, err);
      if (!cancelled) setUrl(null);
    });

    return () => {
      cancelled = true;
    };
  }, [audioRef]);

  return url;
}
