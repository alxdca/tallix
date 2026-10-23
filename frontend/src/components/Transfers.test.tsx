import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaymentMethod, Transaction, Transfer } from '../api';
import * as api from '../api';
import { I18nProvider } from '../contexts/I18nContext';
import { SettingsProvider } from '../contexts/SettingsContext';
import Transfers from './Transfers';

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

async function renderTransfers(
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

  await act(async () => {
    root = createRoot(container);
    mountedRoots.push(root);
    root.render(
      <I18nProvider>
        <SettingsProvider>
          <Transfers year={2026} yearId={77} onTransactionsChanged={onTransactionsChanged} readOnly={readOnly} />
        </SettingsProvider>
      </I18nProvider>
    );
  });

  await flush();

  return {
    container,
    root: root!,
    setReadOnly: async (value: boolean) => {
      await act(async () => {
        root.render(
          <I18nProvider>
            <SettingsProvider>
              <Transfers year={2026} yearId={77} onTransactionsChanged={onTransactionsChanged} readOnly={value} />
            </SettingsProvider>
          </I18nProvider>
        );
      });
    },
  };
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

function setPaymentMethodFilter(container: HTMLElement, labelText: string) {
  const option = Array.from(container.querySelectorAll<HTMLLabelElement>('.multi-select-option')).find((label) =>
    label.textContent?.includes(labelText)
  );
  const checkbox = option?.querySelector<HTMLInputElement>('input[type="checkbox"]');
  if (!checkbox) throw new Error(`Missing payment method filter ${labelText}`);
  act(() => {
    checkbox.click();
  });
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

describe('transfer filters', () => {
  it('counts savings only in the savings side accounting period', async () => {
    const { container } = await renderTransfers(
      [],
      [
        transfer({
          date: '2026-08-24',
          accountingMonth: 9,
          accountingYear: 2026,
          sourceAccountingMonth: 9,
          sourceAccountingYear: 2026,
          destinationAccountingMonth: 8,
          destinationAccountingYear: 2026,
        }),
      ]
    );
    const accountingFilter = selectByClass(container, 'accounting-period-filter');
    change(accountingFilter, '2026-8');
    expect(container.querySelector('.summary-item.savings')).not.toBeNull();
    change(accountingFilter, '2026-9');
    expect(container.querySelectorAll('.transactions-table tbody tr')).toHaveLength(1);
    expect(container.querySelector('.summary-item.savings')).toBeNull();
  });

  it('matches a split-period transfer from either accounting side without duplicating the row', async () => {
    const { container } = await renderTransfers(
      [],
      [
        transfer({
          id: 11,
          date: '2026-08-24',
          description: 'Revolut top-up',
          sourceAccount: transferAccounts[1],
          destinationAccount: transferAccounts[0],
          accountingMonth: 9,
          accountingYear: 2026,
          sourceAccountingMonth: 9,
          sourceAccountingYear: 2026,
          destinationAccountingMonth: 8,
          destinationAccountingYear: 2026,
        }),
      ]
    );

    expect(container.textContent).toContain('September 2026 → August 2026');

    const accountingFilter = selectByClass(container, 'accounting-period-filter');
    expect(Array.from(accountingFilter.options).map((option) => option.value)).toEqual(['', '2026-8', '2026-9']);

    change(accountingFilter, '2026-8');
    expect(container.querySelectorAll('.transactions-table tbody tr')).toHaveLength(1);
    expect(container.textContent).toContain('Revolut top-up');

    change(accountingFilter, '2026-9');
    expect(container.querySelectorAll('.transactions-table tbody tr')).toHaveLength(1);
    expect(container.textContent).toContain('Revolut top-up');
  });

  it('correlates accounting month and payment method filters to the same transfer side', async () => {
    const { container } = await renderTransfers(
      [],
      [
        transfer({
          id: 12,
          date: '2026-08-24',
          description: 'Cembra to Revolut',
          sourceAccount: transferAccounts[1],
          destinationAccount: transferAccounts[0],
          accountingMonth: 9,
          accountingYear: 2026,
          sourceAccountingMonth: 9,
          sourceAccountingYear: 2026,
          destinationAccountingMonth: 8,
          destinationAccountingYear: 2026,
        }),
      ]
    );

    const accountingFilter = selectByClass(container, 'accounting-period-filter');
    setPaymentMethodFilter(container, 'Credit Card');
    change(accountingFilter, '2026-9');
    expect(container.querySelectorAll('.transactions-table tbody tr')).toHaveLength(1);
    expect(container.textContent).toContain('Cembra to Revolut');

    act(() => {
      container.querySelector<HTMLButtonElement>('.btn-clear-filters')!.click();
    });
    await flush();
    setPaymentMethodFilter(container, 'Checking (Bank)');
    change(accountingFilter, '2026-9');
    expect(container.querySelectorAll('.transactions-table tbody tr')).toHaveLength(0);
    expect(container.textContent).not.toContain('Cembra to Revolut');

    act(() => {
      container.querySelector<HTMLButtonElement>('.btn-link')!.click();
    });
    await flush();
    setPaymentMethodFilter(container, 'Checking (Bank)');
    change(selectByClass(container, 'accounting-period-filter'), '2026-8');
    expect(container.querySelectorAll('.transactions-table tbody tr')).toHaveLength(1);
    expect(container.textContent).toContain('Cembra to Revolut');
  });
});

describe('transfer account selectors', () => {
  it.each([
    ['new', 'en', ['Checking', 'Savings', 'Investments']],
    ['edit', 'en', ['Checking', 'Savings', 'Investments']],
    ['new', 'fr', ['Comptes courants', 'Épargne', 'Investissements']],
    ['edit', 'fr', ['Comptes courants', 'Épargne', 'Investissements']],
  ])('groups and alphabetizes both %s transfer selectors in %s', async (mode, locale, labels) => {
    localStorage.setItem('tallix_locale', locale);
    const methods: PaymentMethod[] = [
      { ...paymentMethods[2], id: 301, name: 'Zulu investment', savingsType: 'investissements' },
      { ...paymentMethods[0], id: 101, name: 'Zulu checking' },
      { ...paymentMethods[2], id: 201, name: 'Zulu savings', savingsType: null },
      { ...paymentMethods[2], id: 300, name: 'alpha investment', savingsType: 'investissements' },
      { ...paymentMethods[2], id: 203, name: 'Pension', savingsType: 'prevoyance' },
      { ...paymentMethods[0], id: 100, name: 'alpha checking' },
      { ...paymentMethods[2], id: 200, name: 'Épargne', savingsType: 'epargne' },
    ];
    // The transfer endpoint supplies eligible accounts; the payment methods supply their savings types.
    const accounts = methods.map(({ id, name, institution, isSavingsAccount }) => ({
      id,
      name,
      institution,
      isSavingsAccount,
    }));
    mockedApi.fetchPaymentMethods.mockResolvedValueOnce([
      ...methods,
      { ...paymentMethods[0], id: 400, name: 'Linked card', linkedPaymentMethodId: 100 },
    ]);
    mockedApi.fetchTransferAccounts.mockResolvedValueOnce(accounts);
    const { container } = await renderTransfers([], mode === 'edit' ? [transfer()] : []);

    act(() => {
      if (mode === 'edit') {
        container.querySelector<HTMLButtonElement>('button.btn-icon.edit')!.click();
      }
    });

    const selects = container.querySelectorAll<HTMLSelectElement>(
      mode === 'edit' ? '.transfer-edit-accounts select' : 'select.account-select'
    );
    expect(selects).toHaveLength(2);
    for (const select of selects) {
      expect(Array.from(select.querySelectorAll('optgroup'), (group) => group.label)).toEqual(labels);
      expect(Array.from(select.options, (option) => option.value)).toEqual([
        '',
        '100',
        '101',
        '200',
        '203',
        '201',
        '300',
        '301',
      ]);
      expect(select.querySelector('option[value="100"]')?.textContent).toBe('alpha checking (Bank)');
    }
  });
});

describe('new transfer form', () => {
  it.each([
    ['24/08/2026', '2026-08-24', 9, 2026, 8],
    ['20/08/2026', '2026-08-20', 9, 2026, 8],
    ['24/12/2026', '2026-12-24', 1, 2027, 12],
  ])('uses each account cutoff when creating a transfer on %s', async (displayDate, isoDate, sourceMonth, sourceYear, destinationMonth) => {
    mockedApi.fetchPaymentMethods.mockResolvedValueOnce(
      paymentMethods.map((method) => ({
        ...method,
        settlementDay: method.id === 101 ? 20 : null,
      }))
    );
    mockedApi.createTransfer.mockResolvedValue(transfer({ id: 99 }));
    const { container } = await renderTransfers([], []);
    change(byPlaceholder(container, 'DD/MM/YYYY'), displayDate);
    const accountSelects = container.querySelectorAll<HTMLSelectElement>('select.account-select');
    change(accountSelects[0], '101');
    change(accountSelects[1], '100');
    change(byPlaceholder(container, 'Amount'), '200');
    expect(container.querySelector<HTMLSelectElement>('select[aria-label="Source accounting month"]')!.value).toBe(
      String(sourceMonth)
    );
    expect(container.querySelector<HTMLSelectElement>('select[aria-label="Destination accounting month"]')!.value).toBe(
      String(destinationMonth)
    );
    submit(container.querySelector('form.transaction-form')!);
    await flush();
    expect(mockedApi.createTransfer).toHaveBeenCalledWith(
      2026,
      expect.objectContaining({
        date: isoDate,
        amount: 200,
        sourceAccountId: 101,
        destinationAccountId: 100,
        sourceAccountingMonth: sourceMonth,
        sourceAccountingYear: sourceYear,
        destinationAccountingMonth: destinationMonth,
        destinationAccountingYear: 2026,
      })
    );
  });

  it('creates a transfer and resets transfer-only fields after success', async () => {
    mockedApi.createTransfer.mockResolvedValue(transfer({ id: 99 }));
    const { container } = await renderTransfers();

    expect(container.querySelector('input[placeholder="Comment"]')).toBeNull();
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
      sourceAccountingMonth: 3,
      sourceAccountingYear: 2026,
      destinationAccountingMonth: 3,
      destinationAccountingYear: 2026,
    });
    expect(byPlaceholder(container, 'DD/MM/YYYY').value).toBe('17/03/2026');
    expect(accountSelects[0].value).toBe('');
    expect(accountSelects[1].value).toBe('');
    expect(byPlaceholder(container, 'Description (optional)').value).toBe('');
    expect(byPlaceholder(container, 'Amount').value).toBe('');
  });
});

