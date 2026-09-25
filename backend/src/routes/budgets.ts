import { Router, type Router as RouterType } from 'express';
import { withTenantContext, withUserContext } from '../db/context.js';
import { requireBudget, requireBudgetOwner } from '../middleware/budget.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import * as budgetsSvc from '../services/budgets.js';

const router: RouterType = Router();

function parseRole(value: unknown): 'read' | 'write' {
  if (value !== 'read' && value !== 'write') {
    throw new AppError(400, 'role must be either read or write');
  }
  return value;
}

router.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const ownBudget = await withUserContext(userId, (tx) => budgetsSvc.getOrCreateDefaultBudget(tx, userId));
    const budgets = await withUserContext(userId, (tx) => budgetsSvc.listAccessibleBudgets(tx, userId));
    res.json({ budgets, defaultBudgetId: ownBudget.id });
  })
);

router.get(
  '/current/shares',
  requireBudget,
  requireBudgetOwner,
  asyncHandler(async (req, res) => {
    const shares = await withTenantContext(req.user!.id, req.budget!.id, (tx) =>
      budgetsSvc.listBudgetShares(tx, req.budget!.id)
    );
    res.json(shares);
  })
);

router.post(
  '/current/shares',
  requireBudget,
  requireBudgetOwner,
  asyncHandler(async (req, res) => {
    const email = typeof req.body.email === 'string' ? req.body.email.trim() : '';
    if (!email) throw new AppError(400, 'email is required');
    const role = parseRole(req.body.role);
    try {
      await withTenantContext(req.user!.id, req.budget!.id, (tx) =>
        budgetsSvc.shareBudgetWithUser(tx, req.budget!.id, req.user!.id, email, role)
      );
    } catch (error) {
      if (error instanceof budgetsSvc.BudgetShareUserNotFoundError) {
        throw new AppError(404, error.message, { code: 'BUDGET_SHARE_USER_NOT_FOUND' });
      }
      if (error instanceof budgetsSvc.BudgetAlreadyOwnedError) {
        throw new AppError(409, error.message, { code: 'BUDGET_SHARE_ALREADY_OWNER' });
      }
      throw error;
    }
    const shares = await withTenantContext(req.user!.id, req.budget!.id, (tx) =>
      budgetsSvc.listBudgetShares(tx, req.budget!.id)
    );
    res.status(201).json(shares);
  })
);

router.put(
  '/current/shares/:shareId',
  requireBudget,
  requireBudgetOwner,
  asyncHandler(async (req, res) => {
    const shareId = Number.parseInt(req.params.shareId, 10);
    if (Number.isNaN(shareId)) throw new AppError(400, 'Invalid share ID');
    const role = parseRole(req.body.role);
    const updated = await withTenantContext(req.user!.id, req.budget!.id, (tx) =>
      budgetsSvc.updateBudgetShare(tx, req.budget!.id, shareId, role)
    );
    if (!updated) throw new AppError(404, 'Budget share not found');
    res.json(updated);
  })
);

router.delete(
  '/current/shares/:shareId',
  requireBudget,
  requireBudgetOwner,
  asyncHandler(async (req, res) => {
    const shareId = Number.parseInt(req.params.shareId, 10);
    if (Number.isNaN(shareId)) throw new AppError(400, 'Invalid share ID');
    const deleted = await withTenantContext(req.user!.id, req.budget!.id, (tx) =>
      budgetsSvc.deleteBudgetShare(tx, req.budget!.id, shareId)
    );
    if (!deleted) throw new AppError(404, 'Budget share not found');
    res.status(204).send();
  })
);

export default router;
