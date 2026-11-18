import { describe, expect, it, vi } from 'vitest';
import { createInspector, INSPECTOR_RECORD_LIMIT } from '../inspector/inspector';

const rec = (i: number) => ({ id: `r${i}`, name: `e${i}`, data: { i }, time_triggered: i });

describe('inspector', () => {
  it('keeps the latest 1000 records, oldest first', () => {
    vi.spyOn(console, 'groupCollapsed').mockImplementation(() => undefined);
    vi.spyOn(console, 'groupEnd').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const inspector = createInspector('development');
    for (let i = 0; i < INSPECTOR_RECORD_LIMIT + 1; i++) inspector.show(rec(i));
    const records = inspector.getRecords();
    expect(records).toHaveLength(1000);
    expect(records[0].name).toBe('e1');
    expect(records[999].name).toBe('e1000');
  });

  it('prints one grouped console entry per record', () => {
    const group = vi.spyOn(console, 'groupCollapsed').mockImplementation(() => undefined);
    const end = vi.spyOn(console, 'groupEnd').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const inspector = createInspector('development');
    inspector.show(rec(1));
    inspector.show(rec(2));
    expect(group).toHaveBeenCalledTimes(2);
    expect(end).toHaveBeenCalledTimes(2);
  });

  it('prints notices under development', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    createInspector('development').notice('no connector configured');
    expect(info).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0][0])).toContain('no connector configured');
  });

  it('production returns [] and prints nothing', () => {
    const spies = (['log', 'info', 'warn', 'error', 'groupCollapsed', 'groupEnd'] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    const inspector = createInspector('production');
    inspector.show(rec(1));
    inspector.notice('x');
    expect(inspector.getRecords()).toEqual([]);
    for (const s of spies) expect(s).not.toHaveBeenCalled();
  });
});
