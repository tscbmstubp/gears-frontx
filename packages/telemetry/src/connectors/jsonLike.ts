// @cpt-dod:cpt-frontx-telemetry-dod-consent-gate-drop-before-copy:p1
// @cpt-dod:cpt-frontx-telemetry-dod-connector-delivery-gate-pass-through:p1

// The JSON-like copy of a record: a fresh copy of plain data, deeply frozen. The consent gate
// makes it only for a record it passes or holds.
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

// Sets one own property, also for a key such as "__proto__" that plain assignment would treat
// as the prototype.
export function setOwn(target: Record<string, unknown>, key: string, value: unknown): void {
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

// The copy step of the pass-through stage, run by the consent rules only for a record that is
// passed or held. Returns the deeply frozen copy, or undefined after logging a copy failure.
export function frozenCopy<T extends object>(
  data: T,
  logger: Pick<TelemetryLoggerService, 'logError'>,
): Readonly<T> | undefined {
  // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through:p1:inst-deep-copy
  try {
    const copy = toJsonLike(data, new Set()) as T;
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through:p1:inst-deep-copy
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through:p1:inst-deep-freeze
    return deepFreeze(copy);
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through:p1:inst-deep-freeze
  } catch (error) {
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through:p1:inst-catch-copy-failure
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through:p1:inst-report-copy-failure
    logger.logError('Telemetry: record dropped before connectors, copy failed', error);
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through:p1:inst-report-copy-failure
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through:p1:inst-return-copy-failed
    return undefined;
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through:p1:inst-return-copy-failed
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through:p1:inst-catch-copy-failure
  }
}
