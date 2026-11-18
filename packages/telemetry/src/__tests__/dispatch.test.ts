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
