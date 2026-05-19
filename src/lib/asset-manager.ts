/**
 * Asset Manager — decoupled storage for large binary assets.
 *
 * Narrative JSON only stores references (`emb_…`, `audio_…`, `img_…`,
 * `text_…`); the binary/large payloads live in IndexedDB. As of the
 * inktide-main consolidation the asset stores live alongside
 * narratives/meta/apiLogs in the single shared database — see
 * `src/lib/db.ts` for the canonical schema. This module is a typed
 * façade over those stores.
 */

import type { IDBPDatabase } from 'idb';
import { nanoid } from 'nanoid';
import { openMainDB, type MainDB } from '@/lib/db';
import { logError } from '@/lib/system-logger';

// ── Asset Manager ─────────────────────────────────────────────────────────────

class AssetManager {
  // Blob URL cache (for audio/images)
  private blobUrlCache = new Map<string, string>();

  // ── Initialization ──────────────────────────────────────────────────────────

  /** Open (or reuse) the shared inktide-main connection. Idempotent
   *  via `openMainDB`'s memoised promise — repeated calls return the
   *  same handle. Kept on the class surface because legacy callers
   *  (TopBar, audio-store, MediaDrive, file-conversion) explicitly
   *  `await assetManager.init()` before their first asset op. */
  async init(): Promise<void> {
    await openMainDB();
  }

  /** Get the shared DB handle. All public methods delegate here, so
   *  callers that forgot to call `init()` still work — the first
   *  operation opens the connection lazily. */
  private async db(): Promise<IDBPDatabase<MainDB>> {
    return openMainDB();
  }

  // ── Embeddings ──────────────────────────────────────────────────────────────

  /**
   * Store an embedding vector and return its ID reference
   * @param vector - 1536-dim embedding array
   * @param model - Model name (default: "text-embedding-3-small")
   * @param id - Optional ID (for imports)
   * @returns ID reference like "emb_abc123"
   */
  async storeEmbedding(
    vector: number[],
    model: string = 'text-embedding-3-small',
    id?: string,
    narrativeId: string = 'global',
  ): Promise<string> {
    const db = await this.db();

    const embeddingId = id || this.generateId('emb');
    const entry = {
      id: embeddingId,
      vector: new Float32Array(vector),
      model,
      narrativeId,
      createdAt: Date.now(),
    };

    await db.put('embeddings', entry);
    return embeddingId;
  }

  /**
   * Retrieve an embedding vector by ID
   * @param id - ID like "emb_abc123"
   * @returns Embedding array or null if not found
   */
  async getEmbedding(id: string): Promise<number[] | null> {
    const db = await this.db();
    const entry = await db.get('embeddings', id);

    if (!entry) return null;

    // Convert Float32Array back to regular array
    return Array.from(entry.vector);
  }

  /**
   * Retrieve multiple embeddings at once (batch operation)
   * @param ids - Array of IDs
   * @returns Map of ID → embedding array
   */
  async getEmbeddingsBatch(ids: string[]): Promise<Map<string, number[]>> {
    const db = await this.db();
    const results = new Map<string, number[]>();

    await Promise.all(
      ids.map(async (id) => {
        const entry = await db.get('embeddings', id);
        if (entry) {
          results.set(id, Array.from(entry.vector));
        }
      }),
    );

    return results;
  }

  /**
   * Delete an embedding by ID
   */
  async deleteEmbedding(id: string): Promise<void> {
    const db = await this.db();
    await db.delete('embeddings', id);
  }

  // ── Audio ───────────────────────────────────────────────────────────────────

  /**
   * Store audio blob and return its ID reference
   * @param blob - Audio blob (MP3, WAV, etc.)
   * @param format - MIME type (e.g., "audio/mp3")
   * @param id - Optional ID (for imports)
   * @param narrativeId - Narrative ID (default: 'global')
   * @returns ID reference like "audio_xyz789"
   */
  async storeAudio(blob: Blob, format?: string, id?: string, narrativeId: string = 'global'): Promise<string> {
    const db = await this.db();

    const audioId = id || this.generateId('audio');
    const entry = {
      id: audioId,
      blob,
      format: format || blob.type,
      narrativeId,
      createdAt: Date.now(),
    };

    await db.put('audio', entry);
    return audioId;
  }

