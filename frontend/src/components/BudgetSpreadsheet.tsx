import React, { useMemo, useState } from 'react';
import { useI18n } from '../contexts/I18nContext';
import { useSettings } from '../contexts/SettingsContext';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import type { BudgetSection, MonthlyValue } from '../types';
import { calculateAnnualTotals, calculateGroupTotals, calculateSectionTotals } from '../utils';

interface BudgetSpreadsheetProps {
  sections: BudgetSection[];
  months: string[];
  paymentAccountsInitialBalance: number; // Total initial balance of payment method accounts
}

interface FundsSummary {
  startOfMonth: MonthlyValue[]; // Funds at start of each month (index 0 = Jan)
  endOfMonth: MonthlyValue[]; // Funds at end of each month
  expectedEndOfMonth: number[]; // Expected end of month using max(budget, actual) for current month
}

// Determine variance class based on budget vs actual
function getVarianceClass(budget: number, actual: number, moreIsGood: boolean): string {
  if (budget === 0) return '';

  const variance = actual - budget;
  const variancePercent = Math.abs(variance / budget) * 100;

  // For income/savings: over is good, under is bad
  // For expenses: under is good, over is bad
  if (moreIsGood) {
    if (variance > 0 && variancePercent >= 5) return 'variance-positive';
    if (variance < 0 && variancePercent >= 5) return 'variance-negative';
  } else {
    if (variance < 0 && variancePercent >= 5) return 'variance-positive';
    if (variance > 0 && variancePercent >= 5) return 'variance-negative';
  }
  return '';
}

// Build tooltip content
function buildTooltip(
  budget: number,
  actual: number,
  formatCurrency: (v: number, s?: boolean) => string,
  t: (key: string, params?: Record<string, any>) => string
): string {
  if (actual === 0 && budget === 0) return '';

  const variance = actual - budget;
  const variancePercent = budget !== 0 ? ((variance / budget) * 100).toFixed(0) : '0';
  const sign = variance > 0 ? '+' : '';

  return t('spreadsheet.tooltip', {
    budget: formatCurrency(budget, true),
    actual: formatCurrency(actual, true),
    variance: `${sign}${formatCurrency(variance, true)}`,
    percent: `${sign}${variancePercent}%`,
  });
}

