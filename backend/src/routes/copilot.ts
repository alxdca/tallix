import { Router, type Router as RouterType } from 'express';
import { withTenantContext } from '../db/context.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import * as budgetSvc from '../services/budget.js';
import * as copilot from '../services/copilot.js';

const router: RouterType = Router();

function parseSelectedYear(value: unknown, fallbackYear: number): number {
  if (value === undefined || value === null || value === '') {
    return fallbackYear;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1900 || value > 9999) {
    throw new AppError(400, 'year must be an integer between 1900 and 9999');
  }
  return value;
}

// POST /api/copilot/ask - Ask a question about the budget
router.post(
  '/ask',
  asyncHandler(async (req, res) => {
    const { question, conversationHistory } = req.body;

    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      throw new AppError(400, 'Question is required');
    }

    if (question.length > 500) {
      throw new AppError(400, 'Question is too long (max 500 characters)');
    }

    // Validate conversation history if provided
    if (conversationHistory !== undefined) {
      if (!Array.isArray(conversationHistory)) {
        throw new AppError(400, 'conversationHistory must be an array');
      }

      if (conversationHistory.length > 10) {
        throw new AppError(400, 'conversationHistory is too long (max 10 messages)');
      }

      for (const msg of conversationHistory) {
        if (!msg.role || !msg.content) {
          throw new AppError(400, 'Each message must have role and content');
        }
        if (msg.role !== 'user' && msg.role !== 'assistant') {
          throw new AppError(400, 'Message role must be "user" or "assistant"');
        }
        if (typeof msg.content !== 'string') {
          throw new AppError(400, 'Message content must be a string');
        }
      }
    }

    if (!copilot.isLLMConfigured()) {
      throw new AppError(503, 'AI service is not available. Please try again later.');
    }

    const userId = req.user!.id;
    const budgetId = req.budget!.id;
    const language = req.user!.language || 'en';
    const country = req.user!.country || 'US';
    const currentYear = parseSelectedYear(req.body.year, req.budget!.startYear);
    const existingYear = await withTenantContext(userId, budgetId, (tx) =>
      budgetSvc.getBudgetYear(tx, currentYear, budgetId)
    );
    if (!existingYear) {
      throw new AppError(404, 'Budget year not found');
    }

    const context: copilot.CopilotContext = {
      userId,
      budgetId,
      language,
      country,
      currentYear,
      conversationHistory: conversationHistory as copilot.ConversationMessage[] | undefined,
    };

    const answer = await withTenantContext(userId, budgetId, (tx) => copilot.askCopilot(tx, question.trim(), context));

    res.json(answer);
  })
);

export default router;
