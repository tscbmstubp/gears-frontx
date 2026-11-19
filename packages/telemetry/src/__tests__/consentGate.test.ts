import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConsentGate, createGateStage } from '../connectors/consentGate';
import { createConnectorDispatch } from '../connectors/dispatch';
import type { TelemetryConnector, TelemetryConsentState } from '../connectors/types';
import { createInspector } from '../inspector/inspector';
import { createUserInfoManager } from '../managers/userInfo';
import type { BuildKind } from '../build/kind';

const rec = (n: number, extra: object = {}) => Object.freeze({ name: `r${n}`, ...extra }) as never;

function make(kind: BuildKind = 'development', consent?: { unsetCountsAsGranted?: boolean }) {
  // The notice is observed where the dev inspector writes it; production writes nothing.
  const notice = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  const inspector = createInspector(kind);
  const gate = createConsentGate({ consent, inspector });
  return { gate, notice };
}

afterEach(() => vi.restoreAllMocks());

describe('consent gate: effective state', () => {
  it.each([
    [false, 'unknown'],
    [true, 'granted'],
  ])('never set, unsetCountsAsGranted=%s -> %s', (flag, expected) => {
    expect(make('development', { unsetCountsAsGranted: flag }).gate.effectiveState()).toBe(expected);
  });

  it.each([
    [false, 'unknown', 'unknown'],
    [true, 'unknown', 'granted'],
    [false, 'granted', 'granted'],
    [true, 'granted', 'granted'],
    [false, 'denied', 'denied'],
    [true, 'denied', 'denied'],
  ] as const)('unsetCountsAsGranted=%s, set %s -> %s', (flag, set, expected) => {
    const { gate } = make('development', { unsetCountsAsGranted: flag });
    gate.setState(set);
    expect(gate.effectiveState()).toBe(expected);
  });
});

describe('consent gate: hold', () => {
  it('keeps FIFO order and bounds at 1000, dropping the oldest', () => {
    const { gate } = make();
    for (let i = 0; i < 1001; i++) gate.holdAdd(rec(i));
    expect(gate.accessor.holdSize()).toBe(1000);
    const held = gate.heldRecords();
    expect(held[0]).toMatchObject({ name: 'r1' });
    expect(held[999]).toMatchObject({ name: 'r1000' });
    expect(held.some((r) => (r as { name: string }).name === 'r0')).toBe(false);
  });

  it('shows one development notice only', () => {
    const { gate, notice } = make('development');
    for (let i = 0; i < 1001; i++) gate.holdAdd(rec(i));
    expect(notice).toHaveBeenCalledTimes(1);
    for (let i = 0; i < 999; i++) gate.holdAdd(rec(i));
    expect(notice).toHaveBeenCalledTimes(1);
  });

  it('shows no notice in a production build', () => {
    const { gate, notice } = make('production');
    for (let i = 0; i < 2000; i++) gate.holdAdd(rec(i));
    expect(gate.accessor.holdSize()).toBe(1000);
    expect(notice).not.toHaveBeenCalled();
  });
});

describe('consent gate: re-grant removal', () => {
  const fields = {
    context_user_id: 'u',
    context_user_distinct_id: 'd',
    context_user_email: 'e',
    context_user_username: 'n',
    context_user_first_name: 'f',
    context_user_last_name: 'l',
  };

  it('returns the same object while the marker is lowered', () => {
    const { gate } = make();
    const copy = rec(1, fields);
    expect(gate.removeUserFields(copy)).toBe(copy);
  });

  it('removes the six fields, keeps the rest, nested refs and freezes', () => {
    const { gate } = make();
    const nested = Object.freeze({ k: 1 });
    const copy = Object.freeze({ name: 'x', ...fields, context_user_data: nested, other: nested }) as never;
    gate.raise();
    const result = gate.removeUserFields(copy) as Record<string, unknown>;
    expect(Object.keys(result).sort()).toEqual(['context_user_data', 'name', 'other']);
    expect(result.context_user_data).toBe(nested);
    expect(result.other).toBe(nested);
    expect(Object.isFrozen(result)).toBe(true);
  });
});

