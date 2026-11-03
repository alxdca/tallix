import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError, errorHandler } from '../src/middleware/errorHandler.js';

const mocks = vi.hoisted(() => ({
  createYear: vi.fn(),
  deleteYear: vi.fn(),
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
    deleteYear: mocks.deleteYear,
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
    send: vi.fn(() => {
      resolve();
      return response;
    }),
    body: undefined as unknown,
  };
  return response;
}

async function dispatchBudgetRoute(
  method: 'get' | 'post' | 'delete',
  path: '/year/:year' | '/years' | '/years/:year',
  req: Partial<Request>
) {
  const budgetRoutes = (await import('../src/routes/budget.js')).default;
  const layer = budgetRoutes.stack.find(
    (candidate) => candidate.route?.methods?.[method] && candidate.route.path === path
  );
  const handlers = layer?.route?.stack
    .filter((candidate) => candidate.method === method)
    .map((candidate) => candidate.handle);
  if (!handlers?.length) throw new Error(`${method.toUpperCase()} ${path} route not found`);

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
    let handlerIndex = 0;
    const next: NextFunction = (error?: unknown) => {
      if (!error) {
        const handler = handlers[handlerIndex++];
        if (handler) handler(request, res, next);
        else resolve();
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
      next();
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

describe('single budget year deletion routes', () => {
  const ownerBudget = {
    id: 12,
    userId: 'writer-1',
    description: 'Family',
    startYear: 2026,
    parentBudgetId: null,
    role: 'owner' as const,
  };

  it('deletes a calendar year in the active owner budget', async () => {
    mocks.deleteYear.mockResolvedValueOnce({ id: 77 });
    const result = await dispatchBudgetRoute('delete', '/years/:year', {
      params: { year: '2027' },
      budget: ownerBudget,
    });
    expect(result.status).toBe(204);
    expect(mocks.deleteYear).toHaveBeenCalledWith({}, 2027, 12, 'writer-1');
  });

  it.each(['read', 'write'] as const)('rejects %s collaborators before deleting data', async (role) => {
    const result = await dispatchBudgetRoute('delete', '/years/:year', {
      params: { year: '2027' },
      budget: { ...ownerBudget, role },
    });
    expect(result.status).toBe(403);
    expect(mocks.deleteYear).not.toHaveBeenCalled();
  });

  it.each(['2027x', '0', '1899', '10000', '2027.5', '-2027'])('rejects malformed year %s', async (year) => {
    const result = await dispatchBudgetRoute('delete', '/years/:year', { params: { year }, budget: ownerBudget });
    expect(result.status).toBe(400);
    expect(mocks.deleteYear).not.toHaveBeenCalled();
  });

  it('returns 404 when the year does not belong to this budget', async () => {
    mocks.deleteYear.mockResolvedValueOnce(null);
    expect(
      (await dispatchBudgetRoute('delete', '/years/:year', { params: { year: '2027' }, budget: ownerBudget })).status
    ).toBe(404);
  });

  it('returns a specific error when deleting the final year', async () => {
    mocks.deleteYear.mockRejectedValueOnce(
      new AppError(400, 'Cannot delete the last year of a budget', { code: 'CANNOT_DELETE_LAST_BUDGET_YEAR' })
    );
    const result = await dispatchBudgetRoute('delete', '/years/:year', {
      params: { year: '2027' },
      budget: ownerBudget,
    });
    expect(result.status).toBe(400);
    expect(result.body).toMatchObject({ code: 'CANNOT_DELETE_LAST_BUDGET_YEAR' });
  });
});
