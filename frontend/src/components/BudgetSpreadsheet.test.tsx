import type { ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../contexts/I18nContext';
import { SettingsProvider } from '../contexts/SettingsContext';
import { getMonthNames } from '../i18n';
import type { BudgetSection, GroupType } from '../types';
import { formatCurrency } from '../utils';
import BudgetSpreadsheet from './BudgetSpreadsheet';

function sections(type: GroupType = 'expense'): BudgetSection[] {
  return [
    {
      type,
      name: type,
      groups: [
        {
          id: 1,
          name: 'Group',
          slug: 'group',
          type,
          sortOrder: 0,
          items: [
            {
              id: 1,
              name: 'Item',
              slug: 'item',
              yearlyBudget: 0,
              months: Array.from({ length: 12 }, (_, i) => ({ budget: 100, actual: i === 8 ? 25 : i === 9 ? 40 : 0 })),
            },
          ],
        },
      ],
    },
  ];
}

function renderSpreadsheet(overrides: Partial<ComponentProps<typeof BudgetSpreadsheet>> = {}) {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(
    <I18nProvider>
      <SettingsProvider>
        <BudgetSpreadsheet
          sections={sections()}
          year={2026}
          months={getMonthNames('en')}
          paymentAccountsInitialBalance={1000}
          lastActiveMonth={10}
          {...overrides}
        />
      </SettingsProvider>
    </I18nProvider>
  );
  return container;
}

function monthCells(container: HTMLElement, selector: string) {
  return Array.from(container.querySelectorAll(`${selector} > th, ${selector} > td`)).slice(3);
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('tallix_locale', 'en');
  localStorage.setItem('showBudgetBelowActual', 'true');
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 29, 12));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('budget spreadsheet month display', () => {
  it.each([
    'income',
    'expense',
    'savings',
  ] as const)('keeps future months as Budget despite recorded %s activity', (type) => {
    const container = renderSpreadsheet({ sections: sections(type) });
    const headers = monthCells(container, '.sub-header');
    expect(headers.map((header) => header.textContent)).toEqual([...Array(9).fill('A'), ...Array(3).fill('B')]);

    for (const selector of ['.section-row', '.group-row', '.item-row']) {
      const october = monthCells(container, selector)[9];
      expect(october.classList.contains('budget-value')).toBe(true);
      expect(october.textContent).toBe(formatCurrency(100));
      expect(october.hasAttribute('data-tooltip')).toBe(false);
      expect(october.querySelector('.cell-budget-hint')).toBeNull();
    }

    for (const selector of ['.start-of-month', '.end-of-month']) {
      expect(monthCells(container, selector)[9].classList.contains('budget-value')).toBe(true);
    }
    expect(monthCells(container, '.start-of-month')[9].textContent).toBe(
      formatCurrency(type === 'income' ? 1025 : 975, true)
    );
    expect(monthCells(container, '.end-of-month')[9].textContent).toBe(
      formatCurrency(type === 'income' ? 1125 : 875, true)
    );
    const september = monthCells(container, '.item-row')[8];
    expect(september.classList.contains('actual-value')).toBe(true);
    expect(september.querySelector('.cell-main-value')?.textContent).toBe(formatCurrency(25));
  });

  it('switches October to Actual when October starts', () => {
    vi.setSystemTime(new Date(2026, 9, 1, 0));
    const container = renderSpreadsheet();
    const headers = monthCells(container, '.sub-header');
    expect(headers[9].textContent).toBe('A');
    expect(headers[10].textContent).toBe('B');
    expect(monthCells(container, '.item-row')[9].querySelector('.cell-main-value')?.textContent).toBe(
      formatCurrency(40)
    );
  });

  it('shows current and past months as Actual even without activity', () => {
    const container = renderSpreadsheet({ sections: [], lastActiveMonth: 0 });
    expect(monthCells(container, '.sub-header').map((header) => header.textContent)).toEqual([
      ...Array(9).fill('A'),
      ...Array(3).fill('B'),
    ]);
  });

  it('keeps every month of a future year as Budget even with recorded activity', () => {
    const container = renderSpreadsheet({ year: 2027, lastActiveMonth: 12 });
    expect(monthCells(container, '.sub-header').map((header) => header.textContent)).toEqual(Array(12).fill('B'));
    expect(monthCells(container, '.item-row').every((cell) => cell.classList.contains('budget-value'))).toBe(true);
  });

  it('preserves historical years using their last active month', () => {
    const container = renderSpreadsheet({ year: 2025, lastActiveMonth: 10 });
    expect(monthCells(container, '.sub-header').map((header) => header.textContent)).toEqual([
      ...Array(10).fill('A'),
      ...Array(2).fill('B'),
    ]);
  });
});
