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
  return [plain, shell, ns, name, data, mfeOk, emptyOk];
}

// Negative cases: never called; each line must fail the type check.
function negatives() {
  const shell = createTelemetry<ShellCatalog>({ ...base, namespace: 'shell' });
  // @ts-expect-error undeclared name
  shell.record('shell.unknown', { menu: 'x' });
  // @ts-expect-error wrong data shape
  shell.record('shell.menu_opened', { menu: 1 });

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
  return [mfeBad];
}

describe('declared events type tests', () => {
  it('keeps the type-only cases out of the runtime', () => {
    expect(typeof positives).toBe('function');
    expect(typeof negatives).toBe('function');
  });
});
