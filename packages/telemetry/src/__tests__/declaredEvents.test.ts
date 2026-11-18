import { afterEach, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest';
import type { BuildKind } from '../build/kind';
import type { TelemetryConnector } from '../connectors/types';
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

function capturing(records: TelemetryRecord[]): TelemetryConnector {
  return { onRecord: (record) => void records.push(record) };
}

function postedBodies(): string[] {
  return fetchMock.mock.calls.map(([, init]) => String((init as RequestInit | undefined)?.body));
}

function quietConsole() {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'groupCollapsed').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'groupEnd').mockImplementation(() => {});
}

describe.each<BuildKind>(['production', 'development'])('typed record (%s build)', (buildKind) => {
  function client(records: TelemetryRecord[], collector?: boolean) {
    const telemetry = createTelemetryWithBuildKind<ShellCatalog>(
      {
        appName: 'app',
        appVersion: '1',
        autocapture: false,
        navigationCapture: false,
        url: 'https://collector.test/events',
        namespace: 'shell',
        connectors: [capturing(records)],
        collector,
      },
      buildKind,
    );
    return telemetry;
  }

  it('returns undefined, not a promise', () => {
    quietConsole();
    const records: TelemetryRecord[] = [];
    const telemetry = client(records).start();
    onTestFinished(() => telemetry.destroy());

    const result: unknown = telemetry.record('shell.menu_opened', { menu: 'main' });

    expect(result).toBeUndefined();
  });

  it('its record carries an SDK-assigned id and time_triggered', () => {
    quietConsole();
    const records: TelemetryRecord[] = [];
    const telemetry = client(records).start();
    onTestFinished(() => telemetry.destroy());

    telemetry.record('shell.menu_opened', { menu: 'main' });

    const record = records.find((r) => r.name === 'shell.menu_opened');
    expect(record).toBeDefined();
    expect(typeof record?.id).toBe('string');
    expect(record?.id).not.toBe('');
    expect(typeof record?.time_triggered).toBe('number');
    expect(record?.data).toEqual({ menu: 'main' });
  });

  it('a throwing event hook does not stop the record reaching the queue and the connector', () => {
    quietConsole();
    const records: TelemetryRecord[] = [];
    const telemetry = client(records, true);
    telemetry.plugin({
      name: 'bad-hook',
      setup: (ctx) =>
        ctx.addHook('event', (record) => {
          // Only the typed record's enrichment throws; the shipped session_start keeps working.
          if (record.name === 'shell.menu_opened') throw new Error('hook failure');
        }),
    });
    telemetry.start();

    expect(() => telemetry.record('shell.menu_opened', { menu: 'main' })).not.toThrow();
    expect(records.map((r) => r.name)).toContain('shell.menu_opened');

    telemetry.destroy();
    expect(postedBodies().some((body) => body.includes('shell.menu_opened'))).toBe(true);
  });

  it('drops silently after destroy', () => {
    quietConsole();
    const records: TelemetryRecord[] = [];
    const telemetry = client(records).start();
    telemetry.destroy();
    records.length = 0;

    expect(() => telemetry.record('shell.menu_opened', { menu: 'main' })).not.toThrow();
    expect(telemetry.record('shell.menu_opened', { menu: 'main' })).toBeUndefined();
    expect(records).toEqual([]);
  });
});
