// @cpt-dod:cpt-frontx-telemetry-dod-consent-gate-collector-unchanged:p1
// @cpt-dod:cpt-frontx-telemetry-dod-consent-gate-input-validation:p1
import { createEventsManager } from '../managers/events';
import { createPluginsManager } from '../managers/plugins';
import { createSessionManager } from '../managers/session';
import { createUserInfoManager } from '../managers/userInfo';
import { telemetryAppInfoPlugin } from '../plugins/appInfo';
import { autocapturePlugin } from '../plugins/autocapture/autocapture';
import { devicePlugin } from '../plugins/device';
import { navigationPlugin } from '../plugins/navigation';
import { sessionPlugin } from '../plugins/session';
import type { CatalogName, TelemetryNoCatalog } from '../catalog/types';
import type {
  TelemetryData,
  TelemetryLogEventParams,
  TelemetryUserId,
} from '../utils/eventTypes';
import { createHooks } from '../utils/hooks';
import { createLogger } from '../utils/logger';
import type { TelemetryContext, TelemetryConfig, TelemetryPluginOption } from '../utils/types';
import { normalizeOptions } from '../utils/utils';
import { BUILD_KIND, type BuildKind } from '../build/kind';
import { createConsentGate, createGateStage, type IdentityDeps } from '../connectors/consentGate';
import type { TelemetryConsentState } from '../connectors/types';
import { createConnectorDispatch } from '../connectors/dispatch';
import { createInspector } from '../inspector/inspector';
import { deriveTelemetryState } from './state';
import type { TelemetryService } from './types';

// @cpt-dod:cpt-frontx-telemetry-dod-connector-delivery-silent-start:p1
// @cpt-dod:cpt-frontx-telemetry-dod-connector-delivery-page-flush:p1
// @cpt-dod:cpt-frontx-telemetry-dod-connector-delivery-destroy:p1
// @cpt-dod:cpt-frontx-telemetry-dod-connector-delivery-shell-to-connector:p1
// @cpt-dod:cpt-frontx-telemetry-dod-declared-events-typed-record:p1

// @cpt-flow:cpt-frontx-telemetry-flow-event-collection-instrument:p1
// @cpt-algo:cpt-frontx-telemetry-algo-event-collection-start:p1
// @cpt-algo:cpt-frontx-telemetry-algo-event-collection-destroy:p1
// @cpt-state:cpt-frontx-telemetry-state-event-collection-client-lifecycle:p2
// @cpt-dod:cpt-frontx-telemetry-dod-event-collection-single-use:p1
// @cpt-flow:cpt-frontx-telemetry-flow-connector-delivery-connect-backend:p1
// @cpt-algo:cpt-frontx-telemetry-algo-connector-delivery-start:p1
// @cpt-algo:cpt-frontx-telemetry-algo-connector-delivery-destroy:p1
// @cpt-flow:cpt-frontx-telemetry-flow-declared-events-shell-events:p1
// @cpt-begin:cpt-frontx-telemetry-flow-event-collection-instrument:p1:inst-create-client
// @cpt-begin:cpt-frontx-telemetry-flow-declared-events-shell-events:p1:inst-write-shell-catalog
// @cpt-begin:cpt-frontx-telemetry-flow-declared-events-shell-events:p1:inst-create-typed-client
export function createTelemetry<C extends object = TelemetryNoCatalog>(
  configRaw: TelemetryConfig<C>,
): TelemetryService<C> {
  // @cpt-end:cpt-frontx-telemetry-flow-declared-events-shell-events:p1:inst-create-typed-client
  // @cpt-end:cpt-frontx-telemetry-flow-declared-events-shell-events:p1:inst-write-shell-catalog
  // @cpt-begin:cpt-frontx-telemetry-flow-connector-delivery-connect-backend:p1:inst-create-client
  // @cpt-begin:cpt-frontx-telemetry-flow-connector-delivery-accepts-reports:p1:inst-shell-creates-client
  return createTelemetryWithBuildKind(configRaw, BUILD_KIND);
  // @cpt-end:cpt-frontx-telemetry-flow-connector-delivery-accepts-reports:p1:inst-shell-creates-client
  // @cpt-end:cpt-frontx-telemetry-flow-connector-delivery-connect-backend:p1:inst-create-client
}

