import { Router, type Router as RouterType } from 'express';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { withTenantContext } from '../db/context.js';
import * as transactionsSvc from '../services/transactions.js';

const router: RouterType = Router();

// GET /api/transactions/third-parties - Get distinct third parties for autocomplete
router.get(
  '/third-parties',
  asyncHandler(async (req, res) => {
    const search = req.query.search as string | undefined;
    const budgetId = req.budget!.id;
    const userId = req.user!.id;
    const thirdParties = await withTenantContext(userId, budgetId, (tx) =>
      transactionsSvc.getThirdParties(tx, search, budgetId)
    );
    res.json(thirdParties);
  })
);

// GET /api/transactions - Get all transactions for current year
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const currentYear = new Date().getFullYear();
    const budgetId = req.budget!.id;
    const userId = req.user!.id;
    const transactions = await withTenantContext(userId, budgetId, (tx) =>
      transactionsSvc.getTransactionsForYear(tx, currentYear, budgetId)
    );
    res.json(transactions);
  })
);

// GET /api/transactions/year/:year - Get transactions for a specific year
router.get(
  '/year/:year',
  asyncHandler(async (req, res) => {
    const year = parseInt(req.params.year, 10);
    if (Number.isNaN(year)) {
      throw new AppError(400, 'Invalid year');
    }
    const budgetId = req.budget!.id;
    const userId = req.user!.id;
    const transactions = await withTenantContext(userId, budgetId, (tx) =>
      transactionsSvc.getTransactionsForYear(tx, year, budgetId)
    );
    res.json(transactions);
  })
);

// POST /api/transactions - Create a new transaction
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const {
      yearId, itemId, date, description, comment, thirdParty,
      paymentMethod, amount, accountingMonth, accountingYear,
    } = req.body;

    if (!yearId || !date || !paymentMethod || amount === undefined) {
      throw new AppError(400, 'yearId, date, paymentMethod, and amount are required');
    }

    const budgetId = req.budget!.id;
    const newTransaction = await withTenantContext(userId, budgetId, (tx) =>
      transactionsSvc.createTransaction(tx, userId, budgetId, {
        yearId, itemId, date, description, comment, thirdParty,
        paymentMethod, amount, accountingMonth, accountingYear,
      })
    );

    res.status(201).json(newTransaction);
  })
);

// PUT /api/transactions/:id - Update a transaction
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      throw new AppError(400, 'Invalid transaction ID');
    }

    const {
      itemId, date, description, comment, thirdParty, paymentMethod,
      amount, accountingMonth, accountingYear, recalculateAccounting,
    } = req.body;

    const budgetId = req.budget!.id;
    const updated = await withTenantContext(userId, budgetId, (tx) =>
      transactionsSvc.updateTransaction(tx, userId, budgetId, id, {
        itemId, date, description, comment, thirdParty, paymentMethod,
        amount, accountingMonth, accountingYear, recalculateAccounting,
      })
    );

    if (!updated) {
      throw new AppError(404, 'Transaction not found');
    }

    res.json(updated);
  })
);

// DELETE /api/transactions/bulk - Delete multiple transactions
router.delete(
  '/bulk',
  asyncHandler(async (req, res) => {
    const { ids } = req.body;

    if (!Array.isArray(ids) || ids.length === 0) {
      throw new AppError(400, 'ids must be a non-empty array');
    }

    const numericIds = ids.map((id: string) => parseInt(id, 10)).filter((id: number) => !Number.isNaN(id));
    if (numericIds.length !== ids.length) {
      throw new AppError(400, 'All IDs must be valid numbers');
    }

    const budgetId = req.budget!.id;
    const userId = req.user!.id;
    const result = await withTenantContext(userId, budgetId, (tx) =>
      transactionsSvc.bulkDeleteTransactions(tx, numericIds, budgetId)
    );
    res.json(result);
  })
);

// DELETE /api/transactions/:id - Delete a transaction
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      throw new AppError(400, 'Invalid transaction ID');
    }

    const budgetId = req.budget!.id;
    const userId = req.user!.id;
    const deleted = await withTenantContext(userId, budgetId, (tx) =>
      transactionsSvc.deleteTransaction(tx, id, budgetId)
    );
    if (!deleted) {
      throw new AppError(404, 'Transaction not found');
    }
    res.status(204).send();
  })
);

export default router;
