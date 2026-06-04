// Tests for lib/api-logger — API call logging, subscriptions, and narrative-scoped token tracking.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  onApiLog,
  onApiLogUpdate,
  setLoggerNarrativeId,
  logApiCall,
  updateApiLog,
} from '@/lib/core/api-logger';
import type { ApiLogEntry } from '@/types/narrative';
// ── Setup ────────────────────────────────────────────────────────────────────
describe('api-logger', () => {
  beforeEach(() => {
    // Reset listeners and state before each test
    onApiLog(() => {});
    onApiLogUpdate(() => {});
    setLoggerNarrativeId(null);
  });
  // ── onApiLog ─────────────────────────────────────────────────────────────
  describe('onApiLog', () => {
    it('registers a listener that receives new log entries', () => {
      const listener = vi.fn();
      onApiLog(listener);
      logApiCall('test-caller', 100, 'Test prompt');
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0]).toMatchObject({
        caller: 'test-caller',
        status: 'pending',
      });
    });
    it('replaces the previous listener', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      onApiLog(listener1);
      onApiLog(listener2);
      logApiCall('test-caller', 100, 'Test prompt');
      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).toHaveBeenCalledTimes(1);
    });
  });
  // ── onApiLogUpdate ───────────────────────────────────────────────────────
  describe('onApiLogUpdate', () => {
    it('registers a listener that receives log updates', () => {
      const updateListener = vi.fn();
      onApiLogUpdate(updateListener);
      const id = logApiCall('test-caller', 100, 'Test prompt');
      updateApiLog(id, { status: 'success', durationMs: 500 });
      expect(updateListener).toHaveBeenCalledTimes(1);
      expect(updateListener).toHaveBeenCalledWith(id, expect.objectContaining({
        status: 'success',
        durationMs: 500,
      }));
    });
    it('replaces the previous update listener', () => {
      const listener1 = vi.fn();
      const listener2 = vi.fn();
      onApiLogUpdate(listener1);
      onApiLogUpdate(listener2);
      const id = logApiCall('test-caller', 100, 'Test prompt');
      updateApiLog(id, { status: 'success' });
      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).toHaveBeenCalledTimes(1);
    });
  });
  // ── setLoggerNarrativeId ─────────────────────────────────────────────────
  describe('setLoggerNarrativeId', () => {
    it('sets narrative ID for subsequent log entries', () => {
      const listener = vi.fn();
      onApiLog(listener);
      setLoggerNarrativeId('narrative-123');
      logApiCall('test-caller', 100, 'Test prompt');
      expect(listener.mock.calls[0][0].narrativeId).toBe('narrative-123');
    });
    it('clears narrative ID when set to null', () => {
      const listener = vi.fn();
      onApiLog(listener);
      setLoggerNarrativeId('narrative-123');
      setLoggerNarrativeId(null);
      logApiCall('test-caller', 100, 'Test prompt');
      expect(listener.mock.calls[0][0].narrativeId).toBeUndefined();
    });
  });
  // ── logApiCall ───────────────────────────────────────────────────────────
  describe('logApiCall', () => {
    it('returns a unique ID', () => {
      const listener = vi.fn();
      onApiLog(listener);
      const id1 = logApiCall('caller1', 100, 'Prompt 1');
      const id2 = logApiCall('caller2', 200, 'Prompt 2');
      expect(id1).not.toBe(id2);
      expect(id1).toMatch(/^api-\d+-\d+$/);
      expect(id2).toMatch(/^api-\d+-\d+$/);
    });
    it('creates entry with correct caller', () => {
      const listener = vi.fn();
      onApiLog(listener);
      logApiCall('generateScenes', 500, 'Generate scenes prompt');
      const entry: ApiLogEntry = listener.mock.calls[0][0];
      expect(entry.caller).toBe('generateScenes');
    });
    it('estimates prompt tokens from char count (~4 chars per token)', () => {
      const listener = vi.fn();
      onApiLog(listener);
      logApiCall('test', 400, 'Test prompt'); // 400 chars = ~100 tokens
      const entry: ApiLogEntry = listener.mock.calls[0][0];
      expect(entry.promptTokens).toBe(100);
    });
    it('rounds up token estimate', () => {
      const listener = vi.fn();
      onApiLog(listener);
      logApiCall('test', 401, 'Test prompt'); // 401 chars = 101 tokens (rounded up)
      const entry: ApiLogEntry = listener.mock.calls[0][0];
      expect(entry.promptTokens).toBe(101);
    });
    it('stores prompt preview', () => {
      const listener = vi.fn();
      onApiLog(listener);
      logApiCall('test', 100, 'This is the prompt preview');
      const entry: ApiLogEntry = listener.mock.calls[0][0];
      expect(entry.promptPreview).toBe('This is the prompt preview');
    });
    it('stores model when provided', () => {
      const listener = vi.fn();
      onApiLog(listener);
      logApiCall('test', 100, 'Test prompt', 'gpt-4');
      const entry: ApiLogEntry = listener.mock.calls[0][0];
      expect(entry.model).toBe('gpt-4');
    });
    it('initializes entry with pending status', () => {
      const listener = vi.fn();
      onApiLog(listener);
      logApiCall('test', 100, 'Test prompt');
      const entry: ApiLogEntry = listener.mock.calls[0][0];
      expect(entry.status).toBe('pending');
      expect(entry.durationMs).toBeNull();
      expect(entry.responseTokens).toBeNull();
      expect(entry.error).toBeNull();
      expect(entry.responsePreview).toBeNull();
    });
    it('includes timestamp', () => {
      const listener = vi.fn();
      onApiLog(listener);
      const before = Date.now();
      logApiCall('test', 100, 'Test prompt');
      const after = Date.now();
      const entry: ApiLogEntry = listener.mock.calls[0][0];
      expect(entry.timestamp).toBeGreaterThanOrEqual(before);
      expect(entry.timestamp).toBeLessThanOrEqual(after);
    });
  });
  // ── updateApiLog ─────────────────────────────────────────────────────────
  describe('updateApiLog', () => {
    it('passes ID and updates to listener', () => {
      const updateListener = vi.fn();
      onApiLogUpdate(updateListener);
      const id = logApiCall('test', 100, 'Test');
      updateApiLog(id, { status: 'success' });
      expect(updateListener).toHaveBeenCalledWith(id, { status: 'success' });
    });
    it('converts responseLength to responseTokens', () => {
      const updateListener = vi.fn();
      onApiLogUpdate(updateListener);
      const id = logApiCall('test', 100, 'Test');
      updateApiLog(id, { responseLength: 800 }); // 800 chars = 200 tokens
      expect(updateListener).toHaveBeenCalledWith(id, { responseTokens: 200 });
    });
    it('rounds up response token estimate', () => {
      const updateListener = vi.fn();
      onApiLogUpdate(updateListener);
      const id = logApiCall('test', 100, 'Test');
      updateApiLog(id, { responseLength: 801 }); // 801 chars = 201 tokens
      expect(updateListener).toHaveBeenCalledWith(id, { responseTokens: 201 });
    });
    it('passes through other fields unchanged', () => {
      const updateListener = vi.fn();
      onApiLogUpdate(updateListener);
      const id = logApiCall('test', 100, 'Test');
      updateApiLog(id, {
        status: 'error',
        durationMs: 1500,
        error: 'API timeout',
        responsePreview: 'Error response',
      });
      expect(updateListener).toHaveBeenCalledWith(id, {
        status: 'error',
        durationMs: 1500,
        error: 'API timeout',
        responsePreview: 'Error response',
      });
    });
    it('handles reasoningContent and reasoningTokens', () => {
      const updateListener = vi.fn();
      onApiLogUpdate(updateListener);
      const id = logApiCall('test', 100, 'Test');
      updateApiLog(id, {
        reasoningContent: 'Step 1: Think...',
        reasoningTokens: 150,
      });
      expect(updateListener).toHaveBeenCalledWith(id, {
        reasoningContent: 'Step 1: Think...',
        reasoningTokens: 150,
      });
    });
    it('handles combined updates', () => {
      const updateListener = vi.fn();
      onApiLogUpdate(updateListener);
      const id = logApiCall('test', 100, 'Test');
      updateApiLog(id, {
        status: 'success',
        durationMs: 2000,
        responseLength: 1200,
        responsePreview: 'Generated content...',
        reasoningContent: 'Internal reasoning',
        reasoningTokens: 50,
      });
      expect(updateListener).toHaveBeenCalledWith(id, {
        status: 'success',
        durationMs: 2000,
        responseTokens: 300, // 1200 / 4
        responsePreview: 'Generated content...',
        reasoningContent: 'Internal reasoning',
        reasoningTokens: 50,
      });
    });
    it('does not call listener when no listener is set', () => {
      // Clear the listener
      onApiLogUpdate(() => {});
      const id = logApiCall('test', 100, 'Test');
      // This should not throw
      expect(() => {
        updateApiLog(id, { status: 'success' });
      }).not.toThrow();
    });
  });
});
