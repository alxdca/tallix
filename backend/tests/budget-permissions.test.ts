import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { DbClient } from '../src/db/index.js';
import { budgetGroups, budgetItems, budgets, budgetYears, monthlyValues } from '../src/db/schema.js';
import { requireBudgetOwner, requireBudgetWrite } from '../src/middleware/budget.js';
import { getExpectedBudgetMonthIndex } from '../src/services/budget.js';
import {
  BudgetShareUserNotFoundError,
  createYearlyBudget,
  listAccessibleBudgets,
  shareBudgetWithUser,
} from '../src/services/budgets.js';

function createRequest(method: string, role: 'owner' | 'read' | 'write'): Request {
  return {
    method,
    budget: { id: 1, userId: 'owner-id', description: null, startYear: 2026, parentBudgetId: null, role },
  } as Request;
}

function createResponse() {
  const response = {
    status: vi.fn(),
    json: vi.fn(),
  };
  response.status.mockReturnValue(response);
  return response as unknown as Response;
}

describe('budget access middleware', () => {
  it('allows read-only users to make read requests', () => {
    const next = vi.fn() as NextFunction;
    requireBudgetWrite(createRequest('GET', 'read'), createResponse(), next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('rejects mutations from read-only users', () => {
    const response = createResponse();
    const next = vi.fn() as NextFunction;
    requireBudgetWrite(createRequest('POST', 'read'), response, next);
    expect(response.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('allows mutations from writers and owners', () => {
    const writerNext = vi.fn() as NextFunction;
    const ownerNext = vi.fn() as NextFunction;
    requireBudgetWrite(createRequest('PUT', 'write'), createResponse(), writerNext);
    requireBudgetWrite(createRequest('DELETE', 'owner'), createResponse(), ownerNext);
    expect(writerNext).toHaveBeenCalledOnce();
    expect(ownerNext).toHaveBeenCalledOnce();
  });

  it('keeps share management owner-only', () => {
    const response = createResponse();
    const next = vi.fn() as NextFunction;
    requireBudgetOwner(createRequest('POST', 'write'), response, next);
    expect(response.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('budget sharing errors', () => {
  it('returns a specific error when the target email is not registered', async () => {
    const tx = {
      execute: vi.fn().mockResolvedValue([{ user_id: null }]),
    } as unknown as DbClient;

    await expect(shareBudgetWithUser(tx, 1, 'owner-id', 'missing@example.com', 'read')).rejects.toBeInstanceOf(
      BudgetShareUserNotFoundError
    );
  });
});

describe('yearly budget collaboration', () => {
  it('lists accessible budgets using each budget start year as the independent budget year', async () => {
    const tx = {
      query: {
        budgets: {
          findMany: vi.fn().mockResolvedValue([
            {
              id: 10,
              description: 'Household',
              startYear: 2026,
              parentBudgetId: null,
              userId: 'owner-id',
              user: { name: 'Owner', email: 'owner@example.com' },
            },
            {
              id: 11,
              description: 'Travel',
              startYear: 2026,
              parentBudgetId: null,
              userId: 'friend-id',
              user: { name: 'Friend', email: 'friend@example.com' },
            },
          ]),
        },
        budgetShares: {
          findMany: vi.fn().mockResolvedValue([{ budgetId: 11, userId: 'owner-id', role: 'write' }]),
        },
      },
    } as unknown as DbClient;

    await expect(listAccessibleBudgets(tx, 'owner-id')).resolves.toEqual([
      {
        id: 10,
        description: 'Household',
        year: 2026,
        startYear: 2026,
        parentBudgetId: null,
        ownerId: 'owner-id',
        ownerName: 'Owner',
        ownerEmail: 'owner@example.com',
        role: 'owner',
      },
      {
        id: 11,
        description: 'Travel',
        year: 2026,
        startYear: 2026,
        parentBudgetId: null,
        ownerId: 'friend-id',
        ownerName: 'Friend',
        ownerEmail: 'friend@example.com',
        role: 'write',
      },
    ]);
  });

  it('creates an independent single-year budget and does not reject duplicate calendar years', async () => {
    const insertBudgetReturning = vi.fn().mockResolvedValue([
      {
        id: 42,
        userId: 'owner-id',
        description: 'Travel',
        startYear: 2026,
        parentBudgetId: null,
      },
    ]);
    const insertBudgetValues = vi.fn().mockReturnValue({ returning: insertBudgetReturning });
    const insertYearReturning = vi.fn().mockResolvedValue([{ id: 77, year: 2026, initialBalance: '0' }]);
    const insertYearValues = vi.fn().mockReturnValue({ returning: insertYearReturning });
    const insertSavingsGroupReturning = vi.fn().mockResolvedValue([{ id: 88 }]);
    const insertSavingsGroupValues = vi.fn().mockReturnValue({ returning: insertSavingsGroupReturning });
    const insertSavingsItemReturning = vi.fn().mockResolvedValue([{ id: 99 }]);
    const insertSavingsItemValues = vi.fn().mockReturnValue({ returning: insertSavingsItemReturning });
    const insertMonthlyValues = vi.fn().mockResolvedValue(undefined);
    const execute = vi.fn().mockResolvedValue(undefined);

    const tx = {
      execute,
      insert: vi.fn((table) => {
        if (table === budgets) return { values: insertBudgetValues };
        if (table === budgetYears) return { values: insertYearValues };
        if (table === budgetGroups) return { values: insertSavingsGroupValues };
        if (table === budgetItems) return { values: insertSavingsItemValues };
        if (table === monthlyValues) return { values: insertMonthlyValues };
        throw new Error('Unexpected table');
      }),
      query: {
        budgets: {
          findFirst: vi
            .fn()
            .mockResolvedValueOnce({ startYear: 2026 })
            .mockResolvedValueOnce({
              id: 42,
              userId: 'owner-id',
              description: 'Travel',
              startYear: 2026,
              parentBudgetId: null,
              user: { name: 'Owner', email: 'owner@example.com' },
            }),
        },
        budgetYears: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
        paymentMethods: {
          findMany: vi
            .fn()
            .mockResolvedValue([{ id: 12, name: 'Savings', institution: 'Bank', isSavingsAccount: true }]),
        },
        budgetGroups: {
          findFirst: vi.fn().mockResolvedValue(null),
        },
      },
    } as unknown as DbClient;

    await expect(createYearlyBudget(tx, 'owner-id', 2026, 'Travel')).resolves.toEqual({
      id: 42,
      description: 'Travel',
      year: 2026,
      startYear: 2026,
      parentBudgetId: null,
      ownerId: 'owner-id',
      ownerName: 'Owner',
      ownerEmail: 'owner@example.com',
      role: 'owner',
    });

    expect(insertBudgetValues).toHaveBeenCalledWith({
      userId: 'owner-id',
      parentBudgetId: null,
      description: 'Travel',
      startYear: 2026,
    });
    expect(execute).toHaveBeenCalledOnce();
    expect(insertYearValues).toHaveBeenCalledWith({
      budgetId: 42,
      year: 2026,
      initialBalance: '0',
    });
    expect(insertSavingsGroupValues).toHaveBeenCalledWith({
      budgetId: 42,
      name: 'Savings',
      slug: 'epargne',
      type: 'savings',
      sortOrder: 998,
    });
    expect(insertSavingsItemValues).toHaveBeenCalledWith({
      yearId: 77,
      groupId: 88,
      name: 'Savings (Bank)',
      slug: 'savings-12',
      sortOrder: 0,
      savingsAccountId: 12,
    });
    expect(insertMonthlyValues).toHaveBeenCalledWith(
      expect.arrayContaining([{ itemId: 99, month: 1, budget: '0', actual: '0' }])
    );
    expect(insertMonthlyValues.mock.calls[0][0]).toHaveLength(12);
  });
});

describe('yearly budget summaries', () => {
  it('uses all months for past years, no months for future years, and the current month for this year', () => {
    const now = new Date('2026-09-29T12:00:00Z');

    expect(getExpectedBudgetMonthIndex(2025, now)).toBe(12);
    expect(getExpectedBudgetMonthIndex(2026, now)).toBe(8);
    expect(getExpectedBudgetMonthIndex(2027, now)).toBe(0);
  });
});
