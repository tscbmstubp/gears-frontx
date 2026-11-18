// @cpt-dod:cpt-frontx-telemetry-dod-connector-delivery-gate-pass-through:p1

// Consent gate, pass-through stage. The consent feature replaces step `inst-pass-at-once`
// (the immediate hand-off to record dispatch) with its consent rules. The two are released
// together, so connectors never receive records without a consent check.
import type { TelemetryLoggerService } from '../utils/logger';

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Reflect.ownKeys(value)) {
      deepFreeze((value as Record<PropertyKey, unknown>)[key]);
    }
  }
  return value;
}

// @cpt-algo:cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through:p1
export function passThroughRecord<T extends object>(
  data: T,
  dispatchRecord: (frozen: Readonly<T>) => void,
  logger: Pick<TelemetryLoggerService, 'logError'>,
): void {
  let frozen: Readonly<T>;
  // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through:p1:inst-deep-copy
  try {
    const copy = structuredClone(data);
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through:p1:inst-deep-copy
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through:p1:inst-deep-freeze
    frozen = deepFreeze(copy);
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through:p1:inst-deep-freeze
  } catch (error) {
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through:p1:inst-catch-copy-failure
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through:p1:inst-report-copy-failure
    logger.logError('Telemetry: record dropped before connectors, copy failed', error);
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through:p1:inst-report-copy-failure
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through:p1:inst-return-copy-failed
    return;
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through:p1:inst-return-copy-failed
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through:p1:inst-catch-copy-failure
  }
  // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through:p1:inst-pass-at-once
  dispatchRecord(frozen);
  // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through:p1:inst-pass-at-once
  // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through:p1:inst-return-passed
  return;
  // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through:p1:inst-return-passed
}
