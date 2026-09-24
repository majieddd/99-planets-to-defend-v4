import { describe, expect, it } from 'vitest';
import { EM_DASH_FORMS, findEmDashes } from '../../../tools/check-emdash.mjs';

const planted = {
  character: String.fromCharCode(0x2014),
  named: '&' + 'mdash;',
  numeric: '&#' + '8212;',
  escape: '\\' + 'u2014',
};

describe('findEmDashes', () => {
  it('finds nothing in clean text', () => {
    expect(findEmDashes('a - b, c: d\nplain line')).toEqual([]);
  });

  it('catches every form on the right line', () => {
    const text = [
      'clean',
      `one ${planted.character} here`,
      `two ${planted.named}`,
      `three ${planted.numeric}`,
      `four ${planted.escape}`,
    ].join('\n');
    expect(findEmDashes(text)).toEqual([
      { line: 2, form: 'the character' },
      { line: 3, form: 'the named entity' },
      { line: 4, form: 'the numeric entity' },
      { line: 5, form: 'the escape' },
    ]);
  });

  it('counts repeats on one line', () => {
    expect(findEmDashes(`${planted.character}x${planted.character}`)).toHaveLength(2);
  });

  it('knows exactly four forms', () => {
    expect(EM_DASH_FORMS.map((f: { name: string }) => f.name)).toEqual([
      'the character',
      'the named entity',
      'the numeric entity',
      'the escape',
    ]);
  });
});
