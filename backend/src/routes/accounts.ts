import { Router } from 'express';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import * as accountsSvc from '../services/accounts.js';
import { isValidAccountType } from '../types/accounts.js';

const router = Router();

// GET /api/accounts/:year - Get all accounts with balances for a year
router.get(
  '/:year',
  asyncHandler(async (req, res) => {
    const year = parseInt(req.params.year, 10);
    if (Number.isNaN(year)) {
      throw new AppError(400, 'Invalid year');
    }
    const accounts = await accountsSvc.getAccountsForYear(year);
    res.json(accounts);
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

    const { accountType, accountId, initialBalance } = req.body;
    if (!accountType || !accountId || initialBalance === undefined) {
      throw new AppError(400, 'accountType, accountId, and initialBalance are required');
    }

    if (!isValidAccountType(accountType)) {
      throw new AppError(400, 'accountType must be savings_item or payment_method');
    }

    await accountsSvc.setAccountBalance(year, accountType, parseInt(accountId, 10), initialBalance);
    res.json({ success: true });
  })
);

// PUT /api/accounts/payment-method/:id/toggle - Toggle payment method as account
router.put(
  '/payment-method/:id/toggle',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      throw new AppError(400, 'Invalid payment method ID');
    }

    const { isAccount } = req.body;
    if (typeof isAccount !== 'boolean') {
      throw new AppError(400, 'isAccount must be a boolean');
    }

    await accountsSvc.setPaymentMethodAsAccount(id, isAccount);
    res.json({ success: true });
  })
);

export default router;
