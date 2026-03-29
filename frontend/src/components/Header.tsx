import { useI18n } from '../contexts/I18nContext';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import type { AnnualTotals } from '../types';

interface ExpectedBreakdown {
  monthlyByMonth: number[];
  monthlyExpected: number;
  yearlyRemaining: number;
}

interface HeaderProps {
  year: number;
  months: string[];
  initialBalance: number;
  totalIncome: AnnualTotals;
  totalExpenses: AnnualTotals;
  totalSavings: AnnualTotals;
  expectedIncome: number;
  expectedExpenses: number;
  expectedSavings: number;
  expectedIncomeBreakdown: ExpectedBreakdown;
  expectedExpensesBreakdown: ExpectedBreakdown;
  expectedSavingsBreakdown: ExpectedBreakdown;
  remainingBalance: number;
}

export default function Header({
  year,
  months,
  initialBalance,
  totalIncome,
  totalExpenses,
  totalSavings,
  expectedIncome,
  expectedExpenses,
  expectedSavings,
  expectedIncomeBreakdown,
  expectedExpensesBreakdown,
  expectedSavingsBreakdown,
  remainingBalance,
}: HeaderProps) {
  const formatCurrency = useFormatCurrency();
  const { t } = useI18n();
  const buildExpectedTooltip = (breakdown: ExpectedBreakdown, total: number) => {
    const monthLines = (months.length === 12 ? months : Array(12).fill(0).map((_, i) => `M${i + 1}`))
      .map((month, i) => `${month}: ${formatCurrency(breakdown.monthlyByMonth[i] || 0, true)}`)
      .join('\n');

    return t('header.expectedTooltip', {
      monthLines,
      monthlyExpected: formatCurrency(breakdown.monthlyExpected, true),
      yearlyRemaining: formatCurrency(breakdown.yearlyRemaining, true),
      total: formatCurrency(total, true),
    });
  };

  return (
    <header className="header">
      <div className="header-left">
        <h1 className="page-title">{t('header.budgetTitle', { year })}</h1>
      </div>
      <div className="header-right">
        <div className="balance-card">
          <span className="balance-label">{t('header.initialBalance')}</span>
          <span className="balance-value">{formatCurrency(initialBalance, true)}</span>
        </div>
        <div className="balance-card income">
          <span className="balance-label">{t('header.income')}</span>
          <span className="balance-amounts">
            <span className="balance-value">{formatCurrency(totalIncome.actual, true)}</span>
            <span className="balance-divider">/</span>
            <span
              className="balance-budget with-tooltip"
              data-tooltip={buildExpectedTooltip(expectedIncomeBreakdown, expectedIncome)}
              tabIndex={0}
            >
              {formatCurrency(expectedIncome, true)}
            </span>
          </span>
        </div>
        <div className="balance-card expense">
          <span className="balance-label">{t('header.expenses')}</span>
          <span className="balance-amounts">
            <span className="balance-value">{formatCurrency(totalExpenses.actual, true)}</span>
            <span className="balance-divider">/</span>
            <span
              className="balance-budget with-tooltip"
              data-tooltip={buildExpectedTooltip(expectedExpensesBreakdown, expectedExpenses)}
              tabIndex={0}
            >
              {formatCurrency(expectedExpenses, true)}
            </span>
          </span>
        </div>
        <div className="balance-card savings">
          <span className="balance-label">{t('header.savings')}</span>
          <span className="balance-amounts">
            <span className="balance-value">{formatCurrency(totalSavings.actual, true)}</span>
            <span className="balance-divider">/</span>
            <span
              className="balance-budget with-tooltip"
              data-tooltip={buildExpectedTooltip(expectedSavingsBreakdown, expectedSavings)}
              tabIndex={0}
            >
              {formatCurrency(expectedSavings, true)}
            </span>
          </span>
        </div>
        <div className={`balance-card total ${remainingBalance >= 0 ? 'positive' : 'negative'}`}>
          <span className="balance-label">{t('header.yearEndBalance')}</span>
          <span className="balance-value">{formatCurrency(remainingBalance, true)}</span>
        </div>
      </div>
    </header>
  );
}
