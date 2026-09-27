import type { JsonValue } from './types';

/** Something that happened on a tick, reported to the shell (renderer, audio, UI) and to tests. */
export interface SimEvent {
  readonly tick: number;
  readonly type: string;
  readonly data?: JsonValue;
}

/** Events collected during steps and drained by whoever advances the simulation. */
export class EventLog {
  private pending: SimEvent[] = [];
  private total = 0;

  emit(tick: number, type: string, data?: JsonValue): void {
    this.pending.push(data === undefined ? { tick, type } : { tick, type, data });
    this.total += 1;
  }

  /** Returns and clears the events emitted since the last drain, in emission order. */
  drain(): SimEvent[] {
    const out = this.pending;
    this.pending = [];
    return out;
  }

  /** How many events have ever been emitted. */
  get count(): number {
    return this.total;
  }
}
