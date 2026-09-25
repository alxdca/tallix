import { describe, expect, it } from 'vitest';
import { getRecentlyUsedCategories } from './transactionCategories';

const categories = [
  { id: 1, name: 'Groceries' },
  { id: 2, name: 'Transport' },
  { id: 3, name: 'Rent' },
  { id: 4, name: 'Salary' },
  { id: 5, name: 'Savings' },
  { id: 6, name: 'Utilities' },
];

describe('getRecentlyUsedCategories', () => {
  it('returns up to five unique categories ordered by when they were last used', () => {
    const result = getRecentlyUsedCategories(categories, [
      { id: 10, itemId: 1, date: '2026-04-01' },
      { id: 11, itemId: 2, date: '2026-04-03' },
      { id: 12, itemId: 1, date: '2026-04-04' },
      { id: 13, itemId: 3, date: '2026-04-02' },
      { id: 14, itemId: 4, date: '2026-03-30' },
      { id: 15, itemId: 5, date: '2026-03-29' },
      { id: 16, itemId: 6, date: '2026-03-28' },
    ]);

    expect(result.map((category) => category.id)).toEqual([6, 5, 4, 3, 1]);
  });

  it('uses transaction creation order instead of the transaction date', () => {
    const result = getRecentlyUsedCategories(categories, [
      { id: 20, itemId: 1, date: '2027-04-01' },
      { id: 21, itemId: 2, date: '2025-04-01' },
    ]);

    expect(result.map((category) => category.id)).toEqual([2, 1]);
  });

  it('ignores uncategorized transactions and removed categories', () => {
    const result = getRecentlyUsedCategories(categories, [
      { id: 30, itemId: null, date: '2026-04-03' },
      { id: 29, itemId: 999, date: '2026-04-02' },
      { id: 28, itemId: 3, date: '2026-04-01' },
    ]);

    expect(result.map((category) => category.id)).toEqual([3]);
  });
});
