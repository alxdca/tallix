import {
  CategoryScale,
  Chart as ChartJS,
  Filler,
  Legend,
  LinearScale,
  LineElement,
  PointElement,
  Title,
  Tooltip,
} from 'chart.js';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Line } from 'react-chartjs-2';
import { ACTIVE_BUDGET_KEY, type Account, fetchAccounts, restoreAccountBalanceLink, setAccountBalance } from '../api';
import { useI18n } from '../contexts/I18nContext';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { logger } from '../utils/logger';
import ConfirmDialog from './ConfirmDialog';

// Register Chart.js components
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Title, Tooltip, Legend, Filler);

interface AccountsProps {
  year: number;
  months: string[];
  onDataChanged: () => void;
  readOnly?: boolean;
}

interface AccountTotals {
  initialBalance: number;
  endOfYearBalance: number;
  monthlyBalances: number[];
  monthlyMovements: number[];
}

type AccountsTab = 'table' | 'chart';

function closingBalance(account: Account): number {
  return account.endOfYearBalance ?? account.monthlyBalances[11] ?? 0;
}

function hasBalanceLink(account: Account): boolean {
  return Boolean(account.inheritedFromParent || account.linkedFromYear != null);
}

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
  const endOfYearBalance = accountList.reduce((sum, account) => sum + closingBalance(account), 0);
  return { initialBalance, endOfYearBalance, monthlyBalances, monthlyMovements };
}

