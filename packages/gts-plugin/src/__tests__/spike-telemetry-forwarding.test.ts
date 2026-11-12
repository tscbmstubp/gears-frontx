/**
 * @vitest-environment jsdom
 *
 * SPIKE (VHP-4250) — not for merge. Can a telemetry event emitted inside a
 * microfrontend reach a host-owned action in the shell over the existing
 * host-microfrontend contract (child bridge `executeActionsChain` up, shared
 * property down)?
 *
 * Runs the real `GtsPlugin` store and the real `@gears-frontx/mfes` registry,
 * because the questions are about what the shipped validation and bridge
 * lifecycle actually do.
 *
 *   Q1  Does a telemetry action (one event, and a batch) pass the type-system
 *       validation, or does it need a schema registered first?
 *   Q2  What does one forwarded event cost; is batching needed from day one?
 *   Q3  Can the microfrontend forward pending events at unmount, before its
 *       bridge is deactivated? What is the unmount order?
 *   Q4  Can the shell tell which microfrontend and extension an event came
 *       from, without trusting what the microfrontend says?
 */
import { describe, it, expect, vi } from 'vitest';
import {
  createMfeRegistryFactory,
  MfeHandler,
  MfeBridgeFactory,
  ChildMfeBridge,
  ExtensionDomainImplementation,
  ExtensionDomainImplementationFactory,
  ConcurrentMountStrategy,
  ActionHandler,
  type ActionsChain,
  type MfeEntryLifecycle,
  type DomainContext,
  type ContainerHooks,
  type Extension,
  type ExtensionDomain,
  type MfeEntry,
} from '@gears-frontx/mfes';
// @internal — colocated test, direct relative import is permitted.
import { GtsPlugin } from '../plugin';
import type { JSONSchema } from '../types';

// ─── Fixture ids ────────────────────────────────────────────────────────────

const DOMAIN_ID = 'gts.frontx.mfes.ext.domain.v1~test.telemetryspike.fixture.screens.v1';
const ENTRY_A = 'gts.frontx.mfes.mfe.entry.v1~test.telemetryspike.fixture.billing.v1';
const ENTRY_B = 'gts.frontx.mfes.mfe.entry.v1~test.telemetryspike.fixture.users.v1';
const EXT_A = 'gts.frontx.mfes.ext.extension.v1~test.telemetryspike.fixture.billing.v1';
const EXT_B = 'gts.frontx.mfes.ext.extension.v1~test.telemetryspike.fixture.users.v1';

/** The telemetry action: a derived action type carrying a batch of events. */
const TELEMETRY_ACTION = 'gts.frontx.mfes.comm.action.v1~test.telemetryspike.comm.track.v1~';

const MAX_BATCH = 100;

/**
 * Closed, self-contained action schema in the style of the shipped
 * `unmount_ext` schema. One shape for a single event and a batch: always an
 * array, so the MFE side can batch later without a contract change.
 */
const TELEMETRY_ACTION_SCHEMA: JSONSchema = {
  $id: `gts://${TELEMETRY_ACTION}`,
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  additionalProperties: false,
  properties: {
    type: { 'x-gts-type-ref': '/$id' },
    target: { 'x-gts-instance-ref': 'gts.frontx.mfes.ext.domain.v1~*' },
    payload: {
      type: 'object',
      additionalProperties: false,
      properties: {
        events: {
          type: 'array',
          minItems: 1,
          maxItems: MAX_BATCH,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              name: { type: 'string', maxLength: 200 },
              props: { type: 'object' },
              ts: { type: 'number' },
            },
            required: ['name', 'ts'],
          },
        },
      },
      required: ['events'],
    },
    timeout: { type: 'number', minimum: 1 },
  },
  required: ['type', 'target', 'payload'],
};

// ─── Harness ────────────────────────────────────────────────────────────────

type TelemetryEvent = { name: string; props?: Record<string, unknown>; ts: number };
type Received = { actionTypeId: string; payload: Record<string, unknown> | undefined; extra: unknown[] };

