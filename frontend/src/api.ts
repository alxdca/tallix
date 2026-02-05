import type { BudgetData, BudgetGroup, BudgetItem, BudgetSummary } from './types';

const API_BASE = '/api';
const TOKEN_KEY = 'tallix_token';

// Helper to get auth headers
function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem(TOKEN_KEY);
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

// Authenticated fetch wrapper
async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = {
    ...getAuthHeaders(),
    ...options.headers,
  };
  return fetch(url, { ...options, headers });
}

// Budget Data
export async function fetchBudgetData(): Promise<BudgetData> {
  const response = await authFetch(`${API_BASE}/budget`);
  if (!response.ok) {
    throw new Error('Failed to fetch budget data');
  }
  return response.json();
}

export async function fetchBudgetSummary(): Promise<BudgetSummary> {
  const response = await authFetch(`${API_BASE}/budget/summary`);
  if (!response.ok) {
    throw new Error('Failed to fetch budget summary');
  }
  return response.json();
}

export async function fetchMonths(): Promise<string[]> {
  const response = await authFetch(`${API_BASE}/budget/months`);
  if (!response.ok) {
    throw new Error('Failed to fetch months');
  }
  return response.json();
}

// Years
export interface BudgetYear {
  id: number;
  year: number;
  initialBalance: number;
}

export async function fetchYears(): Promise<BudgetYear[]> {
  const response = await authFetch(`${API_BASE}/budget/years`);
  if (!response.ok) {
    throw new Error('Failed to fetch years');
  }
  return response.json();
}

export async function createYear(year: number, initialBalance: number = 0): Promise<BudgetYear> {
  const response = await authFetch(`${API_BASE}/budget/years`, {
    method: 'POST',
    body: JSON.stringify({ year, initialBalance }),
  });
  if (!response.ok) {
    throw new Error('Failed to create year');
  }
  return response.json();
}

export async function updateYear(id: number, initialBalance: number): Promise<BudgetYear> {
  const response = await authFetch(`${API_BASE}/budget/years/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ initialBalance }),
  });
  if (!response.ok) {
    throw new Error('Failed to update year');
  }
  return response.json();
}

// Groups
export async function createGroup(data: {
  yearId: number;
  name: string;
  slug: string;
  type: 'income' | 'expense' | 'savings';
  sortOrder?: number;
}): Promise<BudgetGroup> {
  const response = await authFetch(`${API_BASE}/budget/groups`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error('Failed to create group');
  }
  return response.json();
}

export async function updateGroup(
  id: number,
  data: {
    name?: string;
    slug?: string;
    type?: 'income' | 'expense' | 'savings';
    sortOrder?: number;
  }
): Promise<BudgetGroup> {
  const response = await authFetch(`${API_BASE}/budget/groups/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error('Failed to update group');
  }
  return response.json();
}

export async function deleteGroup(id: number): Promise<void> {
  const response = await authFetch(`${API_BASE}/budget/groups/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error('Failed to delete group');
  }
}

export async function reorderGroups(groupOrders: { id: number; sortOrder: number }[]): Promise<void> {
  const response = await authFetch(`${API_BASE}/budget/groups/reorder`, {
    method: 'PUT',
    body: JSON.stringify({ groups: groupOrders }),
  });
  if (!response.ok) {
    throw new Error('Failed to reorder groups');
  }
}

export async function reorderItems(itemOrders: { id: number; sortOrder: number }[]): Promise<void> {
  const response = await authFetch(`${API_BASE}/budget/items/reorder`, {
    method: 'PUT',
    body: JSON.stringify({ items: itemOrders }),
  });
  if (!response.ok) {
    throw new Error('Failed to reorder items');
  }
}

// Items
export async function createItem(data: {
  yearId: number;
  groupId?: number | null;
  name: string;
  slug: string;
  sortOrder?: number;
}): Promise<BudgetItem> {
  const response = await authFetch(`${API_BASE}/budget/items`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error('Failed to create item');
  }
  return response.json();
}

export async function moveItem(itemId: number, groupId: number | null): Promise<void> {
  const response = await authFetch(`${API_BASE}/budget/items/move`, {
    method: 'PUT',
    body: JSON.stringify({ itemId, groupId }),
  });
  if (!response.ok) {
    throw new Error('Failed to move item');
  }
}

export async function updateItem(
  id: number,
  data: {
    name?: string;
    slug?: string;
    sortOrder?: number;
    yearlyBudget?: number;
  }
): Promise<BudgetItem> {
  const response = await authFetch(`${API_BASE}/budget/items/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error('Failed to update item');
  }
  return response.json();
}

