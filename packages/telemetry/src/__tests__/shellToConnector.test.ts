// Verifies cpt-frontx-telemetry-dod-connector-delivery-shell-to-connector
import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { TelemetryConnector } from '../index';
import { createTelemetryWithBuildKind } from '../services/telemetry';
import type { TelemetryRecord } from '../utils/eventTypes';

type ShellCatalog = {
  'shell.menu_opened': { menu: string };
};

const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({}) });

beforeEach(() => {
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function quietConsole() {
  return {
    info: vi.spyOn(console, 'info').mockImplementation(() => {}),
    warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
    error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    log: vi.spyOn(console, 'log').mockImplementation(() => {}),
    group: vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {}),
    groupEnd: vi.spyOn(console, 'groupEnd').mockImplementation(() => {}),
  };
}

function throwingConnector(): TelemetryConnector {
  const fail = () => {
    throw new Error('connector failure');
  };
  return {
    onRecord: fail,
    onMeasurement: fail,
    onIdentityChange: fail,
    onConsentChange: fail,
    onFlush: fail,
    onShutdown: fail,
  };
}

describe('a shell event reaches a connector', () => {
  it('a declared shell event reaches the test connector beside one that always throws', () => {
    quietConsole();
    const received: TelemetryRecord[] = [];
    const telemetry = createTelemetryWithBuildKind<ShellCatalog>(
      {
        appName: 'shell',
        appVersion: '1',
        autocapture: false,
        navigationCapture: false,
        consent: { unsetCountsAsGranted: true },
        url: 'https://collector.test/events',
        namespace: 'shell',
        connectors: [{ onRecord: (record) => void received.push(record) }, throwingConnector()],
      },
      'production',
    ).start();

    expect(() => {
      telemetry.identify('user-1');
      telemetry.record('shell.menu_opened', { menu: 'main' });
      telemetry.destroy();
    }).not.toThrow();

    const record = received.find((r) => r.name === 'shell.menu_opened');
    expect(record?.data).toEqual({ menu: 'main' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('no application connector and the collector off: no request is made', async () => {
    quietConsole();
    const telemetry = createTelemetryWithBuildKind<ShellCatalog>(
      {
        appName: 'shell',
        appVersion: '1',
        autocapture: false,
        navigationCapture: false,
        consent: { unsetCountsAsGranted: true },
        url: 'https://collector.test/events',
        namespace: 'shell',
        collector: false,
      },
      'production',
    ).start();
    onTestFinished(() => telemetry.destroy());

    telemetry.record('shell.menu_opened', { menu: 'main' });
    telemetry.logEvent('shipped_event');
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('development build, same setup: the no-connector notice is shown and nothing is sent', async () => {
    const consoleSpies = quietConsole();
    const telemetry = createTelemetryWithBuildKind<ShellCatalog>(
      {
        appName: 'shell',
        appVersion: '1',
        autocapture: false,
        navigationCapture: false,
        consent: { unsetCountsAsGranted: true },
        url: 'https://collector.test/events',
        namespace: 'shell',
        collector: false,
      },
      'development',
    ).start();
    onTestFinished(() => telemetry.destroy());

    telemetry.record('shell.menu_opened', { menu: 'main' });
    await new Promise((resolve) => setTimeout(resolve, 0));

    const printed = Object.values(consoleSpies)
      .flatMap((spy) => spy.mock.calls)
      .map((args) => args.map(String).join(' '));
    expect(printed.some((line) => line.includes('No connector is configured'))).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