class NoopContainerHooks implements ContainerHooks {
  create(): Element { return document.createElement('div'); }
  destroy(): void { /* noop */ }
}

class SpikeDomainImpl extends ExtensionDomainImplementation {
  readonly strategy: ConcurrentMountStrategy;
  constructor(ctx: DomainContext, telemetryHandler: ActionHandler | undefined) {
    super();
    this.strategy = new ConcurrentMountStrategy(ctx.mounter, new NoopContainerHooks());
    ctx.registerHandler(
      ctx.typeSystem.resolveMountExtActionId(),
      ActionHandler.fromFunction((_t, p) => this.strategy.mount(p as { subject: string }))
    );
    ctx.registerHandler(
      ctx.typeSystem.resolveUnmountExtActionId(),
      ActionHandler.fromFunction((_t, p) => this.strategy.unmount!(p as { subject: string }))
    );
    if (telemetryHandler) {
      ctx.registerHandler(TELEMETRY_ACTION, telemetryHandler);
    }
  }
  protected getMountStrategies() { return [this.strategy]; }
}

class SpikeDomainFactory extends ExtensionDomainImplementationFactory {
  constructor(private readonly telemetryHandler: ActionHandler | undefined) { super(); }
  build(ctx: DomainContext): SpikeDomainImpl {
    return new SpikeDomainImpl(ctx, this.telemetryHandler);
  }
}

/** Never used for mounting: the registry mints bridges itself. */
class UnusedBridgeFactory extends MfeBridgeFactory {
  create(): ChildMfeBridge { throw new Error('not used by the registry mount path'); }
  dispose(): void { /* unused */ }
}

/** A microfrontend whose mount/unmount bodies the test controls. */
type MfeScript = {
  onMount?: (bridge: ChildMfeBridge) => void;
  onUnmount?: (bridge: ChildMfeBridge) => void | Promise<void>;
};

class ScriptedHandler extends MfeHandler {
  readonly bridgeFactory = new UnusedBridgeFactory();
  readonly bridges = new Map<string, ChildMfeBridge>();
  constructor(entryTypeId: string, private readonly scripts: Map<string, MfeScript>, private readonly log: string[]) {
    super(entryTypeId);
  }
  async load(entry: MfeEntry): Promise<MfeEntryLifecycle<ChildMfeBridge>> {
    const script = this.scripts.get(entry.id) ?? {};
    let held: ChildMfeBridge | undefined;
    return {
      mount: (_container, bridge) => {
        held = bridge;
        this.bridges.set(bridge.extensionId, bridge);
        this.log.push(`mfe.mount ${short(bridge.extensionId)}`);
        script.onMount?.(bridge);
      },
      unmount: async () => {
        this.log.push(`mfe.unmount:start ${short(held!.extensionId)}`);
        await script.onUnmount?.(held!);
        this.log.push(`mfe.unmount:end ${short(held!.extensionId)}`);
      },
    };
  }
}

function short(id: string): string {
  return id.slice(id.lastIndexOf('.', id.length - 4) + 1);
}

function telemetryChain(events: TelemetryEvent[], extraPayload: Record<string, unknown> = {}): ActionsChain {
  return { action: { type: TELEMETRY_ACTION, target: DOMAIN_ID, payload: { events, ...extraPayload } } };
}

function event(name: string, i = 0): TelemetryEvent {
  return { name, props: { step: 'review', position: 2, steps: 3 }, ts: 1_700_000_000_000 + i };
}

/** One macrotask: every synchronous and microtask continuation has run. */
const settle = () => new Promise<void>((r) => setTimeout(r, 0));

