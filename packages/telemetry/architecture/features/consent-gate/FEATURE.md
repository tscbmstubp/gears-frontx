---
description: Feature specification of the telemetry consent gate: the consent state and its two options, the effective state, the hold, identify and identity reset under consent, the start-time consent pass, the re-grant field removal, and the destroy drop.
---

# Feature: Consent Gate And Identity Under Consent

- [x] `p1` - **ID**: `cpt-frontx-telemetry-featstatus-consent-gate`

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Application Sets Consent](#application-sets-consent)
  - [Application Identifies And Resets The User](#application-identifies-and-resets-the-user)
  - [Connector Author Reads Consent And Identity Changes](#connector-author-reads-consent-and-identity-changes)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Effective Consent State](#effective-consent-state)
  - [Consent Rules Applied To A Frozen Copy](#consent-rules-applied-to-a-frozen-copy)
  - [Hold Add And Evict](#hold-add-and-evict)
  - [Gate Operation Queue](#gate-operation-queue)
  - [Consent Change](#consent-change)
  - [Identity Through The Gate](#identity-through-the-gate)
  - [Identity Reset](#identity-reset)
  - [Start-Time Consent Pass](#start-time-consent-pass)
  - [Destroy Drop](#destroy-drop)
  - [Re-Grant Field Removal](#re-grant-field-removal)
- [4. States (CDSL)](#4-states-cdsl)
  - [Consent State Machine](#consent-state-machine)
  - [Re-Grant Marker State Machine](#re-grant-marker-state-machine)
- [5. Definitions of Done](#5-definitions-of-done)
  - [No Delivery Before A Grant](#no-delivery-before-a-grant)
  - [A Grant Releases What Waited, In Order](#a-grant-releases-what-waited-in-order)
  - [Unset Counts As Granted](#unset-counts-as-granted)
  - [The Collector Is Unchanged](#the-collector-is-unchanged)
  - [The Hold Is Bounded](#the-hold-is-bounded)
  - [Holding Switched Off](#holding-switched-off)
  - [A Denial Drops What Waited](#a-denial-drops-what-waited)
  - [The Start Pass](#the-start-pass)
  - [The Start Pass Shows A Development Hint](#the-start-pass-shows-a-development-hint)
  - [Destroy During The Start Pass](#destroy-during-the-start-pass)
  - [Identity Reset](#identity-reset-1)
  - [The Re-Grant Rule](#the-re-grant-rule)
  - [An Identity Supplied Before Start Is Kept](#an-identity-supplied-before-start-is-kept)
  - [The Destroy Drop And The Closed Gate](#the-destroy-drop-and-the-closed-gate)
  - [The Same Effective State Passes Nothing](#the-same-effective-state-passes-nothing)
  - [The Consent Handler Receives A Typed State](#the-consent-handler-receives-a-typed-state)
  - [One Operation At A Time](#one-operation-at-a-time)
  - [The Queue Drain Is Capped](#the-queue-drain-is-capped)
  - [Invalid Input And Non-Blocking Calls](#invalid-input-and-non-blocking-calls)
  - [Nothing Is Copied For A Dropped Record](#nothing-is-copied-for-a-dropped-record)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

## 1. Feature Context

The feature-entry identifier the kit's template places here is deliberately absent. That identifier kind is owned by a DECOMPOSITION, and a layer member owns no DECOMPOSITION, so declaring one here would be a reference with no definition. `cpt-frontx-telemetry-featstatus-consent-gate` above carries this feature's identity instead.

### 1.1 Overview

Covers how the end user's consent decides what the application's connectors receive. A connector is an object the application writes for its own analytics backend. The application asks the user for consent, stores the answer and tells the client. The consent gate then lets records and the user's identity through, holds them, or drops them. This feature replaces the pass-through step of the connector-delivery feature with the consent rules, and adds the consent state, the two consent options, the hold, the identity reset and the start-time consent pass.

A few terms used throughout:
- The consent state is one value, `TelemetryConsentState`: `'unknown'`, `'granted'` or `'denied'`. It starts as unknown.
- The effective state is the set state, except that unknown counts as granted when the option `unsetCountsAsGranted` is on. Every rule below reads the effective state. With that option on, the gate has no unknown state and holds nothing.
- The hold is the gate's one first-in-first-out store of records that wait for an answer. A held identity is the identity the application supplied while consent was unknown, or a cleared identity that a reset left there. It waits beside the hold. A kept identity is the latest identity the application supplied before the client started.
- A frozen copy is the JSON-like deep copy of a record, locked against change, that the connector-delivery stage makes. Connector dispatch is the part that calls every connector's handlers.
- The user fields are the top-level record keys `context_user_id`, `context_user_distinct_id`, `context_user_email`, `context_user_username`, `context_user_first_name` and `context_user_last_name`. The key `context_user_data` is not one of them.
- A development notice is a console message that only the development build shows.

The consent options live under one configuration option, `consent`, with two optional settings:
- `unsetCountsAsGranted`, default `false`: an unknown state, whether it was never set or was set to unknown, counts as granted. It is on only when it is exactly `true`.
- `holdWhileUnknown`, default `true`: records made while the effective state is unknown wait in the hold. With `false`, they are dropped. It is off only when it is exactly `false`.

The client gains two methods, `setConsent(state)` and `resetIdentity()`. The shipped `identify(id)` keeps its name and behaviour and now also goes through the gate. A connector's consent handler, `onConsentChange(state: TelemetryConsentState)`, keeps its place in the connector contract; only the type of its argument narrows from `unknown`.

Out of scope, and touched only where a step meets them:
- The collector path. The gate applies only to connectors the application supplies. The shipped collector delivery is unchanged, including for an application that sets no consent.
- The microfrontend reporter and receiver. A microfrontend has no path to consent or identity. There is nothing to build for this now.
- Keeping identifiers in memory only, with no stored device id or session. That is a later reversal under the decision record, not part of this feature.
- Measurements. Nothing calls a connector's handler for a measurement.
- Persisting or asking for consent. The application does both.

### 1.2 Purpose

Realizes the consent and identity requirements, and the consent half of the sequence `cpt-frontx-telemetry-seq-connector-delivery-under-consent`. No connector may receive a record, or an identifier, that the user has not allowed. A user who has not answered yet loses nothing the application wants to keep: records wait, up to a bound, until the answer arrives.

This feature replaces the step `inst-pass-at-once` of `cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through` with its consent rules. It attaches at the start attach point, between `inst-open-dispatch` and `inst-install-page-listeners` of `cpt-frontx-telemetry-algo-connector-delivery-start`, and at the destroy attach point, between `inst-close-dispatch` and `inst-remove-page-listeners` of `cpt-frontx-telemetry-algo-connector-delivery-destroy`. It changes the connector-delivery feature in one place: that feature's pass-at-once step is replaced by the consent rules, and its copy step moves into them. The feature names the start and destroy points and leaves them to this one.

**Requirements**: `cpt-frontx-telemetry-fr-consent-gate`, `cpt-frontx-telemetry-fr-identity-consent`, `cpt-frontx-telemetry-nfr-non-blocking-emission`

**Principles**: `cpt-frontx-telemetry-principle-shell-owns-application-state`, `cpt-frontx-telemetry-principle-sdk-owned-identity`

**Components**: `cpt-frontx-telemetry-component-consent-gate`, `cpt-frontx-telemetry-component-client`, `cpt-frontx-telemetry-component-connector-dispatch`

**Interfaces**: `cpt-frontx-telemetry-interface-connector`

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| `cpt-frontx-telemetry-actor-application-developer` | Chooses the two consent options, tells the client the consent state, identifies and resets the user, and writes connectors that read consent and identity changes |
| `cpt-frontx-telemetry-actor-shell` | Owns the only client, so the only consent state and identity, for the whole application |
| `cpt-frontx-telemetry-actor-end-user` | Gives or refuses consent through the application's own consent screen; the gate acts on the answer the application passes on |
| `cpt-frontx-telemetry-actor-analytics-backend` | Receives records and identity only through a connector, and only while consent allows it |
| `cpt-frontx-telemetry-actor-microfrontend` | Has no path to consent or identity; its records reach connectors through the shell's client under the shell's consent |

### 1.4 References

- **PRD**: [PRD.md](../../PRD.md)
- **Design**: [DESIGN.md](../../DESIGN.md)
- **ADR**: [ADR/0001-declared-capture-connector-delivery.md](../../ADR/0001-declared-capture-connector-delivery.md)
- **Dependencies**: The connector-delivery feature: this feature replaces its pass-through step and attaches at its named points in start and destroy. Its frozen copy, its record dispatch and its signal dispatch are used as they are. The event-collection feature: `identify` keeps its shipped stamping through the user-info manager, which gains one clear operation here. Sibling features are named rather than cited by identifier, because the identifier kind that would name a feature belongs to a DECOMPOSITION.

## 2. Actor Flows (CDSL)

**Use cases**: `cpt-frontx-telemetry-usecase-connect-backend`

### Application Sets Consent

- [x] `p1` - **ID**: `cpt-frontx-telemetry-flow-consent-gate-set-consent`

**Actor**: `cpt-frontx-telemetry-actor-application-developer`

**Realizes**: `cpt-frontx-telemetry-seq-connector-delivery-under-consent`

**Success Scenarios**:
- The application creates the client with the default options. Records made before the user answers wait in the hold. When the application calls `setConsent('granted')`, connectors receive the consent change, the identity if one was held, and then the held records in the order they were made.
- The application calls `setConsent('denied')`. Connectors receive the consent change, the held records and the held identity are dropped, and later records are dropped.
- The application sets `unsetCountsAsGranted` on. Records and identity reach connectors at once and nothing is held.
- The application sets `holdWhileUnknown` off. Records made before an answer are dropped. A grant then passes the consent change and any held identity, but none of the records made before the answer.

**Error Scenarios**:
- The application sets a state that gives the same effective state again: nothing reaches any connector.
- The application calls `setConsent` after destroy, or from a connector's flush or shutdown handler while destroy runs: the call is ignored.
- The application calls `setConsent` with a value that is not one of the three states: nothing changes, nothing is passed, and the shipped logger reports an error.
- A connector handler calls `setConsent` while the gate is dispatching to it: the call waits and runs right after the running gate operation, so every connector sees the same order of consent changes.
- The application calls `setConsent` before start: the state is kept, and nothing reaches connectors until dispatch opens.

**Steps**:
1. [x] - `p1` - Developer creates the client, optionally supplying the `consent` option with `unsetCountsAsGranted` and `holdWhileUnknown` - `inst-set-create-client`
2. [x] - `p1` - System starts the gate with consent unknown and the two settings fixed, using `cpt-frontx-telemetry-algo-consent-gate-effective-state` for every later read - `inst-set-init-gate`
3. [x] - `p1` - Developer starts the client; system makes the start-time pass of the effective state, using `cpt-frontx-telemetry-algo-consent-gate-start-pass` - `inst-set-start-client`
4. [x] - `p1` - Application records events; system applies the consent rules to each frozen copy, using `cpt-frontx-telemetry-algo-consent-gate-apply-rules` - `inst-set-record-events`
5. [x] - `p1` - Application asks the end user and learns the answer, which the package neither asks for nor stores - `inst-set-ask-user`
6. [x] - `p1` - Application calls `setConsent(state)` with the answer; system runs it through `cpt-frontx-telemetry-algo-consent-gate-operation-queue`, which runs `cpt-frontx-telemetry-algo-consent-gate-consent-change` - `inst-set-call-set-consent`
7. [x] - `p1` - **RETURN** nothing awaitable; connectors that have a consent handler have received any change - `inst-set-return`

### Application Identifies And Resets The User

- [x] `p1` - **ID**: `cpt-frontx-telemetry-flow-consent-gate-identify-reset`

**Actor**: `cpt-frontx-telemetry-actor-application-developer`

**Realizes**: `cpt-frontx-telemetry-seq-connector-delivery-under-consent`

**Success Scenarios**:
- While consent is granted, `identify(id)` passes an identity change to connectors, and `resetIdentity()` passes a cleared identity change.
- While consent is unknown, `identify(id)` holds the identity, and a later call replaces the held one. `resetIdentity()` replaces any held identity with a held cleared identity, which a grant passes as a cleared identity change after the consent change.
- After a denial and a new grant, no record passed to connectors carries a user field until the application identifies the user again and the gate has passed that identity.

**Error Scenarios**:
- While consent is denied, `identify(id)` passes nothing and holds nothing. `resetIdentity()` passes nothing.
- A connector throws on the identity change: the error is caught by dispatch, as for any signal, and nothing reaches the application.
- A call after destroy: nothing is kept, held or passed.
- A call made from a connector handler while the gate is dispatching to it waits and runs right after the running gate operation.

**Steps**:
1. [x] - `p1` - Application calls `identify(id)`; the client stamps the identifier through the user-info manager as shipped - `inst-idr-identify-stamp`
2. [x] - `p1` - System runs `cpt-frontx-telemetry-algo-consent-gate-identity-through-gate` for that identifier, through `cpt-frontx-telemetry-algo-consent-gate-operation-queue`. The stamping is not queued; only the gate's rules are - `inst-idr-identify-gate`
3. [x] - `p1` - Application calls `resetIdentity()`; system runs `cpt-frontx-telemetry-algo-consent-gate-identity-reset` through `cpt-frontx-telemetry-algo-consent-gate-operation-queue` - `inst-idr-reset`
4. [x] - `p1` - **RETURN** the client from `identify`, as shipped, and nothing from `resetIdentity` that can be awaited - `inst-idr-return`

### Connector Author Reads Consent And Identity Changes

- [x] `p1` - **ID**: `cpt-frontx-telemetry-flow-consent-gate-connector-reads`

**Actor**: `cpt-frontx-telemetry-actor-application-developer`

**Realizes**: `cpt-frontx-telemetry-seq-connector-delivery-under-consent`

**Success Scenarios**:
- The connector's consent handler receives the effective state once at client start, then again on every change of the effective state, and always as one of the three values of `TelemetryConsentState`.
- The connector's identity handler receives an identity set or an identity cleared, only while consent is granted.
- A connector that has no consent handler or no identity handler is skipped for that signal only.

**Error Scenarios**:
- The connector's handler throws or returns a rejected promise: dispatch contains it, as for every signal, and the other connectors still receive the signal.

**Steps**:
1. [x] - `p1` - Connector author writes a consent handler that takes a `TelemetryConsentState` and an identity handler, each only if the backend needs it - `inst-cr-write-handlers`
2. [x] - `p1` - At client start, dispatch calls the consent handler with the effective state, using `cpt-frontx-telemetry-algo-consent-gate-start-pass` - `inst-cr-start-call`
3. [x] - `p1` - On a change of the effective state, dispatch calls the consent handler with the new effective state before any identity change or held record, using `cpt-frontx-telemetry-algo-consent-gate-consent-change` - `inst-cr-change-call`
4. [x] - `p1` - **IF** the new state is granted - `inst-cr-check-granted`
   1. [x] - `p1` - Connector learns that records may now be sent, so it may start its own sending after the consent change and the identity - `inst-cr-may-send`
5. [x] - `p1` - **ELSE IF** the new state is denied - `inst-cr-check-denied`
   1. [x] - `p1` - Connector learns that sending must stop; it clears whatever it holds for its backend, since the package cannot reach into it - `inst-cr-must-stop`
6. [x] - `p1` - **RETURN** nothing; a connector handler may call `setConsent`, `identify` and `resetIdentity`, and those calls are queued and run after the running gate step - `inst-cr-return`

## 3. Processes / Business Logic (CDSL)

### Effective Consent State

- [x] `p1` - **ID**: `cpt-frontx-telemetry-algo-consent-gate-effective-state`

**Input**: The set consent state and the setting `unsetCountsAsGranted`

**Output**: The effective state: `'granted'`, `'denied'` or `'unknown'`

**Steps**:
1. [x] - `p1` - **IF** the set state is granted or denied, **RETURN** it - `inst-eff-return-set`
2. [x] - `p1` - **IF** the set state is unknown and `unsetCountsAsGranted` is on, **RETURN** granted. This covers a state that was never set and a state that was set to unknown - `inst-eff-unset-granted`
3. [x] - `p1` - **RETURN** unknown - `inst-eff-return-unknown`

### Consent Rules Applied To A Frozen Copy

- [x] `p1` - **ID**: `cpt-frontx-telemetry-algo-consent-gate-apply-rules`

This replaces step `inst-pass-at-once` of `cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through`. The skip where no connector has a record handler stays as the first step there. The copy step of that algorithm, `inst-deep-copy` with its failure path, now runs inside this algorithm, only for a record that will be passed or held. The failure path is unchanged: the failure goes through the shipped logger and nothing reaches connectors.

**Input**: One enriched record handed toward connectors, after the skip step

**Output**: A frozen copy passed to dispatch, held, or nothing, with the record dropped; nothing returned

**Steps**:
1. [x] - `p1` - **IF** the gate is closed, **RETURN** nothing at once; nothing is copied, held or passed. The gate closes when the destroy drop runs, after dispatch closes, so a record a plugin's destroy hook logs during teardown is still handled by the rules below; dispatch itself drops anything after it closes - `inst-rules-check-closed`
2. [x] - `p1` - Read the effective state, using `cpt-frontx-telemetry-algo-consent-gate-effective-state` - `inst-rules-read-state`
3. [x] - `p1` - **IF** the effective state is denied, or unknown with `holdWhileUnknown` off - `inst-rules-check-drop`
   1. [x] - `p1` - Drop the record without copying or stripping it, so no copy failure is reported for a dropped record - `inst-rules-drop`
   2. [x] - `p1` - **RETURN** nothing - `inst-rules-return-dropped`
4. [x] - `p1` - Make the frozen copy, as `inst-deep-copy` of `cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through` says. **IF** the copy fails, take that algorithm's failure path and **RETURN** nothing - `inst-rules-copy`
5. [x] - `p1` - On receipt, remove the user fields from the copy where the re-grant marker is raised, using `cpt-frontx-telemetry-algo-consent-gate-regrant-removal`. This happens before the branches below, so a copy that is then held keeps that decision - `inst-rules-strip`
6. [x] - `p1` - **IF** the effective state is granted - `inst-rules-check-granted`
   1. [x] - `p1` - Pass the copy to dispatch at once, using `cpt-frontx-telemetry-algo-connector-delivery-dispatch-record` - `inst-rules-pass`
7. [x] - `p1` - **ELSE** the effective state is unknown with holding on - `inst-rules-check-hold`
   1. [x] - `p1` - Put the copy in the hold, using `cpt-frontx-telemetry-algo-consent-gate-hold` - `inst-rules-hold`
8. [x] - `p1` - **RETURN** nothing; the gate keeps no reference to a record it passed or dropped - `inst-rules-return`

### Hold Add And Evict

- [x] `p1` - **ID**: `cpt-frontx-telemetry-algo-consent-gate-hold`

**Input**: One frozen copy to hold

**Output**: The copy at the end of the hold; at most 1000 records held, the oldest evicted first

**Steps**:
1. [x] - `p1` - **IF** the hold already holds 1000 records - `inst-hold-check-full`
   1. [x] - `p1` - Drop the oldest held record - `inst-hold-evict-oldest`
   2. [x] - `p1` - **IF** the build is the development build and no such notice has been shown yet - `inst-hold-check-notice`
      1. [x] - `p1` - Show one development notice that the hold is full and the oldest records are being dropped - `inst-hold-notice`
2. [x] - `p1` - Add the copy at the end of the hold, so the hold keeps the order the records were made in - `inst-hold-add`
3. [x] - `p1` - **RETURN** nothing; the production build shows no notice - `inst-hold-return`

### Gate Operation Queue

- [x] `p1` - **ID**: `cpt-frontx-telemetry-algo-consent-gate-operation-queue`

The gate runs one operation at a time. Its operations are `setConsent`, `identify`, `resetIdentity`, applying the rules to a record and the start pass. A connector handler that the gate is dispatching to can call back into the client, for example `setConsent`. Such a call must not run in the middle of an operation, or connectors would see consent changes in different orders.

**Input**: A call to `setConsent`, `identify` or `resetIdentity`

**Output**: The call run now, or queued and run in arrival order right after the outermost gate operation ends; the first error any of them threw, rethrown to the outermost caller once the queue is empty

**Steps**:
1. [x] - `p1` - Run the part of the call that is not a gate rule at once: the shipped stamping of `identify` and the clearing of the stamp for `resetIdentity`. These do not reach connectors and are not queued - `inst-q-run-stamp`
2. [x] - `p1` - **IF** a gate operation is running - `inst-q-check-busy`
   1. [x] - `p1` - Add the call to the end of the queue and **RETURN** nothing - `inst-q-enqueue`
3. [x] - `p1` - Mark the gate busy and run the call's algorithm: `cpt-frontx-telemetry-algo-consent-gate-consent-change`, `cpt-frontx-telemetry-algo-consent-gate-identity-through-gate` or `cpt-frontx-telemetry-algo-consent-gate-identity-reset` - `inst-q-run`
4. [x] - `p1` - **FOR EACH** queued call, oldest first, including calls added while this loop runs - `inst-q-each-queued`
   1. [x] - `p1` - **IF** 100 queued calls have already run in this loop, drop the rest of the queue and stop - `inst-q-check-limit`
      1. [x] - `p1` - **IF** the development build has not shown this notice yet, show one development notice that connector handlers keep calling `setConsent`, `identify` or `resetIdentity` and the remaining queued calls were dropped - `inst-q-limit-notice`
   2. [x] - `p1` - Run it as step `inst-q-run` says. Each call checks the destroyed state first, so a call queued before destroy is ignored after it - `inst-q-run-queued`
5. [x] - `p1` - **IF** the running call or a queued call threw, remember the first error and go on, so a throw does not strand the queue and each later call still runs in arrival order - `inst-q-remember-throw`
6. [x] - `p1` - Mark the gate not busy, then rethrow the first remembered error if there is one, so the caller still sees it, and **RETURN** nothing - `inst-q-return`

Applying the rules to a record and the start pass mark the gate busy in the same way, so a `setConsent`, `identify` or `resetIdentity` call made from a handler during them is queued. They are not queued themselves. A handler the gate does not run, such as a flush or shutdown handler, calls in while the gate is not busy, so its call runs at once. The destroy drop is not marked busy: it runs once after dispatch closes, clears the queue and closes the gate, so nothing queued can run after it.

### Consent Change

- [x] `p1` - **ID**: `cpt-frontx-telemetry-algo-consent-gate-consent-change`

**Input**: A new consent state from `setConsent(state)`

**Output**: Connectors told of any change of the effective state, held records and identity released or dropped, as the new state requires

**Steps**:
1. [x] - `p1` - **IF** the client is destroyed, or the gate is closed, **RETURN** nothing; the call is ignored and nothing is kept, held or passed. Destroyed means the client's lifecycle, which is set the moment destroy begins, so a call from a flush or shutdown handler during teardown is ignored too - `inst-chg-check-destroyed`
2. [x] - `p1` - **IF** the value is not `'unknown'`, `'granted'` or `'denied'`, report an error through the shipped logger and **RETURN** nothing; nothing changes and nothing is passed - `inst-chg-check-valid`
3. [x] - `p1` - Note the effective state before the call, using `cpt-frontx-telemetry-algo-consent-gate-effective-state`, then update the set state - `inst-chg-update`
4. [x] - `p1` - Read the effective state again. **IF** it equals the earlier one, **RETURN** nothing; connectors receive nothing and the hold stays as it is - `inst-chg-check-same`
5. [x] - `p1` - Pass the new effective state to every connector at once, using `cpt-frontx-telemetry-algo-connector-delivery-dispatch-signal`. Before start, dispatch is WAITING, so no connector is called and the state is kept for the start pass - `inst-chg-pass-state`
6. [x] - `p1` - **IF** the effective state is now granted - `inst-chg-check-granted`
   1. [x] - `p1` - Take the held records and the held identity out of the gate, and clear both in the gate, before releasing any of them, so the release cannot pass an item twice whatever happens during it - `inst-chg-snapshot`
   2. [x] - `p1` - **IF** an identity was held, set or cleared, pass it as an identity change, using `cpt-frontx-telemetry-algo-consent-gate-identity-through-gate` - `inst-chg-release-identity`
   3. [x] - `p1` - **FOR EACH** held record taken out, in the order the records were made - `inst-chg-each-held`
      1. [x] - `p1` - **IF** the client was destroyed during this release, stop at once and pass no more - `inst-chg-stop-destroyed`
      2. [x] - `p1` - Pass the record to dispatch as it was held, using `cpt-frontx-telemetry-algo-connector-delivery-dispatch-record`. The re-grant decision was made when the gate received it, and is not made again - `inst-chg-pass-held`
7. [x] - `p1` - **ELSE IF** the effective state is now denied - `inst-chg-check-denied`
   1. [x] - `p1` - Drop the held records, the held identity and the kept identity, and raise the re-grant marker, using `cpt-frontx-telemetry-state-consent-gate-regrant-marker` - `inst-chg-drop-held`
8. [x] - `p1` - **RETURN** nothing. A `setConsent` call a handler made during this release was queued and runs now, so the release has finished first and every connector sees the consent changes in the same order - `inst-chg-return`

### Identity Through The Gate

- [x] `p1` - **ID**: `cpt-frontx-telemetry-algo-consent-gate-identity-through-gate`

**Input**: An identifier the application supplied through `identify(id)`, or a held identity, set or cleared, being released

**Output**: An identity change passed to connectors, held, kept for start, or dropped

**Steps**:
1. [x] - `p1` - The shipped stamping has already run through the user-info manager, which `identify` calls first. This algorithm adds only the gate's rules - `inst-idg-shipped-stamp`
2. [x] - `p1` - **IF** the client is destroyed, or the gate is closed, **RETURN** nothing; nothing is kept, held or passed - `inst-idg-check-closed`
3. [x] - `p1` - **IF** dispatch is WAITING, which means the client has not started and never means closed, keep the identifier as the latest kept identity, replacing any identity already kept, unless the effective state is denied, in which case drop it and keep nothing; then **RETURN** nothing. The start pass decides what happens to a kept identity - `inst-idg-keep-before-start`
4. [x] - `p1` - Read the effective state, using `cpt-frontx-telemetry-algo-consent-gate-effective-state` - `inst-idg-read-state`
5. [x] - `p1` - **IF** the effective state is granted - `inst-idg-check-granted`
   1. [x] - `p1` - Pass an identity change to dispatch, using `cpt-frontx-telemetry-algo-connector-delivery-dispatch-signal`: a set identity carrying the identifier, or a cleared one for a released cleared identity - `inst-idg-pass`
   2. [x] - `p1` - **IF** the identity change set an identity, lower the re-grant marker, since the application has supplied an identity again and the gate has passed it. Records the gate receives from now on keep their user fields. A cleared identity change does not lower it - `inst-idg-lower-marker`
6. [x] - `p1` - **ELSE IF** the effective state is unknown - `inst-idg-check-unknown`
   1. [x] - `p1` - Hold the identifier, replacing any identity already held, so only the latest identify waits - `inst-idg-hold`
7. [x] - `p1` - **ELSE** the effective state is denied - `inst-idg-check-denied`
   1. [x] - `p1` - Drop the identifier; nothing is held and nothing is passed - `inst-idg-drop`
8. [x] - `p1` - **RETURN** nothing - `inst-idg-return`

### Identity Reset

- [x] `p1` - **ID**: `cpt-frontx-telemetry-algo-consent-gate-identity-reset`

A reset follows the same rule as an identify with no identifier.

**Input**: A call to `resetIdentity()`

**Output**: The stamped identifier cleared; a cleared identity change passed, held, or dropped, as the effective state requires

**Steps**:
1. [x] - `p1` - Clear the identifier the shipped user-info path stamps. This needs a new clear operation on the user-info manager, which today only sets the identifier; the code names that function. After it, records no longer carry `context_user_id` from that path - `inst-rst-clear-stamp`
2. [x] - `p1` - **IF** the client is destroyed, or the gate is closed, **RETURN** nothing; nothing is kept, held or passed - `inst-rst-check-closed`
3. [x] - `p1` - **IF** dispatch is WAITING, which means the client has not started and never means closed, clear the kept identity and **RETURN** nothing. Connectors cannot have received a set identity before start, so nothing is passed for it at start - `inst-rst-before-start`
4. [x] - `p1` - Read the effective state, using `cpt-frontx-telemetry-algo-consent-gate-effective-state` - `inst-rst-read-state`
5. [x] - `p1` - **IF** the effective state is granted - `inst-rst-check-granted`
   1. [x] - `p1` - Pass a cleared identity change to dispatch, using `cpt-frontx-telemetry-algo-connector-delivery-dispatch-signal` - `inst-rst-pass-cleared`
6. [x] - `p1` - **ELSE IF** the effective state is unknown - `inst-rst-check-unknown`
   1. [x] - `p1` - Replace any held identity with a held cleared identity. A grant passes it in the identity slot, after the consent change and before the held records - `inst-rst-hold-cleared`
7. [x] - `p1` - **ELSE** the effective state is denied - `inst-rst-check-denied`
   1. [x] - `p1` - Drop it; nothing is held and nothing is passed - `inst-rst-nothing`
8. [x] - `p1` - **RETURN** nothing; a cleared identity change, passed or held, does not lower the re-grant marker, which only a passed set identity lowers - `inst-rst-return`

### Start-Time Consent Pass

- [x] `p1` - **ID**: `cpt-frontx-telemetry-algo-consent-gate-start-pass`

This runs at the start attach point of `cpt-frontx-telemetry-algo-connector-delivery-start`, between `inst-open-dispatch` and `inst-install-page-listeners`. A connector's consent handler runs inside it and may call `destroy()`, so the pass checks for that after each step that calls connectors. This is the rule `inst-stop-if-destroyed` of `cpt-frontx-telemetry-algo-connector-delivery-start` states for the shipped start steps.

**Input**: A client whose dispatch has just opened

**Output**: Every connector with a consent handler called once with the effective state, and any identity kept before start handled by that state; or nothing more, once the client is destroyed

**Steps**:
1. [x] - `p1` - **IF** the client is destroyed, or the gate is closed, **RETURN** nothing at once - `inst-sp-check-closed`
2. [x] - `p1` - Read the effective state, using `cpt-frontx-telemetry-algo-consent-gate-effective-state` - `inst-sp-read-state`
3. [x] - `p1` - **IF** at least one connector has a record handler and the effective state is not granted - `inst-sp-check-hint`
   1. [x] - `p1` - Show one development notice. With unknown and holding on, it says records for connectors wait in the hold, up to 1000, until `setConsent('granted')`, or that `consent.unsetCountsAsGranted` passes them at once. With unknown and holding off, or with denied, it says records for connectors are dropped until `setConsent('granted')` - `inst-sp-hint-notice`
4. [x] - `p1` - Pass it to every connector, using `cpt-frontx-telemetry-algo-connector-delivery-dispatch-signal`, even when it never changes later, so a connector learns the state it starts under - `inst-sp-pass`
5. [x] - `p1` - **IF** the client was destroyed during that pass, **RETURN** at once: pass no kept identity, and let start install no listener and run no start step - `inst-sp-check-destroyed-after-state`
6. [x] - `p1` - **IF** an identity was kept before start, handle it by the effective state read in step `inst-sp-read-state`, after the state has been passed - `inst-sp-check-kept`
   1. [x] - `p1` - **IF** the effective state is granted, pass it as an identity change, using `cpt-frontx-telemetry-algo-consent-gate-identity-through-gate`, which lowers the re-grant marker, and clear the kept identity - `inst-sp-kept-granted`
   2. [x] - `p1` - **ELSE IF** the effective state is unknown, leave it held as usual for a later grant - `inst-sp-kept-unknown`
   3. [x] - `p1` - **ELSE** the effective state is denied, drop it - `inst-sp-kept-denied`
7. [x] - `p1` - **IF** the client was destroyed during that handling, **RETURN** at once with the same effect as step `inst-sp-check-destroyed-after-state` - `inst-sp-check-destroyed-after-kept`
8. [x] - `p1` - **RETURN** nothing; start goes on to install the page-lifecycle listeners. Calls a handler made to `setConsent`, `identify` or `resetIdentity` during this pass were queued and run now - `inst-sp-return`

### Destroy Drop

- [x] `p1` - **ID**: `cpt-frontx-telemetry-algo-consent-gate-destroy-drop`

This runs at the destroy attach point of `cpt-frontx-telemetry-algo-connector-delivery-destroy`, between `inst-close-dispatch` and `inst-remove-page-listeners`.

**Input**: A client whose connectors have been flushed and shut down and whose dispatch has just closed

**Output**: An empty hold, no held or kept identity and no queued call; later calls ignored

**Steps**:
1. [x] - `p1` - Drop every held record, the held identity, the kept identity and every queued call. Nothing is passed to any connector - `inst-dd-drop-all`
2. [x] - `p1` - Mark the gate closed. This is a second guard beside the client's destroyed state, which every gate entry point checks first, so a later `setConsent`, `identify` or `resetIdentity` is ignored and nothing reaches dispatch. Dispatch's own CLOSED state never counts as "before start" in any step - `inst-dd-close`
3. [x] - `p1` - **RETURN** nothing; destroy goes on to remove the page-lifecycle listeners - `inst-dd-return`

### Re-Grant Field Removal

- [x] `p1` - **ID**: `cpt-frontx-telemetry-algo-consent-gate-regrant-removal`

The reason this exists: the shipped user-info path may still stamp the identifier it was given before a denial. A record made after the denial could then carry an identifier the user withdrew consent for, even if it waits in the hold and is released later. So the decision is made when the gate receives the copy, whether the copy is then passed, held or dropped. A held record keeps that decision when it is released. This means records held after a denial lose the user fields even when a new identity is passed first at the grant, because records held before that identity was supplied may still carry the earlier identifier.

**Input**: One frozen copy the gate has just made for a record it will pass or hold, and the re-grant marker

**Output**: The copy as it is, or a new frozen object without the user fields

**Steps**:
1. [x] - `p1` - **IF** the re-grant marker is not raised, **RETURN** the copy as it is - `inst-rg-check-marker`
2. [x] - `p1` - Make a new object from the copy's top-level keys, leaving out `context_user_id`, `context_user_distinct_id`, `context_user_email`, `context_user_username`, `context_user_first_name` and `context_user_last_name`. `context_user_data` stays - `inst-rg-build`
3. [x] - `p1` - Reuse the copy's nested values, which are already frozen, and freeze the new object, so one frozen object still goes to every connector - `inst-rg-freeze`
4. [x] - `p1` - **RETURN** the new object - `inst-rg-return`

## 4. States (CDSL)

### Consent State Machine

- [x] `p1` - **ID**: `cpt-frontx-telemetry-state-consent-gate-consent-state`

**States**: unknown, granted, denied

**Initial State**: unknown

The set state moves as `setConsent` says. The effective state is read from it: with `unsetCountsAsGranted` on, unknown reads as granted. A transition passes the new effective state to connectors only where the effective state changes.

**Transitions**:
1. [x] - `p1` - **FROM** unknown **TO** granted **WHEN** `setConsent('granted')` is called; connectors receive the consent change, then the held identity, set or cleared, then the held records in order - `inst-cs-unknown-granted`
2. [x] - `p1` - **FROM** unknown **TO** denied **WHEN** `setConsent('denied')` is called; connectors receive the consent change, and the held records and held identity are dropped - `inst-cs-unknown-denied`
3. [x] - `p1` - **FROM** granted **TO** denied **WHEN** `setConsent('denied')` is called; connectors receive the consent change - `inst-cs-granted-denied`
4. [x] - `p1` - **FROM** granted **TO** unknown **WHEN** `setConsent('unknown')` is called; with `unsetCountsAsGranted` off connectors receive the consent change, with it on nothing changes and nothing is passed - `inst-cs-granted-unknown`
5. [x] - `p1` - **FROM** denied **TO** granted **WHEN** `setConsent('granted')` is called; connectors receive the consent change, and the re-grant marker stays raised - `inst-cs-denied-granted`
6. [x] - `p1` - **FROM** denied **TO** unknown **WHEN** `setConsent('unknown')` is called; with `unsetCountsAsGranted` off connectors receive the consent change and holding begins, with it on this is a change to granted - `inst-cs-denied-unknown`
7. [x] - `p1` - **FROM** any state **TO** the same state **WHEN** `setConsent` is called with it; nothing is passed - `inst-cs-same-state`

### Re-Grant Marker State Machine

- [x] `p1` - **ID**: `cpt-frontx-telemetry-state-consent-gate-regrant-marker`

**States**: lowered, raised

**Initial State**: lowered

**Transitions**:
1. [x] - `p1` - **FROM** lowered **TO** raised **WHEN** the effective state changes to denied - `inst-rm-raise`
2. [x] - `p1` - **FROM** raised **TO** lowered **WHEN** the gate passes an identity change that sets an identity to dispatch; while raised, every record the gate receives loses the user fields at receipt, and records received after the lowering keep theirs - `inst-rm-lower`
3. [x] - `p1` - **FROM** raised **TO** raised **WHEN** a cleared identity change is passed or a grant happens without an identity; the marker stays raised - `inst-rm-stay`

## 5. Definitions of Done

Unit tests that need to see what a connector cannot, such as the hold's size, the held identity or the kept identity, are tests on the gate module itself. They read those values through an internal accessor that is not part of the public API.

### No Delivery Before A Grant

- [x] `p1` - **ID**: `cpt-frontx-telemetry-dod-consent-gate-no-delivery-before-grant`

While the effective state is unknown or denied, the gate **MUST NOT** pass any record or any identity change to a connector. This holds for every record kind, error events included. A record passes to dispatch at once only while the effective state is granted. The collector path **MUST** stay as it is.

**Verification**: Unit tests supply a test connector, leave consent unset, and record events, call `identify`, and record error events. They assert the connector receives no record and no identity. They set consent to denied and repeat, with the same result.

**Implements**:
- `cpt-frontx-telemetry-algo-consent-gate-apply-rules`
- `cpt-frontx-telemetry-algo-consent-gate-identity-through-gate`
- `cpt-frontx-telemetry-flow-consent-gate-set-consent`

**Touches**:
- Entities: `Record`, `Connector`, `TelemetryConsentState`

### A Grant Releases What Waited, In Order

- [x] `p1` - **ID**: `cpt-frontx-telemetry-dod-consent-gate-grant-releases-in-order`

On a change of the effective state to granted, the gate **MUST** pass the consent change first, then the held identity if there is one, then the held records in the order they were made. Records made after the grant **MUST** follow them.

**Verification**: A unit test records several events and calls `identify` while consent is unknown, then sets consent to granted. It asserts the test connector receives the records made before the answer, once each and in order, after the consent change and the identity, and that a later record follows them. A second identify before the grant is asserted to replace the first, so only the latest identity is passed.

**Implements**:
- `cpt-frontx-telemetry-algo-consent-gate-consent-change`
- `cpt-frontx-telemetry-algo-consent-gate-identity-through-gate`

**Touches**:
- Entities: `Record`, `Connector`

### Unset Counts As Granted

- [x] `p1` - **ID**: `cpt-frontx-telemetry-dod-consent-gate-unset-counts-as-granted`

With `unsetCountsAsGranted` on, the effective state **MUST** be granted whenever the set state is unknown, whether never set or set to unknown. Records and the identity **MUST** reach connectors at once and nothing **MUST** be held.

**Verification**: A unit test creates the client with the option on and sets no consent. It records events and calls `identify`, and asserts the test connector receives each record and the identity at once. A unit test on the gate module reads the hold size and the held identity through the internal accessor and asserts both are empty. With consent set to unknown, both tests assert that nothing is passed and nothing is held.

**Implements**:
- `cpt-frontx-telemetry-algo-consent-gate-effective-state`
- `cpt-frontx-telemetry-algo-consent-gate-apply-rules`

**Touches**:
- Entities: `TelemetryConsentState`, `Record`

### The Collector Is Unchanged

- [x] `p1` - **ID**: `cpt-frontx-telemetry-dod-consent-gate-collector-unchanged`

The gate **MUST** apply only to connectors the application supplies. An application that uses only the shipped collector and sets no consent **MUST** deliver as before.

**Verification**: A unit test builds a client with no connector, the shipped collector on and no consent option, records events, and asserts the collector queue and post are as shipped. A second test supplies a connector and turns the collector on, leaves consent unknown, and asserts the collector still receives every record while the connector receives none.

**Implements**:
- `cpt-frontx-telemetry-algo-consent-gate-apply-rules`

**Touches**:
- Entities: `Record`

### The Hold Is Bounded

- [x] `p1` - **ID**: `cpt-frontx-telemetry-dod-consent-gate-hold-bound`

The hold **MUST** keep at most 1000 records, first in first out. When it is full, adding a record **MUST** drop the oldest. In a development build, the first such drop **MUST** show one development notice, and no later drop shows another. The production build **MUST** show none.

**Verification**: A unit test records 1005 events while consent is unknown, then grants consent. It asserts the test connector receives the newest 1000 in order and that the first five are gone. A unit test on the gate module asserts the hold size never exceeds 1000. Under the development build it asserts one notice; under the production build it asserts none.

**Implements**:
- `cpt-frontx-telemetry-algo-consent-gate-hold`

**Touches**:
- Entities: `Record`

### Holding Switched Off

- [x] `p1` - **ID**: `cpt-frontx-telemetry-dod-consent-gate-holding-off`

With `holdWhileUnknown` off, a record made while the effective state is unknown **MUST** be dropped. The held identity does not depend on this option. A grant then passes the consent change and any held identity, but none of the records made before the answer.

**Verification**: A unit test sets the option off, records events and calls `identify` while consent is unknown, and grants consent. It asserts the test connector receives the consent change and then the identity, and none of those records, and receives records made after the grant.

**Implements**:
- `cpt-frontx-telemetry-algo-consent-gate-apply-rules`
- `cpt-frontx-telemetry-algo-consent-gate-identity-through-gate`

**Touches**:
- Entities: `Record`

### A Denial Drops What Waited

- [x] `p1` - **ID**: `cpt-frontx-telemetry-dod-consent-gate-denial-drops`

On a change of the effective state to denied, the gate **MUST** pass the consent change, then drop the held records and the held identity. A later grant **MUST NOT** pass any of them.

**Verification**: A unit test holds records and an identity while consent is unknown, sets denied, and asserts the test connector receives the consent change and nothing else. It then grants consent and asserts none of the earlier records or the earlier identity is passed.

**Implements**:
- `cpt-frontx-telemetry-algo-consent-gate-consent-change`
- `cpt-frontx-telemetry-state-consent-gate-consent-state`

**Touches**:
- Entities: `Record`, `Connector`

### The Start Pass

- [x] `p1` - **ID**: `cpt-frontx-telemetry-dod-consent-gate-start-pass`

At the start attach point, the gate **MUST** pass every connector with a consent handler the effective state once, even when it never changes.

**Verification**: Unit tests start clients with consent unset, with `unsetCountsAsGranted` on, and with consent set before start. They assert each test connector's consent handler is called once at start, with unknown, granted and the set state in turn, before the page listeners are installed, and that a connector without the handler is skipped.

**Implements**:
- `cpt-frontx-telemetry-algo-consent-gate-start-pass`

**Touches**:
- Entities: `Connector`, `TelemetryConsentState`

### The Start Pass Shows A Development Hint

- [x] `p1` - **ID**: `cpt-frontx-telemetry-dod-consent-gate-start-hint`

At the start pass, when at least one connector has a record handler and the effective state is not granted, the development build **MUST** show one notice that says what happens to records for connectors. With unknown and holding on, it says they wait in the hold, up to 1000, until `setConsent('granted')`, or that `consent.unsetCountsAsGranted` passes them at once. With unknown and holding off, or with denied, it says they are dropped until `setConsent('granted')`. It **MUST** show nothing when the state is granted or no connector has a record handler.

**Verification**: Unit tests on the gate module start a gate with a record handler under unknown with holding on, unknown with holding off and denied, and assert one notice each with the matching text. They assert no notice under granted, with `unsetCountsAsGranted` on, and with no record handler.

**Implements**:
- `cpt-frontx-telemetry-algo-consent-gate-start-pass`

**Touches**:
- Entities: `Connector`, `TelemetryConsentState`

### Destroy During The Start Pass

- [x] `p1` - **ID**: `cpt-frontx-telemetry-dod-consent-gate-destroy-during-start`

If a connector's consent handler destroys the client during the start pass, the gate **MUST** return at once after the state pass and again after the kept-identity handling: it **MUST NOT** pass a kept identity, install a listener or run a shipped start step. This is the same rule as `inst-stop-if-destroyed` of the connector-delivery start.

**Verification**: A unit test supplies a connector whose `onConsentChange` calls `destroy()`, with an identity kept before start. After `start()` it asserts that no `visibilitychange` or `pagehide` listener is installed, the connector received no identity, and no shipped start step ran. A second test destroys from a handler during the kept-identity pass and asserts the same.

**Implements**:
- `cpt-frontx-telemetry-algo-consent-gate-start-pass`

**Touches**:
- Entities: `Connector`

### Identity Reset

- [x] `p1` - **ID**: `cpt-frontx-telemetry-dod-consent-gate-reset-identity`

`resetIdentity()` **MUST** clear the identifier the shipped user-info path stamps, through a new clear operation on the user-info manager. It **MUST** then follow the identity rule like an identify with no identifier: while consent is granted, pass a cleared identity change; while unknown, replace any held identity with a held cleared identity, which a grant passes after the consent change and before the held records; while denied, drop it. A passed or held cleared identity **MUST NOT** lower the re-grant marker.

**Verification**: Unit tests identify the user, reset, and assert later records carry no `context_user_id`. They assert the test connector receives a cleared identity change under granted, and nothing under denied. A unit test identifies A under granted, sets unknown, calls `resetIdentity()`, then sets granted, and asserts the connector receives the consent change and then a cleared identity change, before any held record.

**Implements**:
- `cpt-frontx-telemetry-algo-consent-gate-identity-reset`
- `cpt-frontx-telemetry-flow-consent-gate-identify-reset`

**Touches**:
- Entities: `Record`, `Connector`

### The Re-Grant Rule

- [x] `p1` - **ID**: `cpt-frontx-telemetry-dod-consent-gate-regrant-removal`

After a denial, the gate **MUST** remove the six user fields, leaving `context_user_data`, from every record it receives and then passes or holds, until the application supplies an identity again and the gate has passed it. A held record **MUST** keep that decision when it is released. The result **MUST** be a new frozen object that reuses the copy's frozen nested values. Records received after the identity is passed **MUST** keep their user fields.

**Verification**: Unit tests use a plugin that adds all six user fields to every record, because the shipped path stamps only `context_user_id`. A first test identifies the user, denies, grants, and records an event. It asserts the connector's record has none of the six fields, keeps `context_user_data`, and is frozen. It then identifies again and asserts the identity change is passed and the next record carries the user fields. A second test runs this sequence: identify A under granted, deny, set unknown, record events that go into the hold, identify B, grant. It asserts the connector receives the consent change, then B, then the held records with none of the six user fields, and that records made after B was passed carry B. A third test, on the gate module, asserts that a nested object in the stripped record is the same reference as in the copy. A fourth test runs identify A, deny, grant, `resetIdentity()`, then records an event, and asserts the record still has none of the plugin-added user fields, so the reset did not lower the marker.

**Implements**:
- `cpt-frontx-telemetry-algo-consent-gate-regrant-removal`
- `cpt-frontx-telemetry-state-consent-gate-regrant-marker`

**Touches**:
- Entities: `Record`

### An Identity Supplied Before Start Is Kept

- [x] `p1` - **ID**: `cpt-frontx-telemetry-dod-consent-gate-identity-before-start`

Before dispatch opens, which means dispatch is WAITING, the gate **MUST** keep the latest identity unless the effective state is denied, which drops it, and a denial **MUST** also drop an identity already kept; and `resetIdentity()` before start **MUST** clear what it keeps. At the start pass, after passing the effective state, the gate **MUST** pass the kept identity at once if the state is granted, keep it held if unknown, and drop it if denied.

**Verification**: A unit test sets `unsetCountsAsGranted`, calls `identify` before start, and starts. It asserts the test connector receives the consent state and then the identity at start. Further tests assert that a second identify before start replaces the first, that a reset before start leaves nothing to pass, that an unknown state keeps the identity for a later grant, and that a denied state drops it. Two sequences end with no identity passed at start: identify, deny, grant, start; and deny, identify, grant, start. Unit tests on the gate module read the kept identity through the internal accessor.

**Implements**:
- `cpt-frontx-telemetry-algo-consent-gate-identity-through-gate`
- `cpt-frontx-telemetry-algo-consent-gate-identity-reset`
- `cpt-frontx-telemetry-algo-consent-gate-start-pass`

**Touches**:
- Entities: `Connector`, `TelemetryConsentState`

### The Destroy Drop And The Closed Gate

- [x] `p1` - **ID**: `cpt-frontx-telemetry-dod-consent-gate-destroy-drop`

Every gate entry point (`setConsent`, `identify`, `resetIdentity`, applying the rules and the start pass) **MUST** first check whether the client is destroyed, and if so return at once with nothing kept, held or passed. The client's destroyed state is set the moment `destroy()` begins. At the destroy attach point, the gate **MUST** drop its held records, held identity, kept identity and queued calls, and **MUST** mark itself closed as a second guard. Nothing **MUST** reach a connector after dispatch closes. Dispatch's closed state **MUST NOT** count as before start.

**Verification**: A unit test on the gate module holds records and an identity, destroys the client, and reads the hold size, the held identity and the kept identity through the internal accessor; all are empty. The connector received flush and shutdown and none of the held items. It then calls `setConsent('granted')` and asserts nothing reaches the connector. A test calls `identify()` after destroy and asserts, through the accessor, that nothing is kept. A test has a connector whose `onShutdown` calls `setConsent('granted')` with records held, and asserts nothing is released.

**Implements**:
- `cpt-frontx-telemetry-algo-consent-gate-destroy-drop`
- `cpt-frontx-telemetry-algo-consent-gate-consent-change`

**Touches**:
- Entities: `Record`, `Connector`

### The Same Effective State Passes Nothing

- [x] `p1` - **ID**: `cpt-frontx-telemetry-dod-consent-gate-same-state-passes-nothing`

Setting a state that leaves the effective state unchanged **MUST** pass nothing to any connector and leave the hold as it is. A call before start **MUST** keep the state and reach no connector until dispatch opens.

**Verification**: Unit tests call `setConsent('granted')` twice and assert one consent change. With `unsetCountsAsGranted` on, they call `setConsent('unknown')` and assert nothing is passed. They call `setConsent` before start and assert no connector is called until start, when the start pass gives the set state.

**Implements**:
- `cpt-frontx-telemetry-algo-consent-gate-consent-change`
- `cpt-frontx-telemetry-flow-consent-gate-set-consent`

**Touches**:
- Entities: `TelemetryConsentState`, `Connector`

### The Consent Handler Receives A Typed State

- [x] `p1` - **ID**: `cpt-frontx-telemetry-dod-consent-gate-typed-consent-change`

A connector's `onConsentChange` handler **MUST** receive a `TelemetryConsentState`, one of `'unknown'`, `'granted'` or `'denied'`, and its type **MUST** narrow from `unknown` to that value. Nothing else about the connector contract changes.

**Verification**: A type test assigns a handler typed with `TelemetryConsentState` to the connector contract and fails the build if it does not compile. A unit test asserts the values received at start and at each change are only those three strings.

**Implements**:
- `cpt-frontx-telemetry-flow-consent-gate-connector-reads`

**Touches**:
- Entities: `Connector`, `TelemetryConsentState`

### One Operation At A Time

- [x] `p1` - **ID**: `cpt-frontx-telemetry-dod-consent-gate-serialized-operations`

The gate **MUST** run one operation at a time. A `setConsent`, `identify` or `resetIdentity` call that arrives while a gate operation is running **MUST** be queued and run in arrival order right after the outermost operation ends. A grant's release **MUST** run to completion first, and every connector **MUST** see the same order of consent changes. The gate **MUST** take the held records and the held identity out of itself and clear them before releasing them, so no item is passed twice. A call from a handler the gate does not run, such as a flush or shutdown handler, **MUST NOT** be queued. A throw from an operation or from a queued call **MUST NOT** strand the queue: every queued call still runs in arrival order, the gate is left not busy, and the first error is rethrown to the outermost caller.

**Verification**: A unit test supplies connectors whose `onConsentChange` calls `setConsent('denied')` during a grant. It asserts every connector ends with granted and then denied in that order, and that no record made after the denial reaches a connector. A second test supplies a connector whose record handler calls `setConsent('denied')` during the release of held records. It asserts the release completes, then the denial applies, and no record or identity is passed twice. A third test throws inside an operation with calls queued behind it, and asserts the queued calls ran in order, the gate is not busy afterwards and the error reached the caller.

**Implements**:
- `cpt-frontx-telemetry-algo-consent-gate-operation-queue`
- `cpt-frontx-telemetry-algo-consent-gate-consent-change`

**Touches**:
- Entities: `Record`, `Connector`, `TelemetryConsentState`

### The Queue Drain Is Capped

- [x] `p1` - **ID**: `cpt-frontx-telemetry-dod-consent-gate-queue-drain-limit`

The outermost gate operation **MUST** run at most 100 queued calls. When that limit is reached, the gate **MUST** drop the rest of the queue and, in the development build, show one notice the first time this happens. A connector handler that calls `setConsent`, `identify` or `resetIdentity` on every change therefore cannot keep the gate running forever.

**Verification**: A unit test supplies a connector whose `onConsentChange` flips consent between granted and denied on every call. It asserts the first `setConsent` returns, one notice is shown, the queue is empty afterwards, and a later run shows no second notice.

**Implements**:
- `cpt-frontx-telemetry-algo-consent-gate-operation-queue`

**Touches**:
- Entities: `Connector`, `TelemetryConsentState`

### Invalid Input And Non-Blocking Calls

- [x] `p1` - **ID**: `cpt-frontx-telemetry-dod-consent-gate-input-validation`

`setConsent` with a value other than `'unknown'`, `'granted'` or `'denied'` **MUST** change nothing, pass nothing, and go to the shipped logger as an error. `setConsent`, `identify` and `resetIdentity` **MUST** never throw. `setConsent` and `resetIdentity` **MUST** return nothing awaitable, and `identify` **MUST** keep its shipped return value, the client, so calls can be chained. This DoD covers `cpt-frontx-telemetry-nfr-non-blocking-emission` for the new client methods.

**Verification**: Unit tests call `setConsent` with an invalid value and assert the state, the hold and the connectors are unchanged and the logger received one error. They call all three methods with connectors that throw and assert no call throws. They assert `setConsent` and `resetIdentity` return `undefined` and that `identify(id)` returns the client, with a chained call working.

**Implements**:
- `cpt-frontx-telemetry-algo-consent-gate-consent-change`
- `cpt-frontx-telemetry-flow-consent-gate-identify-reset`

**Touches**:
- Entities: `TelemetryConsentState`

### Nothing Is Copied For A Dropped Record

- [x] `p1` - **ID**: `cpt-frontx-telemetry-dod-consent-gate-drop-before-copy`

The gate **MUST** read the effective state before it copies a record. A record that will be dropped, because the state is denied or unknown with holding off, **MUST** be dropped without copying or stripping, so no copy failure is logged for it. The copy step of the connector-delivery stage runs only for a record that is passed or held.

**Verification**: A unit test records an event whose data holds a function, under denied and under unknown with holding off, and asserts the logger reports no copy failure. Under granted and under unknown with holding on, it asserts the failure is reported once and no connector receives the record.

**Implements**:
- `cpt-frontx-telemetry-algo-consent-gate-apply-rules`

**Touches**:
- Entities: `Record`

## 6. Acceptance Criteria

- [x] A test connector receives no record and no identity while consent is not granted.
- [x] Once consent is granted, the test connector receives the records made before the answer, in order, after the consent change and the identity.
- [x] With `unsetCountsAsGranted` on, the test connector receives records and the identity at once, and the gate holds nothing.
- [x] An application that uses only the shipped collector and sets no consent delivers as before.
- [x] The hold keeps at most 1000 records, drops the oldest first, and a development build shows one notice at the first drop.
- [x] With `holdWhileUnknown` off, records made while consent is unknown are dropped, and a grant passes the consent change and any held identity but none of those records.
- [x] A denial passes the consent change and drops the held records and the held identity.
- [x] At start, every connector receives the effective state once, and a development build hints at what happens to records when consent is not granted and a connector has a record handler.
- [x] A connector that destroys the client in its consent handler during start leaves no page listener, receives no identity, and no shipped start step runs.
- [x] `resetIdentity()` clears the stamped identifier and passes a cleared identity change under granted, holds a cleared identity under unknown for the grant, and drops it under denial.
- [x] After a denial, records the gate receives, passed or held, carry none of the six user fields until a new identity is passed; a held record keeps that decision on release, and records received after the new identity is passed carry it.
- [x] An identity supplied before start is kept and handled by the effective state at the start pass: passed after the consent state when granted, kept held when unknown, dropped when denied.
- [x] Every gate entry point ignores a call once the client is destroyed, destroy drops what the gate holds, and nothing reaches connectors after dispatch closes.
- [x] Setting the same effective state passes nothing.
- [x] `onConsentChange` receives a `TelemetryConsentState`.
- [x] A call made from a connector handler during a gate operation is queued, a grant's release completes before a denial from a handler applies, and no item is passed twice.
- [x] A throw inside a gate operation does not strand the queue, and a handler that calls back on every change cannot keep the gate running: the drain stops at 100 queued calls.
- [x] An invalid consent value is ignored and logged as an error, the three methods never throw, and `identify` still returns the client.
- [x] A record that is dropped for consent is not copied, so no copy failure is logged for it.
