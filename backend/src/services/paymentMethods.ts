import { and, asc, eq } from 'drizzle-orm';
import { paymentMethods } from '../db/schema.js';
import type { DbClient } from '../db/index.js';

// Custom error for duplicate payment methods
export class DuplicatePaymentMethodError extends Error {
  public readonly displayName: string;

  constructor(name: string, institution: string | null) {
    const displayName = institution ? `${name} (${institution})` : name;
    super(`Payment method already exists: "${displayName}"`);
    this.name = 'DuplicatePaymentMethodError';
    this.displayName = displayName;
  }
}

// Savings types
export type SavingsType = 'epargne' | 'prevoyance' | 'investissements';

// Type for payment method from database
interface PaymentMethodRecord {
  id: number;
  name: string;
  institution: string | null;
  sortOrder: number;
  isSavingsAccount: boolean;
  savingsType: string | null;
  settlementDay: number | null;
  linkedPaymentMethodId: number | null;
}

// Format payment method for response
function formatPaymentMethod(m: PaymentMethodRecord) {
  return {
    id: m.id,
    name: m.name,
    institution: m.institution,
    sortOrder: m.sortOrder,
    isSavingsAccount: m.isSavingsAccount,
    savingsType: m.savingsType as SavingsType | null,
    settlementDay: m.settlementDay,
    linkedPaymentMethodId: m.linkedPaymentMethodId,
  };
}

// Get all payment methods for a user
export async function getAllPaymentMethods(tx: DbClient, userId: string) {
  const methods = await tx.query.paymentMethods.findMany({
    where: eq(paymentMethods.userId, userId),
    orderBy: [asc(paymentMethods.sortOrder), asc(paymentMethods.id)],
  });
  return methods.map(formatPaymentMethod);
}

// Check if a payment method with the same name+institution already exists for a user
async function checkDuplicate(
  tx: DbClient,
  userId: string,
  name: string,
  institution: string | null,
  excludeId?: number
): Promise<boolean> {
  const existing = await tx.query.paymentMethods.findMany({
    where: eq(paymentMethods.userId, userId),
  });

  const normalizedInstitution = institution?.trim() || null;

  return existing.some((m) => {
    if (excludeId && m.id === excludeId) return false;
    const existingInstitution = m.institution?.trim() || null;
    return m.name.toLowerCase() === name.toLowerCase() && existingInstitution === normalizedInstitution;
  });
}

// Create a new payment method
export async function createPaymentMethod(
  tx: DbClient,
  name: string,
  sortOrder: number,
  userId: string,
  institution?: string | null
) {
  const normalizedInstitution = institution?.trim() || null;

  // Check for duplicates
  const isDuplicate = await checkDuplicate(tx, userId, name, normalizedInstitution);
  if (isDuplicate) {
    throw new DuplicatePaymentMethodError(name, normalizedInstitution);
  }

  const [newMethod] = await tx
    .insert(paymentMethods)
    .values({
      name,
      sortOrder,
      userId,
      institution: normalizedInstitution,
    })
    .returning();

  return formatPaymentMethod(newMethod);
}

// Update a payment method
export async function updatePaymentMethod(
  tx: DbClient,
  id: number,
  userId: string,
  data: {
    name?: string;
    institution?: string | null;
    sortOrder?: number;
    isSavingsAccount?: boolean;
    savingsType?: SavingsType | null;
    settlementDay?: number | null;
    linkedPaymentMethodId?: number | null;
  }
) {
  // Verify ownership and get current values
  const current = await tx.query.paymentMethods.findFirst({
    where: and(eq(paymentMethods.id, id), eq(paymentMethods.userId, userId)),
  });

  // If payment method doesn't exist or doesn't belong to user, return null
  if (!current) {
    return null;
  }

  // If name or institution is being updated, check for duplicates
  if (data.name !== undefined || data.institution !== undefined) {
    const newName = data.name !== undefined ? data.name : current.name;
    const newInstitution = data.institution !== undefined ? data.institution?.trim() || null : current.institution;

    const isDuplicate = await checkDuplicate(tx, userId, newName, newInstitution, id);
    if (isDuplicate) {
      throw new DuplicatePaymentMethodError(newName, newInstitution);
    }
  }

  const updateData: Partial<{
    name: string;
    institution: string | null;
    sortOrder: number;
    isSavingsAccount: boolean;
    savingsType: string | null;
    settlementDay: number | null;
    linkedPaymentMethodId: number | null;
    updatedAt: Date;
  }> = { updatedAt: new Date() };

  if (data.name !== undefined) updateData.name = data.name;
  if (data.institution !== undefined) updateData.institution = data.institution?.trim() || null;
  if (data.sortOrder !== undefined) updateData.sortOrder = data.sortOrder;
  if (data.isSavingsAccount !== undefined) updateData.isSavingsAccount = data.isSavingsAccount;
  if (data.savingsType !== undefined) updateData.savingsType = data.savingsType;
  if (data.settlementDay !== undefined) updateData.settlementDay = data.settlementDay;
  if (data.linkedPaymentMethodId !== undefined) updateData.linkedPaymentMethodId = data.linkedPaymentMethodId;

  // Update with ownership check in WHERE clause
  const [updated] = await tx
    .update(paymentMethods)
    .set(updateData)
    .where(and(eq(paymentMethods.id, id), eq(paymentMethods.userId, userId)))
    .returning();

  // Should not happen since we verified ownership above, but be defensive
  if (!updated) return null;

  // If this is a savings account and name/institution changed, update budget item names
  if (updated.isSavingsAccount && (data.name !== undefined || data.institution !== undefined)) {
    const budgetSvc = await import('./budget.js');
    await budgetSvc.updateSavingsBudgetItemsName(tx, id, updated.name, updated.institution);
  }

  return formatPaymentMethod(updated);
}

// Get payment method by name for a user (for looking up settlement day)
export async function getPaymentMethodByName(tx: DbClient, userId: string, name: string) {
  const method = await tx.query.paymentMethods.findFirst({
    where: and(eq(paymentMethods.userId, userId), eq(paymentMethods.name, name)),
  });
  return method ? formatPaymentMethod(method) : null;
}

// Reorder payment methods
export async function reorderPaymentMethods(
  tx: DbClient,
  userId: string,
  methods: { id: number; sortOrder: number }[]
) {
  // Verify all payment methods belong to the user before updating
  const methodIds = methods.map((m) => m.id);
  const userMethods = await tx.query.paymentMethods.findMany({
    where: eq(paymentMethods.userId, userId),
  });
  
  const userMethodIds = new Set(userMethods.map((m) => m.id));
  const unauthorizedIds = methodIds.filter((id) => !userMethodIds.has(id));
  
  if (unauthorizedIds.length > 0) {
    throw new Error(`Cannot reorder payment methods: IDs ${unauthorizedIds.join(', ')} do not belong to user`);
  }

  // All methods verified, proceed with updates
  await Promise.all(
    methods.map(({ id, sortOrder }) =>
      tx
        .update(paymentMethods)
        .set({ sortOrder, updatedAt: new Date() })
        .where(and(eq(paymentMethods.id, id), eq(paymentMethods.userId, userId)))
    )
  );
}

// Delete a payment method
export async function deletePaymentMethod(tx: DbClient, id: number, userId: string): Promise<boolean> {
  // Delete with ownership check in WHERE clause
  const result = await tx
    .delete(paymentMethods)
    .where(and(eq(paymentMethods.id, id), eq(paymentMethods.userId, userId)))
    .returning({ id: paymentMethods.id });

  return result.length > 0;
}
