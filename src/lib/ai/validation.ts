/**
 * Validation utilities for AI API responses
 * Ensures LLM outputs match expected types before accepting results
 */

import type { BeatPlan } from '@/types/narrative';
import { logWarning, logError, logInfo, type LogContext } from '@/lib/core/system-logger';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validates beat function values
 */
const VALID_BEAT_FUNCTIONS = [
  'breathe',
  'inform',
  'advance',
  'bond',
  'turn',
  'reveal',
  'shift',
  'expand',
  'foreshadow',
  'resolve',
] as const;

/**
 * Validates beat mechanism values
 */
const VALID_BEAT_MECHANISMS = [
  'dialogue',
  'thought',
  'action',
  'environment',
  'narration',
  'memory',
  'document',
  'comic',
] as const;

/**
 * Validates a single beat structure
 */
function validateBeat(beat: unknown, index: number): string[] {
  const errors: string[] = [];

  if (!beat || typeof beat !== 'object') {
    errors.push(`Beat ${index}: not an object`);
    return errors;
  }

  const b = beat as Record<string, unknown>;

  // Required fields
  if (!b.fn || typeof b.fn !== 'string') {
    errors.push(`Beat ${index}: missing or invalid 'fn' field`);
  } else if (!(VALID_BEAT_FUNCTIONS as readonly string[]).includes(b.fn)) {
    errors.push(`Beat ${index}: invalid fn value '${b.fn}'. Must be one of: ${VALID_BEAT_FUNCTIONS.join(', ')}`);
  }

  if (!b.mechanism || typeof b.mechanism !== 'string') {
    errors.push(`Beat ${index}: missing or invalid 'mechanism' field`);
  } else if (!(VALID_BEAT_MECHANISMS as readonly string[]).includes(b.mechanism)) {
    errors.push(`Beat ${index}: invalid mechanism value '${b.mechanism}'. Must be one of: ${VALID_BEAT_MECHANISMS.join(', ')}`);
  }

  if (!b.what || typeof b.what !== 'string') {
    errors.push(`Beat ${index}: missing or invalid 'what' field`);
  } else if (b.what.trim().length < 5) {
    // Very lenient - just ensure it's not completely empty
    errors.push(`Beat ${index}: 'what' field too short (${b.what.length} chars)`);
  }

  // Optional but recommended paragraph indices
  if (b.startPara !== undefined && typeof b.startPara !== 'number') {
    errors.push(`Beat ${index}: 'startPara' must be a number if provided`);
  }

  if (b.endPara !== undefined && typeof b.endPara !== 'number') {
    errors.push(`Beat ${index}: 'endPara' must be a number if provided`);
  }

  if (
    typeof b.startPara === 'number' &&
    typeof b.endPara === 'number' &&
    b.endPara < b.startPara
  ) {
    errors.push(`Beat ${index}: endPara (${b.endPara}) < startPara (${b.startPara})`);
  }

  // Validate propositions if present - be lenient, these are supplementary
  if (b.propositions !== undefined && !Array.isArray(b.propositions)) {
    errors.push(`Beat ${index}: 'propositions' must be an array if provided`);
  }

  return errors;
}

/**
 * Validates beat plan structure
 */
export function validateBeatPlan(data: unknown): ValidationResult {
  const errors: string[] = [];

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Response is not an object'] };
  }

  const beats = (data as { beats?: unknown }).beats;
  if (!beats || !Array.isArray(beats)) {
    return { valid: false, errors: ['Missing or invalid beats array'] };
  }

  if (beats.length === 0) {
    return { valid: false, errors: ['Beats array is empty - no beats extracted'] };
  }

  // Validate each beat
  beats.forEach((beat: unknown, index: number) => {
    const beatErrors = validateBeat(beat, index);
    errors.push(...beatErrors);
  });

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validates beat prose map structure
 * BeatProseMap has: { chunks: BeatProse[], createdAt: number }
 * where BeatProse = { beat, prose }
 */