  /**
   * Retrieve audio blob by ID
   */
  async getAudio(id: string): Promise<Blob | null> {
    const db = await this.db();
    const entry = await db.get('audio', id);
    return entry?.blob || null;
  }

  /**
   * Get audio as a blob URL (for <audio> elements)
   * - Creates blob URL on first call
   * - Caches URL for subsequent calls
   * - Call revokeBlobUrls() to clean up
   */
  async getAudioUrl(id: string): Promise<string | null> {
    // Check cache first
    if (this.blobUrlCache.has(id)) {
      return this.blobUrlCache.get(id)!;
    }

    // Fetch blob and create URL
    const blob = await this.getAudio(id);
    if (!blob) return null;

    const url = URL.createObjectURL(blob);
    this.blobUrlCache.set(id, url);
    return url;
  }

  /**
   * Delete audio by ID
   */
  async deleteAudio(id: string): Promise<void> {
    const db = await this.db();
    await db.delete('audio', id);

    // Revoke blob URL if cached
    if (this.blobUrlCache.has(id)) {
      URL.revokeObjectURL(this.blobUrlCache.get(id)!);
      this.blobUrlCache.delete(id);
    }
  }

  // ── Images ──────────────────────────────────────────────────────────────────

  /**
   * Store image blob and return its ID reference
   * @param blob - Image blob (PNG, JPG, etc.)
   * @param format - MIME type (e.g., "image/png")
   * @param id - Optional ID (for imports)
   * @param narrativeId - Narrative ID (default: 'global')
   * @returns ID reference like "img_def456"
   */
  async storeImage(blob: Blob, format?: string, id?: string, narrativeId: string = 'global'): Promise<string> {
    const db = await this.db();

    const imageId = id || this.generateId('img');
    const entry = {
      id: imageId,
      blob,
      format: format || blob.type,
      narrativeId,
      createdAt: Date.now(),
    };

    await db.put('images', entry);
    return imageId;
  }

  /**
   * Retrieve image blob by ID
   */
  async getImage(id: string): Promise<Blob | null> {
    const db = await this.db();
    const entry = await db.get('images', id);
    return entry?.blob || null;
  }

  /**
   * Get image as a blob URL (for <img> elements)
   */
  async getImageUrl(id: string): Promise<string | null> {
    // Check cache first
    if (this.blobUrlCache.has(id)) {
      return this.blobUrlCache.get(id)!;
    }

    // Fetch blob and create URL
    const blob = await this.getImage(id);
    if (!blob) return null;

    const url = URL.createObjectURL(blob);
    this.blobUrlCache.set(id, url);
    return url;
  }

  /**
   * Delete image by ID
   */
  async deleteImage(id: string): Promise<void> {
    const db = await this.db();
    await db.delete('images', id);

    // Revoke blob URL if cached
    if (this.blobUrlCache.has(id)) {
      URL.revokeObjectURL(this.blobUrlCache.get(id)!);
      this.blobUrlCache.delete(id);
    }
  }

  // ── Texts ───────────────────────────────────────────────────────────────────

  /**
   * Store a source-text body (analysis corpus, extension upload) and
   * return its ID reference. Plain strings — no blob URL caching since
   * we read these into the file modal on open, not lazily.
   */
  async storeText(content: string, id?: string, narrativeId: string = 'global'): Promise<string> {
    const db = await this.db();
    const textId = id || this.generateId('text');
    const entry = {
      id: textId,
      content,
      narrativeId,
      createdAt: Date.now(),
    };
    await db.put('texts', entry);
    return textId;
  }

  /** Retrieve source text by ID. Returns null if missing. */
  async getText(id: string): Promise<string | null> {
    const db = await this.db();
    const entry = await db.get('texts', id);
    return entry?.content ?? null;
  }

  /** Delete source text by ID. */
  async deleteText(id: string): Promise<void> {
    const db = await this.db();
    await db.delete('texts', id);
  }

  // ── Cleanup & Utilities ─────────────────────────────────────────────────────

  /**
   * Get all asset IDs currently stored
   */
  async getAllAssetIds(): Promise<{
    embeddings: string[];
    audio: string[];
    images: string[];
    texts: string[];
  }> {
    const db = await this.db();

    const [embeddings, audio, images, texts] = await Promise.all([
      db.getAllKeys('embeddings'),
      db.getAllKeys('audio'),
      db.getAllKeys('images'),
      db.getAllKeys('texts'),
    ]);

    return { embeddings, audio, images, texts };
  }

