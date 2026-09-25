import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transaction, Transfer } from '../api';
import * as api from '../api';
import { I18nProvider } from '../contexts/I18nContext';
import { SettingsProvider } from '../contexts/SettingsContext';
import type { BudgetGroup } from '../types';
import * as utils from '../utils';
import Transactions from './Transactions';

vi.mock('./BulkImportModal', () => ({
  default: () => null,
}));

vi.mock('../utils/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('../api', () => ({
  bulkDeleteTransactions: vi.fn(),
  createTransaction: vi.fn(),
  createTransfer: vi.fn(),
  deleteTransaction: vi.fn(),
  deleteTransfer: vi.fn(),
  dismissTransactionWarning: vi.fn(),
  fetchPaymentMethods: vi.fn(),
  fetchThirdParties: vi.fn(),
  fetchTransactions: vi.fn(),
  fetchTransferAccounts: vi.fn(),
  fetchTransfers: vi.fn(),
  reorderTransactionEntries: vi.fn(),
  updateTransaction: vi.fn(),
  updateTransfer: vi.fn(),
}));

const mockedApi = vi.mocked(api);

const mountedRoots: Root[] = [];

const groups: BudgetGroup[] = [
  {
    id: 1,
    name: 'Income Group',
    slug: 'income-group',
    type: 'income',
    sortOrder: 0,
    items: [{ id: 10, name: 'Salary', slug: 'salary', yearlyBudget: 0, months: [] }],
  },
  {
    id: 2,
    name: 'Expense Group',
    slug: 'expense-group',
    type: 'expense',
    sortOrder: 1,
    items: [
      { id: 20, name: 'Groceries', slug: 'groceries', yearlyBudget: 0, months: [] },
      { id: 21, name: 'Eating Out', slug: 'eating-out', yearlyBudget: 0, months: [] },
    ],
  },
];

const paymentMethods = [
  {
    id: 100,
    name: 'Checking',
    institution: 'Bank',
    sortOrder: 0,
    isSavingsAccount: false,
    savingsType: null,
    settlementDay: null,
    linkedPaymentMethodId: null,
  },
  {
    id: 101,
    name: 'Credit Card',
    institution: null,
    sortOrder: 1,
    isSavingsAccount: false,
    savingsType: null,
    settlementDay: null,
    linkedPaymentMethodId: null,
  },
  {
    id: 200,
    name: 'Savings',
    institution: 'Bank',
    sortOrder: 2,
    isSavingsAccount: true,
    savingsType: 'epargne' as const,
    settlementDay: null,
    linkedPaymentMethodId: null,
  },
];

const transferAccounts = paymentMethods.map(({ id, name, institution, isSavingsAccount }) => ({
  id,
  name,
  institution,
  isSavingsAccount,
}));

function transaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: 1,
    date: '2026-02-03',
    description: 'Existing purchase',
    comment: null,
    thirdParty: 'Market',
    paymentMethodId: 100,
    paymentMethod: 'Checking (Bank)',
    amount: 12.5,
    itemId: 20,
    itemName: 'Groceries',
    groupName: 'Expense Group',
    groupType: 'expense',
    accountingMonth: 2,
    accountingYear: 2026,
    sortPriority: null,
    warning: null,
    ...overrides,
  };
}

function transfer(overrides: Partial<Transfer> = {}): Transfer {
  return {
    id: 1,
    date: '2026-02-04',
    amount: 50,
    description: 'Move to savings',
    sourceAccount: transferAccounts[0],
    destinationAccount: transferAccounts[2],
    accountingMonth: 2,
    accountingYear: 2026,
    sortPriority: null,
    ...overrides,
  };
}

function makeTransactions(count: number): Transaction[] {
  return Array.from({ length: count }, (_, index) =>
    transaction({
      id: index + 1,
      date: `2026-02-${String((index % 27) + 1).padStart(2, '0')}`,
      description: `Seed transaction ${index + 1}`,
      thirdParty: `Party ${index + 1}`,
      amount: index + 0.25,
      sortPriority: count - index,
    })
  );
}

