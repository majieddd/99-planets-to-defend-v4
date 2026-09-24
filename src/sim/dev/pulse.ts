import type { SimSystem } from '../kernel';

/**
 * Development only. Exercises the kernel the way real systems will: two named RNG streams, a command,
 * plain JSON state and scheduled events. The bot and the determinism tests run it until the game systems
 * exist in M2. It is not part of the game.
 */
export type PulseData = {
  /** x, y pairs in a 100 by 100 field. */
  points: number[];
  pulses: number;
  /** Ticks of boost remaining after a 'dev/boost' command. */
  boosted: number;
};

export const pulseSystem: SimSystem<PulseData> = {
  id: 'dev/pulse',
  init() {
    return { points: [], pulses: 0, boosted: 0 };
  },
  step(data, ctx) {
    for (const command of ctx.commands) {
      if (command.type === 'dev/boost') data.boosted = 120;
    }
    const spawn = ctx.rng('dev/spawn');
    if (data.points.length < 128 && spawn.chance(0.1)) data.points.push(spawn.range(0, 100), spawn.range(0, 100));
    const drift = ctx.rng('dev/drift');
    const speed = data.boosted > 0 ? 3 : 1;
    for (let i = 0; i < data.points.length; i++) {
      const moved = (data.points[i] as number) + drift.range(-0.5, 0.5) * speed * ctx.dt * 60;
      data.points[i] = ((moved % 100) + 100) % 100;
    }
    if (data.boosted > 0) data.boosted -= 1;
    if (ctx.tick % 600 === 599) {
      data.pulses += 1;
      ctx.emit('dev/pulse', { count: data.pulses, points: data.points.length / 2 });
    }
  },
};
