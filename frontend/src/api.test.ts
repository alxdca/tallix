import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACTIVE_BUDGET_KEY,
  askCopilot,
  createBudget,
  createBudgetYear,
  deleteBudget,
  fetchAccounts,
  fetchBudgetData,
  fetchBudgetSummary,
  shareBudget,
} from './api';

function jsonResponse(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

const fetchMock = vi.fn();

beforeEach(() => {
  localStorage.clear();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(jsonResponse({}));
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('budget api year routing', () => {
  it('requests budget data for the provided year', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ year: 2027, yearId: 77, initialBalance: 0, groups: [] }));

    await fetchBudgetData(2027);

    expect(fetchMock).toHaveBeenCalledWith('/api/budget/year/2027', expect.any(Object));
  });

  it('requests budget summary with the provided year query', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        initialBalance: 0,
        totalIncome: { budget: 0, actual: 0 },
        totalExpenses: { budget: 0, actual: 0 },
        totalSavings: { budget: 0, actual: 0 },
        expectedIncome: 0,
        expectedExpenses: 0,
        expectedSavings: 0,
        remainingBalance: 0,
      })
    );

    await fetchBudgetSummary(2027);

    expect(fetchMock).toHaveBeenCalledWith('/api/budget/summary?year=2027', expect.any(Object));
  });

  it('requests accounts for the provided budget year', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ accounts: [], lastActiveMonth: 0 }));

    await fetchAccounts(2027);

    expect(fetchMock).toHaveBeenCalledWith('/api/accounts/2027', expect.any(Object));
  });

  it('sends the active budget header when creating another yearly budget', async () => {
    localStorage.setItem(ACTIVE_BUDGET_KEY, '42');
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: 8,
        year: 2026,
        parentBudgetId: null,
        description: 'Second 2026',
        ownerId: 'owner-1',
        ownerName: null,
        ownerEmail: 'owner@example.com',
        role: 'owner',
      })
    );

    await createBudget(2026, 'Second 2026');

    expect(fetchMock).toHaveBeenCalledWith('/api/budgets', {
      method: 'POST',
      body: JSON.stringify({ year: 2026, description: 'Second 2026' }),
      headers: {
        'Content-Type': 'application/json',
        'X-Budget-Id': '42',
      },
    });
  });

  it('sends parentBudgetId only when creating from a parent budget', async () => {
    localStorage.setItem(ACTIVE_BUDGET_KEY, '42');
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        id: 9,
        year: 2027,
        parentBudgetId: 8,
        description: 'Child 2027',
        ownerId: 'owner-1',
        ownerName: null,
        ownerEmail: 'owner@example.com',
        role: 'owner',
      })
    );

    await createBudget(2027, 'Child 2027', 8);

    expect(fetchMock).toHaveBeenCalledWith('/api/budgets', {
      method: 'POST',
      body: JSON.stringify({ year: 2027, description: 'Child 2027', parentBudgetId: 8 }),
      headers: {
        'Content-Type': 'application/json',
        'X-Budget-Id': '42',
      },
    });
  });

  it('deletes the budget identified by the path id while preserving the active budget header', async () => {
    localStorage.setItem(ACTIVE_BUDGET_KEY, '42');
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        budgets: [
          {
            id: 8,
            year: 2026,
            parentBudgetId: null,
            description: 'Replacement',
            ownerId: 'owner-1',
            ownerName: null,
            ownerEmail: 'owner@example.com',
            role: 'owner',
          },
        ],
        defaultBudgetId: 8,
      })
    );

    const result = await deleteBudget(7);

    expect(fetchMock).toHaveBeenCalledWith('/api/budgets/7', {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'X-Budget-Id': '42',
      },
    });
    expect(result.defaultBudgetId).toBe(8);
  });

  it('rejects delete budget responses that are not ok', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'No token provided' }, { status: 401 }));

    await expect(deleteBudget(7)).rejects.toMatchObject({
      code: 'AUTH_NO_TOKEN',
      status: 401,
    });
  });
  it('creates a year inside the active budget', async () => {
    localStorage.setItem(ACTIVE_BUDGET_KEY, '42');
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 78, year: 2028 }));
    await createBudgetYear(2028);
    expect(fetchMock).toHaveBeenCalledWith('/api/budget/years', {
      method: 'POST',
      body: JSON.stringify({ year: 2028 }),
      headers: { 'Content-Type': 'application/json', 'X-Budget-Id': '42' },
    });
  });

  it('shares the parent budget without limiting access to a year', async () => {
    localStorage.setItem(ACTIVE_BUDGET_KEY, '42');
    fetchMock.mockResolvedValueOnce(jsonResponse([]));
    await shareBudget('reader@example.com', 'read');
    expect(fetchMock).toHaveBeenCalledWith('/api/budgets/current/shares', {
      method: 'POST',
      body: JSON.stringify({ email: 'reader@example.com', role: 'read' }),
      headers: { 'Content-Type': 'application/json', 'X-Budget-Id': '42' },
    });
  });

  it('asks copilot with the selected year as its default context', async () => {
    await askCopilot('What did I spend?', [], 2025);
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/copilot/ask',
      expect.objectContaining({
        body: JSON.stringify({ question: 'What did I spend?', conversationHistory: [], year: 2025 }),
      })
    );
  });
});
