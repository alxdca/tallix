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
    onCreateBudget: (year: number, description: string) => Promise<void>;
  }> = {}
) {
  const container = document.createElement('div');
  document.body.appendChild(container);

  const onViewChange = vi.fn();
  const onBudgetChange = props.onBudgetChange ?? vi.fn();
  const onCreateBudget = props.onCreateBudget ?? vi.fn().mockResolvedValue(undefined);
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
          onCreateBudget={onCreateBudget}
        />
      </I18nProvider>
    );
  });

  return { container, onBudgetChange, onCreateBudget, onViewChange };
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

function inputByLabel(container: HTMLElement, label: RegExp) {
  const labels = Array.from(container.querySelectorAll('label'));
  const match = labels.find((element) => label.test(element.textContent || ''));
  if (!match) throw new Error(`Missing label ${label}`);
  const id = match.getAttribute('for');
  if (!id) throw new Error(`Label ${label} is not associated to an input`);
  const input = container.querySelector<HTMLInputElement>(`#${id}`);
  if (!input) throw new Error(`Missing input for ${label}`);
  return input;
}

function change(element: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function submit(form: HTMLFormElement) {
  act(() => {
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
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
    expect(options[options.length - 1]?.value).toBe('create');
  });

  it('opens the inline budget creation form from the dropdown create option', async () => {
    const { container } = await renderSidebar();

    selectBudget(container, 'create');

    expect(inputByLabel(container, /year/i)).toBeInstanceOf(HTMLInputElement);
    expect(inputByLabel(container, /description/i)).toBeInstanceOf(HTMLInputElement);
  });

  it('calls onCreateBudget with the entered year and optional description', async () => {
    const onCreateBudget = vi.fn().mockResolvedValue(undefined);
    const { container } = await renderSidebar({ onCreateBudget });

    selectBudget(container, 'create');
    change(inputByLabel(container, /year/i), '2028');
    change(inputByLabel(container, /description/i), 'Summer plan');
    submit(container.querySelector('form')!);
    await flush();

    expect(onCreateBudget).toHaveBeenCalledWith(2028, 'Summer plan');
  });

  it('allows creating another owned budget for a year that already appears in the dropdown', async () => {
    const onCreateBudget = vi.fn().mockResolvedValue(undefined);
    const { container } = await renderSidebar({ activeBudgetId: 3, onCreateBudget });

    selectBudget(container, 'create');
    change(inputByLabel(container, /year/i), '2026');
    submit(container.querySelector('form')!);
    await flush();

    expect(onCreateBudget).toHaveBeenCalledWith(2026, '');
  });

  it('accepts 1900 as the earliest supported budget year', async () => {
    const onCreateBudget = vi.fn().mockResolvedValue(undefined);
    const { container } = await renderSidebar({ onCreateBudget });

    selectBudget(container, 'create');
    change(inputByLabel(container, /year/i), '1900');
    submit(container.querySelector('form')!);
    await flush();

    expect(onCreateBudget).toHaveBeenCalledWith(1900, '');
  });

  it('accepts 9999 as the latest supported budget year', async () => {
    const onCreateBudget = vi.fn().mockResolvedValue(undefined);
    const { container } = await renderSidebar({ onCreateBudget });

    selectBudget(container, 'create');
    change(inputByLabel(container, /year/i), '9999');
    submit(container.querySelector('form')!);
    await flush();

    expect(onCreateBudget).toHaveBeenCalledWith(9999, '');
  });

  it('keeps the creation form open when creating a budget fails', async () => {
    const onCreateBudget = vi.fn().mockRejectedValue(new Error('network down'));
    const { container } = await renderSidebar({ onCreateBudget });

    selectBudget(container, 'create');
    change(inputByLabel(container, /year/i), '2028');
    submit(container.querySelector('form')!);
    await flush();

    expect(onCreateBudget).toHaveBeenCalledWith(2028, '');
    expect(inputByLabel(container, /year/i)).toBeInstanceOf(HTMLInputElement);
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Something went wrong');
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
