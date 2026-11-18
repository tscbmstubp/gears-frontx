import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { BuildKind } from '../build/kind';
import type { TelemetryConnector } from '../connectors/types';
import { createTelemetryWithBuildKind } from '../services/telemetry';
import type { TelemetryConfig } from '../utils/types';

const baseConfig: TelemetryConfig = {
  appName: 'app',
  appVersion: '1',
  autocapture: false,
  navigationCapture: false,
};

type Call = { connector: string; handler: string; value?: unknown };

function fakeConnector(
  label: string,
  calls: Call[],
  overrides: Partial<TelemetryConnector> = {},
): TelemetryConnector {
  return {
    onRecord: (record) => {
      calls.push({ connector: label, handler: 'onRecord', value: record.name });
    },
    onFlush: () => {
      calls.push({ connector: label, handler: 'onFlush' });
    },
    onShutdown: () => {
      calls.push({ connector: label, handler: 'onShutdown' });
    },
    ...overrides,
  };
}

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
}

const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
});

afterEach(() => {
  setVisibility('visible');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('silent start without a connector', () => {
  it('production silent start: no hook, no listener, no storage write, recording builds nothing', () => {
    const windowAdd = vi.spyOn(window, 'addEventListener');
    const documentAdd = vi.spyOn(document, 'addEventListener');
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => {});
    const telemetry = createTelemetryWithBuildKind(
      { ...baseConfig, collector: false, url: 'https://collector.test/e' },
      'production',
    );
    const eventHook = vi.fn();
    telemetry.plugin({ name: 'probe', setup: (ctx) => ctx.addHook('event', eventHook) });

    expect(telemetry.start()).toBe(telemetry);
    telemetry.logEvent('silent');
    telemetry.destroy();

    expect(eventHook).not.toHaveBeenCalled();
    expect(windowAdd).not.toHaveBeenCalled();
    expect(documentAdd).not.toHaveBeenCalled();
    expect(setItem).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(consoleInfo).not.toHaveBeenCalled();
    expect(telemetry.getRecords()).toEqual([]);
  });

  it('development variant: shows the no-connector notice and records in the console', () => {
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => {});
    const group = vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'groupEnd').mockImplementation(() => {});
    const telemetry = createTelemetryWithBuildKind({ ...baseConfig, collector: false }, 'development');
    onTestFinished(() => telemetry.destroy());

    telemetry.start();
    telemetry.logEvent('shown');

    expect(consoleInfo).toHaveBeenCalledWith(expect.stringMatching(/\[telemetry:dev\].*no connector/i));
    expect(group).toHaveBeenCalledWith('[telemetry:dev] shown');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('beside-connectors notice shown', () => {
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'groupEnd').mockImplementation(() => {});
    const telemetry = createTelemetryWithBuildKind(
      { ...baseConfig, collector: true, connectors: [fakeConnector('a', [])] },
      'development',
    );
    onTestFinished(() => telemetry.destroy());

    telemetry.start();

    expect(consoleInfo).toHaveBeenCalledWith(expect.stringMatching(/collector.*beside.*connectors/i));
    expect(consoleInfo).not.toHaveBeenCalledWith(expect.stringMatching(/no connector/i));
  });

  it('a production client in DELIVERY_SUPPRESSED still registers its enrichment hooks at start', () => {
    const telemetry = createTelemetryWithBuildKind(
      { ...baseConfig, collector: true, enabled: false },
      'production',
    );
    onTestFinished(() => telemetry.destroy());
    const eventHook = vi.fn();
    telemetry.plugin({ name: 'probe', setup: (ctx) => ctx.addHook('event', eventHook) });

    telemetry.start();
    telemetry.logEvent('suppressed');

    expect(eventHook).toHaveBeenCalledWith(expect.objectContaining({ name: 'suppressed' }));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe.each<BuildKind>(['production', 'development'])('collector-only suppression (%s)', (buildKind) => {
  // cpt-frontx-telemetry-dod-connector-delivery-telemetry-state
  it('collector as the only connector, delivery off: enriched and drained, nothing posted, accepts reports, no notice', () => {
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'groupEnd').mockImplementation(() => {});
    const telemetry = createTelemetryWithBuildKind(
      { ...baseConfig, enabled: false, url: 'https://collector.test/e' },
      buildKind,
    );
    const eventHook = vi.fn();
    telemetry.plugin({ name: 'probe', setup: (ctx) => ctx.addHook('event', eventHook) });

    telemetry.start();
    telemetry.logEvent('suppressed');
    telemetry.destroy();

    expect(eventHook).toHaveBeenCalledWith(expect.objectContaining({ name: 'suppressed' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(telemetry.acceptsReports()).toBe(true);
    expect(consoleInfo).not.toHaveBeenCalledWith(expect.stringMatching(/no connector/i));
  });
});

describe.each<BuildKind>(['production', 'development'])('lifecycle (%s)', (buildKind) => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'groupEnd').mockImplementation(() => {});
  });

  function connected(calls: Call[], extra: Partial<TelemetryConfig> = {}) {
    return createTelemetryWithBuildKind(
      {
        ...baseConfig,
        connectors: [fakeConnector('a', calls), fakeConnector('b', calls)],
        ...extra,
      },
      buildKind,
    );
  }

  it('page hidden gives every onFlush one call before the event returns, and no onShutdown', () => {
    const calls: Call[] = [];
    const telemetry = connected(calls);
    onTestFinished(() => telemetry.destroy());
    telemetry.start();
    calls.length = 0;

    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(calls).toEqual([]);

    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(calls).toEqual([
      { connector: 'a', handler: 'onFlush' },
      { connector: 'b', handler: 'onFlush' },
    ]);
  });

  it('pagehide gives every onFlush one call before the event returns, and no onShutdown', () => {
    const calls: Call[] = [];
    const telemetry = connected(calls);
    onTestFinished(() => telemetry.destroy());
    telemetry.start();
    calls.length = 0;

    window.dispatchEvent(new Event('pagehide'));

    expect(calls).toEqual([
      { connector: 'a', handler: 'onFlush' },
      { connector: 'b', handler: 'onFlush' },
    ]);
  });

  it('a throwing start hook still leaves the listeners installed', () => {
    const calls: Call[] = [];
    const telemetry = connected(calls);
    onTestFinished(() => telemetry.destroy());
    telemetry.plugin({
      name: 'bad-start',
      setup: (ctx) =>
        ctx.addHook('start', () => {
          throw new Error('start failed');
        }),
    });

    expect(() => telemetry.start()).toThrow('start failed');
    calls.length = 0;
    window.dispatchEvent(new Event('pagehide'));

    expect(calls).toEqual([
      { connector: 'a', handler: 'onFlush' },
      { connector: 'b', handler: 'onFlush' },
    ]);
  });

  it('destroy with a throwing teardown hook flushes, shuts down, removes listeners, then throws', () => {
    const calls: Call[] = [];
    const telemetry = connected(calls);
    telemetry.plugin({
      name: 'bad-destroy',
      setup: (ctx) =>
        ctx.addHook('destroy', () => {
          throw new Error('teardown failed');
        }),
    });
    telemetry.start();
    calls.length = 0;
    const windowRemove = vi.spyOn(window, 'removeEventListener');
    const documentRemove = vi.spyOn(document, 'removeEventListener');

    expect(() => telemetry.destroy()).toThrow('teardown failed');

    expect(calls).toEqual([
      { connector: 'a', handler: 'onFlush' },
      { connector: 'b', handler: 'onFlush' },
      { connector: 'a', handler: 'onShutdown' },
      { connector: 'b', handler: 'onShutdown' },
    ]);
    expect(windowRemove).toHaveBeenCalledWith('pagehide', expect.any(Function));
    expect(documentRemove).toHaveBeenCalledWith('visibilitychange', expect.any(Function));
    calls.length = 0;
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pagehide'));
    expect(calls).toEqual([]);
  });

  it('destroy with a failing final send and no failing hook throws the send error after the connector calls', () => {
    const calls: Call[] = [];
    const telemetry = connected(calls, { collector: true, url: 'https://collector.test/e' });
    telemetry.start();
    telemetry.logEvent('queued');
    calls.length = 0;
    const sendError = new Error('send failed');
    fetchMock.mockImplementationOnce(() => {
      throw sendError;
    });

    expect(() => telemetry.destroy()).toThrow(sendError);

    expect(calls).toEqual([
      { connector: 'a', handler: 'onFlush' },
      { connector: 'b', handler: 'onFlush' },
      { connector: 'a', handler: 'onShutdown' },
      { connector: 'b', handler: 'onShutdown' },
    ]);
  });

  it('destroy from inside onRecord stops later connectors for that record', () => {
    const calls: Call[] = [];
    const ref: { client?: ReturnType<typeof createTelemetryWithBuildKind> } = {};
    const telemetry = createTelemetryWithBuildKind(
      {
        ...baseConfig,
        connectors: [
          fakeConnector('a', calls, {
            onRecord: (record) => {
              calls.push({ connector: 'a', handler: 'onRecord', value: record.name });
              if (record.name === 'stop') ref.client?.destroy();
            },
          }),
          fakeConnector('b', calls),
        ],
      },
      buildKind,
    );
    ref.client = telemetry;
    telemetry.start();
    calls.length = 0;

    telemetry.logEvent('stop');

    expect(calls).toEqual([
      { connector: 'a', handler: 'onRecord', value: 'stop' },
      { connector: 'a', handler: 'onFlush' },
      { connector: 'b', handler: 'onFlush' },
      { connector: 'a', handler: 'onShutdown' },
      { connector: 'b', handler: 'onShutdown' },
    ]);
  });

  it('destroy from a connector during start leaves no history wrapper behind', () => {
    const store = new Map<string, string>();
    const freshStorage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: vi.fn((key: string, value: string) => void store.set(key, value)),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
      key: (index: number) => [...store.keys()][index] ?? null,
      get length() {
        return store.size;
      },
    };
    vi.stubGlobal('localStorage', freshStorage);
    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;
    onTestFinished(() => {
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ref: { client?: ReturnType<typeof createTelemetryWithBuildKind> } = {};
    const telemetry = createTelemetryWithBuildKind(
      {
        ...baseConfig,
        navigationCapture: true,
        verbose: true,
        connectors: [
          fakeConnector('a', [], {
            onRecord: (record) => {
              if (record.name === 'session_start') ref.client?.destroy();
            },
          }),
        ],
      },
      buildKind,
    );
    ref.client = telemetry;

    expect(() => telemetry.start()).not.toThrow();
    expect(window.history.pushState).toBe(originalPushState);
    expect(window.history.replaceState).toBe(originalReplaceState);

    freshStorage.setItem.mockClear();
    window.history.pushState({}, '', '/after-destroy');

    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringContaining('Telemetry has been destroyed'),
      expect.anything(),
    );
    expect(freshStorage.setItem).not.toHaveBeenCalled();
  });

  it('a start hook error raised before a connector destroys the client during start is still thrown', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
      removeItem: (key: string) => void store.delete(key),
      clear: () => store.clear(),
      key: (index: number) => [...store.keys()][index] ?? null,
      get length() {
        return store.size;
      },
    });
    const originalPushState = window.history.pushState;
    const originalReplaceState = window.history.replaceState;
    onTestFinished(() => {
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const order: string[] = [];
    const hookError = new Error('caller start hook failed');
    const ref: { client?: ReturnType<typeof createTelemetryWithBuildKind> } = {};
    const telemetry = createTelemetryWithBuildKind(
      {
        ...baseConfig,
        navigationCapture: true,
        verbose: true,
        connectors: [
          fakeConnector('a', [], {
            onRecord: (record) => {
              order.push(record.name);
              if (record.name === 'session_start') ref.client?.destroy();
            },
          }),
        ],
      },
      buildKind,
    );
    ref.client = telemetry;
    // Caller plugins are set up before the built-ins, so this start hook runs before the session
    // plugin's, which records session_start.
    telemetry.plugin({
      name: 'caller-start',
      setup: (ctx) =>
        ctx.addHook('start', () => {
          order.push('caller start hook');
          throw hookError;
        }),
    });

    let thrown: unknown;
    try {
      telemetry.start();
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBe(hookError);
    expect(order).toEqual(['caller start hook', 'session_start']);
    expect(window.history.pushState).toBe(originalPushState);
    expect(window.history.replaceState).toBe(originalReplaceState);

    // Destroyed: a later record reaches no connector and a restart is refused as destroyed.
    telemetry.logEvent('after-destroy');
    telemetry.start();
    expect(order).toEqual(['caller start hook', 'session_start']);
    expect(consoleError).toHaveBeenCalledWith(
      'Telemetry has been destroyed; build a new client instead of restarting.',
    );
  });

  it('destroy on a never-started client calls no connector', () => {
    const calls: Call[] = [];
    const telemetry = connected(calls);

    telemetry.destroy();

    expect(calls).toEqual([]);
  });

  it('nothing reaches connectors after destroy', () => {
    const calls: Call[] = [];
    const telemetry = connected(calls);
    telemetry.start();
    telemetry.destroy();
    calls.length = 0;

    telemetry.logEvent('late');
    telemetry.destroy();
    setVisibility('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('pagehide'));

    expect(calls).toEqual([]);
  });

  it('getRecords() returns the recorded event under development and [] under production', () => {
    const telemetry = connected([]);
    onTestFinished(() => telemetry.destroy());
    telemetry.start();
    telemetry.logEvent('listed');

    const names = telemetry.getRecords().map((r) => r.name);
    if (buildKind === 'development') {
      expect(names).toContain('listed');
    } else {
      expect(telemetry.getRecords()).toEqual([]);
    }
  });
});

describe.each<BuildKind>(['production', 'development'])('gate copy (%s)', (buildKind) => {
  beforeEach(() => {
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'groupEnd').mockImplementation(() => {});
  });

  // Data holding a function cannot be copied, so a copy attempt would log a copy failure.
  const uncopyable = { fn: () => 1 } as never;

  it.each<[string, TelemetryConnector[]]>([
    ['no connector', []],
    ['a connector with only onFlush', [{ onFlush: () => {} }]],
  ])('with %s, a record is not copied and no copy failure is logged', (_label, connectors) => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const telemetry = createTelemetryWithBuildKind(
      { ...baseConfig, verbose: true, collector: true, url: 'https://collector.test/e', connectors },
      buildKind,
    );
    onTestFinished(() => telemetry.destroy());
    telemetry.start();
    const clone = vi.spyOn(globalThis, 'structuredClone');

    telemetry.logEvent('uncopyable', uncopyable);
    telemetry.logEvent('plain', { a: 1 });

    expect(clone).not.toHaveBeenCalled();
    expect(consoleError).not.toHaveBeenCalledWith(
      expect.stringContaining('copy failed'),
      expect.anything(),
    );
  });

  it('with an onRecord connector, a record is still copied', () => {
    const received: unknown[] = [];
    const telemetry = createTelemetryWithBuildKind(
      { ...baseConfig, connectors: [{ onRecord: (record) => void received.push(record) }] },
      buildKind,
    );
    onTestFinished(() => telemetry.destroy());
    telemetry.start();
    const clone = vi.spyOn(globalThis, 'structuredClone');

    telemetry.logEvent('copied', { a: 1 });

    expect(clone).toHaveBeenCalledTimes(1);
    expect(received.map((r) => (r as { name: string }).name)).toContain('copied');
  });
});
