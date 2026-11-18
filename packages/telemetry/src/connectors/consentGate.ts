// @cpt-dod:cpt-frontx-telemetry-dod-connector-delivery-gate-pass-through:p1

// Consent gate, pass-through stage. The consent feature replaces step `inst-pass-at-once`
// (the immediate hand-off to record dispatch) with its consent rules. The two are released
// together, so connectors never receive records without a consent check.
import type { TelemetryRecord } from '../utils/eventTypes';
import type { TelemetryLoggerService } from '../utils/logger';
import type { TelemetryConnector } from './types';

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Reflect.ownKeys(value)) {
      deepFreeze((value as Record<PropertyKey, unknown>)[key]);
    }
  }
  return value;
}

// The client's gate stage. Connectors are fixed at construction, so whether any of them has a
// record handler is worked out once here rather than for every record.
export function createGateStage(
  connectors: readonly TelemetryConnector[],
  dispatchRecord: (frozen: Readonly<TelemetryRecord>) => void,
  logger: Pick<TelemetryLoggerService, 'logError'>,
): (record: TelemetryRecord) => void {
  const hasRecordHandler = connectors.some((connector) => !!connector.onRecord);
  return (record) => passThroughRecord(record, dispatchRecord, logger, hasRecordHandler);
}

// @cpt-algo:cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through:p1
export function passThroughRecord<T extends object>(
  data: T,
  dispatchRecord: (frozen: Readonly<T>) => void,
  logger: Pick<TelemetryLoggerService, 'logError'>,
  hasRecordHandler = true,
): void {
  // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through:p1:inst-skip-without-record-handlers
  if (!hasRecordHandler) {
    return;
  }
  // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through:p1:inst-skip-without-record-handlers
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
