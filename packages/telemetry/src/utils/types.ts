import type { BuildKind } from '../build/kind';
import type {
  CatalogCheck,
  CatalogName,
  CatalogNamespace,
  TelemetryCatalogOk,
  TelemetryNoCatalog,
} from '../catalog/types';
import type { ConnectorDispatch } from '../connectors/dispatch';
import type { TelemetryConnector } from '../connectors/types';
import type { Inspector } from '../inspector/inspector';
import type { DerivedTelemetryState } from '../services/state';
import type { TelemetryLogEventParams, TelemetryRecord } from './eventTypes';
import type { HooksManager, TelemetryHooksService } from './hooks';
import type { TelemetryLoggerService } from './logger';

export type TelemetryConfigNormalized = {
  appName: string;
  appVersion: string;
  storagePrefix?: string;
  enabled: boolean;
  verbose: boolean;
  url: string;
  autocapture: boolean;
  navigationCapture: boolean;
  sessionDuration: number;
  apiVersion: number;
  connectors: readonly TelemetryConnector[];
  collector?: boolean;
};

/**
 * The `namespace` option. Its type comes from the catalog, since TypeScript cannot infer one type
 * argument while another is given explicitly: required and exactly the catalog's shared first
 * segment when a catalog is given, absent otherwise.
 */
// @cpt-begin:cpt-frontx-telemetry-flow-declared-events-shell-events:p1:inst-check-shell-catalog
export type TelemetryNamespaceOption<C extends object> = [CatalogName<C>] extends [never]
  ? { namespace?: never }
  : // @cpt-begin:cpt-frontx-telemetry-flow-declared-events-shell-events:p1:inst-check-shell-catalog-fails
    CatalogCheck<C, CatalogNamespace<C>> extends TelemetryCatalogOk
    ? { namespace: CatalogNamespace<C> }
    : // @cpt-begin:cpt-frontx-telemetry-flow-declared-events-shell-events:p1:inst-refuse-shell-catalog
      { namespace: CatalogCheck<C, CatalogNamespace<C>> };
// @cpt-end:cpt-frontx-telemetry-flow-declared-events-shell-events:p1:inst-refuse-shell-catalog
// @cpt-end:cpt-frontx-telemetry-flow-declared-events-shell-events:p1:inst-check-shell-catalog-fails
// @cpt-end:cpt-frontx-telemetry-flow-declared-events-shell-events:p1:inst-check-shell-catalog

/** The client's options; `C` is the event catalog, given explicitly to `createTelemetry`. */
export type TelemetryConfig<C extends object = TelemetryNoCatalog> = TelemetryConfigBase &
  TelemetryNamespaceOption<C>;

export type TelemetryConfigBase = {
  /**
   * Key prefix to store data in localStorage
   */
  storagePrefix?: string;
  /**
   * This name will be passed to `context_source_app_name` and used as a default value for `context_app_name` and `context_service_name`
   * Usually this is the name of the frontend application. i.e. "cloud"
   */
  appName: string;
  /**
   * Version of the app
   */
  appVersion: string;
  /**
   * Automatically send click, input, ... events from the page
   * @default true
   */
  autocapture?: boolean;
  /**
   * Send a `page_view` on every path change, and stamp later records with the page they happened on.
   * With it off the navigation plugin is not registered and `window.history` is left unwrapped.
   * @default true
   */
  navigationCapture?: boolean;
  /**
   * Enables or disables telemetry events
   */
  enabled?: boolean;
  /**
   * Enables or disables logs
   */
  verbose?: boolean; // TODO: make it configurable with Debug modal
  /**
   * Url send events to
   */
  url?: string;
  /**
   * Session duration in milliseconds
   * @default 30mins
   */
  sessionDuration?: number;
  /**
   * API version used when sending events
   */
  apiVersion?: number;
  /**
   * Connectors that receive every record. Called in the order given.
   */
  connectors?: readonly TelemetryConnector[];
  /**
   * Switches the shipped collector on or off. Off means nothing is queued or drained.
   * @default true without connectors, false with connectors
   */
  collector?: boolean;
};

export type TelemetrySession = {
  id: string;
  lastActivity: number;
  startTime: number;
};

/**
 * A plugin's event logger. Returns `undefined` when the production build has no connector and
 * the collector is off: no record is built then.
 */
export type LogEvent = (...args: TelemetryLogEventParams) => TelemetryRecord | undefined;

export type TelemetryPluginOption = TelemetryPlugin | false | null | undefined;

export type TelemetryPlugin = {
  name: string;
  setup: (context: TelemetryPluginContext) => void;
};

export type TelemetryPluginContext = {
  config: TelemetryConfigNormalized;
  addHook: HooksManager['addHook'];
  logEvent: LogEvent;
  getSession: () => TelemetrySession | undefined;
  refreshSession: () => void;
  logger: TelemetryLoggerService;
};

export type TelemetryContext = {
  config: TelemetryConfigNormalized;
  hooks: TelemetryHooksService;
  logger: TelemetryLoggerService;
  /** The build-kind constant the client was created with. */
  buildKind: BuildKind;
  /** Reads the telemetry state and collector switch fixed at construction. */
  getTelemetryState: () => DerivedTelemetryState;
  /** Connector dispatch: state, handler depth and the record/signal entries. */
  dispatch: ConnectorDispatch;
  /** The consent gate's stage: copies, freezes and hands a record to dispatch. */
  gateStage: (record: TelemetryRecord) => void;
  /** The dev inspector; a no-op in the production build. */
  inspector: Inspector;
};
