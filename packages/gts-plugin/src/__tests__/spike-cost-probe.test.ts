/** SPIKE (VHP-4250) scratch probe — validation cost by payload size and by call count. Not for merge. */
import { it } from 'vitest';
import { GtsPlugin } from '../plugin';
import type { JSONSchema } from '../types';

const DOMAIN_ID = 'gts.frontx.mfes.ext.domain.v1~test.telemetryspike.fixture.screens.v1';
const T = 'gts.frontx.mfes.comm.action.v1~test.telemetryspike.comm.track.v1~';
const schema = (closed: boolean): JSONSchema => ({
  $id: `gts://${T}`, $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', additionalProperties: false,
  properties: {
    type: { 'x-gts-type-ref': '/$id' },
    target: { 'x-gts-instance-ref': 'gts.frontx.mfes.ext.domain.v1~*' },
    payload: closed ? { type: 'object', additionalProperties: false, properties: { events: { type: 'array', maxItems: 100, items: { type: 'object', additionalProperties: false, properties: { name: { type: 'string', maxLength: 200 }, props: { type: 'object' }, ts: { type: 'number' } }, required: ['name', 'ts'] } } }, required: ['events'] } : { type: 'object' },
    timeout: { type: 'number', minimum: 1 },
  },
  required: ['type', 'target', 'payload'],
} as JSONSchema);

function setup(closed: boolean, withDomain: boolean) {
  const p = new GtsPlugin({ isolated: true });
  p.registerSchema(schema(closed));
  if (withDomain) {
    p.register({ id: DOMAIN_ID, actions: [], extensionsActions: [], sharedProperties: [], defaultActionTimeout: 5000, lifecycleStages: [], extensionsLifecycleStages: [] });
  }
  return p;
}
const action = (n: number) => ({ type: T, target: DOMAIN_ID, payload: { events: Array.from({ length: n }, (_, i) => ({ name: 'billing/step/viewed', props: { step: 'review', position: 2, steps: 3 }, ts: 1e12 + i })) } });

function time(p: GtsPlugin, n: number, calls: number) {
  const a = action(n);
  const t0 = performance.now();
  for (let i = 0; i < calls; i++) { try { p.register(a); } catch (e) { if (i === 0) console.log('throws:', (e as Error).message.slice(0, 160)); } }
  return (performance.now() - t0) / calls;
}

it('cost by call count (rounds of 200 single-event validations on one plugin)', () => {
  const p = setup(true, true);
  const rounds = Array.from({ length: 6 }, () => time(p, 1, 200).toFixed(3));
  console.log('[probe] ms/call per round, closed schema, 1 event:', rounds.join('  '));
}, 120_000);

it('cost by payload size, closed vs open schema', () => {
  for (const closed of [true, false]) {
    for (const n of [1, 10, 100]) {
      const p = setup(closed, true);
      time(p, n, 20); // warm
      console.log(`[probe] ${closed ? 'closed' : 'open  '} schema, ${String(n).padStart(3)} events: ${time(p, n, 200).toFixed(3)} ms/call`);
    }
  }
}, 120_000);

it.each([0, 50, 100, 300, 600])('cost when the store also holds %i extra registered domains', (extra) => {
  const p = setup(true, true);
  for (let i = 0; i < extra; i++) {
    p.register({ id: `gts.frontx.mfes.ext.domain.v1~test.telemetryspike.filler.d${i}.v1`, actions: [], extensionsActions: [], sharedProperties: [], defaultActionTimeout: 5000, lifecycleStages: [], extensionsLifecycleStages: [] });
  }
  time(p, 1, 20);
  console.log(`[probe] closed schema, 1 event, store +${extra} domains: ${time(p, 1, 100).toFixed(3)} ms/call`);
}, 120_000);

it.each([0, 300, 600])('cost when the store holds %i extra entries that do NOT match the target pattern', (extra) => {
  const p = setup(true, true);
  for (let i = 0; i < extra; i++) {
    p.register({ id: `gts.frontx.mfes.mfe.entry.v1~test.telemetryspike.filler.e${i}.v1`, requiredProperties: [], actions: [], domainActions: [] });
  }
  time(p, 1, 20);
  console.log(`[probe] closed schema, 1 event, store +${extra} entries: ${time(p, 1, 100).toFixed(3)} ms/call`);
}, 120_000);
