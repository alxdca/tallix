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
    settlementDay: 20,
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
  onTransactionsChanged = vi.fn(),
  readOnly = false
) {
  mockedApi.fetchTransactions.mockResolvedValue(transactions);
  mockedApi.fetchPaymentMethods.mockResolvedValue(paymentMethods);
  mockedApi.fetchTransfers.mockResolvedValue(transfers);
  mockedApi.fetchTransferAccounts.mockResolvedValue(transferAccounts);
  mockedApi.fetchThirdParties.mockResolvedValue([]);

  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;

  const page = (isReadOnly: boolean) => (
    <I18nProvider>
      <SettingsProvider>
        <Transactions
          year={2026}
          yearId={77}
          groups={groups}
          onTransactionsChanged={onTransactionsChanged}
          readOnly={isReadOnly}
        />
      </SettingsProvider>
    </I18nProvider>
  );
  await act(async () => {
    root = createRoot(container);
    mountedRoots.push(root);
    root.render(page(readOnly));
  });

  await flush();

  return { container, root: root!, setReadOnly: (value: boolean) => act(() => root.render(page(value))) };
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

describe('transaction filters', () => {
  it('matches comment text regardless of case, combines filters, and clears them', async () => {
    const { container } = await renderTransactions(
      [
        transaction({ id: 1, description: 'Office purchase', comment: 'For the OFFICE kitchen' }),
        transaction({ id: 2, description: 'March purchase', comment: 'office supplies', accountingMonth: 3 }),
        transaction({ id: 3, description: 'Office without a comment', comment: null }),
        transaction({ id: 4, description: 'Office with an empty comment', comment: '' }),
        transaction({ id: 5, description: 'Personal purchase', comment: 'Personal kitchen' }),
      ],
      [transfer({ description: 'Office transfer' })]
    );

    const commentFilter = container.querySelector<HTMLInputElement>('input.comment-filter')!;
    expect(commentFilter.getAttribute('aria-label')).toBe('Comment');
    change(commentFilter, 'oFfIcE');

    expect(container.querySelectorAll('.transactions-table tbody tr')).toHaveLength(2);
    expect(container.querySelector('tbody')?.textContent).toContain('Office purchase');
    expect(container.querySelector('tbody')?.textContent).toContain('March purchase');
    expect(container.querySelector('.btn-clear-filters')).not.toBeNull();

    change(selectByClass(container, 'accounting-period-filter'), '2026-2');
    expect(container.querySelectorAll('.transactions-table tbody tr')).toHaveLength(1);
    expect(container.querySelector('tbody')?.textContent).toContain('Office purchase');

    act(() => {
      container.querySelector<HTMLButtonElement>('.btn-clear-filters')!.click();
    });
    expect(commentFilter.value).toBe('');
    expect(selectByClass(container, 'accounting-period-filter').value).toBe('');
    expect(container.querySelectorAll('.transactions-table tbody tr')).toHaveLength(5);
    expect(container.querySelector('.btn-clear-filters')).toBeNull();
  });

  it('can clear a comment filter when no transactions match', async () => {
    const { container } = await renderTransactions([transaction({ comment: 'Personal purchase' })]);

    change(container.querySelector<HTMLInputElement>('input.comment-filter')!, 'office');
    expect(container.textContent).toContain('No transactions match the filters');

    act(() => {
      container.querySelector<HTMLButtonElement>('.empty-transactions .btn-link')!.click();
    });
    expect(container.querySelector<HTMLInputElement>('input.comment-filter')!.value).toBe('');
    expect(container.querySelectorAll('.transactions-table tbody tr')).toHaveLength(1);
  });

  it('keeps filters mounted and focused so a search with no matches can be edited', async () => {
    const { container } = await renderTransactions([transaction({ comment: 'Personal purchase' })]);
    const table = container.querySelector('.transactions-table');
    const filterRow = container.querySelector('.filter-row');
    const commentFilter = container.querySelector<HTMLInputElement>('input.comment-filter')!;

    act(() => commentFilter.focus());
    change(commentFilter, 'office');

    expect(container.querySelector('.transactions-table')).toBe(table);
    expect(container.querySelector('.filter-row')).toBe(filterRow);
    expect(document.activeElement).toBe(commentFilter);
    expect(commentFilter.value).toBe('office');
    expect(container.textContent).toContain('No transactions match the filters');
    expect(container.querySelectorAll('.transactions-table tbody tr')).toHaveLength(0);

    change(commentFilter, 'personal');
    expect(container.querySelectorAll('.transactions-table tbody tr')).toHaveLength(1);
    expect(container.querySelector('.empty-transactions')).toBeNull();
    expect(document.activeElement).toBe(commentFilter);
  });

  it('keeps filters visible when there are no recorded entries', async () => {
    const { container } = await renderTransactions([], []);

    expect(container.querySelector('.filter-row')).not.toBeNull();
    expect(container.querySelector('input.comment-filter')).not.toBeNull();
    expect(container.textContent).toContain('No transactions recorded');
    expect(container.querySelectorAll('.transactions-table tbody tr')).toHaveLength(0);
  });

  it('filters transactions by accounting month and year, then clears the filter', async () => {
    const { container } = await renderTransactions(
      [
        transaction({ id: 1, description: 'February purchase' }),
        transaction({ id: 2, description: 'Next-year purchase', accountingYear: 2027 }),
        transaction({ id: 3, description: 'March purchase', accountingMonth: 3 }),
      ],
      [transfer({ description: 'February transfer' })]
    );

    const accountingFilter = selectByClass(container, 'accounting-period-filter');
    expect(Array.from(accountingFilter.options).map((option) => option.value)).toEqual([
      '',
      '2026-2',
      '2026-3',
      '2027-2',
    ]);

    change(accountingFilter, '2026-2');
    expect(container.querySelectorAll('.transactions-table tbody tr')).toHaveLength(1);
    expect(container.textContent).toContain('February purchase');
    expect(container.textContent).not.toContain('February transfer');
    expect(container.textContent).not.toContain('Next-year purchase');
    expect(container.textContent).not.toContain('March purchase');

    act(() => {
      container.querySelector<HTMLButtonElement>('.btn-clear-filters')!.click();
    });
    expect(accountingFilter.value).toBe('');
    expect(container.querySelectorAll('.transactions-table tbody tr')).toHaveLength(3);

    change(accountingFilter, '2027-2');
    expect(container.querySelectorAll('.transactions-table tbody tr')).toHaveLength(1);
    expect(container.textContent).toContain('Next-year purchase');
  });
});

describe('new transaction form', () => {
  it('creates a transaction with trimmed optional fields and keeps the entered date after success', async () => {
    const onTransactionsChanged = vi.fn();
    mockedApi.createTransaction.mockResolvedValue(transaction({ id: 99 }));
    const { container } = await renderTransactions([transaction()], [], onTransactionsChanged);

    change(byPlaceholder(container, 'DD/MM/YYYY'), '15/03/2026');
    change(byPlaceholder(container, 'Third party (recipient/sender)'), '  Coffee Shop  ');
    change(byPlaceholder(container, 'Description (optional)'), '  beans  ');
    change(byPlaceholder(container, 'Comment'), '  For the office  ');
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
      comment: 'For the office',
      thirdParty: 'Coffee Shop',
      paymentMethodId: 101,
      amount: 8.75,
    });
    expect(byPlaceholder(container, 'DD/MM/YYYY').value).toBe('15/03/2026');
    expect(byPlaceholder(container, 'Third party (recipient/sender)').value).toBe('');
    expect(byPlaceholder(container, 'Description (optional)').value).toBe('');
    expect(byPlaceholder(container, 'Comment').value).toBe('');
    expect(byPlaceholder(container, 'Amount').value).toBe('');
    expect(selectByClass(container, 'payment-method-select').value).toBe('');
    expect(selectByClass(container, 'category-select').value).toBe('');
    expect(mockedApi.fetchTransactions).toHaveBeenCalledTimes(2);
    expect(mockedApi.fetchTransfers).not.toHaveBeenCalled();
    expect(onTransactionsChanged).toHaveBeenCalledTimes(1);
  });

  it.each(['', '   '])('creates a transaction without an optional comment (%j)', async (comment) => {
    mockedApi.createTransaction.mockResolvedValue(transaction({ id: 99 }));
    const { container } = await renderTransactions();

    change(byPlaceholder(container, 'Comment'), comment);
    change(selectByClass(container, 'payment-method-select'), '100');
    change(byPlaceholder(container, 'Amount'), '4.5');
    change(selectByClass(container, 'category-select'), '20');
    submit(container.querySelector('form.transaction-form')!);
    await flush();

    expect(mockedApi.createTransaction).toHaveBeenCalledWith(expect.objectContaining({ comment: undefined }));
  });

  it('preserves the transaction draft when createTransaction rejects', async () => {
    mockedApi.createTransaction.mockRejectedValue(new Error('boom'));
    const { container } = await renderTransactions();

    change(byPlaceholder(container, 'DD/MM/YYYY'), '16/03/2026');
    change(byPlaceholder(container, 'Third party (recipient/sender)'), 'Bakery');
    change(byPlaceholder(container, 'Description (optional)'), 'Bread');
    change(byPlaceholder(container, 'Comment'), 'Keep this comment');
    change(selectByClass(container, 'payment-method-select'), '100');
    change(byPlaceholder(container, 'Amount'), '4.5');
    change(selectByClass(container, 'category-select'), '20');
    submit(container.querySelector('form.transaction-form')!);
    await flush();

    expect(byPlaceholder(container, 'DD/MM/YYYY').value).toBe('16/03/2026');
    expect(byPlaceholder(container, 'Third party (recipient/sender)').value).toBe('Bakery');
    expect(byPlaceholder(container, 'Description (optional)').value).toBe('Bread');
    expect(byPlaceholder(container, 'Comment').value).toBe('Keep this comment');
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

function click(container: HTMLElement, selector: string) {
  const button = container.querySelector<HTMLButtonElement>(selector);
  if (!button) throw new Error(`Missing button ${selector}`);
  act(() => button.click());
}

describe('transaction mutation contracts', () => {
  it('saves ordinary fields without changing accounting and cancels without writing', async () => {
    const onChanged = vi.fn();
    const { container } = await renderTransactions([transaction()], [], onChanged);
    click(container, '.btn-icon.edit');
    change(
      Array.from(container.querySelectorAll<HTMLInputElement>('input.edit-input')).find(
        (input) => input.value === 'Existing purchase'
      )!,
      '  Updated purchase  '
    );
    click(container, '.btn-icon.save');
    await flush();
    expect(mockedApi.updateTransaction).toHaveBeenCalledWith(1, {
      itemId: 20,
      date: '2026-02-03',
      description: 'Updated purchase',
      comment: '',
      thirdParty: 'Market',
      paymentMethodId: 100,
      amount: 12.5,
    });
    expect(onChanged).toHaveBeenCalledOnce();
    click(container, '.btn-icon.edit');
    click(container, '.btn-icon.cancel');
    expect(mockedApi.updateTransaction).toHaveBeenCalledOnce();
  });

  it('recalculates after a date change unless accounting is explicitly overridden', async () => {
    const { container } = await renderTransactions();
    click(container, '.btn-icon.edit');
    change(container.querySelector('input.edit-input[placeholder="DD/MM/YYYY"]')!, '24/02/2026');
    click(container, '.btn-icon.save');
    await flush();
    expect(mockedApi.updateTransaction.mock.calls[0][1]).toMatchObject({ recalculateAccounting: true });
    click(container, '.btn-icon.edit');
    change(container.querySelector('input.edit-input[placeholder="DD/MM/YYYY"]')!, '24/02/2026');
    change(container.querySelector('select.accounting-month-select')!, '4');
    click(container, '.btn-icon.save');
    await flush();
    expect(mockedApi.updateTransaction.mock.calls[1][1]).toMatchObject({ accountingMonth: 4, accountingYear: 2026 });
    expect(mockedApi.updateTransaction.mock.calls[1][1]).not.toHaveProperty('recalculateAccounting');
    click(container, '.btn-icon.edit');
    change(container.querySelector('tbody select.edit-select:not(.accounting-month-select)')!, '101');
    click(container, '.btn-icon.save');
    await flush();
    expect(mockedApi.updateTransaction.mock.calls[2][1]).toMatchObject({
      paymentMethodId: 101,
      recalculateAccounting: true,
    });
  });

  it('requires confirmation for single and bulk deletion and refreshes after success', async () => {
    const onChanged = vi.fn();
    const { container } = await renderTransactions([transaction({ id: 1 }), transaction({ id: 2 })], [], onChanged);
    click(container, '.btn-icon.delete');
    click(container, '.confirm-dialog-btn.cancel');
    await flush();
    expect(mockedApi.deleteTransaction).not.toHaveBeenCalled();
    click(container, '.btn-icon.delete');
    click(container, '.confirm-dialog-btn.confirm');
    await flush();
    expect(mockedApi.deleteTransaction).toHaveBeenCalledWith(2);
    click(container, 'thead input[type="checkbox"]');
    click(container, '.transactions-actions .btn-danger');
    click(container, '.confirm-dialog-btn.confirm');
    await flush();
    expect(mockedApi.bulkDeleteTransactions).toHaveBeenCalledWith([2, 1]);
    expect(mockedApi.deleteTransfer).not.toHaveBeenCalled();
    expect(onChanged).toHaveBeenCalledTimes(2);
  });

  it('uses stored priorities only when server priority is absent', async () => {
    localStorage.setItem('tallix_transaction_sort_priorities:77', JSON.stringify({ 1: 9, 2: 20, 3: 10 }));
    const { container } = await renderTransactions([
      transaction({ id: 1, description: 'Fallback', sortPriority: null }),
      transaction({ id: 2, description: 'Server', sortPriority: 1 }),
      transaction({ id: 3, description: 'Zero server', sortPriority: 0 }),
    ]);
    expect(Array.from(container.querySelectorAll('tbody .description-cell')).map((cell) => cell.textContent)).toEqual([
      'Fallback',
      'Server',
      'Zero server',
    ]);
  });

  it('reorders all same-date transactions including filtered records and retains order after reload', async () => {
    const rows = [
      transaction({ id: 1, description: 'Visible one' }),
      transaction({ id: 2, description: 'Hidden two' }),
      transaction({ id: 3, description: 'Visible three' }),
    ];
    const { container } = await renderTransactions(rows, [transfer({ id: 99, date: '2026-02-03' })]);
    const descriptionFilter = container.querySelector<HTMLInputElement>('.filter-row th:nth-child(6) input')!;
    change(descriptionFilter, 'Visible');
    click(container, 'tbody tr:last-child .reorder');
    await flush();
    expect(mockedApi.reorderTransactionEntries).toHaveBeenCalledWith([
      { type: 'transaction', id: 3, sortPriority: 3 },
      { type: 'transaction', id: 2, sortPriority: 1 },
      { type: 'transaction', id: 1, sortPriority: 2 },
    ]);
    click(container, '.btn-clear-filters');
    expect(Array.from(container.querySelectorAll('tbody .description-cell')).map((cell) => cell.textContent)).toEqual([
      'Visible three',
      'Visible one',
      'Hidden two',
    ]);
    click(container, '.btn-icon.edit');
    click(container, '.btn-icon.save');
    await flush();
    expect(Array.from(container.querySelectorAll('tbody .description-cell')).map((cell) => cell.textContent)).toEqual([
      'Visible three',
      'Visible one',
      'Hidden two',
    ]);
  });
});

function handler(element: Element, name: string): (...args: unknown[]) => void {
  const propsKey = Object.keys(element).find((key) => key.startsWith('__reactProps$'));
  if (!propsKey) throw new Error('Missing React event props');
  return (element as unknown as Record<string, Record<string, (...args: unknown[]) => void>>)[propsKey][name];
}

describe('transaction domain and role boundaries', () => {
  it('loads transaction data only and excludes transfer rows, controls and summaries', async () => {
    const { container } = await renderTransactions([transaction()], [transfer()]);
    expect(mockedApi.fetchTransfers).not.toHaveBeenCalled();
    expect(mockedApi.fetchTransferAccounts).not.toHaveBeenCalled();
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(container.textContent).not.toContain('Move to savings');
    expect(container.querySelector('.form-type-toggle')).toBeNull();
    expect(container.querySelector('.account-select')).toBeNull();
    expect(container.querySelector('option[value="section:transfer"]')).toBeNull();
    expect(container.querySelector('.summary-item.savings')).toBeNull();
    expect(container.querySelector('.btn-import')).not.toBeNull();
  });

  it('allows read-only filtering while disabling every mutation control', async () => {
    const { container } = await renderTransactions(
      [transaction({ warning: 'potential_duplicate' })],
      [],
      vi.fn(),
      true
    );
    expect(container.querySelector('.transaction-form')).toBeNull();
    expect(container.querySelector('.btn-import, .edit, .delete, .dismiss-warning')).toBeNull();
    expect(
      Array.from(container.querySelectorAll<HTMLInputElement>('.col-select input, tbody td:first-child input')).every(
        (input) => input.disabled
      )
    ).toBe(true);
    expect(
      Array.from(container.querySelectorAll<HTMLButtonElement>('button.reorder')).every((button) => button.disabled)
    ).toBe(true);
    change(container.querySelector('input.comment-filter')!, 'no match');
    expect(container.textContent).toContain('No transactions match the filters');
    expect(mockedApi.updateTransaction).not.toHaveBeenCalled();
    expect(mockedApi.deleteTransaction).not.toHaveBeenCalled();
  });

  it('revokes stale create, edit, warning, reorder and selection handlers on a role change', async () => {
    const { container, setReadOnly } = await renderTransactions([
      transaction({ warning: 'potential_duplicate' }),
      transaction({ id: 2 }),
    ]);
    change(byPlaceholder(container, 'DD/MM/YYYY'), '03/02/2026');
    change(byPlaceholder(container, 'Amount'), '20');
    change(selectByClass(container, 'category-select'), '20');
    change(selectByClass(container, 'payment-method-select'), '100');
    const create = handler(container.querySelector('form')!, 'onSubmit');
    const reorder = handler(container.querySelector('.reorder')!, 'onClick');
    const importTransactions = handler(container.querySelector('.btn-import')!, 'onClick');
    const warning = handler(container.querySelector('.dismiss-warning')!, 'onClick');
    const select = handler(container.querySelector('tbody input[type="checkbox"]')!, 'onChange');
    click(container, 'tbody input[type="checkbox"]');
    click(container, '.btn-icon.edit');
    const save = handler(container.querySelector('.btn-icon.save')!, 'onClick');
    setReadOnly(true);
    expect(container.querySelector('.editing-row, .bulk-order-actions, .transaction-form')).toBeNull();
    act(() => {
      create({ preventDefault: vi.fn() });
      reorder();
      importTransactions();
      warning();
      select();
      save();
    });
    await flush();
    expect(mockedApi.createTransaction).not.toHaveBeenCalled();
    expect(mockedApi.updateTransaction).not.toHaveBeenCalled();
    expect(mockedApi.dismissTransactionWarning).not.toHaveBeenCalled();
    expect(mockedApi.reorderTransactionEntries).not.toHaveBeenCalled();
    expect(container.querySelector('tbody tr.selected')).toBeNull();
  });

  it.each(['single', 'bulk'])('blocks a pending %s delete confirmation after write access is revoked', async (kind) => {
    const { container, setReadOnly } = await renderTransactions();
    if (kind === 'bulk') {
      click(container, 'thead input[type="checkbox"]');
      click(container, '.transactions-actions .btn-danger');
    } else click(container, '.btn-icon.delete');
    expect(container.querySelector('.confirm-dialog')).not.toBeNull();
    setReadOnly(true);
    click(container, '.confirm-dialog-btn.confirm');
    await flush();
    expect(mockedApi.deleteTransaction).not.toHaveBeenCalled();
    expect(mockedApi.bulkDeleteTransactions).not.toHaveBeenCalled();
  });

  it('does not reorder across dates or while an edit is open', async () => {
    const { container } = await renderTransactions([
      transaction({ id: 1, date: '2026-02-03' }),
      transaction({ id: 2, date: '2026-02-04' }),
    ]);
    click(container, 'tbody .reorder');
    await flush();
    expect(mockedApi.reorderTransactionEntries).not.toHaveBeenCalled();
    click(container, 'thead input[type="checkbox"]');
    expect(container.querySelector('.bulk-order-actions')).toBeNull();
    click(container, '.btn-icon.edit');
    expect(
      Array.from(container.querySelectorAll<HTMLButtonElement>('.reorder')).every((button) => button.disabled)
    ).toBe(true);
  });
});
