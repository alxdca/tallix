import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessibleBudget } from '../api';
import { I18nProvider } from '../contexts/I18nContext';
import Sidebar from './Sidebar';

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { email: 'owner@example.com', name: 'Owner' },
    logout: vi.fn(),
  }),
}));

vi.mock('../utils/logger', () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

const mountedRoots: Root[] = [];

const budgets = [
  budget({ id: 1, year: 2026, years: [2025, 2026, 2027], description: 'Family budget', role: 'owner' }),
  budget({ id: 2, year: 2025, description: 'Taxes', role: 'owner' }),
  budget({
    id: 3,
    year: 2027,
    description: null,
    ownerName: 'Morgan Lee',
    ownerEmail: 'morgan@example.com',
    role: 'read',
  }),
];

function budget(overrides: Partial<AccessibleBudget> & { year: number }): AccessibleBudget {
  return {
    id: 1,
    description: null,
    ownerId: 'owner-1',
    ownerName: null,
    ownerEmail: 'owner@example.com',
    parentBudgetId: null,
    years: [overrides.year],
    role: 'owner',
    ...overrides,
  } as AccessibleBudget;
}

async function renderSidebar(
  props: Partial<{
    activeView: string;
    activeBudgetId: number | null;
    onBudgetChange: (budgetId: number) => void;
    onYearChange: (year: number) => void;
  }> = {}
) {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const onViewChange = vi.fn();
  const onBudgetChange = props.onBudgetChange ?? vi.fn();
  let root: Root;

  await act(async () => {
    root = createRoot(container);
    mountedRoots.push(root);
    root.render(
      <I18nProvider>
        <Sidebar
          activeView={props.activeView ?? 'current'}
          onViewChange={onViewChange}
          budgets={budgets}
          activeBudgetId={props.activeBudgetId ?? 1}
          onBudgetChange={onBudgetChange}
          selectedYear={2026}
          onYearChange={props.onYearChange ?? vi.fn()}
        />
      </I18nProvider>
    );
  });

  return { container, onBudgetChange, onViewChange };
}

function selectBudget(container: HTMLElement, value: string) {
  const select = container.querySelector<HTMLSelectElement>('#active-budget');
  if (!select) throw new Error('Missing active budget select');
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(select, value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  return select;
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  localStorage.clear();
  localStorage.setItem('tallix_locale', 'en');
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

describe('shareable budget selector', () => {
  it('shows each named budget once without a year in its label', async () => {
    const { container } = await renderSidebar();
    const options = Array.from(container.querySelectorAll<HTMLOptionElement>('#active-budget option')).map(
      (option) => ({
        value: option.value,
        label: option.textContent?.trim(),
      })
    );

    expect(options.slice(0, 3)).toEqual([
      { value: '1', label: 'Family budget' },
      { value: '2', label: 'Taxes' },
      { value: '3', label: 'Shared by Morgan Lee' },
    ]);
    expect(options.map((option) => option.value)).not.toContain('create');
  });

  it('shows only the selected budget years in descending order', async () => {
    const onYearChange = vi.fn();
    const { container, onBudgetChange } = await renderSidebar({ onYearChange });
    const select = container.querySelector<HTMLSelectElement>('#active-year')!;
    expect(Array.from(select.options, (option) => option.value)).toEqual(['2027', '2026', '2025']);
    act(() => {
      select.value = '2025';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(onYearChange).toHaveBeenCalledWith(2025);
    expect(onBudgetChange).not.toHaveBeenCalled();
  });

  it('changes budgets from the dropdown without opening a creation form', async () => {
    const onBudgetChange = vi.fn();
    const { container } = await renderSidebar({ onBudgetChange });

    selectBudget(container, '2');

    expect(onBudgetChange).toHaveBeenCalledWith(2);
    expect(container.querySelector('form')).toBeNull();
    expect(container.textContent).not.toContain('Create new budget');
  });

  it('does not render archive navigation now that yearly budgets are selected from the budget dropdown', async () => {
    const { container, onViewChange } = await renderSidebar();

    expect(Array.from(container.querySelectorAll('button'), (button) => button.textContent?.trim())).not.toContain(
      'Archive'
    );
    expect(container.textContent).not.toContain('2025TransactionsAccounts');
    expect(onViewChange).not.toHaveBeenCalledWith(expect.stringContaining('archive-'));
  });

  it('shows flat navigation without a year and keeps the budget view reachable', async () => {
    const { container, onViewChange } = await renderSidebar();
    const nav = container.querySelector('nav');
    const buttons = Array.from(nav?.querySelectorAll('button') ?? []);

    expect(buttons.map((button) => button.textContent?.trim())).toEqual([
      'Budget',
      'Transactions',
      'Accounts',
      'Planning',
      'Playground',
      'Assets',
      'Settings',
    ]);
    expect(nav?.textContent).not.toContain('2026');
    expect(nav?.querySelector('.nav-group, .nav-sub-item')).toBeNull();
    expect(buttons.every((button) => button.parentElement === nav)).toBe(true);

    act(() => {
      buttons[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(onViewChange).toHaveBeenCalledWith('current');
  });
});
