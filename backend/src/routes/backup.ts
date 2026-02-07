import { Router, type Router as RouterType } from 'express';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { withTenantContext } from '../db/context.js';
import * as backupSvc from '../services/backup.js';

const router: RouterType = Router();

// GET /api/backup/export
router.get(
  '/export',
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const budgetId = req.budget!.id;

    const result = await withTenantContext(userId, budgetId, (tx) =>
      backupSvc.exportBackup(tx, userId, budgetId)
    );

    res.json(result);
  })
);

// POST /api/backup/import
router.post(
  '/import',
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const budgetId = req.budget!.id;
    const payload = req.body;

    if (!payload || typeof payload !== 'object') {
      throw new AppError(400, 'Request body must be a valid JSON backup payload');
    }

    const result = await withTenantContext(userId, budgetId, (tx) =>
      backupSvc.importBackup(tx, userId, budgetId, payload)
    );

    res.status(201).json(result);
  })
);

export default router;
