import type { TelemetryRecord, TelemetryUserId } from '../utils/eventTypes';
import type { TelemetryContext } from '../utils/types';

export function createUserInfoManager(context: TelemetryContext) {
  let userId: TelemetryUserId | undefined = undefined;

  context.hooks.addHook('event', onEvent);

  return {
    identify,
    clear,
  };

  function identify(newUserId: TelemetryUserId) {
    userId = newUserId;
  }

  // Removes the identifier `identify` stamps, so later records carry no `context_user_id`
  // from this path.
  // @cpt-begin:cpt-frontx-telemetry-algo-consent-gate-identity-reset:p1:inst-rst-clear-stamp
  function clear() {
    userId = undefined;
  }
  // @cpt-end:cpt-frontx-telemetry-algo-consent-gate-identity-reset:p1:inst-rst-clear-stamp

  function onEvent(record: TelemetryRecord) {
    // `0` is a legal TelemetryUserId, so absence is the only reason to skip.
    if (userId === undefined) {
      return;
    }

    record.context_user_id = userId;
  }
}
