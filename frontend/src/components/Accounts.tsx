import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Title,
  Tooltip,
} from 'chart.js';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Line } from 'react-chartjs-2';
import { type Account, fetchAccounts, setAccountBalance } from '../api';
import { useI18n } from '../contexts/I18nContext';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { logger } from '../utils/logger';

// Register Chart.js components
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

interface AccountsProps {
  year: number;
  months: string[];
  onDataChanged: () => void;
}

interface AccountTotals {
  initialBalance: number;
  monthlyBalances: number[];
  monthlyMovements: number[];
}

type AccountsTab = 'table' | 'chart';

function calculateMonthlyMovements(initialBalance: number, monthlyBalances: number[]): number[] {
  return monthlyBalances.map((balance, i) => {
    const prevBalance = i === 0 ? initialBalance : monthlyBalances[i - 1];
    return balance - prevBalance;
  });
}

function calculateTotals(accountList: Account[]): AccountTotals {
  const initialBalance = accountList.reduce((sum, a) => sum + a.initialBalance, 0);
  const monthlyBalances = Array(12)
    .fill(0)
    .map((_, i) => accountList.reduce((sum, a) => sum + (a.monthlyBalances[i] || 0), 0));
  const monthlyMovements = calculateMonthlyMovements(initialBalance, monthlyBalances);
  return { initialBalance, monthlyBalances, monthlyMovements };
}

