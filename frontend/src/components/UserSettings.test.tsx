import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessibleBudget } from '../api';
import { I18nProvider } from '../contexts/I18nContext';
import UserSettings from './UserSettings';

vi.mock('../api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api')>()),
  changePassword: vi.fn(),
  updateUserSettings: vi.fn(),
}));

vi.mock('../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { email: 'owner@example.com', name: 'Owner', language: localStorage.getItem('tallix_locale') || 'en' },
    updateUser: vi.fn(),
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

const budgets: AccessibleBudget[] = [
  budget({ id: 1, year: 2026, description: 'Family plan', role: 'owner' }),
  budget({ id: 2, year: 2025, description: 'Taxes', role: 'owner' }),
  budget({ id: 3, year: 2027, description: 'Shared plan', ownerName: 'Morgan', role: 'write' }),
];

function budget(overrides: Partial<AccessibleBudget> & { id: number; year: number }): AccessibleBudget {
  return {
    description: null,
    ownerId: 'owner-1',
    ownerName: null,
    ownerEmail: 'owner@example.com',
    parentBudgetId: null,
    role: 'owner',
    ...overrides,
  };
}

async function renderSettings(
  props: Partial<{
    budgets: AccessibleBudget[];
    activeBudgetId: number | null;
    onCreateBudget: (year: number, description: string, parentBudgetId: number | null) => Promise<void>;
    onDeleteBudget: (budgetId: number) => Promise<void>;
  }> = {}
) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const onCreateBudget = props.onCreateBudget ?? vi.fn().mockResolvedValue(undefined);
  const onDeleteBudget = props.onDeleteBudget ?? vi.fn().mockResolvedValue(undefined);
  let root: Root;

  await act(async () => {
    root = createRoot(container);
    mountedRoots.push(root);
    root.render(
      <I18nProvider>
        <UserSettings
          budgets={props.budgets ?? budgets}
          activeBudgetId={props.activeBudgetId ?? 1}
          onCreateBudget={onCreateBudget}
          onDeleteBudget={onDeleteBudget}
        />
      </I18nProvider>
    );
  });

  return { container, onCreateBudget, onDeleteBudget };
}

function buttonByName(container: HTMLElement, name: string) {
  const button = Array.from(container.querySelectorAll('button')).find(
    (element) => element.textContent?.trim() === name || element.getAttribute('aria-label')?.includes(name)
  );
  if (!button) throw new Error(`Missing button ${name}`);
  return button;
}

function click(element: Element) {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function changeInput(element: HTMLInputElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  });
}

