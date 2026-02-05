import React, { useCallback, useEffect, useMemo, useState } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import {
  type AccountIdentifier,
  bulkDeleteTransactions,
  createTransaction,
  createTransfer,
  deleteTransaction,
  deleteTransfer,
  fetchPaymentMethods,
  fetchTransactions,
  fetchTransferAccounts,
  fetchTransfers,
  type PaymentMethod,
  type Transaction,
  type Transfer,
  updateTransaction,
  updateTransfer,
} from '../api';
import { useI18n } from '../contexts/I18nContext';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import type { BudgetGroup } from '../types';
import { formatDateDisplay, getTodayDisplay, isValidDateFormat, parseDateInput } from '../utils';
import { logger } from '../utils/logger';
import BulkImportModal from './BulkImportModal';
import ConfirmDialog from './ConfirmDialog';
import ThirdPartyAutocomplete from './ThirdPartyAutocomplete';

// Helper to format name with institution
const formatWithInstitution = (name: string, institution: string | null): string => {
  return institution ? `${name} (${institution})` : name;
};

type EntryType = 'transaction' | 'transfer';

interface UnifiedEntry {
  id: string; // "t_123" for transactions, "x_456" for transfers
  type: EntryType;
  date: string;
  description: string | null;
  amount: number;
  accountingMonth: number;
  accountingYear: number;
  // Transaction-specific
  transaction?: Transaction;
  // Transfer-specific
  transfer?: Transfer;
}

function formatAccountingPeriod(month: number, year: number, monthNames: string[]): string {
  return `${monthNames[month - 1]} ${year}`;
}

interface TransactionsProps {
  year: number;
  yearId: number;
  groups: BudgetGroup[];
  onTransactionsChanged?: () => void;
}

type SortField = 'date' | 'thirdParty' | 'description' | 'paymentMethod' | 'category' | 'amount';
type SortDirection = 'asc' | 'desc';

interface Filters {
  dateFrom: Date | null;
  dateTo: Date | null;
  thirdParty: string;
  description: string;
  paymentMethods: number[]; // Multiple payment method IDs can be selected
  categoryFilter: string; // Combined: "section:income", "group:Salaires"
}

