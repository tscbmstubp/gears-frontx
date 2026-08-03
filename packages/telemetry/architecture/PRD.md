# PRD — Telemetry SDK

<!-- toc -->

- [1. Overview](#1-overview)
  - [1.1 Purpose](#11-purpose)
  - [1.2 Background / Problem Statement](#12-background--problem-statement)
  - [1.3 Goals (Business Outcomes)](#13-goals-business-outcomes)
  - [1.4 Glossary](#14-glossary)
- [2. Actors](#2-actors)
  - [2.1 Human Actors](#21-human-actors)
  - [2.2 System Actors](#22-system-actors)
- [3. Operational Concept & Environment](#3-operational-concept--environment)
  - [3.1 Module-Specific Environment Constraints](#31-module-specific-environment-constraints)
- [4. Scope](#4-scope)
  - [4.1 In Scope](#41-in-scope)
  - [4.2 Out of Scope](#42-out-of-scope)
- [5. Functional Requirements](#5-functional-requirements)
  - [5.1 Client Lifecycle](#51-client-lifecycle)
  - [5.2 Event Collection And Delivery](#52-event-collection-and-delivery)
  - [5.3 Context Enrichment](#53-context-enrichment)
  - [5.4 Extension](#54-extension)
  - [5.5 Automatic Capture](#55-automatic-capture)
  - [5.6 Distribution](#56-distribution)
- [6. Non-Functional Requirements](#6-non-functional-requirements)
  - [6.1 NFR Inclusions](#61-nfr-inclusions)
  - [6.2 NFR Exclusions](#62-nfr-exclusions)
- [7. Public Library Interfaces](#7-public-library-interfaces)
  - [7.1 Public API Surface](#71-public-api-surface)
  - [7.2 External Integration Contracts](#72-external-integration-contracts)
- [8. Use Cases](#8-use-cases)
- [9. Acceptance Criteria](#9-acceptance-criteria)
- [10. Dependencies](#10-dependencies)
- [11. Assumptions](#11-assumptions)
- [12. Risks](#12-risks)

<!-- /toc -->

## 1. Overview

### 1.1 Purpose

`@gears-frontx/telemetry` is a browser telemetry SDK published as its own package on its own semver line. It gives an application a single client that collects events, enriches each one with session, device, navigation and application context, and delivers them in batches to a collector endpoint the application operates. It captures user interaction from the DOM without per-element instrumentation, and it exposes a plugin surface for the context the SDK cannot know about.

The problem it solves is that instrumenting an application otherwise means every team writing its own event schema, its own batching, its own session logic and its own redaction. The SDK makes those decisions once, so an application's instrumentation work reduces to naming the events it cares about.

### 1.2 Background / Problem Statement

The ecosystem's applications need product analytics, and the alternative to a shared SDK is either a third-party vendor SDK or per-application code. A vendor SDK dictates the collector, the event envelope and the retention policy, none of which are ours to choose on behalf of a deployment that may be on-premise or air-gapped. Per-application code produces event streams that cannot be compared across applications because no two of them define a session or a page view the same way.

This package is being extracted from an internal codebase where it already runs in production. Extraction rather than a fresh design is deliberate: the event envelope and the record field names are already consumed by existing collectors and dashboards, so the surface is constrained by what already reads it. Several rough edges come with that history and are recorded in section 12 rather than hidden — a transport with no retry, an envelope that stringifies nested objects, and a same-origin default endpoint.

The SDK is also the first ecosystem library to be published outside the runtime substrate, which makes it the proving ground for the published-libraries layer: it must be independently versioned, independently documented, and provably free of coupling to the rest of the ecosystem.

### 1.3 Goals (Business Outcomes)

- An application can go from zero instrumentation to a populated event stream by creating one client and calling one method, with no per-element markup changes.
- Event streams from different applications are comparable, because session, device, navigation and application context are defined by the SDK rather than per application.
- A deployment controls where its telemetry goes: the collector endpoint is configuration, and no data leaves the page for any destination the application did not name.
- The SDK's version line moves independently of the rest of the ecosystem, so a telemetry change never forces an ecosystem-wide upgrade.
- Accidental capture of personal data is reduced by default, and any subtree can be excluded without touching the SDK.

### 1.4 Glossary

| Term | Definition |
|------|------------|
| Client | The object returned by `createTelemetry`. Owns one queue, one session view and one plugin set. Single-use: once destroyed it is not restarted. |
| Record | One telemetry event as it is sent: a caller-supplied name and data, plus the identity and context fields the SDK and its plugins populate. |
| Batch | The set of records drained from the queue by a single flush and sent as one request. |
| Flush | Draining the queue and delivering it. Triggered by a debounce timer, by the page becoming hidden, or by client teardown. |
| Session | A window of user activity identified by a session id, which is replaced once the inactivity window elapses. |
| Device id | A persistent pseudonymous identifier for a browser profile, stored by the SDK and sent on every record. |
| Plugin | A named object with a `setup` function that registers hooks. The mechanism by which all context enrichment happens, including the SDK's own. |
| Hook | A callback invoked by the client at a defined point. The `event` hook runs on every record before it is queued. |
| Autocapture | Recording user interaction with the DOM without per-element instrumentation. |
| Element hook | A function attached to a DOM element that governs how autocapture treats events originating in that element's subtree. |
| Collector | The endpoint that receives batches. Operated by the application, not by this package. |

## 2. Actors

### 2.1 Human Actors

#### Application Developer

**ID**: `cpt-frontx-telemetry-actor-application-developer`

**Role**: Integrates the SDK into an application — creates the client, configures the collector endpoint, starts collection at boot and tears it down, logs domain events, and writes plugins or element hooks for context the SDK cannot infer.
**Needs**: A surface small enough to adopt in one sitting, defaults that are safe when left alone, and explicit control over what is captured and where it is sent.

#### Application End User

**ID**: `cpt-frontx-telemetry-actor-end-user`

**Role**: Uses the instrumented application. Does not interact with the SDK directly; their interaction with the page is what autocapture records, and their browser is what holds the device and session identifiers.
**Needs**: That interaction with the application is not degraded by collection, and that data the application did not intend to collect is not collected.

### 2.2 System Actors

#### Collector Endpoint

**ID**: `cpt-frontx-telemetry-actor-collector`

**Role**: Receives batches over HTTP POST and is responsible for storage, querying and retention. Operated by the deployment. The SDK treats it as opaque and holds no expectation about it beyond accepting the request.

#### Browser Runtime

**ID**: `cpt-frontx-telemetry-actor-browser-runtime`

**Role**: Supplies the capabilities the SDK is built on — `document` and its event system, `localStorage`, `fetch` with `keepalive`, `crypto.randomUUID`, `Intl.Locale`, and the History API events the navigation plugin observes.

## 3. Operational Concept & Environment

### 3.1 Module-Specific Environment Constraints

- Requires a browser environment. `window`, `document`, `localStorage` and `fetch` must exist for collection to occur.
- Must remain importable where `window` is undefined. Server-side rendering imports the package in a Node process, so the lifecycle methods have to degrade to no-ops rather than throw.
- Requires `crypto.randomUUID` for record, session and device identifiers, and `Intl.Locale` for locale normalization. No polyfills are bundled, so the floor is modern evergreen browsers.
- Ships as both CJS and ESM with type declarations, from a single entry point.

## 4. Scope

### 4.1 In Scope

- Client lifecycle: creation, configuration normalization, start, teardown.
- Event collection: caller-named events with arbitrary data, plus a queue and a batching policy.
- Delivery to one configured collector endpoint over HTTP POST.
- Session continuity and a persistent device identifier, both stored in `localStorage`.
- Built-in context enrichment: session, device, navigation, application info, and locale.
- DOM autocapture of `click`, `change` and `submit`, including element attribution and an opt-out.
- A plugin surface and an element-hook surface for context the SDK cannot infer.
- Redaction of values that pattern-match as sensitive, and suppression of capture for elements that look sensitive.

### 4.2 Out of Scope

- Storage, querying, dashboards or retention. Those belong to the collector.
- Application wiring. There is no framework-plugin entry point in this package: the FrontX framework lives in template territory, and no ecosystem package may import template territory. Binding the client to an application's lifecycle is template-side work.
- Consent capture and consent storage. The SDK provides the controls a consent implementation needs — a configuration flag, a start gate, and an opt-out attribute — but does not implement the consent decision or its persistence.
- Transport reliability. There is deliberately no retry, no persistence of undelivered batches, and no offline queue in this scope; see section 12.
- Error and performance monitoring. This SDK records product events, not stack traces or resource timings.
- Server-side or non-browser collection.

## 5. Functional Requirements

### 5.1 Client Lifecycle

#### Client Creation And Configuration

- [x] `p1` - **ID**: `cpt-frontx-telemetry-fr-client-creation`

The system **MUST** create a client from a configuration object that requires only an application name and version, normalizing every other option to a documented default, and **MUST** return a client whose lifecycle methods are safe to call in an environment without `window`.

**Rationale**: Adoption cost is the main barrier to instrumentation. Two required fields and safe defaults mean an application can start collecting before it has decided anything about its telemetry policy, and server-side rendering does not have to guard the import.

**Actors**: `cpt-frontx-telemetry-actor-application-developer`

#### Single-Use Client Lifecycle

- [x] `p1` - **ID**: `cpt-frontx-telemetry-fr-client-lifecycle`

The system **MUST** begin collection only when explicitly started, **MUST** refuse a second start on the same client and report the refusal, and **MUST** on teardown run plugin teardown hooks, deliver whatever remains queued, and detach every listener it installed.

**Rationale**: Starting twice would duplicate every plugin's hooks and listeners, silently doubling the event stream. Refusing is preferable to a partial repair, and a client is cheap to rebuild. Teardown must not lose the last few seconds of events, which is why it delivers rather than discards.

**Actors**: `cpt-frontx-telemetry-actor-application-developer`

### 5.2 Event Collection And Delivery

#### Custom Event Logging

- [x] `p1` - **ID**: `cpt-frontx-telemetry-fr-custom-events`

The system **MUST** let a caller record an event by name with optional structured data, **MUST** stamp each record with a unique identifier and a trigger timestamp that a caller cannot override, and **MUST** offer enrichment of the record to registered hooks before it is queued.

**Rationale**: The event name and its data are the only things the application knows and the SDK cannot infer. Identity and timestamp must be SDK-owned so that records remain correlatable and de-duplicable regardless of what a caller or a hook supplies.

**Actors**: `cpt-frontx-telemetry-actor-application-developer`

#### Batched Delivery

- [x] `p1` - **ID**: `cpt-frontx-telemetry-fr-batched-delivery`

The system **MUST** queue records in memory and deliver them as a batch on a debounce that each new event resets, **MUST** additionally deliver immediately when the page becomes hidden and when the client is torn down, and **MUST** issue the delivery in a way that survives page teardown.

**Rationale**: One request per event is wasteful and one request per page is lossy. A debounce reset by activity batches bursts, and the hidden-page and teardown triggers are what stop a batch dying with the page — which is also why the request is issued with `keepalive`.

**Actors**: `cpt-frontx-telemetry-actor-collector`

#### Configurable Collector Endpoint

- [x] `p1` - **ID**: `cpt-frontx-telemetry-fr-collector-endpoint`

The system **MUST** send batches only to the endpoint resolved from configuration, and **MUST** support an envelope version that hoists fields shared by every record in a multi-record batch out of the individual records.

**Rationale**: A deployment may be on-premise or air-gapped, so the destination cannot be a property of the SDK. The hoisting envelope exists because most context fields are identical across a batch, and repeating them per record dominates the payload.

**Actors**: `cpt-frontx-telemetry-actor-collector`

#### Collection Without Delivery

- [x] `p2` - **ID**: `cpt-frontx-telemetry-fr-delivery-disable`

The system **MUST** provide configuration that suppresses delivery while leaving collection, enrichment and queue draining unchanged, and this behaviour **MUST** be documented as suppressing delivery only rather than suppressing collection.

**Rationale**: A deployment needs to run the SDK with delivery off — to develop against it, or before a consent decision is made — without a second code path whose behaviour differs from production. Because collection still occurs and identifiers are still written, the narrow meaning of the flag must be stated wherever it is offered, or it will be mistaken for an off switch.

**Actors**: `cpt-frontx-telemetry-actor-application-developer`

### 5.3 Context Enrichment

#### Session Continuity

- [x] `p1` - **ID**: `cpt-frontx-telemetry-fr-session-continuity`

The system **MUST** maintain a session identifier that persists across page loads, **MUST** replace it once a configurable inactivity window has elapsed without user activity, and **MUST** treat scroll, keypress and click as activity.

**Rationale**: Session is the unit most product questions are asked in, and it has to survive navigation to be useful. Deriving it from observed activity rather than from page lifetime is what makes a session comparable across single-page and multi-page applications.

**Actors**: `cpt-frontx-telemetry-actor-end-user`

#### Persistent Device Identity

- [x] `p1` - **ID**: `cpt-frontx-telemetry-fr-device-identity`

The system **MUST** mint and store a pseudonymous device identifier, send it on every record, and **MUST** keep the storage keys it owns distinguishable per client through a configurable infix so that two clients on one origin do not share identity.

**Rationale**: Correlating a visitor's sessions is what makes return-visit and funnel analysis possible, and it must not depend on the user being signed in. The infix exists because two applications on one origin are a real deployment shape and must not silently merge their identities.

**Actors**: `cpt-frontx-telemetry-actor-end-user`

#### Built-In Context Enrichment

- [x] `p1` - **ID**: `cpt-frontx-telemetry-fr-builtin-context`

The system **MUST** attach session, device, browser, operating system, viewport, timezone, locale and application identity to records without the caller requesting it, **MUST** emit an event when a session begins, and **MUST** emit an event on every navigation path change including History API transitions.

**Rationale**: This context is the difference between an event stream that can answer a question and a list of names. Registering it as plugins rather than building it into the client means the SDK's own enrichment uses the same surface a consumer's does, so that surface stays honest.

**Actors**: `cpt-frontx-telemetry-actor-end-user`

#### Locale Normalization From An Application Source

- [x] `p2` - **ID**: `cpt-frontx-telemetry-fr-locale-source`

The system **MUST** offer a plugin that reads the current locale from an application-supplied source on every record and normalizes it, and **MUST** fall back to the browser's reported language when no source is supplied.

**Rationale**: The browser's language is not the application's language once the user has chosen one, so the authoritative value lives in the application's i18n layer. Reading it per record rather than once at setup is what makes a mid-session language switch visible.

**Actors**: `cpt-frontx-telemetry-actor-application-developer`

### 5.4 Extension

#### Plugin Registration

- [x] `p1` - **ID**: `cpt-frontx-telemetry-fr-plugin-registration`

The system **MUST** accept named plugins that register hooks during setup, **MUST** ignore falsy entries so that conditional registration needs no branch, **MUST** key plugins by name so that a later registration of a name replaces an earlier one, and **MUST** run plugin setup at client start.

**Rationale**: No fixed set of context fields survives contact with real applications, so the extension point is the requirement rather than a convenience. Ignoring falsy entries keeps conditional registration a one-liner. Keying by name is what lets a consumer replace a built-in, and it is also why the built-in names are reserved.

**Actors**: `cpt-frontx-telemetry-actor-application-developer`

#### Element-Level Attribution

- [x] `p1` - **ID**: `cpt-frontx-telemetry-fr-element-attribution`

The system **MUST** let any element register a hook that contributes service attribution and custom data to autocaptured events from its subtree, or suppresses those events entirely, and **MUST** expose that hook through a key that resolves identically across independently loaded copies of the SDK.

**Rationale**: In a composed application the code that knows which service owns a widget is the widget, not the page that created the client. A cross-realm key is required because micro-frontends routinely load more than one copy of a library on one page, and attribution that broke in that case would fail exactly where composition makes it necessary.

**Actors**: `cpt-frontx-telemetry-actor-application-developer`

### 5.5 Automatic Capture

#### DOM Interaction Autocapture

- [x] `p1` - **ID**: `cpt-frontx-telemetry-fr-dom-autocapture`

The system **MUST** capture click, change and submit interaction from the document without per-element instrumentation when autocapture is enabled, **MUST** name each captured event after the interaction type, and **MUST** record the originating element's tag, a safe subset of its attributes, and its text where the element is one whose text is its label.

**Rationale**: Interaction data is the highest-volume and lowest-value data to instrument by hand, and hand instrumentation is what teams skip. Capturing it by default is what makes the stream useful without an instrumentation project.

**Actors**: `cpt-frontx-telemetry-actor-end-user`

#### Capture Opt-Out

- [x] `p1` - **ID**: `cpt-frontx-telemetry-fr-capture-opt-out`

The system **MUST** suppress autocapture for an element and its entire subtree when that element carries the opt-out attribute, and **MUST** treat the presence of the attribute as the whole signal without reading its value.

**Rationale**: Subtree-scoped opt-out is the only form that is safe to apply to a region whose contents are not known in advance. Presence-only semantics exist because a value-sensitive reading is a trap: markup written as the bare attribute, or with any value at all, must opt out rather than silently opt in.

**Actors**: `cpt-frontx-telemetry-actor-application-developer`

#### Sensitive-Value Redaction

- [x] `p1` - **ID**: `cpt-frontx-telemetry-fr-redaction`

The system **MUST** drop an entire autocaptured event when any element on the path from the target to the document root is a password or hidden input or carries a name or identifier that pattern-matches as sensitive, **MUST** restrict attribute reading to name, identifier and accessible label for free-text and selection controls, **MUST** drop values matching payment-card and national-identifier patterns, and **MUST** document this as a safety net rather than a compliance guarantee.

**Rationale**: Autocapture's value comes from capturing markup nobody reviewed for this purpose, which is exactly why it needs a default-deny reflex around inputs. Dropping the whole event rather than the offending field is deliberate: a partial record from a sensitive form still discloses that the form was used and often what was selected. The documented limit matters as much as the mechanism — pattern matching cannot see application semantics, and presenting it as compliance would displace the review that is actually required.

**Actors**: `cpt-frontx-telemetry-actor-end-user`

### 5.6 Distribution

#### Independent Publication

- [x] `p1` - **ID**: `cpt-frontx-telemetry-fr-independent-publication`

The system **MUST** be published as its own package on its own version line, **MUST** ship its license and notice inside the distribution, and **MUST** exclude development-only material including its demo from the published files.

**Rationale**: Independent versioning is what lets a telemetry fix ship without an ecosystem release, and it is the property that makes this package a member of the published-libraries layer rather than part of the runtime substrate. Shipping the notice with the distribution is an Apache-2.0 obligation, not a preference.

**Actors**: `cpt-frontx-telemetry-actor-application-developer`

## 6. Non-Functional Requirements

### 6.1 NFR Inclusions

#### Standalone Package Boundary

- [x] `p1` - **ID**: `cpt-frontx-telemetry-nfr-standalone`

The system **MUST** contain no import of another ecosystem package, no import of a UI framework, and no import of template territory, anywhere in its published source.

**Threshold**: Zero such imports, verified mechanically over both manifest edges and import edges, with type-only imports included.

**Rationale**: This is the membership property of the published-libraries layer that the package claims, and the reason it can be adopted by an application that uses none of the rest of the ecosystem. Verified mechanically because a convention that is only documented is not a boundary — and counting type-only imports matters because the property is about coupling, not about what survives to runtime.

#### Dependency Minimalism

- [x] `p2` - **ID**: `cpt-frontx-telemetry-nfr-dependency-minimalism`

The system **MUST** keep its runtime dependency set to at most one third-party package.

**Threshold**: One runtime dependency, currently a user-agent parser. Any addition is a reviewed decision rather than a routine change.

**Rationale**: An SDK is imposed on every consumer's bundle and on every consumer's supply-chain review, so its dependency set is a cost paid by others. Making the count itself the requirement is what stops it drifting one convenient package at a time.

#### Element-Hook Forward Compatibility

- [x] `p1` - **ID**: `cpt-frontx-telemetry-nfr-hook-compatibility`

The system **MUST** evolve the element-hook contract additively, and **MUST** introduce a new registry key rather than reinterpret the existing one whenever the meaning of a field, the suppression rule or the merge rule changes.

**Threshold**: No semantic change to any existing field or rule under an existing registry key, across all released versions.

**Rationale**: The hook is read by one copy of the SDK and written by elements that may come from independently deployed and independently versioned code on the same page. Mixed versions are the normal case, not an edge case, so a reinterpreted field is a silent cross-version data corruption with no single owner able to detect it.

**Verification Method**: inspection at review time, since no test can observe a future version's reinterpretation of a current field.

#### Server-Import Safety

- [x] `p2` - **ID**: `cpt-frontx-telemetry-nfr-server-import-safety`

The system **MUST NOT** throw when imported or when its lifecycle methods are called in an environment without `window`.

**Threshold**: Import and every lifecycle call complete without error in a Node process; collection is simply absent.

**Rationale**: Server-side rendering imports the whole module graph. A package that throws on import forces every consumer into a dynamic import or an environment guard, which is a cost paid repeatedly for a condition the package can handle once.

### 6.2 NFR Exclusions

- Delivery reliability: no availability or delivery-success target applies to this package in this scope. A failed send drops its batch by design of the current transport; see section 12.

## 7. Public Library Interfaces

### 7.1 Public API Surface

#### Client Factory And Service

- [x] `p1` - **ID**: `cpt-frontx-telemetry-interface-client`

**Type**: TypeScript module — a factory function returning a client object whose methods are start, teardown, user identification, event logging and plugin registration. Every method except event logging and teardown returns the client, so configuration reads as a chain.

**Stability**: unstable

**Description**: The package's primary entry point and the only way to obtain a client.

**Breaking Change Policy**: Major version bump. Pre-1.0 the surface may still change, which is what `unstable` records.

#### Plugin Contract

- [x] `p1` - **ID**: `cpt-frontx-telemetry-interface-plugin`

**Type**: TypeScript structural type — a name and a setup function receiving normalized configuration, an event logger, session accessors, a logger and a hook registrar.

**Stability**: unstable

**Description**: The extension surface for context the SDK cannot infer. The SDK's own built-in enrichment is implemented against this same contract.

**Breaking Change Policy**: Major version bump. The context object is additive-only within a major.

#### Element Hook Contract

- [x] `p1` - **ID**: `cpt-frontx-telemetry-interface-element-hook`

**Type**: A cross-realm registry symbol, plus the function type an element assigns to it and the result type that function returns.

**Stability**: stable

**Description**: How an element governs autocapture of events from its own subtree — contributing service attribution and custom data, or suppressing capture.

**Breaking Change Policy**: Additive only, permanently. A semantic change requires a new registry key rather than a version bump, because a version bump cannot coordinate independently deployed writers. This is why the contract is `stable` while the surrounding API is not.

### 7.2 External Integration Contracts

#### Event Batch Envelope

- [x] `p1` - **ID**: `cpt-frontx-telemetry-contract-batch-envelope`

**Direction**: provided by library

**Protocol/Format**: HTTP POST with a JSON body carrying a record set, in one of two envelope versions. The second hoists fields common to every record in the batch into a batch-level block and omits two identity fields.

**Compatibility**: The envelope version is selected by configuration, so a collector is never presented with a shape it did not opt into. Record field names are consumed by existing collectors and are therefore treated as an external contract rather than an internal detail.

#### Locale Source

- [x] `p2` - **ID**: `cpt-frontx-telemetry-contract-locale-source`

**Direction**: required from client

**Protocol/Format**: An object exposing a readable language string. Any i18n library instance satisfies it directly; anything else needs a one-property adapter.

**Compatibility**: Read on every record rather than captured once, so an application may change the underlying value at any time.

## 8. Use Cases

#### Instrument An Application

- [x] `p1` - **ID**: `cpt-frontx-telemetry-usecase-instrument-application`

**Actor**: `cpt-frontx-telemetry-actor-application-developer`

**Preconditions**:
- A collector endpoint exists and is reachable from the application's origin.
- The application knows its own name and version.

**Main Flow**:
1. Developer creates a client with application name, version and collector endpoint.
2. Developer registers any additional plugins the application needs.
3. Developer identifies the current user if one is known.
4. Developer starts the client where the application boots.
5. SDK registers built-in enrichment, installs listeners, and begins collecting.
6. Developer logs domain events at the points the application cares about.
7. SDK enriches, queues and delivers records in batches.
8. Developer tears the client down when the application unmounts.

**Postconditions**:
- The collector holds enriched records for the session, including automatically captured interaction.
- No listeners and no timers remain installed after teardown, and nothing queued was discarded.

**Alternative Flows**:
- **No collector endpoint configured**: delivery targets a same-origin default path, which is almost never what the deployment intended. This is a known gap; see section 12.
- **Delivery suppressed by configuration**: collection, enrichment and queue draining proceed unchanged and nothing is sent. Identifiers are still written to storage.
- **Client started a second time**: the second start is refused and reported, and the client continues in its already-started state.

#### Attribute A Component's Events

- [x] `p2` - **ID**: `cpt-frontx-telemetry-usecase-attribute-component`

**Actor**: `cpt-frontx-telemetry-actor-application-developer`

**Preconditions**:
- Autocapture is enabled.
- The component renders a subtree it wants events attributed to, and knows its own service identity.

**Main Flow**:
1. Developer assigns an element hook to the subtree's root element.
2. End user interacts with a descendant of that element.
3. SDK walks from the interaction target up through its ancestors, invoking every hook it finds.
4. SDK takes the attribution from the closest hook that contributed one.
5. SDK merges the hook's custom data beneath its own captured fields and emits the event.

**Postconditions**:
- The captured event carries the component's service attribution rather than only the host application's.

**Alternative Flows**:
- **A hook declines capture**: the event is suppressed entirely, no matter which ancestor declined.
- **A hook fails**: that element contributes nothing, the event is still emitted, and the failure is surfaced to the page's error handling rather than swallowed.
- **A hook returns reserved or unpermitted fields**: those are dropped; only the attribution fields are honoured.

## 9. Acceptance Criteria

- [x] An application can create a client, start it, log an event and see an enriched record reach the collector, having configured only its own name, version and endpoint.
- [x] A record's identity and trigger timestamp are always SDK-assigned and cannot be overridden by a caller or by a hook.
- [x] Queued records are delivered on the activity-reset debounce, when the page becomes hidden, and on teardown, and the teardown delivery survives page unload.
- [x] The session identifier survives a page load and is replaced only after the configured inactivity window passes without activity.
- [x] The device identifier is present on every record and is stable across sessions and reloads for a given browser profile and storage infix.
- [x] Autocapture records click, change and submit interaction with no per-element instrumentation, and an opt-out attribute anywhere above the target suppresses the event regardless of its value.
- [x] An input that is a password or hidden field, or whose name or identifier matches a sensitive pattern, causes the entire event to be dropped rather than partially recorded.
- [x] An element hook resolves across two independently loaded copies of the SDK on one page.
- [x] The package's published source contains no ecosystem, UI-framework or template-territory import, verified mechanically including type-only imports.
- [x] Importing the package and calling its lifecycle methods in a Node process completes without error.
- [x] The published tarball contains the built distribution, the readme, the license and the notice, and does not contain the demo.

## 10. Dependencies

| Dependency | Description | Criticality |
|------------|-------------|-------------|
| Browser runtime | `document` and its event system, `localStorage`, `fetch` with `keepalive`, `crypto.randomUUID`, `Intl.Locale`, History API events | p1 |
| Collector endpoint | Receives batches; operated by the deployment | p1 |
| User-agent parser | Derives browser, operating system and platform fields for the device plugin | p2 |
| Application i18n source | Supplies the authoritative locale to the locale plugin; optional, with a browser fallback | p3 |

## 11. Assumptions

- The collector accepts the configured envelope and is reachable from the application's origin; cross-origin configuration is the deployment's concern.
- `localStorage` is available and writable. Where it is not, session and device identity cannot persist.
- The application starts the client at a point where its own name and version are known.
- Consent, where a deployment requires it, is decided by the application before it starts the client. The SDK offers the controls and does not make the decision.
- Record field names already consumed by existing collectors are treated as fixed, since this package is extracted from a codebase whose collectors are already deployed.
- Element hooks are written by code the deployment controls, but are treated as untrusted at runtime: they may fail or return anything.

## 12. Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| A failed delivery drops its batch — the queue is drained before the request and a rejected request only reaches the console | Silent, unbounded data loss under intermittent connectivity, invisible to the application | Recorded as a known gap in the package readme. A pluggable transport is the intended fix; until then the loss is documented rather than implied. |
| The collector endpoint defaults to a same-origin path | An application that does not set it delivers to a path that probably does not exist, and appears to work | Documented as a required setting in the readme with an explicit warning. A future major version should make it required. |
| The envelope stringifies nested object fields | Structured data arrives at the collector double-encoded, so consumers must decode field by field | Documented as a known gap. The pluggable transport that replaces the envelope resolves it. |
| Redaction is pattern-based and cannot see application semantics | Personal data in markup that does not match a pattern can be captured | Stated as a safety net rather than a guarantee, alongside the subtree opt-out and element-hook suppression that give an application an authoritative control. |
| The device identifier is written before any consent decision, and suppressing delivery does not suppress it | A deployment that treats the flag as an off switch writes a persistent identifier it did not intend to | The narrow meaning of the flag is documented at every point it appears, with the instruction to gate client start itself on consent. |
| Registering a plugin under a built-in name silently replaces the built-in | Loss of session, device, navigation or application context with no error | The built-in names are reserved and documented as forbidden for consumer plugins. |
| A plugin registered after start is stored but never set up | A consumer's enrichment silently does nothing | Documented ordering requirement: register before start. |
| Several declared record fields are never populated | Collector schemas carry fields that are always empty, and consumers may infer support that does not exist | Enumerated as a known gap in the readme rather than left for a consumer to discover from empty columns. |