async function setupShell(opts: {
  /** Register the telemetry action schema before anything else (default true). */
  registerSchema?: boolean;
  /** Schema to register instead of TELEMETRY_ACTION_SCHEMA. */
  schema?: JSONSchema;
  /** Register the shell's telemetry handler on the domain (default true). */
  withHandler?: boolean;
  /** Where the domain lists the telemetry action (default ['actions']). */
  declareIn?: ReadonlyArray<'actions' | 'extensionsActions'>;
  /** domainActions on both fixture entries (default []). */
  entryDomainActions?: string[];
  scripts?: Map<string, MfeScript>;
} = {}) {
  const registerSchema = opts.registerSchema ?? true;
  const withHandler = opts.withHandler ?? true;
  const declareIn = opts.declareIn ?? ['actions'];
  const log: string[] = [];
  const received: Received[] = [];
  const plugin = new GtsPlugin({ isolated: true });
  if (registerSchema) {
    plugin.registerSchema(opts.schema ?? TELEMETRY_ACTION_SCHEMA);
  }
  const registerSpy = vi.spyOn(plugin, 'register');

  const telemetryHandler = new (class extends ActionHandler {
    async handleAction(actionTypeId: string, payload: Record<string, unknown> | undefined, ...extra: unknown[]) {
      log.push(`shell.telemetry ${(payload?.events as TelemetryEvent[] | undefined)?.map((e) => e.name).join(',')}`);
      received.push({ actionTypeId, payload, extra });
    }
  })();

  const scripts = opts.scripts ?? new Map<string, MfeScript>();
  const handler = new ScriptedHandler('gts.frontx.mfes.mfe.entry.v1~', scripts, log);
  const registry = createMfeRegistryFactory().build({ typeSystem: plugin, mfeHandlers: [handler] });

  for (const id of [ENTRY_A, ENTRY_B]) {
    plugin.register({ id, requiredProperties: [], actions: [], domainActions: opts.entryDomainActions ?? [] } satisfies MfeEntry);
  }
  const domain: ExtensionDomain = {
    id: DOMAIN_ID,
    actions: [
      plugin.resolveLoadExtActionId(),
      plugin.resolveMountExtActionId(),
      plugin.resolveUnmountExtActionId(),
      ...(declareIn.includes('actions') ? [TELEMETRY_ACTION] : []),
    ],
    extensionsActions: declareIn.includes('extensionsActions') ? [TELEMETRY_ACTION] : [],
    sharedProperties: [],
    defaultActionTimeout: 5000,
    lifecycleStages: [],
    extensionsLifecycleStages: [],
  };
  registry.registerDomain(domain, new SpikeDomainFactory(withHandler ? telemetryHandler : undefined));
  for (const [id, entry] of [[EXT_A, ENTRY_A], [EXT_B, ENTRY_B]] as const) {
    await registry.registerExtension({ id, domain: DOMAIN_ID, entry } satisfies Extension);
  }
  const mounter = registry.getMounter(DOMAIN_ID);
  mounter.attach(document.createElement('div'));

  // Unmount-order probe: wrap the registry's bridge deactivation so the log
  // shows exactly when it happens relative to the MFE's own unmount.
  const bridgeFactory = (registry as unknown as { bridgeFactory: { deactivateBridge(b: unknown): void } }).bridgeFactory;
  const realDeactivate = bridgeFactory.deactivateBridge.bind(bridgeFactory);
  bridgeFactory.deactivateBridge = (b: unknown) => {
    log.push('runtime.deactivateBridge');
    realDeactivate(b);
  };

  return { plugin, registry, mounter, handler, received, log, registerSpy };
}

// ─── Q1: type-system validation ─────────────────────────────────────────────