describe('transfer editing', () => {
  it('saves a manual destination accounting period without changing the source period', async () => {
    mockedApi.updateTransfer.mockResolvedValue(
      transfer({
        id: 7,
        date: '2026-08-24',
        description: 'Revolut top-up',
        sourceAccount: transferAccounts[1],
        destinationAccount: transferAccounts[0],
        accountingMonth: 9,
        accountingYear: 2026,
        sourceAccountingMonth: 9,
        sourceAccountingYear: 2026,
        destinationAccountingMonth: 8,
        destinationAccountingYear: 2026,
      })
    );
    const { container } = await renderTransfers(
      [],
      [
        transfer({
          id: 7,
          date: '2026-08-24',
          description: 'Revolut top-up',
          sourceAccount: transferAccounts[1],
          destinationAccount: transferAccounts[0],
          accountingMonth: 9,
          accountingYear: 2026,
          sourceAccountingMonth: 9,
          sourceAccountingYear: 2026,
          destinationAccountingMonth: 9,
          destinationAccountingYear: 2026,
        }),
      ]
    );

    act(() => {
      container.querySelector<HTMLButtonElement>('button.btn-icon.edit')!.click();
    });

    change(
      container.querySelector<HTMLSelectElement>(
        '.transactions-table select[aria-label="Destination accounting month"]'
      )!,
      '8'
    );
    act(() => {
      container.querySelector<HTMLButtonElement>('button.btn-icon.save')!.click();
    });
    await flush();

    expect(mockedApi.updateTransfer).toHaveBeenCalledWith(7, {
      date: '2026-08-24',
      amount: 50,
      description: 'Revolut top-up',
      sourceAccountId: 101,
      destinationAccountId: 100,
      destinationAccountingMonth: 8,
      destinationAccountingYear: 2026,
    });
  });

  it('does not send accounting periods when only ordinary transfer fields change', async () => {
    mockedApi.updateTransfer.mockResolvedValue(transfer({ id: 8, description: 'Renamed transfer' }));
    const { container } = await renderTransfers(
      [],
      [
        transfer({
          id: 8,
          description: 'Original transfer',
          sourceAccountingMonth: 2,
          sourceAccountingYear: 2026,
          destinationAccountingMonth: 2,
          destinationAccountingYear: 2026,
        }),
      ]
    );

    act(() => {
      container.querySelector<HTMLButtonElement>('button.btn-icon.edit')!.click();
    });
    const descriptionInput = Array.from(container.querySelectorAll<HTMLInputElement>('input.edit-input')).find(
      (input) => input.value === 'Original transfer'
    );
    if (!descriptionInput) throw new Error('Missing transfer description input');
    change(descriptionInput, 'Renamed transfer');
    act(() => {
      container.querySelector<HTMLButtonElement>('button.btn-icon.save')!.click();
    });
    await flush();

    expect(mockedApi.updateTransfer).toHaveBeenCalledWith(8, {
      date: '2026-02-04',
      amount: 50,
      description: 'Renamed transfer',
      sourceAccountId: 100,
      destinationAccountId: 200,
    });
  });
});

