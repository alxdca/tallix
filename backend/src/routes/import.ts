import { Router, type Router as RouterType } from 'express';
import multer from 'multer';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { withTenantContext } from '../db/context.js';
import * as importSvc from '../services/import.js';
import * as llmSvc from '../services/llm.js';
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

    const budgetId = req.budget!.id;
    const userId = req.user!.id;
    const yearId = req.query.yearId ? parseInt(req.query.yearId as string, 10) : null;
    const skipSuggestions = req.query.skipSuggestions === 'true';
    const result = await withTenantContext(userId, budgetId, (tx) =>
      importSvc.parsePdfAndExtract(tx, req.file!.buffer, budgetId, yearId, skipSuggestions)
    );

    if (result.transactions.length === 0) {
      throw new AppError(400, 'No transactions found in PDF. The PDF format may not be supported.');
    }

    res.json(result);
  })
);

// POST /api/import/pdf-llm - Extract and classify transactions from PDF using LLM only
router.post(
  '/pdf-llm',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!llmSvc.isLLMConfigured()) {
      throw new AppError(503, 'LLM classification service is not configured');
    }

    if (!req.file) {
      throw new AppError(400, 'No file uploaded');
    }

    const { categories, paymentMethods, language, country } = req.body as {
      categories: string;
      paymentMethods?: string;
      language?: string;
      country?: string;
    };

    if (!categories) {
      throw new AppError(400, 'categories is required');
    }

    const parsedCategories = JSON.parse(categories) as Array<{
      id: number;
      name: string;
      groupName: string;
      groupType: 'income' | 'expense' | 'savings';
    }>;

    const parsedPaymentMethods = paymentMethods
      ? (JSON.parse(paymentMethods) as Array<{
          id: number;
          name: string;
          institution: string | null;
        }>)
      : [];

    // Extract raw text from PDF (no DB needed)
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: req.file.buffer }) as any;
    await parser.load();
    const textResult = await parser.getText();
    const rawText = textResult.text || '';

    if (!rawText || rawText.trim().length < 50) {
      throw new AppError(400, 'Could not extract text from PDF');
    }

    const countryToUse = country || req.user?.country;
    if (!countryToUse) {
      throw new AppError(400, 'country is required for PDF LLM classification');
    }

    const transactions = await llmSvc.extractAndClassifyFromPdf(
      rawText,
      parsedCategories,
      parsedPaymentMethods,
      language || 'fr',
      countryToUse
    );

    if (transactions.length === 0) {
      throw new AppError(400, 'No transactions found in PDF');
    }

    res.json({ transactions });
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

    const invalidTransactions: number[] = [];
    transactionsData.forEach((t, index) => {
      if (!t.date || !t.paymentMethod || t.amount === undefined) {
        invalidTransactions.push(index + 1);
      }
    });

    if (invalidTransactions.length > 0) {
      throw new AppError(
        400,
        `Transactions ${invalidTransactions.join(', ')} are incomplete. Each transaction must have date, payment method, and amount.`,
        {
          code: 'IMPORT_TRANSACTIONS_INCOMPLETE',
          params: { indexes: invalidTransactions },
        }
      );
    }

    const budgetId = req.budget!.id;
    const result = await withTenantContext(userId, budgetId, (tx) =>
      transactionsSvc.bulkCreateTransactions(tx, userId, budgetId, yearId, transactionsData)
    );
    res.status(201).json(result);
  })
);

// GET /api/import/llm-status - Check if LLM classification is available
router.get(
  '/llm-status',
  asyncHandler(async (_req, res) => {
    res.json({
      available: llmSvc.isLLMConfigured(),
    });
  })
);

// POST /api/import/classify - Classify transactions using LLM
router.post(
  '/classify',
  asyncHandler(async (req, res) => {
    if (!llmSvc.isLLMConfigured()) {
      throw new AppError(503, 'LLM classification service is not configured');
    }

    const { transactions, categories, paymentMethods } = req.body as {
      transactions: Array<{
        index: number;
        date: string;
        description: string;
        amount: number;
        thirdParty?: string;
        rawDescription?: string;
        rawThirdParty?: string;
        rawCategory?: string;
        rawPaymentMethod?: string;
      }>;
      categories: Array<{
        id: number;
        name: string;
        groupName: string;
        groupType: 'income' | 'expense';
      }>;
      paymentMethods?: Array<{
        id: number;
        name: string;
        institution: string | null;
      }>;
    };

    if (!transactions || !Array.isArray(transactions) || transactions.length === 0) {
      throw new AppError(400, 'transactions array is required and must not be empty');
    }

    if (!categories || !Array.isArray(categories)) {
      throw new AppError(400, 'categories array is required');
    }

    try {
      const budgetId = req.budget!.id;
      const userId = req.user!.id;

      const knownThirdParties = await withTenantContext(userId, budgetId, (tx) =>
        transactionsSvc.getThirdParties(tx, undefined, budgetId)
      );

      const userLanguage = req.user?.language || 'fr';
      const userCountry = req.user?.country || undefined;

      const classifications = await llmSvc.classifyTransactions(
        transactions,
        categories,
        knownThirdParties,
        paymentMethods || [],
        userLanguage,
        userCountry
      );
      res.json({ classifications });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Classification failed';
      throw new AppError(500, message, { code: 'LLM_CLASSIFICATION_FAILED' });
    }
  })
);

export default router;