describe('Q1 — validation of a telemetry action on the contract', () => {
  it('the shell cannot even wire its handler without the schema: the domain must list the action, and the list only takes registered types', async () => {
    // Handler registered, action not listed in domain.actions → refused.
    const notListed = setupShell({ declareIn: [] });
    await expect(notListed).rejects.toThrow(/not declared in declaration\.actions/);
    console.log('[Q1] handler without listing:', await notListed.catch((e: Error) => e.message));

    // Listed in domain.actions, schema not registered → refused at domain registration.
    const noSchema = setupShell({ registerSchema: false });
    await expect(noSchema).rejects.toThrow();
    console.log('[Q1] listing without schema:', String(await noSchema.catch((e: Error) => e.message)).slice(0, 300));

    // Schema registered, listed in domain.actions, handler registered: accepted.
    await expect(setupShell()).resolves.toBeDefined();
  });

  it('extensionsActions is the wrong list: it obliges every entry in the domain to RECEIVE the action', async () => {
    const extList = setupShell({ declareIn: ['actions', 'extensionsActions'] });
    await expect(extList).rejects.toThrow(/unsupported_action/);
    console.log('[Q1] extensionsActions:', await extList.catch((e: Error) => e.message));
  });

  it('an entry that declares the action in domainActions cannot mount in a shell without telemetry', async () => {
    // domainActions ⊆ domain.actions is enforced at admission, so declaring
    // the dependency breaks "an instrumented MFE works unchanged in a shell
    // with no telemetry". The forwarder has to stay undeclared.
    const strict = setupShell({ registerSchema: true, withHandler: false, declareIn: [], entryDomainActions: [TELEMETRY_ACTION] });
    await expect(strict).rejects.toThrow(/Contract validation failed/);
    console.log('[Q1] entry declares, shell lacks:', await strict.catch((e: Error) => e.message));
  });

  it('in a shell with no telemetry, an undeclared forwarder\'s chain is dropped with a console warning that prints the payload', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { mounter, handler, received } = await setupShell({ registerSchema: false, withHandler: false, declareIn: [] });
    await mounter.mount(EXT_A, document.createElement('div'));

    const result = handler.bridges.get(EXT_A)!.executeActionsChain(telemetryChain([event('billing/invoice/paid')]));
    await settle();

    expect(result).toBeUndefined(); // the MFE learns nothing
    expect(received).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('No handler'),
      expect.objectContaining({ events: [expect.objectContaining({ name: 'billing/invoice/paid' })] })
    );
    warn.mockRestore();
  });

  it('with the schema registered, one event and a batch of 100 both pass and reach the shell handler once per call', async () => {
    const { mounter, handler, received } = await setupShell();
    await mounter.mount(EXT_A, document.createElement('div'));
    const bridge = handler.bridges.get(EXT_A)!;

    bridge.executeActionsChain(telemetryChain([event('billing/invoice/paid')]));
    bridge.executeActionsChain(
      telemetryChain(Array.from({ length: MAX_BATCH }, (_, i) => event(`billing/step/viewed`, i)))
    );
    await settle();

    expect(received).toHaveLength(2);
    expect((received[0].payload!.events as unknown[]).length).toBe(1);
    expect((received[1].payload!.events as unknown[]).length).toBe(MAX_BATCH);
  });

  it('the schema enforces shape: an undeclared field, an oversized batch or a wrong type is rejected before the handler', async () => {
    const { mounter, handler, received, registerSpy } = await setupShell();
    await mounter.mount(EXT_A, document.createElement('div'));
    const bridge = handler.bridges.get(EXT_A)!;

    bridge.executeActionsChain(telemetryChain([{ ...event('a/b/c'), email: 'x@y.z' } as TelemetryEvent]));
    bridge.executeActionsChain(telemetryChain(Array.from({ length: MAX_BATCH + 1 }, (_, i) => event('a/b/c', i))));
    bridge.executeActionsChain(telemetryChain([{ name: 'a/b/c', ts: 'now' } as unknown as TelemetryEvent]));
    await settle();

    expect(received).toHaveLength(0);
    const errors = registerSpy.mock.results.filter((r) => r.type === 'throw');
    expect(errors).toHaveLength(3);
    console.log('[Q1] shape rejection, first error:', (errors[0].value as Error).message.slice(0, 300));
  });

  it('nothing checks that the SENDING entry declared the action: an entry with empty actions/domainActions can still send it', async () => {
    // Both fixture entries declare no actions at all (see setupShell).
    const { mounter, handler, received } = await setupShell();
    await mounter.mount(EXT_A, document.createElement('div'));
    handler.bridges.get(EXT_A)!.executeActionsChain(telemetryChain([event('billing/invoice/paid')]));
    await settle();
    expect(received).toHaveLength(1);
  });
});

