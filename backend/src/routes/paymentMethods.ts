import { Router, type Router as RouterType } from 'express';
import * as paymentMethods from '../services/paymentMethods.js';
import { asyncHandler, AppError } from '../middleware/errorHandler.js';

const router: RouterType = Router();

// GET /api/payment-methods - Get all payment methods
router.get('/', asyncHandler(async (_req, res) => {
  const methods = await paymentMethods.getAllPaymentMethods();
  res.json(methods);
}));

// POST /api/payment-methods - Create a new payment method
router.post('/', asyncHandler(async (req, res) => {
  const { name, sortOrder = 0 } = req.body;
  if (!name) {
    throw new AppError(400, 'name is required');
  }
  const newMethod = await paymentMethods.createPaymentMethod(name, sortOrder);
  res.status(201).json(newMethod);
}));

// PUT /api/payment-methods/reorder - Reorder payment methods
router.put('/reorder', asyncHandler(async (req, res) => {
  const { methods } = req.body as { methods: { id: number; sortOrder: number }[] };
  if (!methods || !Array.isArray(methods)) {
    throw new AppError(400, 'methods array is required');
  }
  await paymentMethods.reorderPaymentMethods(methods);
  res.json({ success: true });
}));

// PUT /api/payment-methods/:id - Update a payment method
router.put('/:id', asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    throw new AppError(400, 'Invalid payment method ID');
  }

  const { name, sortOrder, isAccount, settlementDay, linkedPaymentMethodId } = req.body;

  const updated = await paymentMethods.updatePaymentMethod(id, { 
    name, 
    sortOrder, 
    isAccount,
    settlementDay: settlementDay !== undefined ? settlementDay : undefined,
    linkedPaymentMethodId: linkedPaymentMethodId !== undefined ? linkedPaymentMethodId : undefined,
  });
  
  if (!updated) {
    throw new AppError(404, 'Payment method not found');
  }
  res.json(updated);
}));

// DELETE /api/payment-methods/:id - Delete a payment method
router.delete('/:id', asyncHandler(async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    throw new AppError(400, 'Invalid payment method ID');
  }
  const deleted = await paymentMethods.deletePaymentMethod(id);
  if (!deleted) {
    throw new AppError(404, 'Payment method not found');
  }
  res.status(204).send();
}));

export default router;