  /**
   * Delete assets not referenced in the narrative
   * (Garbage collection for unused assets)
   */
  async pruneUnreferencedAssets(referencedIds: {
    embeddings: Set<string>;
    audio: Set<string>;
    images: Set<string>;
    texts: Set<string>;
  }): Promise<{ deletedCount: number }> {
    const db = await this.db();
    const allIds = await this.getAllAssetIds();

    let deletedCount = 0;

    // Delete unreferenced embeddings
    for (const embId of allIds.embeddings) {
      if (!referencedIds.embeddings.has(embId)) {
        await db.delete('embeddings', embId);
        deletedCount++;
      }
    }

    // Delete unreferenced audio
    for (const audioId of allIds.audio) {
      if (!referencedIds.audio.has(audioId)) {
        await this.deleteAudio(audioId); // Use deleteAudio to revoke blob URLs
        deletedCount++;
      }
    }

    // Delete unreferenced images
    for (const imgId of allIds.images) {
      if (!referencedIds.images.has(imgId)) {
        await this.deleteImage(imgId); // Use deleteImage to revoke blob URLs
        deletedCount++;
      }
    }

    // Delete unreferenced texts
    for (const textId of allIds.texts) {
      if (!referencedIds.texts.has(textId)) {
        await db.delete('texts', textId);
        deletedCount++;
      }
    }

    return { deletedCount };
  }

  /**
   * Revoke all cached blob URLs
   * Call this when closing the app or switching narratives
   */
  revokeBlobUrls(): void {
    for (const url of this.blobUrlCache.values()) {
      URL.revokeObjectURL(url);
    }
    this.blobUrlCache.clear();
  }

  /**
   * Clear all assets (DANGER: destructive)
   */
  async clearAllAssets(): Promise<void> {
    const db = await this.db();
    await Promise.all([
      db.clear('embeddings'),
      db.clear('audio'),
      db.clear('images'),
      db.clear('texts'),
    ]);
    this.revokeBlobUrls();
  }

  /**
   * Delete all assets for a specific narrative
   * @param narrativeId - The narrative ID to delete assets for
   * @returns Count of deleted assets
   */
  async deleteNarrativeAssets(narrativeId: string): Promise<{ embeddingCount: number; audioCount: number; imageCount: number; textCount: number }> {
    const db = await this.db();

    let embeddingCount = 0;
    let audioCount = 0;
    let imageCount = 0;
    let textCount = 0;

    // Delete embeddings for this narrative
    const embeddingIds = await db.getAllKeysFromIndex('embeddings', 'by-narrative', narrativeId);
    for (const id of embeddingIds) {
      await this.deleteEmbedding(id as string);
      embeddingCount++;
    }

    // Delete audio for this narrative
    const audioIds = await db.getAllKeysFromIndex('audio', 'by-narrative', narrativeId);
    for (const id of audioIds) {
      await this.deleteAudio(id as string);
      audioCount++;
    }

    // Delete images for this narrative
    const imageIds = await db.getAllKeysFromIndex('images', 'by-narrative', narrativeId);
    for (const id of imageIds) {
      await this.deleteImage(id as string);
      imageCount++;
    }

    // Delete texts for this narrative
    const textIds = await db.getAllKeysFromIndex('texts', 'by-narrative', narrativeId);
    for (const id of textIds) {
      await db.delete('texts', id as string);
      textCount++;
    }

    return { embeddingCount, audioCount, imageCount, textCount };
  }

  // ── Private Helpers ─────────────────────────────────────────────────────────

  private generateId(prefix: string): string {
    // Format: "emb_abc123" (10 chars total)
    return `${prefix}_${nanoid(6)}`;
  }
}

// ── Export Singleton Instance ─────────────────────────────────────────────────

export const assetManager = new AssetManager();

// Auto-initialize on import (browser environment only)
if (typeof window !== 'undefined') {
  assetManager.init().catch((err) => {
    logError('Failed to initialize AssetManager', err, {
      source: 'asset',
      operation: 'init',
    });
  });
}
