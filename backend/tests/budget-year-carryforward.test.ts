import { describe, expect, it, vi } from 'vitest';
import type { DbClient } from '../src/db/index.js';
import { accountBalances, budgetItems, budgetYears, monthlyValues } from '../src/db/schema.js';

const mocks = vi.hoisted(() => ({
  getAccountsForYear: vi.fn(),
}));

vi.mock('../src/services/accounts.js', () => ({
  getAccountsForYear: mocks.getAccountsForYear,
}));

describe('budget year creation carryforward', () => {
  it('copies previous-year items with zero values and carries forward December account balances', async () => {
    const { createYear } = await import('../src/services/budget.js');
    const insertYearReturning = vi.fn().mockResolvedValue([{ id: 2027, year: 2027, initialBalance: '0' }]);
    const insertYearValues = vi.fn().mockReturnValue({ returning: insertYearReturning });
    const copiedItemRows = [{ id: 301 }, { id: 302 }];
    const insertItemReturning = vi
      .fn()
      .mockResolvedValueOnce([copiedItemRows[0]])
      .mockResolvedValueOnce([copiedItemRows[1]]);
    const insertItemValues = vi.fn().mockReturnValue({ returning: insertItemReturning });
    const insertMonthlyValues = vi.fn().mockResolvedValue(undefined);
    const insertAccountBalancesValues = vi.fn().mockResolvedValue(undefined);

    const tx = {
      insert: vi.fn((table) => {
        if (table === budgetYears) return { values: insertYearValues };
        if (table === budgetItems) return { values: insertItemValues };
        if (table === monthlyValues) return { values: insertMonthlyValues };
        if (table === accountBalances) return { values: insertAccountBalancesValues };
        throw new Error('Unexpected table');
      }),
      query: {
        budgetYears: {
          findFirst: vi
            .fn()
            .mockResolvedValueOnce({ id: 2026, year: 2026 })
            .mockResolvedValueOnce({ id: 2026, year: 2026 }),
        },
        budgetItems: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 101,
              yearId: 2026,
              groupId: 11,
              name: 'Groceries',
              slug: 'groceries',
              sortOrder: 1,
              yearlyBudget: '2400.00',
              savingsAccountId: null,
            },
            {
              id: 102,
              yearId: 2026,
              groupId: 12,
              name: 'Emergency (Bank)',
              slug: 'emergency-fund',
              sortOrder: 2,
              yearlyBudget: '1200.00',
              savingsAccountId: 9,
            },
          ]),
          findFirst: vi.fn().mockResolvedValue({ id: 302 }),
        },
        paymentMethods: {
          findMany: vi
            .fn()
            .mockResolvedValue([{ id: 9, name: 'Emergency', institution: 'Bank', isSavingsAccount: true }]),
        },
        budgetGroups: {
          findFirst: vi.fn().mockResolvedValue({ id: 12 }),
        },
      },
    } as unknown as DbClient;

    mocks.getAccountsForYear.mockResolvedValueOnce({
      accounts: [
        { id: 5, monthlyBalances: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1234.56] },
        { id: 9, monthlyBalances: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 700] },
      ],
    });

    await expect(createYear(tx, 2027, 0, 42, 'owner-id')).resolves.toEqual({
      id: 2027,
      year: 2027,
      initialBalance: 0,
    });

    expect(insertItemValues).toHaveBeenCalledWith({
      yearId: 2027,
      groupId: 11,
      name: 'Groceries',
      slug: 'groceries',
      sortOrder: 1,
      yearlyBudget: '0',
      savingsAccountId: null,
    });
    expect(insertItemValues).toHaveBeenCalledWith({
      yearId: 2027,
      groupId: 12,
      name: 'Emergency (Bank)',
      slug: 'emergency-fund',
      sortOrder: 2,
      yearlyBudget: '0',
      savingsAccountId: 9,
    });
    expect(insertMonthlyValues).toHaveBeenCalledTimes(2);
    expect(insertMonthlyValues.mock.calls[0][0]).toHaveLength(12);
    expect(insertMonthlyValues.mock.calls[0][0][0]).toMatchObject({ itemId: 301, month: 1, budget: '0', actual: '0' });
    expect(insertAccountBalancesValues).toHaveBeenCalledWith([
      { yearId: 2027, paymentMethodId: 5, initialBalance: '1234.56' },
      { yearId: 2027, paymentMethodId: 9, initialBalance: '700.00' },
    ]);
    expect(insertItemValues).toHaveBeenCalledTimes(2);
    expect(tx.query.budgetItems.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        columns: { id: true },
      })
    );
  });

  it('does not report initialization unique errors as duplicate budget years', async () => {
    const { BudgetYearAlreadyExistsError, createYear } = await import('../src/services/budget.js');
    const insertYearReturning = vi.fn().mockResolvedValue([{ id: 2027, year: 2027, initialBalance: '0' }]);
    const insertYearValues = vi.fn().mockReturnValue({ returning: insertYearReturning });
    const itemUniqueError = { code: '23505', constraint_name: 'budget_items_year_group_slug_unique' };
    const insertItemReturning = vi.fn().mockRejectedValue(itemUniqueError);
    const insertItemValues = vi.fn().mockReturnValue({ returning: insertItemReturning });

    const tx = {
      insert: vi.fn((table) => {
        if (table === budgetYears) return { values: insertYearValues };
        if (table === budgetItems) return { values: insertItemValues };
        throw new Error('Unexpected table');
      }),
      query: {
        budgetYears: {
          findFirst: vi.fn().mockResolvedValueOnce({ id: 2026, year: 2026 }),
        },
        budgetItems: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 101,
              yearId: 2026,
              groupId: 11,
              name: 'Groceries',
              slug: 'groceries',
              sortOrder: 1,
              yearlyBudget: '2400.00',
              savingsAccountId: null,
            },
          ]),
        },
      },
    } as unknown as DbClient;

    let caught: unknown;
    try {
      await createYear(tx, 2027, 0, 42, 'owner-id');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(itemUniqueError);
    expect(caught).not.toBeInstanceOf(BudgetYearAlreadyExistsError);
  });
});
