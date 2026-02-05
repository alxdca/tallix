import { useCallback, useEffect, useMemo, useState } from 'react';
import { type Account, fetchAccounts, setAccountBalance } from '../api';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { logger } from '../utils/logger';

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
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingBalance, setEditingBalance] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

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
      await setAccountBalance(year, account.type, account.accountId, newBalance);
      await loadAccounts();
      onDataChanged();
      cancelEdit();
    } catch (error) {
      logger.error('Failed to save balance', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const savingsAccounts = accounts.filter((a) => a.type === 'savings_item');
  const paymentAccounts = accounts.filter((a) => a.type === 'payment_method');

  // Calculate totals
  const paymentTotals = useMemo(() => calculateTotals(paymentAccounts), [paymentAccounts]);
  const savingsTotals = useMemo(() => calculateTotals(savingsAccounts), [savingsAccounts]);
  const overallTotals = useMemo(() => calculateTotals(accounts), [accounts]);

  if (loading) {
    return (
      <div className="accounts-loading">
        <div className="loading-spinner" />
        <p>Chargement des comptes...</p>
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
                <th className="account-name-col">Compte</th>
                <th className="account-initial-col">Solde initial</th>
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
                          title="Cliquer pour modifier"
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
                <td className="account-name total-label">Total {title.toLowerCase()}</td>
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
        <h3 className="accounts-section-title">Total général</h3>
        <div className="accounts-table-container">
          <table className="accounts-table">
            <thead>
              <tr>
                <th className="account-name-col">Patrimoine</th>
                <th className="account-initial-col">Solde initial</th>
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
                  <td className="account-name">Comptes de paiement</td>
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
                  <td className="account-name">Comptes d'épargne</td>
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
                <td className="account-name total-label">Total patrimoine</td>
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

  return (
    <div className="accounts-view">
      <div className="accounts-header">
        <h2>Comptes - {year}</h2>
        <p className="accounts-subtitle">Solde attendu à la fin de chaque mois</p>
      </div>

      {accounts.length === 0 ? (
        <div className="accounts-empty">
          <div className="empty-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <rect x="2" y="5" width="20" height="14" rx="2" />
              <line x1="2" y1="10" x2="22" y2="10" />
            </svg>
          </div>
          <h3>Aucun compte configuré</h3>
          <p>Les comptes sont créés automatiquement à partir de :</p>
          <ul>
            <li>
              Les éléments dans vos groupes <strong>Épargne</strong>
            </li>
            <li>
              Les modes de paiement marqués comme <strong>compte</strong> dans les paramètres
            </li>
          </ul>
        </div>
      ) : (
        <>
          {renderAccountTable(paymentAccounts, 'Comptes de paiement', paymentTotals)}
          {renderAccountTable(savingsAccounts, "Comptes d'épargne", savingsTotals)}
          {renderOverallTotal()}
        </>
      )}
    </div>
  );
}
