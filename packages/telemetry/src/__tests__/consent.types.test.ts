import { describe, expect, it } from 'vitest';
import { createTelemetry } from '../index';
import type { TelemetryConfig, TelemetryConnector, TelemetryConsentOptions, TelemetryConsentState } from '../index';

const base = { appName: 'app', appVersion: '1' };

// Positive cases: compile, and run harmlessly.
function positives() {
  const none: TelemetryConfig = { ...base };
  const both: TelemetryConfig = { ...base, consent: { unsetCountsAsGranted: true, holdWhileUnknown: false } };
  const empty: TelemetryConfig = { ...base, consent: {} };
  const options: TelemetryConsentOptions = { unsetCountsAsGranted: false };
  const connector: TelemetryConnector = {
    onConsentChange: (state: TelemetryConsentState) => {
      const known: 'unknown' | 'granted' | 'denied' = state;
      return void known;
    },
  };
  return [none, both, empty, options, connector, createTelemetry({ ...base, consent: { holdWhileUnknown: true } })];
}

// Negative cases: each line must fail to compile.
function negatives() {
  // @ts-expect-error 'yes' is not a consent state
  const bad: TelemetryConsentState = 'yes';
  // @ts-expect-error the consent option's flags are booleans, not strings
  const wrong: TelemetryConfig = { ...base, consent: { unsetCountsAsGranted: 'yes' } };
  const connector: TelemetryConnector = {
    // @ts-expect-error a state handler cannot take a number
    onConsentChange: (state: number) => void state,
  };
  return [bad, wrong, connector];
}

describe('consent types', () => {
  it('compiles the positive and negative cases', () => {
    expect(typeof positives).toBe('function');
    expect(typeof negatives).toBe('function');
  });
});
