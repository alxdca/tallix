import type { ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { I18nProvider } from '../contexts/I18nContext';
import { SettingsProvider } from '../contexts/SettingsContext';
import { formatCurrency } from '../utils';
import Header from './Header';

const breakdown = (monthlyExpected: number, yearlyRemaining = 0) => ({
  monthlyByMonth: Array(12).fill(monthlyExpected / 12),
  monthlyExpected,
  yearlyRemaining,
});

const props: ComponentProps<typeof Header> = {
  year: 2026,
  months: [],
  initialBalance: 1000,
  totalIncome: { actual: 15000, budget: 50000 },
  totalExpenses: { actual: 10000, budget: 47000 },
  totalSavings: { actual: 2000, budget: 6500 },
  expectedIncome: 50000,
  expectedExpenses: 47000,
  expectedSavings: 6500,
  expectedIncomeBreakdown: breakdown(48000, 2000),
  expectedExpensesBreakdown: breakdown(36000, 11000),
  expectedSavingsBreakdown: breakdown(6000, 500),
  remainingBalance: -2500,
};

function renderCard(overrides: Partial<ComponentProps<typeof Header>> = {}) {
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(
    <I18nProvider>
      <SettingsProvider>
        <Header {...props} {...overrides} />
      </SettingsProvider>
    </I18nProvider>
  );
  return container.querySelector('.balance-card.total')!;
}

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('tallix_locale', 'en');
});

describe('year-end balance projections', () => {
  it('keeps the full projection and excludes unspent yearly income, expenses and savings from the monthly projection', () => {
    const card = renderCard();
    const projections = card.querySelectorAll('.balance-projection');

    expect(projections).toHaveLength(2);
    expect(projections[0].textContent).toBe(formatCurrency(-2500, true));
    expect(projections[0].classList.contains('negative')).toBe(true);
    expect(projections[1].textContent).toBe(formatCurrency(7000, true));
    expect(projections[1].classList.contains('positive')).toBe(true);
    expect(projections[1].classList.contains('balance-projection-secondary')).toBe(true);
    expect(card.textContent).toBe(`Year-end balance${formatCurrency(-2500, true)}${formatCurrency(7000, true)}`);
  });

  it('retains actual yearly-category spending when its budget has already been exceeded', () => {
    const card = renderCard({
      initialBalance: 1000,
      expectedIncomeBreakdown: breakdown(10000),
      expectedExpensesBreakdown: breakdown(12000),
      expectedSavingsBreakdown: breakdown(0),
      remainingBalance: -1000,
    });

    expect(Array.from(card.querySelectorAll('.balance-value'), (value) => value.textContent)).toEqual([
      formatCurrency(-1000, true),
      formatCurrency(-1000, true),
    ]);
    expect(card.querySelectorAll('.balance-projection.negative')).toHaveLength(2);
  });

  it('shows zero for both projections when there is no balance or cash flow', () => {
    const card = renderCard({
      initialBalance: 0,
      expectedIncomeBreakdown: breakdown(0),
      expectedExpensesBreakdown: breakdown(0),
      expectedSavingsBreakdown: breakdown(0),
      remainingBalance: 0,
    });

    expect(Array.from(card.querySelectorAll('.balance-value'), (value) => value.textContent)).toEqual(['0.00', '0.00']);
  });

  it('uses the selected language and decimal separator for both projections', () => {
    localStorage.setItem('tallix_locale', 'fr');
    localStorage.setItem('decimalSeparator', ',');
    const card = renderCard({
      initialBalance: 10.25,
      expectedIncomeBreakdown: breakdown(20.5),
      expectedExpensesBreakdown: breakdown(5.1),
      expectedSavingsBreakdown: breakdown(3.05),
      remainingBalance: 2.6,
    });

    expect(card.textContent).toContain("Solde fin d'année");
    expect(card.querySelectorAll('.balance-projection')[0].textContent).toBe('2,60');
    expect(card.querySelectorAll('.balance-projection')[1].textContent).toBe('22,60');
    expect(card.querySelector('[title]')?.getAttribute('title')).toContain('budgets annuels restants');
  });
});
