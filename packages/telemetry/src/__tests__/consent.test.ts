// Verifies the consent gate wired into the client: cpt-frontx-telemetry-flow-consent-gate-set-consent,
// cpt-frontx-telemetry-flow-consent-gate-identify-reset, cpt-frontx-telemetry-flow-consent-gate-connector-reads,
// cpt-frontx-telemetry-algo-consent-gate-start-pass, cpt-frontx-telemetry-algo-consent-gate-destroy-drop
import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { BuildKind } from '../build/kind';
import { createConsentGate, type IdentityDeps } from '../connectors/consentGate';
import type { TelemetryConnector, TelemetryConsentState } from '../connectors/types';
import { createTelemetryWithBuildKind } from '../services/telemetry';
import type { TelemetryRecord } from '../utils/eventTypes';
import type { TelemetryConfig } from '../utils/types';

const baseConfig: TelemetryConfig = {
  appName: 'app',
  appVersion: '1',
  autocapture: false,
  navigationCapture: false,
};

type Call = { handler: string; value?: unknown };

function recordingConnector(calls: Call[], overrides: Partial<TelemetryConnector> = {}): TelemetryConnector {
  return {
    onRecord: (record) => {
      calls.push({ handler: 'onRecord', value: record });
    },
    onConsentChange: (state) => {
      calls.push({ handler: 'onConsentChange', value: state });
    },
    onIdentityChange: (id) => {
      calls.push({ handler: 'onIdentityChange', value: id });
    },
    ...overrides,
  };
}

// The calls an application-made record or a signal produced, leaving out records start itself makes.
function visible(calls: Call[], names: string[]) {
  return calls
    .filter((c) => c.handler !== 'onRecord' || names.includes((c.value as TelemetryRecord).name))
    .map((c) =>
      c.handler === 'onRecord'
        ? { handler: 'onRecord', value: (c.value as TelemetryRecord).name }
        : c,
    );
}

