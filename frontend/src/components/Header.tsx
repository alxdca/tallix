import { useI18n } from '../contexts/I18nContext';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import type { AnnualTotals } from '../types';

interface HeaderProps {
  year: number;
  initialBalance: number;
  totalIncome: AnnualTotals;
  totalExpenses: AnnualTotals;
  remainingBalance: number;
}

export default function Header({ year, initialBalance, totalIncome, totalExpenses, remainingBalance }: HeaderProps) {
  const formatCurrency = useFormatCurrency();
  const { t } = useI18n();

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
            <span className="balance-budget">/ {formatCurrency(totalIncome.budget, true)}</span>
          </span>
        </div>
        <div className="balance-card expense">
          <span className="balance-label">{t('header.expenses')}</span>
          <span className="balance-amounts">
            <span className="balance-value">{formatCurrency(totalExpenses.actual, true)}</span>
            <span className="balance-budget">/ {formatCurrency(totalExpenses.budget, true)}</span>
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
