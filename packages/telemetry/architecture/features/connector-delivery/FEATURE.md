---
description: Feature specification of the telemetry state fixed at construction, the collector switch, the consent gate's pass-through stage, connector dispatch with its isolation and page-lifecycle flush, the accepts-reports value, the destroy additions, and the development-only record inspector.
---

# Feature: Connector Delivery And Telemetry States

- [x] `p1` - **ID**: `cpt-frontx-telemetry-featstatus-connector-delivery`

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Connect An Analytics Backend](#connect-an-analytics-backend)
  - [Expose Whether The Shell Accepts Reports](#expose-whether-the-shell-accepts-reports)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Telemetry State Derivation](#telemetry-state-derivation)
  - [Client Start By Telemetry State](#client-start-by-telemetry-state)
  - [Record Hand-Off After Enrichment](#record-hand-off-after-enrichment)
  - [Consent Gate Pass-Through Stage](#consent-gate-pass-through-stage)
  - [Record Dispatch](#record-dispatch)
  - [Signal Dispatch](#signal-dispatch)
  - [Isolated Handler Call](#isolated-handler-call)
  - [Page-Lifecycle Flush](#page-lifecycle-flush)
  - [Client Destroy Additions](#client-destroy-additions)
  - [Development Visibility](#development-visibility)
- [4. States (CDSL)](#4-states-cdsl)
  - [Telemetry State Machine](#telemetry-state-machine)
  - [Connector Dispatch State Machine](#connector-dispatch-state-machine)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Telemetry State Fixed At Construction](#telemetry-state-fixed-at-construction)
  - [Accepts-Reports Value](#accepts-reports-value)
  - [Silent Start Without A Connector](#silent-start-without-a-connector)
  - [Record Hand-Off And The Collector Switch](#record-hand-off-and-the-collector-switch)
  - [Consent Gate Pass-Through Stage](#consent-gate-pass-through-stage-1)
  - [Isolated, Ordered Dispatch](#isolated-ordered-dispatch)
  - [Records Made Inside A Connector Handler](#records-made-inside-a-connector-handler)
  - [Connector Signals](#connector-signals)
  - [Flush On Page Hide And On Request](#flush-on-page-hide-and-on-request)
  - [Destroy Additions](#destroy-additions)
  - [Two Builds Of The Main Entry](#two-builds-of-the-main-entry)
  - [Records Visible In Development](#records-visible-in-development)
  - [A Shell Event Reaches A Connector](#a-shell-event-reaches-a-connector)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

## 1. Feature Context

The feature-entry identifier the kit's template places here is deliberately absent. That identifier kind is owned by a DECOMPOSITION, and a layer member owns no DECOMPOSITION, so declaring one here would be a reference with no definition. `cpt-frontx-telemetry-featstatus-connector-delivery` above carries this feature's identity instead.

### 1.1 Overview

Covers how an enriched record reaches the connectors an application supplies. A connector is an object the application writes for its own analytics backend; the package only calls its handlers. This feature fixes the client's telemetry state when the client is built, decides whether the shipped collector is on, and derives the accepts-reports value that tells microfrontends whether the shell records what they send. It builds the consent gate's stage before dispatch as a pass-through: it makes one frozen copy of each record and passes it on at once. It specifies connector dispatch: the one place that calls connectors, keeps each call isolated so a failure stays inside the package, and asks connectors to flush when the page is hidden or closed. It also adds the connector steps to client start and destroy, and the development-only inspector that shows every record in the console.

A few terms used throughout:
- A frozen copy is one deep copy of a record, nested data included, locked against change.
- The development build and the production build are the package's two builds of its main entry. Which one runs is a build-kind constant that the package's own build sets in each of them; it is not read from the consumer's environment. Every check of the kind of build in this feature reads that constant, and unit tests run the client under both values.
- A development notice is a console message that only the development build shows.
- Handler names, and the shapes of what each handler receives, are left to the code under the connector contract, `cpt-frontx-telemetry-interface-connector`. This feature names handlers by what they receive: a record, an identity change, a consent change, a flush request or a shutdown request.

Out of scope, and touched only where a step meets them:
- The consent gate's rules: the one consent state, the hold, identity, the start-time consent pass, and dropping what the gate holds at destroy. They belong to the consent feature, which is stacked on this one, replaces the pass-through step with its rules, and attaches at one named point in start and one in destroy. The two are released together, so connectors never receive records without a consent check.
- The microfrontend reporter and receiver. Dispatch offers a flush-request entry that any component can call; the receiver will be one caller.
- Flows, dialogs and key actions.
- Error capture, including its window listeners, which destroy removes at the step this feature names.
- Measurements. Nothing calls a connector's handler for a measurement.
- How a hook failure is contained on the new recording surfaces. That belongs to the declared-events feature.

### 1.2 Purpose

Realizes the connector, telemetry-state and development-visibility requirements, and the dispatch half of the sequence `cpt-frontx-telemetry-seq-connector-delivery-under-consent`. The shipped collector path stays as it is. The shipped delivery-suppression mode (`cpt-frontx-telemetry-fr-delivery-disable`) stays outside the three telemetry states. The shipped single-use lifecycle (`cpt-frontx-telemetry-fr-client-lifecycle`) gains steps in start and after its own teardown, and one change to shipped behaviour: when no teardown hook threw, a failed final send's error is now held until the connector steps have run. For `cpt-frontx-telemetry-nfr-unused-cost`, this feature carries the client's part: a production build with no inspector code, and the accepts-reports value a microfrontend's reporter needs in order to stay silent.

**Requirements**: `cpt-frontx-telemetry-fr-connectors`, `cpt-frontx-telemetry-fr-connector-mapping`, `cpt-frontx-telemetry-fr-telemetry-states`, `cpt-frontx-telemetry-fr-dev-visibility`, `cpt-frontx-telemetry-nfr-connector-isolation`, `cpt-frontx-telemetry-nfr-non-blocking-emission`, `cpt-frontx-telemetry-nfr-unused-cost`

**Principles**: `cpt-frontx-telemetry-principle-shell-owns-application-state`, `cpt-frontx-telemetry-principle-recording-never-fails-caller`

**Components**: `cpt-frontx-telemetry-component-client`, `cpt-frontx-telemetry-component-events-manager`, `cpt-frontx-telemetry-component-connector-dispatch`, `cpt-frontx-telemetry-component-consent-gate` (only its stage before dispatch, built here as a pass-through), `cpt-frontx-telemetry-component-dev-inspector`

**Interfaces**: `cpt-frontx-telemetry-interface-connector`, `cpt-frontx-telemetry-interface-declared-capture-surface`

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| `cpt-frontx-telemetry-actor-application-developer` | Writes connectors, supplies them when creating the client, chooses the collector switch, and reads records in the console or through the record list while developing |
| `cpt-frontx-telemetry-actor-shell` | Owns the only client, its connectors and its telemetry state, and sets the accepts-reports signal for microfrontends from the client's value |
| `cpt-frontx-telemetry-actor-analytics-backend` | Receives records only through a connector; the package never names it or calls it |
| `cpt-frontx-telemetry-actor-collector` | Receives batches as shipped while the collector is on |
| `cpt-frontx-telemetry-actor-end-user` | Hiding or closing the page triggers the last flush; their consent choice is applied by the consent feature, released together with this one |
| `cpt-frontx-telemetry-actor-microfrontend` | Learns from the accepts-reports signal whether the shell records what it sends; its reporter is out of scope here |

### 1.4 References

- **PRD**: [PRD.md](../../PRD.md)
- **Design**: [DESIGN.md](../../DESIGN.md)
- **ADR**: [ADR/0001-declared-capture-connector-delivery.md](../../ADR/0001-declared-capture-connector-delivery.md)
- **Dependencies**: The event-collection feature: this feature adds steps to its client start, its client teardown and its record path, and changes one shipped teardown step, named where it happens. The declared-events feature: its typed record call is one of the recording surfaces whose records this feature delivers, and its contained enrichment is the enrichment step on the new surfaces. The consent feature: stacked on this one, it replaces the pass-through step and attaches at the named points in start and destroy; the two are released together. Sibling features are named rather than cited by identifier, because the identifier kind that would name a feature belongs to a DECOMPOSITION.

## 2. Actor Flows (CDSL)

**Use cases**: `cpt-frontx-telemetry-usecase-connect-backend`

### Connect An Analytics Backend

- [x] `p1` - **ID**: `cpt-frontx-telemetry-flow-connector-delivery-connect-backend`

**Actor**: `cpt-frontx-telemetry-actor-application-developer`

**Realizes**: `cpt-frontx-telemetry-seq-connector-delivery-under-consent`

**Success Scenarios**:
- With no application connector and the collector switched off, the developer runs a development build and sees each record in the console, with a notice that no connector is configured; a production build captures nothing.
- With connectors supplied, every record reaches every connector, in order, as one frozen copy.
- When the page is hidden or closed, every connector is asked to flush inside the page event. On destroy, every connector is asked to flush and then to shut down.

**Error Scenarios**:
- A connector throws on every call: the error is caught, the application sees nothing, and every other connector still gets every record.
- A connector returns a promise that rejects: the rejection is handled and never awaited, so nothing waits on it and nothing reaches the application.
- A connector handler records an event synchronously: that record is dropped before enrichment, and a development build shows a notice.
- A connector has no handler for a signal: it is skipped for that signal only.
- A record's data cannot be copied, for example because it holds a function: the record reaches no connector, the failure goes to the shipped logger, and the caller sees nothing.
- The application turns the collector on beside its connectors: both receive records, and a development build shows a notice saying so.
- A connector handler calls destroy: the connectors after it do not receive that record, and destroy runs as usual.
- A teardown hook throws during destroy: every connector is still flushed and shut down and the listeners are still removed, and then the hook's error reaches the caller.
- Anything reaches dispatch before start or after destroy: it is dropped silently.

**Steps**:
1. [x] - `p1` - Developer writes zero or more connectors from the backend's own documentation, each with only the handlers it needs - `inst-write-connectors`
2. [x] - `p1` - Developer creates the client, supplying the connectors in order and, optionally, the collector switch - `inst-create-client`
3. [x] - `p1` - System builds connector dispatch with the connectors in the order supplied, and fixes the telemetry state, the collector switch and the accepts-reports value, using `cpt-frontx-telemetry-algo-connector-delivery-derive-state` - `inst-fix-state`
4. [x] - `p1` - Developer starts the client; system runs `cpt-frontx-telemetry-algo-connector-delivery-start` - `inst-start-client`
5. [x] - `p1` - **IF** the client has no application connector and the collector switched off - `inst-check-no-connector-setup`
   1. [x] - `p1` - **IF** the build is the development build - `inst-check-dev-no-connector`
      1. [x] - `p1` - System shows each enriched record in the console and the no-connector notice; nothing is sent - `inst-show-records-and-notice`
   2. [x] - `p1` - **ELSE** - `inst-prod-no-connector`
      1. [x] - `p1` - System captures, stores and sends nothing, and recording calls return at once - `inst-capture-nothing`
6. [x] - `p1` - **ELSE** - `inst-connector-setup`
   1. [x] - `p1` - **IF** the collector is on beside application connectors - `inst-check-collector-beside`
      1. [x] - `p1` - System keeps the shipped collector path working beside the connectors, and a development build shows a notice that both are active - `inst-collector-beside-connectors`
   2. [x] - `p1` - Developer records an event on any recording surface - `inst-record-event`
   3. [x] - `p1` - System builds, enriches and hands the record on, using `cpt-frontx-telemetry-algo-connector-delivery-record-handoff`; the consent gate's stage passes one frozen copy to dispatch, using `cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through`, and dispatch calls every connector's handler for a record, using `cpt-frontx-telemetry-algo-connector-delivery-dispatch-record` - `inst-deliver-record`
   4. [x] - `p1` - End user hides or closes the page; system asks every connector to flush inside that page event, using `cpt-frontx-telemetry-algo-connector-delivery-page-flush` - `inst-flush-on-page-hide`
7. [x] - `p1` - Developer destroys the client; after the shipped teardown, system runs `cpt-frontx-telemetry-algo-connector-delivery-destroy` - `inst-destroy-client`
8. [x] - `p1` - **RETURN** a client that delivered through the application's connectors, or captured nothing in production without one, with nothing in the package naming a backend - `inst-return-connected`

### Expose Whether The Shell Accepts Reports

- [x] `p1` - **ID**: `cpt-frontx-telemetry-flow-connector-delivery-accepts-reports`

**Actor**: `cpt-frontx-telemetry-actor-shell`

**Success Scenarios**:
- The shell creates its client and reads the accepts-reports value once. A microfrontend's reporter then sends while the value is true and stays silent while it is false.

**Error Scenarios**:
- The shell wants a different value later, for example after adding a connector: the value cannot change, so the shell must build a new client.

**Steps**:
1. [x] - `p1` - Shell creates its client at boot, with or without connectors - `inst-shell-creates-client`
2. [x] - `p1` - System derives the accepts-reports value at construction, using `cpt-frontx-telemetry-algo-connector-delivery-derive-state`; construction needs no browser, so a client built without `window` still has a value - `inst-derive-at-construction`
3. [x] - `p1` - Shell reads the value through the client's accepts-reports call - `inst-read-accepts-reports`
4. [x] - `p1` - **RETURN** a value that stays the same for the client's whole life - `inst-return-fixed-value`

The shell then sets, from that value, the accepts-reports signal that microfrontends read, and a shell with no telemetry creates no client and sets the signal to false. Both are template wiring, outside this package.

## 3. Processes / Business Logic (CDSL)

### Telemetry State Derivation

- [x] `p1` - **ID**: `cpt-frontx-telemetry-algo-connector-delivery-derive-state`

**Input**: The application connectors supplied at construction, the collector switch if the application set it, the shipped delivery flag, and the build-kind constant

**Output**: The telemetry state, whether the collector is on, and the accepts-reports value, all fixed for the client's life

**Steps**:
1. [x] - `p1` - Keep the application connectors in the order supplied; an empty list counts as no connector - `inst-keep-connectors`
2. [x] - `p1` - **IF** the application set the collector switch - `inst-check-switch-set`
   1. [x] - `p1` - Use the value it set - `inst-use-switch`
3. [x] - `p1` - **ELSE** - `inst-switch-not-set`
   1. [x] - `p1` - Turn the collector on only when no application connector is supplied, so a shipped client, which supplies none, keeps it on - `inst-default-switch`
4. [x] - `p1` - **IF** no application connector is supplied and the collector is off - `inst-case-without`
   1. [x] - `p1` - Fix the state without a connector - `inst-set-without`
5. [x] - `p1` - **ELSE IF** no application connector is supplied, the collector is on, and the delivery flag is off - `inst-case-suppressed`
   1. [x] - `p1` - Fix the shipped delivery-suppression mode, which is outside the three telemetry states: plugins register, records are enriched, the queue drains, and nothing is posted - `inst-set-suppressed`
6. [x] - `p1` - **ELSE** - `inst-case-with`
   1. [x] - `p1` - Fix the state with a connector. This covers every client with an application connector, whatever the collector switch and the delivery flag; with application connectors, the delivery flag silences only the collector - `inst-set-with`
7. [x] - `p1` - **IF** the collector is on and at least one application connector is supplied - `inst-check-both-active`
   1. [x] - `p1` - Note the collector-beside-connectors notice, which a development build shows at start - `inst-note-both-active`
8. [x] - `p1` - Derive accepts reports: true in the state with a connector, in the delivery-suppression mode, and whenever the build-kind constant is development; false otherwise - `inst-derive-accepts-reports`
9. [x] - `p1` - **RETURN** the state, the collector switch and the accepts-reports value; no later call changes them - `inst-return-derived`

### Client Start By Telemetry State

- [x] `p1` - **ID**: `cpt-frontx-telemetry-algo-connector-delivery-start`

**Input**: A client being started, its telemetry state, and the build-kind constant

**Output**: A started client with dispatch open and the page-lifecycle listeners installed; in a production build without a connector, a started client that captures nothing

**Consent attach point**: the consent feature makes its start-time pass of the effective consent state between `inst-open-dispatch` and `inst-install-page-listeners`. This feature adds nothing there.

**Steps**:
1. [x] - `p1` - Run the shipped start guards and mark the client STARTED, as in steps `inst-guard-window` to `inst-set-started` of `cpt-frontx-telemetry-algo-event-collection-start`; a missing `window`, a second start and a start after destroy are refused there, as shipped - `inst-shipped-start-guards`
2. [x] - `p1` - **IF** the build is the production build and the client is in the state without a connector - `inst-check-silent-start`
   1. [x] - `p1` - **RETURN** the client without opening dispatch, registering or setting up any plugin, installing any listener, refreshing the session, writing to browser storage or calling the start hooks - `inst-return-silent-start`
3. [x] - `p1` - **IF** the build is the development build - `inst-check-dev-notices`
   1. [x] - `p1` - Have the dev inspector show the notice for the state: the no-connector notice in the state without a connector, the collector-beside-connectors notice where one was noted, and no notice in the delivery-suppression mode - `inst-show-state-notice`
4. [x] - `p1` - Open dispatch, so records and signals reach connectors from here on, including the records the shipped start steps make - `inst-open-dispatch`
5. [x] - `p1` - Install the page-lifecycle listeners, one for the page becoming hidden and one for pagehide, each running `cpt-frontx-telemetry-algo-connector-delivery-page-flush`. They go in before the shipped start steps, so a start hook that throws still leaves connectors flushed on page close - `inst-install-page-listeners`
6. [x] - `p1` - Run the remaining shipped start steps, `inst-register-builtins` to `inst-call-start-hooks`, checking after each one as step 6.1 says - `inst-shipped-start-steps`
   1. [x] - `p1` - **IF** a connector handler destroyed the client during one of those steps, **RETURN** the client at once, running no further start step or start hook, so nothing set up during start outlives the teardown; a start hook error raised before that point is still rethrown - `inst-stop-if-destroyed`
7. [x] - `p1` - **RETURN** the client for chaining - `inst-return-started-client`

### Record Hand-Off After Enrichment

- [x] `p1` - **ID**: `cpt-frontx-telemetry-algo-connector-delivery-record-handoff`

**Input**: A record call on any recording surface: the shipped `logEvent`, a plugin's event logger, or a surface this design adds; plus the telemetry state, the collector switch, the build-kind constant, the dispatch state and the handler depth

**Output**: An enriched record queued for the collector where the collector is on, handed toward connectors once dispatch is open, and in a development build shown by the inspector; or no record at all

**Steps**:
1. [x] - `p1` - **IF** the build is the production build and the client is in the state without a connector - `inst-check-without-connector`
   1. [x] - `p1` - **RETURN** at once, before building a record, so nothing is enriched, queued, handed on or stored - `inst-return-at-once`
2. [x] - `p1` - Build the record and apply the shipped teardown check, as in steps `inst-normalize-params` to `inst-return-dropped` of `cpt-frontx-telemetry-algo-event-collection-record-build` - `inst-shipped-build-steps`
3. [x] - `p1` - **IF** the handler depth is above zero, because the record is being made synchronously inside a connector handler - `inst-check-in-handler`
   1. [x] - `p1` - Raise a development notice that a record made inside a connector handler was dropped - `inst-notice-in-handler`
   2. [x] - `p1` - **RETURN** the record without enriching, queueing or handing it on, so a handler cannot start a loop through record, gate and dispatch. A record a handler makes after an `await`, or in a later callback, is not inside the handler and goes on as usual - `inst-return-in-handler`
4. [x] - `p1` - **IF** the record came from a surface this design adds - `inst-check-new-surface`
   1. [x] - `p1` - Enrich it using `cpt-frontx-telemetry-algo-declared-events-contained-enrichment`, which keeps a hook's failure from the caller - `inst-enrich-contained`
5. [x] - `p1` - **ELSE** - `inst-shipped-surface`
   1. [x] - `p1` - Enrich it as in the shipped step `inst-call-event-hook`. A hook's error is rethrown to the caller there, before any step below, so the record goes no further, as shipped - `inst-enrich-as-shipped`
6. [x] - `p1` - Recheck teardown once, as in the shipped step `inst-recheck-closed`, which drops the record if a hook tore the client down - `inst-recheck-teardown`
7. [x] - `p1` - **TRY** the steps this feature adds, on every recording surface, the shipped `logEvent` included - `inst-try-handoff`
   1. [x] - `p1` - **IF** the collector is on - `inst-check-collector-on-record`
      1. [x] - `p1` - Queue the record and schedule the drain as in the shipped steps `inst-enqueue` and `inst-schedule-drain`; the shipped delivery flag still decides only whether the drain posts - `inst-queue-for-collector`
   2. [x] - `p1` - **ELSE** - `inst-collector-off`
      1. [x] - `p1` - Leave the queue untouched, so nothing is queued, drained or posted, whether or not connectors exist - `inst-skip-collector`
   3. [x] - `p1` - **IF** dispatch is open - `inst-check-dispatch-open`
      1. [x] - `p1` - Hand the record to the consent gate's stage, using `cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through` - `inst-hand-toward-connectors`
   4. [x] - `p1` - **ELSE** - `inst-dispatch-not-open`
      1. [x] - `p1` - Leave connectors out: the client has not started yet, so the record is queued for the collector as shipped and does not go toward connectors - `inst-skip-connectors-before-start`
   5. [x] - `p1` - **IF** the build is the development build - `inst-check-dev-build-record`
      1. [x] - `p1` - Hand the record to the dev inspector, whatever the telemetry state - `inst-hand-to-inspector`
8. [x] - `p1` - **CATCH** a failure in those steps - `inst-catch-handoff`
   1. [x] - `p1` - Report it through the shipped logger, which prints only when verbose logging is on; nothing reaches the caller - `inst-report-handoff-failure`
9. [x] - `p1` - **RETURN** the record, as shipped - `inst-return-handed-off`

### Consent Gate Pass-Through Stage

- [x] `p1` - **ID**: `cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through`

This is the stage of `cpt-frontx-telemetry-component-consent-gate` that sits before dispatch, built here without consent rules. The consent feature, stacked on this one, replaces step `inst-pass-at-once` with its consent rules. The two are released together, so connectors never receive records without a consent check.

**Input**: One enriched record handed toward connectors by the record hand-off

**Output**: One frozen copy passed to dispatch; or nothing, where no connector has a handler for a record or the copy fails

**Steps**:
1. [x] - `p1` - **IF** no connector has a handler for a record, **RETURN** nothing without copying, since no connector would receive it. The connectors are fixed at construction, so this is worked out once - `inst-skip-without-record-handlers`
2. [x] - `p1` - **TRY** make one deep copy of the record, nested data included - `inst-deep-copy`
   1. [x] - `p1` - Freeze the copy deeply, every nested object included, so no connector can change what another connector or the collector receives; the record the collector queue holds is the original, untouched - `inst-deep-freeze`
3. [x] - `p1` - **CATCH** a copy failure, for example data holding a function - `inst-catch-copy-failure`
   1. [x] - `p1` - Report it through the shipped logger; the record does not reach connectors, and nothing reaches the caller - `inst-report-copy-failure`
   2. [x] - `p1` - **RETURN** nothing - `inst-return-copy-failed`
4. [x] - `p1` - Pass the frozen copy to dispatch at once, using `cpt-frontx-telemetry-algo-connector-delivery-dispatch-record` - `inst-pass-at-once`
5. [x] - `p1` - **RETURN** nothing; the stage keeps no reference to the record or the copy - `inst-return-passed`

### Record Dispatch

- [x] `p1` - **ID**: `cpt-frontx-telemetry-algo-connector-delivery-dispatch-record`

**Input**: One frozen copy of a record, passed by the consent gate's stage

**Output**: Every connector with a handler for a record called once with that same copy, until dispatch closes; nothing held afterwards

**Steps**:
1. [x] - `p1` - **FOR EACH** connector, in the order supplied at construction - `inst-each-connector-record`
   1. [x] - `p1` - **IF** dispatch is not open, because the client has not started, has been destroyed, or was destroyed from an earlier connector's handler - `inst-check-open-record`
      1. [x] - `p1` - **RETURN** without calling this or any later connector, silently - `inst-stop-record`
   2. [x] - `p1` - **IF** the connector has no handler for a record, skip it - `inst-skip-no-record-handler`
   3. [x] - `p1` - Call its handler with the same frozen copy, using `cpt-frontx-telemetry-algo-connector-delivery-isolated-call` - `inst-call-record-handler`
2. [x] - `p1` - **RETURN** nothing; dispatch keeps no reference to the copy, and it takes the next record only after every call for this one has returned, so records reach each connector in the order they reach the shell's client - `inst-return-record-dispatched`

### Signal Dispatch

- [x] `p1` - **ID**: `cpt-frontx-telemetry-algo-connector-delivery-dispatch-signal`

**Input**: One signal: an identity change, set or cleared, or a consent change, which the consent feature passes; or a flush or shutdown request from this feature

**Output**: Every connector with the matching handler called once with the signal, until dispatch closes

**Steps**:
1. [x] - `p1` - Pick the handler that matches the signal: identity change, consent change, flush or shutdown. The handler for a measurement is never picked, because nothing records a measurement yet - `inst-pick-handler`
2. [x] - `p1` - **FOR EACH** connector, in the order supplied at construction - `inst-each-connector-signal`
   1. [x] - `p1` - **IF** dispatch is not open - `inst-check-open-signal`
      1. [x] - `p1` - **RETURN** without calling this or any later connector, silently - `inst-stop-signal`
   2. [x] - `p1` - **IF** the connector has no matching handler, skip it for this signal only - `inst-skip-no-signal-handler`
   3. [x] - `p1` - Call the matching handler with the signal's content, using `cpt-frontx-telemetry-algo-connector-delivery-isolated-call` - `inst-call-signal-handler`
3. [x] - `p1` - **RETURN** nothing - `inst-return-signal-dispatched`

### Isolated Handler Call

- [x] `p1` - **ID**: `cpt-frontx-telemetry-algo-connector-delivery-isolated-call`

**Input**: One connector handler and the value it receives

**Output**: Nothing; whatever the handler does stays inside dispatch

**Steps**:
1. [x] - `p1` - Raise the handler depth by one. The handler depth counts the connector handler calls now running on the stack, nested calls included, and is kept apart from whether dispatch is open or closed - `inst-raise-depth`
2. [x] - `p1` - **TRY** call the handler synchronously with the value - `inst-try-handler`
   1. [x] - `p1` - **IF** it returns a promise, attach a rejection handler that discards the rejection, and do not await the promise - `inst-attach-rejection-handler`
3. [x] - `p1` - **CATCH** a thrown value - `inst-catch-handler-throw`
   1. [x] - `p1` - Discard it: it reaches neither the application nor the next connector - `inst-discard-throw`
4. [x] - `p1` - Lower the handler depth by one, whether the call returned or threw - `inst-lower-depth`
5. [x] - `p1` - **RETURN** nothing, so dispatch moves on whatever this handler did. Only what the handler does synchronously counts as inside it - `inst-return-isolated`

### Page-Lifecycle Flush

- [x] `p1` - **ID**: `cpt-frontx-telemetry-algo-connector-delivery-page-flush`

**Input**: One trigger: the page's visibility changing, pagehide, or a flush request that any component makes through dispatch's flush-request entry

**Output**: One flush request to every connector with a flush handler, made synchronously

**Steps**:
1. [x] - `p1` - **IF** the trigger is a visibility change - `inst-check-visibility-trigger`
   1. [x] - `p1` - **IF** the page is not hidden - `inst-check-page-hidden`
      1. [x] - `p1` - **RETURN** without a flush - `inst-return-page-visible`
   2. [x] - `p1` - Request a flush using `cpt-frontx-telemetry-algo-connector-delivery-dispatch-signal`, synchronously inside the event's handler, so a connector can still start a request before the handler returns - `inst-flush-on-hidden`
2. [x] - `p1` - **ELSE IF** the trigger is pagehide - `inst-check-pagehide-trigger`
   1. [x] - `p1` - Request a flush in the same way, synchronously inside the event's handler - `inst-flush-on-pagehide`
3. [x] - `p1` - **ELSE** the trigger is a flush request from a component - `inst-check-request-trigger`
   1. [x] - `p1` - Request a flush in the same way. Any component can make this call; the microfrontend receiver will make it after a payload it handles while the page is hidden - `inst-flush-on-request`
4. [x] - `p1` - **RETURN** nothing. No shutdown request follows a page close, so this flush may be a connector's last call; the shipped forced collector drain on the page becoming hidden is separate and unchanged - `inst-return-page-flush`

### Client Destroy Additions

- [x] `p1` - **ID**: `cpt-frontx-telemetry-algo-connector-delivery-destroy`

**Input**: A client whose shipped teardown has run up to and including the events-manager teardown, holding any error a teardown hook or the final send threw

**Output**: Every connector flushed and then shut down, dispatch closed, and the new listeners removed; then any held error reaches the caller

**Change to shipped behaviour**: this feature changes the shipped step `inst-teardown-events-last` of `cpt-frontx-telemetry-algo-event-collection-destroy`. Today, when no teardown hook threw, a failed final send throws at once. With this feature, that error is held until the steps below have run, and is then thrown. The design allows this, because teardown goes on and the caller still gets the error.

**Consent attach point**: the consent feature drops the gate's held records and held identity between `inst-close-dispatch` and `inst-remove-page-listeners`. This feature adds nothing there.

**Steps**:
1. [x] - `p1` - Run after the shipped events-manager teardown, whether or not a teardown hook or the final send threw. The shipped guards for a missing `window` and a repeated destroy return before this point, so these steps run at most once - `inst-attach-after-shipped-teardown`
2. [x] - `p1` - Request a flush from every connector with a flush handler, using `cpt-frontx-telemetry-algo-connector-delivery-dispatch-signal`; if the client never started, dispatch is not open and no connector is called - `inst-destroy-flush`
3. [x] - `p1` - Then request a shutdown from every connector with a shutdown handler, in the same way - `inst-destroy-shutdown`
4. [x] - `p1` - Close dispatch. Closing is allowed while a connector handler runs: when destroy was called from inside a handler, the dispatch loop that called it stops before its next connector - `inst-close-dispatch`
5. [x] - `p1` - Remove the page-lifecycle listeners installed at start. Error capture removes its window listeners at this step too, as its own feature specifies - `inst-remove-page-listeners`
6. [x] - `p1` - **IF** a teardown hook threw - `inst-check-held-hook-error`
   1. [x] - `p1` - Let the hook's error reach the caller now, after these steps - `inst-hook-error-reaches-caller`
7. [x] - `p1` - **ELSE IF** the final send threw - `inst-check-held-send-error`
   1. [x] - `p1` - Let that error, held under the change above, reach the caller now - `inst-send-error-reaches-caller`
8. [x] - `p1` - **RETURN** control; the client stays DESTROYED, and dispatch drops everything it is given, silently - `inst-return-torn-down`

### Development Visibility

- [x] `p1` - **ID**: `cpt-frontx-telemetry-algo-connector-delivery-dev-inspector`

**Input**: An enriched record, a development notice, or a call to the record list

**Output**: Console entries and a bounded list of records in the development build; an empty record list in the production build

**Steps**:
1. [x] - `p1` - Select the build through the package's `development` export condition, the name a bundler matches in the package's export map: a bundler that resolves it gets the development build, and every other resolver gets the production build. The package's own build sets the build-kind constant in each: development in the first, production in the second. Only the development build has the dev inspector and the development notices - `inst-select-build`
2. [x] - `p1` - **IF** the build-kind constant is production - `inst-check-production-build`
   1. [x] - `p1` - **RETURN** an empty list from the record-list call and show nothing; the typed surface is the same as in the development build - `inst-return-empty-list`
3. [x] - `p1` - On each enriched record, show one grouped console entry for it, a collapsible group per record, in every telemetry state and mode - `inst-show-grouped-record`
4. [x] - `p1` - Add the record to the record list - `inst-keep-record`
5. [x] - `p1` - **IF** the list now holds more than 1000 records - `inst-check-list-bound`
   1. [x] - `p1` - Drop the oldest record - `inst-drop-oldest-record`
6. [x] - `p1` - On a development notice, show it in the console. The notices are: no connector configured, collector beside connectors, a record made inside a connector handler, a hook that threw during enrichment, and the receiver's notices - `inst-show-notice`
7. [x] - `p1` - **RETURN** the records held, oldest first, from the record-list call - `inst-return-record-list`

## 4. States (CDSL)

### Telemetry State Machine

- [x] `p1` - **ID**: `cpt-frontx-telemetry-state-connector-delivery-telemetry-state`

The requirement names three states: no telemetry, without a connector, and with a connector. No telemetry means the shell creates no client, so it is not a state of this machine. The shipped delivery-suppression mode sits outside the three states and is shown here as its own state.

**States**: UNRESOLVED, WITHOUT_CONNECTOR, WITH_CONNECTOR, DELIVERY_SUPPRESSED

**Initial State**: UNRESOLVED

**Transitions**:
1. [x] - `p1` - **FROM** UNRESOLVED **TO** WITHOUT_CONNECTOR **WHEN** the client is built with no application connector and the collector switched off; accepts reports is false under the production build-kind value and true under the development value - `inst-unresolved-to-without`
2. [x] - `p1` - **FROM** UNRESOLVED **TO** DELIVERY_SUPPRESSED **WHEN** the client is built with no application connector, the collector on and the delivery flag off; accepts reports is true - `inst-unresolved-to-suppressed`
3. [x] - `p1` - **FROM** UNRESOLVED **TO** WITH_CONNECTOR **WHEN** the client is built with at least one application connector, or with the collector on and the delivery flag on; accepts reports is true - `inst-unresolved-to-with`
4. [x] - `p1` - **FROM** WITHOUT_CONNECTOR **TO** WITHOUT_CONNECTOR **WHEN** start, a record or destroy happens; no operation changes the state after construction - `inst-without-stays`
5. [x] - `p1` - **FROM** DELIVERY_SUPPRESSED **TO** DELIVERY_SUPPRESSED **WHEN** start, a record or destroy happens; no operation changes the state after construction - `inst-suppressed-stays`
6. [x] - `p1` - **FROM** WITH_CONNECTOR **TO** WITH_CONNECTOR **WHEN** start, a record or destroy happens; no operation changes the state after construction - `inst-with-stays`

### Connector Dispatch State Machine

- [x] `p1` - **ID**: `cpt-frontx-telemetry-state-connector-delivery-dispatch`

The handler depth, a count of the connector handler calls running on the stack, is kept apart from these states. A record made while it is above zero is dropped before enrichment, with a development notice, in any state.

**States**: WAITING, OPEN, CLOSED

**Initial State**: WAITING

**Transitions**:
1. [x] - `p1` - **FROM** WAITING **TO** WAITING **WHEN** a record is made before start; it is queued for the collector as shipped and does not go toward connectors, and a signal that reaches dispatch is dropped silently - `inst-waiting-before-start`
2. [x] - `p1` - **FROM** WAITING **TO** OPEN **WHEN** start runs past the silent-start check - `inst-waiting-to-open`
3. [x] - `p1` - **FROM** WAITING **TO** CLOSED **WHEN** destroy runs on a client whose dispatch never opened; no connector is ever called - `inst-waiting-to-closed`
4. [x] - `p1` - **FROM** OPEN **TO** OPEN **WHEN** a record or a signal is dispatched; each connector call raises and then lowers the handler depth - `inst-open-dispatches`
5. [x] - `p1` - **FROM** OPEN **TO** CLOSED **WHEN** destroy has requested a flush and then a shutdown from every connector; this may happen while a handler runs, and the dispatch loop that was running stops before its next connector - `inst-open-to-closed`
6. [x] - `p1` - **FROM** CLOSED **TO** CLOSED **WHEN** a record or a signal reaches dispatch; it is dropped silently, and no connector is called - `inst-closed-drops-all`

## 5. Definitions of Done

### Telemetry State Fixed At Construction

- [x] `p1` - **ID**: `cpt-frontx-telemetry-dod-connector-delivery-telemetry-state`

The system **MUST** fix the telemetry state once, when the client is built, from three exclusive cases: no application connector with the collector off gives the state without a connector; no application connector with the collector on and the delivery flag off gives the shipped delivery-suppression mode, outside the three states; every other case gives the state with a connector. The collector switch **MUST** default to on only when no application connector is supplied, so a shipped client keeps delivering as before. When the collector and application connectors are both active, a development build **MUST** show a notice that says so. The state **MUST NOT** change after construction.

**Verification**: A unit test with the collector as the only connector and the delivery flag off asserts that records are enriched and drained, nothing is posted, accepts reports is true, and no notice is shown. A unit test under the development build-kind value with the collector switched on beside a connector asserts the collector-beside-connectors notice.

**Implements**:
- `cpt-frontx-telemetry-algo-connector-delivery-derive-state`
- `cpt-frontx-telemetry-state-connector-delivery-telemetry-state`

**Touches**:
- Entities: `TelemetryState`, `Connector`, `NormalizedConfiguration`

### Accepts-Reports Value

- [x] `p1` - **ID**: `cpt-frontx-telemetry-dod-connector-delivery-accepts-reports`

The client **MUST** expose one accepts-reports value, fixed at construction: true in the state with a connector, in the delivery-suppression mode, and whenever the build-kind constant is development, and false otherwise. Construction **MUST NOT** need a browser to derive it. The value is what the shell sets as the signal a microfrontend's reporter reads, so that the reporter sends nothing and prints nothing while its shell records nothing.

**Verification**: Unit tests build clients under both build-kind values and assert the value for each case: true with an application connector; true with the collector as the only connector and the delivery flag off; with no application connector and the collector switched off, false under the production value and true under the development value. They also assert that the value is the same after start and after destroy, and that a client built without `window` has one.

**Implements**:
- `cpt-frontx-telemetry-flow-connector-delivery-accepts-reports`
- `cpt-frontx-telemetry-algo-connector-delivery-derive-state`

**Constraints**: `cpt-frontx-telemetry-constraint-silent-without-telemetry`

**Touches**:
- Entities: `TelemetryState`

### Silent Start Without A Connector

- [x] `p1` - **ID**: `cpt-frontx-telemetry-dod-connector-delivery-silent-start`

In a production build in the state without a connector, start **MUST** open no dispatch, register and set up no plugin, install no listener, refresh no session, write nothing to browser storage and call no start hook, and every recording call **MUST** return at once, before a record is built. Nothing is captured, stored or sent, and no notice is shown. The shipped lifecycle rules still apply: the client is STARTED, a second start is refused, and destroy runs.

**Verification**: A unit test under the production build-kind value, with no application connector and the collector switched off, asserts that start adds no enrichment hook and no window or document listener, writes nothing to browser storage, and that a recording call builds no record and makes no request. The same test under the development value asserts that records are shown in the console with the no-connector notice.

**Implements**:
- `cpt-frontx-telemetry-algo-connector-delivery-start`
- `cpt-frontx-telemetry-algo-connector-delivery-record-handoff`

**Touches**:
- Entities: `TelemetryState`, `Record`, `Session`

### Record Hand-Off And The Collector Switch

- [x] `p1` - **ID**: `cpt-frontx-telemetry-dod-connector-delivery-record-handoff`

After enrichment, the events manager **MUST** hand every record toward connectors through the consent gate's stage once dispatch is open, and in a development build to the dev inspector. It **MUST** queue the record for the collector only while the collector is on; with the collector off, nothing is queued, drained or posted, whether or not connectors exist. With the collector on, the queue path **MUST** stay as shipped, and the shipped delivery flag **MUST** still decide only whether the drain posts. A record made before start **MUST** be queued for the collector as shipped and **MUST NOT** reach connectors. The steps this feature adds **MUST** be contained on every recording surface, the shipped `logEvent` included: a failure in them is reported through the shipped logger and never reaches the caller. The only failure that still reaches a `logEvent` caller is the shipped hook rethrow, which happens before these steps, so the record goes no further, as shipped.

**Verification**: Unit tests assert that a record made before start is queued for the collector and reaches no connector; that with the collector switched off no request is made; and that a failure forced in the dev inspector reaches neither a typed record's caller nor a `logEvent` caller.

**Implements**:
- `cpt-frontx-telemetry-flow-connector-delivery-connect-backend`
- `cpt-frontx-telemetry-algo-connector-delivery-record-handoff`
- `cpt-frontx-telemetry-state-connector-delivery-dispatch`

**Touches**:
- Entities: `Record`, `TelemetryState`

### Consent Gate Pass-Through Stage

- [x] `p1` - **ID**: `cpt-frontx-telemetry-dod-connector-delivery-gate-pass-through`

The consent gate's stage before dispatch **MUST** make one deep copy of each record handed toward connectors, freeze it deeply with nested data included, and pass that same copy to dispatch at once. Where no connector has a handler for a record, the stage **MUST** return without copying. The record the collector queue holds **MUST** stay the original. If the copy fails, the record **MUST NOT** reach connectors, the failure **MUST** go through the shipped logger, and nothing **MUST** reach the caller. This stage **MUST** be released only together with the consent feature, which replaces "pass at once" with its consent rules, so connectors never receive records without a consent check.

**Verification**: A unit test records an event whose data holds a function and asserts that no connector receives it, the logger reports the failure, and the caller sees no error.

**Implements**:
- `cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through`

**Touches**:
- Entities: `Record`, `Connector`

### Isolated, Ordered Dispatch

- [x] `p1` - **ID**: `cpt-frontx-telemetry-dod-connector-delivery-isolated-dispatch`

Connector dispatch **MUST** call each connector's handler for a record, for every record the consent gate's stage passes, synchronously and in the order the connectors were supplied, giving every connector the same frozen copy. Each call **MUST** be isolated: a thrown error is caught, and a returned promise gets a rejection handler and is never awaited. Dispatch **MUST** move on to the next connector whatever the previous one did, **MUST** check that it is open before each connector call, and **MUST NOT** hold a record after the calls for it return. The package **MUST NOT** batch, retry, transform or transport records for a connector, and **MUST NOT** name any analytics backend.

**Verification**: Unit tests with one connector that throws on every call and one that rejects on every call assert zero application errors and every record reaching the other connectors. The isolation test, working through the pass-through stage, has one connector try to change a record and its nested data, and asserts that the next connector receives it unchanged and that the collector's queued record is unchanged. A further test calls destroy from inside a connector's handler and asserts that the connectors after it do not receive that record.

**Implements**:
- `cpt-frontx-telemetry-algo-connector-delivery-dispatch-record`
- `cpt-frontx-telemetry-algo-connector-delivery-isolated-call`
- `cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through`
- `cpt-frontx-telemetry-state-connector-delivery-dispatch`

**Constraints**: `cpt-frontx-telemetry-constraint-no-backend-knowledge`

**Touches**:
- Entities: `Connector`, `Record`

### Records Made Inside A Connector Handler

- [x] `p1` - **ID**: `cpt-frontx-telemetry-dod-connector-delivery-reentrant-record`

While the handler depth is above zero, the events manager **MUST** drop any record made, before enriching it, and a development build **MUST** show a notice. Only records made synchronously inside a handler are dropped; one made after an `await` or in a later callback goes on as usual. The handler depth **MUST** be lowered when each call returns or throws, so a failing handler cannot leave every later record dropped. The connector documentation **MUST** say that handlers run on the caller's stack and should stay cheap, **MUST** warn against recording from a handler, including after an `await`, and **MUST** tell connector authors to catch their own requests, because an unhandled rejection becomes an error event.

**Verification**: Unit tests assert that a record made synchronously inside a handler is dropped with a notice under the development build-kind value, that a record made after an `await` in a handler is delivered, and that after a handler throws, the next record is delivered.

**Implements**:
- `cpt-frontx-telemetry-algo-connector-delivery-record-handoff`
- `cpt-frontx-telemetry-algo-connector-delivery-isolated-call`
- `cpt-frontx-telemetry-state-connector-delivery-dispatch`

**Touches**:
- Entities: `Record`

### Connector Signals

- [x] `p1` - **ID**: `cpt-frontx-telemetry-dod-connector-delivery-signals`

Dispatch **MUST** pass the identity changes, set or cleared, and the consent changes it is given, and its own flush and shutdown requests, to every connector that has the matching handler, isolated in the same way as records, and **MUST** skip a connector without that handler for that signal only. The handler for a measurement **MUST NOT** be called. Handler names and the shapes they receive are left to the code, under the connector contract.

**Verification**: A unit test with one connector that has every handler and one that has none asserts that each signal reaches the first once and that the second is skipped without error.

**Implements**:
- `cpt-frontx-telemetry-algo-connector-delivery-dispatch-signal`

**Constraints**: `cpt-frontx-telemetry-constraint-no-backend-knowledge`

**Touches**:
- Entities: `Connector`

### Flush On Page Hide And On Request

- [x] `p1` - **ID**: `cpt-frontx-telemetry-dod-connector-delivery-page-flush`

Dispatch **MUST** request a flush from every connector with a flush handler synchronously inside the handlers for the page becoming hidden and for pagehide, and **MUST NOT** follow it with a shutdown when the page closes. The page-lifecycle listeners **MUST** be installed before the shipped start steps. Dispatch **MUST** request a flush again whenever any component calls its flush-request entry. The connector documentation **MUST** say that this flush may be a connector's last call, and that anything sent then with `keepalive` or as a beacon shares the browser's 64 KiB allowance with every other such request from the page.

**Verification**: Unit tests assert that the page becoming hidden and pagehide each give every connector with a flush handler one flush request before the event handler returns, that a call to the flush-request entry gives every such connector another one, and that a start hook that throws still leaves the page-lifecycle listeners installed.

**Implements**:
- `cpt-frontx-telemetry-algo-connector-delivery-page-flush`
- `cpt-frontx-telemetry-algo-connector-delivery-start`

**Touches**:
- Entities: `Connector`

### Destroy Additions

- [x] `p1` - **ID**: `cpt-frontx-telemetry-dod-connector-delivery-destroy`

After the shipped teardown steps, destroy **MUST** request a flush and then a shutdown from every connector, then close dispatch, then remove the page-lifecycle listeners added at start, in that order, leaving the named point between closing dispatch and removing the listeners for the consent feature. These steps **MUST** run even when a teardown hook threw, and the hook's error **MUST** reach the caller only after them. This feature **MUST** change the shipped step `inst-teardown-events-last` so that, when no hook threw, a failed final send's error is also held until these steps have run and is then thrown. After destroy, dispatch **MUST** drop every record and signal silently.

**Verification**: A unit test with a teardown hook that throws asserts that every connector got a flush and then a shutdown, no page-lifecycle listener is left, and destroy still throws the hook's error. A unit test with a final send that throws and no failing hook asserts the same connector calls, and that destroy throws the send's error afterwards.

**Implements**:
- `cpt-frontx-telemetry-flow-connector-delivery-connect-backend`
- `cpt-frontx-telemetry-algo-connector-delivery-destroy`
- `cpt-frontx-telemetry-state-connector-delivery-dispatch`

**Touches**:
- Entities: `Connector`

### Two Builds Of The Main Entry

- [x] `p1` - **ID**: `cpt-frontx-telemetry-dod-connector-delivery-dev-builds`

The main entry **MUST** be built twice: the `development` export condition resolves to a build with the dev inspector and the development notices, and the default condition resolves to a build without them. The package's own build **MUST** set the build-kind constant in each build, and every check of the kind of build **MUST** read that constant rather than the consumer's environment. Both builds **MUST** have the same typed surface, so the record-list call exists in the production build and returns an empty list. A production bundle **MUST** carry no inspector code.

**Verification**: A production bundle of a sample consumer contains no inspector code, and a development build of that consumer shows the no-connector notice. Unit tests run the client under both build-kind values.

**Implements**:
- `cpt-frontx-telemetry-algo-connector-delivery-dev-inspector`

**Touches**:
- Entities: `Record`

### Records Visible In Development

- [x] `p1` - **ID**: `cpt-frontx-telemetry-dod-connector-delivery-dev-inspector`

In the development build, the dev inspector **MUST** show each enriched record as one grouped console entry, in every telemetry state and mode, and **MUST** keep at most 1000 records for the record-list call, dropping the oldest first. In the state without a connector it **MUST** show a notice that no connector is configured, and it **MUST NOT** show that notice in the delivery-suppression mode. It **MUST NOT** send anything anywhere.

**Verification**: A unit test under the development build-kind value records 1001 events and asserts that the record list holds the latest 1000, oldest dropped first, and that each record produced one grouped console entry.

**Implements**:
- `cpt-frontx-telemetry-flow-connector-delivery-connect-backend`
- `cpt-frontx-telemetry-algo-connector-delivery-dev-inspector`
- `cpt-frontx-telemetry-algo-connector-delivery-start`

**Touches**:
- Entities: `Record`, `TelemetryState`

### A Shell Event Reaches A Connector

- [x] `p1` - **ID**: `cpt-frontx-telemetry-dod-connector-delivery-shell-to-connector`

A declared event recorded in the shell **MUST** reach a test connector. A second connector that throws **MUST NOT** disturb it. With no application connector and the collector switched off, which is the template's setup, the system **MUST NOT** send anything, and a development build **MUST** show the console notice that no connector is configured.

**Verification**: A unit test records a declared event in a client with a test connector and a connector that throws on every call, and asserts that the test connector received it and the application saw no error. A second test with no application connector and the collector switched off asserts that no request is made, and that under the development build-kind value the notice is shown.

**Implements**:
- `cpt-frontx-telemetry-flow-connector-delivery-connect-backend`
- `cpt-frontx-telemetry-algo-connector-delivery-record-handoff`
- `cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through`
- `cpt-frontx-telemetry-algo-connector-delivery-dispatch-record`

**Constraints**: `cpt-frontx-telemetry-constraint-no-backend-knowledge`

**Touches**:
- Entities: `Record`, `Connector`, `EventCatalog`

## 6. Acceptance Criteria

- [x] A client built without connectors keeps the collector on and delivers as shipped; a client built with connectors has the collector off unless the application turns it on.
- [x] With the collector on beside application connectors, both receive records, and a development build shows a notice saying both are active.
- [x] With the collector as the only connector and the delivery flag off, records are enriched and drained, nothing is posted, accepts reports is true, and no no-connector notice is shown.
- [x] In a production build with no application connector and the collector switched off, start registers no plugin, installs no listener and writes nothing to browser storage, and recording calls return at once.
- [x] Accepts reports is true with a connector, in the delivery-suppression mode and under the development build-kind value, and false otherwise; it never changes during the client's life.
- [x] With the collector off, no record is queued and no request reaches the collector, whether or not connectors exist.
- [x] A record made before start is queued for the collector as shipped and reaches no connector.
- [x] A failure in the hand-off steps this feature adds reaches no caller, on any recording surface.
- [x] Every connector receives every record the consent gate's stage passes, synchronously, with connectors called in the order they were supplied and records in the order they reach the shell's client.
- [x] Every connector receives the same deep-frozen copy; a connector that tries to change a record or its nested data changes neither what the next connector receives nor the collector's record.
- [x] A record whose data cannot be copied reaches no connector, is reported through the shipped logger, and causes no error for the caller.
- [x] A connector that throws on every call and one that rejects on every call cause no application error, and every record still reaches the other connectors.
- [x] A record made synchronously inside a connector handler is dropped, and a development build shows a notice; a record made after an `await` is delivered, and a handler that threw does not cause later records to be dropped.
- [x] Identity, consent, flush and shutdown signals reach only connectors with the matching handler; a connector without one is skipped for that signal.
- [x] When the page becomes hidden and on pagehide, every connector with a flush handler gets a flush request before the event handler returns, and no shutdown follows; the listeners stay installed even when a start hook throws.
- [x] A call to the flush-request entry from any component reaches every connector's flush handler.
- [x] Destroy delivers the collector queue as shipped, then flushes and shuts down every connector, closes dispatch and removes the page-lifecycle listeners, even when a teardown hook or the final send threw; that error reaches the caller afterwards.
- [x] A destroy called from inside a connector handler stops delivery of that record to the connectors after it, and no connector is called again after destroy.
- [x] A development build shows each enriched record as one grouped console entry and keeps the latest 1000 for tests, oldest dropped first.
- [x] A production bundle of a sample consumer contains no inspector code, and its record-list call returns an empty list.
- [x] A development build of that consumer with no application connector and the collector switched off shows the no-connector notice.
- [x] A declared event recorded in the shell reaches a test connector, and a second connector that throws does not disturb it.
- [x] Nothing in the published package names an analytics backend.