export default function Accounts({ year, months, onDataChanged }: AccountsProps) {
  const formatCurrency = useFormatCurrency();
  const { t } = useI18n();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingBalance, setEditingBalance] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<AccountsTab>('table');

  const loadAccounts = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchAccounts(year);
      setAccounts(data);
    } catch (error) {
      logger.error('Failed to load accounts', error);
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  const startEditBalance = (account: Account) => {
    setEditingBalance(account.id);
    setEditValue(account.initialBalance.toString());
  };

  const cancelEdit = () => {
    setEditingBalance(null);
    setEditValue('');
  };

  const saveBalance = async (account: Account) => {
    if (isSubmitting) return;

    const newBalance = parseFloat(editValue);
    if (Number.isNaN(newBalance)) {
      cancelEdit();
      return;
    }

    setIsSubmitting(true);
    try {
      await setAccountBalance(year, account.id, newBalance);
      await loadAccounts();
      onDataChanged();
      cancelEdit();
    } catch (error) {
      logger.error('Failed to save balance', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const savingsAccounts = accounts.filter((a) => a.isSavingsAccount);
  const paymentAccounts = accounts.filter((a) => !a.isSavingsAccount);

  // Calculate totals
  const paymentTotals = useMemo(() => calculateTotals(paymentAccounts), [paymentAccounts]);
  const savingsTotals = useMemo(() => calculateTotals(savingsAccounts), [savingsAccounts]);
  const overallTotals = useMemo(() => calculateTotals(accounts), [accounts]);

  // Chart colors
  const chartColors = [
    { border: 'rgb(59, 130, 246)', background: 'rgba(59, 130, 246, 0.1)' }, // Blue
    { border: 'rgb(16, 185, 129)', background: 'rgba(16, 185, 129, 0.1)' }, // Green
    { border: 'rgb(139, 92, 246)', background: 'rgba(139, 92, 246, 0.1)' }, // Purple
    { border: 'rgb(245, 158, 11)', background: 'rgba(245, 158, 11, 0.1)' }, // Orange
    { border: 'rgb(236, 72, 153)', background: 'rgba(236, 72, 153, 0.1)' }, // Pink
    { border: 'rgb(20, 184, 166)', background: 'rgba(20, 184, 166, 0.1)' }, // Teal
  ];

  const chartData = useMemo(() => {
    const labels = [t('accounts.initial'), ...months.map((m) => m.substring(0, 3))];

    const datasets = accounts.map((account, index) => {
      const color = chartColors[index % chartColors.length];
      return {
        label: account.name,
        data: [account.initialBalance, ...account.monthlyBalances],
        borderColor: color.border,
        backgroundColor: color.background,
        fill: false,
        tension: 0.3,
        pointRadius: 4,
        pointHoverRadius: 6,
      };
    });

    // Add total line
    if (accounts.length > 1) {
      const totalData = [overallTotals.initialBalance, ...overallTotals.monthlyBalances];
      datasets.push({
        label: t('accounts.totalLabel'),
        data: totalData,
        borderColor: 'rgb(255, 255, 255)',
        backgroundColor: 'rgba(255, 255, 255, 0.1)',
        fill: false,
        tension: 0.3,
        pointRadius: 5,
        pointHoverRadius: 7,
      });
    }

    return { labels, datasets };
  }, [accounts, months, overallTotals, t]);

  const chartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index' as const,
        intersect: false,
      },
      plugins: {
        legend: {
          position: 'top' as const,
          labels: {
            color: 'rgb(148, 163, 184)',
            usePointStyle: true,
            padding: 20,
          },
        },
        tooltip: {
          backgroundColor: 'rgba(17, 24, 39, 0.95)',
          titleColor: 'rgb(241, 245, 249)',
          bodyColor: 'rgb(148, 163, 184)',
          borderColor: 'rgb(45, 58, 82)',
          borderWidth: 1,
          padding: 12,
          callbacks: {
            label: (context: { dataset: { label?: string }; parsed: { y: number | null } }) => {
              const label = context.dataset.label || '';
              const value = context.parsed.y;
              return `${label}: ${formatCurrency(value ?? 0, true)} CHF`;
            },
          },
        },
      },
      scales: {
        x: {
          grid: {
            color: 'rgba(45, 58, 82, 0.5)',
          },
          ticks: {
            color: 'rgb(148, 163, 184)',
          },
        },
        y: {
          grid: {
            color: 'rgba(45, 58, 82, 0.5)',
          },
          ticks: {
            color: 'rgb(148, 163, 184)',
            callback: (value: number | string) => {
              if (typeof value === 'number') {
                return formatCurrency(value, true);
              }
              return value;
            },
          },
        },
      },
    }),
    [formatCurrency]
  );

  if (loading) {
    return (
      <div className="accounts-loading">
        <div className="loading-spinner" />
        <p>{t('accounts.loading')}</p>
      </div>
    );
  }

  const renderAccountTable = (accountList: Account[], title: string, totals: AccountTotals) => {
    if (accountList.length === 0) return null;

    return (
      <div className="accounts-section">
        <h3 className="accounts-section-title">{title}</h3>
        <div className="accounts-table-container">
          <table className="accounts-table">
            <thead>
              <tr>
                <th className="account-name-col">{t('accounts.account')}</th>
                <th className="account-initial-col">{t('accounts.initialBalance')}</th>
                {months.map((month, i) => (
                  <th key={i} className="account-month-col">
                    {month.substring(0, 3)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {accountList.map((account) => {
                const movements = calculateMonthlyMovements(account.initialBalance, account.monthlyBalances);
                return (
                  <tr key={account.id}>
                    <td className="account-name">{account.name}</td>
                    <td className="account-initial">
                      {editingBalance === account.id ? (
                        <div className="inline-edit">
                          <input
                            type="number"
                            step="0.01"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveBalance(account);
                              if (e.key === 'Escape') cancelEdit();
                            }}
                            className="balance-input"
                            // biome-ignore lint/a11y/noAutofocus: intentional UX - focus on edit
                            autoFocus
                          />
                          <button
                            className="btn-icon save"
                            onClick={() => saveBalance(account)}
                            disabled={isSubmitting}
                          >
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                            >
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </button>
                          <button className="btn-icon cancel" onClick={cancelEdit}>
                            <svg
                              width="14"
                              height="14"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                            >
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </button>
                        </div>
                      ) : (
                        <span
                          className="balance-value editable"
                          onClick={() => startEditBalance(account)}
                          title={t('accounts.clickToEdit')}
                        >
                          {formatCurrency(account.initialBalance, true)}
                        </span>
                      )}
                    </td>
                    {account.monthlyBalances.map((balance, i) => (
                      <td key={i} className={`account-month-cell`}>
                        <div
                          className={`account-movement ${movements[i] > 0 ? 'positive' : movements[i] < 0 ? 'negative' : ''}`}
                        >
                          {movements[i] !== 0 && (movements[i] > 0 ? '+' : '')}
                          {formatCurrency(movements[i])}
                        </div>
                        <div className={`account-balance ${balance < 0 ? 'negative' : ''}`}>
                          {formatCurrency(balance, true)}
                        </div>
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="total-row">
                <td className="account-name total-label">{t('accounts.total', { title: title.toLowerCase() })}</td>
                <td className="account-initial total-value">{formatCurrency(totals.initialBalance, true)}</td>
                {totals.monthlyBalances.map((balance, i) => (
                  <td key={i} className={`account-month-cell total-value`}>
                    <div
                      className={`account-movement ${totals.monthlyMovements[i] > 0 ? 'positive' : totals.monthlyMovements[i] < 0 ? 'negative' : ''}`}
                    >
                      {totals.monthlyMovements[i] !== 0 && (totals.monthlyMovements[i] > 0 ? '+' : '')}
                      {formatCurrency(totals.monthlyMovements[i])}
                    </div>
                    <div className={`account-balance ${balance < 0 ? 'negative' : ''}`}>
                      {formatCurrency(balance, true)}
                    </div>
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    );
  };

  const renderOverallTotal = () => {
    if (accounts.length === 0) return null;

    return (
      <div className="accounts-section overall-total">
        <h3 className="accounts-section-title">{t('accounts.overallTotal')}</h3>
        <div className="accounts-table-container">
          <table className="accounts-table">
            <thead>
              <tr>
                <th className="account-name-col">{t('accounts.netWorth')}</th>
                <th className="account-initial-col">{t('accounts.initialBalance')}</th>
                {months.map((month, i) => (
                  <th key={i} className="account-month-col">
                    {month.substring(0, 3)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {paymentAccounts.length > 0 && (
                <tr className="subtotal-row">
                  <td className="account-name">{t('accounts.paymentAccounts')}</td>
                  <td className="account-initial">{formatCurrency(paymentTotals.initialBalance, true)}</td>
                  {paymentTotals.monthlyBalances.map((balance, i) => (
                    <td key={i} className="account-month-cell">
                      <div
                        className={`account-movement ${paymentTotals.monthlyMovements[i] > 0 ? 'positive' : paymentTotals.monthlyMovements[i] < 0 ? 'negative' : ''}`}
                      >
                        {paymentTotals.monthlyMovements[i] !== 0 && (paymentTotals.monthlyMovements[i] > 0 ? '+' : '')}
                        {formatCurrency(paymentTotals.monthlyMovements[i])}
                      </div>
                      <div className={`account-balance ${balance < 0 ? 'negative' : ''}`}>
                        {formatCurrency(balance, true)}
                      </div>
                    </td>
                  ))}
                </tr>
              )}
              {savingsAccounts.length > 0 && (
                <tr className="subtotal-row">
                  <td className="account-name">{t('accounts.savingsAccounts')}</td>
                  <td className="account-initial">{formatCurrency(savingsTotals.initialBalance, true)}</td>
                  {savingsTotals.monthlyBalances.map((balance, i) => (
                    <td key={i} className="account-month-cell">
                      <div
                        className={`account-movement ${savingsTotals.monthlyMovements[i] > 0 ? 'positive' : savingsTotals.monthlyMovements[i] < 0 ? 'negative' : ''}`}
                      >
                        {savingsTotals.monthlyMovements[i] !== 0 && (savingsTotals.monthlyMovements[i] > 0 ? '+' : '')}
                        {formatCurrency(savingsTotals.monthlyMovements[i])}
                      </div>
                      <div className={`account-balance ${balance < 0 ? 'negative' : ''}`}>
                        {formatCurrency(balance, true)}
                      </div>
                    </td>
                  ))}
                </tr>
              )}
            </tbody>
            <tfoot>
              <tr className="grand-total-row">
                <td className="account-name total-label">{t('accounts.totalLabel')}</td>
                <td className="account-initial total-value grand-total">
                  {formatCurrency(overallTotals.initialBalance, true)}
                </td>
                {overallTotals.monthlyBalances.map((balance, i) => (
                  <td key={i} className="account-month-cell total-value grand-total">
                    <div
                      className={`account-movement ${overallTotals.monthlyMovements[i] > 0 ? 'positive' : overallTotals.monthlyMovements[i] < 0 ? 'negative' : ''}`}
                    >
                      {overallTotals.monthlyMovements[i] !== 0 && (overallTotals.monthlyMovements[i] > 0 ? '+' : '')}
                      {formatCurrency(overallTotals.monthlyMovements[i])}
                    </div>
                    <div className={`account-balance ${balance < 0 ? 'negative' : ''}`}>
                      {formatCurrency(balance, true)}
                    </div>
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    );
  };

  const renderChartView = () => (
    <div className="accounts-chart-container">
      <div className="accounts-chart">
        <Line data={chartData} options={chartOptions} />
      </div>
    </div>
  );

  const renderTableView = () => (
    <>
      {renderAccountTable(paymentAccounts, t('accounts.paymentAccounts'), paymentTotals)}
      {renderAccountTable(savingsAccounts, t('accounts.savingsAccounts'), savingsTotals)}
      {renderOverallTotal()}
    </>
  );

  return (
    <div className="accounts-view">
      <div className="accounts-header">
        <div className="accounts-header-top">
          <div>
            <h2>{t('accounts.title', { year })}</h2>
            <p className="accounts-subtitle">{t('accounts.subtitle')}</p>
          </div>
        </div>

        {accounts.length > 0 && (
          <div className="accounts-tabs">
            <button
              type="button"
              className={`accounts-tab ${activeTab === 'table' ? 'active' : ''}`}
              onClick={() => setActiveTab('table')}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <line x1="3" y1="9" x2="21" y2="9" />
                <line x1="3" y1="15" x2="21" y2="15" />
                <line x1="9" y1="3" x2="9" y2="21" />
              </svg>
              {t('accounts.table')}
            </button>
            <button
              type="button"
              className={`accounts-tab ${activeTab === 'chart' ? 'active' : ''}`}
              onClick={() => setActiveTab('chart')}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="20" x2="18" y2="10" />
                <line x1="12" y1="20" x2="12" y2="4" />
                <line x1="6" y1="20" x2="6" y2="14" />
              </svg>
              {t('accounts.chart')}
            </button>
          </div>
        )}
      </div>

      {accounts.length === 0 ? (
        <div className="accounts-empty">
          <div className="empty-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2" y="5" width="20" height="14" rx="2" />
              <line x1="2" y1="10" x2="22" y2="10" />
            </svg>
          </div>
          <h3>{t('accounts.noAccountsTitle')}</h3>
          <p>{t('accounts.noAccountsSubtitle')}</p>
          <ul>
            <li>
              {t('accounts.noAccountsBulletSavings')}
            </li>
            <li>
              {t('accounts.noAccountsBulletMethods')}
            </li>
          </ul>
        </div>
      ) : (
        <>
          {activeTab === 'table' && renderTableView()}
          {activeTab === 'chart' && renderChartView()}
        </>
      )}
    </div>
  );
}
