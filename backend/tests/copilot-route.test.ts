import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { errorHandler } from '../src/middleware/errorHandler.js';

const mocks = vi.hoisted(() => ({
  askCopilot: vi.fn(),
  getBudgetYear: vi.fn(),
  isLLMConfigured: vi.fn(),
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
    getBudgetYear: mocks.getBudgetYear,
  };
});

vi.mock('../src/services/copilot.js', async () => {
  const actual = await vi.importActual<typeof import('../src/services/copilot.js')>('../src/services/copilot.js');
  return {
    ...actual,
    askCopilot: mocks.askCopilot,
    isLLMConfigured: mocks.isLLMConfigured,
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

async function dispatchCopilotAsk(body: unknown) {
  const copilotRoutes = (await import('../src/routes/copilot.js')).default;
  const layer = copilotRoutes.stack.find(
    (candidate) => candidate.route?.methods?.post && candidate.route.path === '/ask'
  );
  const handler = layer?.route?.stack.find((candidate) => candidate.method === 'post')?.handle;
  if (!handler) throw new Error('POST /ask route not found');

  const request = {
    method: 'POST',
    path: '/ask',
    params: {},
    user: {
      id: 'user-1',
      email: 'owner@example.com',
      name: 'Owner',
      language: 'en',
      country: 'CH',
    },
    budget: {
      id: 12,
      userId: 'owner-1',
      description: 'Family',
      startYear: 2026,
      parentBudgetId: null,
      role: 'owner',
    },
    body,
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
  mocks.isLLMConfigured.mockReturnValue(true);
});

describe('copilot route', () => {
  it('uses the selected existing budget year as the default context year', async () => {
    const answer = { summary: 'ok', why: [], confidence: 'high', isFallback: false, latencyMs: 1 };
    mocks.getBudgetYear.mockResolvedValueOnce({ id: 77, year: 2027 });
    mocks.askCopilot.mockResolvedValueOnce(answer);

    const result = await dispatchCopilotAsk({ question: 'How are we doing?', year: 2027 });

    expect(result.status).toBe(200);
    expect(result.body).toEqual(answer);
    expect(mocks.askCopilot).toHaveBeenCalledWith(
      {},
      'How are we doing?',
      expect.objectContaining({ budgetId: 12, currentYear: 2027, country: 'CH' })
    );
  });

  it('rejects a selected year outside the active budget before asking the LLM', async () => {
    mocks.getBudgetYear.mockResolvedValueOnce(null);

    const result = await dispatchCopilotAsk({ question: 'How are we doing?', year: 2027 });

    expect(result.status).toBe(404);
    expect(result.body).toMatchObject({ error: 'Budget year not found' });
    expect(mocks.askCopilot).not.toHaveBeenCalled();
  });
});
