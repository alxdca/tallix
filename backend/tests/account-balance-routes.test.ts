import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, errorHandler } from '../src/middleware/errorHandler.js';

const mocks = vi.hoisted(() => ({
  getAccountsForYear: vi.fn(),
  setAccountBalance: vi.fn(),
  restoreAccountBalanceLink: vi.fn(),
  getBudgetYear: vi.fn(),
  withTenantContext: vi.fn(async (_userId: string, _budgetId: number, callback: (tx: unknown) => Promise<unknown>) =>
    callback({})
  ),
}));
vi.mock('../src/db/context.js', () => ({ withTenantContext: mocks.withTenantContext }));
vi.mock('../src/services/accounts.js', () => ({
  getAccountsForYear: mocks.getAccountsForYear,
  setAccountBalance: mocks.setAccountBalance,
  restoreAccountBalanceLink: mocks.restoreAccountBalanceLink,
}));
vi.mock('../src/services/budget.js', () => ({ getBudgetYear: mocks.getBudgetYear }));

async function dispatch(path: '/:year/balance' | '/:year/balance/restore-link', body: unknown) {
  const routes = (await import('../src/routes/accounts.js')).default;
  const handler = routes.stack.find((layer) => layer.route?.path === path)?.route.stack[0].handle;
  if (!handler) throw new Error('Missing account route');
  const req = {
    params: { year: '2027' },
    user: { id: 'writer-1' },
    budget: { id: 12, userId: 'owner-1', role: 'write' },
    body,
    headers: {},
    method: 'PUT',
    path,
  } as unknown as Request;
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(value: unknown) {
      this.body = value;
      finish();
      return this;
    },
  };
  handler(
    req,
    res as unknown as Response,
    ((error: Error) => {
      errorHandler(error, req, res as unknown as Response, () => undefined);
    }) as NextFunction
  );
  await finished;
  return { status: res.statusCode, body: res.body };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getBudgetYear.mockResolvedValue({ id: 77, year: 2027 });
  mocks.getAccountsForYear.mockResolvedValue({
    accounts: [{ id: 100, inheritedFromParent: false, linkedFromYear: 2026 }],
  });
  mocks.setAccountBalance.mockResolvedValue(undefined);
  mocks.restoreAccountBalanceLink.mockResolvedValue(undefined);
});

describe('account opening balance link routes', () => {
  it.each([
    { inheritedFromParent: false, linkedFromYear: 2026 },
    { inheritedFromParent: true, linkedFromYear: null },
  ])('requires an explicit acknowledgment before breaking a live link (%j)', async (source) => {
    mocks.getAccountsForYear.mockResolvedValueOnce({ accounts: [{ id: 100, ...source }] });
    const result = await dispatch('/:year/balance', { paymentMethodId: 100, initialBalance: 1500 });
    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ code: 'BALANCE_LINK_CONFIRMATION_REQUIRED' });
    expect(mocks.setAccountBalance).not.toHaveBeenCalled();
  });

  it('saves an acknowledged override using the account owner inside the writer tenant context', async () => {
    const result = await dispatch('/:year/balance', { paymentMethodId: 100, initialBalance: -125.25, breakLink: true });
    expect(result.status).toBe(200);
    expect(mocks.withTenantContext).toHaveBeenCalledWith('writer-1', 12, expect.any(Function));
    expect(mocks.getAccountsForYear).toHaveBeenCalledWith({}, 2027, 12, 'owner-1');
    expect(mocks.setAccountBalance).toHaveBeenCalledWith({}, 2027, 100, -125.25, 12, 'owner-1');
  });

  it('keeps independent first-year editing available without a broken-link acknowledgment', async () => {
    mocks.getAccountsForYear.mockResolvedValueOnce({
      accounts: [{ id: 100, inheritedFromParent: false, linkedFromYear: null }],
    });
    expect((await dispatch('/:year/balance', { paymentMethodId: 100, initialBalance: 0 })).status).toBe(200);
    expect(mocks.setAccountBalance).toHaveBeenCalled();
  });

  it.each([
    { paymentMethodId: '100x', initialBalance: 20 },
    { paymentMethodId: 0, initialBalance: 20 },
    { paymentMethodId: 100, initialBalance: '20' },
    { paymentMethodId: 100, initialBalance: Number.NaN },
    { paymentMethodId: 100, initialBalance: Number.POSITIVE_INFINITY },
    { paymentMethodId: 100, initialBalance: 10000000000 },
    { paymentMethodId: 100, initialBalance: 20, breakLink: 'yes' },
  ])('rejects malformed input without a mutation (%j)', async (body) => {
    expect((await dispatch('/:year/balance', body)).status).toBe(400);
    expect(mocks.setAccountBalance).not.toHaveBeenCalled();
  });

  it('does not mutate an account absent from the current owner account list', async () => {
    mocks.getAccountsForYear.mockResolvedValueOnce({ accounts: [] });
    expect(
      (await dispatch('/:year/balance', { paymentMethodId: 100, initialBalance: 20, breakLink: true })).status
    ).toBe(404);
    expect(mocks.setAccountBalance).not.toHaveBeenCalled();
  });

  it('restores a link using the current year and account owner', async () => {
    expect((await dispatch('/:year/balance/restore-link', { paymentMethodId: 100 })).status).toBe(200);
    expect(mocks.restoreAccountBalanceLink).toHaveBeenCalledWith({}, 2027, 100, 12, 'owner-1');
  });

  it('reports an unavailable link without treating it as a server failure', async () => {
    mocks.restoreAccountBalanceLink.mockRejectedValueOnce(new AppError(400, 'No opening balance link is available'));
    expect((await dispatch('/:year/balance/restore-link', { paymentMethodId: 100 })).status).toBe(400);
  });

  it('rejects mutations when the selected year no longer exists', async () => {
    mocks.getBudgetYear.mockResolvedValueOnce(null);
    expect((await dispatch('/:year/balance/restore-link', { paymentMethodId: 100 })).status).toBe(404);
    expect(mocks.restoreAccountBalanceLink).not.toHaveBeenCalled();
  });
});