describe('transfer page isolation and mutations', () => {
  it('loads only transfers and their account metadata with transfer-specific columns and summaries', async () => {
    const { container } = await renderTransfers([transaction({ description: 'Hidden purchase' })], [transfer()]);
    expect(mockedApi.fetchTransactions).not.toHaveBeenCalled();
    expect(mockedApi.fetchTransfers).toHaveBeenCalledWith(2026);
    expect(container.textContent).not.toContain('Hidden purchase');
    expect(container.querySelector('.form-type-toggle')).toBeNull();
    expect(container.querySelector('.btn-import')).toBeNull();
    expect(container.querySelector('.category-select')).toBeNull();
    expect(container.querySelector('.third-party-input')).toBeNull();
    expect(container.querySelector('.comment-input')).toBeNull();
    expect(container.querySelector('.summary-item.income')).toBeNull();
    expect(container.querySelector('.summary-item.expense')).toBeNull();
    expect(container.querySelector('.summary-item.balance')).toBeNull();
    expect(container.querySelector('.summary-item.count .summary-value')?.textContent).toBe('1 / 1');
    expect(container.querySelector('.summary-item.moved .summary-value')?.textContent).toContain('50.00');
    const headers = container.querySelector('.header-row')?.textContent;
    expect(headers).toContain('Source account');
    expect(headers).toContain('Destination account');
    expect(headers).not.toContain('Category');
    expect(headers).not.toContain('Comment');
  });

  it('keeps empty and unmatched filters editable and clears them', async () => {
    const { container } = await renderTransfers([], [transfer()]);
    const input = container.querySelector<HTMLInputElement>('.description-filter')!;
    act(() => input.focus());
    change(input, 'unmatched');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(0);
    expect(document.activeElement).toBe(input);
    expect(container.querySelector('.description-filter')).toBe(input);
    expect(container.querySelector('.filter-row')).not.toBeNull();
    act(() => container.querySelector<HTMLButtonElement>('.btn-link')!.click());
    expect(input.value).toBe('');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
    change(container.querySelector('.source-filter')!, 'CHECKING');
    change(container.querySelector('.destination-filter')!, 'SAVINGS');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
    change(container.querySelector('.destination-filter')!, 'Checking');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(0);
  });

  it('retains the transfer draft on failure and releases the pending guard for retry', async () => {
    const pending = deferred<Transfer>();
    mockedApi.createTransfer.mockReturnValueOnce(pending.promise).mockResolvedValueOnce(transfer());
    const { container } = await renderTransfers([], [transfer(), transfer({ id: 2 })]);
    change(byPlaceholder(container, 'DD/MM/YYYY'), '17/03/2026');
    const selects = container.querySelectorAll<HTMLSelectElement>('.account-select');
    change(selects[0], '100');
    change(selects[1], '200');
    change(byPlaceholder(container, 'Description (optional)'), 'Keep draft');
    change(byPlaceholder(container, 'Amount'), '75');
    const form = container.querySelector<HTMLFormElement>('form.transaction-form')!;
    submit(form);
    submit(form);
    expect(mockedApi.createTransfer).toHaveBeenCalledTimes(1);
    expect(container.querySelector<HTMLButtonElement>('.reorder')?.disabled).toBe(true);
    await act(async () => pending.reject(new Error('failed')));
    expect(byPlaceholder(container, 'Description (optional)').value).toBe('Keep draft');
    expect(byPlaceholder(container, 'Amount').value).toBe('75');
    expect(selects[0].value).toBe('100');
    expect(selects[1].value).toBe('200');
    expect(container.querySelector<HTMLButtonElement>('.reorder')?.disabled).toBe(false);
    submit(form);
    await flush();
    expect(mockedApi.createTransfer).toHaveBeenCalledTimes(2);
    expect(mockedApi.createTransaction).not.toHaveBeenCalled();
  });

  it('keeps a manual create destination period while recalculating the source after a date change', async () => {
    mockedApi.createTransfer.mockResolvedValue(transfer());
    const { container } = await renderTransfers([], []);
    change(byPlaceholder(container, 'DD/MM/YYYY'), '24/08/2026');
    const selects = container.querySelectorAll<HTMLSelectElement>('.account-select');
    change(selects[0], '101');
    change(selects[1], '100');
    change(container.querySelector('select[aria-label="Destination accounting month"]')!, '7');
    change(byPlaceholder(container, 'DD/MM/YYYY'), '24/12/2026');
    change(byPlaceholder(container, 'Amount'), '80');
    submit(container.querySelector<HTMLFormElement>('form.transaction-form')!);
    await flush();
    expect(mockedApi.createTransfer).toHaveBeenCalledWith(
      2026,
      expect.objectContaining({
        sourceAccountingMonth: 1,
        sourceAccountingYear: 2027,
        destinationAccountingMonth: 7,
        destinationAccountingYear: 2026,
      })
    );
  });

  it('retains edits after failure and allows cancellation without another mutation', async () => {
    mockedApi.updateTransfer.mockRejectedValueOnce(new Error('failed'));
    const { container } = await renderTransfers([], [transfer()]);
    act(() => container.querySelector<HTMLButtonElement>('.btn-icon.edit')!.click());
    const input = container.querySelector<HTMLInputElement>('tbody input.edit-input:not(.date-input)[placeholder]')!;
    change(input, 'Retained edit');
    expect(container.querySelector<HTMLButtonElement>('.reorder')).toBeNull();
    act(() => container.querySelector<HTMLButtonElement>('.btn-icon.save')!.click());
    await flush();
    expect(input.value).toBe('Retained edit');
    expect(container.querySelector('.btn-icon.save')).not.toBeNull();
    act(() => container.querySelector<HTMLButtonElement>('.btn-icon.cancel')!.click());
    expect(container.querySelector('.btn-icon.save')).toBeNull();
    expect(mockedApi.updateTransfer).toHaveBeenCalledTimes(1);
    expect(mockedApi.updateTransaction).not.toHaveBeenCalled();
  });

  it('confirms single delete and reloads only transfers after success', async () => {
    const changed = vi.fn();
    mockedApi.deleteTransfer.mockResolvedValue();
    const { container } = await renderTransfers([], [transfer({ id: 9 })], changed);
    act(() => container.querySelector<HTMLButtonElement>('.btn-icon.delete')!.click());
    expect(mockedApi.deleteTransfer).not.toHaveBeenCalled();
    act(() => container.querySelector<HTMLButtonElement>('.confirm-dialog-btn.cancel')!.click());
    expect(mockedApi.deleteTransfer).not.toHaveBeenCalled();
    act(() => container.querySelector<HTMLButtonElement>('.btn-icon.delete')!.click());
    mockedApi.fetchTransfers.mockResolvedValue([]);
    act(() => container.querySelector<HTMLButtonElement>('.confirm-dialog-btn.confirm')!.click());
    await flush();
    expect(mockedApi.deleteTransfer).toHaveBeenCalledTimes(1);
    expect(mockedApi.deleteTransfer).toHaveBeenCalledWith(9);
    expect(mockedApi.deleteTransaction).not.toHaveBeenCalled();
    expect(mockedApi.fetchTransactions).not.toHaveBeenCalled();
    expect(container.querySelectorAll('tbody tr')).toHaveLength(0);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it('deletes selected transfers only after confirmation', async () => {
    mockedApi.deleteTransfer.mockResolvedValue();
    const { container } = await renderTransfers([transaction({ id: 100 })], [transfer({ id: 7 }), transfer({ id: 8 })]);
    act(() => container.querySelector<HTMLInputElement>('.header-row input[type="checkbox"]')!.click());
    act(() => container.querySelector<HTMLButtonElement>('.btn-danger')!.click());
    expect(mockedApi.deleteTransfer).not.toHaveBeenCalled();
    act(() => container.querySelector<HTMLButtonElement>('.confirm-dialog-btn.confirm')!.click());
    await flush();
    expect(mockedApi.deleteTransfer.mock.calls).toEqual([[7], [8]]);
    expect(mockedApi.bulkDeleteTransactions).not.toHaveBeenCalled();
    expect(container.querySelector('.btn-danger')).toBeNull();
  });

  it('permits read-only filtering while preventing all mutation and selection controls', async () => {
    const { container } = await renderTransfers([], [transfer()], vi.fn(), true);
    expect(container.querySelector('form')).toBeNull();
    expect(container.querySelector('.btn-icon.edit')).toBeNull();
    expect(container.querySelector('.btn-icon.delete')).toBeNull();
    expect(
      [
        ...container.querySelectorAll<HTMLInputElement>(
          'tbody input[type="checkbox"], .header-row input[type="checkbox"]'
        ),
      ].every((input) => input.disabled)
    ).toBe(true);
    expect([...container.querySelectorAll<HTMLButtonElement>('.reorder')].every((button) => button.disabled)).toBe(
      true
    );
    change(container.querySelector('.description-filter')!, 'unmatched');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(0);
    expect(mockedApi.createTransfer).not.toHaveBeenCalled();
    expect(mockedApi.updateTransfer).not.toHaveBeenCalled();
    expect(mockedApi.deleteTransfer).not.toHaveBeenCalled();
    expect(mockedApi.reorderTransactionEntries).not.toHaveBeenCalled();
  });

  it('clears edits and selections on write-to-read transition and blocks a pending bulk confirmation', async () => {
    const { container, setReadOnly } = await renderTransfers([], [transfer(), transfer({ id: 2 })]);
    act(() => container.querySelector<HTMLInputElement>('.header-row input[type="checkbox"]')!.click());
    act(() => container.querySelector<HTMLButtonElement>('.btn-danger')!.click());
    await setReadOnly(true);
    act(() => container.querySelector<HTMLButtonElement>('.confirm-dialog-btn.confirm')!.click());
    await flush();
    expect(mockedApi.deleteTransfer).not.toHaveBeenCalled();
    expect(container.querySelector('.btn-danger')).toBeNull();
    expect(container.querySelector('.bulk-order-actions')).toBeNull();
    await setReadOnly(false);
    act(() => container.querySelector<HTMLButtonElement>('.btn-icon.edit')!.click());
    expect(container.querySelector('.editing-row')).not.toBeNull();
    await setReadOnly(true);
    expect(container.querySelector('.btn-icon.save')).toBeNull();
    expect(container.querySelector('.editing-row')).toBeNull();
    expect(mockedApi.updateTransfer).not.toHaveBeenCalled();
  });

  it('blocks a pending single delete confirmation when the role becomes read-only', async () => {
    const { container, setReadOnly } = await renderTransfers([], [transfer()]);
    act(() => container.querySelector<HTMLButtonElement>('.btn-icon.delete')!.click());
    await setReadOnly(true);
    act(() => container.querySelector<HTMLButtonElement>('.confirm-dialog-btn.confirm')!.click());
    await flush();
    expect(mockedApi.deleteTransfer).not.toHaveBeenCalled();
  });
});

describe('transfer ordering', () => {
  it('reorders the full same-date transfer domain including filtered rows and keeps order after reload', async () => {
    let serverEntries = [
      transfer({ id: 1, description: 'First' }),
      transfer({ id: 2, description: 'Hidden' }),
      transfer({ id: 3, description: 'Last' }),
    ];
    const { container } = await renderTransfers([transaction({ id: 44 })], serverEntries);
    mockedApi.reorderTransactionEntries.mockImplementation(async (updates) => {
      serverEntries = serverEntries.map((entry) => ({
        ...entry,
        sortPriority: updates.find((update) => update.id === entry.id)?.sortPriority ?? entry.sortPriority,
      }));
    });
    change(container.querySelector('.description-filter')!, 'Last');
    act(() => container.querySelector<HTMLButtonElement>('button.reorder[title="Move up"]')!.click());
    await flush();
    expect(mockedApi.reorderTransactionEntries).toHaveBeenCalledWith([
      { type: 'transfer', id: 1, sortPriority: 3 },
      { type: 'transfer', id: 2, sortPriority: 1 },
      { type: 'transfer', id: 3, sortPriority: 2 },
    ]);
    act(() => container.querySelector<HTMLButtonElement>('.btn-clear-filters')!.click());
    expect([...container.querySelectorAll('tbody .description-cell')].map((cell) => cell.textContent)).toEqual([
      'First',
      'Last',
      'Hidden',
    ]);
    const reloaded = await renderTransfers([], serverEntries);
    expect([...reloaded.container.querySelectorAll('tbody .description-cell')].map((cell) => cell.textContent)).toEqual(
      ['First', 'Last', 'Hidden']
    );
  });

  it('restricts selection ordering to one date and blocks reorder while editing or pending', async () => {
    const { container } = await renderTransfers(
      [],
      [transfer({ id: 1 }), transfer({ id: 2 }), transfer({ id: 3, date: '2026-02-03' })]
    );
    act(() => container.querySelector<HTMLInputElement>('.header-row input[type="checkbox"]')!.click());
    expect(container.querySelector('.bulk-order-actions')).toBeNull();
    act(() => container.querySelector<HTMLInputElement>('.header-row input[type="checkbox"]')!.click());
    act(() => container.querySelector<HTMLInputElement>('tbody input[type="checkbox"]')!.click());
    expect(container.querySelector('.bulk-order-actions')).not.toBeNull();
    act(() => container.querySelector<HTMLButtonElement>('.btn-icon.edit')!.click());
    expect(container.querySelector('.bulk-order-actions')).toBeNull();
    expect([...container.querySelectorAll<HTMLButtonElement>('.reorder')].every((button) => button.disabled)).toBe(
      true
    );
    act(() => container.querySelector<HTMLButtonElement>('.btn-icon.cancel')!.click());
    const pending = deferred<void>();
    mockedApi.reorderTransactionEntries.mockReturnValueOnce(pending.promise);
    act(() => container.querySelector<HTMLButtonElement>('button.reorder[title="Move down"]')!.click());
    expect([...container.querySelectorAll<HTMLButtonElement>('.reorder')].every((button) => button.disabled)).toBe(
      true
    );
    expect(
      mockedApi.reorderTransactionEntries.mock.calls[0][0].every((entry) => entry.type === 'transfer' && entry.id !== 3)
    ).toBe(true);
    await act(async () => pending.resolve());
  });
});

describe('transfer edit accounting contracts', () => {
  it('preserves an explicit destination period after changing its account and date', async () => {
    mockedApi.updateTransfer.mockResolvedValue(transfer());
    const { container } = await renderTransfers(
      [],
      [transfer({ sourceAccount: transferAccounts[1], destinationAccount: transferAccounts[0] })]
    );
    act(() => container.querySelector<HTMLButtonElement>('.btn-icon.edit')!.click());
    change(container.querySelector('tbody select[aria-label="Destination accounting month"]')!, '12');
    change(container.querySelector('tbody select[aria-label="Destination account"]')!, '200');
    change(container.querySelector('tbody input.date-input')!, '24/08/2026');
    expect(
      container.querySelector<HTMLSelectElement>('tbody select[aria-label="Destination accounting month"]')?.value
    ).toBe('12');
    act(() => container.querySelector<HTMLButtonElement>('.btn-icon.save')!.click());
    await flush();
    expect(mockedApi.updateTransfer).toHaveBeenCalledWith(1, {
      date: '2026-08-24',
      amount: 50,
      description: 'Move to savings',
      sourceAccountId: 101,
      destinationAccountId: 200,
      sourceAccountingMonth: 9,
      sourceAccountingYear: 2026,
      destinationAccountingMonth: 12,
      destinationAccountingYear: 2026,
    });
  });

  it('uses eligible account settlement metadata before the payment method fallback', async () => {
    mockedApi.fetchTransferAccounts.mockResolvedValueOnce(
      transferAccounts.map((account) => ({ ...account, settlementDay: null }))
    );
    mockedApi.updateTransfer.mockResolvedValue(transfer());
    const { container } = await renderTransfers([], [transfer({ sourceAccount: transferAccounts[1] })]);
    act(() => container.querySelector<HTMLButtonElement>('.btn-icon.edit')!.click());
    change(container.querySelector('tbody input.date-input')!, '24/12/2026');
    act(() => container.querySelector<HTMLButtonElement>('.btn-icon.save')!.click());
    await flush();
    expect(mockedApi.updateTransfer).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        sourceAccountingMonth: 12,
        sourceAccountingYear: 2026,
        destinationAccountingMonth: 12,
        destinationAccountingYear: 2026,
      })
    );
  });
});

