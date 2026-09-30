import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../src/middleware/errorHandler.js';

const mocks = vi.hoisted(() => ({
  createYearlyBudget: vi.fn(),
  deleteOwnedBudget: vi.fn(),
  withUserContext: vi.fn(async (_userId: string, callback: (tx: unknown) => Promise<unknown>) => {
    return await callback({});
  }),
}));

vi.mock('../src/db/context.js', () => ({
  withTenantContext: vi.fn(),
  withUserContext: mocks.withUserContext,
}));

vi.mock('../src/services/budgets.js', async () => {
  const actual = await vi.importActual<typeof import('../src/services/budgets.js')>('../src/services/budgets.js');
  return {
    ...actual,
    createYearlyBudget: mocks.createYearlyBudget,
    deleteOwnedBudget: mocks.deleteOwnedBudget,
  };
});

function createResponse(resolve: () => void) {
  const response = {
    statusCode: 200,
    status: vi.fn((statusCode: number) => {
      response.statusCode = statusCode;
      return response;
    }),
    json: vi.fn((body: unknown) => {
      response.body = body;
      resolve();
      return response;
    }),
    body: undefined as unknown,
  };
  return response;
}

async function dispatchBudgetRoute(method: 'post' | 'delete', path: '/' | '/:budgetId', req: Partial<Request>) {
  const budgetsRoutes = (await import('../src/routes/budgets.js')).default;
  const layer = budgetsRoutes.stack.find(
    (candidate) =>
      candidate.route?.methods?.[method] &&
      (candidate.route.path === path || (path === '/' && candidate.route.path === ''))
  );
  const handler = layer?.route?.stack.find((candidate) => candidate.method === method)?.handle;
  if (!handler) throw new Error(`${method.toUpperCase()} ${path} route not found`);

  const request = {
    method: method.toUpperCase(),
    path,
    params: {},
    user: {
      id: 'user-1',
      email: 'owner@example.com',
      name: 'Owner',
      language: 'en',
      country: null,
    },
    headers: {},
    body: {},
    ...req,
  } as Request;
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const res = createResponse(finish) as unknown as Response & { statusCode: number; body: unknown };

  await new Promise<void>((resolve, reject) => {
    const next: NextFunction = (error?: unknown) => {
      if (!error) {
        resolve();
        return;
      }
      try {
        errorHandler(error as Error, request, res, () => undefined);
        resolve();
      } catch (caught) {
        reject(caught);
      }
    };

    try {
      handler(request, res, next);
      finished.then(resolve, reject);
    } catch (error) {
      reject(error);
    }
  });

  return { status: res.statusCode, body: res.body };
}

async function createBudget(body: unknown) {
  return dispatchBudgetRoute('post', '/', { body });
}

async function deleteBudget(param: string) {
  return dispatchBudgetRoute('delete', '/:budgetId', {
    path: `/${param}`,
    params: { budgetId: param },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('budgets route', () => {
  it('passes optional parentBudgetId when creating a budget', async () => {
    const budget = {
      id: 9,
      description: 'Child',
      year: 2027,
      startYear: 2027,
      parentBudgetId: 4,
      ownerId: 'user-1',
      ownerName: 'Owner',
      ownerEmail: 'owner@example.com',
      role: 'owner',
    };
    mocks.createYearlyBudget.mockResolvedValueOnce(budget);

    const result = await createBudget({ year: 2027, description: ' Child ', parentBudgetId: 4 });

    expect(result.status).toBe(201);
    expect(result.body).toEqual(budget);
    expect(mocks.createYearlyBudget).toHaveBeenCalledWith({}, 'user-1', 2027, 'Child', 4);
  });

  it.each([0, -1, 1.5, '4', 2147483648])('rejects invalid parent budget id %s', async (parentBudgetId) => {
    const result = await createBudget({ year: 2027, parentBudgetId });

    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: 'parentBudgetId must be a positive integer' });
    expect(mocks.createYearlyBudget).not.toHaveBeenCalled();
  });

  it('returns not found when the parent budget is not owned by the user', async () => {
    const { ParentBudgetNotFoundError } = await import('../src/services/budgets.js');
    mocks.createYearlyBudget.mockRejectedValueOnce(new ParentBudgetNotFoundError());

    const result = await createBudget({ year: 2027, parentBudgetId: 4 });

    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({ error: 'Parent budget not found', code: 'PARENT_BUDGET_NOT_FOUND' });
  });

  it('returns bad request when the parent budget is not the previous year', async () => {
    const { ParentBudgetYearMismatchError } = await import('../src/services/budgets.js');
    mocks.createYearlyBudget.mockRejectedValueOnce(new ParentBudgetYearMismatchError(2028));

    const result = await createBudget({ year: 2027, parentBudgetId: 4 });

    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({
      error: 'Parent budget must be the previous year',
      code: 'PARENT_BUDGET_YEAR_MISMATCH',
      params: { year: 2028 },
    });
  });

  it.each([
    '/api/budgets/0',
    '/api/budgets/-1',
    '/api/budgets/abc',
    '/api/budgets/2147483648',
  ])('rejects invalid budget id %s', async (path) => {
    const budgetId = path.split('/').at(-1)!;
    const result = await deleteBudget(budgetId);

    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ error: 'Invalid budget ID' });
    expect(mocks.deleteOwnedBudget).not.toHaveBeenCalled();
  });

  it('returns forbidden when the target budget is shared with the user', async () => {
    mocks.deleteOwnedBudget.mockResolvedValueOnce({ status: 'shared' });

    const result = await deleteBudget('7');

    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ error: 'Only the budget owner can delete this budget' });
    expect(mocks.deleteOwnedBudget).toHaveBeenCalledWith({}, 'user-1', 7);
  });

  it('returns not found when the target budget is not accessible', async () => {
    mocks.deleteOwnedBudget.mockResolvedValueOnce({ status: 'not-found' });

    const result = await deleteBudget('7');

    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({ error: 'Budget not found' });
  });

  it('returns refreshed budgets after deleting an owned budget', async () => {
    const budgets = [
      {
        id: 8,
        description: null,
        year: 2026,
        startYear: 2026,
        parentBudgetId: null,
        ownerId: 'user-1',
        ownerName: 'Owner',
        ownerEmail: 'owner@example.com',
        role: 'owner',
      },
    ];
    mocks.deleteOwnedBudget.mockResolvedValueOnce({ status: 'deleted', budgets, defaultBudgetId: 8 });

    const result = await deleteBudget('7');

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ budgets, defaultBudgetId: 8 });
  });
});
