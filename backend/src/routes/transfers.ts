import { type Request, Router, type Router as RouterType } from 'express';
import { withTenantContext } from '../db/context.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import * as budgetSvc from '../services/budget.js';
import * as transfersSvc from '../services/transfers.js';

const router: RouterType = Router();

async function parseSelectedYear(req: Request): Promise<number> {
  const year = parseInteger(req.params.year);
  if (year === undefined) {
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

function parseInteger(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value === 'number' && Number.isInteger(value)) {
    return value;
  }
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) {
    return Number(value);
  }
  return undefined;
}

function requiredInteger(value: unknown, fieldName: string): number {
  const parsed = parseInteger(value);
  if (parsed === undefined) {
    throw new AppError(400, `${fieldName} must be an integer`);
  }
  return parsed;
}

function optionalInteger(value: unknown, fieldName: string): number | undefined {
  const parsed = parseInteger(value);
  if (parsed === undefined && value !== undefined && value !== null && value !== '') {
    throw new AppError(400, `${fieldName} must be an integer`);
  }
  return parsed;
}

function optionalPeriodMonth(value: unknown, fieldName: string): number | undefined {
  const parsed = optionalInteger(value, fieldName);
  if (parsed !== undefined && (parsed < 1 || parsed > 12)) {
    throw new AppError(400, `${fieldName} must be between 1 and 12`);
  }
  return parsed;
}

function optionalPeriodYear(value: unknown, fieldName: string): number | undefined {
  const parsed = optionalInteger(value, fieldName);
  if (parsed !== undefined && (parsed < 1900 || parsed > 9999)) {
    throw new AppError(400, `${fieldName} must be between 1900 and 9999`);
  }
  return parsed;
}

function validateOptionalPeriodPair(month: number | undefined, year: number | undefined, label: string): void {
  if ((month === undefined) !== (year === undefined)) {
    throw new AppError(400, `${label} accounting month and year must be provided together`);
  }
}

function optionalAmount(value: unknown, fieldName: string): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  const parsed = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    throw new AppError(400, `${fieldName} must be a number`);
  }
  return parsed;
}

function requiredAmount(value: unknown, fieldName: string): number {
  const parsed = optionalAmount(value, fieldName);
  if (parsed === undefined) {
    throw new AppError(400, `${fieldName} must be a number`);
  }
  return parsed;
}

// Get all transfers for a year
router.get(
  '/:year',
  asyncHandler(async (req, res) => {
    const year = await parseSelectedYear(req);
    const budgetId = req.budget!.id;
    const userId = req.user!.id;
    const ownerId = req.budget!.userId;
    const transfers = await withTenantContext(userId, budgetId, (tx) =>
      transfersSvc.getTransfersForYear(tx, year, budgetId, ownerId)
    );
    res.json(transfers);
  })
);

// Get available accounts for transfer
router.get(
  '/:year/accounts',
  asyncHandler(async (req, res) => {
    await parseSelectedYear(req);
    const userId = req.user!.id;
    const budgetId = req.budget!.id;
    const ownerId = req.budget!.userId;
    const accounts = await withTenantContext(userId, budgetId, (tx) => transfersSvc.getAvailableAccounts(tx, ownerId));
    res.json(accounts);
  })
);

