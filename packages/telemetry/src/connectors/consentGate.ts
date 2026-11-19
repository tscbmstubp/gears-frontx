// @cpt-dod:cpt-frontx-telemetry-dod-consent-gate-no-delivery-before-grant:p1
// @cpt-dod:cpt-frontx-telemetry-dod-consent-gate-grant-releases-in-order:p1
// @cpt-dod:cpt-frontx-telemetry-dod-consent-gate-unset-counts-as-granted:p1
// @cpt-dod:cpt-frontx-telemetry-dod-consent-gate-hold-bound:p1
// @cpt-dod:cpt-frontx-telemetry-dod-consent-gate-holding-off:p1
// @cpt-dod:cpt-frontx-telemetry-dod-consent-gate-denial-drops:p1
// @cpt-dod:cpt-frontx-telemetry-dod-consent-gate-start-pass:p1
// @cpt-dod:cpt-frontx-telemetry-dod-consent-gate-destroy-during-start:p1
// @cpt-dod:cpt-frontx-telemetry-dod-consent-gate-reset-identity:p1
// @cpt-dod:cpt-frontx-telemetry-dod-consent-gate-regrant-removal:p1
// @cpt-dod:cpt-frontx-telemetry-dod-consent-gate-identity-before-start:p1
// @cpt-dod:cpt-frontx-telemetry-dod-consent-gate-destroy-drop:p1
// @cpt-dod:cpt-frontx-telemetry-dod-consent-gate-same-state-passes-nothing:p1
// @cpt-dod:cpt-frontx-telemetry-dod-consent-gate-serialized-operations:p1
// @cpt-dod:cpt-frontx-telemetry-dod-consent-gate-drop-before-copy:p1
// @cpt-dod:cpt-frontx-telemetry-dod-consent-gate-start-hint:p1
// @cpt-dod:cpt-frontx-telemetry-dod-consent-gate-queue-drain-limit:p1
// @cpt-dod:cpt-frontx-telemetry-dod-connector-delivery-gate-pass-through:p1

// Consent gate. The pass-through stage hands each record to the consent rules, which drop,
// hold or pass one frozen copy according to the effective consent state.
import type { TelemetryRecord } from '../utils/eventTypes';
import type { TelemetryLoggerService } from '../utils/logger';
import type { TelemetryUserId } from '../utils/eventTypes';
import type { TelemetryConsentOptions } from '../utils/types';
import type { Inspector } from '../inspector/inspector';
import type { TelemetryConnector, TelemetryConsentState } from './types';
import { frozenCopy, setOwn } from './jsonLike';

// Internal: one gate's state, created per client. Not exported from src/index.ts.
export type ConsentGateState = {
  consent: TelemetryConsentState;
  options: Required<TelemetryConsentOptions>;
  /** The one FIFO store of records waiting for an answer. */
  hold: Readonly<TelemetryRecord>[];
  /** The identity supplied while consent was unknown, or a cleared identity a reset left there. */
  heldIdentity: { id: TelemetryUserId | undefined } | undefined;
  /** The latest identity supplied before the client started. */
  keptIdentity: { id: TelemetryUserId | undefined } | undefined;
  /** Raised on a deny, stays raised across denied to granted. */
  regrantMarker: boolean;
  /** The destroy second guard. */
  closed: boolean;
  /** One operation at a time. */
  busy: boolean;
  /** Operations that arrived while one was running. */
  queue: (() => void)[];
};

// Internal test accessor; exported from this module only.
export type ConsentGateAccessor = {
  holdSize: () => number;
  heldIdentity: () => ConsentGateState['heldIdentity'];
  keptIdentity: () => ConsentGateState['keptIdentity'];
  marker: () => boolean;
  queueSize: () => number;
  closed: () => boolean;
};

const HOLD_LIMIT = 1000;
// The most queued operations one outermost operation runs; the rest are dropped.
const QUEUE_DRAIN_LIMIT = 100;
const USER_FIELDS = [
  'context_user_id',
  'context_user_distinct_id',
  'context_user_email',
  'context_user_username',
  'context_user_first_name',
  'context_user_last_name',
] as const;

