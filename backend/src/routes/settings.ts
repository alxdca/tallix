import { Router, type Router as RouterType } from 'express';
import * as settingsSvc from '../services/settings.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';

const router: RouterType = Router();

// GET /api/settings - Get all settings
router.get('/', asyncHandler(async (_req, res) => {
  const settings = await settingsSvc.getAllSettings();
  res.json(settings);
}));

// GET /api/settings/:key - Get a specific setting
router.get('/:key', asyncHandler(async (req, res) => {
  const setting = await settingsSvc.getSetting(req.params.key);
  if (!setting) {
    throw new AppError(404, 'Setting not found');
  }
  res.json(setting);
}));

// PUT /api/settings/:key - Update or create a setting
router.put('/:key', asyncHandler(async (req, res) => {
  const { value } = req.body;
  const key = req.params.key;
  const result = await settingsSvc.upsertSetting(key, value);
  res.status(result.created ? 201 : 200).json({ key: result.key, value: result.value });
}));

// DELETE /api/settings/:key - Delete a setting
router.delete('/:key', asyncHandler(async (req, res) => {
  await settingsSvc.deleteSetting(req.params.key);
  res.status(204).send();
}));

export default router;
