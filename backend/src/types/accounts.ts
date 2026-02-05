/**
 * Shared account types used across the application
 */

// Account types for transfers and account balances
export const ACCOUNT_TYPES = {
  SAVINGS_ITEM: 'savings_item',
  PAYMENT_METHOD: 'payment_method',
} as const;

export type AccountType = typeof ACCOUNT_TYPES[keyof typeof ACCOUNT_TYPES];

// Type guard for AccountType validation
export function isValidAccountType(value: unknown): value is AccountType {
  return value === ACCOUNT_TYPES.SAVINGS_ITEM || value === ACCOUNT_TYPES.PAYMENT_METHOD;
}
