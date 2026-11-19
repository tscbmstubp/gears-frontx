export { createTelemetry } from './services/telemetry';
export type { TelemetryService, TelemetryLogEvent, TelemetryRecordEvent } from './services/types';
export type {
  CatalogCheck,
  CatalogData,
  CatalogName,
  CatalogNamespace,
  TelemetryCatalogError,
  TelemetryCatalogOk,
  TelemetryNoCatalog,
} from './catalog/types';
export { telemetryElementHookKey } from './plugins/autocapture/elementHook';
export type {
  TelemetryElementHook,
  TelemetryElementHookAttribution,
  TelemetryElementHookResult,
} from './plugins/autocapture/elementHook';
export { telemetryLocalePlugin } from './plugins/locale';
export type { LocaleSource } from './plugins/locale';
export type {
  TelemetryEventRecord,
  TelemetryLogEventParams,
  TelemetryData,
} from './utils/eventTypes';
export type {
  TelemetryConfig,
  TelemetryConfigBase,
  TelemetryNamespaceOption,
  TelemetryPlugin,
  TelemetryPluginContext,
  TelemetryPluginOption,
} from './utils/types';

export type { Inspector, InspectorRecord } from './inspector/inspector';
export type { BuildKind } from './build/kind';
export type { TelemetryConnector, TelemetryConsentState } from './connectors/types';
export type { TelemetryConsentOptions } from './utils/types';
export type { TelemetryState } from './services/state';
