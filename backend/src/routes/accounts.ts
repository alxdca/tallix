import { type Router as RouterType, Router } from 'express';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { withTenantContext } from '../db/context.js';
import * as accountsSvc from '../services/accounts.js';

const router: RouterType = Router();

// GET /api/accounts/:year - Get all accounts with balances for a year
router.get(
  '/:year',
  asyncHandler(async (req, res) => {
    const year = parseInt(req.params.year, 10);
    if (Number.isNaN(year)) {
      throw new AppError(400, 'Invalid year');
    }
    const budgetId = req.budget!.id;
    const userId = req.user!.id;
    const result = await withTenantContext(userId, budgetId, (tx) =>
      accountsSvc.getAccountsForYear(tx, year, budgetId, userId)
    );
    res.json(result);
  })
);

// PUT /api/accounts/:year/balance - Set initial balance for an account
router.put(
  '/:year/balance',
  asyncHandler(async (req, res) => {
    const year = parseInt(req.params.year, 10);
    if (Number.isNaN(year)) {
      throw new AppError(400, 'Invalid year');
    }

    const { paymentMethodId, initialBalance } = req.body;
    if (!paymentMethodId || initialBalance === undefined) {
      throw new AppError(400, 'paymentMethodId and initialBalance are required');
    }

    const budgetId = req.budget!.id;
    const userId = req.user!.id;
    await withTenantContext(userId, budgetId, (tx) =>
      accountsSvc.setAccountBalance(tx, year, parseInt(paymentMethodId, 10), initialBalance, budgetId, userId)
    );
    res.json({ success: true });
  })
);

// PUT /api/accounts/payment-method/:id/savings - Toggle payment method as savings account
router.put(
  '/payment-method/:id/savings',
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