// The building blocks of the gate, for tests only. They bypass the queue and the input
// validation, so the client never uses them.
export type ConsentGateTestHooks = {
  setState: (state: TelemetryConsentState) => void;
  effectiveState: () => TelemetryConsentState;
  holdAdd: (copy: Readonly<TelemetryRecord>) => void;
  heldRecords: () => readonly Readonly<TelemetryRecord>[];
  removeUserFields: (copy: Readonly<TelemetryRecord>) => Readonly<TelemetryRecord>;
  raise: () => void;
  lower: (identity: TelemetryUserId | undefined) => void;
  /** Runs a setConsent / identify / resetIdentity gate operation now, or queues it. */
  runQueued: (operation: () => void) => void;
  /** Sets the held identity directly. */
  holdIdentity: (identity: ConsentGateState['heldIdentity']) => void;
  /** Passes an identity change and lowers the re-grant marker when the identity is set. */
  passIdentity: (id: TelemetryUserId | undefined, deps: Pick<ConsentChangeDeps, 'dispatchIdentityChange'>) => void;
};

// The per-client gate closure: what the client uses. Internal: exported from this module only,
// never from src/index.ts.
export type ConsentGate = {
  accessor: ConsentGateAccessor;
  applyRules: (record: TelemetryRecord, deps: ConsentRulesDeps) => void;
  /** Marks the gate busy for a never-queued operation (record rules, start pass, destroy drop). */
  runBusy: (operation: () => void) => void;
  /** The consent change, run through the queue. */
  setConsent: (state: TelemetryConsentState, deps: ConsentChangeDeps) => void;
  /** Stamps the identifier at once, then runs identity through the gate through the queue. */
  identify: (id: TelemetryUserId, deps: IdentityDeps) => void;
  /** Clears the stamp at once, then runs the identity reset through the queue. */
  resetIdentity: (deps: IdentityDeps) => void;
  /** The start-time pass of the effective state and the kept identity, run once after dispatch opens. */
  startPass: (deps: IdentityDeps) => void;
  /** Drops everything held, kept or queued and closes the gate; run once after dispatch closes. */
  destroyDrop: () => void;
  /** For tests only: bypasses the queue and the validation. */
  testHooks: ConsentGateTestHooks;
};

// The shipped user-info manager's stamping operations, run at once and never queued.
export type UserInfoStamp = {
  identify: (id: TelemetryUserId) => void;
  clear: () => void;
};

// What the identity operations need: the consent change's needs plus the stamping.
export type IdentityDeps = ConsentChangeDeps & { userInfo: UserInfoStamp };

// What the consent change needs from the client besides the record rules' needs.
export type ConsentChangeDeps = ConsentRulesDeps & {
  dispatchConsentChange: (state: TelemetryConsentState) => void;
  dispatchIdentityChange: (id: TelemetryUserId | undefined) => void;
  isDispatchOpen: () => boolean;
};

// What the consent rules need from the client: dispatch, the shipped logger and its lifecycle.
export type ConsentRulesDeps = {
  dispatchRecord: (frozen: Readonly<TelemetryRecord>) => void;
  logger: Pick<TelemetryLoggerService, 'logError'>;
  isDestroyed: () => boolean;
};

// The development hint the start pass shows when consent is not yet granted.
function startHint(effective: TelemetryConsentState, holdWhileUnknown: boolean): string {
  if (effective === 'unknown' && holdWhileUnknown) {
    return `consent is unknown: records for connectors wait in the hold (up to ${HOLD_LIMIT}) until setConsent('granted'); set consent.unsetCountsAsGranted to pass them at once`;
  }
  return `consent is ${effective}${effective === 'unknown' ? ' and holding is off' : ''}: records for connectors are dropped until setConsent('granted')`;
}

