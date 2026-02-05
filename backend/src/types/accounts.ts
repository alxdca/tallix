/**
 * Account types - only payment methods can be accounts now
 */

// Account type is always payment_method (kept for API compatibility during transition)
export const ACCOUNT_TYPE = 'payment_method' as const;

export type AccountType = typeof ACCOUNT_TYPE;
