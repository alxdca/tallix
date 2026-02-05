import { Router } from 'express';
import * as transfersSvc from '../services/transfers.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';

const router = Router();

// Get all transfers for a year
router.get('/:year', asyncHandler(async (req, res) => {
  const year = parseInt(req.params.year, 10);
  if (isNaN(year)) {
    throw new AppError(400, 'Invalid year');
  }
  const transfers = await transfersSvc.getTransfersForYear(year);
  res.json(transfers);
}));

// Get available accounts for transfer
router.get('/:year/accounts', asyncHandler(async (req, res) => {
  const year = parseInt(req.params.year, 10);
  if (isNaN(year)) {
    throw new AppError(400, 'Invalid year');
  }
  const accounts = await transfersSvc.getAvailableAccounts(year);
  res.json(accounts);
}));

// Create a new transfer
router.post('/:year', asyncHandler(async (req, res) => {
  const year = parseInt(req.params.year, 10);
  if (isNaN(year)) {
    throw new AppError(400, 'Invalid year');
  }
  
  const { date, amount, description, sourceAccountType, sourceAccountId, destinationAccountType, destinationAccountId, accountingMonth, accountingYear } = req.body;

  if (!date || amount === undefined || !sourceAccountType || !sourceAccountId || !destinationAccountType || !destinationAccountId) {
    throw new AppError(400, 'Date, amount, source and destination accounts are required');
  }

  if (sourceAccountType === destinationAccountType && sourceAccountId === destinationAccountId) {
    throw new AppError(400, 'Source and destination accounts must be different');
  }

  const transfer = await transfersSvc.createTransfer(year, {
    date,
    amount: parseFloat(amount),
    description,
    sourceAccountType,
    sourceAccountId: parseInt(sourceAccountId, 10),
    destinationAccountType,
    destinationAccountId: parseInt(destinationAccountId, 10),
    accountingMonth: accountingMonth ? parseInt(accountingMonth, 10) : undefined,
    accountingYear: accountingYear ? parseInt(accountingYear, 10) : undefined,
  });

  res.status(201).json(transfer);
}));

// Update a transfer
router.put('/:id', asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    throw new AppError(400, 'Invalid transfer ID');
  }

  const { date, amount, description, sourceAccountType, sourceAccountId, destinationAccountType, destinationAccountId, accountingMonth, accountingYear } = req.body;

  const transfer = await transfersSvc.updateTransfer(id, {
    date,
    amount: amount !== undefined ? parseFloat(amount) : undefined,
    description,
    sourceAccountType,
    sourceAccountId: sourceAccountId !== undefined ? parseInt(sourceAccountId, 10) : undefined,
    destinationAccountType,
    destinationAccountId: destinationAccountId !== undefined ? parseInt(destinationAccountId, 10) : undefined,
    accountingMonth: accountingMonth !== undefined ? parseInt(accountingMonth, 10) : undefined,
    accountingYear: accountingYear !== undefined ? parseInt(accountingYear, 10) : undefined,
  });

  if (!transfer) {
    throw new AppError(404, 'Transfer not found');
  }

  res.json(transfer);
}));

// Delete a transfer
router.delete('/:id', asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    throw new AppError(400, 'Invalid transfer ID');
  }
  
  const deleted = await transfersSvc.deleteTransfer(id);
  
  if (!deleted) {
    throw new AppError(404, 'Transfer not found');
  }

  res.json({ success: true });
}));

export default router;
