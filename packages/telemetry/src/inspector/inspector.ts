import type { BuildKind } from '../build/kind';
import type { TelemetryRecord } from '../utils/eventTypes';

// @cpt-dod:cpt-frontx-telemetry-dod-connector-delivery-dev-inspector:p1

/** The enriched record the inspector shows and lists. */
export type InspectorRecord = TelemetryRecord;

export interface Inspector {
  show(record: InspectorRecord): void;
  getRecords(): InspectorRecord[];
  notice(message: string): void;
}

export const INSPECTOR_RECORD_LIMIT = 1000;
const PREFIX = '[telemetry:dev]';

const emptyInspector: Inspector = {
  show: () => undefined,
  getRecords: () => [],
  notice: () => undefined,
};

function createConsoleInspector(): Inspector {
  const records: InspectorRecord[] = [];
  return {
    show(record) {
      // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-dev-inspector:p1:inst-show-grouped-record
      console.groupCollapsed(`${PREFIX} ${record.name}`);
      console.log(record);
      console.groupEnd();
      // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-dev-inspector:p1:inst-show-grouped-record
      // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-dev-inspector:p1:inst-keep-record
      records.push(record);
      // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-dev-inspector:p1:inst-keep-record
      // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-dev-inspector:p1:inst-check-list-bound
      if (records.length > INSPECTOR_RECORD_LIMIT) {
        // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-dev-inspector:p1:inst-drop-oldest-record
        records.shift();
        // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-dev-inspector:p1:inst-drop-oldest-record
      }
      // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-dev-inspector:p1:inst-check-list-bound
    },
    getRecords() {
      // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-dev-inspector:p1:inst-return-record-list
      return [...records];
      // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-dev-inspector:p1:inst-return-record-list
    },
    notice(message) {
      // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-dev-inspector:p1:inst-show-notice
      console.info(`${PREFIX} ${message}`);
      // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-dev-inspector:p1:inst-show-notice
    },
  };
}

// @cpt-algo:cpt-frontx-telemetry-algo-connector-delivery-dev-inspector:p1
export function createInspector(kind: BuildKind): Inspector {
  // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-dev-inspector:p1:inst-check-production-build
  if (kind === 'production') {
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-dev-inspector:p1:inst-return-empty-list
    return emptyInspector;
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-dev-inspector:p1:inst-return-empty-list
  }
  // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-dev-inspector:p1:inst-check-production-build
  return createConsoleInspector();
}
