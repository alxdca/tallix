import { Router, type Router as RouterType } from 'express';
import multer from 'multer';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import * as importSvc from '../services/import.js';
import * as transactionsSvc from '../services/transactions.js';

const router: RouterType = Router();

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype === 'application/pdf') {
      cb(null, true);
    } else {
      cb(new Error('Only PDF files are allowed'));
    }
  },
});

// POST /api/import/pdf - Upload and parse PDF
router.post(
  '/pdf',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new AppError(400, 'No file uploaded');
    }

    const yearId = req.query.yearId ? parseInt(req.query.yearId as string, 10) : null;
    const result = await importSvc.parsePdfAndExtract(req.file.buffer, yearId);

    if (result.transactions.length === 0) {
      throw new AppError(400, 'No transactions found in PDF. The PDF format may not be supported.');
    }

    res.json(result);
  })
);

// POST /api/import/bulk - Bulk create transactions
router.post(
  '/bulk',
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const { yearId, transactions: transactionsData } = req.body as {
      yearId: number;
      transactions: Array<{
        date: string;
        description?: string;
        comment?: string;
        thirdParty: string;
        paymentMethod: string;
        amount: number;
        itemId?: number | null;
        accountingMonth?: number;
        accountingYear?: number;
      }>;
    };

    if (!yearId || !transactionsData || !Array.isArray(transactionsData)) {
      throw new AppError(400, 'yearId and transactions array are required');
    }

    // Validate all transactions have required fields
    const invalidTransactions: number[] = [];
    transactionsData.forEach((t, index) => {
      if (!t.date || !t.paymentMethod || t.amount === undefined) {
        invalidTransactions.push(index + 1);
      }
    });

    if (invalidTransactions.length > 0) {
      throw new AppError(
        400,
        `Transactions ${invalidTransactions.join(', ')} are incomplete. Each transaction must have date, payment method, and amount.`
      );
    }

    const result = await transactionsSvc.bulkCreateTransactions(userId, yearId, transactionsData);
    res.status(201).json(result);
  })
);

export default router;
