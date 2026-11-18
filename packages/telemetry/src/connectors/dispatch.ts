import type { TelemetryRecord, TelemetryUserId } from '../utils/eventTypes';
import type { TelemetryConnector } from './types';

// @cpt-dod:cpt-frontx-telemetry-dod-connector-delivery-isolated-dispatch:p1
// @cpt-dod:cpt-frontx-telemetry-dod-connector-delivery-signals:p1
// @cpt-dod:cpt-frontx-telemetry-dod-connector-delivery-reentrant-record:p1

export type DispatchState = 'WAITING' | 'OPEN' | 'CLOSED';

type SignalHandlerName = 'onIdentityChange' | 'onConsentChange' | 'onFlush' | 'onShutdown';


export type ConnectorDispatch = {
  getState: () => DispatchState;
  getDepth: () => number;
  open: () => void;
  close: () => void;
  dispatchRecord: (frozen: Readonly<TelemetryRecord>) => void;
  dispatchIdentityChange: (id: TelemetryUserId | undefined) => void;
  dispatchConsentChange: (state: unknown) => void;
  dispatchFlush: () => void;
  dispatchShutdown: () => void;
  /** Internal flush-request entry; not on the public client. */
  requestFlush: () => void;
};

export function createConnectorDispatch(connectors: readonly TelemetryConnector[]): ConnectorDispatch {
  let state: DispatchState = 'WAITING';
  let depth = 0;

  // @cpt-algo:cpt-frontx-telemetry-algo-connector-delivery-isolated-call:p1
  function isolatedCall(handler: () => unknown): void {
    // @cpt-begin:cpt-frontx-telemetry-state-connector-delivery-dispatch:p1:inst-open-dispatches
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-isolated-call:p1:inst-raise-depth
    depth += 1;
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-isolated-call:p1:inst-raise-depth
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-isolated-call:p1:inst-try-handler
    try {
      const result = handler();
      // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-isolated-call:p1:inst-attach-rejection-handler
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        (result as Promise<unknown>).then(undefined, () => {});
      }
      // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-isolated-call:p1:inst-attach-rejection-handler
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-isolated-call:p1:inst-try-handler
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-isolated-call:p1:inst-catch-handler-throw
    } catch (_thrown: unknown) {
      // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-isolated-call:p1:inst-discard-throw
      // The thrown value is discarded: it reaches neither the caller nor the next connector.
      void _thrown;
      // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-isolated-call:p1:inst-discard-throw
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-isolated-call:p1:inst-catch-handler-throw
    } finally {
      // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-isolated-call:p1:inst-lower-depth
      depth -= 1;
      // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-isolated-call:p1:inst-lower-depth
    }
    // @cpt-end:cpt-frontx-telemetry-state-connector-delivery-dispatch:p1:inst-open-dispatches
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-isolated-call:p1:inst-return-isolated
    return;
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-isolated-call:p1:inst-return-isolated
  }

  // @cpt-algo:cpt-frontx-telemetry-algo-connector-delivery-dispatch-record:p1
  function dispatchRecord(frozen: Readonly<TelemetryRecord>): void {
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-dispatch-record:p1:inst-each-connector-record
    for (const connector of connectors) {
      // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-dispatch-record:p1:inst-check-open-record
      // @cpt-begin:cpt-frontx-telemetry-state-connector-delivery-dispatch:p1:inst-closed-drops-all
      if (state !== 'OPEN') {
        // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-dispatch-record:p1:inst-stop-record
        return;
        // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-dispatch-record:p1:inst-stop-record
      }
      // @cpt-end:cpt-frontx-telemetry-state-connector-delivery-dispatch:p1:inst-closed-drops-all
      // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-dispatch-record:p1:inst-check-open-record
      // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-dispatch-record:p1:inst-skip-no-record-handler
      const handler = connector.onRecord;
      if (!handler) continue;
      // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-dispatch-record:p1:inst-skip-no-record-handler
      // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-dispatch-record:p1:inst-call-record-handler
      isolatedCall(() => handler.call(connector, frozen));
      // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-dispatch-record:p1:inst-call-record-handler
    }
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-dispatch-record:p1:inst-each-connector-record
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-dispatch-record:p1:inst-return-record-dispatched
    return;
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-dispatch-record:p1:inst-return-record-dispatched
  }

  // @cpt-algo:cpt-frontx-telemetry-algo-connector-delivery-dispatch-signal:p1
  function dispatchSignal(name: SignalHandlerName, value?: unknown): void {
    // The handler name is picked by the entry that called this; onMeasurement is never a SignalHandlerName.
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-dispatch-signal:p1:inst-each-connector-signal
    for (const connector of connectors) {
      // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-dispatch-signal:p1:inst-check-open-signal
      // @cpt-begin:cpt-frontx-telemetry-state-connector-delivery-dispatch:p1:inst-closed-drops-all
      if (state !== 'OPEN') {
        // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-dispatch-signal:p1:inst-stop-signal
        return;
        // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-dispatch-signal:p1:inst-stop-signal
      }
      // @cpt-end:cpt-frontx-telemetry-state-connector-delivery-dispatch:p1:inst-closed-drops-all
      // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-dispatch-signal:p1:inst-check-open-signal
      // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-dispatch-signal:p1:inst-skip-no-signal-handler
      const handler = connector[name] as ((v?: unknown) => unknown) | undefined;
      if (!handler) continue;
      // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-dispatch-signal:p1:inst-skip-no-signal-handler
      // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-dispatch-signal:p1:inst-call-signal-handler
      isolatedCall(() => handler.call(connector, value));
      // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-dispatch-signal:p1:inst-call-signal-handler
    }
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-dispatch-signal:p1:inst-each-connector-signal
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-dispatch-signal:p1:inst-return-signal-dispatched
    return;
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-dispatch-signal:p1:inst-return-signal-dispatched
  }

  // @cpt-algo:cpt-frontx-telemetry-algo-connector-delivery-page-flush:p1
  function requestFlush(): void {
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-page-flush:p1:inst-check-request-trigger
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-page-flush:p1:inst-flush-on-request
    dispatchSignal('onFlush');
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-page-flush:p1:inst-flush-on-request
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-page-flush:p1:inst-check-request-trigger
  }

  return {
    getState: () => state,
    getDepth: () => depth,
    // @cpt-state:cpt-frontx-telemetry-state-connector-delivery-dispatch:p1
    open() {
      // @cpt-begin:cpt-frontx-telemetry-state-connector-delivery-dispatch:p1:inst-waiting-to-open
      if (state === 'WAITING') state = 'OPEN';
      // @cpt-end:cpt-frontx-telemetry-state-connector-delivery-dispatch:p1:inst-waiting-to-open
    },
    close() {
      // @cpt-begin:cpt-frontx-telemetry-state-connector-delivery-dispatch:p1:inst-open-to-closed
      // @cpt-begin:cpt-frontx-telemetry-state-connector-delivery-dispatch:p1:inst-waiting-to-closed
      state = 'CLOSED';
      // @cpt-end:cpt-frontx-telemetry-state-connector-delivery-dispatch:p1:inst-waiting-to-closed
      // @cpt-end:cpt-frontx-telemetry-state-connector-delivery-dispatch:p1:inst-open-to-closed
    },
    dispatchRecord,
    // Each signal entry picks the matching handler; no entry picks the measurement handler.
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-dispatch-signal:p1:inst-pick-handler
    dispatchIdentityChange: (id) => dispatchSignal('onIdentityChange', id),
    dispatchConsentChange: (s) => dispatchSignal('onConsentChange', s),
    dispatchFlush: () => dispatchSignal('onFlush'),
    dispatchShutdown: () => dispatchSignal('onShutdown'),
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-dispatch-signal:p1:inst-pick-handler
    requestFlush,
  };
}
