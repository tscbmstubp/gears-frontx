---
description: Feature specification of the event catalog given as a type parameter, the namespace derived from it, the reserved namespaces a catalog refuses, the typed record call, and recording that never throws when a plugin fails on the surfaces this design adds.
---

# Feature: Declared Events And Namespaces

- [x] `p1` - **ID**: `cpt-frontx-telemetry-featstatus-declared-events`

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Declare And Record A Shell Event](#declare-and-record-a-shell-event)
  - [Declare A Microfrontend's Events](#declare-a-microfrontends-events)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Catalog Rules](#catalog-rules)
  - [Typed Record Call Check](#typed-record-call-check)
  - [Typed Record At Runtime](#typed-record-at-runtime)
  - [Contained Enrichment On The New Surfaces](#contained-enrichment-on-the-new-surfaces)
- [4. States (CDSL)](#4-states-cdsl)
  - [Hook Failure Reporting State Machine](#hook-failure-reporting-state-machine)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Catalog As A Type Parameter](#catalog-as-a-type-parameter)
  - [Namespace Derived From The Catalog](#namespace-derived-from-the-catalog)
  - [Reserved Namespaces Refused](#reserved-namespaces-refused)
  - [Typed Record Call](#typed-record-call)
  - [Contained Enrichment On The New Surfaces](#contained-enrichment-on-the-new-surfaces-1)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

## 1. Feature Context

The feature-entry identifier the kit's template places here is deliberately absent. That identifier kind is owned by a DECOMPOSITION, and a layer member owns no DECOMPOSITION, so declaring one here would be a reference with no definition. `cpt-frontx-telemetry-featstatus-declared-events` above carries this feature's identity instead.

### 1.1 Overview

Covers declared events: events an application lists in an event catalog, each with the shape of its data, which is a record of named values. The catalog is a type the application writes and gives to the client as a type parameter, so it exists only for the type checker and adds nothing at runtime. An event name is a list of segments separated by a dot. Its first segment is a namespace, the short name of the shell or the microfrontend that owns the event, and at least one more segment follows. This feature specifies the catalog's rules, the namespace option whose type comes from the catalog, the namespaces no catalog may use, and the typed record call that accepts only declared names and data. The package exports the catalog check as one type, which the client uses now and the microfrontend reporter will use later.

It also specifies how the surfaces this design adds keep a record going, and keep the caller safe, when a plugin fails while the record is being enriched. Such a failure is reported as a development notice, a console message that only the development build shows. Which build runs is a build-kind constant that the package's own build sets in each of its two builds, not the consumer's environment, and unit tests run the client under both values.

Out of scope, and touched only where a step meets them:
- The microfrontend reporter and receiver. Only the type-level rule for a microfrontend's catalog belongs here; the receiver's runtime checks of names and namespaces belong to its own feature.
- Flows, dialogs, key actions and error capture. They are recording surfaces this design adds, so the contained enrichment specified here applies to them, but their own recording belongs to their features.
- Where a record goes after enrichment: the collector queue, the consent gate's stage and connector dispatch. That belongs to the connector-delivery feature.
- The machine-readable event list, `cpt-frontx-telemetry-fr-event-inventory`, a p3 requirement the design has not yet covered.

### 1.2 Purpose

Realizes the declared-event and namespace requirements, and the recording-surface half of `cpt-frontx-telemetry-nfr-non-blocking-emission`. Declared events turn event names and data into a contract the type checker enforces, so a wrong name or a wrong shape fails the build instead of a report. The shipped untyped `logEvent` keeps working unchanged, including its rethrow of a hook's error, until the decision record retires free-form recording.

**Requirements**: `cpt-frontx-telemetry-fr-declared-events`, `cpt-frontx-telemetry-fr-event-namespace`, `cpt-frontx-telemetry-nfr-non-blocking-emission`

**Principles**: `cpt-frontx-telemetry-principle-recording-never-fails-caller`, `cpt-frontx-telemetry-principle-sdk-owned-identity`

**Components**: `cpt-frontx-telemetry-component-client`, `cpt-frontx-telemetry-component-events-manager`, `cpt-frontx-telemetry-component-dev-inspector`

**Interfaces**: `cpt-frontx-telemetry-interface-declared-capture-surface`

### 1.3 Actors

| Actor | Role in Feature |
|-------|-----------------|
| `cpt-frontx-telemetry-actor-application-developer` | Writes the shell's catalog and a microfrontend's catalog, sets the shell's namespace option, and records declared events through the typed record call |
| `cpt-frontx-telemetry-actor-microfrontend` | Declares one namespace; every name in its catalog starts with it |
| `cpt-frontx-telemetry-actor-product-analyst` | Reads event names in the backend and can tell from the first segment whose event it is |

### 1.4 References

- **PRD**: [PRD.md](../../PRD.md)
- **Design**: [DESIGN.md](../../DESIGN.md)
- **ADR**: [ADR/0001-declared-capture-connector-delivery.md](../../ADR/0001-declared-capture-connector-delivery.md)
- **Dependencies**: The event-collection feature: the typed record call builds its record through that feature's record path, and contained enrichment changes only how a hook's failure is handled on the new surfaces. The connector-delivery feature: its record hand-off runs contained enrichment and decides where an enriched record goes next. Sibling features are named rather than cited by identifier, because the identifier kind that would name a feature belongs to a DECOMPOSITION.

## 2. Actor Flows (CDSL)

**Use cases**: `cpt-frontx-telemetry-usecase-instrument-application`

### Declare And Record A Shell Event

- [x] `p1` - **ID**: `cpt-frontx-telemetry-flow-declared-events-shell-events`

**Actor**: `cpt-frontx-telemetry-actor-application-developer`

**Realizes**: `cpt-frontx-telemetry-seq-connector-delivery-under-consent`

**Success Scenarios**:
- Developer writes the shell's catalog, creates the client with it and with the namespace option set to the catalog's shared first segment, and records declared events with their data. The type check passes, and each record is built, enriched and handed on like any other.

**Error Scenarios**:
- The developer records a name the catalog does not declare: the type check fails before the application runs.
- The developer passes data of the wrong shape for a declared name: the type check fails before the application runs.
- The catalog's names do not share one first segment, or the namespace option is missing or does not match it: the type check fails.
- The catalog uses a reserved namespace, or declares a name with only one segment: the type check fails.
- A plugin's event hook throws while a typed record is enriched: the record still goes on, nothing reaches the caller, and a development build shows one notice for that hook function.
- The same hook throws during a shipped `logEvent` call: the shipped rethrow applies, and the record goes no further, as shipped.
- The typed record call is made in a production build with no application connector and the collector switched off: it returns at once, as the connector-delivery feature specifies.
- The typed record call is made after destroy: the record is dropped as shipped, and nothing is thrown.

**Steps**:
1. [x] - `p1` - Developer writes the shell's event catalog as a type: each event name, made of the shell's namespace and at least one more segment, with the shape of its data as a record of named values - `inst-write-shell-catalog`
2. [x] - `p1` - Developer creates the client with the catalog as its explicit type parameter and the namespace option set to the catalog's shared first segment; the option's type comes from the catalog - `inst-create-typed-client`
3. [x] - `p1` - Type checker applies `cpt-frontx-telemetry-algo-declared-events-catalog-rules` to the catalog and the namespace option - `inst-check-shell-catalog`
4. [x] - `p1` - **IF** the catalog or the namespace option breaks a rule - `inst-check-shell-catalog-fails`
   1. [x] - `p1` - **RETURN** a type error before the application runs - `inst-refuse-shell-catalog`
5. [x] - `p1` - Developer records a declared event through the typed record call, by name and with its data - `inst-record-declared-event`
6. [x] - `p1` - Type checker applies `cpt-frontx-telemetry-algo-declared-events-typed-call-check` - `inst-check-typed-call`
7. [x] - `p1` - **IF** the name is not declared or the data has the wrong shape - `inst-check-typed-call-fails`
   1. [x] - `p1` - **RETURN** a type error before the application runs - `inst-refuse-typed-call`
8. [x] - `p1` - At runtime, system records the event using `cpt-frontx-telemetry-algo-declared-events-typed-record` - `inst-run-typed-record`
9. [x] - `p1` - Developer may still record through the shipped untyped `logEvent`, which works as before - `inst-untyped-still-works`
10. [x] - `p1` - **RETURN** nothing to the caller: no value, no promise and no thrown error - `inst-return-to-caller`

### Declare A Microfrontend's Events

- [x] `p1` - **ID**: `cpt-frontx-telemetry-flow-declared-events-mfe-catalog`

**Actor**: `cpt-frontx-telemetry-actor-application-developer`

**Success Scenarios**:
- Developer of a microfrontend writes its catalog with the microfrontend's namespace as the first segment of every name, and the exported catalog-check type accepts it for that namespace.

**Error Scenarios**:
- The catalog's names do not share one first segment, or that segment is not the microfrontend's namespace: the type check fails before the microfrontend is built.
- The catalog uses a reserved namespace, or declares a name with only one segment: the type check fails before the microfrontend is built.

**Steps**:
1. [x] - `p1` - Developer of a microfrontend writes its catalog as a type, every name made of the microfrontend's namespace and at least one more segment, and every data shape a record of named values - `inst-write-mfe-catalog`
2. [x] - `p1` - Type checker applies `cpt-frontx-telemetry-algo-declared-events-catalog-rules` through the exported catalog-check type, with the microfrontend's namespace - `inst-check-mfe-catalog`
3. [x] - `p1` - **IF** the catalog or the namespace breaks a rule - `inst-check-mfe-catalog-fails`
   1. [x] - `p1` - **RETURN** a type error before the microfrontend is built - `inst-refuse-mfe-catalog`
4. [x] - `p1` - **RETURN** the catalog accepted, with names an analyst can trace to the microfrontend by their first segment - `inst-return-mfe-declared`

The microfrontend reporter, a later feature, takes its catalog through the same catalog-check type and applies the typed-call check to its declared-event call. Until the reporter exists, the type test for a microfrontend's catalog runs against the catalog-check type directly. The shell's receiver checks names again at runtime, as its own feature specifies.

## 3. Processes / Business Logic (CDSL)

### Catalog Rules

- [x] `p1` - **ID**: `cpt-frontx-telemetry-algo-declared-events-catalog-rules`

The namespace option's type comes from the catalog because TypeScript cannot infer one type argument while another is given explicitly. The application gives the catalog explicitly, so the namespace's type cannot also be inferred from the value passed in the option; the check derives it from the catalog instead. The package exports this check as one catalog-check type, which the client uses with its namespace option and the microfrontend reporter will use with a microfrontend's namespace.

**Input**: An event catalog type, and the namespace given beside it: the client's namespace option, or a microfrontend's namespace

**Output**: The catalog accepted by the type checker, or a type error that names the offending entry; nothing of either exists at runtime

**Steps**:
1. [x] - `p1` - **IF** no catalog is given, or it declares no name - `inst-check-no-catalog`
   1. [x] - `p1` - **RETURN** the client accepted with no namespace needed, so a shipped client compiles unchanged - `inst-accept-no-catalog`
2. [x] - `p1` - **FOR EACH** name the catalog declares - `inst-each-declared-name`
   1. [x] - `p1` - Read the name as segments separated by dots - `inst-read-segments`
   2. [x] - `p1` - **IF** it has fewer than two segments, since a declared name is the namespace followed by the rest - `inst-check-two-segments`
      1. [x] - `p1` - **RETURN** a type error for that name - `inst-refuse-one-segment`
   3. [x] - `p1` - **IF** its data shape is not a record of named values - `inst-check-data-shape-kind`
      1. [x] - `p1` - **RETURN** a type error for that name - `inst-refuse-data-shape-kind`
3. [x] - `p1` - **IF** the declared names do not all share one first segment - `inst-check-shared-segment`
   1. [x] - `p1` - **RETURN** a type error - `inst-refuse-mixed-namespaces`
4. [x] - `p1` - Take that shared first segment as the catalog's namespace; being one segment, it holds no dot - `inst-derive-namespace`
5. [x] - `p1` - **IF** the namespace is empty or reserved: `frontx`, the segment for events the package defines; `page_view` or `session_start`; or any value starting with `autocapture_`, the names the shipped package records itself - `inst-check-reserved-namespace`
   1. [x] - `p1` - **RETURN** a type error - `inst-refuse-reserved-namespace`
6. [x] - `p1` - **IF** no namespace is given beside the catalog - `inst-check-namespace-given`
   1. [x] - `p1` - **RETURN** a type error - `inst-refuse-missing-namespace`
7. [x] - `p1` - **IF** the namespace given is not exactly the catalog's namespace - `inst-check-namespace-matches`
   1. [x] - `p1` - **RETURN** a type error - `inst-refuse-mismatched-namespace`
8. [x] - `p1` - **RETURN** the catalog accepted, with each name's data shape as declared - `inst-accept-catalog`

### Typed Record Call Check

- [x] `p1` - **ID**: `cpt-frontx-telemetry-algo-declared-events-typed-call-check`

**Input**: The name and data passed to a typed record call, and the catalog of the client it is called on; later also the reporter's

**Output**: The call accepted, or a type error before the application runs

**Steps**:
1. [x] - `p1` - **IF** the client was created without a catalog - `inst-check-call-without-catalog`
   1. [x] - `p1` - **RETURN** a type error for any name: the typed record call accepts none, and the shipped `logEvent` stays available for untyped recording - `inst-refuse-without-catalog`
2. [x] - `p1` - **IF** the name is not one the catalog declares - `inst-check-declared-name`
   1. [x] - `p1` - **RETURN** a type error - `inst-refuse-undeclared-name`
3. [x] - `p1` - **IF** the data does not match the shape the catalog declares for that name - `inst-check-data-shape`
   1. [x] - `p1` - **RETURN** a type error - `inst-refuse-wrong-shape`
4. [x] - `p1` - **RETURN** the call accepted; the check leaves nothing in the built code - `inst-accept-call`

### Typed Record At Runtime

- [x] `p1` - **ID**: `cpt-frontx-telemetry-algo-declared-events-typed-record`

**Input**: A declared name and its data, already accepted by the type check

**Output**: Nothing returned to the caller; a record built through the events manager and handed on

**Steps**:
1. [x] - `p1` - **TRY** record the event - `inst-try-typed-record`
   1. [x] - `p1` - Pass the name and data to the events manager as a name-and-data call from a surface this design adds - `inst-pass-to-events-manager`
   2. [x] - `p1` - Run `cpt-frontx-telemetry-algo-connector-delivery-record-handoff` for it. That hand-off returns at once in a production build with no application connector and the collector switched off. Otherwise it builds the record as in steps `inst-normalize-params` to `inst-apply-identity-last` of `cpt-frontx-telemetry-algo-event-collection-record-build`, with the identifier and trigger time the SDK assigns applied after the caller's name and data. It drops a record made synchronously inside a connector handler, enriches the record using `cpt-frontx-telemetry-algo-declared-events-contained-enrichment`, rechecks teardown once, and hands the record on with its own steps contained - `inst-run-record-handoff`
2. [x] - `p1` - **CATCH** any other failure inside the package - `inst-catch-typed-record`
   1. [x] - `p1` - Keep it inside the package, and report it through the shipped logger, which prints only when verbose logging is on - `inst-report-internal-failure`
3. [x] - `p1` - **RETURN** nothing: the call returns no value and no promise - `inst-return-nothing`

### Contained Enrichment On The New Surfaces

- [x] `p1` - **ID**: `cpt-frontx-telemetry-algo-declared-events-contained-enrichment`

**Input**: A record built on a surface this design adds: the typed record call, the flow tracker, the interaction recorders, error capture or the microfrontend receiver; plus the event hook functions the plugins registered. Records from the shipped `logEvent` and a plugin's event logger do not come here: the record hand-off enriches them as shipped, so a hook's error is rethrown to the caller and the record goes no further, as shipped.

**Output**: The record enriched by every hook function, with each failing one contained; at most one development notice per failing hook function

**Steps**:
1. [x] - `p1` - **FOR EACH** event hook function, in the order registered - `inst-each-event-hook`
   1. [x] - `p1` - **TRY** call the hook function with the record - `inst-try-event-hook`
   2. [x] - `p1` - **CATCH** a thrown value - `inst-catch-event-hook`
      1. [x] - `p1` - **IF** this hook function has not failed before on this client, and the build-kind constant is development, raise one development notice. It names the hook kind, the enrichment hook, and carries the error; it cannot name the plugin, because the shipped hook registry does not record which plugin added a hook - `inst-notice-first-failure`
      2. [x] - `p1` - Keep the record, with whatever the hook function wrote before it threw, and go on to the next one - `inst-keep-record-going`
2. [x] - `p1` - Rethrow nothing, so no hook's failure reaches the caller - `inst-no-rethrow`
3. [x] - `p1` - **RETURN** the enriched record to the record hand-off, which rechecks teardown once, queues the record for the collector where the collector is on, and passes it to the consent gate's stage - `inst-return-enriched`

## 4. States (CDSL)

### Hook Failure Reporting State Machine

- [x] `p1` - **ID**: `cpt-frontx-telemetry-state-declared-events-hook-failure`

One machine per event hook function, for the life of the client. It decides only whether a failure shows a notice; the record goes on in every state.

**States**: CLEAN, REPORTED

**Initial State**: CLEAN

**Transitions**:
1. [x] - `p1` - **FROM** CLEAN **TO** CLEAN **WHEN** the hook function enriches a record without throwing - `inst-clean-stays-clean`
2. [x] - `p1` - **FROM** CLEAN **TO** REPORTED **WHEN** the hook function throws while a record from a new surface is enriched; under the development build-kind value one notice is shown, naming the hook kind, and under the production value nothing is shown - `inst-clean-to-reported`
3. [x] - `p1` - **FROM** REPORTED **TO** REPORTED **WHEN** the hook function throws again on a new surface; no further notice is shown, and the record still goes on - `inst-reported-stays-reported`
4. [x] - `p1` - **FROM** CLEAN **TO** CLEAN **WHEN** the hook function throws during a shipped `logEvent` call; the shipped rethrow applies, the record goes no further, as shipped, and no notice is shown - `inst-shipped-failure-no-change`

## 5. Definitions of Done

### Catalog As A Type Parameter

- [x] `p1` - **ID**: `cpt-frontx-telemetry-dod-declared-events-catalog-type`

The client **MUST** take the application's event catalog as a type parameter, in which each declared data shape is a record of named values, and its typed record call **MUST** accept only declared names and the data shape declared for each. A wrong name or a wrong shape **MUST** fail the type check before the application runs. The catalog **MUST** add nothing at runtime, and the shipped untyped `logEvent` **MUST** keep working unchanged.

**Verification**: A type test asserts that a call with an undeclared name, a call with data of the wrong shape, and a catalog whose data shape is not a record of named values each fail to compile, and that a call with a declared name and its shape compiles.

**Implements**:
- `cpt-frontx-telemetry-flow-declared-events-shell-events`
- `cpt-frontx-telemetry-algo-declared-events-typed-call-check`
- `cpt-frontx-telemetry-algo-declared-events-catalog-rules`

**Touches**:
- Entities: `EventCatalog`

### Namespace Derived From The Catalog

- [x] `p1` - **ID**: `cpt-frontx-telemetry-dod-declared-events-namespace`

Every name a catalog declares **MUST** share one first segment, and the namespace option's type **MUST** come from the catalog: the option **MUST** be exactly that segment. A catalog whose names do not share one first segment, a namespace option that does not match it, and a catalog given without the namespace option **MUST** each be a type error. A client with no catalog **MUST** need no namespace, so shipped clients compile unchanged. The package **MUST** export the catalog check as one type that both the client and the later microfrontend reporter use. These are type-level rules only; the receiver checks names again at runtime, as its own feature specifies.

**Verification**: Type tests assert that each of these fails to compile: a catalog whose names have two different first segments, a namespace option that does not match the shared segment, and a catalog given without the option. They also assert that a client with no catalog and no namespace option compiles, and that the exported catalog-check type refuses a microfrontend catalog whose names do not start with the microfrontend's namespace.

**Implements**:
- `cpt-frontx-telemetry-flow-declared-events-shell-events`
- `cpt-frontx-telemetry-flow-declared-events-mfe-catalog`
- `cpt-frontx-telemetry-algo-declared-events-catalog-rules`

**Touches**:
- Entities: `EventCatalog`

### Reserved Namespaces Refused

- [x] `p1` - **ID**: `cpt-frontx-telemetry-dod-declared-events-reserved-names`

A namespace **MUST** be one non-empty segment, with no dot, and **MUST NOT** be reserved: not `frontx`, `page_view` or `session_start`, and not starting with `autocapture_`. A declared name **MUST** have at least two segments, the namespace and then the rest. Together these rules keep every name in `frontx`, the names `page_view` and `session_start`, and every name starting with `autocapture_` out of any catalog, so no declared event can be mistaken for one the package defines or records itself.

**Verification**: Type tests assert that catalogs whose names use each reserved namespace fail to compile: one in `frontx`, one in `page_view`, one in `session_start`, and one whose namespace starts with `autocapture_`. They also assert that a catalog declaring a one-segment name, such as `page_view` alone, fails to compile.

**Implements**:
- `cpt-frontx-telemetry-algo-declared-events-catalog-rules`

**Touches**:
- Entities: `EventCatalog`

### Typed Record Call

- [x] `p1` - **ID**: `cpt-frontx-telemetry-dod-declared-events-typed-record`

The typed record call **MUST** build its record through the events manager's record path, with the identifier and trigger time the SDK assigns applied after the caller's name and data. It **MUST** return nothing the caller can wait on and **MUST NOT** throw into the caller. It **MUST** add no record field beyond what the shipped record path and the enrichment plugins already write.

**Verification**: A unit test asserts that the call returns no value and no promise, and that its record carries an SDK-assigned identifier and trigger time.

**Implements**:
- `cpt-frontx-telemetry-flow-declared-events-shell-events`
- `cpt-frontx-telemetry-algo-declared-events-typed-record`

**Constraints**: `cpt-frontx-telemetry-constraint-external-record-schema`

**Touches**:
- Entities: `Record`, `EventCatalog`

### Contained Enrichment On The New Surfaces

- [x] `p1` - **ID**: `cpt-frontx-telemetry-dod-declared-events-contained-enrichment`

On every recording surface this design adds, a plugin or hook that throws during enrichment **MUST NOT** stop the record: the record **MUST** still be queued for the collector where the collector is on, and passed to the consent gate's stage. The failure **MUST** be reported once per hook function, as a development notice that names the hook kind, and **MUST** be silent under the production build-kind value. The failure **MUST NOT** reach the caller. The shipped `logEvent` **MUST** keep its rethrow, and its record goes no further, as shipped.

**Verification**: A unit test with a plugin whose event hook throws, and with the collector switched on explicitly beside a test connector, asserts that a typed record still reaches the collector queue and the test connector, and that nothing reaches the caller. Unit tests run under both build-kind values: under the development value one notice appears however often the hook fails, and under the production value none appears. A further test asserts that the shipped `logEvent` still rethrows the same failure and that its record reaches neither the queue nor the connector.

**Implements**:
- `cpt-frontx-telemetry-algo-declared-events-contained-enrichment`
- `cpt-frontx-telemetry-algo-declared-events-typed-record`
- `cpt-frontx-telemetry-state-declared-events-hook-failure`

**Touches**:
- Entities: `Record`, `Plugin`

## 6. Acceptance Criteria

- [x] A typed record call with a declared name and its data shape compiles; one with an undeclared name or data of the wrong shape fails to compile.
- [x] A catalog whose names do not share one first segment fails to compile, and so does a namespace option that is missing or does not match that segment.
- [x] A client with no catalog needs no namespace option and compiles unchanged.
- [x] The exported catalog-check type refuses a microfrontend catalog whose names do not start with that microfrontend's namespace.
- [x] A catalog in the namespace `frontx`, `page_view` or `session_start`, or in a namespace starting with `autocapture_`, fails to compile, and so does a catalog with a one-segment name.
- [x] The catalog leaves nothing in the built code.
- [x] The typed record call returns no value and no promise, and its record carries the identifier and trigger time the SDK assigns.
- [x] With a plugin whose event hook throws and the collector switched on beside a test connector, a typed record still reaches the collector queue and the test connector, and nothing reaches the caller.
- [x] Under the development build-kind value, one notice appears for a failing hook function however often it fails; under the production value, none appears.
- [x] The shipped `logEvent` still rethrows a hook's error and its record goes no further, and records without a catalog keep working.
