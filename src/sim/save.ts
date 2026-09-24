import { hashState } from './hash';
import { SIM_VERSION, type SimState } from './state';

export const SAVE_FORMAT = 'p99v4-save';

export interface SaveEnvelope {
  format: typeof SAVE_FORMAT;
  version: number;
  savedTick: number;
  hash: string;
  state: SimState;
}

export type SaveErrorReason = 'not-json' | 'wrong-format' | 'corrupt' | 'too-new' | 'no-migration';

export class SaveError extends Error {
  constructor(
    readonly reason: SaveErrorReason,
    message: string,
  ) {
    super(message);
    this.name = 'SaveError';
  }
}

/** Turns a state of version N into version N + 1. */
export type Migration = (state: Record<string, unknown>) => Record<string, unknown>;

/** Forward migrations keyed by the version they upgrade from. Empty until SIM_VERSION 2. */
export const MIGRATIONS: Readonly<Record<number, Migration>> = {};

export function serialize(state: SimState): string {
  const envelope: SaveEnvelope = {
    format: SAVE_FORMAT,
    version: state.version,
    savedTick: state.tick,
    hash: hashState(state),
    state,
  };
  return JSON.stringify(envelope);
}

function isEnvelope(value: unknown): value is SaveEnvelope {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v['format'] === SAVE_FORMAT &&
    typeof v['version'] === 'number' &&
    typeof v['hash'] === 'string' &&
    typeof v['state'] === 'object' &&
    v['state'] !== null
  );
}

/**
 * Parses a save, verifies its state against its hash and its header against its state (so a corrupted
 * or hand-edited save is refused rather than half-loaded), then migrates it forward to the current version.
 */
export function deserialize(
  text: string,
  migrations: Readonly<Record<number, Migration>> = MIGRATIONS,
  currentVersion: number = SIM_VERSION,
): SimState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SaveError('not-json', 'the save is not valid JSON');
  }
  if (!isEnvelope(parsed)) throw new SaveError('wrong-format', `the save is not a ${SAVE_FORMAT} envelope`);
  if (hashState(parsed.state) !== parsed.hash) throw new SaveError('corrupt', 'the save state does not match its hash');
  // The hash covers only the state, so the header must match it before its version picks the migrations.
  if (parsed.version !== parsed.state.version || parsed.savedTick !== parsed.state.tick) {
    throw new SaveError('corrupt', 'the save header does not match its state');
  }
  if (parsed.version > currentVersion) {
    throw new SaveError('too-new', `save version ${parsed.version} is newer than ${currentVersion}`);
  }
  let state = parsed.state as unknown as Record<string, unknown>;
  for (let version = parsed.version; version < currentVersion; version++) {
    const migrate = migrations[version];
    if (!migrate) throw new SaveError('no-migration', `no migration from version ${version}`);
    state = migrate(state);
    state['version'] = version + 1;
  }
  return state as unknown as SimState;
}
