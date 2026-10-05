import { Router, type Router as RouterType } from 'express';
import { withTenantContext } from '../db/context.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import * as budget from '../services/budget.js';

const router: RouterType = Router();

function parseYear(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1900 || value > 9999) {
    throw new AppError(400, 'year must be an integer between 1900 and 9999');
  }
  return value;
}

function parseYearParam(value: string): number {
  const year = parseInt(value, 10);
  if (Number.isNaN(year)) {
    throw new AppError(400, 'Invalid year');
  }
  return year;
}

async function requireExistingBudgetYear(userId: string, budgetId: number, year: number) {
  const existing = await withTenantContext(userId, budgetId, (tx) => budget.getBudgetYear(tx, year, budgetId));
  if (!existing) {
    throw new AppError(404, 'Budget year not found');
  }
  return existing;
}

// GET /api/budget - Get budget data for current year
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const selectedYear = req.budget!.startYear;
    const budgetId = req.budget!.id;
    const userId = req.user!.id;
    const ownerId = req.budget!.userId;
    const data = await withTenantContext(userId, budgetId, (tx) =>
      budget.getBudgetDataForYear(tx, selectedYear, budgetId, ownerId)
    );
    res.json(data);
  })
);

// GET /api/budget/year/:year - Get budget data for a specific year
router.get(
  '/year/:year',
  asyncHandler(async (req, res) => {
    const year = parseYearParam(req.params.year);
    const budgetId = req.budget!.id;
    const userId = req.user!.id;
    const ownerId = req.budget!.userId;
    await requireExistingBudgetYear(userId, budgetId, year);
    const data = await withTenantContext(userId, budgetId, (tx) =>
      budget.getBudgetDataForYear(tx, year, budgetId, ownerId)
    );
    res.json(data);
  })
);

// GET /api/budget/months - Get month names
router.get('/months', (_req, res) => {
  res.json(budget.MONTHS);
});

// GET /api/budget/summary - Get budget summary for current year
router.get(
  '/summary',
  asyncHandler(async (req, res) => {
    const requestedYear = req.query.year ? parseInt(String(req.query.year), 10) : req.budget!.startYear;
    if (Number.isNaN(requestedYear)) {
      throw new AppError(400, 'Invalid year');
    }
    const budgetId = req.budget!.id;
    const userId = req.user!.id;
    const ownerId = req.budget!.userId;
    await requireExistingBudgetYear(userId, budgetId, requestedYear);
    const summary = await withTenantContext(userId, budgetId, (tx) =>
      budget.getBudgetSummary(tx, requestedYear, budgetId, ownerId)
    );
    res.json(summary);
  })
);

// GET /api/budget/years - Get all available years
router.get(
  '/years',
  asyncHandler(async (req, res) => {
    const budgetId = req.budget!.id;
    const userId = req.user!.id;
    const allYears = await withTenantContext(userId, budgetId, (tx) => budget.getAllYears(tx, budgetId));
    // Return just the year numbers for the sidebar dropdown
    const years = allYears.map((y) => y.year);
    res.json({ years });
  })
);

// POST /api/budget/years - Create a new year
router.post(
  '/years',
  asyncHandler(async (req, res) => {
    const year = parseYear(req.body.year);
    const initialBalance =
      req.body.initialBalance === undefined || req.body.initialBalance === null
        ? 0
        : typeof req.body.initialBalance === 'number'
          ? req.body.initialBalance
          : Number(req.body.initialBalance);
    if (Number.isNaN(initialBalance)) {
      throw new AppError(400, 'initialBalance must be a valid number');
    }

    const budgetId = req.budget!.id;
    const userId = req.user!.id;
    const ownerId = req.budget!.userId;
    let created: Awaited<ReturnType<typeof budget.createYear>>;
    try {
      created = await withTenantContext(userId, budgetId, (tx) =>
        budget.createYear(tx, year, initialBalance, budgetId, ownerId)
      );
    } catch (error) {
      if (error instanceof budget.BudgetYearAlreadyExistsError) {
        throw new AppError(409, error.message, { code: 'BUDGET_YEAR_ALREADY_EXISTS', params: { year } });
      }
      throw error;
    }
    res.status(201).json({ id: created.id, year: created.year });
  })
);

// PUT /api/budget/years/:id - Update a year
router.put(
  '/years/:id',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      throw new AppError(400, 'Invalid year ID');
    }
    const { initialBalance } = req.body;
    if (initialBalance === undefined || initialBalance === null) {
      throw new AppError(400, 'initialBalance is required');
    }
    const parsedBalance = typeof initialBalance === 'number' ? initialBalance : parseFloat(initialBalance);
    if (Number.isNaN(parsedBalance)) {
      throw new AppError(400, 'initialBalance must be a valid number');
    }
    const budgetId = req.budget!.id;
    const userId = req.user!.id;
    const updated = await withTenantContext(userId, budgetId, (tx) =>
      budget.updateYear(tx, id, parsedBalance, budgetId)
    );
    if (!updated) {
      throw new AppError(404, 'Year not found');
    }
    res.json(updated);
  })
);

// POST /api/budget/groups - Create a new group
router.post(
  '/groups',
  asyncHandler(async (req, res) => {
    const budgetId = req.budget!.id;
    const userId = req.user!.id;
    const { name, slug, type = 'expense', sortOrder = 0 } = req.body;
    if (!name || !slug) {
      throw new AppError(400, 'name and slug are required');
    }
    const newGroup = await withTenantContext(userId, budgetId, (tx) =>
      budget.createGroup(tx, { budgetId, name, slug, type, sortOrder })
    );
    res.status(201).json(newGroup);
  })
);