export function createTelemetryWithBuildKind<C extends object = TelemetryNoCatalog>(
  configRaw: TelemetryConfig<C>,
  buildKind: BuildKind,
): TelemetryService<C> {
  // @cpt-begin:cpt-frontx-telemetry-flow-event-collection-instrument:p1:inst-normalize-config
  const config = normalizeOptions(configRaw);
  const hooks = createHooks();
  const logger = createLogger(config);
  // @cpt-begin:cpt-frontx-telemetry-flow-connector-delivery-connect-backend:p1:inst-fix-state
  // @cpt-begin:cpt-frontx-telemetry-flow-connector-delivery-accepts-reports:p1:inst-derive-at-construction
  const telemetryState = deriveTelemetryState({
    connectors: config.connectors,
    collector: config.collector,
    deliveryEnabled: config.enabled,
    buildKind,
  });
  // @cpt-end:cpt-frontx-telemetry-flow-connector-delivery-accepts-reports:p1:inst-derive-at-construction
  // The record path's pieces are built before the events manager that uses them.
  const dispatch = createConnectorDispatch(config.connectors);
  // @cpt-end:cpt-frontx-telemetry-flow-connector-delivery-connect-backend:p1:inst-fix-state
  const inspector = createInspector(buildKind);
  // The consent options are read from the supplied config; the gate applies the defaults
  // (`unsetCountsAsGranted` false, `holdWhileUnknown` true).
  // @cpt-begin:cpt-frontx-telemetry-flow-consent-gate-set-consent:p1:inst-set-create-client
  // @cpt-begin:cpt-frontx-telemetry-flow-consent-gate-set-consent:p1:inst-set-init-gate
  const gate = createConsentGate({ consent: configRaw.consent, inspector });
  // @cpt-end:cpt-frontx-telemetry-flow-consent-gate-set-consent:p1:inst-set-init-gate
  // @cpt-end:cpt-frontx-telemetry-flow-consent-gate-set-consent:p1:inst-set-create-client
  const context: TelemetryContext = {
    config,
    hooks,
    logger,
    buildKind,
    getTelemetryState: () => telemetryState,
    dispatch,
    // @cpt-begin:cpt-frontx-telemetry-flow-connector-delivery-connect-backend:p1:inst-deliver-record
    // The gate reads the client's lifecycle, destroyed from the moment `destroy()` begins.
    // @cpt-begin:cpt-frontx-telemetry-flow-consent-gate-set-consent:p1:inst-set-record-events
    gateStage: createGateStage(config.connectors, dispatch.dispatchRecord, logger, gate, isDestroyed),
    // @cpt-end:cpt-frontx-telemetry-flow-consent-gate-set-consent:p1:inst-set-record-events
    // @cpt-end:cpt-frontx-telemetry-flow-connector-delivery-connect-backend:p1:inst-deliver-record
    inspector,
  };
  // @cpt-end:cpt-frontx-telemetry-flow-event-collection-instrument:p1:inst-normalize-config
  // @cpt-begin:cpt-frontx-telemetry-flow-event-collection-instrument:p1:inst-construct-managers
  const sessionManager = createSessionManager(context);
  const eventsManager = createEventsManager(context);
  const userInfoManager = createUserInfoManager(context);
  const pluginsManager = createPluginsManager(context, sessionManager, eventsManager);
  const rootApi: TelemetryService<C> = {
    plugin,
    start,
    destroy,
    logEvent,
    record,
    identify,
    setConsent,
    resetIdentity,
    acceptsReports,
    getRecords,
  };
  // @cpt-end:cpt-frontx-telemetry-flow-event-collection-instrument:p1:inst-construct-managers
  // Starts CREATED: no listener installed and no plugin set up until `start()` runs.
  let lifecycle: 'created' | 'started' | 'destroyed' = 'created';
  // A connector handler may call `destroy()` while `start()` is running: dispatch is open before
  // the shipped start steps, which already make records. Read through a function so the check is
  // not narrowed away by the `lifecycle = 'started'` assignment in `start()`.
  const destroyedDuringStart = () => lifecycle === 'destroyed';
  // What the gate's consent and identity operations need from the client. `userInfo` is the
  // shipped user-info manager, whose stamping runs at once and is never queued.
  const gateDeps: IdentityDeps = {
    dispatchRecord: dispatch.dispatchRecord,
    dispatchConsentChange: dispatch.dispatchConsentChange,
    dispatchIdentityChange: dispatch.dispatchIdentityChange,
    isDispatchOpen: () => dispatch.getState() === 'OPEN',
    logger,
    isDestroyed,
    userInfo: userInfoManager,
  };

  // @cpt-begin:cpt-frontx-telemetry-flow-connector-delivery-connect-backend:p1:inst-return-connected
  return rootApi;
  // @cpt-end:cpt-frontx-telemetry-flow-connector-delivery-connect-backend:p1:inst-return-connected

  // The gate reads the client's lifecycle, destroyed from the moment `destroy()` begins: the
  // lifecycle is set to DESTROYED right after destroy's shipped guards, before any teardown step.
  function isDestroyed() {
    return lifecycle === 'destroyed';
  }

  // The development inspector's record list for this client; `[]` in the production build.
  function getRecords() {
    return inspector.getRecords();
  }

  // @cpt-flow:cpt-frontx-telemetry-flow-connector-delivery-accepts-reports:p1
  // @cpt-begin:cpt-frontx-telemetry-flow-connector-delivery-accepts-reports:p1:inst-read-accepts-reports
  function acceptsReports() {
    // @cpt-begin:cpt-frontx-telemetry-flow-connector-delivery-accepts-reports:p1:inst-return-fixed-value
    return telemetryState.acceptsReports;
    // @cpt-end:cpt-frontx-telemetry-flow-connector-delivery-accepts-reports:p1:inst-return-fixed-value
  }
  // @cpt-end:cpt-frontx-telemetry-flow-connector-delivery-accepts-reports:p1:inst-read-accepts-reports

  // @cpt-begin:cpt-frontx-telemetry-flow-event-collection-instrument:p1:inst-log-event
  function logEvent(...args: TelemetryLogEventParams) {
    // @cpt-begin:cpt-frontx-telemetry-flow-connector-delivery-connect-backend:p1:inst-record-event
    // @cpt-begin:cpt-frontx-telemetry-flow-declared-events-shell-events:p1:inst-untyped-still-works
    eventsManager.logEvent(...args);
    // @cpt-end:cpt-frontx-telemetry-flow-declared-events-shell-events:p1:inst-untyped-still-works
    // @cpt-end:cpt-frontx-telemetry-flow-connector-delivery-connect-backend:p1:inst-record-event
  }
  // @cpt-end:cpt-frontx-telemetry-flow-event-collection-instrument:p1:inst-log-event

  // The typed record call. Its types are checked by `TelemetryRecordEvent`; at runtime it is a
  // new-surface hand-off that never reaches the caller with a value, a promise or an error.
  // @cpt-algo:cpt-frontx-telemetry-algo-declared-events-typed-record:p1
  // @cpt-begin:cpt-frontx-telemetry-flow-declared-events-shell-events:p1:inst-record-declared-event
  function record(name: CatalogName<C>, data: unknown): undefined {
    // @cpt-begin:cpt-frontx-telemetry-flow-declared-events-shell-events:p1:inst-run-typed-record
    // @cpt-begin:cpt-frontx-telemetry-algo-declared-events-typed-record:p1:inst-try-typed-record
    try {
      // @cpt-begin:cpt-frontx-telemetry-algo-declared-events-typed-record:p1:inst-pass-to-events-manager
      // @cpt-begin:cpt-frontx-telemetry-algo-declared-events-typed-record:p1:inst-run-record-handoff
      eventsManager.record([name, data as TelemetryData], 'new');
      // @cpt-end:cpt-frontx-telemetry-algo-declared-events-typed-record:p1:inst-run-record-handoff
      // @cpt-end:cpt-frontx-telemetry-algo-declared-events-typed-record:p1:inst-pass-to-events-manager
      // @cpt-begin:cpt-frontx-telemetry-algo-declared-events-typed-record:p1:inst-catch-typed-record
    } catch (error) {
      // @cpt-begin:cpt-frontx-telemetry-algo-declared-events-typed-record:p1:inst-report-internal-failure
      logger.logError('Telemetry: recording a declared event failed inside the package.', error);
      // @cpt-end:cpt-frontx-telemetry-algo-declared-events-typed-record:p1:inst-report-internal-failure
    }
    // @cpt-end:cpt-frontx-telemetry-algo-declared-events-typed-record:p1:inst-catch-typed-record
    // @cpt-end:cpt-frontx-telemetry-algo-declared-events-typed-record:p1:inst-try-typed-record
    // @cpt-end:cpt-frontx-telemetry-flow-declared-events-shell-events:p1:inst-run-typed-record
    // @cpt-begin:cpt-frontx-telemetry-flow-declared-events-shell-events:p1:inst-return-to-caller
    // @cpt-begin:cpt-frontx-telemetry-algo-declared-events-typed-record:p1:inst-return-nothing
    return undefined;
    // @cpt-end:cpt-frontx-telemetry-algo-declared-events-typed-record:p1:inst-return-nothing
    // @cpt-end:cpt-frontx-telemetry-flow-declared-events-shell-events:p1:inst-return-to-caller
  }
  // @cpt-end:cpt-frontx-telemetry-flow-declared-events-shell-events:p1:inst-record-declared-event

  // @cpt-begin:cpt-frontx-telemetry-flow-event-collection-instrument:p1:inst-identify-user
  // @cpt-flow:cpt-frontx-telemetry-flow-consent-gate-identify-reset:p1
  function identify(newUserId: TelemetryUserId) {
    // The gate stamps the identifier through the user-info manager at once, as shipped, then
    // runs its identity rule through the queue. A gate failure is logged, never thrown.
    try {
      // @cpt-begin:cpt-frontx-telemetry-flow-consent-gate-identify-reset:p1:inst-idr-identify-stamp
      // @cpt-begin:cpt-frontx-telemetry-flow-consent-gate-identify-reset:p1:inst-idr-identify-gate
      gate.identify(newUserId, gateDeps);
      // @cpt-end:cpt-frontx-telemetry-flow-consent-gate-identify-reset:p1:inst-idr-identify-gate
      // @cpt-end:cpt-frontx-telemetry-flow-consent-gate-identify-reset:p1:inst-idr-identify-stamp
    } catch (error) {
      logger.logError('Telemetry: identify failed inside the consent gate.', error);
    }
    // @cpt-begin:cpt-frontx-telemetry-flow-consent-gate-identify-reset:p1:inst-idr-return
    return rootApi;
    // @cpt-end:cpt-frontx-telemetry-flow-consent-gate-identify-reset:p1:inst-idr-return
  }
  // @cpt-end:cpt-frontx-telemetry-flow-event-collection-instrument:p1:inst-identify-user

  // Clears the identity: the stamp at once, the gate's reset rule through the queue. Returns
  // nothing and never throws.
  function resetIdentity(): void {
    try {
      // @cpt-begin:cpt-frontx-telemetry-flow-consent-gate-identify-reset:p1:inst-idr-reset
      gate.resetIdentity(gateDeps);
      // @cpt-end:cpt-frontx-telemetry-flow-consent-gate-identify-reset:p1:inst-idr-reset
    } catch (error) {
      logger.logError('Telemetry: resetIdentity failed inside the consent gate.', error);
    }
    // @cpt-begin:cpt-frontx-telemetry-flow-consent-gate-identify-reset:p1:inst-idr-return
    return;
    // @cpt-end:cpt-frontx-telemetry-flow-consent-gate-identify-reset:p1:inst-idr-return
  }

  // Sets the application's consent answer. Returns nothing and never throws; a value that is not
  // a consent state is logged and ignored by the gate.
  // @cpt-flow:cpt-frontx-telemetry-flow-consent-gate-set-consent:p1
  function setConsent(state: TelemetryConsentState): void {
    try {
      // @cpt-begin:cpt-frontx-telemetry-flow-consent-gate-set-consent:p1:inst-set-ask-user
      // @cpt-begin:cpt-frontx-telemetry-flow-consent-gate-set-consent:p1:inst-set-call-set-consent
      gate.setConsent(state, gateDeps);
      // @cpt-end:cpt-frontx-telemetry-flow-consent-gate-set-consent:p1:inst-set-call-set-consent
      // @cpt-end:cpt-frontx-telemetry-flow-consent-gate-set-consent:p1:inst-set-ask-user
    } catch (error) {
      logger.logError('Telemetry: setConsent failed inside the consent gate.', error);
    }
    // @cpt-begin:cpt-frontx-telemetry-flow-consent-gate-set-consent:p1:inst-set-return
    return;
    // @cpt-end:cpt-frontx-telemetry-flow-consent-gate-set-consent:p1:inst-set-return
  }

  // @cpt-begin:cpt-frontx-telemetry-flow-event-collection-instrument:p1:inst-start-client
  function start() {
    // @cpt-begin:cpt-frontx-telemetry-flow-connector-delivery-connect-backend:p1:inst-start-client
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-start:p1:inst-shipped-start-guards
    // @cpt-begin:cpt-frontx-telemetry-algo-event-collection-start:p1:inst-guard-window
    // @cpt-begin:cpt-frontx-telemetry-flow-event-collection-instrument:p1:inst-check-window
    if (typeof window === 'undefined') {
      // @cpt-begin:cpt-frontx-telemetry-algo-event-collection-start:p1:inst-return-unstarted
      // @cpt-begin:cpt-frontx-telemetry-flow-event-collection-instrument:p1:inst-no-window-noop
      return rootApi;
      // @cpt-end:cpt-frontx-telemetry-flow-event-collection-instrument:p1:inst-no-window-noop
      // @cpt-end:cpt-frontx-telemetry-algo-event-collection-start:p1:inst-return-unstarted
    }
    // @cpt-end:cpt-frontx-telemetry-flow-event-collection-instrument:p1:inst-check-window
    // @cpt-end:cpt-frontx-telemetry-algo-event-collection-start:p1:inst-guard-window

    // A client is single-use by design. `destroy()` leaves the registered hooks in place, so a
    // `start()` after `start()` or after `destroy()` would set every plugin up again, duplicating
    // its `event` hook and its listeners. Build a new client instead of restarting this one.
    // @cpt-begin:cpt-frontx-telemetry-flow-event-collection-instrument:p1:inst-check-started
    // @cpt-begin:cpt-frontx-telemetry-algo-event-collection-start:p1:inst-guard-restart
    // @cpt-begin:cpt-frontx-telemetry-state-event-collection-client-lifecycle:p2:inst-started-to-started
    if (lifecycle === 'started') {
      // @cpt-begin:cpt-frontx-telemetry-algo-event-collection-start:p1:inst-log-restart-refused
      // @cpt-begin:cpt-frontx-telemetry-flow-event-collection-instrument:p1:inst-refuse-restart
      logger.logError('Telemetry is already started; build a new client instead of restarting.');
      // @cpt-end:cpt-frontx-telemetry-flow-event-collection-instrument:p1:inst-refuse-restart
      // @cpt-end:cpt-frontx-telemetry-algo-event-collection-start:p1:inst-log-restart-refused
      // @cpt-begin:cpt-frontx-telemetry-algo-event-collection-start:p1:inst-return-already-started
      return rootApi;
      // @cpt-end:cpt-frontx-telemetry-algo-event-collection-start:p1:inst-return-already-started
    }
    // @cpt-end:cpt-frontx-telemetry-state-event-collection-client-lifecycle:p2:inst-started-to-started
    // @cpt-end:cpt-frontx-telemetry-algo-event-collection-start:p1:inst-guard-restart
    // @cpt-begin:cpt-frontx-telemetry-algo-event-collection-start:p1:inst-guard-destroyed
    // @cpt-begin:cpt-frontx-telemetry-state-event-collection-client-lifecycle:p2:inst-destroyed-terminal
    if (lifecycle === 'destroyed') {
      // @cpt-begin:cpt-frontx-telemetry-algo-event-collection-start:p1:inst-log-destroyed-refused
      // @cpt-begin:cpt-frontx-telemetry-flow-event-collection-instrument:p1:inst-refuse-restart
      logger.logError('Telemetry has been destroyed; build a new client instead of restarting.');
      // @cpt-end:cpt-frontx-telemetry-flow-event-collection-instrument:p1:inst-refuse-restart
      // @cpt-end:cpt-frontx-telemetry-algo-event-collection-start:p1:inst-log-destroyed-refused
      // @cpt-begin:cpt-frontx-telemetry-algo-event-collection-start:p1:inst-return-destroyed-unchanged
      return rootApi;
      // @cpt-end:cpt-frontx-telemetry-algo-event-collection-start:p1:inst-return-destroyed-unchanged
    }
    // @cpt-end:cpt-frontx-telemetry-state-event-collection-client-lifecycle:p2:inst-destroyed-terminal
    // @cpt-end:cpt-frontx-telemetry-algo-event-collection-start:p1:inst-guard-destroyed
    // @cpt-end:cpt-frontx-telemetry-flow-event-collection-instrument:p1:inst-check-started

    // @cpt-begin:cpt-frontx-telemetry-algo-event-collection-start:p1:inst-set-started
    // @cpt-begin:cpt-frontx-telemetry-state-event-collection-client-lifecycle:p2:inst-created-to-started
    lifecycle = 'started';
    // @cpt-end:cpt-frontx-telemetry-state-event-collection-client-lifecycle:p2:inst-created-to-started
    // @cpt-end:cpt-frontx-telemetry-algo-event-collection-start:p1:inst-set-started
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-start:p1:inst-shipped-start-guards

    // A production build with nothing to deliver to captures nothing: no dispatch, plugin,
    // listener, session refresh, storage write or start hook. DELIVERY_SUPPRESSED is not silent.
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-start:p1:inst-check-silent-start
    // @cpt-begin:cpt-frontx-telemetry-flow-connector-delivery-connect-backend:p1:inst-prod-no-connector
    if (buildKind === 'production' && telemetryState.state === 'WITHOUT_CONNECTOR') {
      // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-start:p1:inst-return-silent-start
      // @cpt-begin:cpt-frontx-telemetry-flow-connector-delivery-connect-backend:p1:inst-capture-nothing
      return rootApi;
      // @cpt-end:cpt-frontx-telemetry-flow-connector-delivery-connect-backend:p1:inst-capture-nothing
      // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-start:p1:inst-return-silent-start
    }
    // @cpt-end:cpt-frontx-telemetry-flow-connector-delivery-connect-backend:p1:inst-prod-no-connector
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-start:p1:inst-check-silent-start

    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-start:p1:inst-check-dev-notices
    if (buildKind === 'development') {
      // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-start:p1:inst-show-state-notice
      // @cpt-begin:cpt-frontx-telemetry-flow-connector-delivery-connect-backend:p1:inst-check-no-connector-setup
      // @cpt-begin:cpt-frontx-telemetry-flow-connector-delivery-connect-backend:p1:inst-check-dev-no-connector
      if (telemetryState.state === 'WITHOUT_CONNECTOR') {
        // @cpt-begin:cpt-frontx-telemetry-flow-connector-delivery-connect-backend:p1:inst-show-records-and-notice
        inspector.notice(
          'No connector is configured and the collector is off: records are shown here and nothing is sent.',
        );
        // @cpt-end:cpt-frontx-telemetry-flow-connector-delivery-connect-backend:p1:inst-show-records-and-notice
        // @cpt-end:cpt-frontx-telemetry-flow-connector-delivery-connect-backend:p1:inst-check-dev-no-connector
        // @cpt-end:cpt-frontx-telemetry-flow-connector-delivery-connect-backend:p1:inst-check-no-connector-setup
        // @cpt-begin:cpt-frontx-telemetry-flow-connector-delivery-connect-backend:p1:inst-connector-setup
        // @cpt-begin:cpt-frontx-telemetry-flow-connector-delivery-connect-backend:p1:inst-check-collector-beside
      } else if (telemetryState.collectorBesideConnectors) {
        // @cpt-begin:cpt-frontx-telemetry-flow-connector-delivery-connect-backend:p1:inst-collector-beside-connectors
        inspector.notice(
          'The collector is on beside application connectors: both receive every record.',
        );
        // @cpt-end:cpt-frontx-telemetry-flow-connector-delivery-connect-backend:p1:inst-collector-beside-connectors
      }
      // @cpt-end:cpt-frontx-telemetry-flow-connector-delivery-connect-backend:p1:inst-check-collector-beside
      // @cpt-end:cpt-frontx-telemetry-flow-connector-delivery-connect-backend:p1:inst-connector-setup
      // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-start:p1:inst-show-state-notice
    }
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-start:p1:inst-check-dev-notices

    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-start:p1:inst-open-dispatch
    dispatch.open();
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-start:p1:inst-open-dispatch

    // The consent start pass: every connector learns the effective state once, then any identity
    // kept before start is handled by it. A connector may destroy the client during the pass.
    // @cpt-begin:cpt-frontx-telemetry-flow-consent-gate-set-consent:p1:inst-set-start-client
    gate.startPass(gateDeps);
    // @cpt-end:cpt-frontx-telemetry-flow-consent-gate-set-consent:p1:inst-set-start-client
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-start-pass:p1:inst-sp-check-destroyed-after-state
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-start:p1:inst-stop-if-destroyed
    if (destroyedDuringStart()) {
      return rootApi;
    }
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-start:p1:inst-stop-if-destroyed
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-start-pass:p1:inst-sp-check-destroyed-after-state

    // Installed before the shipped start steps, so a start hook that throws still leaves them.
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-start:p1:inst-install-page-listeners
    document.addEventListener('visibilitychange', handlePageVisibility);
    window.addEventListener('pagehide', handlePageHide);
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-start:p1:inst-install-page-listeners

    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-start:p1:inst-shipped-start-steps
    // @cpt-begin:cpt-frontx-telemetry-flow-event-collection-instrument:p1:inst-start-collection
    // The built-ins are registered after anything the caller registered, so a caller plugin using
    // a built-in name is the one that gets replaced. This is why those names are reserved — for a
    // built-in that registers: one switched off here occupies no name, so a caller plugin under it
    // survives and is set up.
    // @cpt-begin:cpt-frontx-telemetry-algo-event-collection-start:p1:inst-register-builtins
    plugin(
      sessionPlugin(),
      devicePlugin(),
      config.navigationCapture && navigationPlugin(),
      telemetryAppInfoPlugin(),
      autocapturePlugin(),
    );
    // @cpt-end:cpt-frontx-telemetry-algo-event-collection-start:p1:inst-register-builtins
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-start:p1:inst-stop-if-destroyed
    if (destroyedDuringStart()) {
      return rootApi;
    }
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-start:p1:inst-stop-if-destroyed
    // @cpt-begin:cpt-frontx-telemetry-algo-event-collection-start:p1:inst-start-session
    sessionManager.start();
    // @cpt-end:cpt-frontx-telemetry-algo-event-collection-start:p1:inst-start-session
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-start:p1:inst-stop-if-destroyed
    if (destroyedDuringStart()) {
      return rootApi;
    }
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-start:p1:inst-stop-if-destroyed
    // @cpt-begin:cpt-frontx-telemetry-algo-event-collection-start:p1:inst-start-events
    eventsManager.start();
    // @cpt-end:cpt-frontx-telemetry-algo-event-collection-start:p1:inst-start-events
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-start:p1:inst-stop-if-destroyed
    if (destroyedDuringStart()) {
      return rootApi;
    }
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-start:p1:inst-stop-if-destroyed
    // @cpt-begin:cpt-frontx-telemetry-algo-event-collection-start:p1:inst-setup-plugins
    pluginsManager.setup();
    // @cpt-end:cpt-frontx-telemetry-algo-event-collection-start:p1:inst-setup-plugins
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-start:p1:inst-stop-if-destroyed
    if (destroyedDuringStart()) {
      return rootApi;
    }
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-start:p1:inst-stop-if-destroyed
    // @cpt-begin:cpt-frontx-telemetry-algo-event-collection-start:p1:inst-refresh-session
    sessionManager.refreshSession();
    // @cpt-end:cpt-frontx-telemetry-algo-event-collection-start:p1:inst-refresh-session
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-start:p1:inst-stop-if-destroyed
    if (destroyedDuringStart()) {
      return rootApi;
    }
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-start:p1:inst-stop-if-destroyed
    // @cpt-begin:cpt-frontx-telemetry-algo-event-collection-start:p1:inst-call-start-hooks
    // Every start hook runs and the first error is rethrown after the loop, as `callHooksSync`
    // does, except that a client destroyed by a connector handler calls no further start hook.
    let startHookError: unknown = undefined;
    for (const startHook of hooks.getHooks('start')) {
      // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-start:p1:inst-stop-if-destroyed
      if (destroyedDuringStart()) {
        break;
      }
      // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-start:p1:inst-stop-if-destroyed
      try {
        startHook();
      } catch (e: unknown) {
        startHookError ??= e;
      }
    }
    if (startHookError) {
      throw startHookError instanceof Error ? startHookError : new Error(String(startHookError));
    }
    // @cpt-end:cpt-frontx-telemetry-algo-event-collection-start:p1:inst-call-start-hooks
    // @cpt-end:cpt-frontx-telemetry-flow-event-collection-instrument:p1:inst-start-collection
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-start:p1:inst-shipped-start-steps
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-start:p1:inst-return-started-client
    // @cpt-begin:cpt-frontx-telemetry-algo-event-collection-start:p1:inst-return-started
    return rootApi;
    // @cpt-end:cpt-frontx-telemetry-algo-event-collection-start:p1:inst-return-started
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-start:p1:inst-return-started-client
    // @cpt-end:cpt-frontx-telemetry-flow-connector-delivery-connect-backend:p1:inst-start-client
  }

  // Page-lifecycle flush: synchronous inside the event's handler, never followed by a shutdown.
  // The shipped forced collector drain on the page becoming hidden is a separate listener.
  function handlePageVisibility() {
    // @cpt-begin:cpt-frontx-telemetry-flow-connector-delivery-connect-backend:p1:inst-flush-on-page-hide
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-page-flush:p1:inst-check-visibility-trigger
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-page-flush:p1:inst-check-page-hidden
    if (document.visibilityState !== 'hidden') {
      // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-page-flush:p1:inst-return-page-visible
      return;
      // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-page-flush:p1:inst-return-page-visible
    }
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-page-flush:p1:inst-check-page-hidden
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-page-flush:p1:inst-flush-on-hidden
    dispatch.requestFlush();
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-page-flush:p1:inst-flush-on-hidden
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-page-flush:p1:inst-check-visibility-trigger
    // @cpt-end:cpt-frontx-telemetry-flow-connector-delivery-connect-backend:p1:inst-flush-on-page-hide
  }

  function handlePageHide() {
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-page-flush:p1:inst-check-pagehide-trigger
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-page-flush:p1:inst-flush-on-pagehide
    dispatch.requestFlush();
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-page-flush:p1:inst-flush-on-pagehide
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-page-flush:p1:inst-check-pagehide-trigger
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-page-flush:p1:inst-return-page-flush
    return;
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-page-flush:p1:inst-return-page-flush
  }
  // @cpt-end:cpt-frontx-telemetry-flow-event-collection-instrument:p1:inst-start-client

  // @cpt-begin:cpt-frontx-telemetry-flow-event-collection-instrument:p1:inst-register-plugins
  function plugin(...newPlugins: TelemetryPluginOption[]) {
    if (typeof window === 'undefined') {
      return rootApi;
    }

    pluginsManager.plugin(...newPlugins);
    return rootApi;
  }
  // @cpt-end:cpt-frontx-telemetry-flow-event-collection-instrument:p1:inst-register-plugins

  // @cpt-begin:cpt-frontx-telemetry-flow-event-collection-instrument:p1:inst-destroy-client
  // @cpt-begin:cpt-frontx-telemetry-state-event-collection-client-lifecycle:p2:inst-started-to-destroyed
  // @cpt-begin:cpt-frontx-telemetry-state-event-collection-client-lifecycle:p2:inst-created-to-destroyed
  function destroy() {
    // @cpt-begin:cpt-frontx-telemetry-flow-connector-delivery-connect-backend:p1:inst-destroy-client
    // @cpt-begin:cpt-frontx-telemetry-algo-event-collection-destroy:p1:inst-guard-window-destroy
    if (typeof window === 'undefined') {
      // @cpt-begin:cpt-frontx-telemetry-algo-event-collection-destroy:p1:inst-return-no-teardown
      return;
      // @cpt-end:cpt-frontx-telemetry-algo-event-collection-destroy:p1:inst-return-no-teardown
    }
    // @cpt-end:cpt-frontx-telemetry-algo-event-collection-destroy:p1:inst-guard-window-destroy

    // @cpt-begin:cpt-frontx-telemetry-algo-event-collection-destroy:p1:inst-guard-repeat-destroy
    // @cpt-begin:cpt-frontx-telemetry-state-event-collection-client-lifecycle:p2:inst-destroyed-repeat-destroy
    if (lifecycle === 'destroyed') {
      // @cpt-begin:cpt-frontx-telemetry-algo-event-collection-destroy:p1:inst-return-already-destroyed
      return;
      // @cpt-end:cpt-frontx-telemetry-algo-event-collection-destroy:p1:inst-return-already-destroyed
    }
    // @cpt-end:cpt-frontx-telemetry-state-event-collection-client-lifecycle:p2:inst-destroyed-repeat-destroy
    // @cpt-end:cpt-frontx-telemetry-algo-event-collection-destroy:p1:inst-guard-repeat-destroy

    // Set before teardown runs, so a `start()` or `destroy()` called from a teardown hook is
    // refused rather than run partway through. Records still reach the queue until the events
    // manager's own teardown has delivered it.
    // @cpt-begin:cpt-frontx-telemetry-algo-event-collection-destroy:p1:inst-set-destroyed
    lifecycle = 'destroyed';
    // @cpt-end:cpt-frontx-telemetry-algo-event-collection-destroy:p1:inst-set-destroyed

    // @cpt-begin:cpt-frontx-telemetry-flow-event-collection-instrument:p1:inst-teardown-order
    // @cpt-begin:cpt-frontx-telemetry-algo-event-collection-destroy:p1:inst-detach-session
    sessionManager.destroy();
    // @cpt-end:cpt-frontx-telemetry-algo-event-collection-destroy:p1:inst-detach-session
    // The events manager goes last because its destroy flushes: a plugin's `destroy` hook may log
    // a parting event, and it has to reach the queue before the final send. It runs even when a
    // hook throws, because the client is already DESTROYED: no later `destroy()` would reach the
    // events manager, and its listener and pending send would outlive the teardown. The hook's
    // error is rethrown afterwards, so it still reaches the caller.
    let hookFailure: { error: unknown } | undefined;
    try {
      // @cpt-begin:cpt-frontx-telemetry-algo-event-collection-destroy:p1:inst-call-destroy-hooks
      hooks.callHooksSync('destroy');
      // @cpt-end:cpt-frontx-telemetry-algo-event-collection-destroy:p1:inst-call-destroy-hooks
    } catch (error) {
      hookFailure = { error };
    }
    // @cpt-begin:cpt-frontx-telemetry-algo-event-collection-destroy:p1:inst-teardown-events-last
    // @cpt-begin:cpt-frontx-telemetry-algo-event-collection-destroy:p1:inst-return-destroyed
    // @cpt-begin:cpt-frontx-telemetry-flow-event-collection-instrument:p1:inst-teardown-complete
    // A failed final send is held, like a hook's error, so the connector steps below still run.
    let sendFailure: { error: unknown } | undefined;
    try {
      eventsManager.destroy();
    } catch (drainError) {
      // While a hook's error is on its way to the caller, a failed final send is only logged, so
      // it cannot replace the hook's error.
      if (hookFailure) {
        logger.logError('Telemetry: the final send failed after a teardown hook threw.', drainError);
      } else {
        sendFailure = { error: drainError };
      }
    }

    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-destroy:p1:inst-attach-after-shipped-teardown
    // A client that never started has dispatch WAITING, so these signals reach no connector.
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-destroy:p1:inst-destroy-flush
    dispatch.dispatchFlush();
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-destroy:p1:inst-destroy-flush
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-destroy:p1:inst-destroy-shutdown
    dispatch.dispatchShutdown();
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-destroy:p1:inst-destroy-shutdown
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-destroy:p1:inst-close-dispatch
    dispatch.close();
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-destroy:p1:inst-close-dispatch
    // The consent destroy drop: nothing held, kept or queued survives, and the gate closes.
    gate.destroyDrop();
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-destroy:p1:inst-remove-page-listeners
    document.removeEventListener('visibilitychange', handlePageVisibility);
    window.removeEventListener('pagehide', handlePageHide);
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-destroy:p1:inst-remove-page-listeners
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-destroy:p1:inst-attach-after-shipped-teardown

    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-destroy:p1:inst-check-held-hook-error
    if (hookFailure) {
      // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-destroy:p1:inst-hook-error-reaches-caller
      throw hookFailure.error;
      // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-destroy:p1:inst-hook-error-reaches-caller
    }
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-destroy:p1:inst-check-held-hook-error
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-destroy:p1:inst-check-held-send-error
    if (sendFailure) {
      // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-destroy:p1:inst-send-error-reaches-caller
      throw sendFailure.error;
      // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-destroy:p1:inst-send-error-reaches-caller
    }
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-destroy:p1:inst-check-held-send-error
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-destroy:p1:inst-return-torn-down
    return;
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-destroy:p1:inst-return-torn-down
    // @cpt-end:cpt-frontx-telemetry-flow-event-collection-instrument:p1:inst-teardown-complete
    // @cpt-end:cpt-frontx-telemetry-algo-event-collection-destroy:p1:inst-return-destroyed
    // @cpt-end:cpt-frontx-telemetry-algo-event-collection-destroy:p1:inst-teardown-events-last
    // @cpt-end:cpt-frontx-telemetry-flow-event-collection-instrument:p1:inst-teardown-order
    // @cpt-end:cpt-frontx-telemetry-flow-connector-delivery-connect-backend:p1:inst-destroy-client
  }
  // @cpt-end:cpt-frontx-telemetry-state-event-collection-client-lifecycle:p2:inst-created-to-destroyed
  // @cpt-end:cpt-frontx-telemetry-state-event-collection-client-lifecycle:p2:inst-started-to-destroyed
  // @cpt-end:cpt-frontx-telemetry-flow-event-collection-instrument:p1:inst-destroy-client
}
// @cpt-end:cpt-frontx-telemetry-flow-event-collection-instrument:p1:inst-create-client