describe('consent gate: re-grant marker', () => {
  it('starts lowered, raises on a change to denied, lowers only on a set identity', () => {
    const { gate } = make();
    expect(gate.accessor.marker()).toBe(false);
    gate.setState('denied');
    expect(gate.accessor.marker()).toBe(true);
    gate.setState('granted');
    expect(gate.accessor.marker()).toBe(true);
    gate.lower(undefined);
    expect(gate.accessor.marker()).toBe(true);
    gate.lower('user-1');
    expect(gate.accessor.marker()).toBe(false);
  });

  it('accessor exposes held and kept identity (empty at start)', () => {
    const { gate } = make();
    expect(gate.accessor.heldIdentity()).toBeUndefined();
    expect(gate.accessor.keptIdentity()).toBeUndefined();
  });
});

describe('consent gate: apply rules', () => {
  function rules(consent?: { unsetCountsAsGranted?: boolean; holdWhileUnknown?: boolean }) {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const gate = createConsentGate({ consent, inspector: createInspector('development') });
    const received: unknown[] = [];
    const connector = { onRecord: (r: unknown) => void received.push(r) };
    const logger = { logError: vi.fn() };
    let destroyed = false;
    const stage = createGateStage(
      [connector],
      (frozen) => connector.onRecord(frozen),
      logger,
      gate,
      () => destroyed,
    );
    return { gate, stage, received, logger, destroy: () => (destroyed = true) };
  }
  const plain = () => ({ name: 'e', data: { a: [1, { b: 2 }] }, context_user_id: 'u1' }) as never;
  const uncopyable = () => ({ name: 'e', data: { f: () => 1 } }) as never;

  it('unknown with holding on: nothing reaches the connector and the hold grows', () => {
    const { gate, stage, received } = rules();
    stage(plain());
    stage(plain());
    expect(received).toHaveLength(0);
    expect(gate.accessor.holdSize()).toBe(2);
  });

  it.each([
    ['denied', undefined],
    ['unknown, holding off', { holdWhileUnknown: false }],
  ] as const)('%s: drops without copying', (label, consent) => {
    const { gate, stage, received, logger } = rules(consent);
    if (label === 'denied') gate.setState('denied');
    stage(uncopyable());
    stage(plain());
    expect(logger.logError).not.toHaveBeenCalled();
    expect(received).toHaveLength(0);
    expect(gate.accessor.holdSize()).toBe(0);
  });

  it('granted passes exactly one deeply frozen copy', () => {
    const { gate, stage, received } = rules();
    gate.setState('granted');
    const original = plain() as { data: { a: unknown[] } };
    stage(original as never);
    expect(received).toHaveLength(1);
    const copy = received[0] as { data: { a: [number, object] } };
    expect(copy).not.toBe(original);
    expect(copy).toEqual(original);
    expect(Object.isFrozen(copy)).toBe(true);
    expect(Object.isFrozen(copy.data.a[1])).toBe(true);
    expect(gate.accessor.holdSize()).toBe(0);
  });

  it.each(['granted', 'unknown'] as const)('%s: an uncopyable record logs once and reaches no one', (s) => {
    const { gate, stage, received, logger } = rules();
    if (s === 'granted') gate.setState('granted');
    stage(uncopyable());
    expect(logger.logError).toHaveBeenCalledTimes(1);
    expect(received).toHaveLength(0);
    expect(gate.accessor.holdSize()).toBe(0);
  });

  it('marker raised: passed and held copies have no user fields', () => {
    const { gate, stage, received } = rules();
    gate.setState('denied');
    expect(gate.accessor.marker()).toBe(true);
    gate.setState('unknown');
    stage(plain());
    const held = gate.heldRecords()[0] as Record<string, unknown>;
    expect(held).not.toHaveProperty('context_user_id');
    gate.setState('granted');
    stage(plain());
    expect(received[0]).not.toHaveProperty('context_user_id');
    expect(received[0]).toHaveProperty('name', 'e');
  });

  it('destroyed: nothing is copied, held or passed', () => {
    const { gate, stage, received, logger, destroy } = rules({ unsetCountsAsGranted: true });
    destroy();
    stage(uncopyable());
    stage(plain());
    expect(received).toHaveLength(0);
    expect(logger.logError).not.toHaveBeenCalled();
    expect(gate.accessor.holdSize()).toBe(0);
  });

  it('skips without copying when no connector has a record handler', () => {
    const gate = createConsentGate({ consent: { unsetCountsAsGranted: true }, inspector: { notice: vi.fn() } });
    const logger = { logError: vi.fn() };
    const dispatchRecord = vi.fn();
    createGateStage([{ onFlush: vi.fn() }], dispatchRecord, logger, gate, () => false)(uncopyable());
    expect(dispatchRecord).not.toHaveBeenCalled();
    expect(logger.logError).not.toHaveBeenCalled();
  });
});

