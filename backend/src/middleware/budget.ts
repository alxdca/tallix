import type { NextFunction, Request, Response } from 'express';
import { withUserContext } from '../db/context.js';
import { type BudgetAccessRole, getAccessibleBudget, getOrCreateDefaultBudget } from '../services/budgets.js';

// Extend Express Request to include budget
declare global {
  namespace Express {
    interface Request {
      budget?: {
        id: number;
        userId: string;
        description: string | null;
        role: BudgetAccessRole;
      };
    }
  }
}

/**
 * Budget context middleware - requires authentication (use after requireAuth)
 * Attaches user's budget to request
 * Creates budget if user doesn't have one yet
 *
 * Uses withUserContext to ensure RLS policies on the budgets table are enforced.
 */
export async function requireBudget(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    const userId = req.user.id;

    const selectedHeader = req.header('x-budget-id');
    const selectedBudgetId = selectedHeader ? Number.parseInt(selectedHeader, 10) : null;
    if (selectedHeader && (selectedBudgetId === null || Number.isNaN(selectedBudgetId))) {
      res.status(400).json({ error: 'Invalid budget ID' });
      return;
    }

    const access = await withUserContext(userId, async (tx) => {
      if (selectedBudgetId !== null) {
        return await getAccessibleBudget(tx, userId, selectedBudgetId);
      }
      const ownBudget = await getOrCreateDefaultBudget(tx, userId);
      return { budget: ownBudget, role: 'owner' as const };
    });

    if (!access) {
      res.status(403).json({ error: 'You do not have access to this budget' });
      return;
    }

    req.budget = {
      id: access.budget.id,
      userId: access.budget.userId,
      description: access.budget.description,
      role: access.role,
    };

    next();
  } catch (error) {
    console.error('Budget middleware error:', error);
    res.status(500).json({ error: 'Failed to load budget context' });
  }
}

export function requireBudgetWrite(req: Request, res: Response, next: NextFunction) {
  if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') {
    next();
    return;
  }
  if (req.budget?.role !== 'owner' && req.budget?.role !== 'write') {
    res.status(403).json({ error: 'Write access to this budget is required' });
    return;
  }
  next();
}

export function requireBudgetOwner(req: Request, res: Response, next: NextFunction) {
  if (req.budget?.role !== 'owner') {
    res.status(403).json({ error: 'Only the budget owner can perform this action' });
    return;
  }
  next();
}
