import { describe, expect, it } from 'vitest';
import { createTelemetry } from '../index';
import type { CatalogCheck, CatalogData, CatalogName, CatalogNamespace } from '../index';

const base = { appName: 'app', appVersion: '1' };

type ShellCatalog = {
  'shell.menu_opened': { menu: string };
  'shell.tenant_switched': { tenantId: string; depth: number };
};

// Positive cases: compile, and run harmlessly.
function positives() {
  const plain = createTelemetry(base);
  plain.logEvent('anything', { a: 1 });

  const shell = createTelemetry<ShellCatalog>({ ...base, namespace: 'shell' });
  shell.record('shell.menu_opened', { menu: 'main' });
  shell.record('shell.tenant_switched', { tenantId: 't1', depth: 2 });
  shell.logEvent('untyped_still_works');

  const ns: CatalogNamespace<ShellCatalog> = 'shell';
  const name: CatalogName<ShellCatalog> = 'shell.menu_opened';
  const data: CatalogData<ShellCatalog, 'shell.menu_opened'> = { menu: 'x' };

  type BillingCatalog = { 'billing.invoice_opened': { invoiceId: string } };
  const mfeOk: CatalogCheck<BillingCatalog, 'billing'> = true;
  const emptyOk: CatalogCheck<Record<never, never>, 'anything'> = true;

  type NestedCatalog = {
    'app.nested': {
      a: string;
      b: number;
      c: boolean;
      d: null;
      e: (string | number)[];
      f: { g: { h: string[]; i?: number } };
      j?: string;
    };
  };
  const nestedOk: CatalogCheck<NestedCatalog, 'app'> = true;
  interface Detail {
    id: string;
    tags: string[];
  }
  interface InterfaceData {
    detail: Detail;
    count?: number;
  }
  type InterfaceCatalog = { 'app.iface': InterfaceData };
  const interfaceOk: CatalogCheck<InterfaceCatalog, 'app'> = true;
  interface TreeNode {
    label: string;
    children: TreeNode[];
  }
  type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
  type RecursiveCatalog = { 'app.tree': { root: TreeNode }; 'app.raw': { payload: Json } };
  const recursiveOk: CatalogCheck<RecursiveCatalog, 'app'> = true;
  return [plain, shell, ns, name, data, mfeOk, emptyOk, nestedOk, interfaceOk, recursiveOk];
}

// Negative cases: never called; each line must fail the type check.
function negatives() {
  const shell = createTelemetry<ShellCatalog>({ ...base, namespace: 'shell' });
  // @ts-expect-error undeclared name
  shell.record('shell.unknown', { menu: 'x' });
  // @ts-expect-error wrong data shape
  shell.record('shell.menu_opened', { menu: 1 });
  const either = Math.random() > 0.5 ? ('shell.menu_opened' as const) : ('shell.tenant_switched' as const);
  // @ts-expect-error a name that may be one of two names takes neither name's data
  shell.record(either, { tenantId: 't1', depth: 2 });

  const plain = createTelemetry(base);
  // @ts-expect-error a client without a catalog accepts no name
  plain.record('shell.menu_opened', { menu: 'x' });

  // @ts-expect-error data shape not a record of named values
  createTelemetry<{ 'shell.bad': string }>({ ...base, namespace: 'shell' });
  // @ts-expect-error data shape is an array, not a record of named values
  createTelemetry<{ 'shell.bad': string[] }>({ ...base, namespace: 'shell' });
  // @ts-expect-error two different first segments
  createTelemetry<{ 'shell.a': { x: 1 }; 'other.b': { x: 1 } }>({ ...base, namespace: 'shell' });
  // @ts-expect-error namespace mismatch
  createTelemetry<ShellCatalog>({ ...base, namespace: 'other' });
  // @ts-expect-error catalog without namespace
  createTelemetry<ShellCatalog>(base);
  // @ts-expect-error reserved namespace frontx
  createTelemetry<{ 'frontx.a': { x: 1 } }>({ ...base, namespace: 'frontx' });
  // @ts-expect-error reserved namespace page_view
  createTelemetry<{ 'page_view.a': { x: 1 } }>({ ...base, namespace: 'page_view' });
  // @ts-expect-error reserved namespace session_start
  createTelemetry<{ 'session_start.a': { x: 1 } }>({ ...base, namespace: 'session_start' });
  // @ts-expect-error reserved namespace autocapture_x
  createTelemetry<{ 'autocapture_x.a': { x: 1 } }>({ ...base, namespace: 'autocapture_x' });
  // @ts-expect-error empty namespace
  createTelemetry<{ '.a': { x: 1 } }>({ ...base, namespace: '' });
  // @ts-expect-error one-segment name
  createTelemetry<{ page_view: { x: 1 } }>({ ...base, namespace: 'page_view' });
  // @ts-expect-error a client without a catalog takes no namespace
  createTelemetry({ ...base, namespace: 'shell' });

  type MfeCatalog = { 'billing.invoice_opened': { invoiceId: string } };
  // @ts-expect-error microfrontend catalog whose names do not start with its namespace
  const mfeBad: CatalogCheck<MfeCatalog, 'reports'> = true;
  // @ts-expect-error data holds a Date
  const dateBad: CatalogCheck<{ 'app.a': { at: Date } }, 'app'> = true;
  // @ts-expect-error data holds a Map
  const mapBad: CatalogCheck<{ 'app.a': { m: Map<string, string> } }, 'app'> = true;
  // @ts-expect-error data holds a Set
  const setBad: CatalogCheck<{ 'app.a': { s: Set<string> } }, 'app'> = true;
  // @ts-expect-error data holds a Uint8Array
  const bytesBad: CatalogCheck<{ 'app.a': { b: Uint8Array } }, 'app'> = true;
  // @ts-expect-error data holds a function
  const fnBad: CatalogCheck<{ 'app.a': { f: () => void } }, 'app'> = true;
  // @ts-expect-error data holds a bigint
  const bigBad: CatalogCheck<{ 'app.a': { n: bigint } }, 'app'> = true;
  // @ts-expect-error data holds a Date nested in a record inside an array
  const nestedBad: CatalogCheck<{ 'app.a': { list: { when: Date }[] } }, 'app'> = true;
  // @ts-expect-error data holds an unknown value
  const unknownBad: CatalogCheck<{ 'app.a': { u: unknown } }, 'app'> = true;
  return [mfeBad, dateBad, mapBad, setBad, bytesBad, fnBad, bigBad, nestedBad, unknownBad];
}

describe('declared events type tests', () => {
  it('keeps the type-only cases out of the runtime', () => {
    expect(typeof positives).toBe('function');
    expect(typeof negatives).toBe('function');
  });
});