export function createConsentGate(params: {
  consent?: TelemetryConsentOptions;
  inspector: Pick<Inspector, 'notice'>;
  /** Whether any connector has a record handler; the start pass hints at consent only then. */
  hasRecordHandler?: boolean;
}): ConsentGate {
  const state: ConsentGateState = {
    consent: 'unknown',
    options: {
      // Only exactly true turns the first on and only exactly false turns the second off.
      unsetCountsAsGranted: params.consent?.unsetCountsAsGranted === true,
      holdWhileUnknown: params.consent?.holdWhileUnknown !== false,
    },
    hold: [],
    heldIdentity: undefined,
    keptIdentity: undefined,
    regrantMarker: false,
    closed: false,
    busy: false,
    queue: [],
  };
  let noticeShown = false;
  let drainNoticeShown = false;

  // @cpt-algo:cpt-frontx-telemetry-algo-consent-gate-effective-state:p1
  const effectiveState = (): TelemetryConsentState => {
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-effective-state:p1:inst-eff-return-set
    if (state.consent === 'granted' || state.consent === 'denied') {
      return state.consent;
    }
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-effective-state:p1:inst-eff-return-set
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-effective-state:p1:inst-eff-unset-granted
    if (state.options.unsetCountsAsGranted) {
      return 'granted';
    }
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-effective-state:p1:inst-eff-unset-granted
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-effective-state:p1:inst-eff-return-unknown
    return 'unknown';
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-effective-state:p1:inst-eff-return-unknown
  };

  // @cpt-state:cpt-frontx-telemetry-state-consent-gate-regrant-marker:p1
  const raise = (): void => {
    // @cpt-begin:cpt-frontx-telemetry-state-consent-gate-regrant-marker:p1:inst-rm-raise
    state.regrantMarker = true;
    // @cpt-end:cpt-frontx-telemetry-state-consent-gate-regrant-marker:p1:inst-rm-raise
  };
  const lower = (identity: TelemetryUserId | undefined): void => {
    // @cpt-begin:cpt-frontx-telemetry-state-consent-gate-regrant-marker:p1:inst-rm-stay
    if (identity === undefined) {
      return;
    }
    // @cpt-end:cpt-frontx-telemetry-state-consent-gate-regrant-marker:p1:inst-rm-stay
    // @cpt-begin:cpt-frontx-telemetry-state-consent-gate-regrant-marker:p1:inst-rm-lower
    state.regrantMarker = false;
    // @cpt-end:cpt-frontx-telemetry-state-consent-gate-regrant-marker:p1:inst-rm-lower
  };

  const setState = (next: TelemetryConsentState): void => {
    state.consent = next;
  };

  // @cpt-algo:cpt-frontx-telemetry-algo-consent-gate-hold:p1
  const holdAdd = (copy: Readonly<TelemetryRecord>): void => {
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-hold:p1:inst-hold-check-full
    if (state.hold.length >= HOLD_LIMIT) {
      // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-hold:p1:inst-hold-evict-oldest
      state.hold.shift();
      // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-hold:p1:inst-hold-evict-oldest
      // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-hold:p1:inst-hold-check-notice
      if (!noticeShown) {
        noticeShown = true;
        // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-hold:p1:inst-hold-notice
        params.inspector.notice(
          `consent hold is full (${HOLD_LIMIT} records); the oldest held records are being dropped`,
        );
        // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-hold:p1:inst-hold-notice
      }
      // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-hold:p1:inst-hold-check-notice
    }
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-hold:p1:inst-hold-check-full
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-hold:p1:inst-hold-add
    state.hold.push(copy);
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-hold:p1:inst-hold-add
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-hold:p1:inst-hold-return
    return;
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-hold:p1:inst-hold-return
  };

  // @cpt-algo:cpt-frontx-telemetry-algo-consent-gate-regrant-removal:p1
  const removeUserFields = (copy: Readonly<TelemetryRecord>): Readonly<TelemetryRecord> => {
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-regrant-removal:p1:inst-rg-check-marker
    if (!state.regrantMarker) {
      return copy;
    }
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-regrant-removal:p1:inst-rg-check-marker
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-regrant-removal:p1:inst-rg-build
    const removed = new Set<string>(USER_FIELDS);
    const rebuilt: Record<string, unknown> = {};
    for (const key of Object.keys(copy)) {
      if (!removed.has(key)) {
        setOwn(rebuilt, key, (copy as Record<string, unknown>)[key]);
      }
    }
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-regrant-removal:p1:inst-rg-build
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-regrant-removal:p1:inst-rg-freeze
    Object.freeze(rebuilt);
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-regrant-removal:p1:inst-rg-freeze
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-regrant-removal:p1:inst-rg-return
    return rebuilt as Readonly<TelemetryRecord>;
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-regrant-removal:p1:inst-rg-return
  };

  // @cpt-algo:cpt-frontx-telemetry-algo-consent-gate-apply-rules:p1
  const applyRules = (record: TelemetryRecord, deps: ConsentRulesDeps): void => {
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-apply-rules:p1:inst-rules-check-closed
    if (state.closed) {
      return;
    }
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-apply-rules:p1:inst-rules-check-closed
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-apply-rules:p1:inst-rules-read-state
    const effective = effectiveState();
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-apply-rules:p1:inst-rules-read-state
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-apply-rules:p1:inst-rules-check-drop
    if (effective === 'denied' || (effective === 'unknown' && !state.options.holdWhileUnknown)) {
      // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-apply-rules:p1:inst-rules-drop
      // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-apply-rules:p1:inst-rules-return-dropped
      return;
      // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-apply-rules:p1:inst-rules-return-dropped
      // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-apply-rules:p1:inst-rules-drop
    }
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-apply-rules:p1:inst-rules-check-drop
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-apply-rules:p1:inst-rules-copy
    const copy = frozenCopy(record, deps.logger);
    if (copy === undefined) {
      return;
    }
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-apply-rules:p1:inst-rules-copy
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-apply-rules:p1:inst-rules-strip
    const received = removeUserFields(copy);
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-apply-rules:p1:inst-rules-strip
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-apply-rules:p1:inst-rules-check-granted
    if (effective === 'granted') {
      // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-apply-rules:p1:inst-rules-pass
      deps.dispatchRecord(received);
      // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-apply-rules:p1:inst-rules-pass
    }
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-apply-rules:p1:inst-rules-check-granted
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-apply-rules:p1:inst-rules-check-hold
    else {
      // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-apply-rules:p1:inst-rules-hold
      holdAdd(received);
      // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-apply-rules:p1:inst-rules-hold
    }
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-apply-rules:p1:inst-rules-check-hold
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-apply-rules:p1:inst-rules-return
    return;
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-apply-rules:p1:inst-rules-return
  };

  // Marks the gate busy for an operation that is never queued (applying the rules to a record,
  // the start pass, the destroy drop). Nested inside a running operation it simply runs; as the
  // outermost operation it drains the queue once it ends, also when an operation threw, and then
  // rethrows the first error so the caller still sees it.
  const runBusy = (operation: () => void): void => {
    if (state.busy) {
      operation();
      return;
    }
    let firstError: { error: unknown } | undefined;
    const attempt = (run: () => void): void => {
      try {
        run();
      } catch (error) {
        // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-operation-queue:p1:inst-q-remember-throw
        firstError ??= { error };
        // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-operation-queue:p1:inst-q-remember-throw
      }
    };
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-operation-queue:p1:inst-q-run
    state.busy = true;
    attempt(operation);
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-operation-queue:p1:inst-q-run
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-operation-queue:p1:inst-q-each-queued
    let ran = 0;
    while (state.queue.length > 0) {
      // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-operation-queue:p1:inst-q-check-limit
      if (ran >= QUEUE_DRAIN_LIMIT) {
        state.queue = [];
        if (!drainNoticeShown) {
          drainNoticeShown = true;
          // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-operation-queue:p1:inst-q-limit-notice
          params.inspector.notice(
            'connector handlers keep calling setConsent, identify or resetIdentity; the remaining queued calls were dropped',
          );
          // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-operation-queue:p1:inst-q-limit-notice
        }
        break;
      }
      // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-operation-queue:p1:inst-q-check-limit
      ran += 1;
      const next = state.queue.shift() as () => void;
      // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-operation-queue:p1:inst-q-run-queued
      attempt(next);
      // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-operation-queue:p1:inst-q-run-queued
    }
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-operation-queue:p1:inst-q-each-queued
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-operation-queue:p1:inst-q-return
    state.busy = false;
    if (firstError) {
      throw firstError.error;
    }
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-operation-queue:p1:inst-q-return
  };

  // Runs a setConsent, identify or resetIdentity gate operation now, or queues it while another
  // gate operation runs. The non-gate parts (identify stamping, stamp clear) stay with the caller.
  // @cpt-algo:cpt-frontx-telemetry-algo-consent-gate-operation-queue:p1
  const runQueued = (operation: () => void): void => {
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-operation-queue:p1:inst-q-check-busy
    if (state.busy) {
      // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-operation-queue:p1:inst-q-enqueue
      state.queue.push(operation);
      return;
      // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-operation-queue:p1:inst-q-enqueue
    }
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-operation-queue:p1:inst-q-check-busy
    runBusy(operation);
  };

  const passIdentity = (
    id: TelemetryUserId | undefined,
    deps: Pick<ConsentChangeDeps, 'dispatchIdentityChange'>,
  ): void => {
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-identity-through-gate:p1:inst-idg-pass
    deps.dispatchIdentityChange(id);
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-identity-through-gate:p1:inst-idg-pass
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-identity-through-gate:p1:inst-idg-lower-marker
    lower(id);
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-identity-through-gate:p1:inst-idg-lower-marker
  };

  // @cpt-algo:cpt-frontx-telemetry-algo-consent-gate-consent-change:p1
  // @cpt-flow:cpt-frontx-telemetry-flow-consent-gate-connector-reads:p1
  // @cpt-state:cpt-frontx-telemetry-state-consent-gate-consent-state:p1
  const consentChange = (next: TelemetryConsentState, deps: ConsentChangeDeps): void => {
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-consent-change:p1:inst-chg-check-destroyed
    if (deps.isDestroyed() || state.closed) {
      return;
    }
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-consent-change:p1:inst-chg-check-destroyed
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-consent-change:p1:inst-chg-check-valid
    if (next !== 'unknown' && next !== 'granted' && next !== 'denied') {
      deps.logger.logError('Telemetry: setConsent ignored, not a consent state', next);
      return;
    }
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-consent-change:p1:inst-chg-check-valid
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-consent-change:p1:inst-chg-update
    const before = effectiveState();
    setState(next);
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-consent-change:p1:inst-chg-update
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-consent-change:p1:inst-chg-check-same
    const after = effectiveState();
    // @cpt-begin:cpt-frontx-telemetry-state-consent-gate-consent-state:p1:inst-cs-same-state
    // @cpt-begin:cpt-frontx-telemetry-state-consent-gate-consent-state:p1:inst-cs-granted-unknown
    if (after === before) {
      return;
    }
    // @cpt-end:cpt-frontx-telemetry-state-consent-gate-consent-state:p1:inst-cs-granted-unknown
    // @cpt-end:cpt-frontx-telemetry-state-consent-gate-consent-state:p1:inst-cs-same-state
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-consent-change:p1:inst-chg-check-same
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-consent-change:p1:inst-chg-pass-state
    // @cpt-begin:cpt-frontx-telemetry-state-consent-gate-consent-state:p1:inst-cs-granted-denied
    // @cpt-begin:cpt-frontx-telemetry-state-consent-gate-consent-state:p1:inst-cs-denied-unknown
    // @cpt-begin:cpt-frontx-telemetry-flow-consent-gate-connector-reads:p1:inst-cr-change-call
    deps.dispatchConsentChange(after);
    // @cpt-end:cpt-frontx-telemetry-flow-consent-gate-connector-reads:p1:inst-cr-change-call
    // @cpt-end:cpt-frontx-telemetry-state-consent-gate-consent-state:p1:inst-cs-denied-unknown
    // @cpt-end:cpt-frontx-telemetry-state-consent-gate-consent-state:p1:inst-cs-granted-denied
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-consent-change:p1:inst-chg-pass-state
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-consent-change:p1:inst-chg-check-granted
    // @cpt-begin:cpt-frontx-telemetry-state-consent-gate-consent-state:p1:inst-cs-unknown-granted
    // @cpt-begin:cpt-frontx-telemetry-state-consent-gate-consent-state:p1:inst-cs-denied-granted
    // @cpt-begin:cpt-frontx-telemetry-flow-consent-gate-connector-reads:p1:inst-cr-check-granted
    if (after === 'granted') {
      // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-consent-change:p1:inst-chg-snapshot
      const records = state.hold;
      const identity = state.heldIdentity;
      state.hold = [];
      state.heldIdentity = undefined;
      // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-consent-change:p1:inst-chg-snapshot
      // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-consent-change:p1:inst-chg-release-identity
      if (identity !== undefined) {
        passIdentity(identity.id, deps);
      }
      // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-consent-change:p1:inst-chg-release-identity
      // The connector may start its own sending after the consent change and the identity.
      // @cpt-begin:cpt-frontx-telemetry-flow-consent-gate-connector-reads:p1:inst-cr-may-send
      // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-consent-change:p1:inst-chg-each-held
      for (const record of records) {
        // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-consent-change:p1:inst-chg-stop-destroyed
        if (deps.isDestroyed()) {
          break;
        }
        // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-consent-change:p1:inst-chg-stop-destroyed
        // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-consent-change:p1:inst-chg-pass-held
        deps.dispatchRecord(record);
        // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-consent-change:p1:inst-chg-pass-held
      }
      // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-consent-change:p1:inst-chg-each-held
      // @cpt-end:cpt-frontx-telemetry-flow-consent-gate-connector-reads:p1:inst-cr-may-send
    }
    // @cpt-end:cpt-frontx-telemetry-flow-consent-gate-connector-reads:p1:inst-cr-check-granted
    // @cpt-end:cpt-frontx-telemetry-state-consent-gate-consent-state:p1:inst-cs-denied-granted
    // @cpt-end:cpt-frontx-telemetry-state-consent-gate-consent-state:p1:inst-cs-unknown-granted
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-consent-change:p1:inst-chg-check-granted
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-consent-change:p1:inst-chg-check-denied
    // @cpt-begin:cpt-frontx-telemetry-state-consent-gate-consent-state:p1:inst-cs-unknown-denied
    // @cpt-begin:cpt-frontx-telemetry-flow-consent-gate-connector-reads:p1:inst-cr-check-denied
    else if (after === 'denied') {
      // The connector clears whatever it holds for its backend on this change.
      // @cpt-begin:cpt-frontx-telemetry-flow-consent-gate-connector-reads:p1:inst-cr-must-stop
      // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-consent-change:p1:inst-chg-drop-held
      state.hold = [];
      state.heldIdentity = undefined;
      state.keptIdentity = undefined;
      raise();
      // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-consent-change:p1:inst-chg-drop-held
      // @cpt-end:cpt-frontx-telemetry-flow-consent-gate-connector-reads:p1:inst-cr-must-stop
    }
    // @cpt-end:cpt-frontx-telemetry-flow-consent-gate-connector-reads:p1:inst-cr-check-denied
    // @cpt-end:cpt-frontx-telemetry-state-consent-gate-consent-state:p1:inst-cs-unknown-denied
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-consent-change:p1:inst-chg-check-denied
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-consent-change:p1:inst-chg-return
    // @cpt-begin:cpt-frontx-telemetry-flow-consent-gate-connector-reads:p1:inst-cr-return
    return;
    // @cpt-end:cpt-frontx-telemetry-flow-consent-gate-connector-reads:p1:inst-cr-return
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-consent-change:p1:inst-chg-return
  };

  const setConsent = (next: TelemetryConsentState, deps: ConsentChangeDeps): void =>
    runQueued(() => consentChange(next, deps));

  // The one place an identity change is passed: a set identity lowers the re-grant marker,
  // a cleared one never does.
  // @cpt-algo:cpt-frontx-telemetry-algo-consent-gate-identity-through-gate:p1
  const identityThroughGate = (id: TelemetryUserId, deps: IdentityDeps): void => {
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-identity-through-gate:p1:inst-idg-check-closed
    if (deps.isDestroyed() || state.closed) {
      return;
    }
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-identity-through-gate:p1:inst-idg-check-closed
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-identity-through-gate:p1:inst-idg-keep-before-start
    if (!deps.isDispatchOpen()) {
      if (effectiveState() !== 'denied') {
        state.keptIdentity = { id };
      }
      return;
    }
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-identity-through-gate:p1:inst-idg-keep-before-start
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-identity-through-gate:p1:inst-idg-read-state
    const effective = effectiveState();
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-identity-through-gate:p1:inst-idg-read-state
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-identity-through-gate:p1:inst-idg-check-granted
    if (effective === 'granted') {
      passIdentity(id, deps);
    }
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-identity-through-gate:p1:inst-idg-check-granted
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-identity-through-gate:p1:inst-idg-check-unknown
    else if (effective === 'unknown') {
      // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-identity-through-gate:p1:inst-idg-hold
      state.heldIdentity = { id };
      // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-identity-through-gate:p1:inst-idg-hold
    }
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-identity-through-gate:p1:inst-idg-check-unknown
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-identity-through-gate:p1:inst-idg-check-denied
    else {
      // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-identity-through-gate:p1:inst-idg-drop
      state.heldIdentity = undefined;
      // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-identity-through-gate:p1:inst-idg-drop
    }
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-identity-through-gate:p1:inst-idg-check-denied
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-identity-through-gate:p1:inst-idg-return
    return;
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-identity-through-gate:p1:inst-idg-return
  };

  const identify = (id: TelemetryUserId, deps: IdentityDeps): void => {
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-operation-queue:p1:inst-q-run-stamp
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-identity-through-gate:p1:inst-idg-shipped-stamp
    deps.userInfo.identify(id);
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-identity-through-gate:p1:inst-idg-shipped-stamp
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-operation-queue:p1:inst-q-run-stamp
    runQueued(() => identityThroughGate(id, deps));
  };

  // @cpt-algo:cpt-frontx-telemetry-algo-consent-gate-identity-reset:p1
  const identityReset = (deps: IdentityDeps): void => {
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-identity-reset:p1:inst-rst-check-closed
    if (deps.isDestroyed() || state.closed) {
      return;
    }
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-identity-reset:p1:inst-rst-check-closed
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-identity-reset:p1:inst-rst-before-start
    if (!deps.isDispatchOpen()) {
      state.keptIdentity = undefined;
      return;
    }
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-identity-reset:p1:inst-rst-before-start
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-identity-reset:p1:inst-rst-read-state
    const effective = effectiveState();
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-identity-reset:p1:inst-rst-read-state
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-identity-reset:p1:inst-rst-check-granted
    if (effective === 'granted') {
      // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-identity-reset:p1:inst-rst-pass-cleared
      passIdentity(undefined, deps);
      // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-identity-reset:p1:inst-rst-pass-cleared
    }
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-identity-reset:p1:inst-rst-check-granted
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-identity-reset:p1:inst-rst-check-unknown
    else if (effective === 'unknown') {
      // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-identity-reset:p1:inst-rst-hold-cleared
      state.heldIdentity = { id: undefined };
      // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-identity-reset:p1:inst-rst-hold-cleared
    }
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-identity-reset:p1:inst-rst-check-unknown
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-identity-reset:p1:inst-rst-check-denied
    else {
      // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-identity-reset:p1:inst-rst-nothing
      state.heldIdentity = undefined;
      // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-identity-reset:p1:inst-rst-nothing
    }
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-identity-reset:p1:inst-rst-check-denied
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-identity-reset:p1:inst-rst-return
    return;
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-identity-reset:p1:inst-rst-return
  };

  const resetIdentity = (deps: IdentityDeps): void => {
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-operation-queue:p1:inst-q-run-stamp
    deps.userInfo.clear();
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-operation-queue:p1:inst-q-run-stamp
    runQueued(() => identityReset(deps));
  };

  // The start-time pass, run once at the start attach point right after dispatch opens. A
  // connector's consent handler may destroy the client, so the pass checks after each step that
  // calls connectors. Handler calls to setConsent / identify / resetIdentity are queued by runBusy.
  // @cpt-algo:cpt-frontx-telemetry-algo-consent-gate-start-pass:p1
  const startPass = (deps: IdentityDeps): void => {
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-start-pass:p1:inst-sp-check-closed
    if (deps.isDestroyed() || state.closed) {
      return;
    }
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-start-pass:p1:inst-sp-check-closed
    runBusy(() => {
      // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-start-pass:p1:inst-sp-read-state
      const effective = effectiveState();
      // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-start-pass:p1:inst-sp-read-state
      // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-start-pass:p1:inst-sp-check-hint
      if (params.hasRecordHandler && effective !== 'granted') {
        // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-start-pass:p1:inst-sp-hint-notice
        params.inspector.notice(startHint(effective, state.options.holdWhileUnknown));
        // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-start-pass:p1:inst-sp-hint-notice
      }
      // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-start-pass:p1:inst-sp-check-hint
      // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-start-pass:p1:inst-sp-pass
      // @cpt-begin:cpt-frontx-telemetry-flow-consent-gate-connector-reads:p1:inst-cr-start-call
      deps.dispatchConsentChange(effective);
      // @cpt-end:cpt-frontx-telemetry-flow-consent-gate-connector-reads:p1:inst-cr-start-call
      // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-start-pass:p1:inst-sp-pass
      // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-start-pass:p1:inst-sp-check-destroyed-after-state
      if (deps.isDestroyed()) {
        return;
      }
      // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-start-pass:p1:inst-sp-check-destroyed-after-state
      // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-start-pass:p1:inst-sp-check-kept
      const kept = state.keptIdentity;
      state.keptIdentity = undefined;
      if (kept !== undefined) {
        // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-start-pass:p1:inst-sp-kept-granted
        if (effective === 'granted') {
          passIdentity(kept.id, deps);
        }
        // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-start-pass:p1:inst-sp-kept-granted
        // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-start-pass:p1:inst-sp-kept-unknown
        else if (effective === 'unknown') {
          state.heldIdentity = kept;
        }
        // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-start-pass:p1:inst-sp-kept-unknown
        // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-start-pass:p1:inst-sp-kept-denied
        else {
          state.heldIdentity = undefined;
        }
        // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-start-pass:p1:inst-sp-kept-denied
      }
      // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-start-pass:p1:inst-sp-check-kept
      // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-start-pass:p1:inst-sp-check-destroyed-after-kept
      if (deps.isDestroyed()) {
        return;
      }
      // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-start-pass:p1:inst-sp-check-destroyed-after-kept
    });
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-start-pass:p1:inst-sp-return
    return;
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-start-pass:p1:inst-sp-return
  };

  // The destroy drop, run at the destroy attach point right after dispatch closes.
  // @cpt-algo:cpt-frontx-telemetry-algo-consent-gate-destroy-drop:p1
  const destroyDrop = (): void => {
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-destroy-drop:p1:inst-dd-drop-all
    state.hold = [];
    state.heldIdentity = undefined;
    state.keptIdentity = undefined;
    state.queue = [];
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-destroy-drop:p1:inst-dd-drop-all
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-destroy-drop:p1:inst-dd-close
    state.closed = true;
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-destroy-drop:p1:inst-dd-close
    // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-destroy-drop:p1:inst-dd-return
    return;
    // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-destroy-drop:p1:inst-dd-return
  };

  return {
    startPass,
    destroyDrop,
    applyRules,
    runBusy,
    setConsent,
    identify,
    resetIdentity,
    accessor: {
      holdSize: () => state.hold.length,
      heldIdentity: () => state.heldIdentity,
      keptIdentity: () => state.keptIdentity,
      marker: () => state.regrantMarker,
      queueSize: () => state.queue.length,
      closed: () => state.closed,
    },
    testHooks: {
      setState,
      effectiveState,
      holdAdd,
      heldRecords: () => [...state.hold],
      removeUserFields,
      raise,
      lower,
      runQueued,
      holdIdentity: (identity) => {
        state.heldIdentity = identity;
      },
      passIdentity,
    },
  };
}

