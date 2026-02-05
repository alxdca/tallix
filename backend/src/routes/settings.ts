import { Router, type Router as RouterType } from 'express';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { withUserContext } from '../db/context.js';
import * as settingsSvc from '../services/settings.js';

const router: RouterType = Router();

// GET /api/settings - Get all settings for the current user
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const settings = await withUserContext(userId, (tx) =>
      settingsSvc.getAllSettings(tx, userId)
    );
    res.json(settings);
  })
);

// GET /api/settings/:key - Get a specific setting for the current user
router.get(
  '/:key',
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const setting = await withUserContext(userId, (tx) =>
      settingsSvc.getSetting(tx, userId, req.params.key)
    );
    if (!setting) {
      throw new AppError(404, 'Setting not found');
    }
    res.json(setting);
  })
);

// PUT /api/settings/:key - Update or create a setting for the current user
router.put(
  '/:key',
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const { value } = req.body;
    const key = req.params.key;
    const result = await withUserContext(userId, (tx) =>
      settingsSvc.upsertSetting(tx, userId, key, value)
    );
    res.status(result.created ? 201 : 200).json({ key: result.key, value: result.value });
  })
);

// DELETE /api/settings/:key - Delete a setting for the current user
router.delete(
  '/:key',
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    await withUserContext(userId, (tx) =>
      settingsSvc.deleteSetting(tx, userId, req.params.key)
    );
    res.status(204).send();
  })
);

export default router;
