import { describe, expect, it } from 'vitest';
import { normaliseBody } from '../src/services/publishing.js';

describe('normaliseBody', () => {
  it('drops a byline the submitter typed above the story', () => {
    expect(normaliseBody('By boink\n\nIt began in general chat.', 'boink')).toBe(
      'It began in general chat.',
    );
  });

  it('drops a handle byline that does not match the display name', () => {
    expect(normaliseBody('By @boink\n\nIt began.', 'Someone Else')).toBe('It began.');
  });

  it('leaves prose that starts with "By the time" alone', () => {
    const body = 'By the time he arrived, the row had already started.';
    expect(normaliseBody(body, 'boink')).toBe(body);
  });

  it('does not strip past the first two paragraphs', () => {
    const body = 'It began.\n\nBy then everyone was watching.\n\nBy boink';
    expect(normaliseBody(body, 'boink')).toBe(body);
  });

  it('keeps a story that never had a byline', () => {
    const body = 'First paragraph.\n\nSecond paragraph.';
    expect(normaliseBody(body, 'boink')).toBe(body);
  });
});
