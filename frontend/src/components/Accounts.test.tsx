import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Account } from '../api';
import * as api from '../api';
import { I18nProvider } from '../contexts/I18nContext';
import { SettingsProvider } from '../contexts/SettingsContext';
import { getMonthNames } from '../i18n';
import Accounts from './Accounts';

vi.mock('chart.js', () => ({
  CategoryScale: vi.fn(),
  Chart: { register: vi.fn() },
  Filler: vi.fn(),
  Legend: vi.fn(),
  LineElement: vi.fn(),
  LinearScale: vi.fn(),
  PointElement: vi.fn(),
  Title: vi.fn(),
  Tooltip: vi.fn(),
}));

vi.mock('react-chartjs-2', () => ({
  Line: () => null,
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
  ACTIVE_BUDGET_KEY: 'tallix_active_budget_id',
  fetchAccounts: vi.fn(),
  setAccountBalance: vi.fn(),
  restoreAccountBalanceLink: vi.fn(),
}));

const mockedApi = vi.mocked(api);
const mountedRoots: Root[] = [];

function account(overrides: Partial<Account> = {}): Account {
  return {
    id: 100,
    name: 'Checking',
    institution: 'Bank',
    sortOrder: 0,
    isSavingsAccount: false,
    initialBalance: 1200,
    monthlyBalances: Array(12).fill(1200),
    ...overrides,
  };
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}