describe('consent gate: queue and consent change', () => {
  type Log = string[];
  function wire(connectors: TelemetryConnector[], opts?: { unsetCountsAsGranted?: boolean }) {
    const { gate } = make('development', opts);
    const dispatch = createConnectorDispatch(connectors);
    dispatch.open();
    const logger = { logError: vi.fn() };
    let destroyed = false;
    const deps = {
      dispatchRecord: dispatch.dispatchRecord,
      dispatchConsentChange: dispatch.dispatchConsentChange,
      dispatchIdentityChange: dispatch.dispatchIdentityChange,
      isDispatchOpen: () => dispatch.getState() === 'OPEN',
      logger,
      isDestroyed: () => destroyed,
    };
    const setConsent = (s: TelemetryConsentState) => gate.setConsent(s, deps);
    const record = (r: object) => gate.runBusy(() => gate.applyRules(r as never, deps));
    return { gate, setConsent, record, logger, destroy: () => (destroyed = true) };
  }
  const recorder = (log: Log, tag = ''): TelemetryConnector => ({
    onRecord: (r) => void log.push(`${tag}rec:${(r as { name: string }).name}`),
    onConsentChange: (s) => void log.push(`${tag}consent:${s}`),
    onIdentityChange: (id) => void log.push(`${tag}id:${String(id)}`),
  });

  it('grant releases consent change, then identity, then records in order', () => {
    const log: Log = [];
    const w = wire([recorder(log)]);
    w.record({ name: 'a' });
    w.record({ name: 'b' });
    w.gate.holdIdentity({ id: 'u1' as never });
    w.setConsent('granted');
    expect(log).toEqual(['consent:granted', 'id:u1', 'rec:a', 'rec:b']);
    expect(w.gate.accessor.holdSize()).toBe(0);
    expect(w.gate.accessor.heldIdentity()).toBeUndefined();
  });

  it('denial drops held data and raises the marker', () => {
    const log: Log = [];
    const w = wire([recorder(log)]);
    w.record({ name: 'a' });
    w.gate.holdIdentity({ id: 'u1' as never });
    w.setConsent('denied');
    expect(log).toEqual(['consent:denied']);
    expect(w.gate.accessor.holdSize()).toBe(0);
    expect(w.gate.accessor.heldIdentity()).toBeUndefined();
    expect(w.gate.accessor.marker()).toBe(true);
  });

  it('the same effective state passes nothing', () => {
    const log: Log = [];
    const w = wire([recorder(log)], { unsetCountsAsGranted: true });
    w.setConsent('granted');
    w.setConsent('unknown');
    expect(log).toEqual([]);
  });

  it('onConsentChange denying during a grant: every connector sees granted then denied', () => {
    const log: Log = [];
    const denier: TelemetryConnector = {
      ...recorder(log, '1:'),
      onConsentChange: (s) => {
        log.push(`1:consent:${s}`);
        if (s === 'granted') w.setConsent('denied');
      },
    };
    const w = wire([denier, recorder(log, '2:')]);
    w.record({ name: 'a' });
    w.setConsent('granted');
    w.record({ name: 'late' });
    expect(log.filter((l) => l.startsWith('1:consent'))).toEqual(['1:consent:granted', '1:consent:denied']);
    expect(log.filter((l) => l.startsWith('2:consent'))).toEqual(['2:consent:granted', '2:consent:denied']);
    expect(log.some((l) => l.includes('rec:late'))).toBe(false);
  });

  it('onRecord denying during a release: the release finishes, then the denial, nothing twice', () => {
    const log: Log = [];
    const c: TelemetryConnector = {
      ...recorder(log),
      onRecord: (r) => {
        log.push(`rec:${(r as { name: string }).name}`);
        w.setConsent('denied');
      },
    };
    const w = wire([c]);
    w.record({ name: 'a' });
    w.record({ name: 'b' });
    w.gate.holdIdentity({ id: 'u1' as never });
    w.setConsent('granted');
    expect(log).toEqual(['consent:granted', 'id:u1', 'rec:a', 'rec:b', 'consent:denied']);
  });

  it('an invalid value is ignored and logged', () => {
    const log: Log = [];
    const w = wire([recorder(log)]);
    w.setConsent('maybe' as never);
    expect(log).toEqual([]);
    expect(w.gate.effectiveState()).toBe('unknown');
    expect(w.logger.logError).toHaveBeenCalledTimes(1);
  });

  it('queued operations run in arrival order after the outermost operation', () => {
    const order: string[] = [];
    const { gate } = make();
    gate.runQueued(() => {
      order.push('outer:start');
      gate.runQueued(() => {
        order.push('q1');
        gate.runQueued(() => order.push('q3'));
      });
      gate.runQueued(() => order.push('q2'));
      gate.runBusy(() => order.push('busy-inline'));
      order.push('outer:end');
    });
    expect(order).toEqual(['outer:start', 'busy-inline', 'outer:end', 'q1', 'q2', 'q3']);
  });
});

