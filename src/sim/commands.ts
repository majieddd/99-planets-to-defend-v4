import type { JsonValue } from './types';

/** An input from a player or the bot. Commands are the only way intent enters the simulation. */
export interface Command {
  readonly type: string;
  readonly playerId: number;
  readonly data?: JsonValue;
}

/** Commands keyed by the tick they apply on, so a replay is a seed plus this list. */
export class CommandQueue {
  private readonly byTick = new Map<number, Command[]>();

  push(tick: number, command: Command): void {
    if (!Number.isInteger(tick) || tick < 0) throw new Error(`CommandQueue.push: bad tick ${tick}`);
    const list = this.byTick.get(tick);
    if (list) list.push(command);
    else this.byTick.set(tick, [command]);
  }

  /** Removes and returns the commands for a tick, in the order they were pushed. */
  take(tick: number): Command[] {
    const list = this.byTick.get(tick) ?? [];
    this.byTick.delete(tick);
    return list;
  }

  get size(): number {
    let n = 0;
    for (const list of this.byTick.values()) n += list.length;
    return n;
  }
}
