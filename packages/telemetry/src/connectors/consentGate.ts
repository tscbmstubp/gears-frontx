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

// Sets one own property, also for a key such as "__proto__" that plain assignment would treat
// as the prototype.
function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

// Builds a fresh JSON-like copy of a value: only strings, finite numbers, booleans, null, arrays
// and plain objects. It follows JSON's rules except that no `toJSON` method is called, since that
// would run application code inside the gate. Data with no JSON form throws. `path` holds the
// objects being converted, so a cycle throws while the same object reached twice is copied twice.
function toJsonLike(value: unknown, path: Set<object>): unknown {
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return value;
    case 'undefined':
      return undefined;
    case 'number':
      // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through:p1:inst-copy-json-rules
      return Number.isFinite(value) ? value : null;
      // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through:p1:inst-copy-json-rules
    case 'object':
      break;
    default:
      throw new TypeError(`Telemetry: a ${typeof value} has no JSON form`);
  }
  if (value === null) {
    return null;
  }
  const source = value as object;
  // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through:p1:inst-copy-dates
  if (source instanceof Date) {
    return Number.isNaN(source.getTime()) ? null : source.toISOString();
  }
  // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through:p1:inst-copy-dates
  if (path.has(source)) {
    throw new TypeError('Telemetry: cyclic data has no JSON form');
  }
  path.add(source);
  try {
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through:p1:inst-copy-maps
    if (source instanceof Map) {
      const object: Record<string, unknown> = {};
      for (const [key, item] of source) {
        const converted = toJsonLike(item, path);
        const name = String(key);
        if (converted === undefined) {
          delete object[name];
        } else {
          setOwn(object, name, converted);
        }
      }
      return object;
    }
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through:p1:inst-copy-maps
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through:p1:inst-copy-sets-bytes
    let items: Iterable<unknown> | undefined;
    if (source instanceof Set) {
      items = source;
    } else if (source instanceof ArrayBuffer) {
      items = new Uint8Array(source);
    } else if (ArrayBuffer.isView(source)) {
      items =
        source instanceof DataView
          ? new Uint8Array(source.buffer, source.byteOffset, source.byteLength)
          : (source as unknown as Iterable<unknown>);
    } else if (Array.isArray(source)) {
      items = source;
    }
    if (items) {
      const list: unknown[] = [];
      for (const item of items) {
        list.push(toJsonLike(item, path) ?? null);
      }
      return list;
    }
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through:p1:inst-copy-sets-bytes
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through:p1:inst-copy-json-rules
    const object: Record<string, unknown> = {};
    for (const key of Object.keys(source)) {
      const converted = toJsonLike((source as Record<string, unknown>)[key], path);
      if (converted !== undefined) {
        setOwn(object, key, converted);
      }
    }
    return object;
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through:p1:inst-copy-json-rules
  } finally {
    path.delete(source);
  }
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
    const copy = toJsonLike(data, new Set()) as T;
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
