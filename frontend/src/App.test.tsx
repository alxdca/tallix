import type { ReactNode } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import * as api from './api';
import type { BudgetData, BudgetSummary } from './types';

vi.mock('./contexts/AuthContext', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useAuth: () => ({
    user: { email: 'owner@example.com', name: 'Owner', language: 'en' },
    isLoading: false,
  }),
}));

vi.mock('./api', () => ({
  ACTIVE_BUDGET_KEY: 'tallix_active_budget_id',
  createBudget: vi.fn(),
  deleteBudget: vi.fn(),
  fetchAccounts: vi.fn(),
  fetchBudgetData: vi.fn(),
  fetchBudgetSummary: vi.fn(),
  fetchBudgets: vi.fn(),
}));

vi.mock('./components/Sidebar', () => ({
  default: (props: any) => (
    <aside data-testid="sidebar">
      <select
        aria-label="Budget"
        value={props.activeBudgetId ?? ''}
        onChange={(event) => props.onBudgetChange(Number(event.currentTarget.value))}
      >
        {props.budgets.map((budget: any) => (
          <option key={budget.id} value={budget.id}>
            {budget.year} {budget.description || budget.ownerName || budget.ownerEmail}
          </option>
        ))}
      </select>
      <button type="button" onClick={() => props.onViewChange('current')}>
        Current
      </button>
      <button type="button" onClick={() => props.onViewChange('accounts')}>
        Accounts
      </button>
      <button type="button" onClick={() => props.onViewChange('settings')}>
        Settings
      </button>
      <button type="button" onClick={() => props.onViewChange('user-settings')}>
        My account
      </button>
    </aside>
  ),
}));

vi.mock('./components/Header', () => ({
  default: (props: any) => (
    <header data-testid="header">
      Header {props.year} remaining {props.remainingBalance}
    </header>
  ),
}));

vi.mock('./components/BudgetSpreadsheet', () => ({
  default: (props: any) => (
    <div data-testid="spreadsheet">
      Spreadsheet {props.year} payment-initial {props.paymentAccountsInitialBalance}
    </div>
  ),
}));

vi.mock('./components/Accounts', () => ({
  default: (props: any) => <div data-testid="accounts">Accounts {props.year}</div>,
}));

vi.mock('./components/Settings', () => ({
  default: (props: any) => (
    <div data-testid="settings">
      Settings year-id {props.yearId} role {props.accessRole}
    </div>
  ),
}));

vi.mock('./components/Archive', () => ({
  default: () => <div data-testid="archive">Archive should not render</div>,
}));

vi.mock('./components/Assets', () => ({
  default: () => <div data-testid="assets">Assets</div>,
}));

vi.mock('./components/BudgetPlanning', () => ({
  default: (props: any) => <div data-testid="planning">Planning {props.year}</div>,
}));

vi.mock('./components/BudgetPlayground', () => ({
  default: (props: any) => <div data-testid="playground">Playground {props.year}</div>,
}));

vi.mock('./components/CopilotWidget', () => ({
  default: () => null,
}));

vi.mock('./components/Login', () => ({
  default: () => <div>Login</div>,
}));

vi.mock('./components/Transactions', () => ({
  default: (props: any) => <div data-testid="transactions">Transactions {props.year}</div>,
}));