export async function deleteItem(id: number): Promise<void> {
  const response = await authFetch(`${API_BASE}/budget/items/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error('Failed to delete item');
  }
}

// Third Parties (autocomplete)
export async function fetchThirdParties(search?: string): Promise<string[]> {
  const url = search
    ? `${API_BASE}/transactions/third-parties?search=${encodeURIComponent(search)}`
    : `${API_BASE}/transactions/third-parties`;
  const response = await authFetch(url);
  if (!response.ok) {
    throw new Error('Failed to fetch third parties');
  }
  return response.json();
}

// Transactions
export interface Transaction {
  id: number;
  date: string;
  description: string | null;
  comment: string | null;
  thirdParty: string | null;
  paymentMethod: string | null;
  amount: number;
  itemId: number | null;
  itemName: string | null;
  groupName: string | null;
  groupType: 'income' | 'expense' | 'savings';
  accountingMonth: number;
  accountingYear: number;
}

export async function fetchTransactions(): Promise<Transaction[]> {
  const response = await authFetch(`${API_BASE}/transactions`);
  if (!response.ok) {
    throw new Error('Failed to fetch transactions');
  }
  return response.json();
}

export async function createTransaction(data: {
  yearId: number;
  itemId?: number | null;
  date: string;
  description?: string;
  comment?: string;
  thirdParty?: string;
  paymentMethod?: string;
  amount: number;
  accountingMonth?: number;
  accountingYear?: number;
}): Promise<Transaction> {
  const response = await authFetch(`${API_BASE}/transactions`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error('Failed to create transaction');
  }
  return response.json();
}

export async function updateTransaction(
  id: number,
  data: {
    itemId?: number | null;
    date?: string;
    description?: string;
    comment?: string;
    thirdParty?: string;
    paymentMethod?: string;
    amount?: number;
    accountingMonth?: number;
    accountingYear?: number;
    recalculateAccounting?: boolean;
  }
): Promise<Transaction> {
  const response = await authFetch(`${API_BASE}/transactions/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error('Failed to update transaction');
  }
  return response.json();
}

export async function deleteTransaction(id: number): Promise<void> {
  const response = await authFetch(`${API_BASE}/transactions/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error('Failed to delete transaction');
  }
}

export async function bulkDeleteTransactions(ids: number[]): Promise<{ deleted: number }> {
  const response = await authFetch(`${API_BASE}/transactions/bulk`, {
    method: 'DELETE',
    body: JSON.stringify({ ids }),
  });
  if (!response.ok) {
    throw new Error('Failed to delete transactions');
  }
  return response.json();
}

// Monthly Values
export async function updateMonthlyValue(
  itemId: number,
  month: number,
  data: { budget?: number; actual?: number }
): Promise<{ budget: number; actual: number }> {
  const response = await authFetch(`${API_BASE}/budget/items/${itemId}/months/${month}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error('Failed to update monthly value');
  }
  return response.json();
}

// Payment Methods
export type SavingsType = 'epargne' | 'prevoyance' | 'investissements';

export interface PaymentMethod {
  id: number;
  name: string;
  institution: string | null;
  sortOrder: number;
  isAccount: boolean;
  isSavingsAccount: boolean;
  savingsType: SavingsType | null;
  settlementDay: number | null;
  linkedPaymentMethodId: number | null;
}

export async function fetchPaymentMethods(): Promise<PaymentMethod[]> {
  const response = await authFetch(`${API_BASE}/payment-methods`);
  if (!response.ok) {
    throw new Error('Failed to fetch payment methods');
  }
  return response.json();
}

export async function createPaymentMethod(data: {
  name: string;
  sortOrder?: number;
  institution?: string;
}): Promise<PaymentMethod> {
  const response = await authFetch(`${API_BASE}/payment-methods`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create payment method');
  }
  return response.json();
}

export async function updatePaymentMethod(
  id: number,
  data: {
    name?: string;
    institution?: string | null;
    sortOrder?: number;
    isAccount?: boolean;
    isSavingsAccount?: boolean;
    savingsType?: SavingsType | null;
    settlementDay?: number | null;
    linkedPaymentMethodId?: number | null;
  }
): Promise<PaymentMethod> {
  const response = await authFetch(`${API_BASE}/payment-methods/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update payment method');
  }
  return response.json();
}

export async function deletePaymentMethod(id: number): Promise<void> {
  const response = await authFetch(`${API_BASE}/payment-methods/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error('Failed to delete payment method');
  }
}

export async function reorderPaymentMethods(methodOrders: { id: number; sortOrder: number }[]): Promise<void> {
  const response = await authFetch(`${API_BASE}/payment-methods/reorder`, {
    method: 'PUT',
    body: JSON.stringify({ methods: methodOrders }),
  });
  if (!response.ok) {
    throw new Error('Failed to reorder payment methods');
  }
}

// Import
export interface ParsedTransaction {
  date: string;
  description: string;
  amount: number; // Always positive - sign indicated by isIncome
  thirdParty?: string;
  isIncome?: boolean; // Detected from PDF context - user can override in preview
  suggestedItemId?: number | null;
  suggestedItemName?: string;
  suggestedGroupName?: string;
  suggestedGroupType?: 'income' | 'expense';
}

