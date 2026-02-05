import { type Router as RouterType, Router } from 'express';
import { withTenantContext } from '../db/context.js';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import * as assetsSvc from '../services/assets.js';

const router: RouterType = Router();

// GET /api/assets - Get all assets with yearly values
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const budgetId = req.budget!.id;
    const userId = req.user!.id;

    const result = await withTenantContext(userId, budgetId, (tx) => assetsSvc.getAssets(tx, budgetId, userId));

    res.json(result);
  })
);

// POST /api/assets - Create new custom asset
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const { name, isDebt } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw new AppError(400, 'Asset name is required');
    }

    if (isDebt !== undefined && typeof isDebt !== 'boolean') {
      throw new AppError(400, 'isDebt must be a boolean');
    }

    const budgetId = req.budget!.id;
    const userId = req.user!.id;

    const asset = await withTenantContext(userId, budgetId, (tx) =>
      assetsSvc.createAsset(tx, budgetId, name.trim(), isDebt ?? false)
    );

    res.status(201).json(asset);
  })
);

// PUT /api/assets/:id/value - Update asset value for a year
router.put(
  '/:id/value',
  asyncHandler(async (req, res) => {
    const assetId = parseInt(req.params.id, 10);
    if (Number.isNaN(assetId)) {
      throw new AppError(400, 'Invalid asset ID');
    }

    const { year, value } = req.body;

    if (!year || typeof year !== 'number') {
      throw new AppError(400, 'Year is required and must be a number');
    }

    if (value === undefined || typeof value !== 'number') {
      throw new AppError(400, 'Value is required and must be a number');
    }

    const budgetId = req.budget!.id;
    const userId = req.user!.id;

    await withTenantContext(userId, budgetId, (tx) => assetsSvc.updateAssetValue(tx, assetId, year, value, budgetId));

    res.json({ success: true });
  })
);

// DELETE /api/assets/:id - Delete custom asset
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const assetId = parseInt(req.params.id, 10);
    if (Number.isNaN(assetId)) {
      throw new AppError(400, 'Invalid asset ID');
    }

    const budgetId = req.budget!.id;
    const userId = req.user!.id;

    await withTenantContext(userId, budgetId, (tx) => assetsSvc.deleteAsset(tx, assetId, budgetId));

    res.json({ success: true });
  })
);

// PUT /api/assets/reorder - Reorder assets
router.put(
  '/reorder',
  asyncHandler(async (req, res) => {
    const { assetIds } = req.body;

    if (!Array.isArray(assetIds) || assetIds.length === 0) {
      throw new AppError(400, 'assetIds must be a non-empty array');
    }

    if (!assetIds.every((id) => typeof id === 'number')) {
      throw new AppError(400, 'All assetIds must be numbers');
    }

    const budgetId = req.budget!.id;
    const userId = req.user!.id;

    await withTenantContext(userId, budgetId, (tx) => assetsSvc.reorderAssets(tx, budgetId, assetIds));

    res.json({ success: true });
  })
);

export default router;
