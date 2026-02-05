import { Router, type Router as RouterType } from 'express';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { withTenantContext } from '../db/context.js';
import * as budget from '../services/budget.js';

const router: RouterType = Router();

// GET /api/budget - Get budget data for current year
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const currentYear = new Date().getFullYear();
    const budgetId = req.budget!.id;
    const userId = req.user!.id;
    const data = await withTenantContext(userId, budgetId, (tx) =>
      budget.getBudgetDataForYear(tx, currentYear, budgetId, userId)
    );
    res.json(data);
  })
);

// GET /api/budget/year/:year - Get budget data for a specific year
router.get(
  '/year/:year',
  asyncHandler(async (req, res) => {
    const year = parseInt(req.params.year, 10);
    if (Number.isNaN(year)) {
      throw new AppError(400, 'Invalid year');
    }
    const budgetId = req.budget!.id;
    const userId = req.user!.id;
    const data = await withTenantContext(userId, budgetId, (tx) =>
      budget.getBudgetDataForYear(tx, year, budgetId, userId)
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
    const currentYear = new Date().getFullYear();
    const budgetId = req.budget!.id;
    const userId = req.user!.id;
    const summary = await withTenantContext(userId, budgetId, (tx) =>
      budget.getBudgetSummary(tx, currentYear, budgetId, userId)
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
    const allYears = await withTenantContext(userId, budgetId, (tx) =>
      budget.getAllYears(tx, budgetId)
    );
    // Return just the year numbers for the sidebar dropdown
    const years = allYears.map(y => y.year);
    res.json({ years });
  })
);

// POST /api/budget/years - Create a new year
router.post(
  '/years',
  asyncHandler(async (req, res) => {
    const { year, initialBalance = 0 } = req.body;
    if (!year) {
      throw new AppError(400, 'Year is required');
    }
    const budgetId = req.budget!.id;
    const userId = req.user!.id;
    const newYear = await withTenantContext(userId, budgetId, (tx) =>
      budget.createYear(tx, year, initialBalance, budgetId, userId)
    );
    res.status(201).json(newYear);
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
    await withTenantContext(userId, budgetId, (tx) =>
      budget.reorderGroups(tx, groups, budgetId)
    );
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
    const deleted = await withTenantContext(userId, budgetId, (tx) =>
      budget.deleteGroup(tx, id, budgetId)
    );
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
    const updated = await withTenantContext(userId, budgetId, (tx) =>
      budget.moveItem(tx, itemId, groupId, budgetId)
    );
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
    await withTenantContext(userId, budgetId, (tx) =>
      budget.reorderItems(tx, items, budgetId)
    );
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
    const deleted = await withTenantContext(userId, budgetId, (tx) =>
      budget.deleteItem(tx, id, budgetId)
    );
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
    const startYear = await withTenantContext(userId, budgetId, (tx) =>
      budget.getStartYear(tx, budgetId)
    );
    res.json({ startYear });
  })
);

// PUT /api/budget/start-year - Update budget start year
router.put(
  '/start-year',
  asyncHandler(async (req, res) => {
    const { startYear } = req.body;

    if (!startYear || typeof startYear !== 'number' || !Number.isInteger(startYear)) {
      throw new AppError(400, 'startYear must be an integer');
    }

    const budgetId = req.budget!.id;
    const userId = req.user!.id;

    try {
      const result = await withTenantContext(userId, budgetId, (tx) =>
        budget.updateStartYear(tx, budgetId, userId, startYear)
      );
      res.json(result);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('older years exist')) {
        throw new AppError(409, err.message);
      }
      throw err;
    }
  })
);

export default router;
