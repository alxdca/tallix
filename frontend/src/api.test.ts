import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACTIVE_BUDGET_KEY, createBudget, fetchAccounts, fetchBudgetData, fetchBudgetSummary } from './api';

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
});
