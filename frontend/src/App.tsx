import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ACTIVE_BUDGET_KEY,
  type AccessibleBudget,
  type Account,
  createBudget,
  deleteBudget,
  fetchAccounts,
  fetchBudgetData,
  fetchBudgetSummary,
  fetchBudgets,
} from './api';
import Accounts from './components/Accounts';
import Assets from './components/Assets';
import BudgetPlanning from './components/BudgetPlanning';
import BudgetPlayground from './components/BudgetPlayground';
import BudgetSpreadsheet from './components/BudgetSpreadsheet';
import CopilotWidget from './components/CopilotWidget';
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
import { organizeBudgetData } from './utils';
import { getErrorMessage } from './utils/errorMessages';
import { logger } from './utils/logger';

interface ExpectedBreakdown {
  monthlyByMonth: number[];
  monthlyExpected: number;
  yearlyRemaining: number;
}

interface ExpectedBreakdownByType {
  income: ExpectedBreakdown;
  expense: ExpectedBreakdown;
  savings: ExpectedBreakdown;
}

function AppContent() {
  const [budgetData, setBudgetData] = useState<BudgetData | null>(null);
  const [summary, setSummary] = useState<BudgetSummary | null>(null);
  const [months, setMonths] = useState<string[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [lastActiveMonth, setLastActiveMonth] = useState<number>(0);
  const [activeView, setActiveView] = useState('current');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [availableBudgets, setAvailableBudgets] = useState<AccessibleBudget[]>([]);
  const [activeBudgetId, setActiveBudgetId] = useState<number | null>(() => {
    const stored = Number.parseInt(localStorage.getItem(ACTIVE_BUDGET_KEY) || '', 10);
    return Number.isNaN(stored) ? null : stored;
  });
  const requestVersion = useRef(0);
  const [budgetsReady, setBudgetsReady] = useState(false);
  const { t, monthNames } = useI18n();

  useEffect(() => {
    let cancelled = false;
    fetchBudgets()
      .then(({ budgets, defaultBudgetId }) => {
        if (cancelled) return;
        setAvailableBudgets(budgets);
        const storedId = Number.parseInt(localStorage.getItem(ACTIVE_BUDGET_KEY) || '', 10);
        const selectedId = budgets.some((budget) => budget.id === storedId) ? storedId : defaultBudgetId;
        localStorage.setItem(ACTIVE_BUDGET_KEY, String(selectedId));
        setActiveBudgetId(selectedId);
        setBudgetsReady(true);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(getErrorMessage(err, t));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [t]);

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

  const activeBudget = availableBudgets.find((budget) => budget.id === activeBudgetId) ?? null;
  const selectedYear = activeBudget?.year ?? new Date().getFullYear();

  const expectedBreakdown = useMemo<ExpectedBreakdownByType>(() => {
    const empty: ExpectedBreakdownByType = {
      income: { monthlyByMonth: Array(12).fill(0), monthlyExpected: 0, yearlyRemaining: 0 },
      expense: { monthlyByMonth: Array(12).fill(0), monthlyExpected: 0, yearlyRemaining: 0 },
      savings: { monthlyByMonth: Array(12).fill(0), monthlyExpected: 0, yearlyRemaining: 0 },
    };

    if (!budgetData) return empty;
    const now = new Date();
    const currentMonthIndex =
      budgetData.year < now.getFullYear() ? 12 : budgetData.year > now.getFullYear() ? 0 : now.getMonth();

    for (const group of budgetData.groups) {
      if (group.type !== 'income' && group.type !== 'expense' && group.type !== 'savings') continue;

      const section = empty[group.type];
      for (const item of group.items) {
        for (let i = 0; i < 12; i++) {
          const month = item.months[i];
          const actual = month?.actual || 0;
          const budget = month?.budget || 0;
          const expected = i < currentMonthIndex ? actual : actual !== 0 ? actual : budget;
          section.monthlyByMonth[i] += expected;
          section.monthlyExpected += expected;
        }

        const yearlyBudget = item.yearlyBudget || 0;
        if (yearlyBudget > 0) {
          const actualSpent = item.months.reduce((sum, month) => sum + (month?.actual || 0), 0);
          section.yearlyRemaining += Math.max(0, yearlyBudget - actualSpent);
        }
      }
    }

    return empty;
  }, [budgetData]);

  const loadData = useCallback(
    async (silent = false) => {
      if (localStorage.getItem(ACTIVE_BUDGET_KEY) !== String(activeBudgetId)) return;
      const version = ++requestVersion.current;
      if (!silent) setLoading(true);
      try {
        const [data, summaryData, accountsResponse] = await Promise.all([
          fetchBudgetData(selectedYear),
          fetchBudgetSummary(selectedYear),
          fetchAccounts(selectedYear),
        ]);
        if (version !== requestVersion.current) return;
        setBudgetData(data);
        setSummary(summaryData);
        setAccounts(accountsResponse.accounts);
        setLastActiveMonth(accountsResponse.lastActiveMonth);
        setError(null);
      } catch (err) {
        if (version !== requestVersion.current) return;
        if (silent) logger.error('Failed to refresh data', err);
        else setError(getErrorMessage(err, t));
      } finally {
        if (version === requestVersion.current) setLoading(false);
      }
    },
    [t, selectedYear, activeBudgetId]
  );

  const refreshData = useCallback(() => loadData(true), [loadData]);

  useEffect(() => {
    if (budgetsReady && activeBudgetId !== null) loadData();
    return () => {
      requestVersion.current += 1;
    };
  }, [budgetsReady, activeBudgetId, loadData]);

  useEffect(() => {
    setMonths(monthNames);
  }, [monthNames]);

  const currentYear = selectedYear;
  const yearId = budgetData?.yearId || 0;

  const handleBudgetChange = useCallback((budgetId: number, view = 'current') => {
    requestVersion.current += 1;
    setLoading(true);
    setError(null);
    setBudgetData(null);
    setSummary(null);
    setAccounts([]);
    localStorage.setItem(ACTIVE_BUDGET_KEY, String(budgetId));
    setActiveBudgetId(budgetId);
    setActiveView(view);
  }, []);

  const handleCreateBudget = useCallback(
    async (year: number, description: string, parentBudgetId: number | null) => {
      const budget = await createBudget(year, description.trim(), parentBudgetId);
      setAvailableBudgets((current) => [...current, budget]);
      handleBudgetChange(budget.id);
    },
    [handleBudgetChange]
  );

  const handleDeleteBudget = useCallback(
    async (budgetId: number) => {
      const { budgets, defaultBudgetId } = await deleteBudget(budgetId);
      setAvailableBudgets(budgets);
      const selectedId = Number(localStorage.getItem(ACTIVE_BUDGET_KEY));
      if (!budgets.some((budget) => budget.id === selectedId)) {
        handleBudgetChange(defaultBudgetId, 'user-settings');
      }
    },
    [handleBudgetChange]
  );

  const protectReadOnly = (content: ReactNode) =>
    activeBudget?.role === 'read' ? (
      <fieldset className="read-only-surface" disabled>
        {content}
      </fieldset>
    ) : (
      content
    );

  // Views that should show the budget header with balance boxes
  const budgetViews = ['current', 'budget-planning', 'playground', 'transactions', 'accounts', 'assets'];
  const showBudgetHeader = budgetViews.includes(activeView) && !loading && !error;

  const renderContent = () => {
    if (activeView === 'user-settings') {
      return (
        <UserSettings
          budgets={availableBudgets}
          activeBudgetId={activeBudgetId}
          onCreateBudget={handleCreateBudget}
          onDeleteBudget={handleDeleteBudget}
        />
      );
    }

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
              year={currentYear}
              months={months}
              paymentAccountsInitialBalance={paymentAccountsInitialBalance}
              paymentAccountsMonthlyBalances={paymentAccountsMonthlyBalances}
              lastActiveMonth={lastActiveMonth}
            />
          </div>
        );
      case 'transactions':
        return (
          <Transactions
            year={currentYear}
            yearId={yearId}
            groups={budgetData?.groups || []}
            onTransactionsChanged={refreshData}
            readOnly={activeBudget?.role === 'read'}
          />
        );
      case 'settings':
        return (
          <Settings
            yearId={yearId}
            groups={budgetData?.groups || []}
            onDataChanged={refreshData}
            accessRole={activeBudget?.role || 'owner'}
          />
        );
      case 'accounts':
        return protectReadOnly(<Accounts year={currentYear} months={months} onDataChanged={refreshData} />);
      case 'assets':
        return protectReadOnly(<Assets onDataChanged={refreshData} />);
      case 'budget-planning':
        return protectReadOnly(
          <BudgetPlanning
            year={currentYear}
            groups={budgetData?.groups || []}
            months={months}
            onDataChanged={refreshData}
          />
        );
      case 'playground':
        return (
          <BudgetPlayground
            year={currentYear}
            groups={budgetData?.groups || []}
            months={months}
            paymentAccountsInitialBalance={paymentAccountsInitialBalance}
          />
        );
      default:
        return null;
    }
  };

  return (
    <div className="app">
      <Sidebar
        activeView={activeView}
        onViewChange={setActiveView}
        budgets={availableBudgets}
        activeBudgetId={activeBudgetId}
        onBudgetChange={handleBudgetChange}
      />
      <main className="main-content" key={activeBudgetId}>
        {activeBudget?.role === 'read' && <div className="read-only-banner">{t('sharing.readOnlyBanner')}</div>}
        {showBudgetHeader && (
          <Header
            year={currentYear}
            initialBalance={summary?.initialBalance || 0}
            totalIncome={summary?.totalIncome || { budget: 0, actual: 0 }}
            totalSavings={summary?.totalSavings || { budget: 0, actual: 0 }}
            totalExpenses={summary?.totalExpenses || { budget: 0, actual: 0 }}
            expectedIncome={summary?.expectedIncome || 0}
            expectedExpenses={summary?.expectedExpenses || 0}
            expectedSavings={summary?.expectedSavings || 0}
            months={months}
            expectedIncomeBreakdown={expectedBreakdown.income}
            expectedExpensesBreakdown={expectedBreakdown.expense}
            expectedSavingsBreakdown={expectedBreakdown.savings}
            remainingBalance={summary?.remainingBalance || 0}
          />
        )}
        {renderContent()}
      </main>
      <CopilotWidget key={`copilot-${activeBudgetId}`} />
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
