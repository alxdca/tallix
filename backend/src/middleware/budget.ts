import type { Request, Response, NextFunction } from 'express';
import { withUserContext } from '../db/context.js';
import { budgets } from '../db/schema.js';
import { eq } from 'drizzle-orm';

// Extend Express Request to include budget
declare global {
  namespace Express {
    interface Request {
      budget?: {
        id: number;
        userId: string;
        description: string | null;
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

    const budget = await withUserContext(userId, async (tx) => {
      let found = await tx.query.budgets.findFirst({
        where: eq(budgets.userId, userId),
      });

      if (!found) {
        const [newBudget] = await tx
          .insert(budgets)
          .values({
            userId,
            description: null,
            startYear: new Date().getFullYear(),
          })
          .returning();
        found = newBudget;
      }

      return found;
    });

    req.budget = {
      id: budget.id,
      userId: budget.userId,
      description: budget.description,
    };

    next();
  } catch (error) {
    console.error('Budget middleware error:', error);
    res.status(500).json({ error: 'Failed to load budget context' });
  }
}