export default function Accounts({ year, months, onDataChanged, readOnly = false }: AccountsProps) {
  const formatCurrency = useFormatCurrency();
  const { t, locale } = useI18n();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingBalance, setEditingBalance] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<AccountsTab>('table');

  const [actionError, setActionError] = useState<string | null>(null);
  const budgetId = localStorage.getItem(ACTIVE_BUDGET_KEY);
  const scope = useMemo(() => ({ year, readOnly, budgetId }), [year, readOnly, budgetId]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const mounted = useRef(false);
  const submittingScope = useRef<typeof scope | null>(null);
  const [pendingOverride, setPendingOverride] = useState<{
    accountId: number;
    value: number;
    scope: typeof scope;
  } | null>(null);

  const isCurrentScope = useCallback(
    (source: typeof scope) =>
      mounted.current && currentScope.current === source && localStorage.getItem(ACTIVE_BUDGET_KEY) === source.budgetId,
    []
  );

  // Show all twelve months, including December even when the last activity was earlier.
  const activeMonths = useMemo(() => months, [months]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setEditingBalance(null);
    setEditValue('');
    setPendingOverride(null);
    setActionError(null);
    setIsSubmitting(false);
    submittingScope.current = null;
    setLoading(true);
    fetchAccounts(year)
      .then((data) => {
        if (!cancelled && isCurrentScope(scope)) setAccounts(data.accounts);
      })
      .catch((error) => logger.error('Failed to load accounts', error))
      .finally(() => {
        if (!cancelled && isCurrentScope(scope)) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [year, scope, isCurrentScope]);

  const startEditBalance = (account: Account) => {
    if (readOnly || submittingScope.current || !isCurrentScope(scope)) return;
    setActionError(null);
    setEditingBalance(account.id);
    setEditValue(account.initialBalance.toString());
  };

  const cancelEdit = () => {
    setEditingBalance(null);
    setEditValue('');
    setPendingOverride(null);
    setActionError(null);
  };

  const updateBalance = async (accountId: number, value: number | null, source: typeof scope, breakLink = false) => {
    if (source.readOnly || !isCurrentScope(source) || submittingScope.current) return;
    submittingScope.current = source;
    setIsSubmitting(true);
    setActionError(null);
    setPendingOverride(null);
    try {
      if (value === null) {
        await restoreAccountBalanceLink(source.year, accountId);
      } else if (breakLink) {
        await setAccountBalance(source.year, accountId, value, true);
      } else {
        await setAccountBalance(source.year, accountId, value);
      }
      if (!isCurrentScope(source)) return;
      const data = await fetchAccounts(source.year);
      if (!isCurrentScope(source)) return;
      setAccounts(data.accounts);
      cancelEdit();
      onDataChanged();
    } catch (error) {
      logger.error(value === null ? 'Failed to restore balance link' : 'Failed to save balance', error);
      if (isCurrentScope(source)) setActionError(value === null ? 'accounts.restoreFailed' : 'accounts.saveFailed');
    } finally {
      if (isCurrentScope(source) && submittingScope.current === source) {
        submittingScope.current = null;
        setIsSubmitting(false);
      }
    }
  };

  const saveBalance = (account: Account) => {
    if (readOnly || submittingScope.current || !isCurrentScope(scope) || editingBalance !== account.id) return;
    const value = Number(editValue);
    if (!editValue.trim() || !Number.isFinite(value)) return;
    if (hasBalanceLink(account)) {
      setPendingOverride({ accountId: account.id, value, scope });
      return;
    }
    void updateBalance(account.id, value, scope);
  };

  const sortedAccounts = useMemo(
    () => [...accounts].sort((a, b) => a.name.localeCompare(b.name, locale, { sensitivity: 'base' })),
    [accounts, locale]
  );
  const accountSections = useMemo(
    () =>
      [
        {
          key: 'payment',
          title: t('accounts.paymentAccounts'),
          accounts: sortedAccounts.filter((account) => !account.isSavingsAccount),
        },
        {
          key: 'savings',
          title: t('accounts.savingsAccounts'),
          accounts: sortedAccounts.filter(
            (account) => account.isSavingsAccount && account.savingsType !== 'investissements'
          ),
        },
        {
          key: 'investments',
          title: t('accounts.investmentAccounts'),
          accounts: sortedAccounts.filter(
            (account) => account.isSavingsAccount && account.savingsType === 'investissements'
          ),
        },
      ].map((section) => ({ ...section, totals: calculateTotals(section.accounts) })),
    [sortedAccounts, t]
  );
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
    const labels = [t('accounts.initial'), ...activeMonths.map((m) => m.substring(0, 3))];

    const datasets = sortedAccounts.map((account, index) => {
      const color = chartColors[index % chartColors.length];
      const label = account.institution ? `${account.name} (${account.institution})` : account.name;
      return {
        label,
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
    if (sortedAccounts.length > 1) {
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
  }, [sortedAccounts, activeMonths, overallTotals, t]);

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

  const renderClosingBalance = (value: number, className = '') => (
    <td className={`account-closing ${className} ${value < 0 ? 'negative' : ''}`}>{formatCurrency(value, true)}</td>
  );

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
                {activeMonths.map((month, i) => (
                  <th key={i} className="account-month-col">
                    {month.substring(0, 3)}
                  </th>
                ))}
                <th className="account-closing-col">{t('accounts.endOfYearBalance')}</th>
              </tr>
            </thead>
            <tbody>
              {accountList.map((account) => {
                const movements = calculateMonthlyMovements(account.initialBalance, account.monthlyBalances);
                const canRestoreLink = account.canRestoreBalanceLink && !hasBalanceLink(account) && !readOnly;
                return (
                  <tr key={account.id}>
                    <td className="account-name">
                      {account.name}
                      {account.institution && <span className="institution-badge">{account.institution}</span>}
                    </td>
                    <td className="account-initial">
                      {!readOnly && editingBalance === account.id ? (
                        <div className="inline-edit">
                          <input
                            type="number"
                            step="0.01"
                            value={editValue}
                            aria-label={t('accounts.editBalanceFor', { name: account.name })}
                            disabled={isSubmitting || pendingOverride !== null}
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
                            type="button"
                            aria-label={t('accounts.saveBalance')}
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
                          <button
                            type="button"
                            aria-label={t('accounts.cancelEdit')}
                            className="btn-icon cancel"
                            onClick={cancelEdit}
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
                              <line x1="18" y1="6" x2="6" y2="18" />
                              <line x1="6" y1="6" x2="18" y2="18" />
                            </svg>
                          </button>
                        </div>
                      ) : readOnly ? (
                        <span className="balance-value">{formatCurrency(account.initialBalance, true)}</span>
                      ) : (
                        <button
                          type="button"
                          className="balance-value editable account-edit-balance"
                          onClick={() => startEditBalance(account)}
                          disabled={isSubmitting}
                          aria-label={t('accounts.editBalanceFor', { name: account.name })}
                          title={t(hasBalanceLink(account) ? 'accounts.editInheritedBalance' : 'accounts.clickToEdit')}
                        >
                          {formatCurrency(account.initialBalance, true)}
                        </button>
                      )}
                      {account.inheritedFromParent && (
                        <span className="account-balance-link" title={t('accounts.inheritedBalanceHelp')}>
                          {t('accounts.inheritedBalance')}
                        </span>
                      )}
                      {account.linkedFromYear != null && (
                        <span
                          className="account-balance-link"
                          title={t('accounts.linkedFromYearHelp', { year: account.linkedFromYear })}
                        >
                          {t('accounts.linkedFromYear', { year: account.linkedFromYear })}
                        </span>
                      )}
                      {canRestoreLink && (
                        <div className="account-balance-status">
                          <button
                            type="button"
                            className="account-restore-link"
                            aria-label={t('accounts.restoreLinkFor', { name: account.name })}
                            disabled={isSubmitting}
                            onClick={() => void updateBalance(account.id, null, scope)}
                          >
                            {t('accounts.restoreLink')}
                          </button>
                        </div>
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
                    {renderClosingBalance(closingBalance(account))}
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
                {renderClosingBalance(totals.endOfYearBalance, 'total-value')}
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
                {activeMonths.map((month, i) => (
                  <th key={i} className="account-month-col">
                    {month.substring(0, 3)}
                  </th>
                ))}
                <th className="account-closing-col">{t('accounts.endOfYearBalance')}</th>
              </tr>
            </thead>
            <tbody>
              {accountSections
                .filter((section) => section.accounts.length > 0)
                .map(({ key, title, totals }) => (
                  <tr key={key} className="subtotal-row">
                    <td className="account-name">{title}</td>
                    <td className="account-initial">{formatCurrency(totals.initialBalance, true)}</td>
                    {totals.monthlyBalances.map((balance, i) => (
                      <td key={i} className="account-month-cell">
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
                    {renderClosingBalance(totals.endOfYearBalance)}
                  </tr>
                ))}
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
                {renderClosingBalance(overallTotals.endOfYearBalance, 'total-value grand-total')}
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
      {accountSections.map(({ key, accounts: sectionAccounts, title, totals }) => (
        <Fragment key={key}>{renderAccountTable(sectionAccounts, title, totals)}</Fragment>
      ))}
      {renderOverallTotal()}
    </>
  );

  return (
    <div className="accounts-view">
      <ConfirmDialog
        isOpen={pendingOverride !== null && pendingOverride.scope === scope && !readOnly}
        title={t('accounts.breakLinkTitle')}
        message={t('accounts.breakLinkWarning')}
        confirmLabel={t('accounts.confirmOverride')}
        variant="warning"
        onCancel={() => setPendingOverride(null)}
        onConfirm={() => {
          if (pendingOverride)
            void updateBalance(pendingOverride.accountId, pendingOverride.value, pendingOverride.scope, true);
        }}
      />
      {actionError && (
        <p className="accounts-action-error" role="alert">
          {t(actionError)}
        </p>
      )}
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
            <li>{t('accounts.noAccountsBulletSavings')}</li>
            <li>{t('accounts.noAccountsBulletMethods')}</li>
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
