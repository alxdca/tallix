import React, { useMemo, useState } from 'react';
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
}

export default function BudgetSpreadsheet({ sections, months, paymentAccountsInitialBalance }: BudgetSpreadsheetProps) {
  const formatCurrency = useFormatCurrency();
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<number>>(new Set());

  // Current month (0-indexed, so January = 0)
  const currentMonth = new Date().getMonth();
  // Show actual values up to current month + 1 (so if in Jan, show Jan and Feb)
  const maxActualMonth = currentMonth + 1; // 0-indexed, so currentMonth + 1 means up to next month

  // Calculate funds summary (payment accounts only, excluding savings)
  const fundsSummary = useMemo((): FundsSummary => {
    // Get section totals
    const incomeSection = sections.find((s) => s.type === 'income');
    const expenseSection = sections.find((s) => s.type === 'expense');
    const savingsSection = sections.find((s) => s.type === 'savings');

    const incomeTotals = incomeSection ? calculateSectionTotals(incomeSection.groups) : null;
    const expenseTotals = expenseSection ? calculateSectionTotals(expenseSection.groups) : null;
    const savingsTotals = savingsSection ? calculateSectionTotals(savingsSection.groups) : null;

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
    const savingsRemainingYearlyBudget = calculateRemainingYearlyBudget(savingsSection);

    const startOfMonth: MonthlyValue[] = [];
    const endOfMonth: MonthlyValue[] = [];

    let cumulativeActual = paymentAccountsInitialBalance;

    for (let i = 0; i < 12; i++) {
      // Monthly cash flow = Income - Expenses - Savings
      const monthIncomeBudget = incomeTotals?.months[i]?.budget || 0;
      const monthIncomeActual = incomeTotals?.months[i]?.actual || 0;
      const monthExpenseBudget = expenseTotals?.months[i]?.budget || 0;
      const monthExpenseActual = expenseTotals?.months[i]?.actual || 0;
      const monthSavingsBudget = savingsTotals?.months[i]?.budget || 0;
      const monthSavingsActual = savingsTotals?.months[i]?.actual || 0;

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
      cumulativeActual += monthIncomeActual - monthExpenseActual - monthSavingsActual;

      // Budget end = budget start + planned cash flow for this month
      let budgetEndOfMonth = budgetStartOfMonth + monthIncomeBudget - monthExpenseBudget - monthSavingsBudget;

      // In December (last month), add remaining yearly budgets to the projection
      // This accounts for variable spending that hasn't happened yet
      if (i === 11) {
        budgetEndOfMonth += incomeRemainingYearlyBudget - expenseRemainingYearlyBudget - savingsRemainingYearlyBudget;
      }

      endOfMonth.push({
        budget: budgetEndOfMonth,
        actual: cumulativeActual,
      });
    }

    return { startOfMonth, endOfMonth };
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
      case 'savings':
        return '#3b82f6';
      default:
        return '#64748b';
    }
  };

  return (
    <div className="spreadsheet-container">
      <div className="spreadsheet-wrapper">
        <table className="spreadsheet">
          <thead>
            <tr>
              <th className="col-category">Catégorie</th>
              <th className="col-annual" colSpan={2}>
                Annuel
              </th>
              {months.map((month) => (
                <th key={month} className="col-month" colSpan={2}>
                  {month}
                </th>
              ))}
            </tr>
            <tr className="sub-header">
              <th></th>
              <th className="budget">Budget</th>
              <th className="actual">Réel</th>
              {months.map((month) => (
                <React.Fragment key={month}>
                  <th className="budget">B</th>
                  <th className="actual">R</th>
                </React.Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {/* Funds Summary Section */}
            <tr className="funds-summary-header">
              <td className="category-name" colSpan={3 + months.length * 2}>
                Fonds Disponibles (Comptes de paiement)
              </td>
            </tr>
            <tr className="funds-summary-row start-of-month">
              <td className="category-name">Début du mois</td>
              <td className="cell budget">{formatCurrency(paymentAccountsInitialBalance, true)}</td>
              <td className="cell actual">{formatCurrency(paymentAccountsInitialBalance, true)}</td>
              {fundsSummary.startOfMonth.map((m, i) => (
                <React.Fragment key={i}>
                  <td className={`cell budget ${m.budget < 0 ? 'negative' : ''}`}>{formatCurrency(m.budget, true)}</td>
                  <td className={`cell actual ${i <= maxActualMonth && m.actual < 0 ? 'negative' : ''}`}>
                    {i <= maxActualMonth ? formatCurrency(m.actual, true) : '–'}
                  </td>
                </React.Fragment>
              ))}
            </tr>
            <tr className="funds-summary-row end-of-month">
              <td className="category-name">Fin du mois</td>
              <td className="cell budget">{formatCurrency(fundsSummary.endOfMonth[11]?.budget || 0, true)}</td>
              <td className="cell actual">
                {formatCurrency(fundsSummary.endOfMonth[maxActualMonth]?.actual || 0, true)}
              </td>
              {fundsSummary.endOfMonth.map((m, i) => (
                <React.Fragment key={i}>
                  <td className={`cell budget ${m.budget < 0 ? 'negative' : ''}`}>{formatCurrency(m.budget, true)}</td>
                  <td className={`cell actual ${i <= maxActualMonth && m.actual < 0 ? 'negative' : ''}`}>
                    {i <= maxActualMonth ? formatCurrency(m.actual, true) : '–'}
                  </td>
                </React.Fragment>
              ))}
            </tr>
            <tr className="funds-summary-spacer">
              <td colSpan={3 + months.length * 2}></td>
            </tr>

            {sections.map((section) => {
              const sectionTotals = calculateSectionTotals(section.groups);
              const isCollapsed = collapsedSections.has(section.type);
              const color = getSectionColor(section.type);

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
                    {sectionTotals.months.map((m, i) => (
                      <React.Fragment key={i}>
                        <td className="cell budget">{formatCurrency(m.budget)}</td>
                        <td className="cell actual">{formatCurrency(m.actual)}</td>
                      </React.Fragment>
                    ))}
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
                            {groupTotals.months.map((m, i) => (
                              <React.Fragment key={i}>
                                <td className="cell budget">{formatCurrency(m.budget)}</td>
                                <td className="cell actual">{formatCurrency(m.actual)}</td>
                              </React.Fragment>
                            ))}
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
                                  {item.months.map((m, i) => (
                                    <React.Fragment key={i}>
                                      <td className="cell budget">{formatCurrency(m.budget)}</td>
                                      <td className="cell actual">{formatCurrency(m.actual)}</td>
                                    </React.Fragment>
                                  ))}
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
