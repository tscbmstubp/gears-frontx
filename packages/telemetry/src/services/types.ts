import type {
  CatalogData,
  CatalogName,
  IsUnion,
  TelemetryCatalogError,
  TelemetryNoCatalog,
} from '../catalog/types';
import type { TelemetryLogEventParams, TelemetryRecord, TelemetryUserId } from '../utils/eventTypes';
import type { TelemetryPluginOption } from '../utils/types';

export type TelemetryService<C extends object = TelemetryNoCatalog> = {
  plugin: (...newPlugins: TelemetryPluginOption[]) => TelemetryService<C>;
  start: () => TelemetryService<C>;
  destroy: () => void;
  logEvent: TelemetryLogEvent;
  /**
   * Records an event the client's catalog declares, with its declared data. Returns nothing and
   * never throws. A client created without a catalog accepts no name here; use `logEvent`.
   */
  record: TelemetryRecordEvent<C>;
  acceptsReports: () => boolean;
  identify: (id: TelemetryUserId) => TelemetryService<C>;
  /**
   * The records the development build's inspector kept for this client, oldest first (at most
   * 1000). Always `[]` in the production build.
   */
  getRecords: () => TelemetryRecord[];
};

export type TelemetryLogEvent = (...args: TelemetryLogEventParams) => void;

/** The typed record call: only a declared name, only with the data declared for it. */
// @cpt-algo:cpt-frontx-telemetry-algo-declared-events-typed-call-check:p1
// @cpt-begin:cpt-frontx-telemetry-flow-declared-events-shell-events:p1:inst-check-typed-call
// @cpt-begin:cpt-frontx-telemetry-flow-declared-events-shell-events:p1:inst-check-typed-call-fails
// @cpt-begin:cpt-frontx-telemetry-flow-declared-events-shell-events:p1:inst-refuse-typed-call
export type TelemetryRecordEvent<C extends object> =
  // @cpt-begin:cpt-frontx-telemetry-algo-declared-events-typed-call-check:p1:inst-check-call-without-catalog
  [CatalogName<C>] extends [never]
    ? // @cpt-begin:cpt-frontx-telemetry-algo-declared-events-typed-call-check:p1:inst-refuse-without-catalog
      (name: never, data: never) => undefined
    : // @cpt-end:cpt-frontx-telemetry-algo-declared-events-typed-call-check:p1:inst-refuse-without-catalog
      // @cpt-end:cpt-frontx-telemetry-algo-declared-events-typed-call-check:p1:inst-check-call-without-catalog
      // @cpt-begin:cpt-frontx-telemetry-algo-declared-events-typed-call-check:p1:inst-accept-call
      <
        // @cpt-begin:cpt-frontx-telemetry-algo-declared-events-typed-call-check:p1:inst-check-declared-name
        // @cpt-begin:cpt-frontx-telemetry-algo-declared-events-typed-call-check:p1:inst-refuse-undeclared-name
        N extends CatalogName<C>,
        // @cpt-end:cpt-frontx-telemetry-algo-declared-events-typed-call-check:p1:inst-refuse-undeclared-name
        // @cpt-end:cpt-frontx-telemetry-algo-declared-events-typed-call-check:p1:inst-check-declared-name
      >(
        name: N,
        // A name typed as a choice of names would accept any one of their data shapes.
        // @cpt-begin:cpt-frontx-telemetry-algo-declared-events-typed-call-check:p1:inst-check-single-name
        data: IsUnion<N> extends true
          ? // @cpt-begin:cpt-frontx-telemetry-algo-declared-events-typed-call-check:p1:inst-refuse-union-name
            TelemetryCatalogError<'record() needs one literal event name'>
          : // @cpt-end:cpt-frontx-telemetry-algo-declared-events-typed-call-check:p1:inst-refuse-union-name
            // @cpt-end:cpt-frontx-telemetry-algo-declared-events-typed-call-check:p1:inst-check-single-name
            // @cpt-begin:cpt-frontx-telemetry-algo-declared-events-typed-call-check:p1:inst-check-data-shape
            // @cpt-begin:cpt-frontx-telemetry-algo-declared-events-typed-call-check:p1:inst-refuse-wrong-shape
            CatalogData<C, N>,
        // @cpt-end:cpt-frontx-telemetry-algo-declared-events-typed-call-check:p1:inst-refuse-wrong-shape
        // @cpt-end:cpt-frontx-telemetry-algo-declared-events-typed-call-check:p1:inst-check-data-shape
      ) => undefined;
// @cpt-end:cpt-frontx-telemetry-algo-declared-events-typed-call-check:p1:inst-accept-call
// @cpt-end:cpt-frontx-telemetry-flow-declared-events-shell-events:p1:inst-refuse-typed-call
// @cpt-end:cpt-frontx-telemetry-flow-declared-events-shell-events:p1:inst-check-typed-call-fails
// @cpt-end:cpt-frontx-telemetry-flow-declared-events-shell-events:p1:inst-check-typed-call