function change(element: Element, value: string) {
  const prototype =
    element instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : element instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : null;
  const valueSetter = prototype ? Object.getOwnPropertyDescriptor(prototype, 'value')?.set : undefined;

  act(() => {
    valueSetter?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function submit(element: HTMLFormElement) {
  act(() => {
    element.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

async function renderTransactions(
  transactions: Transaction[] = [transaction()],
  transfers: Transfer[] = [],
  onTransactionsChanged = vi.fn()
) {
  mockedApi.fetchTransactions.mockResolvedValue(transactions);
  mockedApi.fetchPaymentMethods.mockResolvedValue(paymentMethods);
  mockedApi.fetchTransfers.mockResolvedValue(transfers);
  mockedApi.fetchTransferAccounts.mockResolvedValue(transferAccounts);
  mockedApi.fetchThirdParties.mockResolvedValue([]);

  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;

  await act(async () => {
    root = createRoot(container);
    mountedRoots.push(root);
    root.render(
      <I18nProvider>
        <SettingsProvider>
          <Transactions year={2026} yearId={77} groups={groups} onTransactionsChanged={onTransactionsChanged} />
        </SettingsProvider>
      </I18nProvider>
    );
  });

  await flush();

  return { container, root: root! };
}

function byPlaceholder(container: HTMLElement, placeholder: string): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(`input[placeholder="${placeholder}"]`);
  if (!input) throw new Error(`Missing input with placeholder ${placeholder}`);
  return input;
}

function selectByClass(container: HTMLElement, className: string): HTMLSelectElement {
  const select = container.querySelector<HTMLSelectElement>(`select.${className}`);
  if (!select) throw new Error(`Missing select ${className}`);
  return select;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  localStorage.setItem('tallix_locale', 'en');
  vi.clearAllMocks();
  mockedApi.fetchThirdParties.mockResolvedValue([]);
});

afterEach(() => {
  for (const root of mountedRoots.splice(0)) {
    act(() => {
      root.unmount();
    });
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('new transaction form', () => {
  it('creates a transaction with trimmed optional fields and keeps the entered date after success', async () => {
    const onTransactionsChanged = vi.fn();
    mockedApi.createTransaction.mockResolvedValue(transaction({ id: 99 }));
    const { container } = await renderTransactions([transaction()], [], onTransactionsChanged);

    change(byPlaceholder(container, 'DD/MM/YYYY'), '15/03/2026');
    change(byPlaceholder(container, 'Third party (recipient/sender)'), '  Coffee Shop  ');
    change(byPlaceholder(container, 'Description (optional)'), '  beans  ');
    change(selectByClass(container, 'payment-method-select'), '101');
    change(byPlaceholder(container, 'Amount'), '8.75');
    change(selectByClass(container, 'category-select'), '20');
    submit(container.querySelector('form.transaction-form')!);
    await flush();

    expect(mockedApi.createTransaction).toHaveBeenCalledWith({
      yearId: 77,
      itemId: 20,
      date: '2026-03-15',
      description: 'beans',
      thirdParty: 'Coffee Shop',
      paymentMethodId: 101,
      amount: 8.75,
    });
    expect(byPlaceholder(container, 'DD/MM/YYYY').value).toBe('15/03/2026');
    expect(byPlaceholder(container, 'Third party (recipient/sender)').value).toBe('');
    expect(byPlaceholder(container, 'Description (optional)').value).toBe('');
    expect(byPlaceholder(container, 'Amount').value).toBe('');
    expect(selectByClass(container, 'payment-method-select').value).toBe('');
    expect(selectByClass(container, 'category-select').value).toBe('');
    expect(mockedApi.fetchTransactions).toHaveBeenCalledTimes(2);
    expect(mockedApi.fetchTransfers).toHaveBeenCalledTimes(2);
    expect(onTransactionsChanged).toHaveBeenCalledTimes(1);
  });

  it('preserves the transaction draft when createTransaction rejects', async () => {
    mockedApi.createTransaction.mockRejectedValue(new Error('boom'));
    const { container } = await renderTransactions();

    change(byPlaceholder(container, 'DD/MM/YYYY'), '16/03/2026');
    change(byPlaceholder(container, 'Third party (recipient/sender)'), 'Bakery');
    change(byPlaceholder(container, 'Description (optional)'), 'Bread');
    change(selectByClass(container, 'payment-method-select'), '100');
    change(byPlaceholder(container, 'Amount'), '4.5');
    change(selectByClass(container, 'category-select'), '20');
    submit(container.querySelector('form.transaction-form')!);
    await flush();

    expect(byPlaceholder(container, 'DD/MM/YYYY').value).toBe('16/03/2026');
    expect(byPlaceholder(container, 'Third party (recipient/sender)').value).toBe('Bakery');
    expect(byPlaceholder(container, 'Description (optional)').value).toBe('Bread');
    expect(byPlaceholder(container, 'Amount').value).toBe('4.5');
    expect(selectByClass(container, 'payment-method-select').value).toBe('100');
    expect(selectByClass(container, 'category-select').value).toBe('20');
  });

  it('keeps a manually selected category and payment method when third-party autofill runs later', async () => {
    const { container } = await renderTransactions([
      transaction({ thirdParty: 'Coffee Shop', itemId: 20, paymentMethodId: 100 }),
    ]);

    const thirdParty = byPlaceholder(container, 'Third party (recipient/sender)');
    change(thirdParty, 'Coffee Shop');
    act(() => {
      thirdParty.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    await flush();

    expect(selectByClass(container, 'payment-method-select').value).toBe('100');
    expect(selectByClass(container, 'category-select').value).toBe('20');

    change(selectByClass(container, 'payment-method-select'), '101');
    change(selectByClass(container, 'category-select'), '21');
    act(() => {
      thirdParty.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    });
    await flush();

    expect(selectByClass(container, 'payment-method-select').value).toBe('101');
    expect(selectByClass(container, 'category-select').value).toBe('21');
  });

  it('shows recently used categories before the full category list', async () => {
    const { container } = await renderTransactions([transaction({ itemId: 21, itemName: 'Eating Out' })]);

    const category = selectByClass(container, 'category-select');
    expect(category.querySelector('optgroup[label="Recently used"] option')?.textContent).toBe(
      'Expense Group → Eating Out'
    );
  });

  it('blocks duplicate creates and table reorders while transaction creation is pending', async () => {
    const pendingCreate = deferred<Transaction>();
    mockedApi.createTransaction.mockReturnValue(pendingCreate.promise);
    const { container } = await renderTransactions([
      transaction({ id: 1, sortPriority: 2 }),
      transaction({ id: 2, date: '2026-02-02', sortPriority: 1 }),
    ]);

    change(byPlaceholder(container, 'DD/MM/YYYY'), '18/03/2026');
    change(byPlaceholder(container, 'Third party (recipient/sender)'), 'Slow Shop');
    change(byPlaceholder(container, 'Description (optional)'), 'Pending');
    change(selectByClass(container, 'payment-method-select'), '100');
    change(byPlaceholder(container, 'Amount'), '42');
    change(selectByClass(container, 'category-select'), '20');

    const form = container.querySelector<HTMLFormElement>('form.transaction-form')!;
    submit(form);
    await flush();

    const addButton = container.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    const reorderButtons = Array.from(container.querySelectorAll<HTMLButtonElement>('button.btn-icon.reorder'));
    expect(mockedApi.createTransaction).toHaveBeenCalledTimes(1);
    expect(addButton.disabled).toBe(true);
    expect(reorderButtons.length).toBeGreaterThan(0);
    expect(reorderButtons.every((button) => button.disabled)).toBe(true);

    submit(form);
    await flush();

    expect(mockedApi.createTransaction).toHaveBeenCalledTimes(1);

    await act(async () => {
      pendingCreate.resolve(transaction({ id: 99 }));
      await pendingCreate.promise;
    });
    await flush();

    expect(addButton.disabled).toBe(true);
    expect(reorderButtons.every((button) => button.disabled)).toBe(false);
  });
});

describe('new transfer form', () => {
  it('creates a transfer and resets transfer-only fields after success', async () => {
    mockedApi.createTransfer.mockResolvedValue(transfer({ id: 99 }));
    const { container } = await renderTransactions();

    act(() => {
      Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
        .find((button) => button.textContent?.includes('Transfer'))
        ?.click();
    });
    change(byPlaceholder(container, 'DD/MM/YYYY'), '17/03/2026');
    change(selectByClass(container, 'account-select'), '100');
    const accountSelects = container.querySelectorAll<HTMLSelectElement>('select.account-select');
    change(accountSelects[1], '200');
    change(byPlaceholder(container, 'Description (optional)'), '  Save it  ');
    change(byPlaceholder(container, 'Amount'), '125');
    submit(container.querySelector('form.transaction-form')!);
    await flush();

    expect(mockedApi.createTransfer).toHaveBeenCalledWith(2026, {
      date: '2026-03-17',
      amount: 125,
      description: 'Save it',
      sourceAccountId: 100,
      destinationAccountId: 200,
    });
    expect(byPlaceholder(container, 'DD/MM/YYYY').value).toBe('17/03/2026');
    expect(accountSelects[0].value).toBe('');
    expect(accountSelects[1].value).toBe('');
    expect(byPlaceholder(container, 'Description (optional)').value).toBe('');
    expect(byPlaceholder(container, 'Amount').value).toBe('');
  });
});

describe('new transaction typing render cost', () => {
  it('does not reformat table dates when typing in the add form draft fields', async () => {
    const dateSpy = vi.spyOn(utils, 'formatDateDisplay');
    const { container } = await renderTransactions(makeTransactions(100));
    dateSpy.mockClear();

    change(byPlaceholder(container, 'Description (optional)'), 'draft');
    change(byPlaceholder(container, 'DD/MM/YYYY'), '18/03/2026');
    change(byPlaceholder(container, 'Amount'), '44');
    change(byPlaceholder(container, 'Third party (recipient/sender)'), 'Draft Party');
    await flush();

    expect(dateSpy.mock.calls.length).toBe(0);
  });
});
