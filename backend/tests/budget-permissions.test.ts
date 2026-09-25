import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { DbClient } from '../src/db/index.js';
import { requireBudgetOwner, requireBudgetWrite } from '../src/middleware/budget.js';
import { BudgetShareUserNotFoundError, shareBudgetWithUser } from '../src/services/budgets.js';

function createRequest(method: string, role: 'owner' | 'read' | 'write'): Request {
  return {
    method,
    budget: { id: 1, userId: 'owner-id', description: null, role },
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
