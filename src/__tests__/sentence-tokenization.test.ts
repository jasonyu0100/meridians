// Tests for sentence tokenization — splitting prose into sentences while respecting abbreviations.

import { describe, it, expect } from 'vitest';
// Import the function - we'll need to export it from scenes.ts
// For now, we'll duplicate the implementation for testing
function splitIntoSentences(text: string): string[] {
  // Common abbreviations that shouldn't trigger sentence breaks
  const abbreviations = new Set([
    'Dr', 'Mr', 'Mrs', 'Ms', 'Prof', 'Sr', 'Jr',
    'Fig', 'Eq', 'Vol', 'No', 'Ch', 'Sec', 'vs',
    'etc', 'i.e', 'e.g', 'al', 'et'
  ]);
  const sentences: string[] = [];
  let currentSentence = '';
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    currentSentence += char;
    // Check for sentence-ending punctuation
    if (char === '.' || char === '!' || char === '?') {
      // Look ahead for additional punctuation or ellipsis
      let j = i + 1;
      while (j < text.length && (text[j] === '.' || text[j] === '!' || text[j] === '?')) {
        currentSentence += text[j];
        j++;
      }
      // Skip closing quotes/parentheses
      while (j < text.length && (text[j] === '"' || text[j] === "'" || text[j] === ')' || text[j] === ']')) {
        currentSentence += text[j];
        j++;
      }
      // Check if this is a sentence boundary
      let isSentenceBoundary = false;
      // If followed by whitespace + capital letter or end of text, likely a boundary
      if (j >= text.length) {
        isSentenceBoundary = true;
      } else if (j < text.length && /\s/.test(text[j])) {
        // Skip whitespace
        let k = j;
        while (k < text.length && /\s/.test(text[k])) {
          k++;
        }
        // Check if next non-whitespace is capital letter or quote + capital
        if (k < text.length) {
          const nextChar = text[k];
          const isCapital = /[A-Z]/.test(nextChar);
          const isQuoteBeforeCapital = (nextChar === '"' || nextChar === "'") && k + 1 < text.length && /[A-Z]/.test(text[k + 1]);
          if (isCapital || isQuoteBeforeCapital) {
            // Check for abbreviations
            const words = currentSentence.trim().split(/\s+/);
            const lastWord = words[words.length - 1];
            const wordWithoutPunct = lastWord.replace(/[.!?]+$/, '');
            // Check if it's a decimal number like "1.2"
            const isDecimal = /^\d+\.\d*$/.test(lastWord);
            if (isDecimal) {
              // Don't split on decimal numbers
            } else if (abbreviations.has(wordWithoutPunct)) {
              // It's an abbreviation, but check if it's truly the end of a sentence
              // by looking at the next word
              let nextWordStart = k;
              if (nextChar === '"' || nextChar === "'") {
                nextWordStart = k + 1;
              }
              // Extract the next word
              let nextWordEnd = nextWordStart;
              while (nextWordEnd < text.length && /[A-Za-z]/.test(text[nextWordEnd])) {
                nextWordEnd++;
              }
              const nextWord = text.substring(nextWordStart, nextWordEnd);
              // Common sentence starters that indicate a new sentence despite abbreviation
              const sentenceStarters = new Set([
                'The', 'A', 'An', 'He', 'She', 'It', 'They', 'We', 'I', 'You',
                'This', 'That', 'These', 'Those', 'His', 'Her', 'Their', 'My', 'Our',
                'But', 'And', 'Or', 'So', 'Yet', 'For', 'Nor', 'As', 'If', 'When',
                'Where', 'Why', 'How', 'What', 'Who', 'Which'
              ]);
              if (sentenceStarters.has(nextWord)) {
                isSentenceBoundary = true;
              }
            } else {
              // Not an abbreviation or decimal, so it's a sentence boundary
              isSentenceBoundary = true;
            }
          }
        }
      }
      if (isSentenceBoundary) {
        sentences.push(currentSentence.trim());
        currentSentence = '';
        i = j;
        continue;
      }
      i = j;
    } else {
      i++;
    }
  }
  // Add any remaining sentence
  if (currentSentence.trim()) {
    sentences.push(currentSentence.trim());
  }
  return sentences;
}
describe('splitIntoSentences', () => {
  describe('basic sentence splitting', () => {
    it('splits simple sentences', () => {
      const text = 'This is sentence one. This is sentence two.';
      const result = splitIntoSentences(text);
      expect(result).toEqual([
        'This is sentence one.',
        'This is sentence two.'
      ]);
    });
    it('handles exclamation marks', () => {
      const text = 'Watch out! The monster is coming!';
      const result = splitIntoSentences(text);
      expect(result).toEqual([
        'Watch out!',
        'The monster is coming!'
      ]);
    });
    it('handles question marks', () => {
      const text = 'What is happening? Where are we going?';
      const result = splitIntoSentences(text);
      expect(result).toEqual([
        'What is happening?',
        'Where are we going?'
      ]);
    });
    it('handles mixed punctuation', () => {
      const text = 'She screamed. "Help!" The door slammed shut.';
      const result = splitIntoSentences(text);
      expect(result).toEqual([
        'She screamed.',
        '"Help!"',
        'The door slammed shut.'
      ]);
    });
  });
  describe('abbreviation handling', () => {
    it('does not split on Dr.', () => {
      const text = 'Dr. Smith arrived. She opened her bag.';
      const result = splitIntoSentences(text);
      expect(result).toEqual([
        'Dr. Smith arrived.',
        'She opened her bag.'
      ]);
    });
    it('does not split on Mr., Mrs., Ms.', () => {
      const text = 'Mr. Johnson met Mrs. Williams. Ms. Chen was there too.';
      const result = splitIntoSentences(text);
      expect(result).toEqual([
        'Mr. Johnson met Mrs. Williams.',
        'Ms. Chen was there too.'
      ]);
    });
    it('splits on Prof., Sr., Jr. when followed by sentence starter', () => {
      const text = 'Prof. Lee spoke with John Smith Jr. The lecture began.';
      const result = splitIntoSentences(text);
      expect(result).toEqual([
        'Prof. Lee spoke with John Smith Jr.',
        'The lecture began.'
      ]);
    });
    it('splits on etc., i.e., e.g. when followed by sentence starter', () => {
      const text = 'She brought supplies, etc. The items included food, water, i.e. the basics.';
      const result = splitIntoSentences(text);
      expect(result).toEqual([
        'She brought supplies, etc.',
        'The items included food, water, i.e. the basics.'
      ]);
    });
    it('does not split on Fig., Vol., No., Ch., Sec.', () => {
      const text = 'See Fig. 1 for details. Refer to Vol. 2, Ch. 3, Sec. 4.';
      const result = splitIntoSentences(text);
      expect(result).toEqual([
        'See Fig. 1 for details.',
        'Refer to Vol. 2, Ch. 3, Sec. 4.'
      ]);
    });
  });
  describe('decimal number handling', () => {
    it('does not split on decimal numbers', () => {
      const text = 'The value is 1.2. This is significant.';
      const result = splitIntoSentences(text);
      expect(result).toEqual([
        'The value is 1.2.',
        'This is significant.'
      ]);
    });
    it('handles multiple decimal numbers', () => {
      const text = 'Pi is approximately 3.14. The golden ratio is 1.618.';
      const result = splitIntoSentences(text);
      expect(result).toEqual([
        'Pi is approximately 3.14.',
        'The golden ratio is 1.618.'
      ]);
    });
    it('handles decimals at end of sentence', () => {
      const text = 'The measurement was 5.7. We recorded it carefully.';
      const result = splitIntoSentences(text);
      expect(result).toEqual([
        'The measurement was 5.7.',
        'We recorded it carefully.'
      ]);
    });
  });
  describe('ellipsis handling', () => {
    it('keeps ellipsis together', () => {
      const text = 'She paused... Then continued speaking.';
      const result = splitIntoSentences(text);
      expect(result).toEqual([
        'She paused...',
        'Then continued speaking.'
      ]);
    });
    it('handles ellipsis at end of sentence', () => {
      const text = 'The voice trailed off... The room fell silent.';
      const result = splitIntoSentences(text);
      expect(result).toEqual([
        'The voice trailed off...',
        'The room fell silent.'
      ]);
    });
  });
  describe('quoted punctuation', () => {
    it('handles quotes after punctuation', () => {
      const text = '"Where are you going?" she asked. "I don\'t know," he replied.';
      const result = splitIntoSentences(text);
      expect(result).toEqual([
        '"Where are you going?" she asked.',
        '"I don\'t know," he replied.'
      ]);
    });
    it('handles exclamation in quotes', () => {
      const text = '"Stop!" she yelled. The car screeched to a halt.';
      const result = splitIntoSentences(text);
      expect(result).toEqual([
        '"Stop!" she yelled.',
        'The car screeched to a halt.'
      ]);
    });
    it('handles parentheses after punctuation', () => {
      const text = 'He arrived late (as usual). Nobody was surprised.';
      const result = splitIntoSentences(text);
      expect(result).toEqual([
        'He arrived late (as usual).',
        'Nobody was surprised.'
      ]);
    });
  });
  describe('edge cases', () => {
    it('handles single sentence', () => {
      const text = 'This is just one sentence.';
      const result = splitIntoSentences(text);
      expect(result).toEqual(['This is just one sentence.']);
    });
    it('handles empty string', () => {
      const text = '';
      const result = splitIntoSentences(text);
      expect(result).toEqual([]);
    });
    it('handles text ending without punctuation', () => {
      const text = 'This is a sentence. This one has no ending';
      const result = splitIntoSentences(text);
      expect(result).toEqual([
        'This is a sentence.',
        'This one has no ending'
      ]);
    });
    it('handles multiple spaces between sentences', () => {
      const text = 'First sentence.    Second sentence.';
      const result = splitIntoSentences(text);
      expect(result).toEqual([
        'First sentence.',
        'Second sentence.'
      ]);
    });
    it('handles newlines between sentences', () => {
      const text = 'First sentence.\n\nSecond sentence.';
      const result = splitIntoSentences(text);
      expect(result).toEqual([
        'First sentence.',
        'Second sentence.'
      ]);
    });
    it('handles sentence with no capital after period (lowercase)', () => {
      const text = 'End of paragraph. next starts lowercase.';
      const result = splitIntoSentences(text);
      // Should NOT split because next word is lowercase
      expect(result).toEqual(['End of paragraph. next starts lowercase.']);
    });
  });
  describe('complex real-world examples', () => {
    it('handles narrative prose with dialogue', () => {
      const text = 'Dr. Smith looked at the reading. "It\'s 3.14 exactly!" he exclaimed. The experiment was a success.';
      const result = splitIntoSentences(text);
      expect(result).toEqual([
        'Dr. Smith looked at the reading.',
        '"It\'s 3.14 exactly!" he exclaimed.',
        'The experiment was a success.'
      ]);
    });
    it('handles academic text with abbreviations', () => {
      const text = 'See Fig. 2.3 for details. Prof. Johnson et al. demonstrated this principle, i.e. the fundamental theorem.';
      const result = splitIntoSentences(text);
      expect(result).toEqual([
        'See Fig. 2.3 for details.',
        'Prof. Johnson et al. demonstrated this principle, i.e. the fundamental theorem.'
      ]);
    });
    it('handles dramatic dialogue', () => {
      const text = '"Stop!" The guard raised his hand. "Who goes there?" He waited... Silence.';
      const result = splitIntoSentences(text);
      expect(result).toEqual([
        '"Stop!"',
        'The guard raised his hand.',
        '"Who goes there?"',
        'He waited...',
        'Silence.'
      ]);
    });
  });
});
