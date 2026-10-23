import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import {
  type AccountIdentifier,
  deleteTransfer,
  fetchPaymentMethods,
  fetchTransferAccounts,
  fetchTransfers,
  type PaymentMethod,
  reorderTransactionEntries,
  type Transfer,
  updateTransfer,
} from '../api';
import { useI18n } from '../contexts/I18nContext';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import { formatDateDisplay, isValidDateFormat, parseDateInput } from '../utils';
import { logger } from '../utils/logger';
import ConfirmDialog from './ConfirmDialog';
import NewTransferForm from './NewTransferForm';
import TransferAccountOptions from './TransferAccountOptions';
import {
  type AccountingPeriod,
  calculateAccountingPeriod,
  formatWithInstitution,
  parseAccountString,
  transferDestinationPeriod,
  transferSourcePeriod,
} from './transactionFormUtils';
import {
  buildSelectionReorderUpdates,
  buildSingleReorderUpdates,
  canReorderSelectedEntries,
  type ReorderPriorityUpdate,
} from './transactionsReorder';

interface TransfersProps {
  year: number;
  yearId: number;
  onTransactionsChanged?: () => void;
  readOnly?: boolean;
}

interface Filters {
  dateFrom: Date | null;
  dateTo: Date | null;
  accountingPeriod: string;
  source: string;
  destination: string;
  description: string;
  accounts: number[];
}

const emptyFilters: Filters = {
  dateFrom: null,
  dateTo: null,
  accountingPeriod: '',
  source: '',
  destination: '',
  description: '',
  accounts: [],
};

type SortField = 'manual' | 'date' | 'source' | 'destination' | 'description' | 'amount';

interface EditDraft {
  original: Transfer;
  date: string;
  description: string;
  amount: string;
  source: string;
  destination: string;
  sourcePeriod: AccountingPeriod;
  destinationPeriod: AccountingPeriod;
  sourceOverridden: boolean;
  destinationOverridden: boolean;
}

function periodKey(period: AccountingPeriod) {
  return `${period.year}-${period.month}`;
}

function formatPeriod(period: AccountingPeriod, monthNames: string[]) {
  return `${monthNames[period.month - 1]} ${period.year}`;
}

function formatTransferPeriod(transfer: Transfer, monthNames: string[]) {
  const source = formatPeriod(transferSourcePeriod(transfer), monthNames);
  const destination = formatPeriod(transferDestinationPeriod(transfer), monthNames);
  return source === destination ? source : `${source} → ${destination}`;
}

