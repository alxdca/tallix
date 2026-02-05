import { useCallback, useEffect, useMemo, useState } from 'react';
import { type Account, fetchAccounts, fetchBudgetData, fetchBudgetSummary } from './api';
import Accounts from './components/Accounts';
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
  const [activeView, setActiveView] = useState('current');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { t, monthNames } = useI18n();

  // Organize budget data into 3-layer structure
  const organizedData = useMemo(() => {
    return budgetData
      ? organizeBudgetData(budgetData, {
          income: t('budget.income'),
          expense: t('budget.expenses'),
        })
      : null;
  }, [budgetData, t]);

  // Calculate total initial balance of all accounts
  const paymentAccountsInitialBalance = useMemo(() => {
    return accounts.reduce((sum, a) => sum + a.initialBalance, 0);
  }, [accounts]);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [data, summaryData] = await Promise.all([fetchBudgetData(), fetchBudgetSummary()]);
      setBudgetData(data);
      setSummary(summaryData);

      // Fetch accounts for the year (needed for funds summary)
      const accountsData = await fetchAccounts(data.year);
      setAccounts(accountsData);

      setError(null);
    } catch (err) {
      setError(getErrorMessage(err, t));
    } finally {
      setLoading(false);
    }
  }, [t]);

  // Silent refresh that doesn't show loading spinner (for inline updates)
  const refreshData = useCallback(async () => {
    try {
      const [data, summaryData] = await Promise.all([fetchBudgetData(), fetchBudgetSummary()]);
      setBudgetData(data);
      setSummary(summaryData);

      // Fetch accounts for the year (needed for funds summary)
      const accountsData = await fetchAccounts(data.year);
      setAccounts(accountsData);
    } catch (err) {
      logger.error('Failed to refresh data', err);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    setMonths(monthNames);
  }, [monthNames]);

  const currentYear = budgetData?.year || new Date().getFullYear();
  const yearId = budgetData?.yearId || 0;

  // Refresh budget data when transactions might have changed
  const handleTransactionsChanged = useCallback(async () => {
    try {
      const [data, summaryData] = await Promise.all([fetchBudgetData(), fetchBudgetSummary()]);
      setBudgetData(data);
      setSummary(summaryData);

      // Also refresh accounts for updated fund balances
      const accountsData = await fetchAccounts(data.year);
      setAccounts(accountsData);
    } catch (err) {
      logger.error('Failed to refresh budget data', err);
    }
  }, []);

  // Views that should show the budget header with balance boxes
  const budgetViews = ['current', 'budget-planning', 'transactions', 'accounts'];
  const showBudgetHeader = budgetViews.includes(activeView) && !loading && !error;

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

    switch (activeView) {
      case 'current':
        return (
          <div className="content-body">
            <BudgetSpreadsheet
              sections={organizedData?.sections || []}
              months={months}
              paymentAccountsInitialBalance={paymentAccountsInitialBalance}
            />
          </div>
        );
      case 'archive':
        return (
          <div className="placeholder-view">
            <div className="placeholder-icon">
              <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <polyline points="21 8 21 21 3 21 3 8" />
                <rect x="1" y="3" width="22" height="5" />
                <line x1="10" y1="12" x2="14" y2="12" />
              </svg>
            </div>
            <h2>{t('app.archiveTitle')}</h2>
            <p>{t('app.archiveSubtitle')}</p>
          </div>
        );
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
      <Sidebar activeView={activeView} onViewChange={setActiveView} currentYear={currentYear} />
      <main className="main-content">
        {showBudgetHeader && (
          <Header
            year={currentYear}
            initialBalance={summary?.initialBalance || 0}
            totalIncome={summary?.totalIncome || { budget: 0, actual: 0 }}
            totalExpenses={summary?.totalExpenses || { budget: 0, actual: 0 }}
            remainingBalance={summary?.remainingBalance || 0}
          />
        )}
        {renderContent()}
      </main>
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
