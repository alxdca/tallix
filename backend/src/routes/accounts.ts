import { type Request, Router, type Router as RouterType } from 'express';
import { withTenantContext } from '../db/context.js';
import { requireBudgetOwner } from '../middleware/budget.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import * as accountsSvc from '../services/accounts.js';
import * as budgetSvc from '../services/budget.js';

const router: RouterType = Router();

function parsePaymentMethodId(value: unknown): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || !/^\d+$/.test(String(value))) {
    throw new AppError(400, 'Invalid payment method ID');
  }
  const id = Number(value);
  if (!Number.isSafeInteger(id) || id <= 0) throw new AppError(400, 'Invalid payment method ID');
  return id;
}

async function parseSelectedYear(req: Request): Promise<number> {
  const year = parseInt(req.params.year, 10);
  if (Number.isNaN(year)) {
    throw new AppError(400, 'Invalid year');
  }
  const budgetId = req.budget!.id;
  const userId = req.user!.id;
  const existing = await withTenantContext(userId, budgetId, (tx) => budgetSvc.getBudgetYear(tx, year, budgetId));
  if (!existing) {
    throw new AppError(404, 'Budget year not found');
  }
  return year;
}

// GET /api/accounts/:year - Get all accounts with balances for a year
router.get(
  '/:year',
  asyncHandler(async (req, res) => {
    const year = await parseSelectedYear(req);
    const budgetId = req.budget!.id;
    const userId = req.user!.id;
    const ownerId = req.budget!.userId;
    const result = await withTenantContext(userId, budgetId, (tx) =>
      accountsSvc.getAccountsForYear(tx, year, budgetId, ownerId)
    );
    res.json(result);
  })
);

// PUT /api/accounts/:year/balance - Set initial balance for an account
router.put(
  '/:year/balance',
  asyncHandler(async (req, res) => {
    const year = await parseSelectedYear(req);

    const paymentMethodId = parsePaymentMethodId(req.body.paymentMethodId);
    const { initialBalance, breakLink } = req.body;
    if (
      typeof initialBalance !== 'number' ||
      !Number.isFinite(initialBalance) ||
      Math.abs(initialBalance) > 9999999999.99
    ) {
      throw new AppError(400, 'Initial balance must be a finite amount within the supported range');
    }
    if (breakLink !== undefined && typeof breakLink !== 'boolean')
      throw new AppError(400, 'breakLink must be a boolean');

    const budgetId = req.budget!.id;
    const userId = req.user!.id;
    const ownerId = req.budget!.userId;
    await withTenantContext(userId, budgetId, async (tx) => {
      const { accounts } = await accountsSvc.getAccountsForYear(tx, year, budgetId, ownerId);
      const account = accounts.find((candidate) => candidate.id === paymentMethodId);
      if (!account) throw new AppError(404, 'Account not found');
      if ((account.inheritedFromParent || account.linkedFromYear != null) && breakLink !== true) {
        throw new AppError(409, 'Confirm that overriding this opening balance breaks its link', {
          code: 'BALANCE_LINK_CONFIRMATION_REQUIRED',
        });
      }
      await accountsSvc.setAccountBalance(tx, year, paymentMethodId, initialBalance, budgetId, ownerId);
    });
    res.json({ success: true });
  })
);

// PUT /api/accounts/:year/balance/restore-link - Resume the automatic opening balance
router.put(
  '/:year/balance/restore-link',
  asyncHandler(async (req, res) => {
    const year = await parseSelectedYear(req);
    const paymentMethodId = parsePaymentMethodId(req.body.paymentMethodId);
    await withTenantContext(req.user!.id, req.budget!.id, (tx) =>
      accountsSvc.restoreAccountBalanceLink(tx, year, paymentMethodId, req.budget!.id, req.budget!.userId)
    );
    res.json({ success: true });
  })
);

// PUT /api/accounts/payment-method/:id/savings - Toggle payment method as savings account
router.put(
  '/payment-method/:id/savings',
  requireBudgetOwner,
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      throw new AppError(400, 'Invalid payment method ID');
    }

    const { isSavingsAccount } = req.body;
    if (typeof isSavingsAccount !== 'boolean') {
      throw new AppError(400, 'isSavingsAccount must be a boolean');
    }

    const userId = req.user!.id;
    const budgetId = req.budget!.id;
    await withTenantContext(userId, budgetId, (tx) =>
      accountsSvc.setPaymentMethodAsSavingsAccount(tx, id, isSavingsAccount, userId, budgetId)
    );
    res.json({ success: true });
  })
);

export default router;