// Create a new transfer
router.post(
  '/:year',
  asyncHandler(async (req, res) => {
    const year = await parseSelectedYear(req);

    const {
      date,
      amount,
      description,
      sourceAccountId,
      destinationAccountId,
      accountingMonth,
      accountingYear,
      sourceAccountingMonth,
      sourceAccountingYear,
      destinationAccountingMonth,
      destinationAccountingYear,
    } = req.body;

    if (!date || amount === undefined || !sourceAccountId || !destinationAccountId) {
      throw new AppError(400, 'Date, amount, source and destination accounts are required');
    }

    const parsedSourceAccountId = requiredInteger(sourceAccountId, 'sourceAccountId');
    const parsedDestinationAccountId = requiredInteger(destinationAccountId, 'destinationAccountId');

    if (parsedSourceAccountId === parsedDestinationAccountId) {
      throw new AppError(400, 'Source and destination accounts must be different');
    }
    const parsedAccountingMonth = optionalPeriodMonth(accountingMonth, 'accountingMonth');
    const parsedAccountingYear = optionalPeriodYear(accountingYear, 'accountingYear');
    const parsedSourceAccountingMonth = optionalPeriodMonth(sourceAccountingMonth, 'sourceAccountingMonth');
    const parsedSourceAccountingYear = optionalPeriodYear(sourceAccountingYear, 'sourceAccountingYear');
    const parsedDestinationAccountingMonth = optionalPeriodMonth(
      destinationAccountingMonth,
      'destinationAccountingMonth'
    );
    const parsedDestinationAccountingYear = optionalPeriodYear(destinationAccountingYear, 'destinationAccountingYear');
    validateOptionalPeriodPair(parsedAccountingMonth, parsedAccountingYear, 'Legacy');
    validateOptionalPeriodPair(parsedSourceAccountingMonth, parsedSourceAccountingYear, 'Source');
    validateOptionalPeriodPair(parsedDestinationAccountingMonth, parsedDestinationAccountingYear, 'Destination');

    const budgetId = req.budget!.id;
    const userId = req.user!.id;
    const ownerId = req.budget!.userId;
    const transfer = await withTenantContext(userId, budgetId, (tx) =>
      transfersSvc.createTransfer(
        tx,
        year,
        {
          date,
          amount: requiredAmount(amount, 'amount'),
          description,
          sourceAccountId: parsedSourceAccountId,
          destinationAccountId: parsedDestinationAccountId,
          accountingMonth: parsedAccountingMonth,
          accountingYear: parsedAccountingYear,
          sourceAccountingMonth: parsedSourceAccountingMonth,
          sourceAccountingYear: parsedSourceAccountingYear,
          destinationAccountingMonth: parsedDestinationAccountingMonth,
          destinationAccountingYear: parsedDestinationAccountingYear,
        },
        budgetId,
        ownerId
      )
    );

    res.status(201).json(transfer);
  })
);

// Update a transfer
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = parseInteger(req.params.id);
    if (id === undefined) {
      throw new AppError(400, 'Invalid transfer ID');
    }

    const {
      date,
      amount,
      description,
      sourceAccountId,
      destinationAccountId,
      accountingMonth,
      accountingYear,
      sourceAccountingMonth,
      sourceAccountingYear,
      destinationAccountingMonth,
      destinationAccountingYear,
    } = req.body;
    const parsedAccountingMonth = optionalPeriodMonth(accountingMonth, 'accountingMonth');
    const parsedAccountingYear = optionalPeriodYear(accountingYear, 'accountingYear');
    const parsedSourceAccountingMonth = optionalPeriodMonth(sourceAccountingMonth, 'sourceAccountingMonth');
    const parsedSourceAccountingYear = optionalPeriodYear(sourceAccountingYear, 'sourceAccountingYear');
    const parsedDestinationAccountingMonth = optionalPeriodMonth(
      destinationAccountingMonth,
      'destinationAccountingMonth'
    );
    const parsedDestinationAccountingYear = optionalPeriodYear(destinationAccountingYear, 'destinationAccountingYear');
    validateOptionalPeriodPair(parsedAccountingMonth, parsedAccountingYear, 'Legacy');
    validateOptionalPeriodPair(parsedSourceAccountingMonth, parsedSourceAccountingYear, 'Source');
    validateOptionalPeriodPair(parsedDestinationAccountingMonth, parsedDestinationAccountingYear, 'Destination');

    const budgetId = req.budget!.id;
    const userId = req.user!.id;
    const ownerId = req.budget!.userId;
    const transfer = await withTenantContext(userId, budgetId, (tx) =>
      transfersSvc.updateTransfer(
        tx,
        id,
        {
          date,
          amount: optionalAmount(amount, 'amount'),
          description,
          sourceAccountId: optionalInteger(sourceAccountId, 'sourceAccountId'),
          destinationAccountId: optionalInteger(destinationAccountId, 'destinationAccountId'),
          accountingMonth: parsedAccountingMonth,
          accountingYear: parsedAccountingYear,
          sourceAccountingMonth: parsedSourceAccountingMonth,
          sourceAccountingYear: parsedSourceAccountingYear,
          destinationAccountingMonth: parsedDestinationAccountingMonth,
          destinationAccountingYear: parsedDestinationAccountingYear,
        },
        budgetId,
        ownerId
      )
    );

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
    const id = parseInteger(req.params.id);
    if (id === undefined) {
      throw new AppError(400, 'Invalid transfer ID');
    }

    const budgetId = req.budget!.id;
    const userId = req.user!.id;
    const deleted = await withTenantContext(userId, budgetId, (tx) => transfersSvc.deleteTransfer(tx, id, budgetId));

    if (!deleted) {
      throw new AppError(404, 'Transfer not found');
    }

    res.json({ success: true });
  })
);

export default router;