export function validateBeatProseMap(
  beatProseMap: unknown,
  beatPlan: BeatPlan,
  proseText: string
): ValidationResult {
  const errors: string[] = [];

  if (!beatProseMap || typeof beatProseMap !== 'object') {
    return { valid: false, errors: ['Beat prose map is not an object'] };
  }

  const { chunks } = beatProseMap as { chunks?: unknown };

  // Validate chunks array (this is the main field in BeatProseMap)
  if (!chunks || !Array.isArray(chunks)) {
    errors.push('Missing or invalid chunks array');
  } else if (chunks.length === 0) {
    errors.push('Chunks array is empty - no beat-to-prose mapping');
  } else {
    // Should have one chunk per beat
    if (chunks.length !== beatPlan.beats.length) {
      errors.push(
        `Beat chunk count mismatch: ${chunks.length} chunks for ${beatPlan.beats.length} beats`
      );
    }

    // Validate each chunk has beat and prose
    chunks.forEach((chunk: unknown, index: number) => {
      if (!chunk || typeof chunk !== 'object') {
        errors.push(`Chunk ${index}: not an object`);
      } else {
        const chunkObj = chunk as { prose?: unknown };
        if (!chunkObj.prose || typeof chunkObj.prose !== 'string') {
          errors.push(`Chunk ${index}: missing or invalid prose field`);
        } else if (chunkObj.prose.trim().length === 0) {
          errors.push(`Chunk ${index}: prose is empty`);
        }
      }
    });

    // Check total coverage - all chunks combined should cover reasonable portion of prose
    // Be lenient - sometimes LLM splits differently
    if (chunks.length > 0) {
      const totalChunkLength = chunks.reduce(
        (sum: number, chunk: unknown) => {
          const proseField = (chunk as { prose?: string }).prose || '';
          return sum + proseField.length;
        },
        0
      );
      const coverageRatio = totalChunkLength / proseText.length;

      // Only fail if coverage is really bad (< 40%)
      if (coverageRatio < 0.4) {
        errors.push(
          `Poor prose coverage: chunks only cover ${Math.round(coverageRatio * 100)}% of text (need at least 40%)`
        );
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validates extracted narrative elements from text analysis
 * LENIENT - only checks for critical structural issues that would cause downstream errors
 */
export function validateExtractionResult(data: unknown): ValidationResult {
  const errors: string[] = [];

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['Extraction result is not an object'] };
  }

  const d = data as Record<string, unknown>;

  // Only fail if COMPLETELY empty - at least one entity type should have content
  const hasCharacters = Array.isArray(d.characters) && d.characters.length > 0;
  const hasLocations = Array.isArray(d.locations) && d.locations.length > 0;
  const hasThreads = Array.isArray(d.threads) && d.threads.length > 0;
  const hasScenes = Array.isArray(d.scenes) && d.scenes.length > 0;

  if (!hasCharacters && !hasLocations && !hasThreads && !hasScenes) {
    return {
      valid: false,
      errors: ['No content extracted - all arrays empty (characters, locations, threads, scenes)'],
    };
  }

  // Validate array types (not individual entries - those are optional/flexible)
  if (d.characters && !Array.isArray(d.characters)) {
    errors.push('characters field exists but is not an array');
  }

  if (d.locations && !Array.isArray(d.locations)) {
    errors.push('locations field exists but is not an array');
  }

  if (d.threads && !Array.isArray(d.threads)) {
    errors.push('threads field exists but is not an array');
  }

  if (d.scenes && !Array.isArray(d.scenes)) {
    errors.push('scenes field exists but is not an array');
  }

  // Only check critical scene fields that would cause immediate errors downstream
  if (Array.isArray(d.scenes)) {
    d.scenes.forEach((scene: unknown, idx: number) => {
      // Only fail if scene is completely missing core structure
      if (!scene || typeof scene !== 'object') {
        errors.push(`Scene ${idx}: not an object`);
      }
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Validates system delta extraction results
 */
export function validateSystemDelta(data: unknown): ValidationResult {
  const errors: string[] = [];

  if (!data || typeof data !== 'object') {
    return { valid: false, errors: ['System delta result is not an object'] };
  }

  const d = data as { nodes?: unknown; edges?: unknown };

  // Should have at least nodes or edges
  const hasNodes = Array.isArray(d.nodes) && d.nodes.length > 0;
  const hasEdges = Array.isArray(d.edges) && d.edges.length > 0;

  if (!hasNodes && !hasEdges) {
    return {
      valid: false,
      errors: ['No system data extracted - both nodes and edges are empty'],
    };
  }

  // Validate nodes structure
  if (Array.isArray(d.nodes)) {
    d.nodes.forEach((node: unknown, idx: number) => {
      const n = (node ?? {}) as Record<string, unknown>;
      if (!n.id || typeof n.id !== 'string') {
        errors.push(`Node ${idx}: missing or invalid id`);
      }
      if (!n.content || typeof n.content !== 'string') {
        errors.push(`Node ${idx}: missing or invalid content`);
      }
      if (!n.type || typeof n.type !== 'string') {
        errors.push(`Node ${idx}: missing or invalid type`);
      }
    });
  }

  // Validate edges structure
  if (Array.isArray(d.edges)) {
    d.edges.forEach((edge: unknown, idx: number) => {
      const e = (edge ?? {}) as Record<string, unknown>;
      if (!e.source || typeof e.source !== 'string') {
        errors.push(`Edge ${idx}: missing or invalid source`);
      }
      if (!e.target || typeof e.target !== 'string') {
        errors.push(`Edge ${idx}: missing or invalid target`);
      }
      if (!e.type || typeof e.type !== 'string') {
        errors.push(`Edge ${idx}: missing or invalid type`);
      }
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Generic retry wrapper for API calls with validation
 */
export async function retryWithValidation<T>(
  operation: () => Promise<T>,
  validator: (data: T) => ValidationResult,
  operationName: string,
  maxRetries: number = 3,
  source: LogContext['source'] = 'analysis'
): Promise<T> {
  let lastError: Error | null = null;
  let lastValidationErrors: string[] = [];

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await operation();
      const validation = validator(result);

      if (validation.valid) {
        if (attempt > 1) {
          logInfo(
            `${operationName} succeeded on attempt ${attempt}/${maxRetries}`,
            { source, operation: operationName, details: { attempt, maxRetries } }
          );
        }
        return result;
      }

      lastValidationErrors = validation.errors;
      logWarning(
        `${operationName} validation failed (attempt ${attempt}/${maxRetries})`,
        validation.errors.join('; '),
        { source, operation: operationName, details: { attempt, maxRetries, errorCount: validation.errors.length } }
      );

      if (attempt < maxRetries) {
        // Exponential backoff: 1s, 2s, 4s
        const backoffMs = Math.pow(2, attempt - 1) * 1000;
        logInfo(
          `${operationName} retrying in ${backoffMs}ms`,
          { source, operation: operationName, details: { attempt, backoffMs } }
        );
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry billing/auth errors — they won't resolve on retry
      const errMsg = lastError.message;
      if (errMsg.includes('"code":402') || errMsg.includes('"code":401') || errMsg.includes('"code":403')) {
        logError(
          `${operationName} failed with non-retryable error`,
          error,
          { source, operation: operationName, details: { attempt, maxRetries } }
        );
        throw lastError;
      }

      logError(
        `${operationName} threw error (attempt ${attempt}/${maxRetries})`,
        error,
        { source, operation: operationName, details: { attempt, maxRetries } }
      );

      if (attempt < maxRetries) {
        const backoffMs = Math.pow(2, attempt - 1) * 1000;
        logInfo(
          `${operationName} retrying in ${backoffMs}ms`,
          { source, operation: operationName, details: { attempt, backoffMs } }
        );
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
      }
    }
  }

  // All retries exhausted
  const finalError = lastError
    ? new Error(`${operationName} failed after ${maxRetries} attempts. Last error: ${lastError.message}`)
    : new Error(`${operationName} validation failed after ${maxRetries} attempts. Last errors:\n${lastValidationErrors.join('\n')}`);

  logError(
    `${operationName} exhausted all ${maxRetries} retry attempts`,
    finalError,
    {
      source,
      operation: operationName,
      details: {
        maxRetries,
        errorCount: lastValidationErrors.length,
        errors: lastValidationErrors.join(' | ')
      }
    }
  );
  throw finalError;
}