export default function Transfers({ year, yearId, onTransactionsChanged, readOnly = false }: TransfersProps) {
  const { t, monthNames } = useI18n();
  const formatCurrency = useFormatCurrency();
  const { confirm, dialogProps } = useConfirmDialog();
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [transferAccounts, setTransferAccounts] = useState<AccountIdentifier[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [edit, setEdit] = useState<EditDraft | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [sortField, setSortField] = useState<SortField>('manual');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
  // Read the current role after confirmations, including handlers started before a role change.
  const current = useRef({ readOnly, isSubmitting, scope: `${yearId}:${year}`, mounted: true });
  current.current.readOnly = readOnly;
  current.current.scope = `${yearId}:${year}`;

  const setSubmitting = useCallback((value: boolean) => {
    current.current.isSubmitting = value;
    setIsSubmitting(value);
  }, []);
  const canMutate = () => current.current.mounted && !current.current.readOnly && !current.current.isSubmitting;

  useEffect(() => {
    current.current.mounted = true;
    return () => {
      current.current.mounted = false;
    };
  }, []);

  useEffect(() => {
    if (readOnly) {
      setEdit(null);
      setSelectedIds(new Set());
    }
  }, [readOnly]);

  useEffect(() => {
    let active = true;
    const scope = `${yearId}:${year}`;
    setLoading(true);
    setEdit(null);
    setSelectedIds(new Set());
    setFilters(emptyFilters);
    Promise.all([fetchTransfers(year), fetchPaymentMethods(), fetchTransferAccounts(year)])
      .then(([entries, methods, accounts]) => {
        if (!active || current.current.scope !== scope) return;
        setTransfers(entries);
        setPaymentMethods(methods);
        setTransferAccounts(accounts);
      })
      .catch((error) => logger.error('Failed to load transfers', error))
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [year, yearId]);

  useEffect(() => {
    const closeDropdowns = (event: MouseEvent) => {
      if (!(event.target as Element).closest('.multi-select-filter')) {
        document.querySelectorAll('.multi-select-dropdown.open').forEach((element) => {
          element.classList.remove('open');
        });
      }
    };
    document.addEventListener('click', closeDropdowns);
    return () => document.removeEventListener('click', closeDropdowns);
  }, []);

  const reloadTransfers = async () => {
    const scope = current.current.scope;
    try {
      const entries = await fetchTransfers(year);
      if (!current.current.mounted || current.current.scope !== scope) return;
      setTransfers(entries);
      const existingIds = new Set(entries.map((entry) => `x_${entry.id}`));
      setSelectedIds((ids) => new Set([...ids].filter((id) => existingIds.has(id))));
    } catch (error) {
      logger.error('Failed to load transfers', error);
    }
  };

  const accounts = useMemo(() => {
    const byId = new Map(transferAccounts.map((account) => [account.id, account]));
    for (const transfer of transfers) {
      if (!byId.has(transfer.sourceAccount.id)) byId.set(transfer.sourceAccount.id, transfer.sourceAccount);
      if (!byId.has(transfer.destinationAccount.id))
        byId.set(transfer.destinationAccount.id, transfer.destinationAccount);
    }
    return [...byId.values()]
      .map((account) => ({
        id: account.id,
        name: formatWithInstitution(account.name, account.institution),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [transferAccounts, transfers]);

  const accountingPeriods = useMemo(
    () =>
      [
        ...new Map(
          transfers.flatMap((transfer) => {
            const source = transferSourcePeriod(transfer);
            const destination = transferDestinationPeriod(transfer);
            return [
              [periodKey(source), source],
              [periodKey(destination), destination],
            ] as const;
          })
        ).values(),
      ].sort((a, b) => a.year - b.year || a.month - b.month),
    [transfers]
  );

  const manualTransfers = useMemo(
    () => [...transfers].sort((a, b) => b.date.localeCompare(a.date) || (b.sortPriority ?? 0) - (a.sortPriority ?? 0)),
    [transfers]
  );
  // The reorder domain always includes hidden rows on the same date.
  const reorderEntries = useMemo(
    () =>
      manualTransfers.map((transfer) => ({
        id: `x_${transfer.id}`,
        type: 'transfer' as const,
        date: transfer.date,
        sortPriority: transfer.sortPriority,
      })),
    [manualTransfers]
  );

  const filteredTransfers = useMemo(() => {
    const rows = manualTransfers.filter((transfer) => {
      const date = new Date(transfer.date.split('T')[0]);
      if (filters.dateFrom) {
        const start = new Date(filters.dateFrom);
        start.setHours(0, 0, 0, 0);
        if (date < start) return false;
      }
      if (filters.dateTo) {
        const end = new Date(filters.dateTo);
        end.setHours(23, 59, 59, 999);
        if (date > end) return false;
      }
      const sideMatches = (side: 'source' | 'destination') => {
        const account = side === 'source' ? transfer.sourceAccount : transfer.destinationAccount;
        const period = side === 'source' ? transferSourcePeriod(transfer) : transferDestinationPeriod(transfer);
        return (
          (!filters.accountingPeriod || periodKey(period) === filters.accountingPeriod) &&
          (filters.accounts.length === 0 || filters.accounts.includes(account.id))
        );
      };
      if (!sideMatches('source') && !sideMatches('destination')) return false;
      return (
        transfer.sourceAccount.name.toLowerCase().includes(filters.source.toLowerCase()) &&
        transfer.destinationAccount.name.toLowerCase().includes(filters.destination.toLowerCase()) &&
        (!filters.description || transfer.description?.toLowerCase().includes(filters.description.toLowerCase()))
      );
    });
    if (sortField === 'manual') return sortDirection === 'asc' ? rows : rows.reverse();
    return rows.sort((a, b) => {
      let order: number;
      if (sortField === 'amount') order = a.amount - b.amount;
      else if (sortField === 'source') order = a.sourceAccount.name.localeCompare(b.sourceAccount.name);
      else if (sortField === 'destination') order = a.destinationAccount.name.localeCompare(b.destinationAccount.name);
      else order = (a[sortField] ?? '').localeCompare(b[sortField] ?? '');
      return sortDirection === 'asc' ? order : -order;
    });
  }, [manualTransfers, filters, sortField, sortDirection]);

  const hasActiveFilters = Boolean(
    filters.dateFrom ||
      filters.dateTo ||
      filters.accountingPeriod ||
      filters.source ||
      filters.destination ||
      filters.description ||
      filters.accounts.length
  );
  const totalMoved = filteredTransfers.reduce((total, transfer) => total + transfer.amount, 0);
  const netSavings = filteredTransfers.reduce((total, transfer) => {
    const sourceMatches =
      !filters.accountingPeriod || periodKey(transferSourcePeriod(transfer)) === filters.accountingPeriod;
    const destinationMatches =
      !filters.accountingPeriod || periodKey(transferDestinationPeriod(transfer)) === filters.accountingPeriod;
    return (
      total +
      (transfer.destinationAccount.isSavingsAccount && destinationMatches ? transfer.amount : 0) -
      (transfer.sourceAccount.isSavingsAccount && sourceMatches ? transfer.amount : 0)
    );
  }, 0);
  const canReorderRows = !readOnly && !edit;
  const canReorderSelection = canReorderSelectedEntries(reorderEntries, selectedIds, canReorderRows);
  const allFilteredSelected =
    filteredTransfers.length > 0 && filteredTransfers.every((transfer) => selectedIds.has(`x_${transfer.id}`));
  const someFilteredSelected = filteredTransfers.some((transfer) => selectedIds.has(`x_${transfer.id}`));

  const reorder = async (updates: ReorderPriorityUpdate[]) => {
    if (!canMutate() || edit || updates.length === 0) return;
    setSubmitting(true);
    setSortField('manual');
    setSortDirection('asc');
    const previous = transfers;
    const priorities = new Map(updates.map((update) => [update.id, update.sortPriority]));
    setTransfers((entries) =>
      entries.map((transfer) =>
        priorities.has(transfer.id) ? { ...transfer, sortPriority: priorities.get(transfer.id) ?? null } : transfer
      )
    );
    try {
      await reorderTransactionEntries(updates);
      onTransactionsChanged?.();
    } catch (error) {
      setTransfers(previous);
      logger.error('Failed to reorder transfers', error);
    } finally {
      setSubmitting(false);
    }
  };

  const toggleSelect = (id: string) => {
    if (!canMutate()) return;
    setSelectedIds((ids) => {
      const next = new Set(ids);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleSelectAll = () => {
    if (!canMutate()) return;
    setSelectedIds((ids) => {
      const next = new Set(ids);
      for (const transfer of filteredTransfers) {
        const id = `x_${transfer.id}`;
        if (allFilteredSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  };

  const handleDelete = async (ids: number[], bulk = false) => {
    if (!canMutate() || ids.length === 0) return;
    const scope = current.current.scope;
    const confirmed = await confirm({
      title: t(bulk ? 'transactions.deleteSelectionTitle' : 'transactions.deleteTransferTitle'),
      message: bulk
        ? t('transactions.deleteSelectionMessage', { count: ids.length, suffix: ids.length > 1 ? 's' : '' })
        : t('transactions.deleteTransferConfirm'),
      confirmLabel: t('common.delete'),
      variant: 'danger',
    });
    if (!confirmed || !canMutate() || current.current.scope !== scope) return;
    setSubmitting(true);
    try {
      for (const id of ids) {
        if (current.current.readOnly || !current.current.mounted || current.current.scope !== scope) break;
        await deleteTransfer(id);
      }
      setSelectedIds(new Set());
      await reloadTransfers();
      onTransactionsChanged?.();
    } catch (error) {
      logger.error('Failed to delete transfers', error);
    } finally {
      setSubmitting(false);
    }
  };

  const settlementDay = (accountId: string) => {
    const id = Number(accountId);
    const account = transferAccounts.find((entry) => entry.id === id);
    if (account?.settlementDay !== undefined) return account.settlementDay;
    return paymentMethods.find((method) => method.id === id)?.settlementDay ?? null;
  };
  const startEdit = (transfer: Transfer) => {
    if (!canMutate()) return;
    setEdit({
      original: transfer,
      date: formatDateDisplay(transfer.date),
      description: transfer.description ?? '',
      amount: String(transfer.amount),
      source: String(transfer.sourceAccount.id),
      destination: String(transfer.destinationAccount.id),
      sourcePeriod: transferSourcePeriod(transfer),
      destinationPeriod: transferDestinationPeriod(transfer),
      sourceOverridden: false,
      destinationOverridden: false,
    });
  };
  const changeEditDate = (date: string) => {
    if (!edit) return;
    const next = { ...edit, date };
    if (isValidDateFormat(date)) {
      if (!edit.sourceOverridden)
        next.sourcePeriod = calculateAccountingPeriod(parseDateInput(date), settlementDay(edit.source));
      if (!edit.destinationOverridden)
        next.destinationPeriod = calculateAccountingPeriod(parseDateInput(date), settlementDay(edit.destination));
    }
    setEdit(next);
  };
  const changeEditAccount = (side: 'source' | 'destination', value: string) => {
    if (!edit) return;
    const next = { ...edit, [side]: value };
    if (!edit[`${side}Overridden`] && isValidDateFormat(edit.date)) {
      next[`${side}Period`] = calculateAccountingPeriod(parseDateInput(edit.date), settlementDay(value));
    }
    setEdit(next);
  };
  const handleUpdate = async () => {
    if (!canMutate() || !edit || !edit.amount || !isValidDateFormat(edit.date)) return;
    const source = parseAccountString(edit.source);
    const destination = parseAccountString(edit.destination);
    if (!source || !destination) return;
    const data: Parameters<typeof updateTransfer>[1] = {
      date: parseDateInput(edit.date),
      amount: parseFloat(edit.amount),
      description: edit.description.trim(),
      sourceAccountId: source.id,
      destinationAccountId: destination.id,
    };
    const dateChanged = data.date !== edit.original.date.split('T')[0];
    if (edit.sourceOverridden || dateChanged || source.id !== edit.original.sourceAccount.id) {
      data.sourceAccountingMonth = edit.sourcePeriod.month;
      data.sourceAccountingYear = edit.sourcePeriod.year;
    }
    if (edit.destinationOverridden || dateChanged || destination.id !== edit.original.destinationAccount.id) {
      data.destinationAccountingMonth = edit.destinationPeriod.month;
      data.destinationAccountingYear = edit.destinationPeriod.year;
    }
    setSubmitting(true);
    try {
      await updateTransfer(edit.original.id, data);
      setEdit(null);
      await reloadTransfers();
      onTransactionsChanged?.();
    } catch (error) {
      logger.error('Failed to update transfer', error);
    } finally {
      setSubmitting(false);
    }
  };

  const sort = (field: SortField) => {
    if (field === sortField) setSortDirection((direction) => (direction === 'asc' ? 'desc' : 'asc'));
    else {
      setSortField(field);
      setSortDirection(field === 'date' ? 'desc' : 'asc');
    }
  };
  const sortIcon = (field: SortField) => (
    <span className="sort-icon">{sortField === field ? (sortDirection === 'asc' ? '↑' : '↓') : '↕'}</span>
  );

  if (loading)
    return (
      <div className="transactions-container transfers-container">
        <div className="content-loading">
          <div className="loading-spinner" />
          <p>{t('transfers.loading')}</p>
        </div>
      </div>
    );

  return (
    <div className="transactions-container transfers-container">
      <div className="transactions-header">
        <div className="transactions-title-row">
          <h2>{t('transfers.title', { year })}</h2>
          <div className="transactions-actions">
            {canReorderSelection && (
              <div className="bulk-order-actions">
                {(['top', 'up', 'down', 'bottom'] as const).map((direction) => (
                  <button
                    key={direction}
                    type="button"
                    className="btn-order"
                    disabled={isSubmitting}
                    title={t(
                      direction === 'top'
                        ? 'transactions.moveSelectionToTop'
                        : direction === 'bottom'
                          ? 'transactions.moveSelectionToBottom'
                          : direction === 'up'
                            ? 'transactions.moveSelectionUp'
                            : 'transactions.moveSelectionDown'
                    )}
                    onClick={() => reorder(buildSelectionReorderUpdates(reorderEntries, selectedIds, direction))}
                  >
                    {direction === 'top' ? '⇈' : direction === 'bottom' ? '⇊' : direction === 'up' ? '↑' : '↓'}
                  </button>
                ))}
              </div>
            )}
            {!readOnly && selectedIds.size > 0 && (
              <button
                className="btn-danger"
                disabled={isSubmitting}
                onClick={() =>
                  handleDelete(
                    [...selectedIds].map((id) => Number(id.slice(2))),
                    true
                  )
                }
              >
                {t('transactions.deleteSelected', { count: selectedIds.size })}
              </button>
            )}
            {hasActiveFilters && (
              <button className="btn-clear-filters" onClick={() => setFilters(emptyFilters)}>
                {t('transactions.clearFilters')}
              </button>
            )}
          </div>
        </div>
        <div className="transactions-summary">
          <div className="summary-item count">
            <span className="summary-label">{t('transactions.summaryShown')}</span>
            <span className="summary-value">
              {filteredTransfers.length} / {transfers.length}
            </span>
          </div>
          <div className="summary-item moved">
            <span className="summary-label">{t('transfers.summaryMoved')}</span>
            <span className="summary-value">{formatCurrency(totalMoved, true)}</span>
          </div>
          {netSavings !== 0 && (
            <div className={`summary-item savings ${netSavings >= 0 ? 'positive' : 'negative'}`}>
              <span className="summary-label">{t('transactions.summarySavings')}</span>
              <span className="summary-value">{formatCurrency(netSavings, true)}</span>
            </div>
          )}
        </div>
      </div>
      {!readOnly && (
        <NewTransferForm
          year={year}
          paymentMethods={paymentMethods}
          transferAccounts={transferAccounts}
          isSubmitting={isSubmitting}
          onSubmittingChange={setSubmitting}
          onCreated={async () => {
            await reloadTransfers();
            onTransactionsChanged?.();
          }}
        />
      )}
      <div className="transactions-list">
        <div className="transactions-table-scroll">
          <table className="transactions-table transfer-records-table">
            <thead>
              <tr className="header-row">
                <th className="col-select">
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    disabled={readOnly || isSubmitting}
                    ref={(element) => {
                      if (element) element.indeterminate = someFilteredSelected && !allFilteredSelected;
                    }}
                    onChange={toggleSelectAll}
                    title={t('transactions.selectAll')}
                  />
                </th>
                <th
                  className="col-order sortable"
                  onClick={() => sort('manual')}
                  aria-label={t('transactions.order')}
                  title={t('transactions.order')}
                >
                  {sortIcon('manual')}
                </th>
                <th className="col-date sortable" onClick={() => sort('date')}>
                  {t('transactions.date')} {sortIcon('date')}
                </th>
                <th className="col-accounting">{t('transactions.accounting')}</th>
                <th className="col-source sortable" onClick={() => sort('source')}>
                  {t('transactions.sourceAccount')} {sortIcon('source')}
                </th>
                <th className="col-destination sortable" onClick={() => sort('destination')}>
                  {t('transactions.destinationAccount')} {sortIcon('destination')}
                </th>
                <th className="col-description sortable" onClick={() => sort('description')}>
                  {t('transactions.description')} {sortIcon('description')}
                </th>
                <th className="col-amount sortable" onClick={() => sort('amount')}>
                  {t('transactions.amount')} {sortIcon('amount')}
                </th>
                <th>{t('transactions.actions')}</th>
              </tr>
              <tr className="filter-row">
                <th></th>
                <th></th>
                <th>
                  <div className="date-range-filter">
                    <DatePicker
                      selectsRange
                      startDate={filters.dateFrom}
                      endDate={filters.dateTo}
                      onChange={(dates) => {
                        const [dateFrom, dateTo] = dates as [Date | null, Date | null];
                        setFilters((value) => ({ ...value, dateFrom, dateTo }));
                      }}
                      placeholderText={t('common.selectPlaceholder')}
                      className="column-filter date-range-input"
                      dateFormat="dd/MM/yyyy"
                      isClearable
                    />
                  </div>
                </th>
                <th>
                  <select
                    className="column-filter accounting-period-filter"
                    aria-label={t('transactions.accountingMonth')}
                    value={filters.accountingPeriod}
                    onChange={(event) => setFilters((value) => ({ ...value, accountingPeriod: event.target.value }))}
                  >
                    <option value="">{t('transactions.all')}</option>
                    {accountingPeriods.map((period) => (
                      <option key={periodKey(period)} value={periodKey(period)}>
                        {formatPeriod(period, monthNames)}
                      </option>
                    ))}
                  </select>
                </th>
                <th className="multi-select-filter-cell">
                  <input
                    type="text"
                    className="column-filter source-filter"
                    aria-label={t('transactions.sourceAccount')}
                    placeholder={t('transactions.filterPlaceholder')}
                    value={filters.source}
                    onChange={(event) => setFilters((value) => ({ ...value, source: event.target.value }))}
                  />
                  <div className="multi-select-filter">
                    <button
                      className={`multi-select-trigger ${filters.accounts.length ? 'has-selection' : ''}`}
                      aria-label={t('nav.accounts')}
                      onClick={(event) =>
                        (event.currentTarget.nextElementSibling as HTMLElement).classList.toggle('open')
                      }
                    >
                      {t('nav.accounts')}:{' '}
                      {filters.accounts.length === 0
                        ? t('transactions.all')
                        : filters.accounts.length === 1
                          ? accounts.find((account) => account.id === filters.accounts[0])?.name
                          : t('transactions.paymentMethodsSelected', { count: filters.accounts.length })}
                    </button>
                    <div className="multi-select-dropdown">
                      <label className="multi-select-option select-all">
                        <input
                          type="checkbox"
                          checked={filters.accounts.length === 0}
                          onChange={() => setFilters((value) => ({ ...value, accounts: [] }))}
                        />
                        <span>{t('transactions.all')}</span>
                      </label>
                      {accounts.map((account) => (
                        <label key={account.id} className="multi-select-option">
                          <input
                            type="checkbox"
                            checked={filters.accounts.includes(account.id)}
                            onChange={(event) => {
                              const checked = event.target.checked;
                              setFilters((value) => ({
                                ...value,
                                accounts: checked
                                  ? [...value.accounts, account.id]
                                  : value.accounts.filter((id) => id !== account.id),
                              }));
                            }}
                          />
                          <span>{account.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </th>
                <th>
                  <input
                    type="text"
                    className="column-filter destination-filter"
                    aria-label={t('transactions.destinationAccount')}
                    placeholder={t('transactions.filterPlaceholder')}
                    value={filters.destination}
                    onChange={(event) => setFilters((value) => ({ ...value, destination: event.target.value }))}
                  />
                </th>
                <th>
                  <input
                    type="text"
                    className="column-filter description-filter"
                    aria-label={t('transactions.description')}
                    placeholder={t('transactions.filterPlaceholder')}
                    value={filters.description}
                    onChange={(event) => setFilters((value) => ({ ...value, description: event.target.value }))}
                  />
                </th>
                <th></th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredTransfers.map((transfer) => {
                const id = `x_${transfer.id}`;
                const editing = edit?.original.id === transfer.id ? edit : null;
                const entry = reorderEntries.find((candidate) => candidate.id === id)!;
                return (
                  <tr
                    key={transfer.id}
                    className={`transfer-row ${editing ? 'editing-row' : ''} ${selectedIds.has(id) ? 'selected' : ''}`}
                  >
                    {editing ? (
                      <>
                        <td></td>
                        <td></td>
                        <td>
                          <div className="date-input-wrapper edit-date-wrapper">
                            <input
                              type="text"
                              value={editing.date}
                              onChange={(event) => changeEditDate(event.target.value)}
                              placeholder={t('transactions.datePlaceholder')}
                              className={`edit-input date-input ${!isValidDateFormat(editing.date) && editing.date ? 'invalid' : ''}`}
                            />
                          </div>
                        </td>
                        <td className="accounting-edit-cell transfer-accounting-edit-cell">
                          {(['source', 'destination'] as const).map((side) => (
                            <div key={side} className="transfer-accounting-group">
                              <span>
                                {t(
                                  side === 'source'
                                    ? 'transactions.sourceAccountingMonth'
                                    : 'transactions.destinationAccountingMonth'
                                )}
                              </span>
                              <select
                                className="edit-select accounting-month-select"
                                aria-label={t(
                                  side === 'source'
                                    ? 'transactions.sourceAccountingMonth'
                                    : 'transactions.destinationAccountingMonth'
                                )}
                                value={editing[`${side}Period`].month}
                                onChange={(event) =>
                                  setEdit({
                                    ...editing,
                                    [`${side}Period`]: {
                                      ...editing[`${side}Period`],
                                      month: Number(event.target.value),
                                    },
                                    [`${side}Overridden`]: true,
                                  })
                                }
                              >
                                {monthNames.map((name, index) => (
                                  <option key={index + 1} value={index + 1}>
                                    {name}
                                  </option>
                                ))}
                              </select>
                              <input
                                type="number"
                                min="2000"
                                max="2100"
                                className="edit-input accounting-year-input"
                                aria-label={t(
                                  side === 'source'
                                    ? 'transactions.sourceAccountingYear'
                                    : 'transactions.destinationAccountingYear'
                                )}
                                value={editing[`${side}Period`].year}
                                onChange={(event) =>
                                  setEdit({
                                    ...editing,
                                    [`${side}Period`]: {
                                      ...editing[`${side}Period`],
                                      year: Number(event.target.value),
                                    },
                                    [`${side}Overridden`]: true,
                                  })
                                }
                              />
                            </div>
                          ))}
                        </td>
                        {(['source', 'destination'] as const).map((side) => (
                          <td key={side} className="transfer-edit-accounts">
                            <select
                              value={editing[side]}
                              className="edit-select"
                              aria-label={t(
                                side === 'source' ? 'transactions.sourceAccount' : 'transactions.destinationAccount'
                              )}
                              onChange={(event) => changeEditAccount(side, event.target.value)}
                            >
                              <option value="">
                                {t(
                                  side === 'source' ? 'transactions.sourceAccount' : 'transactions.destinationAccount'
                                )}
                              </option>
                              <TransferAccountOptions accounts={transferAccounts} paymentMethods={paymentMethods} />
                            </select>
                          </td>
                        ))}
                        <td>
                          <input
                            type="text"
                            className="edit-input"
                            value={editing.description}
                            placeholder={t('transactions.description')}
                            onChange={(event) => setEdit({ ...editing, description: event.target.value })}
                          />
                        </td>
                        <td>
                          <input
                            type="number"
                            step="0.01"
                            className="edit-input amount"
                            value={editing.amount}
                            onChange={(event) => setEdit({ ...editing, amount: event.target.value })}
                          />
                        </td>
                        <td className="actions-cell">
                          <button
                            className="btn-icon save"
                            onClick={handleUpdate}
                            title={t('common.save')}
                            disabled={readOnly || isSubmitting}
                          >
                            ✓
                          </button>
                          <button
                            className="btn-icon cancel"
                            onClick={() => setEdit(null)}
                            title={t('common.cancel')}
                            disabled={isSubmitting}
                          >
                            ×
                          </button>
                        </td>
                      </>
                    ) : (
                      <>
                        <td>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(id)}
                            onChange={() => toggleSelect(id)}
                            disabled={readOnly || isSubmitting}
                          />
                        </td>
                        <td className="order-cell">
                          <div className="order-controls">
                            <button
                              type="button"
                              className="btn-icon reorder"
                              title={t('common.moveUp')}
                              disabled={!canReorderRows || isSubmitting}
                              onClick={() => reorder(buildSingleReorderUpdates(reorderEntries, entry, 'up'))}
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className="btn-icon reorder"
                              title={t('common.moveDown')}
                              disabled={!canReorderRows || isSubmitting}
                              onClick={() => reorder(buildSingleReorderUpdates(reorderEntries, entry, 'down'))}
                            >
                              ↓
                            </button>
                          </div>
                        </td>
                        <td className="date-cell">{formatDateDisplay(transfer.date)}</td>
                        <td className="accounting-cell">{formatTransferPeriod(transfer, monthNames)}</td>
                        <td className="source-cell">
                          {formatWithInstitution(transfer.sourceAccount.name, transfer.sourceAccount.institution)}
                        </td>
                        <td className="destination-cell">
                          {formatWithInstitution(
                            transfer.destinationAccount.name,
                            transfer.destinationAccount.institution
                          )}
                        </td>
                        <td className="description-cell">
                          {transfer.description || <span className="empty-field">-</span>}
                        </td>
                        <td
                          className={`amount-cell ${transfer.sourceAccount.isSavingsAccount || transfer.destinationAccount.isSavingsAccount ? 'savings-transfer' : 'transfer'} ${transfer.amount < 0 ? 'negative' : ''}`}
                        >
                          {formatCurrency(transfer.amount, true)}
                        </td>
                        <td className="actions-cell">
                          {!readOnly && (
                            <>
                              <button
                                className="btn-icon edit"
                                onClick={() => startEdit(transfer)}
                                title={t('common.edit')}
                                disabled={isSubmitting}
                              >
                                <svg
                                  width="16"
                                  height="16"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                >
                                  <path d="M11 4H4v16h16v-7M18 2l4 4-10 10-4 1 1-4z" />
                                </svg>
                              </button>
                              <button
                                className="btn-icon delete"
                                onClick={() => handleDelete([transfer.id])}
                                title={t('common.delete')}
                                disabled={isSubmitting}
                              >
                                <svg
                                  width="16"
                                  height="16"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                >
                                  <path d="M3 6h18M5 6l2 14h10l2-14M9 6V3h6v3" />
                                </svg>
                              </button>
                            </>
                          )}
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filteredTransfers.length === 0 && (
          <div className="empty-transactions" role="status">
            <p>{t(transfers.length === 0 ? 'transfers.empty' : 'transfers.emptyFiltered')}</p>
            {hasActiveFilters && (
              <button className="btn-link" onClick={() => setFilters(emptyFilters)}>
                {t('transactions.clearFilters')}
              </button>
            )}
          </div>
        )}
      </div>
      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
