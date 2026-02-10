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
    const { name, isDebt, parentAssetId } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw new AppError(400, 'Asset name is required');
    }

    if (isDebt !== undefined && typeof isDebt !== 'boolean') {
      throw new AppError(400, 'isDebt must be a boolean');
    }

    if (parentAssetId !== undefined && parentAssetId !== null && (typeof parentAssetId !== 'number' || !Number.isInteger(parentAssetId))) {
      throw new AppError(400, 'parentAssetId must be an integer or null');
    }

    const budgetId = req.budget!.id;
    const userId = req.user!.id;

    const asset = await withTenantContext(userId, budgetId, (tx) =>
      assetsSvc.createAsset(tx, budgetId, name.trim(), isDebt ?? false, parentAssetId ?? null)
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

// PUT /api/assets/:id/name - Rename asset
router.put(
  '/:id/name',
  asyncHandler(async (req, res) => {
    const assetId = parseInt(req.params.id, 10);
    if (Number.isNaN(assetId)) {
      throw new AppError(400, 'Invalid asset ID');
    }

    const { name } = req.body;
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw new AppError(400, 'Name is required');
    }

    const budgetId = req.budget!.id;
    const userId = req.user!.id;

    await withTenantContext(userId, budgetId, (tx) => assetsSvc.renameAsset(tx, assetId, budgetId, name.trim()));

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
    const { assets: assetOrders } = req.body as { assets: { id: number; sortOrder: number }[] };

    if (!Array.isArray(assetOrders) || assetOrders.length === 0) {
      throw new AppError(400, 'assets must be a non-empty array');
    }

    for (const item of assetOrders) {
      if (typeof item.id !== 'number' || typeof item.sortOrder !== 'number') {
        throw new AppError(400, 'Each item must have numeric id and sortOrder');
      }
    }

    const budgetId = req.budget!.id;
    const userId = req.user!.id;

    await withTenantContext(userId, budgetId, (tx) => assetsSvc.reorderAssets(tx, budgetId, assetOrders));

    res.json({ success: true });
  })
);

export default router;
