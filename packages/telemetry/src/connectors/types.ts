import type { TelemetryRecord, TelemetryUserId } from '../utils/eventTypes';

/**
 * An object the application writes for its own analytics backend. The package only calls its
 * handlers; each handler is optional and a connector with no handler for a signal is skipped for
 * that signal only.
 *
 * Handlers run on the caller's stack and must stay cheap. Do not record from a handler, including
 * after an `await`. Catch your own requests: an unhandled rejection becomes an error event. A
 * record a handler receives is a frozen copy, the same one every connector gets.
 */
// @cpt-begin:cpt-frontx-telemetry-flow-connector-delivery-connect-backend:p1:inst-write-connectors
export type TelemetryConnector = {
  /** Called with each record that passes the consent gate. */
  onRecord?: (record: Readonly<TelemetryRecord>) => void | Promise<void>;
  /** Reserved: nothing calls it until performance measurement is designed. */
  onMeasurement?: (measurement: unknown) => void | Promise<void>;
  /** Called with the identity that was set, or `undefined` when it was cleared. */
  onIdentityChange?: (id: TelemetryUserId | undefined) => void | Promise<void>;
  /** Called with the effective consent state when it changes. */
  onConsentChange?: (state: unknown) => void | Promise<void>;
  /**
   * Called when the page becomes hidden, on pagehide, and at destroy, synchronously inside the
   * event's handler. The flush may be the connector's last call: no shutdown follows when the page
   * closes. Requests sent then with `keepalive` or as a beacon share the browser's 64 KiB
   * allowance for such requests in flight with every other one from the page. Handlers run on the
   * caller's stack and must stay cheap; do not record from here, including after an `await`; catch
   * your own requests.
   */
  onFlush?: () => void | Promise<void>;
  /** Called when the client is destroyed. */
  onShutdown?: () => void | Promise<void>;
};
// @cpt-end:cpt-frontx-telemetry-flow-connector-delivery-connect-backend:p1:inst-write-connectors
