import type { BuildKind } from '../build/kind';
import type { TelemetryRecord } from './eventTypes';
import type { TelemetrySession } from './types';

// @cpt-dod:cpt-frontx-telemetry-dod-declared-events-contained-enrichment:p1

export type TelemetryHooks = {
  start: (...args: any[]) => void;
  destroy: (...args: any[]) => void;
  event: (record: TelemetryRecord) => void;
  sessionStart: (session: TelemetrySession) => void;
};

export type HooksManager = {
  addHook: <Key extends TelemetryHooksKeys = TelemetryHooksKeys>(
    key: Key,
    hook: TelemetryHooks[Key],
  ) => void;
  callHooksSync: <Key extends TelemetryHooksKeys = TelemetryHooksKeys>(
    key: Key,
    ...args: Parameters<TelemetryHooks[Key]>
  ) => void;
  callHooks: <Key extends TelemetryHooksKeys = TelemetryHooksKeys>(
    key: Key,
    ...args: Parameters<TelemetryHooks[Key]>
  ) => Promise<void>;
  /** The hook functions registered under a key, in registration order. */
  getHooks: <Key extends TelemetryHooksKeys = TelemetryHooksKeys>(key: Key) => TelemetryHooks[Key][];
};

export type TelemetryHooksKeys = keyof TelemetryHooks;

export type TelemetryPluginHook = TelemetryHooks[TelemetryHooksKeys];

export type TelemetryHooksService = ReturnType<typeof createHooks>;

export function createHooks(): HooksManager {
  const hooks = new Map<TelemetryHooksKeys, TelemetryPluginHook[]>();

  return {
    addHook,
    callHooksSync,
    callHooks,
    getHooks,
  };

  function addHook<Key extends TelemetryHooksKeys>(key: Key, hook: TelemetryHooks[Key]) {
    if (!hooks.has(key)) {
      hooks.set(key, []);
    }

    hooks.get(key)!.push(hook);
  }

  function callHooksSync<Key extends TelemetryHooksKeys>(
    key: Key,
    ...args: Parameters<TelemetryHooks[Key]>
  ) {
    let error: unknown = undefined;

    for (const item of getHooks(key)) {
      try {
        // @ts-expect-error args are correct
        item(...args);
      } catch (e: unknown) {
        error ??= e;
      }
    }

    if (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  function getHooks<Key extends TelemetryHooksKeys>(key: Key) {
    return (hooks.get(key) ?? []) as TelemetryHooks[Key][];
  }

  async function callHooks<Key extends TelemetryHooksKeys>(
    key: Key,
    ...args: Parameters<TelemetryHooks[Key]>
  ) {
    let error: unknown = undefined;

    for (const item of getHooks(key)) {
      try {
        // @ts-expect-error args are correct
        await item(...args);
      } catch (e: unknown) {
        error ??= e;
      }
    }

    if (error) {
      throw error instanceof Error ? error : new Error(String(error));
    }
  }
}

// Enrichment for the recording surfaces this design adds: a failing `event` hook keeps the record
// and the caller never sees the error. `failed` holds the hook functions that already failed on
// this client, so each one raises at most one development notice.
// @cpt-algo:cpt-frontx-telemetry-algo-declared-events-contained-enrichment:p1
// @cpt-state:cpt-frontx-telemetry-state-declared-events-hook-failure:p1
export function callEventHooksContained(
  eventHooks: readonly TelemetryHooks['event'][],
  record: TelemetryRecord,
  failed: WeakSet<TelemetryHooks['event']>,
  notice: (message: string) => void,
  buildKind: BuildKind,
): TelemetryRecord {
  // @cpt-begin:cpt-frontx-telemetry-algo-declared-events-contained-enrichment:p1:inst-no-rethrow
  // @cpt-begin:cpt-frontx-telemetry-algo-declared-events-contained-enrichment:p1:inst-each-event-hook
  for (const hook of eventHooks) {
    // @cpt-begin:cpt-frontx-telemetry-algo-declared-events-contained-enrichment:p1:inst-try-event-hook
    try {
      // @cpt-begin:cpt-frontx-telemetry-state-declared-events-hook-failure:p1:inst-clean-stays-clean
      hook(record);
      // @cpt-end:cpt-frontx-telemetry-state-declared-events-hook-failure:p1:inst-clean-stays-clean
      // @cpt-end:cpt-frontx-telemetry-algo-declared-events-contained-enrichment:p1:inst-try-event-hook
      // @cpt-begin:cpt-frontx-telemetry-algo-declared-events-contained-enrichment:p1:inst-catch-event-hook
    } catch (error: unknown) {
      // @cpt-begin:cpt-frontx-telemetry-state-declared-events-hook-failure:p1:inst-reported-stays-reported
      if (failed.has(hook)) {
        continue;
      }
      // @cpt-end:cpt-frontx-telemetry-state-declared-events-hook-failure:p1:inst-reported-stays-reported
      // @cpt-begin:cpt-frontx-telemetry-algo-declared-events-contained-enrichment:p1:inst-notice-first-failure
      // @cpt-begin:cpt-frontx-telemetry-state-declared-events-hook-failure:p1:inst-clean-to-reported
      failed.add(hook);
      if (buildKind === 'development') {
        notice(`An "event" enrichment hook threw; the record was kept: ${String(error)}`);
      }
      // @cpt-end:cpt-frontx-telemetry-state-declared-events-hook-failure:p1:inst-clean-to-reported
      // @cpt-end:cpt-frontx-telemetry-algo-declared-events-contained-enrichment:p1:inst-notice-first-failure
      // @cpt-begin:cpt-frontx-telemetry-algo-declared-events-contained-enrichment:p1:inst-keep-record-going
      continue;
      // @cpt-end:cpt-frontx-telemetry-algo-declared-events-contained-enrichment:p1:inst-keep-record-going
    }
    // @cpt-end:cpt-frontx-telemetry-algo-declared-events-contained-enrichment:p1:inst-catch-event-hook
  }
  // @cpt-end:cpt-frontx-telemetry-algo-declared-events-contained-enrichment:p1:inst-each-event-hook
  // @cpt-end:cpt-frontx-telemetry-algo-declared-events-contained-enrichment:p1:inst-no-rethrow
  // @cpt-begin:cpt-frontx-telemetry-algo-declared-events-contained-enrichment:p1:inst-return-enriched
  return record;
  // @cpt-end:cpt-frontx-telemetry-algo-declared-events-contained-enrichment:p1:inst-return-enriched
}
