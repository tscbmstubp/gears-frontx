import { describe, expect, test } from 'vitest';
import type { BuildKind } from '../build/kind';
import type { TelemetryConnector } from '../connectors/types';
import { deriveTelemetryState } from '../services/state';
import { createTelemetryWithBuildKind } from '../services/telemetry';

const connector: TelemetryConnector = {};
const base = { appName: 'app', appVersion: '1.0.0' };

describe.each<BuildKind>(['production', 'development'])('telemetry state (%s build)', (kind) => {
  const dev = kind === 'development';

  describe('deriveTelemetryState', () => {
    const derive = (
      connectors: readonly TelemetryConnector[] | undefined,
      collector: boolean | undefined,
      deliveryEnabled = true,
    ) => deriveTelemetryState({ connectors, collector, deliveryEnabled, buildKind: kind });

    test('no connector, collector unset: collector defaults on, delivery on -> WITH_CONNECTOR', () => {
      expect(derive(undefined, undefined)).toEqual({
        state: 'WITH_CONNECTOR',
        collector: true,
        collectorBesideConnectors: false,
        acceptsReports: true,
      });
    });

    test('an empty list counts as no connector', () => {
      expect(derive([], undefined).collector).toBe(true);
    });

    test('no connector, collector off -> WITHOUT_CONNECTOR', () => {
      const result = derive(undefined, false);
      expect(result.state).toBe('WITHOUT_CONNECTOR');
      expect(result.collector).toBe(false);
      expect(result.acceptsReports).toBe(dev);
    });

    test('no connector, collector on, delivery off -> DELIVERY_SUPPRESSED', () => {
      const result = derive(undefined, undefined, false);
      expect(result.state).toBe('DELIVERY_SUPPRESSED');
      expect(result.acceptsReports).toBe(true);
    });

    test('collector explicitly on with delivery off and no connector -> DELIVERY_SUPPRESSED', () => {
      expect(derive(undefined, true, false).state).toBe('DELIVERY_SUPPRESSED');
    });

    test('connector, collector unset: collector defaults off', () => {
      const result = derive([connector], undefined);
      expect(result).toEqual({
        state: 'WITH_CONNECTOR',
        collector: false,
        collectorBesideConnectors: false,
        acceptsReports: true,
      });
    });

    test('connector with delivery off stays WITH_CONNECTOR', () => {
      expect(derive([connector], undefined, false).state).toBe('WITH_CONNECTOR');
    });

    test('connector, collector on -> beside-connectors flag', () => {
      const result = derive([connector], true);
      expect(result.state).toBe('WITH_CONNECTOR');
      expect(result.collector).toBe(true);
      expect(result.collectorBesideConnectors).toBe(true);
    });

    test('connector, collector off -> no flag', () => {
      expect(derive([connector], false).collectorBesideConnectors).toBe(false);
    });
  });

  describe('acceptsReports()', () => {
    const build = (config: Record<string, unknown>) =>
      createTelemetryWithBuildKind({ ...base, ...config }, kind);

    test.each([
      ['a connector', { connectors: [connector] }, true],
      ['suppression mode', { enabled: false }, true],
      ['no connector, collector off', { collector: false }, dev],
      ['default shipped client', {}, true],
    ])('%s', (_name, config, expected) => {
      expect(build(config).acceptsReports()).toBe(expected);
    });

    test('same value after start and destroy', () => {
      const client = build({ collector: false, autocapture: false, navigationCapture: false });
      const before = client.acceptsReports();
      client.start();
      expect(client.acceptsReports()).toBe(before);
      client.destroy();
      expect(client.acceptsReports()).toBe(before);
    });

    test('a client built with window undefined still has a value', () => {
      const original = globalThis.window;
      Reflect.deleteProperty(globalThis, 'window');
      try {
        expect(build({ collector: false }).acceptsReports()).toBe(dev);
      } finally {
        globalThis.window = original;
      }
    });
  });
});
