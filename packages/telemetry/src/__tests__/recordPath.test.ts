import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BuildKind } from '../build/kind';
import { createGateStage } from '../connectors/consentGate';
import { createConnectorDispatch } from '../connectors/dispatch';
import type { TelemetryConnector } from '../connectors/types';
import type { Inspector } from '../inspector/inspector';
import { createEventsManager } from '../managers/events';
import { deriveTelemetryState } from '../services/state';
import type { TelemetryRecord } from '../utils/eventTypes';
import { createHooks } from '../utils/hooks';
import type { TelemetryConfigNormalized, TelemetryContext } from '../utils/types';

type SetupOptions = {
  buildKind: BuildKind;
  connectors?: TelemetryConnector[];
  collector?: boolean;
  inspector?: Partial<Inspector>;
};

function setup({ buildKind, connectors = [], collector, inspector = {} }: SetupOptions) {
  const config: TelemetryConfigNormalized = {
    appName: 'app',
    appVersion: '1',
    enabled: true,
    verbose: false,
    url: 'https://collector.test/events',
    autocapture: false,
    navigationCapture: false,
    sessionDuration: 1000,
    apiVersion: 2,
    connectors,
    collector,
  };
  const hooks = createHooks();
  const logger = { logMessage: vi.fn(), logError: vi.fn() };
  const telemetryState = deriveTelemetryState({
    connectors,
    collector,
    deliveryEnabled: config.enabled,
    buildKind,
  });
  const dispatch = createConnectorDispatch(connectors);
  const insp: Inspector = {
    show: vi.fn(),
    getRecords: () => [],
    notice: vi.fn(),
    ...inspector,
  };
  const context: TelemetryContext = {
    config,
    hooks,
    logger,
    buildKind,
    getTelemetryState: () => telemetryState,
    dispatch,
    gateStage: createGateStage(connectors, dispatch.dispatchRecord, logger),
    inspector: insp,
  };
  const manager = createEventsManager(context);
  return { manager, hooks, dispatch, inspector: insp, logger };
}

const fetchMock = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(new Response()));

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function postedBodies(): string[] {
  return fetchMock.mock.calls.map(([, init]) => String(init?.body));
}

