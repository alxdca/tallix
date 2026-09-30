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
  budget({ id: 1, year: 2026, description: 'Family budget', role: 'owner' }),
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
    role: 'owner',
    ...overrides,
  } as AccessibleBudget;
}

async function renderSidebar(
  props: Partial<{
    activeView: string;
    currentYear: number;
    activeBudgetId: number | null;
    onBudgetChange: (budgetId: number) => void;
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
          currentYear={props.currentYear ?? 2026}
          budgets={budgets}
          activeBudgetId={props.activeBudgetId ?? 1}
          onBudgetChange={onBudgetChange}
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
  it('shows each accessible budget by year and label inside the active budget dropdown', async () => {
    const { container } = await renderSidebar();
    const options = Array.from(container.querySelectorAll<HTMLOptionElement>('#active-budget option')).map(
      (option) => ({
        value: option.value,
        label: option.textContent?.trim(),
      })
    );

    expect(options.slice(0, 3)).toEqual([
      { value: '3', label: '2027 - Shared by Morgan Lee' },
      { value: '1', label: '2026 - Family budget' },
      { value: '2', label: '2025 - Taxes' },
    ]);
    expect(options.map((option) => option.value)).not.toContain('create');
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
    const { container, onViewChange } = await renderSidebar({ currentYear: 2027 });

    expect(Array.from(container.querySelectorAll('button'), (button) => button.textContent?.trim())).not.toContain(
      'Archive'
    );
    expect(container.textContent).not.toContain('2025TransactionsAccounts');
    expect(onViewChange).not.toHaveBeenCalledWith(expect.stringContaining('archive-'));
  });
});