// ─── Q2: cost ───────────────────────────────────────────────────────────────

describe('Q2 — cost of one forwarded event', () => {
  it('measures per-event cost: one event per call vs batches, and how much of it is GTS validation', async () => {
    const { plugin, mounter, handler, received } = await setupShell();
    await mounter.mount(EXT_A, document.createElement('div'));
    const bridge = handler.bridges.get(EXT_A)!;
    const N = 2000;

    const time = async (label: string, fn: () => void) => {
      // warm-up
      fn();
      await settle();
      received.length = 0;
      const t0 = performance.now();
      fn();
      const tSync = performance.now() - t0;
      await settle();
      const tAll = performance.now() - t0;
      return { label, syncMs: tSync, totalMs: tAll, perEventUs: (tAll * 1000) / N };
    };

    const single = await time('1 event per call', () => {
      for (let i = 0; i < N; i++) bridge.executeActionsChain(telemetryChain([event('billing/step/viewed', i)]));
    });
    expect(received).toHaveLength(N);

    const batch10 = await time('batches of 10', () => {
      for (let i = 0; i < N; i += 10) {
        bridge.executeActionsChain(telemetryChain(Array.from({ length: 10 }, (_, j) => event('billing/step/viewed', i + j))));
      }
    });
    const batch100 = await time('batches of 100', () => {
      for (let i = 0; i < N; i += 100) {
        bridge.executeActionsChain(telemetryChain(Array.from({ length: 100 }, (_, j) => event('billing/step/viewed', i + j))));
      }
    });

    // Validation alone, no dispatch: the GTS share of the single-event cost.
    const validateOnly = await time('GTS validation only, 1 event', () => {
      for (let i = 0; i < N; i++) plugin.register(telemetryChain([event('billing/step/viewed', i)]).action);
    });

    for (const r of [single, batch10, batch100, validateOnly]) {
      console.log(
        `[Q2] ${r.label.padEnd(32)} total ${r.totalMs.toFixed(1)} ms for ${N} events → ${r.perEventUs.toFixed(1)} µs/event (sync part ${r.syncMs.toFixed(1)} ms)`
      );
    }
  }, 120_000);
});

// ─── Q3: unmount ────────────────────────────────────────────────────────────

