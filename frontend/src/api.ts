import type { BudgetData, BudgetGroup, BudgetItem, BudgetSummary } from './types';

const API_BASE = '/api';
const TOKEN_KEY = 'tallix_token';

const ERROR_MESSAGE_TO_CODE: Record<string, string> = {
  'Invalid email or password': 'AUTH_INVALID_CREDENTIALS',
  'Initial setup required': 'AUTH_INITIAL_SETUP_REQUIRED',
  'Email and password are required': 'AUTH_EMAIL_REQUIRED',
  'Password must be at least 8 characters': 'AUTH_PASSWORD_MIN',
  'No token provided': 'AUTH_NO_TOKEN',
  'Invalid token': 'AUTH_INVALID_TOKEN',
  'User not found': 'AUTH_USER_NOT_FOUND',
  'Invalid language. Supported: en, fr': 'AUTH_INVALID_LANGUAGE',
  'Invalid country code. Use ISO 3166-1 alpha-2 format (e.g., FR, CH).': 'AUTH_INVALID_COUNTRY',
  'Current password and new password are required': 'AUTH_CURRENT_PASSWORD_REQUIRED',
  'New password must be at least 6 characters': 'AUTH_PASSWORD_SHORT',
  'Invalid current password': 'AUTH_INVALID_CURRENT_PASSWORD',
};

export class ApiError extends Error {
  public readonly code?: string;
  public readonly params?: Record<string, any>;
  public readonly status?: number;

  constructor(message: string, code?: string, params?: Record<string, any>, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.params = params;
    this.status = status;
  }
}

export async function buildApiError(response: Response, fallbackMessage: string): Promise<ApiError> {
  let message = fallbackMessage;
  let code: string | undefined;
  let params: Record<string, any> | undefined;

  try {
    const data = (await response.json()) as { error?: string; code?: string; params?: Record<string, any> };
    if (data?.error) {
      message = data.error;
    }
    if (data?.code) {
      code = data.code;
      params = data.params;
    } else if (data?.error && ERROR_MESSAGE_TO_CODE[data.error]) {
      code = ERROR_MESSAGE_TO_CODE[data.error];
    }
  } catch {
    // ignore JSON parsing errors
  }

  return new ApiError(message, code, params, response.status);
}

export async function ensureOk(response: Response, fallbackMessage: string): Promise<void> {
  if (!response.ok) {
    throw await buildApiError(response, fallbackMessage);
  }
}

