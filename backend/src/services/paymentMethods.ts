import { eq, asc } from 'drizzle-orm';
import { db, paymentMethods } from '../db/index.js';

// Type for payment method from database
interface PaymentMethodRecord {
  id: number;
  name: string;
  sortOrder: number;
  isAccount: boolean;
  settlementDay: number | null;
  linkedPaymentMethodId: number | null;
}

// Format payment method for response
function formatPaymentMethod(m: PaymentMethodRecord) {
  return {
    id: m.id,
    name: m.name,
    sortOrder: m.sortOrder,
    isAccount: m.isAccount,
    settlementDay: m.settlementDay,
    linkedPaymentMethodId: m.linkedPaymentMethodId,
  };
}

// Get all payment methods
export async function getAllPaymentMethods() {
  const methods = await db.query.paymentMethods.findMany({
    orderBy: [asc(paymentMethods.sortOrder), asc(paymentMethods.id)],
  });
  return methods.map(formatPaymentMethod);
}

// Create a new payment method
export async function createPaymentMethod(name: string, sortOrder: number = 0) {
  const [newMethod] = await db.insert(paymentMethods).values({
    name,
    sortOrder,
  }).returning();

  return formatPaymentMethod(newMethod);
}

// Update a payment method
export async function updatePaymentMethod(id: number, data: {
  name?: string;
  sortOrder?: number;
  isAccount?: boolean;
  settlementDay?: number | null;
  linkedPaymentMethodId?: number | null;
}) {
  const updateData: Partial<{
    name: string;
    sortOrder: number;
    isAccount: boolean;
    settlementDay: number | null;
    linkedPaymentMethodId: number | null;
    updatedAt: Date;
  }> = { updatedAt: new Date() };
  
  if (data.name !== undefined) updateData.name = data.name;
  if (data.sortOrder !== undefined) updateData.sortOrder = data.sortOrder;
  if (data.isAccount !== undefined) updateData.isAccount = data.isAccount;
  if (data.settlementDay !== undefined) updateData.settlementDay = data.settlementDay;
  if (data.linkedPaymentMethodId !== undefined) updateData.linkedPaymentMethodId = data.linkedPaymentMethodId;

  const [updated] = await db.update(paymentMethods)
    .set(updateData)
    .where(eq(paymentMethods.id, id))
    .returning();

  if (!updated) return null;

  return formatPaymentMethod(updated);
}

// Get payment method by name (for looking up settlement day)
export async function getPaymentMethodByName(name: string) {
  const method = await db.query.paymentMethods.findFirst({
    where: eq(paymentMethods.name, name),
  });
  return method ? formatPaymentMethod(method) : null;
}

// Reorder payment methods
export async function reorderPaymentMethods(methods: { id: number; sortOrder: number }[]) {
  await Promise.all(
    methods.map(({ id, sortOrder }) =>
      db.update(paymentMethods)
        .set({ sortOrder, updatedAt: new Date() })
        .where(eq(paymentMethods.id, id))
    )
  );
}

// Delete a payment method
// Returns true if payment method was deleted, false if it didn't exist
export async function deletePaymentMethod(id: number): Promise<boolean> {
  const result = await db.delete(paymentMethods)
    .where(eq(paymentMethods.id, id))
    .returning({ id: paymentMethods.id });
  
  return result.length > 0;
}
