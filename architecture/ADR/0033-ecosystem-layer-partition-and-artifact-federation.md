---
status: proposed
date: 2026-08-03
---

# Partition of the Ecosystem into Layers with Membership by Property and Federated Artifact Ownership

<!-- toc -->

- [Context and Problem Statement](#context-and-problem-statement)
- [Decision Drivers](#decision-drivers)
- [Considered Options](#considered-options)
- [Decision Outcome](#decision-outcome)
  - [Consequences](#consequences)
  - [Confirmation](#confirmation)
- [Pros and Cons of the Options](#pros-and-cons-of-the-options)
  - [Three layers, membership by property, federated artifact ownership](#three-layers-membership-by-property-federated-artifact-ownership)
  - [Three layers, membership by enumeration, federated artifact ownership](#three-layers-membership-by-enumeration-federated-artifact-ownership)
  - [Three layers, membership by property, centralized artifact ownership](#three-layers-membership-by-property-centralized-artifact-ownership)
- [More Information](#more-information)
- [Traceability](#traceability)

<!-- /toc -->

**ID**: `cpt-frontx-adr-ecosystem-layer-partition`

## Context and Problem Statement

The ecosystem was previously described as three co-equal parts, a framing that has been retired: it fixed the count at three, asserted an equality between them that no requirement depends on, and named a set of packages rather than a role any package could fill. Retiring it leaves the ecosystem with no stated partition at the moment when independently-developed packages are arriving — a telemetry SDK, a UI component library — and when some of those packages will be authored outside this repository and outside this organization. At the same time the artifact chain is centralized: a single PRD, DESIGN and DECOMPOSITION at the repository root describe every package, so each new package requires editing root artifacts, and each root artifact grows without bound as the ecosystem grows.

Two failures already follow from the absence of a stated partition. The boundary guards derive membership from hand-written lists, so a package absent from a list is never checked rather than reported — a newly-added package passes enforcement it was never subjected to. And a package with no backing artifact can only be admitted by an ignore entry, so ignores accumulate as the mechanism for onboarding rather than as a temporary exception.

How is the ecosystem partitioned, how is a member's membership determined, and which artifacts does a member own rather than the root?

## Decision Drivers

* **Open membership** — the partition must admit members this repository does not own: a third-party component library filling a published-library role, a template authored in another repository or by another vendor. Any membership mechanism that requires listing members presumes ownership of the list, which federation gives up.
* **No silent escape from enforcement** — a member that has not been classified must fail rather than pass unchecked. The current lists make an unlisted package invisible to the manifest edge guard, which is how a merged package came to pass a check that never ran against it.
* **The agnostic-substrate guarantee must survive intact** — `cpt-frontx-fr-ui-framework-agnostic` is a `p1` requirement and `cpt-frontx-principle-agnostic-core` is cited as a decision driver by seven accepted ADRs, so neither can be retired or weakened. A partition that places a React-based component library and the UI-agnostic runtime substrate in one undifferentiated group cannot preserve it.
* **Root artifacts must stop growing per member** — with a central DESIGN, adding a library means adding a component to it, and changing a library means editing it. This couples every member's evolution to the root and works against `cpt-frontx-nfr-evolvability`.
* **Total classification** — every unit of shipped code must have a determinate position, including units that belong to no layer, so that "not in a layer" is a stated position rather than an omission.
* **Prior decompositions must carry forward without edits** — `cpt-frontx-adr-cli-internal-decomposition` and `cpt-frontx-adr-ai-tooling-internal-decomposition` both cite the retired co-equality framing as a decision driver and are both accepted, hence immutable for decision and rationale. The new partition must leave their decompositions valid rather than requiring them to be amended.

## Considered Options

* **Three layers, membership by property, federated artifact ownership** — the ecosystem is partitioned into published libraries, templates, and projects orchestration; membership in a layer is determined by a stated property a candidate either satisfies or does not; and each member owns the artifacts describing itself while the root owns orchestration and the contracts between layers.
* **Three layers, membership by enumeration, federated artifact ownership** — the same partition and the same artifact federation, but each layer's membership is an authored list of members maintained alongside the architecture.
* **Three layers, membership by property, centralized artifact ownership** — the same partition and the same property-based membership, but the root PRD, DESIGN and DECOMPOSITION continue to describe every member, and members carry no artifacts of their own.

## Decision Outcome

Chosen option: **Three layers, membership by property, federated artifact ownership**, because it is the only option that can admit members this repository does not own while still subjecting every member to enforcement, and the only one that stops root artifacts growing with each new member.

**The partition.** Three layers: **published libraries**, **templates**, and **projects orchestration**. Each layer is defined by the role its members fill, not by which packages currently fill it.

This decision **requires** that the word *layer* name this partition and no other grouping of the same system. That requirement is not yet satisfied: the root DESIGN still describes the retired co-equal framing and still uses *layer* for the tooling and substrate groupings and for a four-tier technology stack. Those usages are retired by the root artifact rewrite this decision necessitates, not by this record, so until that rewrite lands the architecture carries both vocabularies. The rewrite's scope is bounded by the same requirement: ordinary technical usage that names no partition of this system — a transport layer, a persistence layer, a layer of indirection — is unaffected.

**Membership is a property.** A candidate belongs to a layer if it satisfies that layer's stated property. Where a mechanical check derives a concrete list of current members, that list is a derived artifact of the check and is never the authoritative statement of membership. This is what admits members the architecture does not own: the architecture states the role and the contract, and does not hold the member's artifacts.

The three properties:

* **Published libraries** — a unit is a member if it is published for independent consumption under its own version, and its consumers integrate it by declaring a dependency on it. A member of this layer is consumed as a dependency; it is not copied, and it does not drive a project's lifecycle.
* **Templates** — a unit is a member if it is applied to produce or extend a project, delivering content the receiving project then owns. A member of this layer is copied rather than depended upon, and what it claims is declared in its manifest (`cpt-frontx-adr-template-manifest-contract`).
* **Projects orchestration** — a unit is a member if it acts on a project's lifecycle across the other two layers: creating, assembling, upgrading, or reasoning about a project rather than being part of the artifact a project ships.

A candidate satisfying more than one of these is a defect in the candidate, not an ambiguity in the partition: the three roles are how a unit reaches a consumer, and a unit that both ships as a dependency and is copied as content should be split.

**Admission of a member the architecture does not own is not decided here.** Open membership requires that an external candidate be classifiable and that the contract of its layer be checkable against it; the mechanism — who confirms a candidate satisfies its layer's property, against what conformance contract, and what happens on failure — is a separate decision. Until it exists, total classification binds only members inside this repository, and an external member's compliance rests on review rather than on a gate. This is a stated limit on the reach of the enforcement claimed below, not an implied mechanism.

**Within published libraries, two independent properties.** A library is **core** if it must remain UI-framework-agnostic. A library is **standalone** if it declares no intra-ecosystem package dependency, with the single exception of the type-substrate port. These are separate properties, not one combined test, and a library may hold either, both, or neither. Keeping them separate is what lets the agnostic-substrate guarantee apply to a library that legitimately depends on another library: welding the two would make the UI guarantee contingent on an unrelated question about dependencies, so a UI-agnostic library with one intra-ecosystem edge would fall out of *core* and lose that guarantee for a reason having nothing to do with its UI stack. A React-based component library does not satisfy *core*, which is permitted: `cpt-frontx-fr-ui-framework-agnostic` constrains the core framework and leaves the UI-stack choice to applications, templates, and libraries that are not core. Whether that same library satisfies *standalone* is a separate question with a separate answer — a component library declaring no intra-ecosystem dependency satisfies it, and its UI stack has no bearing on that. Reading "not core" as "neither property" is the conflation these two properties are kept apart to prevent.

**Two categories outside the layers, both stated positively.** **Build internals** are packages that exist only to configure the build, are never published, and belong to no layer; they remain subject to the dependency-edge guard and are exempt from the member artifact chain and from the publication gate. **Non-package code** — repository scripts and in-package demonstrations — has no package identity to carry layer membership; it remains scanned for traceability and holds no layer membership. Both are exemptions with a stated scope, not ignores: an ignore records an absence that is never revisited, and ignores of that kind have already outlived the directories they named.

**Classification is total.** Every package must resolve to a layer or to one of the two stated categories. An unresolved package is a failure, not a package that is skipped.

**Artifact ownership is federated.** The root owns the orchestration of the ecosystem and the contracts between layers. Each member owns the artifacts describing itself: a DESIGN and at least one FEATURE always; a PRD where the member has consumers and non-functional requirements of its own; never a DECOMPOSITION, whose purpose is organizing a large design into features and which for a single member would partition a handful of components into one feature.

Excluding the DECOMPOSITION carries one requirement that follows from it rather than from preference. The identifier kind naming a feature entry is owned by a DECOMPOSITION, so the feature-entry identifier a FEATURE ordinarily carries is a reference to a definition held elsewhere. In a member owning no DECOMPOSITION nothing defines it, and the member's artifacts fail validation. A member's FEATURE therefore omits that identifier and carries its identity on its feature-status identifier alone. This is part of the decision: without it the artifact chain assigned to a member here cannot be made to validate, and a member would be pushed back toward owning a DECOMPOSITION for a reason unrelated to whether it needs one.

A member's artifacts may cite root requirement and design identifiers; the reverse — root artifacts citing a member's identifiers — would recouple the root to its members and is not permitted by this decision.

**The orchestration layer is a membership grouping, not an act of orchestration.** *Projects orchestration* names the layer whose members orchestrate the lifecycle of a project. It does not describe a relationship between those members. The relationship between the AI tooling kit and the CLI — that coordination runs over the CLI's command surface and is not a compile-time dependency — is decided by `cpt-frontx-adr-ai-driven-upgrade-orchestration` and is unaffected by this decision. Placing the kit and the CLI in one layer says they fill the same role; it says nothing about which one drives the other.

**A non-requirement, stated to prevent its invention.** No relation of **inheritance or derivation** between templates exists or is required. Applying a template copies files that the receiving project may then change without constraint, so two templates that resemble each other are two independent templates, and neither is a specialization of the other or obliged to track it. A vendor-specific template beside a general one of the same kind is a second template, not a descendant of the first.

This does not narrow the template-to-template relation that does exist: a template may **reference** other templates to be applied together as a preset, declared in its manifest (`cpt-frontx-adr-template-manifest-contract`) and resolved transitively into one assembly operation (`cpt-frontx-adr-composed-template-resolution`). Composition by declared reference is unaffected by this decision. What is excluded is a lineage relation — no template is defined as a variant of another, and none inherits or must re-inherit another's content. The only durable link a template leaves behind in a project it was applied to is the per-application provenance record decided in `cpt-frontx-adr-project-provenance-record`.

**Prior decompositions carry forward unchanged.** `cpt-frontx-adr-cli-internal-decomposition` and `cpt-frontx-adr-ai-tooling-internal-decomposition` remain valid as written. Both cite the retired co-equality framing among their decision drivers; under this partition their two subjects are members of the same layer, and neither decomposition depends on the retired framing for its outcome. Neither ADR is amended, and neither is superseded.

**Scope.** This decision fixes the partition, each layer's membership property, the form membership takes, the two categories outside the layers, the requirement that classification be total, and the division of artifact ownership between root and member.

It does not fix: the identifier namespace, which is decided separately; the admission path for a member the architecture does not own, as stated above; the concrete mechanical proxy by which each property is tested, nor the configuration through which member artifacts are registered, both of which are implementation owned by the enforcement configuration and the artifacts registry; and the structure of each layer, which is DESIGN content. It changes nothing about how templates compose, which `cpt-frontx-adr-template-manifest-contract` and `cpt-frontx-adr-composed-template-resolution` decide.

### Consequences

* Good, because a member the architecture does not own can fill a layer's role without the architecture having to hold or list it, which an authored membership list cannot express.
* Good, because a new member cannot pass enforcement it was never subjected to: with classification total, an unclassified package fails instead of being skipped.
* Good, because the agnostic-substrate guarantee extends automatically to every library satisfying the *core* property, rather than to the three packages someone last remembered to list.
* Good, because root artifacts stop growing with each new member, so a member's evolution no longer requires editing the root.
* Good, because two accepted ADRs that cite the retired framing need neither amendment nor supersession, which their accepted status would in any case forbid.
* Bad, because a property is only as good as the mechanical proxy that tests it, and the proxy is narrower than the property: *core* is tested by the absence of a React dependency and a React import, which approximates "must remain UI-framework-agnostic" without being identical to it.
* Bad, because two properties within published libraries mean two membership tests and two derivations where an authored list would have been one artifact to read.
* Bad, because federated ownership assumes a member's artifacts and the root's remain distinguishable, and the registry isolates them only in one direction of the question. Required-reference coverage is genuinely per-system: both the artifact kinds a system holds and the references it makes are tracked per system, so a member's obligations are evaluated against the member's own artifacts and not against the root's. Citation is not scoped at all: a reference is rejected only when its prefix matches no registered system anywhere in the project, so any member artifact may cite any root or sibling identifier and will validate. The citation direction this decision requires — a member may cite the root, the root may not cite a member — is therefore a stated constraint with no mechanical enforcement, even though the coverage rules that do bind are scoped correctly.
* Bad, because three identifier kinds a DESIGN is required to define — component, design constraint and design principle — each require a reference from a DECOMPOSITION, which a member does not own. Each such identifier degrades to a warning rather than an error, so a member's artifacts validate, but no member DESIGN can be warning-clean, and the count rises with the member's design detail rather than with anything being wrong. Resolving it means scoping that coverage requirement per system in the artifact kit, which is outside this decision and is not attempted by it.
* Bad, because the member artifact chain binds only if a member's registry node declares its required artifact kinds; a node that merely lists the artifacts it happens to have validates while enforcing nothing, so the weaker form silently reproduces the gap this decision exists to close.
* Bad, because the root PRD, DESIGN and DECOMPOSITION must be rewritten to describe the partition, a cost this decision incurs and does not itself pay. Until that rewrite lands the architecture carries two vocabularies for *layer*, and a reader who consults DESIGN alone finds the retired framing presented as current.
* Bad, because open membership is claimed while the path by which an external candidate is admitted and checked is deferred, so total classification reaches only members inside this repository and an external member's compliance rests on review. The claim is therefore weaker in practice than the partition implies until that path is decided.

### Confirmation

Compliance is confirmed by continuous-integration checks and by review.

The membership form is confirmed by inspection: each layer's and each property's membership must be derivable from a stated check, and any concrete member list in the enforcement configuration must be generated or verified against the repository rather than authored. Totality is confirmed by a gate that fails when a package under a workspace root resolves to no layer and to neither stated category; the present fallback for an unclassified package is unreachable and does not constitute such a gate.

The *core* property is confirmed by the existing React-import prohibition applying to every library satisfying it, verified by deliberate violation rather than by the rule's presence. The *standalone* property is confirmed over both manifest edges and import edges, with type-only imports visible to the check, since the type-substrate port is a type-only import and is invisible to a check that sees only runtime edges.

Federated ownership is confirmed on a single member before generalization: a member registered as its own system node, with its own artifacts and its own coverage scope, validating clean.

That confirmation has been carried out, on the telemetry SDK. It owns a PRD — it is published and has consumers of its own — a DESIGN, and two FEATUREs, and it is registered as its own system node declaring its required kinds. The result is no errors, with every traceability identifier in the member's artifacts resolving to marked code and the member's coverage thresholds met both repository-wide and scoped to the member alone. The member's source was left semantically unchanged; only traceability markers were added.

The confirmation settled three things this decision had assumed rather than tested: a member DESIGN may cite a root requirement identifier and validates; per-member coverage scoping filters to the member's own code; and required artifact kinds bind only where the member's node declares them, the declaration-free form validating clean while enforcing nothing. It also produced the two limits recorded in the consequences above — the feature-entry identifier must be omitted from a member FEATURE, and a member DESIGN carries one warning for each component, constraint and principle it defines. Both were found by running the pilot rather than by reasoning about it, which is why this decision was left proposed until it had been run. The citation-direction constraint remains without mechanical confirmation.

## Pros and Cons of the Options

### Three layers, membership by property, federated artifact ownership

Layers defined by role; membership determined by a stated property; each member owning its own artifacts while the root owns orchestration and inter-layer contracts.

* Good, because it admits members the architecture does not own.
* Good, because classification can be made total, so an unclassified member fails rather than passing unchecked.
* Good, because guarantees attach to a property and reach every member satisfying it.
* Good, because root artifacts stop growing per member.
* Neutral, because concrete member lists still exist as derived artifacts of the checks.
* Bad, because each property needs a mechanical proxy narrower than the property itself.
* Bad, because it requires the root artifact rewrite and a registry change before it takes effect.

### Three layers, membership by enumeration, federated artifact ownership

The same partition and the same federation, with each layer's membership maintained as an authored list.

* Good, because a list is unambiguous, cheap to read, and needs no proxy to evaluate.
* Good, because it requires no change to how the present guards determine membership.
* Bad, because it cannot express members the architecture does not own, and so cannot express open membership at all.
* Bad, because a member absent from a list is unchecked rather than reported, which is the failure this decision exists to close.
* Bad, because lists drift silently in the direction of omission: the present guards catch a listed package that has disappeared and do not catch a package that was never listed.

### Three layers, membership by property, centralized artifact ownership

The same partition and the same property-based membership, with the root continuing to describe every member.

* Good, because traceability stays in one place, and cross-member citation raises no boundary question.
* Good, because it needs no registry change and no per-member artifact authoring.
* Bad, because every new member requires editing root artifacts, so the root grows without bound and each member's evolution is coupled to it.
* Bad, because a member owned by another repository or another vendor cannot be described by artifacts this repository holds, so the partition's open membership becomes undescribable.
* Bad, because it leaves the present onboarding path unchanged, in which a member without a backing artifact is admitted by an ignore entry.

## More Information

The partition this decision replaces was expressed in the root PRD and DESIGN and is retired by them rather than by this record. The package-boundary partition within the core substrate is decided in `cpt-frontx-adr-core-package-boundaries`, which this decision generalizes rather than supersedes: that decision fixes the boundaries between the substrate's packages, while this one fixes how membership in the surrounding partition is determined. The coordination relationship between the AI tooling kit and the CLI is decided in `cpt-frontx-adr-ai-driven-upgrade-orchestration` and is untouched here. The provenance record that is a template's only durable link to the projects it was applied to is decided in `cpt-frontx-adr-project-provenance-record`. These are non-binding pointers and do not form part of this decision's durable identity.

Review trigger: this decision should be revisited if a layer acquires a member whose role does not match any of the three, if the mechanical proxy for a property is found to diverge from the property in a case that matters, or if traceability isolation between systems becomes available and the citation-direction constraint can be enforced rather than stated.

Applicability of the remaining checklist categories: **PERF** — Not applicable, because a partition and an ownership division bind no latency, throughput, or resource budget. **SEC** — Not applicable, because the decision carries no credential material and changes no trust boundary; the default-deny admission posture is decided elsewhere. **REL** — Not applicable, because no service-availability target attaches to a repository-time partition. **DATA** — addressed by deliberate omission: this decision fixes which artifact kinds a member owns but not their schemas or the registry fields that declare them, which belong to the artifacts registry (DATA-ADR-NO-001). **INT** — addressed: the root retains ownership of the contracts between layers, and a member's obligations toward other layers are part of its layer's role. **OPS** — addressed: the publication gate applies to layer members and explicitly does not apply to build internals, which are never published. **MAINT** — addressed: federated ownership is adopted so that a member's evolution does not require editing root artifacts, and the cost of the root rewrite is recorded as a consequence. **TEST** — addressed in Confirmation: each property is verified by deliberate violation rather than by the presence of a rule, and federation is proven on one member before generalization. **COMPL** — Not applicable, because no regulatory or certification obligation attaches to how the ecosystem is partitioned. **UX** — addressed implicitly: a developer can determine which layer a package belongs to from its properties rather than by finding it on a list. **BIZ** — Not applicable, because product requirements live in the PRD and are cited here by identifier.

## Traceability

- **PRD**: [PRD.md](../PRD.md)
- **DESIGN**: [DESIGN.md](../DESIGN.md)

This decision directly addresses the following requirements and design elements:

* `cpt-frontx-fr-ui-framework-agnostic` — The *core* property is the membership form this requirement's guarantee attaches to, so the prohibition reaches every library that must stay UI-framework-agnostic rather than a fixed set, while leaving a React-based library legitimately outside it.
* `cpt-frontx-principle-agnostic-core` — Restating substrate agnosticism as a property rather than a package set is what preserves this principle across a growing set of published libraries.
* `cpt-frontx-nfr-evolvability` — Federated artifact ownership removes the coupling by which every member's change required a root artifact edit, which is what this requirement's isolation of change depends on.
* `cpt-frontx-adr-core-package-boundaries` — Generalized, not superseded: that decision fixes the boundaries between substrate packages; this one fixes how membership in the surrounding partition is determined.
* `cpt-frontx-adr-ai-driven-upgrade-orchestration` — Unaffected. Placing the AI tooling kit and the CLI in one layer states that they fill the same role and states nothing about the coordination relationship that decision fixes.
* `cpt-frontx-adr-project-provenance-record` — Identified as the only durable link a template leaves behind in a project, which is what makes the absence of a lineage relation between templates a non-requirement rather than a gap.
* `cpt-frontx-adr-template-manifest-contract` — Unaffected, and relied upon: the templates layer's membership property refers to the manifest as where a template declares what it claims, and the declared references this decision explicitly preserves are carried there.
* `cpt-frontx-adr-composed-template-resolution` — Unaffected: composition of a preset's referenced templates, resolved transitively, is the template-to-template relation this decision preserves while excluding lineage.
* `cpt-frontx-adr-cli-internal-decomposition` — Carries forward unchanged; its decomposition does not depend on the retired co-equality framing it cites as a driver.
* `cpt-frontx-adr-ai-tooling-internal-decomposition` — Carries forward unchanged, on the same grounds.