// The client's gate stage. Connectors are fixed at construction, so whether any of them has a
// record handler is worked out once here rather than for every record. The record then goes to
// the gate's consent rules, which copy it only when it is passed or held.
export function createGateStage(
  connectors: readonly TelemetryConnector[],
  dispatchRecord: (frozen: Readonly<TelemetryRecord>) => void,
  logger: Pick<TelemetryLoggerService, 'logError'>,
  gate: ConsentGate,
  isDestroyed: () => boolean,
): (record: TelemetryRecord) => void {
  const hasRecordHandler = connectors.some((connector) => !!connector.onRecord);
  const rules = (record: TelemetryRecord) =>
    gate.runBusy(() => gate.applyRules(record, { dispatchRecord, logger, isDestroyed }));
  return (record) => passThroughRecord(record, rules, hasRecordHandler);
}

// @cpt-algo:cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through:p1
export function passThroughRecord<T extends object>(
  data: T,
  applyRules: (record: T) => void,
  hasRecordHandler = true,
): void {
  // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through:p1:inst-skip-without-record-handlers
  if (!hasRecordHandler) {
    return;
  }
  // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through:p1:inst-skip-without-record-handlers
  // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through:p1:inst-pass-at-once
  applyRules(data);
  // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through:p1:inst-pass-at-once
  // @cpt-begin:cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through:p1:inst-return-passed
  return;
  // @cpt-end:cpt-frontx-telemetry-algo-connector-delivery-gate-pass-through:p1:inst-return-passed
}
