import { Router, type Router as RouterType } from 'express';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import * as budget from '../services/budget.js';

const router: RouterType = Router();

// GET /api/budget - Get budget data for current year
router.get(
  '/',
  asyncHandler(async (_req, res) => {
    const currentYear = new Date().getFullYear();
    const data = await budget.getBudgetDataForYear(currentYear);
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
    const data = await budget.getBudgetDataForYear(year);
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
  asyncHandler(async (_req, res) => {
    const currentYear = new Date().getFullYear();
    const summary = await budget.getBudgetSummary(currentYear);
    res.json(summary);
  })
);

// GET /api/budget/years - Get all years
router.get(
  '/years',
  asyncHandler(async (_req, res) => {
    const years = await budget.getAllYears();
    res.json(years);
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
    const newYear = await budget.createYear(year, initialBalance);
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
    const updated = await budget.updateYear(id, parsedBalance);
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
    const { yearId, name, slug, type = 'expense', sortOrder = 0 } = req.body;
    if (!yearId || !name || !slug) {
      throw new AppError(400, 'yearId, name, and slug are required');
    }
    const newGroup = await budget.createGroup({ yearId, name, slug, type, sortOrder });
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
    await budget.reorderGroups(groups);
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
    const updated = await budget.updateGroup(id, { name, slug, type, sortOrder });
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
    const deleted = await budget.deleteGroup(id);
    if (!deleted) {
      throw new AppError(404, 'Group not found');
    }
    res.status(204).send();
  })
);

// GET /api/budget/items/unassigned - Get unassigned items for current year
router.get(
  '/items/unassigned',
  asyncHandler(async (_req, res) => {
    const currentYear = new Date().getFullYear();
    const budgetYear = await budget.getOrCreateYear(currentYear);
    const items = await budget.getUnassignedItems(budgetYear.id, currentYear);
    res.json(items);
  })
);

// POST /api/budget/items - Create a new item (optionally unassigned)
router.post(
  '/items',
  asyncHandler(async (req, res) => {
    const { yearId, groupId, name, slug, sortOrder = 0 } = req.body;
    if (!yearId || !name || !slug) {
      throw new AppError(400, 'yearId, name, and slug are required');
    }
    const newItem = await budget.createItem({ yearId, groupId, name, slug, sortOrder });
    res.status(201).json(newItem);
  })
);

// PUT /api/budget/items/move - Move item to a group (or unassign)
router.put(
  '/items/move',
  asyncHandler(async (req, res) => {
    const { itemId, groupId } = req.body;
    if (!itemId) {
      throw new AppError(400, 'itemId is required');
    }
    const updated = await budget.moveItem(itemId, groupId);
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
    await budget.reorderItems(items);
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
    const updated = await budget.updateItem(id, { name, slug, sortOrder, yearlyBudget });
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
    const deleted = await budget.deleteItem(id);
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

    const result = await budget.updateMonthlyValue(itemId, month, { budget: budgetValue, actual });
    res.status(result.created ? 201 : 200).json({ budget: result.budget, actual: result.actual });
  })
);

export default router;
