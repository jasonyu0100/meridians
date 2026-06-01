/**
 * Audio blob storage — uses meridians-assets IndexedDB for binary storage.
 *
 * Scene.audioUrl stores asset IDs like "audio_xyz789" to reference the blob.
 */

import { assetManager } from './asset-manager';

/** Save audio blob to asset manager. Returns the asset ID to store on the scene. */
export async function saveAudioBlob(blob: Blob, narrativeId: string = 'global'): Promise<string> {
  await assetManager.init();
  return assetManager.storeAudio(blob, blob.type, undefined, narrativeId);
}

/** Load audio blob and return an object URL for instant playback. Returns null if not found. */
export async function resolveAudioUrl(audioUrl: string): Promise<string | null> {
  if (!audioUrl || !audioUrl.startsWith('audio_')) return null;
  try {
    await assetManager.init();
    return assetManager.getAudioUrl(audioUrl);
  } catch {
    return null;
  }
}

/** Delete audio blob from asset manager */
export async function deleteAudioBlob(audioId: string): Promise<void> {
  if (!audioId || !audioId.startsWith('audio_')) return;
  try {
    await assetManager.init();
    await assetManager.deleteAudio(audioId);
  } catch {
    // ignore
  }
}
