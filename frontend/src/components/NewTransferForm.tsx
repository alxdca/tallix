import { type FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { type AccountIdentifier, createTransfer, type PaymentMethod } from '../api';
import { useI18n } from '../contexts/I18nContext';
import { getTodayDisplay, isValidDateFormat, parseDateInput } from '../utils';
import { logger } from '../utils/logger';
import TransferAccountOptions from './TransferAccountOptions';
import { type AccountingPeriod, calculateAccountingPeriod, parseAccountString } from './transactionFormUtils';

interface NewTransferFormProps {
  year: number;
  paymentMethods: PaymentMethod[];
  transferAccounts: AccountIdentifier[];
  isSubmitting: boolean;
  onSubmittingChange: (isSubmitting: boolean) => void;
  onCreated: () => Promise<void>;
}

export default function NewTransferForm({
  year,
  paymentMethods,
  transferAccounts,
  isSubmitting,
  onSubmittingChange,
  onCreated,
}: NewTransferFormProps) {
  const { t, monthNames } = useI18n();
  const [date, setDate] = useState(getTodayDisplay);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [source, setSource] = useState('');
  const [destination, setDestination] = useState('');
  const [sourcePeriod, setSourcePeriod] = useState<AccountingPeriod>({ month: 1, year });
  const [destinationPeriod, setDestinationPeriod] = useState<AccountingPeriod>({ month: 1, year });
  const [sourceOverridden, setSourceOverridden] = useState(false);
  const [destinationOverridden, setDestinationOverridden] = useState(false);
  const mounted = useRef(true);
  const submitting = useRef(isSubmitting);
  submitting.current = isSubmitting;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const settlementDay = useCallback(
    (accountId: string) => {
      const id = Number(accountId);
      const account = transferAccounts.find((entry) => entry.id === id);
      if (account?.settlementDay !== undefined) return account.settlementDay;
      return paymentMethods.find((method) => method.id === id)?.settlementDay ?? null;
    },
    [paymentMethods, transferAccounts]
  );

  useEffect(() => {
    if (!isValidDateFormat(date)) return;
    const isoDate = parseDateInput(date);
    if (source && !sourceOverridden) setSourcePeriod(calculateAccountingPeriod(isoDate, settlementDay(source)));
    if (destination && !destinationOverridden) {
      setDestinationPeriod(calculateAccountingPeriod(isoDate, settlementDay(destination)));
    }
  }, [date, source, destination, sourceOverridden, destinationOverridden, settlementDay]);

  const handleCreate = async (event: FormEvent) => {
    event.preventDefault();
    if (!mounted.current || submitting.current || !amount || !isValidDateFormat(date)) return;
    const sourceAccount = parseAccountString(source);
    const destinationAccount = parseAccountString(destination);
    if (!sourceAccount || !destinationAccount) return;
    submitting.current = true;
    onSubmittingChange(true);
    try {
      await createTransfer(year, {
        date: parseDateInput(date),
        amount: parseFloat(amount),
        description: description.trim() || undefined,
        sourceAccountId: sourceAccount.id,
        destinationAccountId: destinationAccount.id,
        sourceAccountingMonth: sourcePeriod.month,
        sourceAccountingYear: sourcePeriod.year,
        destinationAccountingMonth: destinationPeriod.month,
        destinationAccountingYear: destinationPeriod.year,
      });
      if (!mounted.current) return;
      setDescription('');
      setAmount('');
      setSource('');
      setDestination('');
      setSourceOverridden(false);
      setDestinationOverridden(false);
      await onCreated();
    } catch (error) {
      logger.error('Failed to create transfer', error);
    } finally {
      submitting.current = false;
      onSubmittingChange(false);
    }
  };

  return (
    <div className="transaction-form-card">
      <form onSubmit={handleCreate} className="transaction-form">
        <div className="form-row">
          <div className="date-input-wrapper">
            <input
              type="text"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              placeholder={t('transactions.datePlaceholder')}
              pattern="\d{2}/\d{2}/\d{4}"
              className={`form-input date-input ${!isValidDateFormat(date) && date ? 'invalid' : ''}`}
            />
            <input
              type="date"
              className="date-picker-hidden"
              value={isValidDateFormat(date) ? parseDateInput(date) : ''}
              onChange={(event) => {
                if (event.target.value) {
                  const [y, m, d] = event.target.value.split('-');
                  setDate(`${d}/${m}/${y}`);
                }
              }}
            />
            <button
              type="button"
              className="date-picker-btn"
              title={t('transactions.openCalendar')}
              onClick={(event) => (event.currentTarget.previousElementSibling as HTMLInputElement)?.showPicker?.()}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="3" y="4" width="18" height="18" rx="2" />
                <path d="M16 2v4M8 2v4M3 10h18" />
              </svg>
            </button>
          </div>
          <select
            value={source}
            aria-label={t('transactions.sourceAccount')}
            className="form-select account-select"
            required
            onChange={(event) => {
              setSource(event.target.value);
              setSourceOverridden(false);
            }}
          >
            <option value="">{t('transactions.sourceAccount')}</option>
            <TransferAccountOptions accounts={transferAccounts} paymentMethods={paymentMethods} />
          </select>
          <span className="transfer-arrow">→</span>
          <select
            value={destination}
            aria-label={t('transactions.destinationAccount')}
            className="form-select account-select"
            required
            onChange={(event) => {
              setDestination(event.target.value);
              setDestinationOverridden(false);
            }}
          >
            <option value="">{t('transactions.destinationAccount')}</option>
            <TransferAccountOptions accounts={transferAccounts} paymentMethods={paymentMethods} />
          </select>
          <input
            type="text"
            placeholder={t('transactions.descriptionPlaceholder')}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            className="form-input description-input"
          />
        </div>
        <div className="form-row transfer-accounting-row">
          <label className="transfer-accounting-group">
            <span>{t('transactions.sourceAccountingMonth')}</span>
            <select
              aria-label={t('transactions.sourceAccountingMonth')}
              value={sourcePeriod.month}
              onChange={(event) => {
                setSourcePeriod({ ...sourcePeriod, month: Number(event.target.value) });
                setSourceOverridden(true);
              }}
              className="form-select accounting-month-select"
            >
              {monthNames.map((name, index) => (
                <option key={index + 1} value={index + 1}>
                  {name}
                </option>
              ))}
            </select>
            <input
              aria-label={t('transactions.sourceAccountingYear')}
              type="number"
              value={sourcePeriod.year}
              onChange={(event) => {
                setSourcePeriod({ ...sourcePeriod, year: Number(event.target.value) });
                setSourceOverridden(true);
              }}
              className="form-input accounting-year-input"
              min="2000"
              max="2100"
            />
          </label>
          <label className="transfer-accounting-group">
            <span>{t('transactions.destinationAccountingMonth')}</span>
            <select
              aria-label={t('transactions.destinationAccountingMonth')}
              value={destinationPeriod.month}
              onChange={(event) => {
                setDestinationPeriod({ ...destinationPeriod, month: Number(event.target.value) });
                setDestinationOverridden(true);
              }}
              className="form-select accounting-month-select"
            >
              {monthNames.map((name, index) => (
                <option key={index + 1} value={index + 1}>
                  {name}
                </option>
              ))}
            </select>
            <input
              aria-label={t('transactions.destinationAccountingYear')}
              type="number"
              value={destinationPeriod.year}
              onChange={(event) => {
                setDestinationPeriod({ ...destinationPeriod, year: Number(event.target.value) });
                setDestinationOverridden(true);
              }}
              className="form-input accounting-year-input"
              min="2000"
              max="2100"
            />
          </label>
        </div>
        <div className="form-row">
          <input
            type="number"
            placeholder={t('transactions.amountPlaceholder')}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            step="0.01"
            className="form-input amount-input"
          />
          <button type="submit" className="btn-primary" disabled={!amount || isSubmitting || !source || !destination}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M5 12h14" />
            </svg>
            {t('common.add')}
          </button>
        </div>
      </form>
    </div>
  );
}
