import { useEffect, useState, useMemo, useCallback } from 'react';
import { fetchBudgetData, fetchBudgetSummary, fetchMonths, fetchAccounts, type Account } from './api';
import type { BudgetData, BudgetSummary } from './types';
import { organizeBudgetData } from './utils';
import { logger } from './utils/logger';
import { ErrorBoundary } from './components/ErrorBoundary';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import BudgetSpreadsheet from './components/BudgetSpreadsheet';
import Settings from './components/Settings';
import Transactions from './components/Transactions';
import Accounts from './components/Accounts';
import BudgetPlanning from './components/BudgetPlanning';

function App() {
  const [budgetData, setBudgetData] = useState<BudgetData | null>(null);
  const [summary, setSummary] = useState<BudgetSummary | null>(null);
  const [months, setMonths] = useState<string[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeView, setActiveView] = useState('current');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Organize budget data into 3-layer structure
  const organizedData = useMemo(() => {
    return budgetData ? organizeBudgetData(budgetData) : null;
  }, [budgetData]);

  // Calculate total initial balance of payment method accounts (excluding savings)
  const paymentAccountsInitialBalance = useMemo(() => {
    return accounts
      .filter(a => a.type === 'payment_method')
      .reduce((sum, a) => sum + a.initialBalance, 0);
  }, [accounts]);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [data, summaryData, monthsData] = await Promise.all([
        fetchBudgetData(),
        fetchBudgetSummary(),
        fetchMonths(),
      ]);
      setBudgetData(data);
      setSummary(summaryData);
      setMonths(monthsData);
      
      // Fetch accounts for the year (needed for funds summary)
      const accountsData = await fetchAccounts(data.year);
      setAccounts(accountsData);
      
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  }, []);

  // Silent refresh that doesn't show loading spinner (for inline updates)
  const refreshData = useCallback(async () => {
    try {
      const [data, summaryData, monthsData] = await Promise.all([
        fetchBudgetData(),
        fetchBudgetSummary(),
        fetchMonths(),
      ]);
      setBudgetData(data);
      setSummary(summaryData);
      setMonths(monthsData);
      
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

  const currentYear = budgetData?.year || new Date().getFullYear();
  const yearId = budgetData?.yearId || 0;

  // Refresh budget data when transactions might have changed
  const handleTransactionsChanged = useCallback(async () => {
    try {
      const [data, summaryData] = await Promise.all([
        fetchBudgetData(),
        fetchBudgetSummary(),
      ]);
      setBudgetData(data);
      setSummary(summaryData);
      
      // Also refresh accounts for updated fund balances
      const accountsData = await fetchAccounts(data.year);
      setAccounts(accountsData);
    } catch (err) {
      logger.error('Failed to refresh budget data', err);
    }
  }, []);

  const renderContent = () => {
    if (loading) {
      return (
        <div className="content-loading">
          <div className="loading-spinner" />
          <p>Chargement du budget...</p>
        </div>
      );
    }

    if (error) {
      return (
        <div className="content-error">
          <p>Erreur: {error}</p>
          <button onClick={() => window.location.reload()}>Réessayer</button>
        </div>
      );
    }

    switch (activeView) {
      case 'current':
        return (
          <>
            <Header
              year={currentYear}
              initialBalance={summary?.initialBalance || 0}
              remainingBalance={summary?.remainingBalance || 0}
            />
            <div className="content-body">
              <BudgetSpreadsheet
                sections={organizedData?.sections || []}
                months={months}
                paymentAccountsInitialBalance={paymentAccountsInitialBalance}
              />
            </div>
          </>
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
            <h2>Archive</h2>
            <p>Consultez vos budgets des années précédentes</p>
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
        return (
          <Settings
            yearId={yearId}
            groups={budgetData?.groups || []}
            onDataChanged={refreshData}
          />
        );
      case 'accounts':
        return (
          <Accounts
            year={currentYear}
            months={months}
            onDataChanged={refreshData}
          />
        );
      case 'budget-planning':
        return (
          <BudgetPlanning
            year={currentYear}
            groups={budgetData?.groups || []}
            months={months}
            onDataChanged={refreshData}
          />
        );
      default:
        return null;
    }
  };

  return (
    <ErrorBoundary>
      <div className="app">
        <Sidebar
          activeView={activeView}
          onViewChange={setActiveView}
          currentYear={currentYear}
        />
        <main className="main-content">
          {renderContent()}
        </main>
      </div>
    </ErrorBoundary>
  );
}

export default App;
