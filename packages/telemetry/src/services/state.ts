import type { BuildKind } from '../build/kind';
import type { TelemetryConnector } from '../connectors/types';

// @cpt-dod:cpt-frontx-telemetry-dod-connector-delivery-telemetry-state:p1
// @cpt-dod:cpt-frontx-telemetry-dod-connector-delivery-accepts-reports:p1

export type TelemetryState = 'WITHOUT_CONNECTOR' | 'WITH_CONNECTOR' | 'DELIVERY_SUPPRESSED';

export type DeriveStateInput = {
  /** Application connectors, in the order supplied. */
  connectors?: readonly TelemetryConnector[];
  /** The collector switch, undefined when the application did not set it. */
  collector?: boolean;
  /** The shipped delivery flag (`enabled`). */
  deliveryEnabled: boolean;
  buildKind: BuildKind;
};

export type DerivedTelemetryState = {
  state: TelemetryState;
  collector: boolean;
  /** True when the collector is on while application connectors exist. */
  collectorBesideConnectors: boolean;
  acceptsReports: boolean;
};

// The state is fixed at construction: UNRESOLVED -> one of the three, and no operation moves it.
// @cpt-algo:cpt-frontx-telemetry-algo-connector-delivery-derive-state:p1
// @cpt-state:cpt-frontx-telemetry-state-connector-delivery-telemetry-state:p1
export function deriveTelemetryState(input: DeriveStateInput): DerivedTelemetryState {
  // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-derive-state:p1:inst-keep-connectors
  const hasConnector = (input.connectors?.length ?? 0) > 0;
  // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-derive-state:p1:inst-keep-connectors

  let collector: boolean;
  // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-derive-state:p1:inst-check-switch-set
  if (input.collector !== undefined) {
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-derive-state:p1:inst-use-switch
    collector = input.collector;
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-derive-state:p1:inst-use-switch
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-derive-state:p1:inst-check-switch-set
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-derive-state:p1:inst-switch-not-set
  } else {
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-derive-state:p1:inst-default-switch
    collector = !hasConnector;
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-derive-state:p1:inst-default-switch
  }
  // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-derive-state:p1:inst-switch-not-set

  let state: TelemetryState;
  // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-derive-state:p1:inst-case-without
  if (!hasConnector && !collector) {
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-derive-state:p1:inst-set-without
    // @cpt-begin:cpt-frontx-telemetry-state-connector-delivery-telemetry-state:p1:inst-unresolved-to-without
    // @cpt-begin:cpt-frontx-telemetry-state-connector-delivery-telemetry-state:p1:inst-without-stays
    state = 'WITHOUT_CONNECTOR';
    // @cpt-end:cpt-frontx-telemetry-state-connector-delivery-telemetry-state:p1:inst-without-stays
    // @cpt-end:cpt-frontx-telemetry-state-connector-delivery-telemetry-state:p1:inst-unresolved-to-without
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-derive-state:p1:inst-set-without
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-derive-state:p1:inst-case-without
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-derive-state:p1:inst-case-suppressed
  } else if (!hasConnector && collector && !input.deliveryEnabled) {
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-derive-state:p1:inst-set-suppressed
    // @cpt-begin:cpt-frontx-telemetry-state-connector-delivery-telemetry-state:p1:inst-unresolved-to-suppressed
    // @cpt-begin:cpt-frontx-telemetry-state-connector-delivery-telemetry-state:p1:inst-suppressed-stays
    state = 'DELIVERY_SUPPRESSED';
    // @cpt-end:cpt-frontx-telemetry-state-connector-delivery-telemetry-state:p1:inst-suppressed-stays
    // @cpt-end:cpt-frontx-telemetry-state-connector-delivery-telemetry-state:p1:inst-unresolved-to-suppressed
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-derive-state:p1:inst-set-suppressed
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-derive-state:p1:inst-case-suppressed
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-derive-state:p1:inst-case-with
  } else {
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-derive-state:p1:inst-set-with
    // @cpt-begin:cpt-frontx-telemetry-state-connector-delivery-telemetry-state:p1:inst-unresolved-to-with
    // @cpt-begin:cpt-frontx-telemetry-state-connector-delivery-telemetry-state:p1:inst-with-stays
    state = 'WITH_CONNECTOR';
    // @cpt-end:cpt-frontx-telemetry-state-connector-delivery-telemetry-state:p1:inst-with-stays
    // @cpt-end:cpt-frontx-telemetry-state-connector-delivery-telemetry-state:p1:inst-unresolved-to-with
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-derive-state:p1:inst-set-with
  }
  // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-derive-state:p1:inst-case-with

  let collectorBesideConnectors = false;
  // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-derive-state:p1:inst-check-both-active
  if (collector && hasConnector) {
    // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-derive-state:p1:inst-note-both-active
    // The flag is the note; start() shows the notice in a development build.
    collectorBesideConnectors = true;
    // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-derive-state:p1:inst-note-both-active
  }
  // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-derive-state:p1:inst-check-both-active

  // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-derive-state:p1:inst-derive-accepts-reports
  const acceptsReports =
    state === 'WITH_CONNECTOR' || state === 'DELIVERY_SUPPRESSED' || input.buildKind === 'development';
  // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-derive-state:p1:inst-derive-accepts-reports

  // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-derive-state:p1:inst-return-derived
  return { state, collector, collectorBesideConnectors, acceptsReports };
  // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-derive-state:p1:inst-return-derived
}
