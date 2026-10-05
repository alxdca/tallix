import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../src/middleware/errorHandler.js';

const mocks = vi.hoisted(() => ({
  createYear: vi.fn(),
  getBudgetDataForYear: vi.fn(),
  getBudgetYear: vi.fn(),
  withTenantContext: vi.fn(async (_userId: string, _budgetId: number, callback: (tx: unknown) => Promise<unknown>) => {
    return await callback({});
  }),
}));

vi.mock('../src/db/context.js', () => ({
  withTenantContext: mocks.withTenantContext,
}));

vi.mock('../src/services/budget.js', async () => {
  const actual = await vi.importActual<typeof import('../src/services/budget.js')>('../src/services/budget.js');
  return {
    ...actual,
    createYear: mocks.createYear,
    getBudgetDataForYear: mocks.getBudgetDataForYear,
    getBudgetYear: mocks.getBudgetYear,
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

async function dispatchBudgetRoute(method: 'get' | 'post', path: '/year/:year' | '/years', req: Partial<Request>) {
  const budgetRoutes = (await import('../src/routes/budget.js')).default;
  const layer = budgetRoutes.stack.find(
    (candidate) => candidate.route?.methods?.[method] && candidate.route.path === path
  );
  const handler = layer?.route?.stack.find((candidate) => candidate.method === method)?.handle;
  if (!handler) throw new Error(`${method.toUpperCase()} ${path} route not found`);

  const request = {
    method: method.toUpperCase(),
    path,
    params: {},
    user: {
      id: 'writer-1',
      email: 'writer@example.com',
      name: 'Writer',
      language: 'en',
      country: null,
    },
    budget: {
      id: 12,
      userId: 'owner-1',
      description: 'Family',
      startYear: 2026,
      parentBudgetId: null,
      role: 'write',
    },
    body: {},
    query: {},
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe('budget year routes', () => {
  it('creates a year inside the active budget using the budget owner context', async () => {
    mocks.createYear.mockResolvedValueOnce({ id: 77, year: 2027, initialBalance: 0 });

    const result = await dispatchBudgetRoute('post', '/years', { body: { year: 2027 } });

    expect(result.status).toBe(201);
    expect(result.body).toEqual({ id: 77, year: 2027 });
    expect(mocks.createYear).toHaveBeenCalledWith({}, 2027, 0, 12, 'owner-1');
  });

  it('returns conflict for duplicate years in the same budget', async () => {
    const { BudgetYearAlreadyExistsError } = await import('../src/services/budget.js');
    mocks.createYear.mockRejectedValueOnce(new BudgetYearAlreadyExistsError(2027));

    const result = await dispatchBudgetRoute('post', '/years', { body: { year: 2027 } });

    expect(result.status).toBe(409);
    expect(result.body).toMatchObject({ error: 'Year 2027 already exists', code: 'BUDGET_YEAR_ALREADY_EXISTS' });
  });

  it('reads an existing non-start year from the active budget', async () => {
    const budgetData = { yearId: 77, year: 2027, initialBalance: 0, groups: [] };
    mocks.getBudgetYear.mockResolvedValueOnce({ id: 77, year: 2027 });
    mocks.getBudgetDataForYear.mockResolvedValueOnce(budgetData);

    const result = await dispatchBudgetRoute('get', '/year/:year', { params: { year: '2027' } });

    expect(result.status).toBe(200);
    expect(result.body).toEqual(budgetData);
    expect(mocks.getBudgetDataForYear).toHaveBeenCalledWith({}, 2027, 12, 'owner-1');
  });

  it('rejects reads for years that do not belong to the active budget', async () => {
    mocks.getBudgetYear.mockResolvedValueOnce(null);

    const result = await dispatchBudgetRoute('get', '/year/:year', { params: { year: '2027' } });

    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({ error: 'Budget year not found' });
    expect(mocks.getBudgetDataForYear).not.toHaveBeenCalled();
  });
});