function change(element: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;

  act(() => {
    valueSetter?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

async function renderAccounts(
  accounts: Account[],
  onDataChanged = vi.fn(),
  props: { year?: number; readOnly?: boolean } = {}
) {
  mockedApi.fetchAccounts.mockResolvedValue({ accounts, lastActiveMonth: 0 });

  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;

  root = createRoot(container);
  mountedRoots.push(root);
  const render = async (nextProps = props) => {
    await act(async () => {
      root.render(
        <I18nProvider>
          <SettingsProvider>
            <Accounts year={2027} months={getMonthNames('en')} onDataChanged={onDataChanged} {...nextProps} />
          </SettingsProvider>
        </I18nProvider>
      );
    });
    await flush();
  };
  await render();

  return { container, onDataChanged, render };
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('tallix_locale', 'en');
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mockedApi.fetchAccounts.mockReset();
  mockedApi.setAccountBalance.mockReset();
  mockedApi.restoreAccountBalanceLink.mockReset();
  mockedApi.restoreAccountBalanceLink.mockResolvedValue(undefined);
  mockedApi.setAccountBalance.mockResolvedValue(undefined);
});

afterEach(() => {
  for (const root of mountedRoots) {
    act(() => {
      root.unmount();
    });
  }
  mountedRoots.length = 0;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});

describe('accounts inherited opening balances', () => {
  it('shows linked account help and saves an explicit child opening balance override', async () => {
    const onDataChanged = vi.fn();
    const linkedAccount = account({
      id: 42,
      name: 'Child Checking',
      initialBalance: 1234.56,
      inheritedFromParent: true,
    });

    const { container } = await renderAccounts([linkedAccount], onDataChanged);

    const badge = container.querySelector('.account-balance-link');
    expect(badge?.textContent).toBe('Linked');
    expect(badge?.getAttribute('title')).toBe('Follows this account’s year-end balance in the parent budget.');

    const editableBalance = container.querySelector('.balance-value.editable') as HTMLSpanElement;
    expect(editableBalance.getAttribute('title')).toBe(
      'Edit to replace the linked opening balance with your own value.'
    );

    await act(async () => {
      editableBalance.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const input = container.querySelector('.balance-input') as HTMLInputElement;
    change(input, '1500.25');

    const saveButton = container.querySelector('.btn-icon.save') as HTMLButtonElement;
    await act(async () => {
      saveButton.click();
    });
    await flush();

    expect(mockedApi.setAccountBalance).not.toHaveBeenCalled();
    expect(container.querySelector('[role=alertdialog]')?.textContent).toContain('future changes');
    await click(container, '.confirm-dialog-btn.confirm');
    expect(mockedApi.setAccountBalance).toHaveBeenCalledWith(2027, 42, 1500.25, true);
    expect(onDataChanged).toHaveBeenCalledTimes(1);
  });

  it('does not show linked help for accounts with their own opening balance', async () => {
    const { container } = await renderAccounts([account({ inheritedFromParent: false })]);

    expect(container.querySelector('.account-balance-link')).toBeNull();
    expect(container.querySelector('.balance-value.editable')?.getAttribute('title')).toBe('Click to edit');
  });
});

async function click(container: HTMLElement, selector: string) {
  const element = container.querySelector(selector) as HTMLElement;
  expect(element, selector).not.toBeNull();
  await act(async () => element.click());
  await flush();
}

async function edit(container: HTMLElement, value: string) {
  await click(container, '.balance-value.editable');
  change(container.querySelector('.balance-input') as HTMLInputElement, value);
  await click(container, '.btn-icon.save');
}

describe('account closing balances and links', () => {
  it('shows December closing in all closing columns, including every subtotal and overall total', async () => {
    const { container } = await renderAccounts([
      account({ monthlyBalances: [100, ...Array(10).fill(200), 321], endOfYearBalance: 321 }),
      account({ id: 101, name: 'Savings', isSavingsAccount: true, monthlyBalances: Array(12).fill(-50) }),
    ]);
    expect([...container.querySelectorAll('.account-closing-col')].map((cell) => cell.textContent)).toEqual([
      'End-of-year balance',
      'End-of-year balance',
      'End-of-year balance',
    ]);
    expect([...container.querySelectorAll('td.account-closing')].map((cell) => cell.textContent)).toEqual([
      '321.00',
      '321.00',
      '-50.00',
      '-50.00',
      '321.00',
      '-50.00',
      '271.00',
    ]);
    expect(container.querySelectorAll('thead tr')[0].children).toHaveLength(15);
    expect(container.querySelector('.account-closing .editable')).toBeNull();
  });

  it('shows the source year and cancels linked overrides without saving', async () => {
    const { container } = await renderAccounts([account({ linkedFromYear: 2025 })]);
    expect(container.querySelector('.account-balance-link')?.textContent).toBe('Linked to 2025');
    expect(container.querySelector('.account-balance-link')?.getAttribute('title')).toContain('2025');
    await edit(container, '500');
    expect(mockedApi.setAccountBalance).not.toHaveBeenCalled();
    expect(container.querySelector('[role=alertdialog]')?.textContent).toContain('breaks the link');
    await click(container, '.confirm-dialog-btn.cancel');
    expect(mockedApi.setAccountBalance).not.toHaveBeenCalled();
    await click(container, '.btn-icon.save');
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(container.querySelector('[role=alertdialog]')).toBeNull();
    expect(mockedApi.setAccountBalance).not.toHaveBeenCalled();
  });

  it('confirms a previous-year override, refreshes, and restores its link', async () => {
    const source = account({ linkedFromYear: 2026, canRestoreBalanceLink: true });
    const { container, onDataChanged } = await renderAccounts([source]);
    mockedApi.fetchAccounts.mockResolvedValue({
      accounts: [account({ initialBalance: 500, openingBalanceOverridden: true, canRestoreBalanceLink: true })],
      lastActiveMonth: 0,
    });
    await edit(container, '500');
    await click(container, '.confirm-dialog-btn.confirm');
    expect(mockedApi.setAccountBalance).toHaveBeenCalledWith(2027, 100, 500, true);
    expect(onDataChanged).toHaveBeenCalledTimes(1);
    expect(container.querySelector('.account-balance-override')?.textContent).toBe('Manual override');
    mockedApi.fetchAccounts.mockResolvedValue({ accounts: [source], lastActiveMonth: 0 });
    await click(container, '.account-restore-link');
    expect(mockedApi.restoreAccountBalanceLink).toHaveBeenCalledWith(2027, 100);
    expect(onDataChanged).toHaveBeenCalledTimes(2);
    expect(container.querySelector('.account-balance-link')?.textContent).toBe('Linked to 2026');
    expect(container.querySelector('.account-restore-link')).toBeNull();
  });

  it('edits an independent first opening without a link warning', async () => {
    const { container } = await renderAccounts([account()]);
    await edit(container, '0');
    expect(container.querySelector('[role=alertdialog]')).toBeNull();
    expect(mockedApi.setAccountBalance).toHaveBeenCalledWith(2027, 100, 0);
    expect(container.querySelector('.account-restore-link')).toBeNull();
  });

  it('keeps a failed opening edit and reports a failed restore without losing the displayed value', async () => {
    const { container, onDataChanged } = await renderAccounts([
      account({ openingBalanceOverridden: true, canRestoreBalanceLink: true }),
    ]);
    mockedApi.setAccountBalance.mockRejectedValue(new Error('offline'));
    await edit(container, '500');
    expect(container.querySelector('.balance-input')).not.toBeNull();
    expect(container.querySelector('[role=alert]')?.textContent).toContain('save');
    expect(onDataChanged).not.toHaveBeenCalled();
    await click(container, '.btn-icon.cancel');
    mockedApi.restoreAccountBalanceLink.mockRejectedValue(new Error('offline'));
    await click(container, '.account-restore-link');
    expect(container.querySelector('[role=alert]')?.textContent).toContain('restore');
    expect(container.querySelector('.balance-value')?.textContent).toBe("1'200.00");
    expect(onDataChanged).not.toHaveBeenCalled();
  });

  it('prevents edits and restore for viewers, including a pending confirmation after a role change', async () => {
    const { container, render } = await renderAccounts([
      account({ linkedFromYear: 2026, canRestoreBalanceLink: true }),
    ]);
    await edit(container, '500');
    await render({ readOnly: true });
    expect(container.querySelector('[role=alertdialog]')).toBeNull();
    expect(container.querySelector('.balance-input')).toBeNull();
    expect(container.querySelector('.balance-value.editable')).toBeNull();
    await click(container, '.balance-value');
    expect(container.querySelector('.balance-input')).toBeNull();
    await render({ readOnly: true, year: 2028 });
    expect(mockedApi.setAccountBalance).not.toHaveBeenCalled();
    expect(mockedApi.restoreAccountBalanceLink).not.toHaveBeenCalled();
  });

  it('clears pending confirmation on year changes and blocks double submissions', async () => {
    const { container, render } = await renderAccounts([account({ linkedFromYear: 2026 })]);
    await edit(container, '500');
    await render({ year: 2028 });
    expect(container.querySelector('[role=alertdialog]')).toBeNull();
    expect(mockedApi.setAccountBalance).not.toHaveBeenCalled();
    let resolveSave!: () => void;
    mockedApi.setAccountBalance.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        })
    );
    await edit(container, '700');
    const button = container.querySelector('.confirm-dialog-btn.confirm') as HTMLButtonElement;
    await act(async () => {
      button.click();
      button.click();
    });
    expect(mockedApi.setAccountBalance).toHaveBeenCalledTimes(1);
    await act(async () => resolveSave());
  });

  it('translates closing balances, source year, and link warning into French', async () => {
    localStorage.setItem('tallix_locale', 'fr');
    const { container } = await renderAccounts([account({ linkedFromYear: 2026 })]);
    expect(container.querySelector('.account-closing-col')?.textContent).toBe('Solde de fin d’année');
    expect(container.querySelector('.account-balance-link')?.textContent).toBe('Lié à 2026');
    await edit(container, '500');
    expect(container.querySelector('[role=alertdialog]')?.textContent).toContain('rompt le lien');
    expect(mockedApi.setAccountBalance).not.toHaveBeenCalled();
  });
});

describe('account edit lifecycle guards', () => {
  it('renders a read-only override without edit or restore controls', async () => {
    const { container } = await renderAccounts(
      [account({ openingBalanceOverridden: true, canRestoreBalanceLink: true })],
      vi.fn(),
      { readOnly: true }
    );
    expect(container.querySelector('.account-balance-override')?.textContent).toBe('Manual override');
    expect(container.querySelector('.account-edit-balance')).toBeNull();
    expect(container.querySelector('.account-restore-link')).toBeNull();
    await click(container, '.balance-value');
    expect(container.querySelector('.balance-input')).toBeNull();
  });

  it('supports keyboard submit and cancels edits without a mutation', async () => {
    const { container } = await renderAccounts([account()]);
    await click(container, '.balance-value.editable');
    let input = container.querySelector('.balance-input') as HTMLInputElement;
    change(input, '500');
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(container.querySelector('.balance-input')).toBeNull();
    expect(mockedApi.setAccountBalance).not.toHaveBeenCalled();
    await click(container, '.balance-value.editable');
    input = container.querySelector('.balance-input') as HTMLInputElement;
    change(input, '-50.25');
    await act(async () => input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
    expect(mockedApi.setAccountBalance).toHaveBeenCalledWith(2027, 100, -50.25);
  });

  it('does not silently turn an empty opening input into zero', async () => {
    const { container } = await renderAccounts([account()]);
    await edit(container, '');
    expect(mockedApi.setAccountBalance).not.toHaveBeenCalled();
    expect(container.querySelector('.balance-input')).not.toBeNull();
  });

  it('blocks a stale confirmation when the active budget has already switched', async () => {
    const { container } = await renderAccounts([account({ linkedFromYear: 2026 })]);
    await edit(container, '500');
    localStorage.setItem(api.ACTIVE_BUDGET_KEY, '99');
    await click(container, '.confirm-dialog-btn.confirm');
    expect(mockedApi.setAccountBalance).not.toHaveBeenCalled();
  });

  it('does not reload or notify a new year when an earlier pending save finishes', async () => {
    const { container, render, onDataChanged } = await renderAccounts([account()]);
    let resolveSave!: () => void;
    mockedApi.setAccountBalance.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSave = resolve;
        })
    );
    await edit(container, '500');
    await render({ year: 2028 });
    const fetchCount = mockedApi.fetchAccounts.mock.calls.length;
    await act(async () => resolveSave());
    expect(mockedApi.fetchAccounts).toHaveBeenCalledTimes(fetchCount);
    expect(onDataChanged).not.toHaveBeenCalled();
  });

  it('prevents duplicate restores and ignores a save completion after unmount', async () => {
    const { container, onDataChanged } = await renderAccounts([
      account({ openingBalanceOverridden: true, canRestoreBalanceLink: true }),
    ]);
    let resolveRestore!: () => void;
    mockedApi.restoreAccountBalanceLink.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveRestore = resolve;
        })
    );
    const restore = container.querySelector('.account-restore-link') as HTMLButtonElement;
    await act(async () => {
      restore.click();
      restore.click();
    });
    expect(mockedApi.restoreAccountBalanceLink).toHaveBeenCalledTimes(1);
    const fetchCount = mockedApi.fetchAccounts.mock.calls.length;
    const root = mountedRoots.pop();
    await act(async () => root?.unmount());
    await act(async () => resolveRestore());
    expect(mockedApi.fetchAccounts).toHaveBeenCalledTimes(fetchCount);
    expect(onDataChanged).not.toHaveBeenCalled();
  });
});
