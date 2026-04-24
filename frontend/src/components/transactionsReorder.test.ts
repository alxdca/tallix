import { describe, expect, it } from 'vitest';
import {
  buildSelectionReorderUpdates,
  buildSingleReorderUpdates,
  canReorderSelectedEntries,
  type ReorderableEntry,
} from './transactionsReorder';

const manualEntries: ReorderableEntry[] = [
  { id: 't_1', type: 'transaction', date: '2026-04-01', sortPriority: 3 },
  { id: 'x_2', type: 'transfer', date: '2026-04-01', sortPriority: 2 },
  { id: 't_3', type: 'transaction', date: '2026-04-01', sortPriority: 1 },
  { id: 'x_4', type: 'transfer', date: '2026-04-02', sortPriority: 1 },
];

const naturalOrderEntries: ReorderableEntry[] = [
  { id: 't_1', type: 'transaction', date: '2026-04-01', sortPriority: null },
  { id: 'x_2', type: 'transfer', date: '2026-04-01', sortPriority: null },
  { id: 't_3', type: 'transaction', date: '2026-04-01', sortPriority: null },
];

describe('transactionsReorder', () => {
  it('allows transfer-only selections to be reordered when they share one date', () => {
    expect(canReorderSelectedEntries(manualEntries, new Set(['x_2']), true)).toBe(true);
  });

  it('allows mixed transfer and transaction selections to be reordered on the same date', () => {
    expect(canReorderSelectedEntries(manualEntries, new Set(['x_2', 't_3']), true)).toBe(true);
  });

  it('blocks reordering selections that span multiple dates', () => {
    expect(canReorderSelectedEntries(manualEntries, new Set(['x_2', 'x_4']), true)).toBe(false);
  });

  it('moves a selected block to the top while preserving selection order', () => {
    expect(buildSelectionReorderUpdates(manualEntries, new Set(['x_2', 't_3']), 'top')).toEqual([
      { type: 'transaction', id: 1, sortPriority: 1 },
      { type: 'transfer', id: 2, sortPriority: 3 },
      { type: 'transaction', id: 3, sortPriority: 2 },
    ]);
  });

  it('moves a single row down by exactly one position', () => {
    expect(buildSingleReorderUpdates(manualEntries, manualEntries[1], 'down')).toEqual([
      { type: 'transfer', id: 2, sortPriority: 1 },
      { type: 'transaction', id: 3, sortPriority: 2 },
    ]);
  });

  it('renormalizes a naturally ordered day so one move changes only one row position', () => {
    expect(buildSingleReorderUpdates(naturalOrderEntries, naturalOrderEntries[1], 'up')).toEqual([
      { type: 'transaction', id: 1, sortPriority: 2 },
      { type: 'transfer', id: 2, sortPriority: 3 },
      { type: 'transaction', id: 3, sortPriority: 1 },
    ]);
  });

  it('moves non-contiguous selections down one row each without skipping rows', () => {
    expect(buildSelectionReorderUpdates(manualEntries, new Set(['t_1', 't_3']), 'down')).toEqual([
      { type: 'transaction', id: 1, sortPriority: 2 },
      { type: 'transfer', id: 2, sortPriority: 3 },
    ]);
  });

  it('returns no updates when a single row is already at the top', () => {
    expect(buildSingleReorderUpdates(manualEntries, manualEntries[0], 'up')).toEqual([]);
  });
});