describe('consent gate: identity and reset', () => {
  type Log = string[];
  type Hook = (r: Record<string, unknown>) => void;
  const SIX = {
    context_user_id: 'p',
    context_user_distinct_id: 'p',
    context_user_email: 'p',
    context_user_username: 'p',
    context_user_first_name: 'p',
    context_user_last_name: 'p',
  };
  function wire(opts?: { unsetCountsAsGranted?: boolean; open?: boolean; plugin?: boolean }) {
    const log: Log = [];
    const { gate } = make('development', opts);
    const dispatch = createConnectorDispatch([
      {
        onRecord: (r) => {
          const u = (r as Record<string, unknown>).context_user_id;
          log.push(`rec:${(r as { name: string }).name}${u === undefined ? '' : `:${String(u)}`}`);
        },
        onConsentChange: (s) => void log.push(`consent:${s}`),
        onIdentityChange: (id) => void log.push(`id:${String(id)}`),
      },
    ]);
    if (opts?.open !== false) dispatch.open();
    let hook: Hook = () => undefined;
    const userInfo = createUserInfoManager({
      hooks: { addHook: (_: string, fn: Hook) => void (hook = fn) },
    } as never);
    let destroyed = false;
    const deps = {
      dispatchRecord: dispatch.dispatchRecord,
      dispatchConsentChange: dispatch.dispatchConsentChange,
      dispatchIdentityChange: dispatch.dispatchIdentityChange,
      isDispatchOpen: () => dispatch.getState() === 'OPEN',
      logger: { logError: vi.fn() },
      isDestroyed: () => destroyed,
      userInfo,
    };
    // A record as the client builds it: the plugin adds the six user fields, then the stamp.
    const record = (name: string) => {
      const r: Record<string, unknown> = { name, ...(opts?.plugin ? SIX : {}), context_user_data: { k: 1 } };
      hook(r);
      gate.runBusy(() => gate.applyRules(r as never, deps));
    };
    return {
      gate,
      log,
      record,
      open: () => dispatch.open(),
      destroy: () => (destroyed = true),
      setConsent: (s: TelemetryConsentState) => gate.setConsent(s, deps),
      identify: (id: string) => gate.identify(id as never, deps),
      reset: () => gate.resetIdentity(deps),
    };
  }

  it('granted: passes the identity; records carry the stamp', () => {
    const w = wire({ unsetCountsAsGranted: true });
    w.identify('A');
    w.record('e');
    expect(w.log).toEqual(['id:A', 'rec:e:A']);
  });

  it('unknown: holds the identity, a later one replaces it', () => {
    const w = wire();
    w.identify('A');
    w.identify('B');
    expect(w.log).toEqual([]);
    expect(w.gate.accessor.heldIdentity()).toEqual({ id: 'B' });
    w.setConsent('granted');
    expect(w.log).toEqual(['consent:granted', 'id:B']);
  });

  it('denied: drops the identity', () => {
    const w = wire();
    w.setConsent('denied');
    w.identify('A');
    expect(w.log).toEqual(['consent:denied']);
    expect(w.gate.accessor.heldIdentity()).toBeUndefined();
  });

  it('destroyed: nothing is kept, held or passed', () => {
    const w = wire({ open: false });
    w.destroy();
    w.identify('A');
    w.reset();
    expect(w.gate.accessor.keptIdentity()).toBeUndefined();
    const g = wire();
    g.destroy();
    g.identify('A');
    expect(g.gate.accessor.heldIdentity()).toBeUndefined();
    expect(g.log).toEqual([]);
  });

  it('before start: keeps the latest identity whatever the state, a reset clears it', () => {
    const w = wire({ open: false });
    w.setConsent('denied');
    w.identify('A');
    expect(w.gate.accessor.keptIdentity()).toEqual({ id: 'A' });
    w.identify('B');
    expect(w.gate.accessor.keptIdentity()).toEqual({ id: 'B' });
    w.reset();
    expect(w.gate.accessor.keptIdentity()).toBeUndefined();
    expect(w.log).toEqual([]);
  });

  it('reset under granted passes a cleared identity; later records carry no context_user_id', () => {
    const w = wire({ unsetCountsAsGranted: true });
    w.identify('A');
    w.reset();
    w.record('e');
    expect(w.log).toEqual(['id:A', 'id:undefined', 'rec:e']);
  });

  it('reset under denied passes nothing', () => {
    const w = wire();
    w.setConsent('denied');
    w.reset();
    expect(w.log).toEqual(['consent:denied']);
  });

  it('identify A granted, unknown, reset, grant: consent change, then a cleared identity, then held records', () => {
    const w = wire();
    w.setConsent('granted');
    w.identify('A');
    w.setConsent('unknown');
    w.record('h');
    w.reset();
    expect(w.gate.accessor.heldIdentity()).toEqual({ id: undefined });
    w.setConsent('granted');
    expect(w.log).toEqual(['consent:granted', 'id:A', 'consent:unknown', 'consent:granted', 'id:undefined', 'rec:h:A']);
  });

  it('reset under unknown, then denial drops the held cleared identity', () => {
    const w = wire();
    w.reset();
    w.setConsent('denied');
    expect(w.gate.accessor.heldIdentity()).toBeUndefined();
    expect(w.log).toEqual(['consent:denied']);
  });

  it('re-grant: identify A, deny, unknown, held records, identify B, grant', () => {
    const w = wire({ plugin: true });
    w.setConsent('granted');
    w.identify('A');
    w.setConsent('denied');
    w.setConsent('unknown');
    w.record('h1');
    w.record('h2');
    w.identify('B');
    expect(w.gate.accessor.marker()).toBe(true);
    w.log.length = 0;
    w.setConsent('granted');
    expect(w.log).toEqual(['consent:granted', 'id:B', 'rec:h1', 'rec:h2']);
    expect(w.gate.accessor.marker()).toBe(false);
    w.record('after');
    expect(w.log.at(-1)).toBe('rec:after:B');
  });

  it('a held cleared identity released on grant does not lower the marker', () => {
    const w = wire({ plugin: true });
    w.setConsent('denied');
    w.setConsent('unknown');
    w.reset();
    w.setConsent('granted');
    expect(w.gate.accessor.marker()).toBe(true);
  });

  it('identify A, deny, grant, reset: the marker stays raised', () => {
    const w = wire({ plugin: true });
    w.setConsent('granted');
    w.identify('A');
    w.setConsent('denied');
    w.setConsent('granted');
    w.reset();
    expect(w.gate.accessor.marker()).toBe(true);
    w.record('e');
    expect(w.log.at(-1)).toBe('rec:e');
  });

  it('identify and reset from a connector handler are queued; the stamp is not', () => {
    const { gate } = make('development', { unsetCountsAsGranted: true });
    const order: string[] = [];
    const userInfo = { identify: (id: unknown) => void order.push(`stamp:${String(id)}`), clear: () => void order.push('clear') };
    const dispatch = createConnectorDispatch([{ onIdentityChange: (id) => void order.push(`id:${String(id)}`) }]);
    dispatch.open();
    const deps = {
      dispatchRecord: dispatch.dispatchRecord,
      dispatchConsentChange: dispatch.dispatchConsentChange,
      dispatchIdentityChange: dispatch.dispatchIdentityChange,
      isDispatchOpen: () => true,
      logger: { logError: vi.fn() },
      isDestroyed: () => false,
      userInfo,
    };
    gate.runQueued(() => {
      gate.identify('A' as never, deps);
      gate.resetIdentity(deps);
      order.push('outer:end');
    });
    expect(order).toEqual(['stamp:A', 'clear', 'outer:end', 'id:A', 'id:undefined']);
  });
});
