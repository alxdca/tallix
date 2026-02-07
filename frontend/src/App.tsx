import { useCallback, useEffect, useMemo, useState } from 'react';
import { type Account, fetchAccounts, fetchBudgetData, fetchBudgetSummary } from './api';
import Accounts from './components/Accounts';
import Archive from './components/Archive';
import CopilotWidget from './components/CopilotWidget';
import Assets from './components/Assets';
import BudgetPlanning from './components/BudgetPlanning';
import BudgetSpreadsheet from './components/BudgetSpreadsheet';
import { ErrorBoundary } from './components/ErrorBoundary';
import Header from './components/Header';
import Login from './components/Login';
import Settings from './components/Settings';
import Sidebar from './components/Sidebar';
import Transactions from './components/Transactions';
import UserSettings from './components/UserSettings';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { I18nProvider, useI18n } from './contexts/I18nContext';
import { SettingsProvider } from './contexts/SettingsContext';
import type { BudgetData, BudgetSummary } from './types';
import { getErrorMessage } from './utils/errorMessages';
import { organizeBudgetData } from './utils';
import { logger } from './utils/logger';

function AppContent() {
  const [budgetData, setBudgetData] = useState<BudgetData | null>(null);
  const [summary, setSummary] = useState<BudgetSummary | null>(null);
  const [months, setMonths] = useState<string[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [lastActiveMonth, setLastActiveMonth] = useState<number>(0);
  const [activeView, setActiveView] = useState('current');
  const [selectedYear] = useState<number>(new Date().getFullYear());
  const [archiveBudgetData, setArchiveBudgetData] = useState<BudgetData | null>(null);
  const [archiveLoading, setArchiveLoading] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { t, monthNames } = useI18n();

  // Organize budget data into 3-layer structure
  const organizedData = useMemo(() => {
    return budgetData
      ? organizeBudgetData(budgetData, {
          income: t('budget.income'),
          expense: t('budget.expenses'),
          savings: t('budget.savings'),
        })
      : null;
  }, [budgetData, t]);

  const paymentAccounts = useMemo(() => accounts.filter((account) => !account.isSavingsAccount), [accounts]);

  // Calculate total initial balance of payment accounts (non-savings)
  const paymentAccountsInitialBalance = useMemo(() => {
    return paymentAccounts.reduce((sum, account) => sum + account.initialBalance, 0);
  }, [paymentAccounts]);

  const paymentAccountsMonthlyBalances = useMemo(() => {
    return Array(12)
      .fill(0)
      .map((_, i) => paymentAccounts.reduce((sum, account) => sum + (account.monthlyBalances[i] || 0), 0));
  }, [paymentAccounts]);

  const loadData = useCallback(
    async (year?: number) => {
      try {
        setLoading(true);
        const yearToFetch = year || selectedYear;
        const [data, summaryData] = await Promise.all([
          fetchBudgetData(yearToFetch),
          fetchBudgetSummary(), // Summary is always for current year
        ]);
        setBudgetData(data);
        setSummary(summaryData);

        // Fetch accounts for the year (needed for funds summary)
        const accountsResponse = await fetchAccounts(data.year);
        setAccounts(accountsResponse.accounts);
        setLastActiveMonth(accountsResponse.lastActiveMonth);

        setError(null);
      } catch (err) {
        setError(getErrorMessage(err, t));
      } finally {
        setLoading(false);
      }
    },
    [t, selectedYear]
  );

  const loadArchiveData = useCallback(
    async (year: number) => {
      try {
        setArchiveLoading(true);
        const data = await fetchBudgetData(year);
        setArchiveBudgetData(data);
        setArchiveError(null);
      } catch (err) {
        setArchiveError(getErrorMessage(err, t));
      } finally {
        setArchiveLoading(false);
      }
    },
    [t]
  );

  // Silent refresh that doesn't show loading spinner (for inline updates)
  const refreshData = useCallback(async () => {
    try {
      const [data, summaryData] = await Promise.all([fetchBudgetData(selectedYear), fetchBudgetSummary()]);
      setBudgetData(data);
      setSummary(summaryData);

      // Fetch accounts for the year (needed for funds summary)
      const accountsResponse = await fetchAccounts(data.year);
      setAccounts(accountsResponse.accounts);
      setLastActiveMonth(accountsResponse.lastActiveMonth);
    } catch (err) {
      logger.error('Failed to refresh data', err);
    }
  }, [selectedYear]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    setMonths(monthNames);
  }, [monthNames]);

  // Handle archive view changes - extract year and load data for that year (without switching current year)
  useEffect(() => {
    if (activeView.startsWith('archive-')) {
      const match = activeView.match(/^archive-(\d+)-(transactions|accounts)$/);
      if (match) {
        const archiveYear = parseInt(match[1], 10);
        loadArchiveData(archiveYear);
      }
    }
  }, [activeView, loadArchiveData]);

  const currentYear = budgetData?.year || new Date().getFullYear();
  const yearId = budgetData?.yearId || 0;

  // Refresh budget data when transactions might have changed
  const handleTransactionsChanged = useCallback(async () => {
    try {
      const [data, summaryData] = await Promise.all([fetchBudgetData(selectedYear), fetchBudgetSummary()]);
      setBudgetData(data);
      setSummary(summaryData);

      // Also refresh accounts for updated fund balances
      const accountsResponse = await fetchAccounts(data.year);
      setAccounts(accountsResponse.accounts);
      setLastActiveMonth(accountsResponse.lastActiveMonth);
    } catch (err) {
      logger.error('Failed to refresh budget data', err);
    }
  }, [selectedYear]);

  // Handle year selection from Archive
  const handleYearSelected = useCallback((year: number) => {
    setActiveView(`archive-${year}-transactions`);
  }, []);

  // Views that should show the budget header with balance boxes
  const budgetViews = ['current', 'budget-planning', 'transactions', 'accounts', 'assets'];
  const isArchiveView = activeView.startsWith('archive-');
  const showBudgetHeader = (budgetViews.includes(activeView) || isArchiveView) && !loading && !error;

  const renderContent = () => {
    if (loading) {
      return (
        <div className="content-loading">
          <div className="loading-spinner" />
          <p>{t('app.loadingBudget')}</p>
        </div>
      );
    }

    if (error) {
      return (
        <div className="content-error">
          <p>
            {t('app.error')}: {error}
          </p>
          <button onClick={() => window.location.reload()}>{t('app.retry')}</button>
        </div>
      );
    }

    // Handle archive views (e.g., archive-2023-transactions)
    if (activeView.startsWith('archive-')) {
      const match = activeView.match(/^archive-(\d+)-(transactions|accounts)$/);
      if (match) {
        const archiveYear = parseInt(match[1], 10);
        const archiveSubView = match[2];

        if (archiveLoading) {
          return (
            <div className="content-loading">
              <div className="loading-spinner" />
              <p>{t('app.loadingBudget')}</p>
            </div>
          );
        }

        if (archiveError) {
          return (
            <div className="content-error">
              <p>
                {t('app.error')}: {archiveError}
              </p>
              <button onClick={() => loadArchiveData(archiveYear)}>{t('app.retry')}</button>
            </div>
          );
        }

        if (archiveSubView === 'transactions') {
          return (
            <Transactions
              year={archiveYear}
              yearId={archiveBudgetData?.yearId || 0}
              groups={archiveBudgetData?.groups || []}
              onTransactionsChanged={() => loadArchiveData(archiveYear)}
            />
          );
        } else if (archiveSubView === 'accounts') {
          return <Accounts year={archiveYear} months={months} onDataChanged={refreshData} />;
        }
      }
      return null;
    }

    switch (activeView) {
      case 'current':
        return (
          <div className="content-body">
            <BudgetSpreadsheet
              sections={organizedData?.sections || []}
              year={currentYear}
              months={months}
              paymentAccountsInitialBalance={paymentAccountsInitialBalance}
              paymentAccountsMonthlyBalances={paymentAccountsMonthlyBalances}
              lastActiveMonth={lastActiveMonth}
            />
          </div>
        );
      case 'archive':
        return <Archive selectedYear={selectedYear} onYearSelected={handleYearSelected} />;
      case 'transactions':
        return (
          <Transactions
            year={currentYear}
            yearId={yearId}
            groups={budgetData?.groups || []}
            onTransactionsChanged={handleTransactionsChanged}
          />
        );
      case 'settings':
        return <Settings yearId={yearId} groups={budgetData?.groups || []} onDataChanged={refreshData} />;
      case 'accounts':
        return <Accounts year={currentYear} months={months} onDataChanged={refreshData} />;
      case 'assets':
        return <Assets onDataChanged={refreshData} />;
      case 'budget-planning':
        return (
          <BudgetPlanning
            year={currentYear}
            groups={budgetData?.groups || []}
            months={months}
            onDataChanged={refreshData}
          />
        );
      case 'user-settings':
        return <UserSettings />;
      default:
        return null;
    }
  };

  return (
    <div className="app">
      <Sidebar activeView={activeView} onViewChange={setActiveView} currentYear={selectedYear} />
      <main className="main-content">
        {showBudgetHeader && (
          <Header
            year={selectedYear}
            initialBalance={summary?.initialBalance || 0}
            totalIncome={summary?.totalIncome || { budget: 0, actual: 0 }}
            totalSavings={summary?.totalSavings || { budget: 0, actual: 0 }}
            totalExpenses={summary?.totalExpenses || { budget: 0, actual: 0 }}
            expectedIncome={summary?.expectedIncome || 0}
            expectedExpenses={summary?.expectedExpenses || 0}
            expectedSavings={summary?.expectedSavings || 0}
            remainingBalance={summary?.remainingBalance || 0}
          />
        )}
        {renderContent()}
      </main>
      <CopilotWidget />
    </div>
  );
}

function AuthenticatedApp() {
  const { user, isLoading } = useAuth();
  const { setLocale, t } = useI18n();

  useEffect(() => {
    if (user?.language === 'en' || user?.language === 'fr') {
      setLocale(user.language);
    }
  }, [user, setLocale]);

  if (isLoading) {
    return (
      <div className="login-container">
        <div className="content-loading">
          <div className="loading-spinner" />
          <p>{t('app.loading')}</p>
        </div>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return (
    <SettingsProvider>
      <AppContent />
    </SettingsProvider>
  );
}

function App() {
  return (
    <I18nProvider>
      <ErrorBoundary>
        <AuthProvider>
          <AuthenticatedApp />
        </AuthProvider>
      </ErrorBoundary>
    </I18nProvider>
  );
}

export default App;