describe('Q3 — forwarding pending events at unmount', () => {
  it('unmount order: MFE unmount body runs with the bridge still active, then the runtime deactivates the bridge', async () => {
    const scripts = new Map<string, MfeScript>([
      [ENTRY_A, {
        onUnmount: (bridge) => {
          bridge.executeActionsChain(telemetryChain([event('billing/flow/abandoned')]));
        },
      }],
    ]);
    const { mounter, received, log } = await setupShell({ scripts });
    await mounter.mount(EXT_A, document.createElement('div'));
    await mounter.unmount(EXT_A);
    await settle();

    console.log('[Q3] order:', log.join('  →  '));
    expect(received).toHaveLength(1);
    expect(log.indexOf('shell.telemetry billing/flow/abandoned')).toBeLessThan(log.indexOf('runtime.deactivateBridge'));
  });

  it('a flush deferred past unmount (timer, or after an await in an async unmount) is dropped silently', async () => {
    const scripts = new Map<string, MfeScript>([
      [ENTRY_A, {
        onUnmount: async (bridge) => {
          // Typical batching sender: flush on a timer.
          setTimeout(() => bridge.executeActionsChain(telemetryChain([event('billing/flow/abandoned-timer')])), 0);
          // Microtask queued during unmount: runs before the runtime's own continuation.
          queueMicrotask(() => bridge.executeActionsChain(telemetryChain([event('billing/flow/abandoned-microtask')])));
        },
      }],
      [ENTRY_B, {
        onUnmount: async (bridge) => {
          await new Promise((r) => setTimeout(r, 0)); // e.g. awaiting a pending write
          bridge.executeActionsChain(telemetryChain([event('users/flow/abandoned-after-await')]));
        },
      }],
    ]);
    const { mounter, received, log } = await setupShell({ scripts });
    await mounter.mount(EXT_A, document.createElement('div'));
    await mounter.mount(EXT_B, document.createElement('div'));
    await mounter.unmount(EXT_A);
    await mounter.unmount(EXT_B);
    await settle();
    await settle();

    const names = received.flatMap((r) => (r.payload!.events as TelemetryEvent[]).map((e) => e.name));
    console.log('[Q3] delivered:', names, '\n[Q3] order:', log.join('  →  '));
    expect(names).toContain('billing/flow/abandoned-microtask');
    expect(names).not.toContain('billing/flow/abandoned-timer');
    // The await inside an async unmount is still awaited by the runtime, so this one arrives.
    expect(names).toContain('users/flow/abandoned-after-await');
  });

  it('events emitted while unmounted (e.g. a late promise in the MFE) are dropped with no signal to either side', async () => {
    const { mounter, handler, received } = await setupShell();
    await mounter.mount(EXT_A, document.createElement('div'));
    const bridge = handler.bridges.get(EXT_A)!;
    await mounter.unmount(EXT_A);

    expect(() => bridge.executeActionsChain(telemetryChain([event('billing/late/resolved')]))).not.toThrow();
    await settle();
    expect(received).toHaveLength(0);
  });
});

// ─── Q4: attribution ────────────────────────────────────────────────────────

describe('Q4 — can the shell tell which extension sent an event?', () => {
  it('two extensions sending the same chain are indistinguishable to the shell handler', async () => {
    const { mounter, handler, received } = await setupShell();
    await mounter.mount(EXT_A, document.createElement('div'));
    await mounter.mount(EXT_B, document.createElement('div'));

    const same = [event('shared/button/clicked')];
    handler.bridges.get(EXT_A)!.executeActionsChain(telemetryChain(same));
    handler.bridges.get(EXT_B)!.executeActionsChain(telemetryChain(same));
    await settle();

    expect(received).toHaveLength(2);
    // Same arguments, nothing extra: no sender identity reaches the handler.
    expect(received[0]).toEqual(received[1]);
    expect(received[0].extra).toEqual([]);
  });

  it('an extension can claim to be another one in the payload, and nothing on the contract contradicts it', async () => {
    const forgingSchema: JSONSchema = {
      ...TELEMETRY_ACTION_SCHEMA,
      properties: {
        ...(TELEMETRY_ACTION_SCHEMA.properties as Record<string, unknown>),
        payload: {
          ...((TELEMETRY_ACTION_SCHEMA.properties as Record<string, Record<string, unknown>>).payload),
          properties: {
            ...((TELEMETRY_ACTION_SCHEMA.properties as Record<string, Record<string, Record<string, unknown>>>).payload.properties),
            source: { type: 'string' },
          },
        },
      },
    } as JSONSchema;
    const { mounter, handler, received } = await setupShell({ schema: forgingSchema });
    await mounter.mount(EXT_A, document.createElement('div'));

    handler.bridges.get(EXT_A)!.executeActionsChain(telemetryChain([event('users/user/deleted')], { source: EXT_B }));
    await settle();

    expect(received).toHaveLength(1);
    expect(received[0].payload!.source).toBe(EXT_B); // the only identity the shell sees is the forged one
  });

  it('the bridge identity fields are writable from inside the MFE at runtime', async () => {
    const { mounter, handler } = await setupShell();
    await mounter.mount(EXT_A, document.createElement('div'));
    const bridge = handler.bridges.get(EXT_A)! as { extensionId: string };
    // `readonly` is a TypeScript annotation only.
    bridge.extensionId = EXT_B;
    expect(bridge.extensionId).toBe(EXT_B);
  });
});
