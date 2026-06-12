// Setup file for Vitest tests
// This runs before each test file

// Add IndexedDB polyfill for Node.js test environment
import 'fake-indexeddb/auto';

// Use Node.js built-in Blob (available in Node 16+)
import { Blob } from 'node:buffer';
if (typeof globalThis.Blob === 'undefined') {
  (globalThis as Record<string, unknown>).Blob = Blob;
}

// Mock performance.now for timing tests if not available
if (typeof performance === 'undefined') {
  (global as Record<string, unknown>).performance = {
    now: () => Date.now(),
  };
}
