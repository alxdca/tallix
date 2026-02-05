import { Router, type Router as RouterType } from 'express';
import { AppError, asyncHandler } from '../middleware/errorHandler.js';
import { withUserContext } from '../db/context.js';
import * as paymentMethods from '../services/paymentMethods.js';
import { DuplicatePaymentMethodError } from '../services/paymentMethods.js';

const router: RouterType = Router();

// GET /api/payment-methods - Get all payment methods for the current user
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const methods = await withUserContext(userId, (tx) =>
      paymentMethods.getAllPaymentMethods(tx, userId)
    );
    res.json(methods);
  })
);

// POST /api/payment-methods - Create a new payment method
router.post(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const { name, sortOrder = 0, institution } = req.body;
    if (!name) {
      throw new AppError(400, 'name is required');
    }
    try {
      const newMethod = await withUserContext(userId, (tx) =>
        paymentMethods.createPaymentMethod(tx, name, sortOrder, userId, institution)
      );
      res.status(201).json(newMethod);
    } catch (error) {
      if (error instanceof DuplicatePaymentMethodError) {
        throw new AppError(409, error.message, {
          code: 'PAYMENT_METHOD_DUPLICATE',
          params: { displayName: error.displayName },
        });
      }
      throw error;
    }
  })
);

// PUT /api/payment-methods/reorder - Reorder payment methods
router.put(
  '/reorder',
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const { methods } = req.body as { methods: { id: number; sortOrder: number }[] };
    if (!methods || !Array.isArray(methods)) {
      throw new AppError(400, 'methods array is required');
    }
    await withUserContext(userId, (tx) =>
      paymentMethods.reorderPaymentMethods(tx, userId, methods)
    );
    res.json({ success: true });
  })
);

// PUT /api/payment-methods/:id - Update a payment method
router.put(
  '/:id',
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      throw new AppError(400, 'Invalid payment method ID');
    }

    const {
      name, institution, sortOrder, isSavingsAccount,
      savingsType, settlementDay, linkedPaymentMethodId,
    } = req.body;

    try {
      const updated = await withUserContext(userId, (tx) =>
        paymentMethods.updatePaymentMethod(tx, id, userId, {
          name, institution, sortOrder, isSavingsAccount,
          savingsType: savingsType !== undefined ? savingsType : undefined,
          settlementDay: settlementDay !== undefined ? settlementDay : undefined,
          linkedPaymentMethodId: linkedPaymentMethodId !== undefined ? linkedPaymentMethodId : undefined,
        })
      );

      if (!updated) {
        throw new AppError(404, 'Payment method not found');
      }
      res.json(updated);
    } catch (error) {
      if (error instanceof DuplicatePaymentMethodError) {
        throw new AppError(409, error.message, {
          code: 'PAYMENT_METHOD_DUPLICATE',
          params: { displayName: error.displayName },
        });
      }
      throw error;
    }
  })
);

// DELETE /api/payment-methods/:id - Delete a payment method
router.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
      throw new AppError(400, 'Invalid payment method ID');
    }
    const deleted = await withUserContext(userId, (tx) =>
      paymentMethods.deletePaymentMethod(tx, id, userId)
    );
    if (!deleted) {
      throw new AppError(404, 'Payment method not found');
    }
    res.status(204).send();
  })
);

export default router;