export interface ParsePdfResponse {
  transactions: ParsedTransaction[];
  totalFound: number;
  rawTextSample?: string;
}

export async function parsePdf(file: File, yearId?: number): Promise<ParsePdfResponse> {
  const formData = new FormData();
  formData.append('file', file);

  const url = yearId ? `${API_BASE}/import/pdf?yearId=${yearId}` : `${API_BASE}/import/pdf`;

  // For FormData, don't set Content-Type - let browser set it with boundary
  const token = localStorage.getItem(TOKEN_KEY);
  const headers: HeadersInit = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: formData,
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to parse PDF');
  }
  return response.json();
}

export async function bulkCreateTransactions(
  yearId: number,
  transactions: Array<{
    date: string;
    description?: string;
    comment?: string;
    thirdParty?: string;
    paymentMethod?: string;
    amount: number;
    itemId?: number | null;
    accountingMonth?: number;
    accountingYear?: number;
  }>
): Promise<{ created: number }> {
  const response = await authFetch(`${API_BASE}/import/bulk`, {
    method: 'POST',
    body: JSON.stringify({ yearId, transactions }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create transactions');
  }
  return response.json();
}

// Accounts
export interface Account {
  id: number;
  name: string;
  institution: string | null;
  sortOrder: number;
  isAccount: boolean;
  isSavingsAccount: boolean;
  initialBalance: number;
  monthlyBalances: number[]; // Expected balance at end of each month (1-12)
}

export async function fetchAccounts(year: number): Promise<Account[]> {
  const response = await authFetch(`${API_BASE}/accounts/${year}`);
  if (!response.ok) {
    throw new Error('Failed to fetch accounts');
  }
  return response.json();
}

export async function setAccountBalance(year: number, paymentMethodId: number, initialBalance: number): Promise<void> {
  const response = await authFetch(`${API_BASE}/accounts/${year}/balance`, {
    method: 'PUT',
    body: JSON.stringify({ paymentMethodId, initialBalance }),
  });
  if (!response.ok) {
    throw new Error('Failed to set account balance');
  }
}

export async function togglePaymentMethodAccount(id: number, isAccount: boolean): Promise<void> {
  const response = await authFetch(`${API_BASE}/accounts/payment-method/${id}/toggle`, {
    method: 'PUT',
    body: JSON.stringify({ isAccount }),
  });
  if (!response.ok) {
    throw new Error('Failed to toggle payment method account');
  }
}

export async function togglePaymentMethodSavings(id: number, isSavingsAccount: boolean): Promise<void> {
  const response = await authFetch(`${API_BASE}/accounts/payment-method/${id}/savings`, {
    method: 'PUT',
    body: JSON.stringify({ isSavingsAccount }),
  });
  if (!response.ok) {
    throw new Error('Failed to toggle savings account');
  }
}

// Transfers
export interface AccountIdentifier {
  id: number;
  name: string;
  institution: string | null;
  isSavingsAccount: boolean;
}

export interface Transfer {
  id: number;
  date: string;
  amount: number;
  description: string | null;
  sourceAccount: AccountIdentifier;
  destinationAccount: AccountIdentifier;
  accountingMonth: number;
  accountingYear: number;
}

export async function fetchTransfers(year: number): Promise<Transfer[]> {
  const response = await authFetch(`${API_BASE}/transfers/${year}`);
  if (!response.ok) {
    throw new Error('Failed to fetch transfers');
  }
  return response.json();
}

export async function fetchTransferAccounts(year: number): Promise<AccountIdentifier[]> {
  const response = await authFetch(`${API_BASE}/transfers/${year}/accounts`);
  if (!response.ok) {
    throw new Error('Failed to fetch transfer accounts');
  }
  return response.json();
}

export async function createTransfer(
  year: number,
  data: {
    date: string;
    amount: number;
    description?: string;
    sourceAccountId: number;
    destinationAccountId: number;
    accountingMonth?: number;
    accountingYear?: number;
  }
): Promise<Transfer> {
  const response = await authFetch(`${API_BASE}/transfers/${year}`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to create transfer');
  }
  return response.json();
}

export async function updateTransfer(
  id: number,
  data: {
    date?: string;
    amount?: number;
    description?: string;
    sourceAccountId?: number;
    destinationAccountId?: number;
    accountingMonth?: number;
    accountingYear?: number;
  }
): Promise<Transfer> {
  const response = await authFetch(`${API_BASE}/transfers/${id}`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to update transfer');
  }
  return response.json();
}

export async function deleteTransfer(id: number): Promise<void> {
  const response = await authFetch(`${API_BASE}/transfers/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error('Failed to delete transfer');
  }
}

// Change user password
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const response = await authFetch(`${API_BASE}/auth/change-password`, {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to change password');
  }
}