// PUT /api/budget/groups/reorder - Reorder groups (MUST be before :id route)
router.put(
  '/groups/reorder',
  asyncHandler(async (req, res) => {
    const { groups } = req.body as { groups: { id: number; sortOrder: number }[] };
    if (!groups || !Array.isArray(groups)) {
      throw new AppError(400, 'groups array is required');
    }
    const budgetId = req.budget!.id;
    const userId = req.user!.id;
    await withTenantContext(userId, budgetId, (tx) => budget.reorderGroups(tx, groups, budgetId));
    res.json({ success: true });
  })
);

// PUT /api/budget/groups/:id - Update a group
router.put(
  '/groups/:id',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      throw new AppError(400, 'Invalid group ID');
    }
    const { name, slug, type, sortOrder } = req.body;
    const budgetId = req.budget!.id;
    const userId = req.user!.id;
    const updated = await withTenantContext(userId, budgetId, (tx) =>
      budget.updateGroup(tx, id, { name, slug, type, sortOrder }, budgetId)
    );
    if (!updated) {
      throw new AppError(404, 'Group not found');
    }
    res.json(updated);
  })
);

// DELETE /api/budget/groups/:id - Delete a group
router.delete(
  '/groups/:id',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      throw new AppError(400, 'Invalid group ID');
    }
    const budgetId = req.budget!.id;
    const userId = req.user!.id;
    const deleted = await withTenantContext(userId, budgetId, (tx) => budget.deleteGroup(tx, id, budgetId));
    if (!deleted) {
      throw new AppError(404, 'Group not found');
    }
    res.status(204).send();
  })
);

// POST /api/budget/items - Create a new item
router.post(
  '/items',
  asyncHandler(async (req, res) => {
    const { yearId, groupId, name, slug, sortOrder = 0 } = req.body;
    if (!yearId || !name || !slug) {
      throw new AppError(400, 'yearId, name, and slug are required');
    }
    const budgetId = req.budget!.id;
    const userId = req.user!.id;
    const newItem = await withTenantContext(userId, budgetId, (tx) =>
      budget.createItem(tx, { yearId, groupId, name, slug, sortOrder }, budgetId)
    );
    res.status(201).json(newItem);
  })
);

// PUT /api/budget/items/move - Move item to a different group
router.put(
  '/items/move',
  asyncHandler(async (req, res) => {
    const { itemId, groupId } = req.body;
    if (!itemId) {
      throw new AppError(400, 'itemId is required');
    }
    const budgetId = req.budget!.id;
    const userId = req.user!.id;
    const updated = await withTenantContext(userId, budgetId, (tx) => budget.moveItem(tx, itemId, groupId, budgetId));
    if (!updated) {
      throw new AppError(404, 'Item not found');
    }
    res.json(updated);
  })
);

// PUT /api/budget/items/reorder - Reorder items within a group
router.put(
  '/items/reorder',
  asyncHandler(async (req, res) => {
    const { items } = req.body as { items: { id: number; sortOrder: number }[] };
    if (!items || !Array.isArray(items)) {
      throw new AppError(400, 'items array is required');
    }
    const budgetId = req.budget!.id;
    const userId = req.user!.id;
    await withTenantContext(userId, budgetId, (tx) => budget.reorderItems(tx, items, budgetId));
    res.json({ success: true });
  })
);

// PUT /api/budget/items/:id - Update an item
router.put(
  '/items/:id',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      throw new AppError(400, 'Invalid item ID');
    }
    const { name, slug, sortOrder, yearlyBudget } = req.body;
    const budgetId = req.budget!.id;
    const userId = req.user!.id;
    const updated = await withTenantContext(userId, budgetId, (tx) =>
      budget.updateItem(tx, id, { name, slug, sortOrder, yearlyBudget }, budgetId)
    );
    if (!updated) {
      throw new AppError(404, 'Item not found');
    }
    res.json(updated);
  })
);

// DELETE /api/budget/items/:id - Delete an item
router.delete(
  '/items/:id',
  asyncHandler(async (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      throw new AppError(400, 'Invalid item ID');
    }
    const budgetId = req.budget!.id;
    const userId = req.user!.id;
    const deleted = await withTenantContext(userId, budgetId, (tx) => budget.deleteItem(tx, id, budgetId));
    if (!deleted) {
      throw new AppError(404, 'Item not found');
    }
    res.status(204).send();
  })
);

// PUT /api/budget/items/:itemId/months/:month - Update monthly values
router.put(
  '/items/:itemId/months/:month',
  asyncHandler(async (req, res) => {
    const itemId = parseInt(req.params.itemId, 10);
    const month = parseInt(req.params.month, 10);
    const { budget: budgetValue, actual } = req.body;

    if (Number.isNaN(itemId) || Number.isNaN(month)) {
      throw new AppError(400, 'Invalid itemId or month');
    }
    if (month < 1 || month > 12) {
      throw new AppError(400, 'Month must be between 1 and 12');
    }

    const budgetId = req.budget!.id;
    const userId = req.user!.id;
    const result = await withTenantContext(userId, budgetId, (tx) =>
      budget.updateMonthlyValue(tx, itemId, month, { budget: budgetValue, actual }, budgetId)
    );
    res.status(result.created ? 201 : 200).json({ budget: result.budget, actual: result.actual });
  })
);

// GET /api/budget/start-year - Get budget start year
router.get(
  '/start-year',
  asyncHandler(async (req, res) => {
    const budgetId = req.budget!.id;
    const userId = req.user!.id;
    const startYear = await withTenantContext(userId, budgetId, (tx) => budget.getStartYear(tx, budgetId));
    res.json({ startYear });
  })
);

// PUT /api/budget/start-year - Update budget start year
router.put(
  '/start-year',
  asyncHandler(async () => {
    throw new AppError(410, 'Create a new budget instead of changing the current budget year');
  })
);

export default router;