describe.each<BuildKind>(['production', 'development'])('record path (%s build)', (buildKind) => {
  it('1. builds no record in production without a connector', () => {
    const uuid = vi.spyOn(crypto, 'randomUUID');
    const { manager } = setup({ buildKind, collector: false });
    const result = manager.record(['evt', { a: 1 }], 'new');
    manager.logEvent('evt2');
    manager.destroy();
    if (buildKind === 'production') {
      expect(result).toBeUndefined();
      expect(uuid).not.toHaveBeenCalled();
    } else {
      expect(result?.name).toBe('evt');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('2. drops a record made inside a handler, delivers one after an await and after a throw', async () => {
    const received: string[] = [];
    const ref: { manager?: ReturnType<typeof setup>['manager'] } = {};
    let awaited: Promise<void> | undefined;
    const connector: TelemetryConnector = {
      onRecord(record) {
        received.push(record.name);
        if (record.name === 'outer') {
          ref.manager?.record(['inner-sync'], 'new');
          awaited = (async () => {
            await Promise.resolve();
            ref.manager?.record(['inner-async'], 'new');
          })();
        }
        if (record.name === 'boom') {
          throw new Error('handler failure');
        }
      },
    };
    const ctx = setup({ buildKind, connectors: [connector] });
    const { manager } = ctx;
    ref.manager = manager;
    ctx.dispatch.open();

    manager.record(['outer'], 'new');
    expect(received).toEqual(['outer']);
    if (buildKind === 'development') {
      expect(ctx.inspector.notice).toHaveBeenCalledWith(expect.stringContaining('inside a connector handler'));
    } else {
      expect(ctx.inspector.notice).not.toHaveBeenCalled();
    }
    await awaited;
    expect(received).toEqual(['outer', 'inner-async']);

    manager.record(['boom'], 'new');
    manager.record(['after-boom'], 'new');
    expect(received).toEqual(['outer', 'inner-async', 'boom', 'after-boom']);
    expect(ctx.dispatch.getDepth()).toBe(0);
  });

  it('3. queues nothing and makes no request with the collector off', () => {
    const onRecord = vi.fn();
    const { manager, dispatch } = setup({ buildKind, connectors: [{ onRecord }], collector: false });
    dispatch.open();
    manager.record(['a'], 'new');
    manager.logEvent('b');
    manager.destroy();
    expect(onRecord).toHaveBeenCalledTimes(2);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('4. queues a record made before dispatch opens and gives it to no connector', () => {
    const onRecord = vi.fn();
    const { manager } = setup({ buildKind, connectors: [{ onRecord }], collector: true });
    manager.record(['before-start'], 'new');
    manager.destroy();
    expect(onRecord).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(postedBodies()[0]).toContain('before-start');
  });

  it('5. keeps a forced inspector failure from both callers', () => {
    const failing = () => {
      throw new Error('inspector failure');
    };
    const { manager, dispatch, logger } = setup({
      buildKind,
      connectors: [{ onRecord: vi.fn() }],
      collector: true,
      inspector: { show: failing },
    });
    dispatch.open();
    expect(() => manager.record(['typed'], 'new')).not.toThrow();
    expect(() => manager.logEvent('shipped')).not.toThrow();
    if (buildKind === 'development') {
      expect(logger.logError).toHaveBeenCalledTimes(2);
    }
  });

  it('6. contains a throwing event hook on a new-surface record', () => {
    const onRecord = vi.fn();
    const { manager, hooks, dispatch, inspector } = setup({
      buildKind,
      connectors: [{ onRecord }],
      collector: true,
    });
    const later = vi.fn((record: TelemetryRecord) => {
      record.context_user_id = 'u1';
    });
    hooks.addHook('event', (record) => {
      record.data = { ...record.data, partial: true };
      throw new Error('hook failure');
    });
    hooks.addHook('event', later);
    dispatch.open();

    expect(() => manager.record(['typed-1'], 'new')).not.toThrow();
    expect(() => manager.record(['typed-2'], 'new')).not.toThrow();
    expect(() => manager.record(['typed-3'], 'new')).not.toThrow();

    expect(onRecord).toHaveBeenCalledTimes(3);
    expect(onRecord.mock.calls[0][0]).toMatchObject({ data: { partial: true }, context_user_id: 'u1' });
    expect(later).toHaveBeenCalledTimes(3);
    const notices = (inspector.notice as ReturnType<typeof vi.fn>).mock.calls;
    if (buildKind === 'development') {
      expect(notices).toHaveLength(1);
      expect(String(notices[0][0])).toContain('event');
    } else {
      expect(notices).toHaveLength(0);
    }
    manager.destroy();
    expect(postedBodies()[0]).toContain('typed-3');
  });

  it('7. shipped logEvent still rethrows a hook error and the record goes no further', () => {
    const onRecord = vi.fn();
    const { manager, hooks, dispatch, inspector } = setup({
      buildKind,
      connectors: [{ onRecord }],
      collector: true,
    });
    hooks.addHook('event', () => {
      throw new Error('hook failure');
    });
    dispatch.open();
    expect(() => manager.logEvent('shipped')).toThrow('hook failure');
    manager.destroy();
    expect(onRecord).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(inspector.notice).not.toHaveBeenCalled();
  });

  it("8. keeps the collector's queued record when a connector changes its copy", () => {
    const { manager, dispatch } = setup({
      buildKind,
      connectors: [
        {
          onRecord(record) {
            try {
              (record.data as Record<string, unknown>).value = 'tampered';
            } catch {
              // frozen copy
            }
          },
        },
      ],
      collector: true,
    });
    dispatch.open();
    const record = manager.record(['copy', { value: 'original' }], 'new');
    expect(record?.data).toEqual({ value: 'original' });
    manager.destroy();
    expect(postedBodies()[0]).toContain('original');
    expect(postedBodies()[0]).not.toContain('tampered');
  });
});