describe('transfer source accounting and summaries', () => {
  it('preserves an explicit source period when its account changes', async () => {
    mockedApi.updateTransfer.mockResolvedValue(transfer());
    const { container } = await renderTransfers([], [transfer()]);
    act(() => container.querySelector<HTMLButtonElement>('.btn-icon.edit')!.click());
    change(container.querySelector('tbody select[aria-label="Source accounting month"]')!, '12');
    change(container.querySelector('tbody input[aria-label="Source accounting year"]')!, '2027');
    change(container.querySelector('tbody select[aria-label="Source account"]')!, '101');
    expect(
      container.querySelector<HTMLSelectElement>('tbody select[aria-label="Source accounting month"]')?.value
    ).toBe('12');
    act(() => container.querySelector<HTMLButtonElement>('.btn-icon.save')!.click());
    await flush();
    expect(mockedApi.updateTransfer).toHaveBeenCalledWith(1, {
      date: '2026-02-04',
      amount: 50,
      description: 'Move to savings',
      sourceAccountId: 101,
      destinationAccountId: 200,
      sourceAccountingMonth: 12,
      sourceAccountingYear: 2027,
    });
  });

  it('counts withdrawals only in the savings source period and counts moved amount once', async () => {
    const { container } = await renderTransfers(
      [],
      [
        transfer({
          sourceAccount: transferAccounts[2],
          destinationAccount: transferAccounts[0],
          sourceAccountingMonth: 12,
          sourceAccountingYear: 2026,
          destinationAccountingMonth: 1,
          destinationAccountingYear: 2027,
        }),
      ]
    );
    const period = selectByClass(container, 'accounting-period-filter');
    expect([...period.options].map((option) => option.value)).toEqual(['', '2026-12', '2027-1']);
    change(period, '2026-12');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(container.querySelector('.summary-item.savings .summary-value')?.textContent).toContain('-50.00');
    expect(container.querySelector('.summary-item.moved .summary-value')?.textContent).toContain('50.00');
    expect(container.querySelector('.summary-item.count .summary-value')?.textContent).toBe('1 / 1');
    change(period, '2027-1');
    expect(container.querySelectorAll('tbody tr')).toHaveLength(1);
    expect(container.querySelector('.summary-item.savings')).toBeNull();
    expect(container.querySelector('.summary-item.moved .summary-value')?.textContent).toContain('50.00');
  });
});