function changeSelect(element: HTMLSelectElement, value: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set?.call(element, value);
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

describe('budget deletion settings', () => {
  it('shows only budgets owned by the signed-in user', async () => {
    const { container } = await renderSettings();

    expect(container.textContent).toContain('2026');
    expect(container.textContent).toContain('Family plan');
    expect(container.textContent).toContain('2025');
    expect(container.textContent).toContain('Taxes');
    expect(container.textContent).not.toContain('Shared plan');
  });

  it('asks for confirmation with the selected budget name and year before deleting', async () => {
    const { container } = await renderSettings();

    click(buttonByName(container, 'Delete 2025'));

    expect(container.querySelector('[role="alertdialog"]')?.textContent).toContain('Permanently delete');
    expect(container.querySelector('[role="alertdialog"]')?.textContent).toContain('Taxes');
  });

  it('does not delete the budget when the confirmation is cancelled', async () => {
    const { container, onDeleteBudget } = await renderSettings();

    click(buttonByName(container, 'Delete 2025'));
    click(buttonByName(container, 'Cancel'));

    expect(onDeleteBudget).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alertdialog"]')).toBeNull();
  });

  it('disables every budget delete button while a deletion is pending', async () => {
    const pending = deferred<void>();
    const { container } = await renderSettings({ onDeleteBudget: vi.fn(() => pending.promise) });

    click(buttonByName(container, 'Delete 2025'));
    click(buttonByName(container, 'Delete budget'));
    await flush();

    const deleteButtons = Array.from(
      container.querySelectorAll<HTMLButtonElement>('.user-settings-budget-list button')
    );
    expect(deleteButtons.every((button) => button.disabled)).toBe(true);

    pending.resolve();
    await flush();
  });

  it('shows a success message after deleting a budget', async () => {
    const { container } = await renderSettings();

    click(buttonByName(container, 'Delete 2025'));
    click(buttonByName(container, 'Delete budget'));
    await flush();

    expect(container.querySelector('[role="status"]')?.textContent).toContain('Taxes');
    expect(container.querySelector('[role="status"]')?.textContent).toContain('was deleted.');
  });

  it('shows an error message when budget deletion fails', async () => {
    const { container } = await renderSettings({
      onDeleteBudget: vi.fn().mockRejectedValue(new Error('network down')),
    });

    click(buttonByName(container, 'Delete 2025'));
    click(buttonByName(container, 'Delete budget'));
    await flush();

    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Something went wrong');
  });

  it('warns when deleting the last owned budget', async () => {
    const { container } = await renderSettings({ budgets: [budget({ id: 4, year: 2028, description: 'Solo' })] });

    click(buttonByName(container, 'Delete 2028'));

    expect(container.querySelector('[role="alertdialog"]')?.textContent).toContain(
      'This is your last budget. A new empty budget will be created.'
    );
  });

  it('uses French deletion copy when the account language is French', async () => {
    localStorage.setItem('tallix_locale', 'fr');
    const { container } = await renderSettings();

    click(buttonByName(container, 'Supprimer 2025'));

    expect(container.querySelector('[role="alertdialog"]')?.textContent).toContain('Supprimer définitivement');
  });
});

describe('budget creation settings', () => {
  it('creates a budget without a parent from the user settings form', async () => {
    const onCreateBudget = vi.fn().mockResolvedValue(undefined);
    const { container } = await renderSettings({ onCreateBudget });

    changeInput(container.querySelector<HTMLInputElement>('#new-budget-year')!, '2028');
    changeInput(container.querySelector<HTMLInputElement>('#new-budget-description')!, 'Summer plan');
    submit(container.querySelector<HTMLFormElement>('.user-settings-create-form')!);
    await flush();

    expect(onCreateBudget).toHaveBeenCalledWith(2028, 'Summer plan', null);
  });

  it('creates a budget with the selected owned parent budget', async () => {
    const onCreateBudget = vi.fn().mockResolvedValue(undefined);
    const { container } = await renderSettings({ onCreateBudget });

    changeSelect(container.querySelector<HTMLSelectElement>('#new-budget-parent')!, '2');
    changeInput(container.querySelector<HTMLInputElement>('#new-budget-description')!, 'Tax follow-up');
    submit(container.querySelector<HTMLFormElement>('.user-settings-create-form')!);
    await flush();

    expect(container.querySelector<HTMLInputElement>('#new-budget-year')?.value).toBe('2026');
    expect(onCreateBudget).toHaveBeenCalledWith(2026, 'Tax follow-up', 2);
  });

  it('offers only owned budgets as parent choices', async () => {
    const { container } = await renderSettings();
    const optionLabels = Array.from(
      container.querySelectorAll<HTMLOptionElement>('#new-budget-parent option'),
      (option) => option.textContent?.trim()
    );

    expect(optionLabels).toContain('2026 — Family plan');
    expect(optionLabels).toContain('2025 — Taxes');
    expect(optionLabels).not.toContain('2027 — Shared plan');
  });

  it('does not offer owned budgets from year 9999 as parent choices', async () => {
    const { container } = await renderSettings({
      budgets: [...budgets, budget({ id: 4, year: 9999, description: 'Terminal plan', role: 'owner' })],
    });
    const optionLabels = Array.from(
      container.querySelectorAll<HTMLOptionElement>('#new-budget-parent option'),
      (option) => option.textContent?.trim()
    );

    expect(optionLabels).toContain('2026 — Family plan');
    expect(optionLabels).not.toContain('9999 — Terminal plan');
  });

  it('rejects a parent child budget year that is not the parent year plus one', async () => {
    const onCreateBudget = vi.fn().mockResolvedValue(undefined);
    const { container } = await renderSettings({ onCreateBudget });

    changeSelect(container.querySelector<HTMLSelectElement>('#new-budget-parent')!, '2');
    changeInput(container.querySelector<HTMLInputElement>('#new-budget-year')!, '2027');
    submit(container.querySelector<HTMLFormElement>('.user-settings-create-form')!);
    await flush();

    expect(onCreateBudget).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('A child of this budget must start in 2026.');
  });

  it('rejects invalid creation years before calling the create callback', async () => {
    const onCreateBudget = vi.fn().mockResolvedValue(undefined);
    const { container } = await renderSettings({ onCreateBudget });

    changeInput(container.querySelector<HTMLInputElement>('#new-budget-year')!, '1899');
    submit(container.querySelector<HTMLFormElement>('.user-settings-create-form')!);
    await flush();

    expect(onCreateBudget).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Enter a whole year between 1900 and 9999.');
  });

  it('disables creation controls while a budget is being created', async () => {
    const pending = deferred<void>();
    const { container } = await renderSettings({ onCreateBudget: vi.fn(() => pending.promise) });

    submit(container.querySelector<HTMLFormElement>('.user-settings-create-form')!);
    await flush();

    expect(container.querySelector<HTMLSelectElement>('#new-budget-parent')?.disabled).toBe(true);
    expect(container.querySelector<HTMLInputElement>('#new-budget-year')?.disabled).toBe(true);
    expect(container.querySelector<HTMLInputElement>('#new-budget-description')?.disabled).toBe(true);
    expect(
      container.querySelector<HTMLButtonElement>('.user-settings-create-form button[type="submit"]')?.disabled
    ).toBe(true);

    pending.resolve();
    await flush();
  });

  it('keeps the creation form values and shows an error when budget creation fails', async () => {
    const onCreateBudget = vi.fn().mockRejectedValue(new Error('network down'));
    const { container } = await renderSettings({ onCreateBudget });

    changeInput(container.querySelector<HTMLInputElement>('#new-budget-year')!, '2028');
    changeInput(container.querySelector<HTMLInputElement>('#new-budget-description')!, 'Summer plan');
    submit(container.querySelector<HTMLFormElement>('.user-settings-create-form')!);
    await flush();

    expect(onCreateBudget).toHaveBeenCalledWith(2028, 'Summer plan', null);
    expect(container.querySelector<HTMLInputElement>('#new-budget-year')?.value).toBe('2028');
    expect(container.querySelector<HTMLInputElement>('#new-budget-description')?.value).toBe('Summer plan');
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('Something went wrong');
  });
});