export default function Transactions({ year, yearId, groups, onTransactionsChanged }: TransactionsProps) {
  const formatCurrency = useFormatCurrency();
  const { dialogProps, confirm } = useConfirmDialog();
  const { t, monthNames } = useI18n();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [transfers, setTransfers] = useState<Transfer[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [transferAccounts, setTransferAccounts] = useState<AccountIdentifier[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null); // "t_123" or "x_456"
  const [showImportModal, setShowImportModal] = useState(false);

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set()); // "t_123" or "x_456"

  // Filters state
  const [filters, setFilters] = useState<Filters>({
    dateFrom: null,
    dateTo: null,
    thirdParty: '',
    description: '',
    paymentMethods: [],
    categoryFilter: '',
  });

  // Sort state
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc');

  // Form state (dates stored in DD/MM/YYYY display format)
  const [newEntryType, setNewEntryType] = useState<EntryType>('transaction');
  const [newDate, setNewDate] = useState(getTodayDisplay());
  const [newDescription, setNewDescription] = useState('');
  const [newThirdParty, setNewThirdParty] = useState('');
  const [newPaymentMethodId, setNewPaymentMethodId] = useState<number | null>(null);
  const [newAmount, setNewAmount] = useState('');
  const [newItemId, setNewItemId] = useState<number | null>(null);
  // Transfer-specific form state
  const [newSourceAccount, setNewSourceAccount] = useState(''); // Account ID
  const [newDestAccount, setNewDestAccount] = useState('');

  // Edit form state
  const [editDate, setEditDate] = useState('');
  const [editDescription, setEditDescription] = useState('');
  const [editComment, setEditComment] = useState('');
  const [editThirdParty, setEditThirdParty] = useState('');
  const [editPaymentMethodId, setEditPaymentMethodId] = useState<number | null>(null);
  const [editAmount, setEditAmount] = useState('');
  const [editItemId, setEditItemId] = useState<number | null>(null);
  const [editAccountingMonth, setEditAccountingMonth] = useState<number>(1);
  const [editAccountingYear, setEditAccountingYear] = useState<number>(new Date().getFullYear());
  // Track original values to detect if user explicitly changed accounting fields
  const [originalDate, setOriginalDate] = useState('');
  const [originalPaymentMethodId, setOriginalPaymentMethodId] = useState<number | null>(null);
  const [originalAccountingMonth, setOriginalAccountingMonth] = useState<number>(1);
  const [originalAccountingYear, setOriginalAccountingYear] = useState<number>(new Date().getFullYear());
  // Edit transfer state
  const [editSourceAccount, setEditSourceAccount] = useState('');
  const [editDestAccount, setEditDestAccount] = useState('');

  // Get all items from all groups (savings accounts are now real budget items in "Épargne" group)
  const allItems = groups.flatMap((g) =>
    g.items.map((item) => ({
      ...item,
      groupName: g.name,
      groupType: g.type,
    }))
  );

  const incomeItems = allItems.filter((i) => i.groupType === 'income');
  const expenseItems = allItems.filter((i) => i.groupType === 'expense');
  const savingsCategoryItems = allItems.filter((i) => i.groupType === 'savings');

  // Get unique values for filter dropdowns (include transfer accounts)
  const uniquePaymentMethods = useMemo(() => {
    const methodIds = new Set<number>();
    // Add transaction payment method IDs
    transactions.forEach((t) => {
      if (t.paymentMethodId) methodIds.add(t.paymentMethodId);
    });
    // Add transfer account IDs
    transfers.forEach((x) => {
      methodIds.add(x.sourceAccount.id);
      methodIds.add(x.destinationAccount.id);
    });
    // Convert IDs to payment method objects with display names
    return Array.from(methodIds)
      .map((id) => {
        const pm = paymentMethods.find((m) => m.id === id);
        if (!pm) return null;
        return {
          id: pm.id,
          name: pm.institution ? `${pm.name} (${pm.institution})` : pm.name,
        };
      })
      .filter((pm): pm is { id: number; name: string } => pm !== null)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [transactions, transfers, paymentMethods]);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [transactionsData, methodsData, transfersData, accountsData] = await Promise.all([
        fetchTransactions(),
        fetchPaymentMethods(),
        fetchTransfers(year),
        fetchTransferAccounts(year),
      ]);
      setTransactions(transactionsData);
      setPaymentMethods(methodsData);
      setTransfers(transfersData);
      setTransferAccounts(accountsData);
    } catch (error) {
      logger.error('Failed to load data', error);
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Close multi-select dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Element;
      if (!target.closest('.multi-select-filter')) {
        document.querySelectorAll('.multi-select-dropdown.open').forEach((el) => {
          el.classList.remove('open');
        });
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, []);

  const loadTransactions = async () => {
    try {
      const [transactionsData, transfersData] = await Promise.all([fetchTransactions(), fetchTransfers(year)]);
      setTransactions(transactionsData);
      setTransfers(transfersData);
      // Clear selections that no longer exist
      setSelectedIds((prev) => {
        const newSet = new Set<string>();
        const existingTxIds = new Set(transactionsData.map((t) => `t_${t.id}`));
        const existingXferIds = new Set(transfersData.map((x) => `x_${x.id}`));
        prev.forEach((id) => {
          if (existingTxIds.has(id) || existingXferIds.has(id)) newSet.add(id);
        });
        return newSet;
      });
    } catch (error) {
      logger.error('Failed to load transactions', error);
    }
  };

  // Combine transactions and transfers into unified entries
  const unifiedEntries = useMemo((): UnifiedEntry[] => {
    const txEntries: UnifiedEntry[] = transactions.map((t) => ({
      id: `t_${t.id}`,
      type: 'transaction' as EntryType,
      date: t.date,
      description: t.description,
      amount: t.amount,
      accountingMonth: t.accountingMonth,
      accountingYear: t.accountingYear,
      transaction: t,
    }));

    const xferEntries: UnifiedEntry[] = transfers.map((x) => ({
      id: `x_${x.id}`,
      type: 'transfer' as EntryType,
      date: x.date,
      description: x.description,
      amount: x.amount,
      accountingMonth: x.accountingMonth,
      accountingYear: x.accountingYear,
      transfer: x,
    }));

    return [...txEntries, ...xferEntries];
  }, [transactions, transfers]);

  // Filtered and sorted entries
  const filteredEntries = useMemo(() => {
    let result = [...unifiedEntries];

    // Apply date range filter
    if (filters.dateFrom || filters.dateTo) {
      result = result.filter((e) => {
        // Parse entry date (handles both YYYY-MM-DD and datetime strings)
        const entryDate = new Date(e.date.split('T')[0]);

        if (filters.dateFrom) {
          const from = new Date(filters.dateFrom);
          from.setHours(0, 0, 0, 0);
          if (entryDate < from) return false;
        }
        if (filters.dateTo) {
          const to = new Date(filters.dateTo);
          to.setHours(23, 59, 59, 999);
          if (entryDate > to) return false;
        }
        return true;
      });
    }
    if (filters.thirdParty) {
      const search = filters.thirdParty.toLowerCase();
      result = result.filter((e) => {
        if (e.type === 'transaction') {
          return e.transaction?.thirdParty?.toLowerCase().includes(search);
        } else {
          // For transfers, search in source/destination account names
          const srcName = e.transfer?.sourceAccount.name.toLowerCase() || '';
          const dstName = e.transfer?.destinationAccount.name.toLowerCase() || '';
          return srcName.includes(search) || dstName.includes(search);
        }
      });
    }
    if (filters.description) {
      const search = filters.description.toLowerCase();
      result = result.filter((e) => e.description?.toLowerCase().includes(search));
    }
    if (filters.paymentMethods.length > 0) {
      result = result.filter((e) => {
        if (e.type === 'transaction') {
          return e.transaction?.paymentMethodId && filters.paymentMethods.includes(e.transaction.paymentMethodId);
        }
        // For transfers, check if source or destination account ID matches any selected method
        if (e.type === 'transfer' && e.transfer) {
          return (
            filters.paymentMethods.includes(e.transfer.sourceAccount.id) ||
            filters.paymentMethods.includes(e.transfer.destinationAccount.id)
          );
        }
        return false;
      });
    }
    // Filter by category (hierarchical: section, group, or item)
    if (filters.categoryFilter) {
      const [filterType, filterValue] = filters.categoryFilter.split(':');
      if (filterType === 'section') {
        if (filterValue === 'transfer') {
          result = result.filter((e) => e.type === 'transfer');
        } else {
          result = result.filter((e) => e.type === 'transaction' && e.transaction?.groupType === filterValue);
        }
      } else if (filterType === 'group') {
        result = result.filter((e) => e.type === 'transaction' && e.transaction?.groupName === filterValue);
      } else if (filterType === 'item') {
        result = result.filter((e) => {
          if (e.type !== 'transaction') return false;
          const t = e.transaction!;
          const cat = t.groupName && t.itemName ? `${t.groupName} → ${t.itemName}` : null;
          return cat === filterValue;
        });
      }
    }

    // Apply sorting
    result.sort((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case 'date':
          comparison = a.date.localeCompare(b.date);
          break;
        case 'thirdParty': {
          const thirdPartyA =
            a.type === 'transaction'
              ? a.transaction?.thirdParty || ''
              : `${a.transfer?.sourceAccount.name} → ${a.transfer?.destinationAccount.name}`;
          const thirdPartyB =
            b.type === 'transaction'
              ? b.transaction?.thirdParty || ''
              : `${b.transfer?.sourceAccount.name} → ${b.transfer?.destinationAccount.name}`;
          comparison = thirdPartyA.localeCompare(thirdPartyB);
          break;
        }
        case 'description':
          comparison = (a.description || '').localeCompare(b.description || '');
          break;
        case 'paymentMethod': {
          const pmA = a.type === 'transaction' ? a.transaction?.paymentMethod || '' : '';
          const pmB = b.type === 'transaction' ? b.transaction?.paymentMethod || '' : '';
          comparison = pmA.localeCompare(pmB);
          break;
        }
        case 'category': {
          const transferLabel = t('transactions.typeTransfer');
          const catA =
            a.type === 'transaction' && a.transaction?.groupName && a.transaction?.itemName
              ? `${a.transaction.groupName} → ${a.transaction.itemName}`
              : a.type === 'transfer'
                ? transferLabel
                : '';
          const catB =
            b.type === 'transaction' && b.transaction?.groupName && b.transaction?.itemName
              ? `${b.transaction.groupName} → ${b.transaction.itemName}`
              : b.type === 'transfer'
                ? transferLabel
                : '';
          comparison = catA.localeCompare(catB);
          break;
        }
        case 'amount':
          comparison = a.amount - b.amount;
          break;
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [unifiedEntries, filters, sortField, sortDirection, t]);

  // Selection handlers
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    const filteredIds = filteredEntries.map((e) => e.id);
    const allSelected = filteredIds.every((id) => selectedIds.has(id));

    if (allSelected) {
      // Deselect all filtered
      setSelectedIds((prev) => {
        const newSet = new Set(prev);
        for (const id of filteredIds) {
          newSet.delete(id);
        }
        return newSet;
      });
    } else {
      // Select all filtered
      setSelectedIds((prev) => {
        const newSet = new Set(prev);
        for (const id of filteredIds) {
          newSet.add(id);
        }
        return newSet;
      });
    }
  }, [filteredEntries, selectedIds]);

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;

    const count = selectedIds.size;
    const confirmed = await confirm({
      title: t('transactions.deleteSelectionTitle'),
      message: t('transactions.deleteSelectionMessage', { count, suffix: count > 1 ? 's' : '' }),
      confirmLabel: t('common.delete'),
      variant: 'danger',
    });
    if (!confirmed) return;

    setIsSubmitting(true);
    try {
      // Separate transaction IDs and transfer IDs
      const txIds: number[] = [];
      const xferIds: number[] = [];
      selectedIds.forEach((id) => {
        if (id.startsWith('t_')) {
          txIds.push(parseInt(id.substring(2), 10));
        } else if (id.startsWith('x_')) {
          xferIds.push(parseInt(id.substring(2), 10));
        }
      });

      // Delete transactions in bulk
      if (txIds.length > 0) {
        await bulkDeleteTransactions(txIds);
      }
      // Delete transfers one by one
      for (const id of xferIds) {
        await deleteTransfer(id);
      }

      setSelectedIds(new Set());
      await loadTransactions();
      onTransactionsChanged?.();
    } catch (error) {
      logger.error('Failed to bulk delete', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Sort handler
  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('desc');
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) {
      return (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.3">
          <path d="M7 15l5 5 5-5M7 9l5-5 5 5" />
        </svg>
      );
    }
    return sortDirection === 'asc' ? (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M7 14l5-5 5 5" />
      </svg>
    ) : (
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M7 10l5 5 5-5" />
      </svg>
    );
  };

  // Clear filters
  const clearFilters = () => {
    setFilters({
      dateFrom: null,
      dateTo: null,
      thirdParty: '',
      description: '',
      paymentMethods: [],
      categoryFilter: '',
    });
  };

  const hasActiveFilters =
    filters.dateFrom ||
    filters.dateTo ||
    filters.thirdParty ||
    filters.description ||
    filters.paymentMethods.length > 0 ||
    filters.categoryFilter;

  // Parse account ID string
  const parseAccountString = (str: string): { id: number } | null => {
    if (!str) return null;
    const id = parseInt(str, 10);
    if (Number.isNaN(id)) return null;
    return { id };
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAmount || isSubmitting || !isValidDateFormat(newDate)) return;

    if (newEntryType === 'transaction') {
      if (!newItemId || !newPaymentMethodId) return;

      setIsSubmitting(true);
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
        setNewAmount('');
        setNewItemId(null);
        await loadTransactions();
        onTransactionsChanged?.();
      } catch (error) {
        logger.error('Failed to create transaction', error);
      } finally {
        setIsSubmitting(false);
      }
    } else {
      // Transfer
      const source = parseAccountString(newSourceAccount);
      const dest = parseAccountString(newDestAccount);
      if (!source || !dest) return;

      setIsSubmitting(true);
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
        await loadTransactions();
        onTransactionsChanged?.();
      } catch (error) {
        logger.error('Failed to create transfer', error);
      } finally {
        setIsSubmitting(false);
      }
    }
  };

  const startEditTransaction = (transaction: Transaction) => {
    setEditingId(`t_${transaction.id}`); // Use entry ID format
    const dateDisplay = formatDateDisplay(transaction.date);
    setEditDate(dateDisplay); // Convert YYYY-MM-DD to DD/MM/YYYY
    setEditDescription(transaction.description || '');
    setEditComment(transaction.comment || '');
    setEditThirdParty(transaction.thirdParty || '');
    setEditPaymentMethodId(transaction.paymentMethodId);
    setEditAmount(transaction.amount.toString());
    setEditItemId(transaction.itemId);
    setEditAccountingMonth(transaction.accountingMonth);
    setEditAccountingYear(transaction.accountingYear);
    // Store original values to detect explicit changes
    setOriginalDate(dateDisplay);
    setOriginalPaymentMethodId(transaction.paymentMethodId);
    setOriginalAccountingMonth(transaction.accountingMonth);
    setOriginalAccountingYear(transaction.accountingYear);
  };

  const startEditTransfer = (transfer: Transfer) => {
    setEditingId(`x_${transfer.id}`); // Use entry ID format
    const dateDisplay = formatDateDisplay(transfer.date);
    setEditDate(dateDisplay);
    setEditDescription(transfer.description || '');
    setEditAmount(transfer.amount.toString());
    setEditSourceAccount(`${transfer.sourceAccount.id}`);
    setEditDestAccount(`${transfer.destinationAccount.id}`);
    setEditAccountingMonth(transfer.accountingMonth);
    setEditAccountingYear(transfer.accountingYear);
    // Store original values to detect explicit changes
    setOriginalDate(dateDisplay);
    setOriginalPaymentMethodId(null);
    setOriginalAccountingMonth(transfer.accountingMonth);
    setOriginalAccountingYear(transfer.accountingYear);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDate('');
    setEditDescription('');
    setEditComment('');
    setEditThirdParty('');
    setEditPaymentMethodId(null);
    setEditAmount('');
    setEditItemId(null);
    setEditAccountingMonth(1);
    setEditAccountingYear(new Date().getFullYear());
    setEditSourceAccount('');
    setEditDestAccount('');
    // Reset original values
    setOriginalDate('');
    setOriginalPaymentMethodId(null);
    setOriginalAccountingMonth(1);
    setOriginalAccountingYear(new Date().getFullYear());
  };

  const handleUpdate = async () => {
    if (!editAmount || !editingId || isSubmitting || !isValidDateFormat(editDate)) return;

    const isTransferEdit = editingId.startsWith('x_');
    const numericId = parseInt(editingId.substring(2), 10);

    // Check if user explicitly changed accounting fields
    const accountingExplicitlyChanged =
      editAccountingMonth !== originalAccountingMonth || editAccountingYear !== originalAccountingYear;

    // Check if date or payment method changed (which would affect accounting calculation)
    const dateChanged = editDate !== originalDate;
    const paymentMethodChanged = editPaymentMethodId !== originalPaymentMethodId;

    setIsSubmitting(true);
    try {
      if (isTransferEdit) {
        // Update transfer
        const source = parseAccountString(editSourceAccount);
        const dest = parseAccountString(editDestAccount);
        if (!source || !dest) return;

        // Only send accounting fields if user explicitly changed them
        // Otherwise, let backend recalculate if date changed
        const transferData: Parameters<typeof updateTransfer>[1] = {
          date: parseDateInput(editDate),
          amount: parseFloat(editAmount),
          description: editDescription.trim(),
          sourceAccountId: source.id,
          destinationAccountId: dest.id,
        };

        if (accountingExplicitlyChanged) {
          transferData.accountingMonth = editAccountingMonth;
          transferData.accountingYear = editAccountingYear;
        }
        // Note: Backend will recalculate if date changed and no explicit accounting provided

        await updateTransfer(numericId, transferData);
      } else {
        // Update transaction
        if (!editPaymentMethodId) return;
        
        const transactionData: Parameters<typeof updateTransaction>[1] = {
          itemId: editItemId,
          date: parseDateInput(editDate),
          description: editDescription.trim(),
          comment: editComment.trim(),
          thirdParty: editThirdParty.trim() || undefined,
          paymentMethodId: editPaymentMethodId,
          amount: parseFloat(editAmount),
        };

        if (accountingExplicitlyChanged) {
          // User explicitly changed accounting fields - send them
          transactionData.accountingMonth = editAccountingMonth;
          transactionData.accountingYear = editAccountingYear;
        } else if (dateChanged || paymentMethodChanged) {
          // Date or payment method changed but accounting wasn't touched - ask backend to recalculate
          transactionData.recalculateAccounting = true;
        }
        // If nothing changed that affects accounting, don't send any accounting fields

        await updateTransaction(numericId, transactionData);
      }
      cancelEdit();
      await loadTransactions();
      onTransactionsChanged?.();
    } catch (error) {
      logger.error('Failed to update', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDelete = async (entryId: string) => {
    if (isSubmitting) return;
    const isTransfer = entryId.startsWith('x_');

    const confirmed = await confirm({
      title: isTransfer ? t('transactions.deleteTransferTitle') : t('transactions.deleteTransactionTitle'),
      message: isTransfer ? t('transactions.deleteTransferConfirm') : t('transactions.deleteTransactionConfirm'),
      confirmLabel: t('common.delete'),
      variant: 'danger',
    });
    if (!confirmed) return;

    setIsSubmitting(true);
    try {
      if (isTransfer) {
        await deleteTransfer(parseInt(entryId.substring(2), 10));
      } else {
        await deleteTransaction(parseInt(entryId.substring(2), 10));
      }
      await loadTransactions();
      onTransactionsChanged?.();
    } catch (error) {
      logger.error('Failed to delete', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Calculate totals (on filtered entries - only transactions affect budget)
  const filteredTx = filteredEntries.filter((e) => e.type === 'transaction').map((e) => e.transaction!);
  const totalIncome = filteredTx.filter((t) => t.groupType === 'income').reduce((sum, t) => sum + t.amount, 0);
  const totalExpenses = filteredTx.filter((t) => t.groupType === 'expense').reduce((sum, t) => sum + t.amount, 0);

  // Calculate total moved to savings accounts (transfers where destination is a savings account)
  const filteredTransfers = filteredEntries.filter((e) => e.type === 'transfer').map((e) => e.transfer!);
  const totalToSavings = filteredTransfers
    .filter((t) => t.destinationAccount.isSavingsAccount)
    .reduce((sum, t) => sum + t.amount, 0);
  const totalFromSavings = filteredTransfers
    .filter((t) => t.sourceAccount.isSavingsAccount)
    .reduce((sum, t) => sum + t.amount, 0);
  const netSavings = totalToSavings - totalFromSavings;

  // Check if all filtered entries are selected
  const allFilteredSelected = filteredEntries.length > 0 && filteredEntries.every((e) => selectedIds.has(e.id));
  const someFilteredSelected = filteredEntries.some((e) => selectedIds.has(e.id));

  if (loading) {
    return (
      <div className="transactions-container">
        <div className="content-loading">
          <div className="loading-spinner" />
          <p>{t('transactions.loading')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="transactions-container">
      <div className="transactions-header">
        <div className="transactions-title-row">
          <h2>{t('transactions.title')}</h2>
          <div className="transactions-actions">
            {selectedIds.size > 0 && (
              <button className="btn-danger" onClick={handleBulkDelete} disabled={isSubmitting}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="3 6 5 6 21 6" />
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                </svg>
                {t('transactions.deleteSelected', { count: selectedIds.size })}
              </button>
            )}
            {hasActiveFilters && (
              <button className="btn-clear-filters" onClick={clearFilters}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
                {t('transactions.clearFilters')}
              </button>
            )}
            <button className="btn-import" onClick={() => setShowImportModal(true)}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <polyline points="17 8 12 3 7 8" />
                <line x1="12" y1="3" x2="12" y2="15" />
              </svg>
              {t('transactions.bulkImport')}
            </button>
          </div>
        </div>

        <div className="transactions-summary">
          <div className="summary-item count">
            <span className="summary-label">{t('transactions.summaryShown')}</span>
            <span className="summary-value">
              {filteredEntries.length} / {unifiedEntries.length}
            </span>
          </div>
          <div className="summary-item income">
            <span className="summary-label">{t('budget.income')}</span>
            <span className="summary-value">{formatCurrency(totalIncome, true)}</span>
          </div>
          <div className="summary-item expense">
            <span className="summary-label">{t('budget.expenses')}</span>
            <span className="summary-value">{formatCurrency(totalExpenses, true)}</span>
          </div>
          {netSavings !== 0 && (
            <div className={`summary-item savings ${netSavings >= 0 ? 'positive' : 'negative'}`}>
              <span className="summary-label">{t('transactions.summarySavings')}</span>
              <span className="summary-value">{formatCurrency(netSavings, true)}</span>
            </div>
          )}
          <div className={`summary-item balance ${totalIncome - totalExpenses >= 0 ? 'positive' : 'negative'}`}>
            <span className="summary-label">{t('transactions.summaryBalance')}</span>
            <span className="summary-value">{formatCurrency(totalIncome - totalExpenses, true)}</span>
          </div>
        </div>
      </div>

      {/* Bulk Import Modal */}
      <BulkImportModal
        isOpen={showImportModal}
        onClose={() => setShowImportModal(false)}
        yearId={yearId}
        groups={groups}
        onImportComplete={() => {
          loadTransactions();
          onTransactionsChanged?.();
        }}
      />

      {/* Add Transaction/Transfer Form */}
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
                onChange={(e) => setNewPaymentMethodId(e.target.value ? Number(e.target.value) : null)}
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
                onChange={(e) => setNewItemId(e.target.value ? Number(e.target.value) : null)}
                className="form-select category-select"
                required
              >
                <option value="">{t('transactions.selectCategory')}</option>
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

      {/* Transactions List */}
      <div className="transactions-list">
        {transactions.length === 0 ? (
          <div className="empty-transactions">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <line x1="12" y1="1" x2="12" y2="23" />
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
            <p>{t('transactions.empty')}</p>
          </div>
        ) : filteredEntries.length === 0 ? (
          <div className="empty-transactions">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <p>{t('transactions.emptyFiltered')}</p>
            <button className="btn-link" onClick={clearFilters}>
              {t('transactions.clearFilters')}
            </button>
          </div>
        ) : (
          <table className="transactions-table">
            <thead>
              <tr className="header-row">
                <th className="col-select">
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = someFilteredSelected && !allFilteredSelected;
                    }}
                    onChange={toggleSelectAll}
                    title={t('transactions.selectAll')}
                  />
                </th>
                <th className="sortable" onClick={() => handleSort('date')}>
                  {t('transactions.date')} <SortIcon field="date" />
                </th>
                <th className="col-accounting" title={t('transactions.accountingMonth')}>
                  {t('transactions.accounting')}
                </th>
                <th className="sortable" onClick={() => handleSort('thirdParty')}>
                  {t('transactions.thirdParty')} <SortIcon field="thirdParty" />
                </th>
                <th className="sortable" onClick={() => handleSort('description')}>
                  {t('transactions.description')} <SortIcon field="description" />
                </th>
                <th>{t('transactions.comment')}</th>
                <th className="sortable" onClick={() => handleSort('paymentMethod')}>
                  {t('transactions.paymentMethod')} <SortIcon field="paymentMethod" />
                </th>
                <th className="sortable" onClick={() => handleSort('category')}>
                  {t('transactions.category')} <SortIcon field="category" />
                </th>
                <th className="sortable" onClick={() => handleSort('amount')}>
                  {t('transactions.amount')} <SortIcon field="amount" />
                </th>
                <th>{t('transactions.actions')}</th>
              </tr>
              <tr className="filter-row">
                <th></th>
                <th>
                  <div className="date-range-filter">
                    <DatePicker
                      selectsRange
                      startDate={filters.dateFrom}
                      endDate={filters.dateTo}
                      onChange={(dates) => {
                        const [start, end] = dates as [Date | null, Date | null];
                        setFilters((f) => ({ ...f, dateFrom: start, dateTo: end }));
                      }}
                      placeholderText={t('common.selectPlaceholder')}
                      className="column-filter date-range-input"
                      dateFormat="dd/MM/yyyy"
                      isClearable
                    />
                  </div>
                </th>
                <th></th>
                <th>
                  <input
                    type="text"
                    placeholder={t('transactions.filterPlaceholder')}
                    value={filters.thirdParty}
                    onChange={(e) => setFilters((f) => ({ ...f, thirdParty: e.target.value }))}
                    className="column-filter"
                  />
                </th>
                <th>
                  <input
                    type="text"
                    placeholder={t('transactions.filterPlaceholder')}
                    value={filters.description}
                    onChange={(e) => setFilters((f) => ({ ...f, description: e.target.value }))}
                    className="column-filter"
                  />
                </th>
                <th></th>
                <th className="multi-select-filter-cell">
                  <div className="multi-select-filter">
                    <button
                      className={`multi-select-trigger ${filters.paymentMethods.length > 0 ? 'has-selection' : ''}`}
                      onClick={(e) => {
                        const dropdown = e.currentTarget.nextElementSibling as HTMLElement;
                        dropdown.classList.toggle('open');
                      }}
                    >
                      {filters.paymentMethods.length === 0
                        ? t('transactions.all')
                        : filters.paymentMethods.length === 1
                          ? uniquePaymentMethods.find((m) => m.id === filters.paymentMethods[0])?.name || ''
                          : t('transactions.paymentMethodsSelected', { count: filters.paymentMethods.length })}
                    </button>
                    <div className="multi-select-dropdown">
                      <label className="multi-select-option select-all">
                        <input
                          type="checkbox"
                          checked={filters.paymentMethods.length === 0}
                          onChange={() => setFilters((f) => ({ ...f, paymentMethods: [] }))}
                        />
                        <span>{t('transactions.all')}</span>
                      </label>
                      {uniquePaymentMethods.map((m) => (
                        <label key={m.id} className="multi-select-option">
                          <input
                            type="checkbox"
                            checked={filters.paymentMethods.includes(m.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setFilters((f) => ({ ...f, paymentMethods: [...f.paymentMethods, m.id] }));
                              } else {
                                setFilters((f) => ({
                                  ...f,
                                  paymentMethods: f.paymentMethods.filter((pm) => pm !== m.id),
                                }));
                              }
                            }}
                          />
                          <span>{m.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </th>
                <th>
                  <select
                    value={filters.categoryFilter}
                    onChange={(e) => setFilters((f) => ({ ...f, categoryFilter: e.target.value }))}
                    className="column-filter category-filter-hierarchical"
                  >
                    <option value="">{t('transactions.all')}</option>
                    <option value="section:transfer">{t('transactions.transfersSection')}</option>
                    {groups.filter((g) => g.type === 'income').length > 0 && (
                      <>
                        <option value="section:income">{t('transactions.sectionIncome')}</option>
                        {groups
                          .filter((g) => g.type === 'income')
                          .map((group) => (
                            <React.Fragment key={group.id}>
                              <option value={`group:${group.name}`}>
                                {'\u00A0\u00A0'}▪ {group.name}
                              </option>
                              {group.items.map((item) => (
                                <option key={item.id} value={`item:${group.name} → ${item.name}`}>
                                  {'\u00A0\u00A0\u00A0\u00A0\u00A0'}
                                  {item.name}
                                </option>
                              ))}
                            </React.Fragment>
                          ))}
                      </>
                    )}
                    {groups.filter((g) => g.type === 'expense').length > 0 && (
                      <>
                        <option value="section:expense">{t('transactions.sectionExpenses')}</option>
                        {groups
                          .filter((g) => g.type === 'expense')
                          .map((group) => (
                            <React.Fragment key={group.id}>
                              <option value={`group:${group.name}`}>
                                {'\u00A0\u00A0'}▪ {group.name}
                              </option>
                              {group.items.map((item) => (
                                <option key={item.id} value={`item:${group.name} → ${item.name}`}>
                                  {'\u00A0\u00A0\u00A0\u00A0\u00A0'}
                                  {item.name}
                                </option>
                              ))}
                            </React.Fragment>
                          ))}
                      </>
                    )}
                  </select>
                </th>
                <th></th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {filteredEntries.map((entry) => {
                const isTransfer = entry.type === 'transfer';
                const transaction = entry.transaction;
                const transfer = entry.transfer;

                return (
                  <tr
                    key={entry.id}
                    className={`${isTransfer ? 'transfer' : transaction?.groupType} ${selectedIds.has(entry.id) ? 'selected' : ''}`}
                  >
                    {editingId === entry.id ? (
                      isTransfer ? (
                        // Edit mode for transfers
                        <>
                          <td>
                            <input type="checkbox" checked={selectedIds.has(entry.id)} disabled />
                          </td>
                          <td>
                            <div className="date-input-wrapper edit-date-wrapper">
                              <input
                                type="text"
                                value={editDate}
                                onChange={(e) => setEditDate(e.target.value)}
                                placeholder={t('transactions.datePlaceholder')}
                                className={`edit-input ${!isValidDateFormat(editDate) && editDate ? 'invalid' : ''}`}
                                // biome-ignore lint/a11y/noAutofocus: intentional UX - focus on edit
                                autoFocus
                              />
                              <input
                                type="date"
                                className="date-picker-hidden"
                                value={isValidDateFormat(editDate) ? parseDateInput(editDate) : ''}
                                onChange={(e) => {
                                  if (e.target.value) {
                                    const [y, m, d] = e.target.value.split('-');
                                    setEditDate(`${d}/${m}/${y}`);
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
                                <svg
                                  width="14"
                                  height="14"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                >
                                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                                  <line x1="16" y1="2" x2="16" y2="6" />
                                  <line x1="8" y1="2" x2="8" y2="6" />
                                  <line x1="3" y1="10" x2="21" y2="10" />
                                </svg>
                              </button>
                            </div>
                          </td>
                          <td className="accounting-edit-cell">
                            <select
                              value={editAccountingMonth}
                              onChange={(e) => setEditAccountingMonth(Number(e.target.value))}
                              className="edit-select accounting-month-select"
                            >
                              {monthNames.map((name, i) => (
                                <option key={i + 1} value={i + 1}>
                                  {name}
                                </option>
                              ))}
                            </select>
                            <input
                              type="number"
                              value={editAccountingYear}
                              onChange={(e) => setEditAccountingYear(Number(e.target.value))}
                              className="edit-input accounting-year-input"
                              min="2000"
                              max="2100"
                            />
                          </td>
                          <td>
                            <div className="transfer-edit-accounts">
                              <select
                                value={editSourceAccount}
                                onChange={(e) => setEditSourceAccount(e.target.value)}
                                className="edit-select"
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
                              <span className="transfer-arrow-small">→</span>
                              <select
                                value={editDestAccount}
                                onChange={(e) => setEditDestAccount(e.target.value)}
                                className="edit-select"
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
                            </div>
                          </td>
                          <td>
                              <input
                                type="text"
                                value={editDescription}
                                onChange={(e) => setEditDescription(e.target.value)}
                                className="edit-input"
                                placeholder={t('transactions.description')}
                              />
                          </td>
                          <td>-</td>
                          <td>-</td>
                          <td>
                            <span className="transfer-badge">{t('transactions.typeTransfer')}</span>
                          </td>
                          <td>
                            <input
                              type="number"
                              value={editAmount}
                              onChange={(e) => setEditAmount(e.target.value)}
                              step="0.01"
                              className="edit-input amount"
                            />
                          </td>
                          <td className="actions-cell">
                            <button className="btn-icon save" onClick={handleUpdate} title={t('common.save')}>
                              <svg
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                              >
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            </button>
                            <button className="btn-icon cancel" onClick={cancelEdit} title={t('common.cancel')}>
                              <svg
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                              >
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                            </button>
                          </td>
                        </>
                      ) : (
                        // Edit mode for transactions
                        <>
                          <td>
                            <input
                              type="checkbox"
                              checked={selectedIds.has(entry.id)}
                              onChange={() => toggleSelect(entry.id)}
                              disabled
                            />
                          </td>
                          <td>
                            <div className="date-input-wrapper edit-date-wrapper">
                              <input
                                type="text"
                                value={editDate}
                                onChange={(e) => setEditDate(e.target.value)}
                                placeholder={t('transactions.datePlaceholder')}
                                pattern="\d{2}/\d{2}/\d{4}"
                                className={`edit-input ${!isValidDateFormat(editDate) && editDate ? 'invalid' : ''}`}
                                // biome-ignore lint/a11y/noAutofocus: intentional UX - focus on edit
                                autoFocus
                              />
                              <input
                                type="date"
                                className="date-picker-hidden"
                                value={isValidDateFormat(editDate) ? parseDateInput(editDate) : ''}
                                onChange={(e) => {
                                  if (e.target.value) {
                                    const [y, m, d] = e.target.value.split('-');
                                    setEditDate(`${d}/${m}/${y}`);
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
                                <svg
                                  width="14"
                                  height="14"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2"
                                >
                                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                                  <line x1="16" y1="2" x2="16" y2="6" />
                                  <line x1="8" y1="2" x2="8" y2="6" />
                                  <line x1="3" y1="10" x2="21" y2="10" />
                                </svg>
                              </button>
                            </div>
                          </td>
                          <td className="accounting-edit-cell">
                            <select
                              value={editAccountingMonth}
                              onChange={(e) => setEditAccountingMonth(Number(e.target.value))}
                              className="edit-select accounting-month-select"
                            >
                              {monthNames.map((name, i) => (
                                <option key={i + 1} value={i + 1}>
                                  {name}
                                </option>
                              ))}
                            </select>
                            <input
                              type="number"
                              value={editAccountingYear}
                              onChange={(e) => setEditAccountingYear(Number(e.target.value))}
                              className="edit-input accounting-year-input"
                              min="2000"
                              max="2100"
                            />
                          </td>
                          <td>
                            <ThirdPartyAutocomplete
                              value={editThirdParty}
                              onChange={setEditThirdParty}
                              placeholder={t('transactions.thirdParty')}
                              className="edit-input"
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              value={editDescription}
                              onChange={(e) => setEditDescription(e.target.value)}
                              className="edit-input"
                              placeholder={t('transactions.description')}
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              value={editComment}
                              onChange={(e) => setEditComment(e.target.value)}
                              className="edit-input"
                              placeholder={t('transactions.comment')}
                            />
                          </td>
                          <td>
                            <select
                              value={editPaymentMethodId ?? ''}
                              onChange={(e) => setEditPaymentMethodId(e.target.value ? Number(e.target.value) : null)}
                              className="edit-select"
                            >
                              <option value="">{t('common.none')}</option>
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
                          </td>
                          <td>
                            <select
                              value={editItemId || ''}
                              onChange={(e) => setEditItemId(e.target.value ? Number(e.target.value) : null)}
                              className="edit-select"
                            >
                              <option value="">{t('transactions.uncategorized')}</option>
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
                          </td>
                          <td>
                            <input
                              type="number"
                              value={editAmount}
                              onChange={(e) => setEditAmount(e.target.value)}
                              step="0.01"
                              className="edit-input amount"
                            />
                          </td>
                          <td className="actions-cell">
                            <button className="btn-icon save" onClick={handleUpdate} title={t('common.save')}>
                              <svg
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                              >
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            </button>
                            <button className="btn-icon cancel" onClick={cancelEdit} title={t('common.cancel')}>
                              <svg
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                              >
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                            </button>
                          </td>
                        </>
                      )
                    ) : (
                      <>
                        <td>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(entry.id)}
                            onChange={() => toggleSelect(entry.id)}
                          />
                        </td>
                        <td className="date-cell">{formatDateDisplay(entry.date)}</td>
                        <td className="accounting-cell">
                          {formatAccountingPeriod(entry.accountingMonth, entry.accountingYear, monthNames)}
                        </td>
                        <td className="third-party-cell">
                          {isTransfer ? (
                            <span className="transfer-accounts">
                              <span className="transfer-source">{transfer?.sourceAccount.name}</span>
                              <span className="transfer-arrow-small">→</span>
                              <span className="transfer-dest">{transfer?.destinationAccount.name}</span>
                            </span>
                          ) : (
                            transaction?.thirdParty || <span className="empty-field">-</span>
                          )}
                        </td>
                        <td className="description-cell">
                          {entry.description || <span className="empty-field">-</span>}
                        </td>
                        <td className="comment-cell">
                          {!isTransfer && transaction?.comment ? (
                            transaction.comment
                          ) : (
                            <span className="empty-field">-</span>
                          )}
                        </td>
                        <td className="payment-cell">
                          {isTransfer ? (
                            <span className="empty-field">-</span>
                          ) : (
                            transaction?.paymentMethod || <span className="empty-field">-</span>
                          )}
                        </td>
                        <td className="category-cell">
                          {isTransfer ? (
                            <span className="transfer-badge">
                              <svg
                                width="12"
                                height="12"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                              >
                                <polyline points="17 1 21 5 17 9" />
                                <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                                <polyline points="7 23 3 19 7 15" />
                                <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                              </svg>
                              {t('transactions.typeTransfer')}
                            </span>
                          ) : transaction?.groupName && transaction?.itemName ? (
                            `${transaction.groupName} → ${transaction.itemName}`
                          ) : (
                            <span className="uncategorized">{t('transactions.uncategorized')}</span>
                          )}
                        </td>
                        <td
                          className={`amount-cell ${isTransfer ? (transfer?.sourceAccount.isSavingsAccount || transfer?.destinationAccount.isSavingsAccount ? 'savings-transfer' : 'transfer') : transaction?.groupType} ${entry.amount < 0 ? 'negative' : ''}`}
                        >
                          {formatCurrency(entry.amount, true)}
                        </td>
                        <td className="actions-cell">
                          <button
                            className="btn-icon edit"
                            onClick={() =>
                              isTransfer ? startEditTransfer(transfer!) : startEditTransaction(transaction!)
                            }
                            title={t('common.edit')}
                          >
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                            >
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                          </button>
                          <button className="btn-icon delete" onClick={() => handleDelete(entry.id)} title={t('common.delete')}>
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                            >
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                          </button>
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <ConfirmDialog {...dialogProps} />
    </div>
  );
}
