// Tests for lib/ai/json — JSON parsing and deterministic repair (cleanJson, unquoted/unescaped fixes, parseJson).

import { describe, it, expect } from 'vitest';
import { cleanJson, repairUnescapedQuotes, repairUnquotedValues, parseJson, JsonRepairableError } from '@/lib/ai/json';
// ── cleanJson ────────────────────────────────────────────────────────────────
describe('cleanJson', () => {
  it('returns empty string for empty input', () => {
    expect(cleanJson('')).toBe('');
  });
  describe('code fence removal', () => {
    it('removes ```json code fences', () => {
      const input = '```json\n{"key": "value"}\n```';
      expect(cleanJson(input)).toBe('{"key": "value"}');
    });
    it('removes ``` without json tag', () => {
      const input = '```\n{"key": "value"}\n```';
      expect(cleanJson(input)).toBe('{"key": "value"}');
    });
    it('handles multiple code fences', () => {
      const input = '```json\n{"a": 1}```\n```{"b": 2}```';
      // Extracts only the first complete JSON object
      expect(cleanJson(input)).toBe('{"a": 1}');
    });
  });
  describe('trailing comma removal', () => {
    it('removes trailing comma before }', () => {
      const input = '{"key": "value",}';
      expect(cleanJson(input)).toBe('{"key": "value"}');
    });
    it('removes trailing comma before ]', () => {
      const input = '[1, 2, 3,]';
      expect(cleanJson(input)).toBe('[1, 2, 3]');
    });
    it('handles nested trailing commas', () => {
      const input = '{"arr": [1, 2,], "obj": {"a": 1,},}';
      expect(cleanJson(input)).toBe('{"arr": [1, 2], "obj": {"a": 1}}');
    });
    it('preserves commas with whitespace before } or ]', () => {
      const input = '{"key": "value" , }';
      expect(cleanJson(input)).toBe('{"key": "value" }');
    });
  });
  describe('control character escaping', () => {
    it('escapes newlines inside string values', () => {
      const input = '{"text": "line1\nline2"}';
      const result = cleanJson(input);
      expect(result).toBe('{"text": "line1\\nline2"}');
    });
    it('escapes tabs inside string values', () => {
      const input = '{"text": "col1\tcol2"}';
      const result = cleanJson(input);
      expect(result).toBe('{"text": "col1\\tcol2"}');
    });
    it('escapes carriage returns inside string values', () => {
      const input = '{"text": "line1\rline2"}';
      const result = cleanJson(input);
      expect(result).toBe('{"text": "line1\\rline2"}');
    });
    it('does not double-escape already escaped chars', () => {
      const input = '{"text": "already\\nescaped"}';
      const result = cleanJson(input);
      expect(result).toBe('{"text": "already\\nescaped"}');
    });
    it('does not affect control chars outside strings', () => {
      const input = '{\n  "key": "value"\n}';
      const result = cleanJson(input);
      expect(result).toBe('{\n  "key": "value"\n}');
    });
  });
  it('handles escaped quotes correctly', () => {
    const input = '{"text": "she said \\"hello\\""}';
    const result = cleanJson(input);
    expect(result).toBe('{"text": "she said \\"hello\\""}');
  });
  it('trims whitespace', () => {
    const input = '  {"key": "value"}  ';
    expect(cleanJson(input)).toBe('{"key": "value"}');
  });
});
// ── repairUnescapedQuotes ────────────────────────────────────────────────────
describe('repairUnescapedQuotes', () => {
  it('returns input unchanged when no unescaped quotes', () => {
    const input = '{"key": "value"}';
    expect(repairUnescapedQuotes(input)).toBe(input);
  });
  it('escapes unescaped quotes inside string values', () => {
    const input = '{"text": "she said "hello" to him"}';
    const result = repairUnescapedQuotes(input);
    expect(result).toBe('{"text": "she said \\"hello\\" to him"}');
  });
  it('handles multiple unescaped quotes', () => {
    const input = '{"text": ""A" and "B""}';
    const result = repairUnescapedQuotes(input);
    expect(result).toBe('{"text": "\\"A\\" and \\"B\\""}');
  });
  it('preserves already escaped quotes', () => {
    const input = '{"text": "already \\"escaped\\" quote"}';
    expect(repairUnescapedQuotes(input)).toBe(input);
  });
  it('handles quotes followed by comma', () => {
    const input = '{"a": "val1", "b": "val2"}';
    expect(repairUnescapedQuotes(input)).toBe(input);
  });
  it('handles quotes followed by colon (key)', () => {
    const input = '{"key": "value"}';
    expect(repairUnescapedQuotes(input)).toBe(input);
  });
  it('handles quotes at end of array', () => {
    const input = '["a", "b"]';
    expect(repairUnescapedQuotes(input)).toBe(input);
  });
  it('handles whitespace before structural chars', () => {
    const input = '{ "key" : "value" }';
    expect(repairUnescapedQuotes(input)).toBe(input);
  });
  it('handles complex nested structures', () => {
    const input = '{"arr": ["she said "hi""], "obj": {"nested": "with "quotes""}}';
    const result = repairUnescapedQuotes(input);
    // The inner quotes should be escaped
    expect(JSON.parse(result)).toEqual({
      arr: ['she said "hi"'],
      obj: { nested: 'with "quotes"' },
    });
  });
});
// ── parseJson ────────────────────────────────────────────────────────────────
describe('parseJson', () => {
  it('parses valid JSON', () => {
    const result = parseJson('{"key": "value"}', 'test');
    expect(result).toEqual({ key: 'value' });
  });
  it('throws on empty input', () => {
    expect(() => parseJson('', 'test')).toThrow('Empty response from LLM');
    expect(() => parseJson('   ', 'test')).toThrow('Empty response from LLM');
  });
  it('cleans JSON before parsing', () => {
    const input = '```json\n{"key": "value",}\n```';
    const result = parseJson(input, 'test');
    expect(result).toEqual({ key: 'value' });
  });
  it('repairs unescaped quotes automatically', () => {
    const input = '{"text": "she said "hello""}';
    const result = parseJson(input, 'test');
    expect(result).toEqual({ text: 'she said "hello"' });
  });
  it('includes context in error message', () => {
    const badJson = '{"broken';
    expect(() => parseJson(badJson, 'myContext')).toThrow('[myContext]');
  });
  it('indicates truncation when JSON does not end properly', () => {
    const truncated = '{"key": "val';
    expect(() => parseJson(truncated, 'test')).toThrow('truncated');
  });
  it('does not indicate truncation when JSON ends with } or ]', () => {
    const badButComplete = '{"key": invalid}';
    try {
      parseJson(badButComplete, 'test');
    } catch (e) {
      expect((e as Error).message).not.toContain('truncated');
    }
  });
  it('includes preview of response in error', () => {
    const badJson = '{"broken": invalid}';
    try {
      parseJson(badJson, 'test');
    } catch (e) {
      expect((e as Error).message).toContain('Response preview');
      expect((e as Error).message).toContain('broken');
    }
  });
  it('truncates long previews', () => {
    const longBad = '{"key": "' + 'x'.repeat(500) + 'invalid}';
    try {
      parseJson(longBad, 'test');
    } catch (e) {
      expect((e as Error).message).toContain('chars total');
    }
  });
  it('handles arrays', () => {
    const result = parseJson('[1, 2, 3]', 'test');
    expect(result).toEqual([1, 2, 3]);
  });
  it('handles nested objects', () => {
    const input = '{"outer": {"inner": {"deep": true}}}';
    const result = parseJson(input, 'test');
    expect(result).toEqual({ outer: { inner: { deep: true } } });
  });
  it('handles null and boolean values', () => {
    const input = '{"isActive": true, "data": null, "flag": false}';
    const result = parseJson(input, 'test');
    expect(result).toEqual({ isActive: true, data: null, flag: false });
  });
  it('handles numeric values', () => {
    const input = '{"int": 42, "float": 3.14, "negative": -10}';
    const result = parseJson(input, 'test');
    expect(result).toEqual({ int: 42, float: 3.14, negative: -10 });
  });

  // parseJson now throws JsonRepairableError (not plain Error) on unrecoverable
  // failures, carrying the original raw text so callers can offer an LLM repair
  // pass instead of a full re-run. These tests pin that behaviour.
  it('throws JsonRepairableError (not plain Error) when repair strategies are exhausted', () => {
    try {
      parseJson('{"broken', 'ctx');
      expect.fail('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(JsonRepairableError);
      expect(e).toBeInstanceOf(Error);
    }
  });

  it('carries the raw input and the caller context on the thrown error', () => {
    const raw = '{"broken: bad';
    try {
      parseJson(raw, 'myCaller');
      expect.fail('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(JsonRepairableError);
      const jre = e as JsonRepairableError;
      expect(jre.raw).toBe(raw);
      expect(jre.context).toBe('myCaller');
    }
  });

  it('still throws a plain Error (not JsonRepairableError) for empty input', () => {
    // Empty input is unrepairable — nothing for the model to fix. Callers
    // discriminate on `instanceof JsonRepairableError` to decide whether to
    // offer the Repair button; this case must NOT show it.
    try {
      parseJson('', 'ctx');
      expect.fail('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect(e).not.toBeInstanceOf(JsonRepairableError);
    }
  });
});

// ── repairUnquotedValues ─────────────────────────────────────────────────────
describe('repairUnquotedValues', () => {
  it('quotes bare identifier values', () => {
    expect(repairUnquotedValues('{"type": rule}')).toBe('{"type": "rule"}');
  });

  it('does not touch true / false / null literals', () => {
    const input = '{"a": true, "b": false, "c": null}';
    expect(repairUnquotedValues(input)).toBe(input);
  });

  it('does not touch numeric values', () => {
    const input = '{"int": 42, "neg": -3, "float": 3.14}';
    expect(repairUnquotedValues(input)).toBe(input);
  });

  it('handles hyphenated identifiers (e.g. enum-like values)', () => {
    expect(repairUnquotedValues('{"mode": story-arc}')).toBe('{"mode": "story-arc"}');
  });

  it('handles underscored identifiers', () => {
    expect(repairUnquotedValues('{"k": snake_case}')).toBe('{"k": "snake_case"}');
  });

  it('handles values terminated by comma, brace, or newline', () => {
    expect(repairUnquotedValues('{"a": foo, "b": bar}')).toBe('{"a": "foo", "b": "bar"}');
    expect(repairUnquotedValues('{"a": foo}')).toBe('{"a": "foo"}');
    expect(repairUnquotedValues('{"a": foo\n}')).toBe('{"a": "foo"\n}');
  });

  it('only triggers on bareword values that follow a colon — bare array entries are left alone', () => {
    // The regex anchors on `:` so unquoted tokens inside an array (no leading
    // colon) are NOT a target. parseJson would still fail; that's fine — those
    // are caught upstream by the other repair strategies or a full re-run.
    expect(repairUnquotedValues('[a, b, c]')).toBe('[a, b, c]');
  });

  it('produces parseable JSON when the only problem is unquoted values', () => {
    const input = '{"role": anchor, "depth": 3, "active": true}';
    expect(JSON.parse(repairUnquotedValues(input))).toEqual({ role: 'anchor', depth: 3, active: true });
  });

  it('lets parseJson auto-recover from unquoted values via the repair cascade', () => {
    const result = parseJson('{"role": anchor, "depth": 3}', 'test');
    expect(result).toEqual({ role: 'anchor', depth: 3 });
  });
});

// ── JsonRepairableError ──────────────────────────────────────────────────────
describe('JsonRepairableError', () => {
  it('is a proper Error subclass with name set', () => {
    const err = new JsonRepairableError('ctx', '{broken', 'something');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(JsonRepairableError);
    expect(err.name).toBe('JsonRepairableError');
  });

  it('exposes raw and context for the repair pipeline', () => {
    const err = new JsonRepairableError('generateScenes', '{"scenes":[', 'truncated');
    expect(err.raw).toBe('{"scenes":[');
    expect(err.context).toBe('generateScenes');
    expect(err.message).toBe('truncated');
  });

  it('survives instanceof through a generic catch (loop discrimination relies on this)', () => {
    let caught: unknown;
    try {
      throw new JsonRepairableError('c', 'r', 'm');
    } catch (e) {
      caught = e;
    }
    expect(caught instanceof JsonRepairableError).toBe(true);
  });
});
