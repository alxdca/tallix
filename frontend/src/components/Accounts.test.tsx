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
  fetchAccounts: vi.fn(),
  setAccountBalance: vi.fn(),
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

async function renderAccounts(accounts: Account[], onDataChanged = vi.fn()) {
  mockedApi.fetchAccounts.mockResolvedValue({ accounts, lastActiveMonth: 0 });

  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;

  await act(async () => {
    root = createRoot(container);
    mountedRoots.push(root);
    root.render(
      <I18nProvider>
        <SettingsProvider>
          <Accounts year={2027} months={getMonthNames('en')} onDataChanged={onDataChanged} />
        </SettingsProvider>
      </I18nProvider>
    );
  });
  await flush();

  return { container, onDataChanged };
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('tallix_locale', 'en');
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  mockedApi.fetchAccounts.mockReset();
  mockedApi.setAccountBalance.mockReset();
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

    expect(mockedApi.setAccountBalance).toHaveBeenCalledWith(2027, 42, 1500.25);
    expect(onDataChanged).toHaveBeenCalledTimes(1);
  });

  it('does not show linked help for accounts with their own opening balance', async () => {
    const { container } = await renderAccounts([account({ inheritedFromParent: false })]);

    expect(container.querySelector('.account-balance-link')).toBeNull();
    expect(container.querySelector('.balance-value.editable')?.getAttribute('title')).toBe('Click to edit');
  });
});