vi.mock('./components/UserSettings', () => ({
  default: (props: any) => (
    <div data-testid="user-settings">
      User settings active {props.activeBudgetId}
      <button type="button" onClick={() => void props.onCreateBudget(2030, 'Roadtrip', null).catch(() => undefined)}>
        Create 2030
      </button>
      <button type="button" onClick={() => void props.onCreateBudget(2031, 'Roadtrip child', 1).catch(() => undefined)}>
        Create 2031 from 1
      </button>
      {props.budgets.map((budget: any) => (
        <button
          key={budget.id}
          type="button"
          onClick={() => void props.onDeleteBudget(budget.id).catch(() => undefined)}
        >
          Delete {budget.id}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('./utils/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

const mockedApi = vi.mocked(api);
const mountedRoots: Root[] = [];

const accessibleBudgets = [
  budget({ id: 1, year: 2026, description: 'Current', role: 'owner' }),
  budget({ id: 2, year: 2025, description: 'Last year', role: 'owner' }),
  budget({ id: 3, year: 2027, description: null, ownerName: 'Morgan', ownerEmail: 'morgan@example.com', role: 'read' }),
  budget({
    id: 5,
    year: 2026,
    description: 'Shared current',
    ownerName: 'Avery',
    ownerEmail: 'avery@example.com',
    role: 'write',
  }),
];

function budget(overrides: any) {
  return {
    id: 1,
    year: 2026,
    description: null,
    ownerId: 'owner-1',
    ownerName: null,
    ownerEmail: 'owner@example.com',
    parentBudgetId: null,
    role: 'owner',
    ...overrides,
  };
}

function budgetData(year: number): BudgetData {
  return {
    year,
    yearId: year * 10,
    initialBalance: year,
    groups: [],
  };
}

function summary(year: number): BudgetSummary {
  return {
    initialBalance: year,
    totalIncome: { budget: year + 100, actual: year + 10 },
    totalExpenses: { budget: year + 200, actual: year + 20 },
    totalSavings: { budget: year + 300, actual: year + 30 },
    expectedIncome: year + 400,
    expectedExpenses: year + 500,
    expectedSavings: year + 600,
    remainingBalance: year + 700,
  };
}

function accounts(year: number) {
  return {
    lastActiveMonth: year === 2025 ? 12 : 0,
    accounts: [
      {
        id: year,
        name: `Checking ${year}`,
        institution: null,
        type: 'checking',
        initialBalance: year,
        currentBalance: year,
        monthlyBalances: Array(12).fill(year),
        isSavingsAccount: false,
        savingsType: null,
        sortOrder: 0,
      },
    ],
  };
}

function setupApi() {
  mockedApi.fetchBudgets.mockResolvedValue({ budgets: accessibleBudgets as any, defaultBudgetId: 1 });
  mockedApi.fetchBudgetData.mockImplementation(async (year = 2026) => budgetData(year));
  mockedApi.fetchBudgetSummary.mockImplementation(async (year = 2026) => summary(year));
  mockedApi.fetchAccounts.mockImplementation(async (year: number) => accounts(year));
  mockedApi.createBudget.mockResolvedValue(budget({ id: 4, year: 2030, description: 'Roadtrip' }) as any);
  mockedApi.deleteBudget.mockResolvedValue({ budgets: accessibleBudgets.slice(1) as any, defaultBudgetId: 2 });
}

async function renderApp() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;

  await act(async () => {
    root = createRoot(container);
    mountedRoots.push(root);
    root.render(<App />);
  });
  await flush();

  return { container, root: root! };
}

function changeBudget(container: HTMLElement, budgetId: string) {
  const select = container.querySelector<HTMLSelectElement>('select[aria-label="Budget"]');
  if (!select) throw new Error('Missing budget select');
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(select, budgetId);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function click(container: HTMLElement, text: string) {
  const button = Array.from(container.querySelectorAll('button')).find((element) => element.textContent === text);
  if (!button) throw new Error(`Missing button ${text}`);
  act(() => {
    button.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function waitForText(container: HTMLElement, text: string) {
  for (let index = 0; index < 10; index += 1) {
    await flush();
    if (container.textContent?.includes(text)) return;
  }
  throw new Error(`Timed out waiting for ${text}. Current text: ${container.textContent}`);
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

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  localStorage.setItem('tallix_locale', 'en');
  vi.clearAllMocks();
  setupApi();
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

describe('yearly budget selection', () => {
  it('loads data, summary and accounts for the selected budget year when switching past and future budgets', async () => {
    const { container } = await renderApp();
    await waitForText(container, 'Header 2026 remaining 2726');

    changeBudget(container, '2');
    await waitForText(container, 'Header 2025 remaining 2725');
    click(container, 'Accounts');
    await waitForText(container, 'Accounts 2025');

    expect(mockedApi.fetchBudgetData).toHaveBeenCalledWith(2025);
    expect(mockedApi.fetchBudgetSummary).toHaveBeenCalledWith(2025);
    expect(mockedApi.fetchAccounts).toHaveBeenCalledWith(2025);

    changeBudget(container, '3');
    await waitForText(container, 'Header 2027 remaining 2727');

    expect(mockedApi.fetchBudgetData).toHaveBeenCalledWith(2027);
    expect(mockedApi.fetchBudgetSummary).toHaveBeenCalledWith(2027);
    expect(mockedApi.fetchAccounts).toHaveBeenCalledWith(2027);
    expect(container.textContent).toContain('You have read-only access to this budget');
  });

  it('creates a yearly budget from user settings and selects the returned budget', async () => {
    const { container } = await renderApp();
    await waitForText(container, 'Header 2026 remaining 2726');

    click(container, 'My account');
    await waitForText(container, 'User settings active 1');
    click(container, 'Create 2030');
    await waitForText(container, 'Header 2030 remaining 2730');

    expect(mockedApi.createBudget).toHaveBeenCalledWith(2030, 'Roadtrip', null);
    expect(localStorage.getItem(api.ACTIVE_BUDGET_KEY)).toBe('4');
    expect(mockedApi.fetchBudgetData).toHaveBeenCalledWith(2030);
    expect(mockedApi.fetchBudgetSummary).toHaveBeenCalledWith(2030);
    expect(mockedApi.fetchAccounts).toHaveBeenCalledWith(2030);
  });

  it('passes the selected parent budget when creating from user settings', async () => {
    mockedApi.createBudget.mockResolvedValueOnce(
      budget({ id: 6, year: 2031, description: 'Roadtrip child', parentBudgetId: 1 }) as any
    );
    const { container } = await renderApp();
    await waitForText(container, 'Header 2026 remaining 2726');

    click(container, 'My account');
    await waitForText(container, 'User settings active 1');
    click(container, 'Create 2031 from 1');
    await waitForText(container, 'Header 2031 remaining 2731');

    expect(mockedApi.createBudget).toHaveBeenCalledWith(2031, 'Roadtrip child', 1);
    expect(localStorage.getItem(api.ACTIVE_BUDGET_KEY)).toBe('6');
    expect(mockedApi.fetchBudgetData).toHaveBeenCalledWith(2031);
  });

  it('keeps the current budget selected when budget creation fails', async () => {
    mockedApi.createBudget.mockRejectedValueOnce(new Error('network down'));
    const { container } = await renderApp();
    await waitForText(container, 'Header 2026 remaining 2726');

    click(container, 'My account');
    await waitForText(container, 'User settings active 1');
    click(container, 'Create 2030');
    await flush();

    expect(mockedApi.createBudget).toHaveBeenCalledWith(2030, 'Roadtrip', null);
    expect(localStorage.getItem(api.ACTIVE_BUDGET_KEY)).toBe('1');
    expect(container.textContent).toContain('User settings active 1');
    expect(container.textContent).not.toContain('Header 2030');
  });

  it('does not let a slower previous budget request overwrite the latest selected budget', async () => {
    const previousBudget = deferred<BudgetData>();
    const latestBudget = deferred<BudgetData>();
    mockedApi.fetchBudgetData.mockImplementation((year = 2026) => {
      if (year === 2025) return previousBudget.promise;
      if (year === 2027) return latestBudget.promise;
      return Promise.resolve(budgetData(year));
    });

    const { container } = await renderApp();
    await waitForText(container, 'Header 2026 remaining 2726');

    changeBudget(container, '2');
    changeBudget(container, '3');
    latestBudget.resolve(budgetData(2027));
    await waitForText(container, 'Header 2027 remaining 2727');

    previousBudget.resolve(budgetData(2025));
    await flush();

    expect(container.textContent).toContain('Header 2027 remaining 2727');
    expect(container.textContent).not.toContain('Header 2025 remaining 2725');
  });

  it('passes the selected budget role through to budget settings', async () => {
    const { container } = await renderApp();
    await waitForText(container, 'Header 2026 remaining 2726');

    changeBudget(container, '3');
    await waitForText(container, 'Header 2027 remaining 2727');
    click(container, 'Settings');
    await waitForText(container, 'Settings year-id 20270 role read');

    changeBudget(container, '1');
    await waitForText(container, 'Header 2026 remaining 2726');
    click(container, 'Settings');
    await waitForText(container, 'Settings year-id 20260 role owner');
  });

  it('reloads Settings context when switching between two accessible budgets for the same year', async () => {
    const { container } = await renderApp();
    await waitForText(container, 'Header 2026 remaining 2726');

    click(container, 'Settings');
    await waitForText(container, 'Settings year-id 20260 role owner');

    changeBudget(container, '5');
    await waitForText(container, 'Header 2026 remaining 2726');
    click(container, 'Settings');
    await waitForText(container, 'Settings year-id 20260 role write');

    expect(localStorage.getItem(api.ACTIVE_BUDGET_KEY)).toBe('5');
    expect(mockedApi.fetchBudgetData.mock.calls.filter(([year]) => year === 2026)).toHaveLength(2);
    expect(mockedApi.fetchBudgetSummary.mock.calls.filter(([year]) => year === 2026)).toHaveLength(2);
    expect(mockedApi.fetchAccounts.mock.calls.filter(([year]) => year === 2026)).toHaveLength(2);
  });

  it('stays in user settings and selects the fallback budget after deleting the active budget', async () => {
    const { container } = await renderApp();
    await waitForText(container, 'Header 2026 remaining 2726');

    click(container, 'My account');
    await waitForText(container, 'User settings active 1');
    click(container, 'Delete 1');
    await flush();

    expect(mockedApi.deleteBudget).toHaveBeenCalledWith(1);
    expect(localStorage.getItem(api.ACTIVE_BUDGET_KEY)).toBe('2');
    expect(container.querySelector<HTMLSelectElement>('select[aria-label="Budget"]')?.value).toBe('2');
    expect(container.textContent).toContain('User settings active 2');
    expect(mockedApi.fetchBudgetData).toHaveBeenCalledWith(2025);
    expect(mockedApi.fetchBudgetSummary).toHaveBeenCalledWith(2025);
  });

  it('keeps the current budget selected without reloading data after deleting an inactive budget', async () => {
    mockedApi.deleteBudget.mockResolvedValueOnce({
      budgets: [accessibleBudgets[0], accessibleBudgets[2]],
      defaultBudgetId: 1,
    } as any);
    const { container } = await renderApp();
    await waitForText(container, 'Header 2026 remaining 2726');
    const loadsBeforeDelete = mockedApi.fetchBudgetData.mock.calls.length;

    click(container, 'My account');
    await waitForText(container, 'User settings active 1');
    click(container, 'Delete 2');
    await flush();

    expect(localStorage.getItem(api.ACTIVE_BUDGET_KEY)).toBe('1');
    expect(container.querySelector<HTMLSelectElement>('select[aria-label="Budget"]')?.value).toBe('1');
    expect(container.textContent).toContain('User settings active 1');
    expect(mockedApi.fetchBudgetData).toHaveBeenCalledTimes(loadsBeforeDelete);
  });

  it('preserves the available budgets and current selection when deleting a budget fails', async () => {
    mockedApi.deleteBudget.mockRejectedValueOnce(new Error('network down'));
    const { container } = await renderApp();
    await waitForText(container, 'Header 2026 remaining 2726');

    click(container, 'My account');
    await waitForText(container, 'Delete 2');
    click(container, 'Delete 2');
    await flush();

    expect(localStorage.getItem(api.ACTIVE_BUDGET_KEY)).toBe('1');
    expect(container.textContent).toContain('User settings active 1');
    expect(container.textContent).toContain('Delete 2');
  });

  it('selects the replacement budget returned after deleting the last owned budget', async () => {
    const replacement = budget({ id: 9, year: 2026, description: 'Fresh start', role: 'owner' });
    mockedApi.fetchBudgets.mockResolvedValueOnce({ budgets: [accessibleBudgets[0]], defaultBudgetId: 1 } as any);
    mockedApi.deleteBudget.mockResolvedValueOnce({ budgets: [replacement], defaultBudgetId: 9 } as any);
    const { container } = await renderApp();
    await waitForText(container, 'Header 2026 remaining 2726');

    click(container, 'My account');
    await waitForText(container, 'User settings active 1');
    click(container, 'Delete 1');
    await flush();

    expect(localStorage.getItem(api.ACTIVE_BUDGET_KEY)).toBe('9');
    expect(container.querySelector<HTMLSelectElement>('select[aria-label="Budget"]')?.value).toBe('9');
    expect(container.textContent).toContain('User settings active 9');
    expect(mockedApi.fetchBudgetData).toHaveBeenCalledWith(2026);
  });

  it('honors the latest selected budget when a delete response arrives after the user switches budgets', async () => {
    const pendingDelete = deferred<{ budgets: typeof accessibleBudgets; defaultBudgetId: number }>();
    mockedApi.deleteBudget.mockReturnValueOnce(pendingDelete.promise as any);
    const { container } = await renderApp();
    await waitForText(container, 'Header 2026 remaining 2726');

    click(container, 'My account');
    await waitForText(container, 'User settings active 1');
    click(container, 'Delete 1');
    changeBudget(container, '3');
    await waitForText(container, 'Header 2027 remaining 2727');
    pendingDelete.resolve({ budgets: [accessibleBudgets[1], accessibleBudgets[2]], defaultBudgetId: 2 });
    await flush();

    expect(localStorage.getItem(api.ACTIVE_BUDGET_KEY)).toBe('3');
    expect(container.querySelector<HTMLSelectElement>('select[aria-label="Budget"]')?.value).toBe('3');
    expect(container.textContent).toContain('Header 2027 remaining 2727');
    expect(mockedApi.fetchBudgetData).not.toHaveBeenCalledWith(2025);
  });
});
