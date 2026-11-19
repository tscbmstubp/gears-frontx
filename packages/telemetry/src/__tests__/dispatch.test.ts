import { describe, expect, it, vi } from 'vitest';
import { createConnectorDispatch } from '../connectors/dispatch';
import { passThroughRecord } from '../connectors/consentGate';
import type { TelemetryConnector } from '../connectors/types';

const rec = (data: unknown = { a: { b: 1 } }) => data as never;
const logger = () => ({ logMessage: vi.fn(), logError: vi.fn() });

function setup(connectors: TelemetryConnector[]) {
  const d = createConnectorDispatch(connectors);
  d.open();
  const log = logger();
  const send = (data: unknown) => passThroughRecord(rec(data), d.dispatchRecord, log);
  return { d, log, send };
}

describe('connector dispatch', () => {
  it('isolates a throwing and a rejecting connector', async () => {
    const got = vi.fn();
    const { send } = setup([
      { onRecord: () => { throw new Error('x'); } },
      { onRecord: () => Promise.reject(new Error('y')) },
      { onRecord: got },
    ]);
    expect(() => send({ n: 1 })).not.toThrow();
    send({ n: 2 });
    await Promise.resolve();
    expect(got).toHaveBeenCalledTimes(2);
  });

  it('calls connectors in order', () => {
    const order: number[] = [];
    const { send } = setup([
      { onRecord: () => { order.push(1); } },
      {},
      { onRecord: () => { order.push(3); } },
    ]);
    send({});
    expect(order).toEqual([1, 3]);
  });

  it('passes one frozen copy that tampering cannot change', () => {
    const original = { a: { b: 1 } };
    const seen: unknown[] = [];
    type Rec = { a: { b: number }; x?: number };
    const tamper = (r: Rec) => {
      seen.push(r);
      try { r.a.b = 99; } catch { /* frozen */ }
      try { r.x = 1; } catch { /* frozen */ }
    };
    const { send } = setup([{ onRecord: tamper as never }, { onRecord: tamper as never }]);
    send(original);
    expect(seen[0]).toBe(seen[1]);
    expect(Object.isFrozen(seen[0])).toBe(true);
    expect(Object.isFrozen((seen[0] as Rec).a)).toBe(true);
    expect((seen[0] as Rec).a.b).toBe(1);
    expect(seen[0]).not.toBe(original);
    expect(original).toEqual({ a: { b: 1 } });
  });

  it('drops data holding a function, logs, and does not throw', () => {
    const got = vi.fn();
    const { send, log } = setup([{ onRecord: got }]);
    expect(() => send({ f: () => 1 })).not.toThrow();
    expect(got).not.toHaveBeenCalled();
    expect(log.logError).toHaveBeenCalled();
  });

  describe('JSON-like copy', () => {
    const received = (data: unknown) => {
      const got = vi.fn();
      const { send, log } = setup([{ onRecord: got }]);
      send(data);
      return { got, log, copy: got.mock.calls[0]?.[0] as Record<string, unknown> };
    };

    it('turns a date into its ISO string and an invalid date into null', () => {
      const { copy } = received({ at: new Date('2026-01-02T03:04:05.000Z'), bad: new Date(NaN) });
      expect(copy).toEqual({ at: '2026-01-02T03:04:05.000Z', bad: null });
    });

    it('turns a map into an object with string keys, the later duplicate winning', () => {
      const { copy } = received({ m: new Map<unknown, unknown>([[1, 'a'], ['1', 'b'], [2, new Date(0)]]) });
      expect(copy.m).toEqual({ 1: 'b', 2: '1970-01-01T00:00:00.000Z' });
      expect(Object.getPrototypeOf(copy.m)).toBe(Object.prototype);
    });

    it('turns a set, typed arrays, an ArrayBuffer and a DataView into arrays', () => {
      const bytes = new Uint8Array([1, 2, 3]);
      const { copy } = received({
        s: new Set([1, 'a', new Date(0)]),
        u: bytes,
        f: new Float32Array([1.5, NaN]),
        b: bytes.buffer,
        v: new DataView(new Uint8Array([9, 8, 7, 6]).buffer, 1, 2),
      });
      expect(copy).toEqual({
        s: [1, 'a', '1970-01-01T00:00:00.000Z'],
        u: [1, 2, 3],
        f: [1.5, null],
        b: [1, 2, 3],
        v: [8, 7],
      });
    });

    it('turns NaN and the infinities into null and keeps finite numbers', () => {
      const { copy } = received({ a: NaN, b: Infinity, c: -Infinity, d: 0, e: -1.5 });
      expect(copy).toEqual({ a: null, b: null, c: null, d: 0, e: -1.5 });
    });

    it('omits undefined from an object and turns it into null in an array', () => {
      const { copy } = received({ a: undefined, b: [1, undefined, 3], c: new Map([['k', undefined]]) });
      expect('a' in copy).toBe(false);
      expect(copy.b).toEqual([1, null, 3]);
      expect(copy.c).toEqual({});
    });

    it('turns a class instance and an error into their own enumerable properties', () => {
      const hidden = Symbol('hidden');
      class Point {
        x = 1;
        y = undefined;
        [hidden] = 5;
        get sum() { return 3; }
        toJSON() { return 'ignored'; }
      }
      const error = Object.assign(new Error('boom'), { code: 7 });
      const { copy } = received({ p: new Point(), e: error, n: null, t: 'x', ok: true });
      expect(copy).toEqual({ p: { x: 1 }, e: { code: 7 }, n: null, t: 'x', ok: true });
    });

    it.each([
      ['a bigint', { n: 1n }],
      ['a function', { f: () => 1 }],
      ['a symbol', { s: Symbol('x') }],
      ['a bigint typed array', { t: new BigInt64Array(1) }],
    ])('drops a record holding %s, logging once', (_name, data) => {
      const { got, log } = received(data);
      expect(got).not.toHaveBeenCalled();
      expect(log.logError).toHaveBeenCalledTimes(1);
    });

    it('drops a cyclic record, also through a map or a set, logging once', () => {
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;
      const viaMap = new Map<string, unknown>();
      viaMap.set('me', viaMap);
      const viaSet = new Set<unknown>();
      viaSet.add(viaSet);
      for (const data of [cyclic, { m: viaMap }, { s: viaSet }]) {
        const { got, log } = received(data);
        expect(got).not.toHaveBeenCalled();
        expect(log.logError).toHaveBeenCalledTimes(1);
      }
    });

    it('copies the same object reached twice without a cycle twice', () => {
      const shared = { n: 1 };
      const { got, copy } = received({ a: shared, b: shared, c: [shared] });
      expect(got).toHaveBeenCalledTimes(1);
      expect(copy.a).toEqual({ n: 1 });
      expect(copy.a).not.toBe(copy.b);
      expect(copy.a).not.toBe((copy.c as unknown[])[0]);
    });

    it('keeps a key named __proto__ as an own property', () => {
      const { copy } = received(JSON.parse('{"__proto__":{"x":1}}'));
      expect(Object.keys(copy)).toEqual(['__proto__']);
      expect(Object.getPrototypeOf(copy)).toBe(Object.prototype);
    });

    it('freezes the copy all the way down', () => {
      const { copy } = received({ d: new Date(0), m: new Map([['k', { z: 1 }]]), s: new Set([{ z: 1 }]), u: new Uint8Array(2) });
      const frozen = (v: unknown): boolean =>
        !v || typeof v !== 'object' || (Object.isFrozen(v) && Object.values(v).every(frozen));
      expect(frozen(copy)).toBe(true);
      expect(Object.isFrozen(copy.u)).toBe(true);
    });

    it('leaves the original untouched for the collector', () => {
      const original = { at: new Date(0), m: new Map([['k', 1]]) };
      const { copy } = received(original);
      expect(copy.at).not.toBe(original.at);
      expect(original.at).toBeInstanceOf(Date);
      expect(original.m).toBeInstanceOf(Map);
      expect(original.m.get('k')).toBe(1);
      expect(Object.isFrozen(original)).toBe(false);
    });
  });

  it('routes signals to matching handlers only and never onMeasurement', () => {
    const a = { onIdentityChange: vi.fn(), onConsentChange: vi.fn(), onFlush: vi.fn(), onShutdown: vi.fn(), onMeasurement: vi.fn() };
    const b = { onFlush: vi.fn() };
    const { d } = setup([a, b]);
    d.dispatchIdentityChange('u' as never);
    d.dispatchConsentChange('granted');
    d.dispatchFlush();
    d.dispatchShutdown();
    expect(a.onIdentityChange).toHaveBeenCalledWith('u');
    expect(a.onConsentChange).toHaveBeenCalledWith('granted');
    expect(a.onFlush).toHaveBeenCalledTimes(1);
    expect(a.onShutdown).toHaveBeenCalledTimes(1);
    expect(b.onFlush).toHaveBeenCalledTimes(1);
    expect(a.onMeasurement).not.toHaveBeenCalled();
  });

  it('close() inside a handler stops the remaining connectors', () => {
    const second = vi.fn();
    const { d, send } = setup([{ onRecord: () => d.close() }, { onRecord: second }]);
    send({});
    expect(second).not.toHaveBeenCalled();
    expect(d.getState()).toBe('CLOSED');
  });

  it('returns depth to 0 after a throw', () => {
    let inside = -1;
    const { d, send } = setup([
      { onRecord: () => { inside = d.getDepth(); throw new Error('x'); } },
    ]);
    send({});
    expect(inside).toBe(1);
    expect(d.getDepth()).toBe(0);
  });

  it('drops silently while WAITING and CLOSED', () => {
    const c = { onRecord: vi.fn(), onFlush: vi.fn(), onIdentityChange: vi.fn() };
    const d = createConnectorDispatch([c]);
    const log = logger();
    expect(d.getState()).toBe('WAITING');
    passThroughRecord(rec({}), d.dispatchRecord, log);
    d.dispatchFlush();
    d.open();
    d.close();
    passThroughRecord(rec({}), d.dispatchRecord, log);
    d.dispatchIdentityChange(undefined);
    d.requestFlush();
    expect(c.onRecord).not.toHaveBeenCalled();
    expect(c.onFlush).not.toHaveBeenCalled();
    expect(c.onIdentityChange).not.toHaveBeenCalled();
    expect(log.logError).not.toHaveBeenCalled();
  });

  it('requestFlush reaches every onFlush', () => {
    const f1 = vi.fn();
    const f2 = vi.fn();
    const { d } = setup([{ onFlush: f1 }, { onFlush: f2 }]);
    d.requestFlush();
    expect(f1).toHaveBeenCalledTimes(1);
    expect(f2).toHaveBeenCalledTimes(1);
  });
});