// Helper to get auth headers
function getAuthHeaders(): HeadersInit {
  const token = localStorage.getItem(TOKEN_KEY);
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
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
export async function fetchBudgetData(year?: number): Promise<BudgetData> {
  const url = year ? `${API_BASE}/budget/year/${year}` : `${API_BASE}/budget`;
  const response = await authFetch(url);
  await ensureOk(response, 'Failed to fetch budget data');
  return response.json();
}

export async function fetchBudgetSummary(): Promise<BudgetSummary> {
  const response = await authFetch(`${API_BASE}/budget/summary`);
  await ensureOk(response, 'Failed to fetch budget summary');
  return response.json();
}

export async function fetchMonths(): Promise<string[]> {
  const response = await authFetch(`${API_BASE}/budget/months`);
  await ensureOk(response, 'Failed to fetch months');
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
  await ensureOk(response, 'Failed to fetch years');
  return response.json();
}

export async function createYear(year: number, initialBalance: number = 0): Promise<BudgetYear> {
  const response = await authFetch(`${API_BASE}/budget/years`, {
    method: 'POST',
    body: JSON.stringify({ year, initialBalance }),
  });
  await ensureOk(response, 'Failed to create year');
  return response.json();
}

export async function updateYear(id: number, initialBalance: number): Promise<BudgetYear> {
  const response = await authFetch(`${API_BASE}/budget/years/${id}`, {
    method: 'PUT',
    body: JSON.stringify({ initialBalance }),
  });
  await ensureOk(response, 'Failed to update year');
  return response.json();
}

// Start Year
export async function fetchStartYear(): Promise<{ startYear: number }> {
  const response = await authFetch(`${API_BASE}/budget/start-year`);
  await ensureOk(response, 'Failed to fetch start year');
  return response.json();
}

export async function updateStartYear(startYear: number): Promise<{ startYear: number; createdYears: number[] }> {
  const response = await authFetch(`${API_BASE}/budget/start-year`, {
    method: 'PUT',
    body: JSON.stringify({ startYear }),
  });
  await ensureOk(response, 'Failed to update start year');
  return response.json();
}

export async function fetchAvailableYears(): Promise<{ years: number[] }> {
  const response = await authFetch(`${API_BASE}/budget/years`);
  await ensureOk(response, 'Failed to fetch available years');
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
  await ensureOk(response, 'Failed to create group');
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
  await ensureOk(response, 'Failed to update group');
  return response.json();
}

export async function deleteGroup(id: number): Promise<void> {
  const response = await authFetch(`${API_BASE}/budget/groups/${id}`, {
    method: 'DELETE',
  });
  await ensureOk(response, 'Failed to delete group');
}

export async function reorderGroups(groupOrders: { id: number; sortOrder: number }[]): Promise<void> {
  const response = await authFetch(`${API_BASE}/budget/groups/reorder`, {
    method: 'PUT',
    body: JSON.stringify({ groups: groupOrders }),
  });
  await ensureOk(response, 'Failed to reorder groups');
}

export async function reorderItems(itemOrders: { id: number; sortOrder: number }[]): Promise<void> {
  const response = await authFetch(`${API_BASE}/budget/items/reorder`, {
    method: 'PUT',
    body: JSON.stringify({ items: itemOrders }),
  });
  await ensureOk(response, 'Failed to reorder items');
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
  await ensureOk(response, 'Failed to create item');
  return response.json();
}

export async function moveItem(itemId: number, groupId: number | null): Promise<void> {
  const response = await authFetch(`${API_BASE}/budget/items/move`, {
    method: 'PUT',
    body: JSON.stringify({ itemId, groupId }),
  });
  await ensureOk(response, 'Failed to move item');
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
  await ensureOk(response, 'Failed to update item');
  return response.json();
}

export async function deleteItem(id: number): Promise<void> {
  const response = await authFetch(`${API_BASE}/budget/items/${id}`, {
    method: 'DELETE',
  });
  await ensureOk(response, 'Failed to delete item');
}

// Third Parties (autocomplete)
export async function fetchThirdParties(search?: string): Promise<string[]> {
  const url = search
    ? `${API_BASE}/transactions/third-parties?search=${encodeURIComponent(search)}`
    : `${API_BASE}/transactions/third-parties`;
  const response = await authFetch(url);
  await ensureOk(response, 'Failed to fetch third parties');
  return response.json();
}

// Transactions
export interface Transaction {
  id: number;
  date: string;
  description: string | null;
  comment: string | null;
  thirdParty: string | null;
  paymentMethodId: number;
  paymentMethod: string | null; // Display name: "Name (Institution)"
  amount: number;
  itemId: number | null;
  itemName: string | null;
  groupName: string | null;
  groupType: 'income' | 'expense' | 'savings';
  accountingMonth: number;
  accountingYear: number;
  warning?: string | null;
}

export async function fetchTransactions(year?: number): Promise<Transaction[]> {
  const url = typeof year === 'number'
    ? `${API_BASE}/transactions/year/${year}`
    : `${API_BASE}/transactions`;
  const response = await authFetch(url);
  await ensureOk(response, 'Failed to fetch transactions');
  return response.json();
}

export async function createTransaction(data: {
  yearId: number;
  itemId?: number | null;
  date: string;
  description?: string;
  comment?: string;
  thirdParty?: string;
  paymentMethodId: number;
  amount: number;
  accountingMonth?: number;
  accountingYear?: number;
}): Promise<Transaction> {
  const response = await authFetch(`${API_BASE}/transactions`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
  await ensureOk(response, 'Failed to create transaction');
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
    paymentMethodId?: number;
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
  await ensureOk(response, 'Failed to update transaction');
  return response.json();
}

export async function deleteTransaction(id: number): Promise<void> {
  const response = await authFetch(`${API_BASE}/transactions/${id}`, {
    method: 'DELETE',
  });
  await ensureOk(response, 'Failed to delete transaction');
}

export async function bulkDeleteTransactions(ids: number[]): Promise<{ deleted: number }> {
  const response = await authFetch(`${API_BASE}/transactions/bulk`, {
    method: 'DELETE',
    body: JSON.stringify({ ids }),
  });
  await ensureOk(response, 'Failed to delete transactions');
  return response.json();
}

export async function dismissTransactionWarning(id: number): Promise<Transaction> {
  const response = await authFetch(`${API_BASE}/transactions/${id}/dismiss-warning`, {
    method: 'POST',
  });
  await ensureOk(response, 'Failed to dismiss transaction warning');
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
  await ensureOk(response, 'Failed to update monthly value');
  return response.json();
}

// Payment Methods
export type SavingsType = 'epargne' | 'prevoyance' | 'investissements';

export interface PaymentMethod {
  id: number;
  name: string;
  institution: string | null;
  sortOrder: number;
  isSavingsAccount: boolean;
  savingsType: SavingsType | null;
  settlementDay: number | null;
  linkedPaymentMethodId: number | null;
}

export async function fetchPaymentMethods(): Promise<PaymentMethod[]> {
  const response = await authFetch(`${API_BASE}/payment-methods`);
  await ensureOk(response, 'Failed to fetch payment methods');
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
  await ensureOk(response, 'Failed to create payment method');
  return response.json();
}

export async function updatePaymentMethod(
  id: number,
  data: {
    name?: string;
    institution?: string | null;
    sortOrder?: number;
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
  await ensureOk(response, 'Failed to update payment method');
  return response.json();
}

export async function deletePaymentMethod(id: number): Promise<void> {
  const response = await authFetch(`${API_BASE}/payment-methods/${id}`, {
    method: 'DELETE',
  });
  await ensureOk(response, 'Failed to delete payment method');
}

export async function reorderPaymentMethods(methodOrders: { id: number; sortOrder: number }[]): Promise<void> {
  const response = await authFetch(`${API_BASE}/payment-methods/reorder`, {
    method: 'PUT',
    body: JSON.stringify({ methods: methodOrders }),
  });
  await ensureOk(response, 'Failed to reorder payment methods');
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

export async function parsePdf(
  file: File,
  yearId?: number,
  skipSuggestions: boolean = false
): Promise<ParsePdfResponse> {
  const formData = new FormData();
  formData.append('file', file);

  const params = new URLSearchParams();
  if (yearId) params.append('yearId', yearId.toString());
  if (skipSuggestions) params.append('skipSuggestions', 'true');
  const queryString = params.toString();
  const url = queryString ? `${API_BASE}/import/pdf?${queryString}` : `${API_BASE}/import/pdf`;

  // For FormData, don't set Content-Type - let browser set it with boundary
  const token = localStorage.getItem(TOKEN_KEY);
  const headers: HeadersInit = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: formData,
  });
  await ensureOk(response, 'Failed to parse PDF');
  return response.json();
}

export interface LlmExtractedTransaction {
  date: string;
  amount: number;
  categoryId: number | null;
  categoryName: string | null;
  groupName: string | null;
  isIncome: boolean;
  description: string;
  thirdParty: string | null;
  paymentMethodId: number | null;
  paymentMethodName: string | null;
  paymentMethodInstitution: string | null;
  confidence: 'high' | 'medium' | 'low';
}

export async function parsePdfWithLlm(
  file: File,
  categories: CategoryForClassification[],
  paymentMethods: Array<{ id: number; name: string; institution: string | null }>,
  language: string = 'fr',
  country?: string
): Promise<{ transactions: LlmExtractedTransaction[] }> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('categories', JSON.stringify(categories));
  formData.append('paymentMethods', JSON.stringify(paymentMethods));
  formData.append('language', language);
  if (country) formData.append('country', country);

  const token = localStorage.getItem(TOKEN_KEY);
  const headers: HeadersInit = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}/import/pdf-llm`, {
    method: 'POST',
    headers,
    body: formData,
  });
  await ensureOk(response, 'Failed to extract transactions from PDF');
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
  await ensureOk(response, 'Failed to create transactions');
  return response.json();
}

// Accounts
export interface Account {
  id: number;
  name: string;
  institution: string | null;
  sortOrder: number;
  isSavingsAccount: boolean;
  initialBalance: number;
  monthlyBalances: number[]; // Expected balance at end of each month (1-12)
}

export interface AccountsResponse {
  accounts: Account[];
  lastActiveMonth: number; // 1-12, the last month with any settled transaction/transfer
}

export async function fetchAccounts(year: number): Promise<AccountsResponse> {
  const response = await authFetch(`${API_BASE}/accounts/${year}`);
  await ensureOk(response, 'Failed to fetch accounts');
  return response.json();
}

export async function setAccountBalance(year: number, paymentMethodId: number, initialBalance: number): Promise<void> {
  const response = await authFetch(`${API_BASE}/accounts/${year}/balance`, {
    method: 'PUT',
    body: JSON.stringify({ paymentMethodId, initialBalance }),
  });
  await ensureOk(response, 'Failed to set account balance');
}

export async function togglePaymentMethodSavings(id: number, isSavingsAccount: boolean): Promise<void> {
  const response = await authFetch(`${API_BASE}/accounts/payment-method/${id}/savings`, {
    method: 'PUT',
    body: JSON.stringify({ isSavingsAccount }),
  });
  await ensureOk(response, 'Failed to toggle savings account');
}

// Assets
export interface Asset {
  id: number;
  name: string;
  sortOrder: number;
  isSystem: boolean;
  isDebt: boolean;
  parentAssetId: number | null;
  savingsType: string | null;
  yearlyValues: Record<number, number>; // year -> value
}

export interface AssetsResponse {
  assets: Asset[];
  years: number[]; // Available years for this budget
}

export async function fetchAssets(): Promise<AssetsResponse> {
  const response = await authFetch(`${API_BASE}/assets`);
  await ensureOk(response, 'Failed to fetch assets');
  return response.json();
}

export async function createAsset(name: string, isDebt = false): Promise<Asset> {
  const response = await authFetch(`${API_BASE}/assets`, {
    method: 'POST',
    body: JSON.stringify({ name, isDebt }),
  });
  await ensureOk(response, 'Failed to create asset');
  return response.json();
}

export async function updateAssetValue(assetId: number, year: number, value: number): Promise<void> {
  const response = await authFetch(`${API_BASE}/assets/${assetId}/value`, {
    method: 'PUT',
    body: JSON.stringify({ year, value }),
  });
  await ensureOk(response, 'Failed to update asset value');
}

export async function deleteAsset(assetId: number): Promise<void> {
  const response = await authFetch(`${API_BASE}/assets/${assetId}`, {
    method: 'DELETE',
  });
  await ensureOk(response, 'Failed to delete asset');
}

export async function reorderAssets(assetIds: number[]): Promise<void> {
  const response = await authFetch(`${API_BASE}/assets/reorder`, {
    method: 'PUT',
    body: JSON.stringify({ assetIds }),
  });
  await ensureOk(response, 'Failed to reorder assets');
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
  await ensureOk(response, 'Failed to fetch transfers');
  return response.json();
}

export async function fetchTransferAccounts(year: number): Promise<AccountIdentifier[]> {
  const response = await authFetch(`${API_BASE}/transfers/${year}/accounts`);
  await ensureOk(response, 'Failed to fetch transfer accounts');
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
  await ensureOk(response, 'Failed to create transfer');
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
  await ensureOk(response, 'Failed to update transfer');
  return response.json();
}

export async function deleteTransfer(id: number): Promise<void> {
  const response = await authFetch(`${API_BASE}/transfers/${id}`, {
    method: 'DELETE',
  });
  await ensureOk(response, 'Failed to delete transfer');
}

// Change user password
export async function changePassword(currentPassword: string, newPassword: string): Promise<void> {
  const response = await authFetch(`${API_BASE}/auth/change-password`, {
    method: 'POST',
    body: JSON.stringify({ currentPassword, newPassword }),
  });
  await ensureOk(response, 'Failed to change password');
}

// Update user settings
export async function updateUserSettings(updates: {
  name?: string;
  language?: string;
  country?: string;
}): Promise<{ id: string; email: string; name: string | null; language: string; country: string | null }> {
  const response = await authFetch(`${API_BASE}/auth/me`, {
    method: 'PATCH',
    body: JSON.stringify(updates),
  });
  await ensureOk(response, 'Failed to update user settings');
  const data = await response.json();
  return data.user;
}

// LLM Classification types
export interface TransactionToClassify {
  index: number;
  date: string;
  description: string;
  amount: number;
  thirdParty?: string;
  // Raw fields from import (before processing)
  rawDescription?: string;
  rawThirdParty?: string;
  rawCategory?: string;
  rawPaymentMethod?: string;
}

export interface CategoryForClassification {
  id: number;
  name: string;
  groupName: string;
  groupType: 'income' | 'expense' | 'savings';
}

export interface PaymentMethodForClassification {
  id: number;
  name: string;
  institution: string | null;
}

export interface ClassificationResult {
  index: number;
  categoryId: number | null;
  categoryName: string | null;
  groupName: string | null;
  isIncome: boolean;
  description: string | null;
  thirdParty: string | null;
  paymentMethodId: number | null;
  paymentMethodName: string | null;
  paymentMethodInstitution: string | null;
  confidence: 'high' | 'medium' | 'low';
}

// Check if LLM classification is available
export async function checkLLMStatus(): Promise<{ available: boolean }> {
  const response = await authFetch(`${API_BASE}/import/llm-status`);
  if (!response.ok) {
    return { available: false };
  }
  return response.json();
}

// Classify transactions using LLM
export async function classifyTransactionsWithLLM(
  transactions: TransactionToClassify[],
  categories: CategoryForClassification[],
  paymentMethods: PaymentMethodForClassification[] = []
): Promise<ClassificationResult[]> {
  const response = await authFetch(`${API_BASE}/import/classify`, {
    method: 'POST',
    body: JSON.stringify({ transactions, categories, paymentMethods }),
  });
  await ensureOk(response, 'Failed to classify transactions');
  const data = await response.json();
  return data.classifications;
}