export default function BudgetSpreadsheet({ sections, months, paymentAccountsInitialBalance }: BudgetSpreadsheetProps) {
  const formatCurrency = useFormatCurrency();
  const { showBudgetBelowActual } = useSettings();
  const { t } = useI18n();
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<number>>(new Set());

  // Current month (0-indexed, so January = 0)
  const currentMonth = new Date().getMonth();
  // Show actual values up to current month + 1 (so if in Jan, show Jan and Feb)
  const maxActualMonth = currentMonth + 1; // 0-indexed, so currentMonth + 1 means up to next month

  // Render a single cell with either budget or actual, with variance coloring
  const renderMonthCell = (
    budget: number,
    actual: number,
    monthIndex: number,
    moreIsGood: boolean,
    key: number | string
  ) => {
    const hasActual = actual !== 0;
    const isFutureMonth = monthIndex > maxActualMonth;
    const isCurrentOrPastMonth = !isFutureMonth;

    // For current/past months with no actual but has budget: show 0 as actual with budget hint
    const showZeroWithBudgetHint = isCurrentOrPastMonth && !hasActual && budget !== 0;

    // Show budget for future months, else show actual (or 0 if no actual)
    const displayValue = isFutureMonth ? budget : actual;

    // Apply variance coloring for actual values, including 0 when there's a budget
    const shouldShowVariance = !isFutureMonth && (hasActual || showZeroWithBudgetHint);
    const varianceClass = shouldShowVariance ? getVarianceClass(budget, actual, moreIsGood) : '';
    const isBudgetValue = isFutureMonth;

    // Show tooltip for current/past months with actual or budget data
    const showTooltip = !isFutureMonth && (hasActual || showZeroWithBudgetHint) && budget !== 0;
    const tooltip = showTooltip ? buildTooltip(budget, actual, formatCurrency, t) : '';

    // Show budget hint below when:
    // 1. Setting is enabled and has actual with budget, OR
    // 2. Current/past month with no actual but has budget
    const showBudgetBelow =
      (showBudgetBelowActual && hasActual && !isFutureMonth && budget !== 0) || showZeroWithBudgetHint;

    // Show 0 instead of dash only when there's a budget but no actual
    const showZeroValue = showZeroWithBudgetHint;

    return (
      <td
        key={key}
        className={`cell ${isBudgetValue ? 'budget-value' : 'actual-value'} ${varianceClass} ${tooltip ? 'has-tooltip' : ''}`}
        data-tooltip={tooltip || undefined}
      >
        <div className="cell-content">
          <span className="cell-main-value">{formatCurrency(displayValue, showZeroValue)}</span>
          {showBudgetBelow && <span className="cell-budget-hint">→ {formatCurrency(budget)}</span>}
        </div>
      </td>
    );
  };

  // Calculate funds summary (payment accounts only, excluding savings)
  const fundsSummary = useMemo((): FundsSummary => {
    // Get section totals
    const incomeSection = sections.find((s) => s.type === 'income');
    const expenseSection = sections.find((s) => s.type === 'expense');

    const incomeTotals = incomeSection ? calculateSectionTotals(incomeSection.groups) : null;
    const expenseTotals = expenseSection ? calculateSectionTotals(expenseSection.groups) : null;

    // Calculate remaining yearly budgets (variable spending) for each section
    // This is: yearlyBudget - actual spent so far (but not less than 0)
    const calculateRemainingYearlyBudget = (section: typeof incomeSection) => {
      if (!section) return 0;
      return section.groups.reduce(
        (total, group) =>
          total +
          group.items.reduce((itemTotal, item) => {
            const yearlyBudget = item.yearlyBudget || 0;
            if (yearlyBudget === 0) return itemTotal;
            // Sum up actual spending for this item across all months
            const actualSpent = item.months.reduce((sum, m) => sum + m.actual, 0);
            // Remaining budget = yearly budget - actual spent (can be negative if overspent)
            const remaining = yearlyBudget - actualSpent;
            return itemTotal + remaining;
          }, 0),
        0
      );
    };
    const incomeRemainingYearlyBudget = calculateRemainingYearlyBudget(incomeSection);
    const expenseRemainingYearlyBudget = calculateRemainingYearlyBudget(expenseSection);

    // Calculate expected totals for projection
    // If category has actual spending, use actual. Otherwise use budget.
    const calculateExpectedSectionTotal = (section: typeof incomeSection, monthIndex: number) => {
      if (!section) return 0;
      return section.groups.reduce(
        (total, group) =>
          total +
          group.items.reduce((itemTotal, item) => {
            const budget = item.months[monthIndex]?.budget || 0;
            const actual = item.months[monthIndex]?.actual || 0;
            // If there's actual data, use it. Otherwise fall back to budget.
            const expected = actual !== 0 ? actual : budget;
            return itemTotal + expected;
          }, 0),
        0
      );
    };

    const startOfMonth: MonthlyValue[] = [];
    const endOfMonth: MonthlyValue[] = [];
    const expectedEndOfMonth: number[] = [];

    let cumulativeActual = paymentAccountsInitialBalance;

    for (let i = 0; i < 12; i++) {
      // Monthly cash flow = Income - Expenses
      const monthIncomeBudget = incomeTotals?.months[i]?.budget || 0;
      const monthIncomeActual = incomeTotals?.months[i]?.actual || 0;
      const monthExpenseBudget = expenseTotals?.months[i]?.budget || 0;
      const monthExpenseActual = expenseTotals?.months[i]?.actual || 0;

      // For budget start of month:
      // - If previous month has actual data (i-1 <= maxActualMonth), use previous month's actual end balance
      // - Otherwise use the projected budget from previous month
      const budgetStartOfMonth =
        i === 0
          ? paymentAccountsInitialBalance
          : i - 1 <= maxActualMonth
            ? endOfMonth[i - 1].actual // Use previous month's actual end balance
            : endOfMonth[i - 1].budget; // Use previous month's projected budget

      startOfMonth.push({
        budget: budgetStartOfMonth,
        actual: cumulativeActual,
      });

      // Calculate end of month
      cumulativeActual += monthIncomeActual - monthExpenseActual;

      // Budget end = budget start + planned cash flow for this month
      let budgetEndOfMonth = budgetStartOfMonth + monthIncomeBudget - monthExpenseBudget;

      // In December (last month), add remaining yearly budgets to the projection
      // This accounts for variable spending that hasn't happened yet
      if (i === 11) {
        budgetEndOfMonth += incomeRemainingYearlyBudget - expenseRemainingYearlyBudget;
      }

      endOfMonth.push({
        budget: budgetEndOfMonth,
        actual: cumulativeActual,
      });

      // Calculate expected end of month using max(budget, actual) for each category
      // This gives a realistic projection: if we've underspent, assume we'll spend the budget
      // If we've overspent, use the actual amount
      const expectedIncome = calculateExpectedSectionTotal(incomeSection, i);
      const expectedExpense = calculateExpectedSectionTotal(expenseSection, i);

      // Expected = start of month actual + expected income - expected expenses
      const expected = startOfMonth[i].actual + expectedIncome - expectedExpense;
      expectedEndOfMonth.push(expected);
    }

    return { startOfMonth, endOfMonth, expectedEndOfMonth };
  }, [sections, paymentAccountsInitialBalance, maxActualMonth]);

  const toggleSection = (sectionType: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(sectionType)) {
        next.delete(sectionType);
      } else {
        next.add(sectionType);
      }
      return next;
    });
  };

  const toggleGroup = (groupId: number) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  };

  const getSectionColor = (type: string) => {
    switch (type) {
      case 'income':
        return '#10b981';
      case 'expense':
        return '#ef4444';
      default:
        return '#64748b';
    }
  };

  return (
    <div className="spreadsheet-container">
      <div className="spreadsheet-wrapper">
        <table className="spreadsheet single-column">
          <thead>
            <tr>
              <th className="col-category">{t('spreadsheet.category')}</th>
              <th className="col-annual" colSpan={2}>
                {t('spreadsheet.annual')}
              </th>
              {months.map((month) => (
                <th key={month} className="col-month">
                  {month}
                </th>
              ))}
            </tr>
            <tr className="sub-header">
              <th></th>
              <th className="budget">{t('spreadsheet.budget')}</th>
              <th className="actual">{t('spreadsheet.actual')}</th>
              {months.map((month, i) => (
                <th key={month} className={i <= maxActualMonth ? 'actual' : 'budget'}>
                  {i <= maxActualMonth ? t('spreadsheet.actualShort') : t('spreadsheet.budgetShort')}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Funds Summary Section */}
            <tr className="funds-summary-header">
              <td className="category-name" colSpan={3 + months.length}>
                {t('spreadsheet.fundsAvailable')}
              </td>
            </tr>
            <tr className="funds-summary-row start-of-month">
              <td className="category-name">{t('spreadsheet.startOfMonth')}</td>
              <td className="cell budget">–</td>
              <td className="cell actual">–</td>
              {fundsSummary.startOfMonth.map((m, i) => {
                const isFuture = i > maxActualMonth;
                const value = isFuture ? m.budget : m.actual;
                const tooltip = !isFuture ? buildTooltip(m.budget, m.actual, formatCurrency, t) : '';
                return (
                  <td
                    key={i}
                    className={`cell ${isFuture ? 'budget-value' : 'actual-value'} ${value < 0 ? 'negative' : ''} ${tooltip ? 'has-tooltip' : ''}`}
                    data-tooltip={tooltip || undefined}
                  >
                    {formatCurrency(value, true)}
                  </td>
                );
              })}
            </tr>
            <tr className="funds-summary-row end-of-month">
              <td className="category-name">{t('spreadsheet.endOfMonth')}</td>
              <td className="cell budget">–</td>
              <td className="cell actual">–</td>
              {fundsSummary.endOfMonth.map((m, i) => {
                const isFuture = i > maxActualMonth;
                const value = isFuture ? m.budget : m.actual;
                const expectedValue = fundsSummary.expectedEndOfMonth[i];

                // Show expected hint for any month with actual data where expected differs from actual
                const showExpectedHint = !isFuture && expectedValue !== value;

                return (
                  <td
                    key={i}
                    className={`cell ${isFuture ? 'budget-value' : 'actual-value'} ${value < 0 ? 'negative' : ''}`}
                  >
                    {showExpectedHint ? (
                      <div className="cell-content">
                        <span className="cell-main-value">{formatCurrency(value, true)}</span>
                        <span className="cell-expected-hint" title={t('spreadsheet.estimatedEndOfMonth')}>
                          → {formatCurrency(expectedValue, true)}
                        </span>
                      </div>
                    ) : (
                      formatCurrency(value, true)
                    )}
                  </td>
                );
              })}
            </tr>
            <tr className="funds-summary-spacer">
              <td colSpan={3 + months.length}></td>
            </tr>

            {sections.map((section) => {
              const sectionTotals = calculateSectionTotals(section.groups);
              const isCollapsed = collapsedSections.has(section.type);
              const color = getSectionColor(section.type);
              // For income: more is good. For expenses: less is good.
              const moreIsGood = section.type === 'income';

              return (
                <React.Fragment key={section.type}>
                  {/* Section Header Row */}
                  <tr className="section-row" style={{ '--section-color': color } as React.CSSProperties}>
                    <td className="category-name section-name" onClick={() => toggleSection(section.type)}>
                      <span className={`chevron ${isCollapsed ? 'collapsed' : ''}`}>▼</span>
                      {section.name}
                    </td>
                    <td className="cell budget">{formatCurrency(sectionTotals.annual.budget, true)}</td>
                    <td className="cell actual">{formatCurrency(sectionTotals.annual.actual, true)}</td>
                    {sectionTotals.months.map((m, i) => renderMonthCell(m.budget, m.actual, i, moreIsGood, i))}
                  </tr>

                  {/* Groups and Items */}
                  {!isCollapsed &&
                    section.groups.map((group) => {
                      const groupTotals = calculateGroupTotals(group.items);
                      const isGroupCollapsed = collapsedGroups.has(group.id);

                      return (
                        <React.Fragment key={group.id}>
                          {/* Group Row */}
                          <tr className="group-row">
                            <td className="category-name group-name" onClick={() => toggleGroup(group.id)}>
                              <span className={`chevron ${isGroupCollapsed ? 'collapsed' : ''}`}>▼</span>
                              {group.name}
                            </td>
                            <td className="cell budget">{formatCurrency(groupTotals.annual.budget, true)}</td>
                            <td className="cell actual">{formatCurrency(groupTotals.annual.actual, true)}</td>
                            {groupTotals.months.map((m, i) => renderMonthCell(m.budget, m.actual, i, moreIsGood, i))}
                          </tr>

                          {/* Item Rows */}
                          {!isGroupCollapsed &&
                            group.items.map((item) => {
                              const monthlyTotal = calculateAnnualTotals(item.months);
                              const totalBudget = monthlyTotal.budget + (item.yearlyBudget || 0);
                              const yearlyBudget = item.yearlyBudget || 0;

                              // Color class for actual based on yearly budget usage
                              let actualColorClass = '';
                              if (yearlyBudget > 0) {
                                const usedPercent = (monthlyTotal.actual / yearlyBudget) * 100;
                                if (usedPercent >= 100) {
                                  actualColorClass = 'over-budget';
                                } else if (usedPercent >= 75) {
                                  actualColorClass = 'warning';
                                }
                              }

                              return (
                                <tr key={item.id} className="item-row">
                                  <td className="category-name item-name">{item.name}</td>
                                  <td className="cell budget">{formatCurrency(totalBudget)}</td>
                                  <td className={`cell actual ${actualColorClass}`}>
                                    {formatCurrency(monthlyTotal.actual)}
                                  </td>
                                  {item.months.map((m, i) => renderMonthCell(m.budget, m.actual, i, moreIsGood, i))}
                                </tr>
                              );
                            })}
                        </React.Fragment>
                      );
                    })}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