const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'groupEnd').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe.each<BuildKind>(['production', 'development'])('consent through the client (%s)', (buildKind) => {
  function client(calls: Call[], extra: Partial<TelemetryConfig> = {}, connector?: TelemetryConnector) {
    return createTelemetryWithBuildKind(
      { ...baseConfig, connectors: [connector ?? recordingConnector(calls)], ...extra },
      buildKind,
    );
  }

  it('no record and no identity reach a connector before a grant', () => {
    const calls: Call[] = [];
    const telemetry = client(calls);
    telemetry.start();
    telemetry.identify('user-1');
    telemetry.logEvent('before');

    expect(calls.filter((c) => c.handler !== 'onConsentChange')).toEqual([]);
    expect(calls).toEqual([{ handler: 'onConsentChange', value: 'unknown' }]);
    telemetry.destroy();
  });

  it('a grant passes the consent change, the held identity, then the held records in order', () => {
    const calls: Call[] = [];
    const telemetry = client(calls);
    telemetry.start();
    telemetry.identify('user-1');
    telemetry.logEvent('one');
    telemetry.logEvent('two');
    calls.length = 0;

    telemetry.setConsent('granted');
    telemetry.logEvent('three');

    expect(visible(calls, ['one', 'two', 'three'])).toEqual([
      { handler: 'onConsentChange', value: 'granted' },
      { handler: 'onIdentityChange', value: 'user-1' },
      { handler: 'onRecord', value: 'one' },
      { handler: 'onRecord', value: 'two' },
      { handler: 'onRecord', value: 'three' },
    ]);
    telemetry.destroy();
  });

  it('the hold keeps the newest 1000 records: after 1005 while unknown, a grant releases the last 1000 in order', () => {
    const calls: Call[] = [];
    const telemetry = client(calls);
    telemetry.start();
    const names = Array.from({ length: 1005 }, (_, i) => `e${i}`);
    for (const name of names) {
      telemetry.logEvent(name);
    }
    calls.length = 0;

    telemetry.setConsent('granted');

    const released = visible(calls, names)
      .filter((c) => c.handler === 'onRecord')
      .map((c) => c.value);
    expect(released).toEqual(names.slice(5));
    telemetry.destroy();
  });

  it('with unsetCountsAsGranted records and identity arrive at once, also when identify ran before start', () => {
    const calls: Call[] = [];
    const telemetry = client(calls, { consent: { unsetCountsAsGranted: true } });
    telemetry.identify('early');
    telemetry.start();
    telemetry.logEvent('now');
    telemetry.identify('later');

    expect(visible(calls, ['now'])).toEqual([
      { handler: 'onConsentChange', value: 'granted' },
      { handler: 'onIdentityChange', value: 'early' },
      { handler: 'onRecord', value: 'now' },
      { handler: 'onIdentityChange', value: 'later' },
    ]);
    telemetry.destroy();
  });

  it('an app with only the collector and no consent option delivers as before', () => {
    vi.useFakeTimers();
    try {
      const telemetry = createTelemetryWithBuildKind(
        { ...baseConfig, url: 'https://collector.test/e' },
        buildKind,
      );
      telemetry.start();
      telemetry.logEvent('collected');
      telemetry.destroy();
      expect(fetchMock).toHaveBeenCalled();
      expect(String(fetchMock.mock.calls.at(-1)?.[1]?.body)).toContain('collected');
    } finally {
      vi.useRealTimers();
    }
  });

  it('with a connector and the collector on, consent unknown: the collector gets every record, the connector none', () => {
    vi.useFakeTimers();
    try {
      const calls: Call[] = [];
      const telemetry = client(calls, { url: 'https://collector.test/e', collector: true });
      telemetry.start();
      telemetry.logEvent('collected');
      telemetry.destroy();
      expect(fetchMock.mock.calls.some((c) => String(c[1]?.body).includes('collected'))).toBe(true);
      expect(visible(calls, ['collected']).filter((c) => c.handler !== 'onConsentChange')).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('holding off: a grant passes the consent change and the held identity, none of the earlier records', () => {
    const calls: Call[] = [];
    const telemetry = client(calls, { consent: { holdWhileUnknown: false } });
    telemetry.start();
    telemetry.identify('user-1');
    telemetry.logEvent('dropped');
    calls.length = 0;

    telemetry.setConsent('granted');

    expect(visible(calls, ['dropped'])).toEqual([
      { handler: 'onConsentChange', value: 'granted' },
      { handler: 'onIdentityChange', value: 'user-1' },
    ]);
    telemetry.destroy();
  });

  it('the start pass runs once', () => {
    const calls: Call[] = [];
    const telemetry = client(calls);
    telemetry.start();
    telemetry.start();
    expect(calls.filter((c) => c.handler === 'onConsentChange')).toEqual([
      { handler: 'onConsentChange', value: 'unknown' },
    ]);
    telemetry.destroy();
  });

  it('a connector that destroys the client from onConsentChange leaves no listener and gets no identity', () => {
    const calls: Call[] = [];
    const docAdd = vi.spyOn(document, 'addEventListener');
    const winAdd = vi.spyOn(window, 'addEventListener');
    const ref: { client?: ReturnType<typeof client> } = {};
    const connector = recordingConnector(calls, {
      onConsentChange: (state) => {
        calls.push({ handler: 'onConsentChange', value: state });
        ref.client?.destroy();
      },
    });
    const telemetry = client(calls, { consent: { unsetCountsAsGranted: true } }, connector);
    ref.client = telemetry;
    telemetry.identify('user-1');
    telemetry.start();

    expect(docAdd.mock.calls.some(([type]) => type === 'visibilitychange')).toBe(false);
    expect(winAdd.mock.calls.some(([type]) => type === 'pagehide')).toBe(false);
    expect(calls.some((c) => c.handler === 'onIdentityChange')).toBe(false);
  });

  it('onShutdown calling setConsent("granted") with records held releases nothing', () => {
    const calls: Call[] = [];
    const ref: { client?: ReturnType<typeof client> } = {};
    const connector = recordingConnector(calls, {
      onShutdown: () => {
        ref.client?.setConsent('granted');
      },
      onFlush: () => {
        ref.client?.setConsent('granted');
      },
    });
    const telemetry = client(calls, {}, connector);
    ref.client = telemetry;
    telemetry.start();
    telemetry.identify('user-1');
    telemetry.logEvent('held');
    calls.length = 0;

    telemetry.destroy();

    expect(calls).toEqual([]);
  });

  it('an identity kept before start does not survive a denial: identify, deny, grant, start', () => {
    const calls: Call[] = [];
    const telemetry = client(calls);
    telemetry.identify('A');
    telemetry.setConsent('denied');
    telemetry.setConsent('granted');
    telemetry.start();

    expect(calls.filter((c) => c.handler === 'onIdentityChange')).toEqual([]);
    telemetry.destroy();
  });

  it('an identity set while denied before start is dropped: deny, identify, grant, start', () => {
    const calls: Call[] = [];
    const telemetry = client(calls);
    telemetry.setConsent('denied');
    telemetry.identify('A');
    telemetry.setConsent('granted');
    telemetry.start();

    expect(calls.filter((c) => c.handler === 'onIdentityChange')).toEqual([]);
    telemetry.destroy();
  });

  it('identify before start is still kept under unknown and passed after a grant', () => {
    const calls: Call[] = [];
    const telemetry = client(calls);
    telemetry.identify('A');
    telemetry.start();
    telemetry.setConsent('granted');

    expect(calls.filter((c) => c.handler === 'onIdentityChange')).toEqual([
      { handler: 'onIdentityChange', value: 'A' },
    ]);
    telemetry.destroy();
  });

  it('a record logged by a destroy hook reaches connectors before onFlush when consent is granted', () => {
    const calls: Call[] = [];
    const telemetry = client(calls, {}, recordingConnector(calls, {
      onFlush: () => {
        calls.push({ handler: 'onFlush' });
      },
    }));
    telemetry.plugin({
      name: 'parting',
      setup: (ctx) => ctx.addHook('destroy', () => telemetry.logEvent('parting_event')),
    });
    telemetry.setConsent('granted');
    telemetry.start();
    calls.length = 0;
    telemetry.destroy();

    const names = calls.map((c) =>
      c.handler === 'onRecord' ? `record:${(c.value as TelemetryRecord).name}` : c.handler,
    );
    expect(names).toContain('record:parting_event');
    expect(names.indexOf('record:parting_event')).toBeLessThan(names.indexOf('onFlush'));
  });

  it('a record logged by a destroy hook is not delivered when consent is unknown', () => {
    const calls: Call[] = [];
    const telemetry = client(calls);
    telemetry.plugin({
      name: 'parting',
      setup: (ctx) => ctx.addHook('destroy', () => telemetry.logEvent('parting_event')),
    });
    telemetry.start();
    telemetry.destroy();

    expect(calls.filter((c) => c.handler === 'onRecord')).toEqual([]);
  });

  it('identify, setConsent and resetIdentity after destroy reach no connector', () => {
    const calls: Call[] = [];
    const telemetry = client(calls, { consent: { unsetCountsAsGranted: true } });
    telemetry.start();
    telemetry.destroy();
    calls.length = 0;

    expect(telemetry.identify('late')).toBe(telemetry);
    telemetry.resetIdentity();
    telemetry.setConsent('denied');

    expect(calls).toEqual([]);
  });

  it('the three methods never throw; invalid setConsent input is ignored and logged', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const calls: Call[] = [];
    const throwing: TelemetryConnector = {
      onConsentChange: () => {
        throw new Error('consent handler failure');
      },
      onIdentityChange: () => {
        throw new Error('identity handler failure');
      },
    };
    const telemetry = createTelemetryWithBuildKind(
      { ...baseConfig, verbose: true, connectors: [throwing, recordingConnector(calls)] },
      buildKind,
    );
    telemetry.start();
    calls.length = 0;

    expect(() => telemetry.setConsent('maybe' as TelemetryConsentState)).not.toThrow();
    expect(calls).toEqual([]);
    expect(errors).toHaveBeenCalled();
    expect(telemetry.setConsent('granted')).toBeUndefined();
    expect(telemetry.identify('user-1')).toBe(telemetry);
    expect(telemetry.resetIdentity()).toBeUndefined();
    expect(visible(calls, [])).toEqual([
      { handler: 'onConsentChange', value: 'granted' },
      { handler: 'onIdentityChange', value: 'user-1' },
      { handler: 'onIdentityChange', value: undefined },
    ]);
    telemetry.destroy();
    expect(() => {
      telemetry.setConsent('granted');
      telemetry.resetIdentity();
      telemetry.identify('x');
    }).not.toThrow();
  });
});

describe('connector types', () => {
  it('onConsentChange receives a TelemetryConsentState', () => {
    expectTypeOf<Parameters<NonNullable<TelemetryConnector['onConsentChange']>>[0]>().toEqualTypeOf<
      TelemetryConsentState
    >();
    expectTypeOf<ReturnType<ReturnType<typeof createTelemetryWithBuildKind>['setConsent']>>().toEqualTypeOf<void>();
    expectTypeOf<ReturnType<ReturnType<typeof createTelemetryWithBuildKind>['resetIdentity']>>().toEqualTypeOf<void>();
  });
});

describe('destroy drop (gate level)', () => {
  function deps(open: { value: boolean }, destroyed: { value: boolean }, calls: Call[]): IdentityDeps {
    return {
      dispatchRecord: (r) => calls.push({ handler: 'onRecord', value: r }),
      dispatchConsentChange: (s) => calls.push({ handler: 'onConsentChange', value: s }),
      dispatchIdentityChange: (id) => calls.push({ handler: 'onIdentityChange', value: id }),
      isDispatchOpen: () => open.value,
      isDestroyed: () => destroyed.value,
      logger: { logError: () => {} },
      userInfo: { identify: () => {}, clear: () => {} },
    };
  }

  it('nothing is held, kept or queued after the drop, and the gate is closed', () => {
    const calls: Call[] = [];
    const open = { value: false };
    const gate = createConsentGate({ inspector: { notice: () => {} } });
    const d = deps(open, { value: false }, calls);
    gate.identify('kept', d);
    open.value = true;
    gate.applyRules({ name: 'held' } as TelemetryRecord, d);
    gate.holdIdentity({ id: 'held' });
    gate.runBusy(() => {
      gate.setConsent('granted', d);
      gate.destroyDrop();
    });

    expect(gate.accessor.holdSize()).toBe(0);
    expect(gate.accessor.heldIdentity()).toBeUndefined();
    expect(gate.accessor.keptIdentity()).toBeUndefined();
    expect(gate.accessor.queueSize()).toBe(0);
    expect(gate.accessor.closed()).toBe(true);
    expect(calls).toEqual([]);
  });

  it('identify after the drop keeps nothing, and setConsent passes nothing', () => {
    const calls: Call[] = [];
    const gate = createConsentGate({ inspector: { notice: () => {} } });
    const d = deps({ value: false }, { value: false }, calls);
    gate.destroyDrop();
    gate.identify('late', d);
    gate.setConsent('granted', d);
    gate.startPass(d);

    expect(gate.accessor.keptIdentity()).toBeUndefined();
    expect(gate.accessor.heldIdentity()).toBeUndefined();
    expect(calls).toEqual([]);
  });

  it('the start pass holds a kept identity under unknown and drops it under denied', () => {
    const calls: Call[] = [];
    const open = { value: false };
    const unknownGate = createConsentGate({ inspector: { notice: () => {} } });
    const d = deps(open, { value: false }, calls);
    unknownGate.identify('u', d);
    open.value = true;
    unknownGate.startPass(d);
    expect(unknownGate.accessor.heldIdentity()).toEqual({ id: 'u' });
    expect(unknownGate.accessor.keptIdentity()).toBeUndefined();

    open.value = false;
    const deniedGate = createConsentGate({ inspector: { notice: () => {} } });
    deniedGate.setConsent('denied', d);
    deniedGate.identify('d', d);
    open.value = true;
    calls.length = 0;
    deniedGate.startPass(d);
    expect(deniedGate.accessor.heldIdentity()).toBeUndefined();
    expect(deniedGate.accessor.keptIdentity()).toBeUndefined();
    expect(calls).toEqual([{ handler: 'onConsentChange', value: 'denied' }]);
  });
});
