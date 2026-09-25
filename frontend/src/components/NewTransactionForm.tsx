import { type FormEvent, useCallback, useMemo, useState } from 'react';
import {
  type AccountIdentifier,
  createTransaction,
  createTransfer,
  type PaymentMethod,
  type Transaction,
} from '../api';
import { useI18n } from '../contexts/I18nContext';
import type { GroupType } from '../types';
import { getTodayDisplay, isValidDateFormat, parseDateInput } from '../utils';
import { logger } from '../utils/logger';
import ThirdPartyAutocomplete from './ThirdPartyAutocomplete';
import { getRecentlyUsedCategories } from './transactionCategories';
import { formatWithInstitution, normalizeThirdParty, parseAccountString } from './transactionFormUtils';

interface NewTransactionFormProps {
  year: number;
  yearId: number;
  categories: { id: number; name: string; groupName: string; groupType: GroupType }[];
  transactions: Transaction[];
  paymentMethods: PaymentMethod[];
  transferAccounts: AccountIdentifier[];
  isSubmitting: boolean;
  onSubmittingChange: (isSubmitting: boolean) => void;
  onCreated: () => Promise<void>;
}

export default function NewTransactionForm({
  year,
  yearId,
  categories,
  transactions,
  paymentMethods,
  transferAccounts,
  isSubmitting,
  onSubmittingChange,
  onCreated,
}: NewTransactionFormProps) {
  const { t } = useI18n();
  // Form state (dates stored in DD/MM/YYYY display format)
  const [newEntryType, setNewEntryType] = useState<'transaction' | 'transfer'>('transaction');
  const [newDate, setNewDate] = useState(getTodayDisplay);
  const [newDescription, setNewDescription] = useState('');
  const [newThirdParty, setNewThirdParty] = useState('');
  const [newPaymentMethodId, setNewPaymentMethodId] = useState<number | null>(null);
  const [newAmount, setNewAmount] = useState('');
  const [newItemId, setNewItemId] = useState<number | null>(null);
  const [autoItemFromThirdParty, setAutoItemFromThirdParty] = useState(false);
  const [autoPaymentMethodFromThirdParty, setAutoPaymentMethodFromThirdParty] = useState(false);
  // Transfer-specific form state
  const [newSourceAccount, setNewSourceAccount] = useState(''); // Account ID
  const [newDestAccount, setNewDestAccount] = useState('');

  const incomeItems = categories.filter((item) => item.groupType === 'income');
  const expenseItems = categories.filter((item) => item.groupType === 'expense');
  const savingsCategoryItems = categories.filter((item) => item.groupType === 'savings');
  const recentlyUsedCategoryItems = useMemo(
    () => getRecentlyUsedCategories(categories, transactions),
    [categories, transactions]
  );

  const applyNewThirdPartySuggestion = useCallback(
    (value: string, source: 'blur' | 'select' = 'blur') => {
      const normalized = normalizeThirdParty(value);
      if (!normalized) {
        if (autoItemFromThirdParty) {
          setNewItemId(null);
          setAutoItemFromThirdParty(false);
        }
        if (autoPaymentMethodFromThirdParty) {
          setNewPaymentMethodId(null);
          setAutoPaymentMethodFromThirdParty(false);
        }
        return;
      }

      const lastMatch = transactions.find((transaction) => normalizeThirdParty(transaction.thirdParty) === normalized);
      const shouldApplySelectedSuggestion = source === 'select';

      if (lastMatch?.itemId) {
        if (shouldApplySelectedSuggestion || newItemId === null || autoItemFromThirdParty) {
          setNewItemId(lastMatch.itemId);
          setAutoItemFromThirdParty(true);
        }
      } else if (autoItemFromThirdParty) {
        setNewItemId(null);
        setAutoItemFromThirdParty(false);
      }

      if (lastMatch?.paymentMethodId) {
        if (shouldApplySelectedSuggestion || newPaymentMethodId === null || autoPaymentMethodFromThirdParty) {
          setNewPaymentMethodId(lastMatch.paymentMethodId);
          setAutoPaymentMethodFromThirdParty(true);
        }
      } else if (autoPaymentMethodFromThirdParty) {
        setNewPaymentMethodId(null);
        setAutoPaymentMethodFromThirdParty(false);
      }
    },
    [transactions, newItemId, autoItemFromThirdParty, newPaymentMethodId, autoPaymentMethodFromThirdParty]
  );

  const handleCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!newAmount || isSubmitting || !isValidDateFormat(newDate)) return;

    if (newEntryType === 'transaction') {
      if (!newItemId || !newPaymentMethodId) return;

      onSubmittingChange(true);
      try {
        await createTransaction({
          yearId,
          itemId: newItemId,
          date: parseDateInput(newDate), // Convert DD/MM/YYYY to YYYY-MM-DD
          description: newDescription.trim() || undefined,
          thirdParty: newThirdParty.trim() || undefined,
          paymentMethodId: newPaymentMethodId,
          amount: parseFloat(newAmount),
        });
        setNewDescription('');
        setNewThirdParty('');
        setNewPaymentMethodId(null);
        setAutoPaymentMethodFromThirdParty(false);
        setNewAmount('');
        setNewItemId(null);
        setAutoItemFromThirdParty(false);
        await onCreated();
      } catch (error) {
        logger.error('Failed to create transaction', error);
      } finally {
        onSubmittingChange(false);
      }
    } else {
      // Transfer
      const source = parseAccountString(newSourceAccount);
      const dest = parseAccountString(newDestAccount);
      if (!source || !dest) return;

      onSubmittingChange(true);
      try {
        await createTransfer(year, {
          date: parseDateInput(newDate),
          amount: parseFloat(newAmount),
          description: newDescription.trim() || undefined,
          sourceAccountId: source.id,
          destinationAccountId: dest.id,
        });
        setNewDescription('');
        setNewAmount('');
        setNewSourceAccount('');
        setNewDestAccount('');
        await onCreated();
      } catch (error) {
        logger.error('Failed to create transfer', error);
      } finally {
        onSubmittingChange(false);
      }
    }
  };

  return (
    <div className="transaction-form-card">
      <div className="form-type-toggle">
        <button
          type="button"
          className={`type-toggle-btn ${newEntryType === 'transaction' ? 'active' : ''}`}
          onClick={() => setNewEntryType('transaction')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="1" x2="12" y2="23" />
            <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
          </svg>
          {t('transactions.typeTransaction')}
        </button>
        <button
          type="button"
          className={`type-toggle-btn ${newEntryType === 'transfer' ? 'active' : ''}`}
          onClick={() => setNewEntryType('transfer')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="17 1 21 5 17 9" />
            <path d="M3 11V9a4 4 0 0 1 4-4h14" />
            <polyline points="7 23 3 19 7 15" />
            <path d="M21 13v2a4 4 0 0 1-4 4H3" />
          </svg>
          {t('transactions.typeTransfer')}
        </button>
      </div>

      <form onSubmit={handleCreate} className="transaction-form">
        <div className="form-row">
          <div className="date-input-wrapper">
            <input
              type="text"
              value={newDate}
              onChange={(e) => setNewDate(e.target.value)}
              placeholder={t('transactions.datePlaceholder')}
              pattern="\d{2}/\d{2}/\d{4}"
              className={`form-input date-input ${!isValidDateFormat(newDate) && newDate ? 'invalid' : ''}`}
            />
            <input
              type="date"
              className="date-picker-hidden"
              value={isValidDateFormat(newDate) ? parseDateInput(newDate) : ''}
              onChange={(e) => {
                if (e.target.value) {
                  const [y, m, d] = e.target.value.split('-');
                  setNewDate(`${d}/${m}/${y}`);
                }
              }}
            />
            <button
              type="button"
              className="date-picker-btn"
              onClick={(e) => {
                const hiddenInput = e.currentTarget.previousElementSibling as HTMLInputElement;
                hiddenInput?.showPicker?.();
              }}
              title={t('transactions.openCalendar')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
            </button>
          </div>

          {newEntryType === 'transaction' ? (
            <ThirdPartyAutocomplete
              value={newThirdParty}
              onChange={setNewThirdParty}
              onCommit={applyNewThirdPartySuggestion}
              placeholder={t('transactions.thirdPartyPlaceholder')}
              className="form-input third-party-input"
            />
          ) : (
            <>
              <select
                value={newSourceAccount}
                onChange={(e) => setNewSourceAccount(e.target.value)}
                className="form-select account-select"
                required
              >
                <option value="">{t('transactions.sourceAccount')}</option>
                <optgroup label={t('accounts.paymentAccounts')}>
                  {transferAccounts
                    .filter((a) => !a.isSavingsAccount)
                    .map((a) => (
                      <option key={`pm_${a.id}`} value={`${a.id}`}>
                        {formatWithInstitution(a.name, a.institution)}
                      </option>
                    ))}
                </optgroup>
                <optgroup label={t('accounts.savingsAccounts')}>
                  {transferAccounts
                    .filter((a) => a.isSavingsAccount)
                    .map((a) => (
                      <option key={`si_${a.id}`} value={`${a.id}`}>
                        {formatWithInstitution(a.name, a.institution)}
                      </option>
                    ))}
                </optgroup>
              </select>
              <span className="transfer-arrow">→</span>
              <select
                value={newDestAccount}
                onChange={(e) => setNewDestAccount(e.target.value)}
                className="form-select account-select"
                required
              >
                <option value="">{t('transactions.destinationAccount')}</option>
                <optgroup label={t('accounts.paymentAccounts')}>
                  {transferAccounts
                    .filter((a) => !a.isSavingsAccount)
                    .map((a) => (
                      <option key={`pm_${a.id}`} value={`${a.id}`}>
                        {formatWithInstitution(a.name, a.institution)}
                      </option>
                    ))}
                </optgroup>
                <optgroup label={t('accounts.savingsAccounts')}>
                  {transferAccounts
                    .filter((a) => a.isSavingsAccount)
                    .map((a) => (
                      <option key={`si_${a.id}`} value={`${a.id}`}>
                        {formatWithInstitution(a.name, a.institution)}
                      </option>
                    ))}
                </optgroup>
              </select>
            </>
          )}

          <input
            type="text"
            placeholder={t('transactions.descriptionPlaceholder')}
            value={newDescription}
            onChange={(e) => setNewDescription(e.target.value)}
            className="form-input description-input"
          />
        </div>

        {newEntryType === 'transaction' && (
          <div className="form-row">
            <select
              value={newPaymentMethodId ?? ''}
              onChange={(e) => {
                setNewPaymentMethodId(e.target.value ? Number(e.target.value) : null);
                setAutoPaymentMethodFromThirdParty(false);
              }}
              className="form-select payment-method-select"
            >
              <option value="">{t('transactions.paymentMethod')}</option>
              {paymentMethods
                .filter((m) => !m.isSavingsAccount)
                .map((method) => (
                  <option key={method.id} value={method.id}>
                    {formatWithInstitution(method.name, method.institution)}
                  </option>
                ))}
              {paymentMethods.some((m) => m.isSavingsAccount) && (
                <optgroup label={t('accounts.savingsAccounts')}>
                  {paymentMethods
                    .filter((m) => m.isSavingsAccount)
                    .map((method) => (
                      <option key={method.id} value={method.id}>
                        {formatWithInstitution(method.name, method.institution)}
                      </option>
                    ))}
                </optgroup>
              )}
            </select>
            <input
              type="number"
              placeholder={t('transactions.amountPlaceholder')}
              value={newAmount}
              onChange={(e) => setNewAmount(e.target.value)}
              step="0.01"
              className="form-input amount-input"
            />
          </div>
        )}

        <div className="form-row">
          {newEntryType === 'transaction' ? (
            <select
              value={newItemId || ''}
              onChange={(e) => {
                setNewItemId(e.target.value ? Number(e.target.value) : null);
                setAutoItemFromThirdParty(false);
              }}
              className="form-select category-select"
              required
            >
              <option value="">{t('transactions.selectCategory')}</option>
              {recentlyUsedCategoryItems.length > 0 && (
                <optgroup label={t('transactions.recentlyUsedCategories')}>
                  {recentlyUsedCategoryItems.map((item) => (
                    <option key={`recent_${item.id}`} value={item.id}>
                      {item.groupName} → {item.name}
                    </option>
                  ))}
                </optgroup>
              )}
              <optgroup label={t('budget.income')}>
                {incomeItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.groupName} → {item.name}
                  </option>
                ))}
              </optgroup>
              <optgroup label={t('budget.expenses')}>
                {expenseItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.groupName} → {item.name}
                  </option>
                ))}
              </optgroup>
              {savingsCategoryItems.length > 0 && (
                <optgroup label={t('budget.savings')}>
                  {savingsCategoryItems.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          ) : (
            <input
              type="number"
              placeholder={t('transactions.amountPlaceholder')}
              value={newAmount}
              onChange={(e) => setNewAmount(e.target.value)}
              step="0.01"
              className="form-input amount-input"
            />
          )}
          <button
            type="submit"
            className="btn-primary"
            disabled={
              !newAmount ||
              isSubmitting ||
              (newEntryType === 'transaction' && !newItemId) ||
              (newEntryType === 'transfer' && (!newSourceAccount || !newDestAccount))
            }
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            {t('common.add')}
          </button>
        </div>
      </form>
    </div>
  );
}
