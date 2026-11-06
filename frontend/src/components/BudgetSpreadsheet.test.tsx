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

describe('available funds forecasts', () => {
  it.each([
    ['income', false],
    ['income', true],
    ['expense', false],
    ['expense', true],
    ['savings', false],
    ['savings', true],
  ] as const)('carries each future-year %s forecast into the next month (account balances: %s)', (type, withBalances) => {
    const container = renderSpreadsheet({
      sections: sections(type),
      year: 2027,
      lastActiveMonth: 12,
      paymentAccountsMonthlyBalances: withBalances ? Array.from({ length: 12 }, (_, i) => 1000 + i * 25) : undefined,
    });
    const starts = monthCells(container, '.start-of-month');
    const ends = monthCells(container, '.end-of-month');
    const cashFlow = type === 'income' ? 100 : -100;

    for (let i = 0; i < 12; i++) {
      expect(starts[i].textContent).toBe(formatCurrency(1000 + i * cashFlow, true));
      expect(ends[i].textContent).toBe(formatCurrency(1000 + (i + 1) * cashFlow, true));
      if (i > 0) expect(starts[i].textContent).toBe(ends[i - 1].textContent);
    }
  });

  it.each([2025, 2026])('continues forecasts after the last actual month in %i', (year) => {
    const container = renderSpreadsheet({ year, lastActiveMonth: 9 });
    const starts = monthCells(container, '.start-of-month');
    const ends = monthCells(container, '.end-of-month');

    // September's actual expense is 25; October's recorded 40 stays outside the forecast.
    expect(starts[8].textContent).toBe(formatCurrency(1000, true));
    expect(ends[8].textContent).toBe(formatCurrency(975, true));
    for (let i = 9; i < 12; i++) {
      expect(starts[i].textContent).toBe(formatCurrency(975 - (i - 9) * 100, true));
      expect(ends[i].textContent).toBe(formatCurrency(875 - (i - 9) * 100, true));
    }
  });

  it('projects changing income, expenses, savings and remaining annual budgets together', () => {
    const plannedSections = (['income', 'expense', 'savings'] as const).flatMap((type) => {
      const result = sections(type);
      const item = result[0].groups[0].items[0];
      item.months = Array.from({ length: 12 }, (_, i) => ({
        budget: type === 'income' ? 200 + i * 10 : type === 'expense' ? 100 : 25,
        actual: 0,
      }));
      item.yearlyBudget = type === 'expense' ? 250 : 0;
      return result;
    });
    const container = renderSpreadsheet({ sections: plannedSections, year: 2027 });
    const starts = monthCells(container, '.start-of-month');
    const ends = monthCells(container, '.end-of-month');
    let balance = 1000;

    for (let i = 0; i < 12; i++) {
      expect(starts[i].textContent).toBe(formatCurrency(balance, true));
      balance += 75 + i * 10;
      if (i === 11) balance -= 250;
      expect(ends[i].textContent).toBe(formatCurrency(balance, true));
    }
  });
});
