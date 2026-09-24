import { describe, expect, it } from 'vitest';
import { CommandQueue } from '../../../src/sim/commands';
import { EventLog } from '../../../src/sim/events';
import { SIM_VERSION, TICK_DT, TICK_HZ } from '../../../src/sim/state';

describe('EventLog', () => {
  it('drains in emission order and clears', () => {
    const log = new EventLog();
    log.emit(3, 'a');
    log.emit(3, 'b', { n: 1 });
    log.emit(3, 'c', null);
    expect(log.count).toBe(3);
    const first = log.drain();
    expect(first).toStrictEqual([
      { tick: 3, type: 'a' },
      { tick: 3, type: 'b', data: { n: 1 } },
      { tick: 3, type: 'c', data: null },
    ]);
    log.emit(4, 'd');
    expect(log.drain()).toStrictEqual([{ tick: 4, type: 'd' }]);
    expect(first).toHaveLength(3);
    expect(log.drain()).toEqual([]);
    expect(log.count).toBe(4);
  });
});

describe('CommandQueue', () => {
  it('returns commands only for their tick, in push order', () => {
    const queue = new CommandQueue();
    queue.push(0, { type: 'w', playerId: 0 });
    queue.push(5, { type: 'x', playerId: 0 });
    queue.push(5, { type: 'y', playerId: 0 });
    queue.push(6, { type: 'z', playerId: 1, data: { aim: [1, 2] } });
    expect(queue.size).toBe(4);
    expect(queue.take(4)).toEqual([]);
    expect(queue.take(5).map((c) => c.type)).toEqual(['x', 'y']);
    expect(queue.take(5)).toEqual([]);
    expect(queue.take(0)).toStrictEqual([{ type: 'w', playerId: 0 }]);
    expect(queue.size).toBe(1);
    expect(queue.take(6)).toStrictEqual([{ type: 'z', playerId: 1, data: { aim: [1, 2] } }]);
  });

  it('refuses a negative, fractional or non-finite tick', () => {
    const queue = new CommandQueue();
    for (const tick of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => queue.push(tick, { type: 'x', playerId: 0 })).toThrow(/bad tick/);
    }
  });
});

describe('state constants', () => {
  it('ticks at 60 Hz', () => {
    expect(TICK_HZ).toBe(60);
    expect(TICK_DT).toBe(1 / 60);
    expect(SIM_VERSION).toBe(1);
  });
});
