import type { AnnualTotals, BudgetData, BudgetGroup, BudgetItem, MonthlyValue, OrganizedBudgetData } from './types';

interface SectionLabels {
  income: string;
  expense: string;
  savings: string;
}

// Organize flat budget data into 3-layer hierarchy (income, expenses, and savings)
export function organizeBudgetData(
  data: BudgetData,
  labels: SectionLabels = { income: 'Income', expense: 'Expenses', savings: 'Savings' }
): OrganizedBudgetData {
  const incomeGroups = data.groups.filter((g) => g.type === 'income');
  const expenseGroups = data.groups.filter((g) => g.type === 'expense');
  const savingsGroups = data.groups.filter((g) => g.type === 'savings');

  const sections: OrganizedBudgetData['sections'] = [
    {
      type: 'income',
      name: labels.income,
      groups: incomeGroups,
    },
    {
      type: 'expense',
      name: labels.expense,
      groups: expenseGroups,
    },
  ];

  // Only add savings section if there are savings groups
  if (savingsGroups.length > 0) {
    sections.push({
      type: 'savings',
      name: labels.savings,
      groups: savingsGroups,
    });
  }

  return {
    year: data.year,
    initialBalance: data.initialBalance,
    sections,
  };
}

// Calculate section totals (all groups in a section)
export function calculateSectionTotals(groups: BudgetGroup[]): {
  annual: AnnualTotals;
  months: MonthlyValue[];
} {
  const totals = {
    annual: { budget: 0, actual: 0 },
    months: Array(12)
      .fill(null)
      .map(() => ({ budget: 0, actual: 0 })) as MonthlyValue[],
  };

  groups.forEach((group) => {
    const groupTotals = calculateGroupTotals(group.items);
    totals.annual.budget += groupTotals.annual.budget;
    totals.annual.actual += groupTotals.annual.actual;
    groupTotals.months.forEach((month, i) => {
      totals.months[i].budget += month.budget;
      totals.months[i].actual += month.actual;
    });
  });

  return totals;
}

// Format number as currency with configurable decimal separator
export function formatCurrency(value: number, showZero = false, decimalSeparator: '.' | ',' = '.'): string {
  if (value === 0 && !showZero) return '–';

  // Use en-CH for dot separator, fr-CH for comma separator
  const locale = decimalSeparator === '.' ? 'en-CH' : 'fr-CH';
  const formatted = Math.abs(value).toLocaleString(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

  return value < 0 ? `-${formatted}` : formatted;
}

// Calculate annual totals for an item
export function calculateAnnualTotals(months: MonthlyValue[]): AnnualTotals {
  return months.reduce(
    (acc, m) => ({
      budget: acc.budget + m.budget,
      actual: acc.actual + m.actual,
    }),
    { budget: 0, actual: 0 }
  );
}

// Calculate group totals (includes yearly budgets)
export function calculateGroupTotals(items: BudgetItem[]): {
  annual: AnnualTotals;
  months: MonthlyValue[];
} {
  const totals = {
    annual: { budget: 0, actual: 0 },
    months: Array(12)
      .fill(null)
      .map(() => ({ budget: 0, actual: 0 })) as MonthlyValue[],
  };

  items.forEach((item) => {
    // Add yearly budget to annual total
    totals.annual.budget += item.yearlyBudget || 0;

    item.months.forEach((month, i) => {
      totals.months[i].budget += month.budget;
      totals.months[i].actual += month.actual;
    });
    const annual = calculateAnnualTotals(item.months);
    totals.annual.budget += annual.budget;
    totals.annual.actual += annual.actual;
  });

  return totals;
}

// Date formatting helpers (DD/MM/YYYY <-> YYYY-MM-DD)

// Convert YYYY-MM-DD to DD/MM/YYYY for display
export function formatDateDisplay(isoDate: string): string {
  if (!isoDate) return '';
  // Handle ISO dates with time (e.g., "2026-01-29T00:00:00.000Z")
  const datePart = isoDate.split('T')[0];
  const parts = datePart.split('-');
  if (parts.length !== 3) return isoDate;
  const [year, month, day] = parts;
  return `${day}/${month}/${year}`;
}

// Convert DD/MM/YYYY to YYYY-MM-DD for API/storage
export function parseDateInput(displayDate: string): string {
  if (!displayDate) return '';
  const parts = displayDate.split('/');
  if (parts.length !== 3) return displayDate;
  const [day, month, year] = parts;
  return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
}

// Get today's date in DD/MM/YYYY format
export function getTodayDisplay(): string {
  const today = new Date();
  const day = String(today.getDate()).padStart(2, '0');
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const year = today.getFullYear();
  return `${day}/${month}/${year}`;
}

// Validate DD/MM/YYYY format
export function isValidDateFormat(dateStr: string): boolean {
  const regex = /^\d{2}\/\d{2}\/\d{4}$/;
  if (!regex.test(dateStr)) return false;

  const [day, month, year] = dateStr.split('/').map(Number);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day;
}
