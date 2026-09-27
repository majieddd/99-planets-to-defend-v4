import { describe, expect, it } from 'vitest';
import { formatResult, parseBotArgs, runBot } from '../../../tools/bot/runBot';

describe('runBot', () => {
  it('is deterministic per seed and differs across seeds', () => {
    const a = runBot({ seed: 1, ticks: 3_000 });
    const b = runBot({ seed: 1, ticks: 3_000 });
    const c = runBot({ seed: 2, ticks: 3_000 });
    expect(a.hash).toBe(b.hash);
    expect(c.hash).not.toBe(a.hash);
    expect(a.events).toBeGreaterThan(0);
  });

  it('reports the seed and tick count the kernel ran, not the ones it was given', () => {
    const odd = runBot({ seed: -1, ticks: 1.5 });
    expect(odd).toMatchObject({ seed: 4_294_967_295, ticks: 2 });
    expect(odd.hash).toBe(runBot({ seed: 4_294_967_295, ticks: 2 }).hash);
  });

  it('prints a parseable result line', () => {
    const line = formatResult({ seed: 7, ticks: 60, hash: '00000000000abc', events: 3, ms: 12 });
    expect(line).toBe('bot result: seed=7 ticks=60 hash=00000000000abc events=3 ms=12');
  });
});

describe('parseBotArgs', () => {
  it('defaults to seed 1 for ten simulated minutes and reads both flag forms', () => {
    expect(parseBotArgs([])).toEqual({ seed: 1, ticks: 36_000 });
    expect(parseBotArgs(['--seed', '555', '--ticks', '600'])).toEqual({ seed: 555, ticks: 600 });
    expect(parseBotArgs(['--seed=4294967295', '--ticks=0'])).toEqual({ seed: 4_294_967_295, ticks: 0 });
  });

  // Each of these used to run something other than what was typed and print a line for it.
  it.each([
    ['a fractional seed', ['--seed', '1.5']],
    ['a negative seed', ['--seed=-1']],
    ['a seed past 32 bits', ['--seed', '4294967296']],
    ['an empty seed', ['--seed', '']],
    ['a fractional tick count', ['--ticks', '1.5']],
    ['a tick count past safe integers', ['--ticks', '9007199254740992']],
    ['an unknown flag', ['--planets', '20']],
    ['an unknown flag with its value attached', ['--planets=20']],
    ['bare values (npm run bot --seed 555 without the --)', ['555', '600']],
  ])('refuses %s', (_name, args) => {
    expect(() => parseBotArgs(args)).toThrow();
  });
});
