import { type Router as RouterType, Router } from 'express';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import * as transfersSvc from '../services/transfers.js';

const router: RouterType = Router();

// Get all transfers for a year
router.get(
  '/:year',
  asyncHandler(async (req, res) => {
    const year = parseInt(req.params.year, 10);
    if (Number.isNaN(year)) {
      throw new AppError(400, 'Invalid year');
    }
    const transfers = await transfersSvc.getTransfersForYear(year);
    res.json(transfers);
  })
);

// Get available accounts for transfer
router.get(
  '/:year/accounts',
  asyncHandler(async (_req, res) => {
    const accounts = await transfersSvc.getAvailableAccounts();
    res.json(accounts);
  })
);

// Create a new transfer
router.post(
  '/:year',
  asyncHandler(async (req, res) => {
    const year = parseInt(req.params.year, 10);
    if (Number.isNaN(year)) {
      throw new AppError(400, 'Invalid year');
    }

    const { date, amount, description, sourceAccountId, destinationAccountId, accountingMonth, accountingYear } =
      req.body;

    if (!date || amount === undefined || !sourceAccountId || !destinationAccountId) {
      throw new AppError(400, 'Date, amount, source and destination accounts are required');
    }

    if (sourceAccountId === destinationAccountId) {
      throw new AppError(400, 'Source and destination accounts must be different');
    }

    const transfer = await transfersSvc.createTransfer(year, {
      date,
      amount: parseFloat(amount),
      description,
      sourceAccountId: parseInt(sourceAccountId, 10),
      destinationAccountId: parseInt(destinationAccountId, 10),
      accountingMonth: accountingMonth ? parseInt(accountingMonth, 10) : undefined,
      accountingYear: accountingYear ? parseInt(accountingYear, 10) : undefined,
    });

    res.status(201).json(transfer);
  })
);

// Update a transfer
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      throw new AppError(400, 'Invalid transfer ID');
    }

    const { date, amount, description, sourceAccountId, destinationAccountId, accountingMonth, accountingYear } =
      req.body;

    const transfer = await transfersSvc.updateTransfer(id, {
      date,
      amount: amount !== undefined ? parseFloat(amount) : undefined,
      description,
      sourceAccountId: sourceAccountId !== undefined ? parseInt(sourceAccountId, 10) : undefined,
      destinationAccountId: destinationAccountId !== undefined ? parseInt(destinationAccountId, 10) : undefined,
      accountingMonth: accountingMonth !== undefined ? parseInt(accountingMonth, 10) : undefined,
      accountingYear: accountingYear !== undefined ? parseInt(accountingYear, 10) : undefined,
    });

    if (!transfer) {
      throw new AppError(404, 'Transfer not found');
    }

    res.json(transfer);
  })
);

// Delete a transfer
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      throw new AppError(400, 'Invalid transfer ID');
    }

    const deleted = await transfersSvc.deleteTransfer(id);

    if (!deleted) {
      throw new AppError(404, 'Transfer not found');
    }

    res.json({ success: true });
  })
);

export default router;
