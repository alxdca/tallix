import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';
import {
  bulkDeleteTransactions,
  deleteTransaction,
  dismissTransactionWarning,
  fetchPaymentMethods,
  fetchTransactions,
  type PaymentMethod,
  reorderTransactionEntries,
  type Transaction,
  updateTransaction,
} from '../api';
import { useI18n } from '../contexts/I18nContext';
import { useConfirmDialog } from '../hooks/useConfirmDialog';
import { useFormatCurrency } from '../hooks/useFormatCurrency';
import type { BudgetGroup } from '../types';
import { formatDateDisplay, isValidDateFormat, parseDateInput } from '../utils';
import { logger } from '../utils/logger';
import BulkImportModal from './BulkImportModal';
import ConfirmDialog from './ConfirmDialog';
import NewTransactionForm from './NewTransactionForm';
import ThirdPartyAutocomplete from './ThirdPartyAutocomplete';
import { formatWithInstitution, normalizeThirdParty } from './transactionFormUtils';
import {
  buildSelectionReorderUpdates,
  buildSingleReorderUpdates,
  canReorderSelectedEntries,
  getSelectedReorderEntries,
  type ReorderPriorityUpdate,
} from './transactionsReorder';

const TRANSACTION_PRIORITY_STORAGE_PREFIX = 'tallix_transaction_sort_priorities';

// The existing reorder helpers use typed, prefixed IDs.
interface TransactionEntry extends Omit<Transaction, 'id'> {
  id: string;
  type: 'transaction';
  transaction: Transaction;
  naturalDateIndex: number;
}

function formatAccountingPeriod(month: number, year: number, monthNames: string[]): string {
  return `${monthNames[month - 1]} ${year}`;
}

function accountingPeriodKey(month: number, year: number): string {
  return `${year}-${month}`;
}

interface TransactionsProps {
  year: number;
  yearId: number;
  groups: BudgetGroup[];
  onTransactionsChanged?: () => void;
  initialFilters?: Partial<TransactionsFilters>;
  readOnly?: boolean;
}

type SortField = 'manual' | 'date' | 'thirdParty' | 'description' | 'paymentMethod' | 'category' | 'amount';
type SortDirection = 'asc' | 'desc';

function getTransactionPriorityStorageKey(yearId: number): string {
  return `${TRANSACTION_PRIORITY_STORAGE_PREFIX}:${yearId}`;
}

function readStoredTransactionPriorities(yearId: number): Map<number, number> {
  try {
    const raw = localStorage.getItem(getTransactionPriorityStorageKey(yearId));
    if (!raw) {
      return new Map();
    }

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return new Map(
      Object.entries(parsed)
        .map(([id, value]) => {
          const numericId = parseInt(id, 10);
          if (Number.isNaN(numericId) || typeof value !== 'number' || !Number.isFinite(value)) {
            return null;
          }
          return [numericId, Math.trunc(value)] as const;
        })
        .filter((entry): entry is readonly [number, number] => entry !== null)
    );
  } catch (error) {
    logger.warn('Failed to read stored transaction priorities', { yearId, error: String(error) });
    return new Map();
  }
}

function writeStoredTransactionPriorities(
  yearId: number,
  updates: Array<{ id: number; sortPriority: number | null }>
): void {
  try {
    const current = Object.fromEntries(readStoredTransactionPriorities(yearId));

    for (const update of updates) {
      if (update.sortPriority === null || update.sortPriority === 0) {
        delete current[String(update.id)];
      } else {
        current[String(update.id)] = Math.trunc(update.sortPriority);
      }
    }

    if (Object.keys(current).length === 0) {
      localStorage.removeItem(getTransactionPriorityStorageKey(yearId));
      return;
    }

    localStorage.setItem(getTransactionPriorityStorageKey(yearId), JSON.stringify(current));
  } catch (error) {
    logger.warn('Failed to write stored transaction priorities', { yearId, error: String(error) });
  }
}

function mergeStoredTransactionPriorities(yearId: number, entries: Transaction[]): Transaction[] {
  const storedPriorities = readStoredTransactionPriorities(yearId);
  if (storedPriorities.size === 0) {
    return entries;
  }

  return entries.map((entry) => ({
    ...entry,
    sortPriority: entry.sortPriority ?? storedPriorities.get(entry.id) ?? null,
  }));
}

export interface TransactionsFilters {
  dateFrom: Date | null;
  dateTo: Date | null;
  accountingPeriod: string;
  thirdParty: string;
  description: string;
  comment: string;
  paymentMethods: number[]; // Multiple payment method IDs can be selected
  categoryFilter: string; // Combined: "section:income", "group:Salaires"
}

type Filters = TransactionsFilters;

export default function Transactions({
  year,
  yearId,
  groups,
  onTransactionsChanged,
  initialFilters,
  readOnly = false,
}: TransactionsProps) {
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;
  const formatCurrency = useFormatCurrency();
  const { dialogProps, confirm } = useConfirmDialog();
  const { t, monthNames } = useI18n();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [loading, setLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null); // Reorder-compatible transaction ID
  const [showImportModal, setShowImportModal] = useState(false);

  // Selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set()); // Reorder-compatible transaction ID

  useEffect(() => {
    if (!readOnly) return;
    setEditingId(null);
    setSelectedIds(new Set());
    setShowImportModal(false);
  }, [readOnly]);

  // Filters state
  const [filters, setFilters] = useState<Filters>({
    dateFrom: null,
    dateTo: null,
    accountingPeriod: '',
    thirdParty: '',
    description: '',
    comment: '',
    paymentMethods: [],
    categoryFilter: '',
  });

  useEffect(() => {
    if (!initialFilters) return;
    setFilters((prev) => ({ ...prev, ...initialFilters }));
  }, [initialFilters]);

  // Sort state
  const [sortField, setSortField] = useState<SortField>('manual');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

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
  // Get all items from all groups (savings accounts are now real budget items in "Épargne" group)
  const allItems = useMemo(
    () =>
      groups.flatMap((g) =>
        g.items.map((item) => ({
          ...item,
          groupName: g.name,
          groupType: g.type,
        }))
      ),
    [groups]
  );

  const incomeItems = allItems.filter((i) => i.groupType === 'income');
  const expenseItems = allItems.filter((i) => i.groupType === 'expense');
  const savingsCategoryItems = allItems.filter((i) => i.groupType === 'savings');
  // Get used payment methods for the filter dropdown.
  const uniquePaymentMethods = useMemo(() => {
    const methodIds = new Set<number>();
    // Add transaction payment method IDs
    transactions.forEach((t) => {
      if (t.paymentMethodId) methodIds.add(t.paymentMethodId);
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
  }, [transactions, paymentMethods]);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [transactionsData, methodsData] = await Promise.all([fetchTransactions(year), fetchPaymentMethods()]);
      setTransactions(mergeStoredTransactionPriorities(yearId, transactionsData));
      setPaymentMethods(methodsData);
    } catch (error) {
      logger.error('Failed to load data', error);
    } finally {
      setLoading(false);
    }
  }, [year, yearId]);

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
      const transactionsData = await fetchTransactions(year);
      setTransactions(mergeStoredTransactionPriorities(yearId, transactionsData));
      // Clear selections that no longer exist
      setSelectedIds((prev) => {
        const newSet = new Set<string>();
        const existingTxIds = new Set(transactionsData.map((t) => `t_${t.id}`));
        prev.forEach((id) => {
          if (existingTxIds.has(id)) newSet.add(id);
        });
        return newSet;
      });
    } catch (error) {
      logger.error('Failed to load transactions', error);
    }
  };

  const applyEditThirdPartySuggestion = useCallback(
    (value: string, source: 'blur' | 'select' = 'blur') => {
      if (source !== 'select') return;

      const normalized = normalizeThirdParty(value);
      if (!normalized) return;

      const lastMatch = transactions.find(
        (transaction) =>
          normalizeThirdParty(transaction.thirdParty) === normalized &&
          (!editingId?.startsWith('t_') || transaction.id !== parseInt(editingId.substring(2), 10))
      );

      if (lastMatch?.paymentMethodId) {
        setEditPaymentMethodId(lastMatch.paymentMethodId);
      }
    },
    [transactions, editingId]
  );

  const transactionEntries = useMemo((): TransactionEntry[] => {
    const naturalDateCounts = new Map<string, number>();
    return [...transactions]
      .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id)
      .map((transaction) => {
        const naturalDateIndex = naturalDateCounts.get(transaction.date) ?? 0;
        naturalDateCounts.set(transaction.date, naturalDateIndex + 1);
        return { ...transaction, id: `t_${transaction.id}`, type: 'transaction', transaction, naturalDateIndex };
      });
  }, [transactions]);

  const accountingPeriods = Array.from(
    new Map(
      transactions.map((entry) => [
        accountingPeriodKey(entry.accountingMonth, entry.accountingYear),
        { month: entry.accountingMonth, year: entry.accountingYear },
      ])
    ).values()
  ).sort((a, b) => a.year - b.year || a.month - b.month);

  const hasActiveFilters =
    filters.dateFrom ||
    filters.dateTo ||
    filters.accountingPeriod ||
    filters.thirdParty ||
    filters.description ||
    filters.comment ||
    filters.paymentMethods.length > 0 ||
    filters.categoryFilter;

  // Filtered and sorted entries
  const filteredEntries = useMemo(() => {
    let result = [...transactionEntries];

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
    if (filters.accountingPeriod) {
      result = result.filter(
        (entry) => accountingPeriodKey(entry.accountingMonth, entry.accountingYear) === filters.accountingPeriod
      );
    }
    if (filters.thirdParty) {
      const search = filters.thirdParty.toLowerCase();
      result = result.filter((entry) => entry.thirdParty?.toLowerCase().includes(search));
    }
    if (filters.description) {
      const search = filters.description.toLowerCase();
      result = result.filter((e) => e.description?.toLowerCase().includes(search));
    }
    if (filters.comment) {
      const search = filters.comment.toLowerCase();
      result = result.filter((e) => e.comment?.toLowerCase().includes(search));
    }
    if (filters.paymentMethods.length > 0) {
      result = result.filter(
        (entry) => entry.paymentMethodId && filters.paymentMethods.includes(entry.paymentMethodId)
      );
    }
    if (filters.categoryFilter) {
      const [filterType, filterValue] = filters.categoryFilter.split(':');
      if (filterType === 'section') result = result.filter((entry) => entry.groupType === filterValue);
      else if (filterType === 'group') result = result.filter((entry) => entry.groupName === filterValue);
      else if (filterType === 'item')
        result = result.filter((entry) => `${entry.groupName} → ${entry.itemName}` === filterValue);
    }

    // Apply sorting
    result.sort((a, b) => {
      let comparison = 0;

      switch (sortField) {
        case 'manual':
          comparison = b.date.localeCompare(a.date);
          if (comparison === 0) {
            comparison = (b.sortPriority ?? 0) - (a.sortPriority ?? 0);
          }
          if (comparison === 0) {
            comparison = a.naturalDateIndex - b.naturalDateIndex;
          }
          break;
        case 'date':
          comparison = a.date.localeCompare(b.date);
          break;
        case 'thirdParty':
          comparison = (a.thirdParty || '').localeCompare(b.thirdParty || '');
          break;
        case 'description':
          comparison = (a.description || '').localeCompare(b.description || '');
          break;
        case 'paymentMethod':
          comparison = (a.paymentMethod || '').localeCompare(b.paymentMethod || '');
          break;
        case 'category':
          comparison = `${a.groupName || ''} → ${a.itemName || ''}`.localeCompare(
            `${b.groupName || ''} → ${b.itemName || ''}`
          );
          break;
        case 'amount':
          comparison = a.amount - b.amount;
          break;
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });

    return result;
  }, [transactionEntries, filters, sortField, sortDirection]);

  const manualEntries = useMemo(
    () =>
      [...transactionEntries].sort((a, b) => {
        const dateComparison = b.date.localeCompare(a.date);
        if (dateComparison !== 0) {
          return dateComparison;
        }

        const priorityComparison = (b.sortPriority ?? 0) - (a.sortPriority ?? 0);
        if (priorityComparison !== 0) {
          return priorityComparison;
        }
        return a.naturalDateIndex - b.naturalDateIndex;
      }),
    [transactionEntries]
  );

  const canReorderRows = !readOnly && !editingId;

  const selectedReorderEntries = useMemo(
    () => getSelectedReorderEntries(manualEntries, selectedIds),
    [manualEntries, selectedIds]
  );

  const canReorderSelection = useMemo(
    () => canReorderSelectedEntries(manualEntries, selectedIds, canReorderRows),
    [manualEntries, selectedIds, canReorderRows]
  );

  const applyPriorityUpdatesLocally = useCallback(
    (entries: ReorderPriorityUpdate[]) => {
      const transactionPriorityMap = new Map(
        entries
          .filter((entry) => entry.type === 'transaction')
          .map((entry) => [
            entry.id,
            entry.sortPriority === null || entry.sortPriority === 0 ? null : Math.trunc(entry.sortPriority),
          ])
      );
      if (transactionPriorityMap.size > 0) {
        writeStoredTransactionPriorities(
          yearId,
          [...transactionPriorityMap.entries()].map(([id, sortPriority]) => ({
            id,
            sortPriority,
          }))
        );
        setTransactions((current) =>
          current.map((transaction) =>
            transactionPriorityMap.has(transaction.id)
              ? { ...transaction, sortPriority: transactionPriorityMap.get(transaction.id) ?? null }
              : transaction
          )
        );
      }
    },
    [yearId]
  );

  const persistEntryOrder = useCallback(
    async (entries: ReorderPriorityUpdate[]) => {
      await reorderTransactionEntries(entries);
      onTransactionsChanged?.();
    },
    [onTransactionsChanged]
  );

  const handleReorderSelection = useCallback(
    async (direction: 'up' | 'down' | 'top' | 'bottom') => {
      if (readOnlyRef.current || !canReorderSelection || isSubmitting) return;

      const selectedEntries = selectedReorderEntries;
      if (selectedEntries.length === 0) return;

      const priorityUpdates = buildSelectionReorderUpdates(manualEntries, selectedIds, direction);
      if (priorityUpdates.length === 0) return;

      setSortField('manual');
      setSortDirection('asc');
      applyPriorityUpdatesLocally(priorityUpdates);
      setIsSubmitting(true);
      try {
        await persistEntryOrder(priorityUpdates);
      } catch (error) {
        logger.error('Failed to reorder transactions', error);
      } finally {
        setIsSubmitting(false);
      }
    },
    [
      applyPriorityUpdatesLocally,
      canReorderSelection,
      isSubmitting,
      manualEntries,
      persistEntryOrder,
      selectedIds,
      selectedReorderEntries,
    ]
  );

  const handleReorderSingle = useCallback(
    async (entryId: string, direction: 'up' | 'down') => {
      if (readOnlyRef.current || !canReorderRows || isSubmitting) return;

      const entry = manualEntries.find((candidate) => candidate.id === entryId);
      if (!entry) return;

      setSortField('manual');
      setSortDirection('asc');
      const priorityUpdates = buildSingleReorderUpdates(manualEntries, entry, direction);
      if (priorityUpdates.length === 0) return;

      applyPriorityUpdatesLocally(priorityUpdates);
      setIsSubmitting(true);
      try {
        await persistEntryOrder(priorityUpdates);
      } catch (error) {
        logger.error('Failed to reorder transaction', error);
      } finally {
        setIsSubmitting(false);
      }
    },
    [applyPriorityUpdatesLocally, canReorderRows, isSubmitting, manualEntries, persistEntryOrder]
  );

  // Selection handlers
  const toggleSelect = useCallback((id: string) => {
    if (readOnlyRef.current) return;
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
    if (readOnlyRef.current) return;
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
    if (readOnlyRef.current || isSubmitting || selectedIds.size === 0) return;

    const count = selectedIds.size;
    const confirmed = await confirm({
      title: t('transactions.deleteSelectionTitle'),
      message: t('transactions.deleteSelectionMessage', { count, suffix: count > 1 ? 's' : '' }),
      confirmLabel: t('common.delete'),
      variant: 'danger',
    });
    if (!confirmed || readOnlyRef.current) return;

    setIsSubmitting(true);
    try {
      await bulkDeleteTransactions([...selectedIds].map((id) => parseInt(id.substring(2), 10)));

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
    if (field === 'manual') {
      setSortField('manual');
      setSortDirection('asc');
      return;
    }

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
      accountingPeriod: '',
      thirdParty: '',
      description: '',
      comment: '',
      paymentMethods: [],
      categoryFilter: '',
    });
  };

  const startEditTransaction = (transaction: Transaction) => {
    if (readOnlyRef.current || isSubmitting) return;
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
    // Reset original values
    setOriginalDate('');
    setOriginalPaymentMethodId(null);
    setOriginalAccountingMonth(1);
    setOriginalAccountingYear(new Date().getFullYear());
  };

  const handleUpdate = async () => {
    if (readOnlyRef.current || !editAmount || !editingId || isSubmitting || !isValidDateFormat(editDate)) return;

    const numericId = parseInt(editingId.substring(2), 10);

    // Check if user explicitly changed accounting fields
    const accountingExplicitlyChanged =
      editAccountingMonth !== originalAccountingMonth || editAccountingYear !== originalAccountingYear;
    // Check if date or payment method changed (which would affect accounting calculation)
    const dateChanged = editDate !== originalDate;
    const paymentMethodChanged = editPaymentMethodId !== originalPaymentMethodId;

    setIsSubmitting(true);
    try {
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
    if (readOnlyRef.current || isSubmitting) return;

    const confirmed = await confirm({
      title: t('transactions.deleteTransactionTitle'),
      message: t('transactions.deleteTransactionConfirm'),
      confirmLabel: t('common.delete'),
      variant: 'danger',
    });
    if (!confirmed || readOnlyRef.current) return;

    setIsSubmitting(true);
    try {
      await deleteTransaction(parseInt(entryId.substring(2), 10));
      await loadTransactions();
      onTransactionsChanged?.();
    } catch (error) {
      logger.error('Failed to delete', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDismissWarning = async (transactionId: number) => {
    if (readOnlyRef.current || isSubmitting) return;
    setIsSubmitting(true);
    try {
      await dismissTransactionWarning(transactionId);
      await loadTransactions();
    } catch (error) {
      logger.error('Failed to dismiss warning', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  // Calculate totals (on filtered entries - only transactions affect budget)
  const filteredTx = filteredEntries;
  const totalIncome = filteredTx.filter((t) => t.groupType === 'income').reduce((sum, t) => sum + t.amount, 0);
  const totalExpenses = filteredTx.filter((t) => t.groupType === 'expense').reduce((sum, t) => sum + t.amount, 0);

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
          <h2>{t('transactions.title', { year })}</h2>
          <div className="transactions-actions">
            {!readOnly && canReorderSelection && (
              <div className="bulk-order-actions">
                <button
                  type="button"
                  className="btn-order"
                  onClick={() => handleReorderSelection('top')}
                  disabled={isSubmitting}
                  title={t('transactions.moveSelectionToTop')}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="18 11 12 5 6 11" />
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="3" x2="19" y2="3" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="btn-order"
                  onClick={() => handleReorderSelection('up')}
                  disabled={isSubmitting}
                  title={t('transactions.moveSelectionUp')}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="18 15 12 9 6 15" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="btn-order"
                  onClick={() => handleReorderSelection('down')}
                  disabled={isSubmitting}
                  title={t('transactions.moveSelectionDown')}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="btn-order"
                  onClick={() => handleReorderSelection('bottom')}
                  disabled={isSubmitting}
                  title={t('transactions.moveSelectionToBottom')}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <polyline points="6 13 12 19 18 13" />
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="21" x2="19" y2="21" />
                  </svg>
                </button>
              </div>
            )}
            {!readOnly && selectedIds.size > 0 && (
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
            {!readOnly && (
              <button
                className="btn-import"
                onClick={() => {
                  if (!readOnlyRef.current) setShowImportModal(true);
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="17 8 12 3 7 8" />
                  <line x1="12" y1="3" x2="12" y2="15" />
                </svg>
                {t('transactions.bulkImport')}
              </button>
            )}
          </div>
        </div>

        <div className="transactions-summary">
          <div className="summary-item count">
            <span className="summary-label">{t('transactions.summaryShown')}</span>
            <span className="summary-value">
              {filteredEntries.length} / {transactionEntries.length}
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
          <div className={`summary-item balance ${totalIncome - totalExpenses >= 0 ? 'positive' : 'negative'}`}>
            <span className="summary-label">{t('transactions.summaryBalance')}</span>
            <span className="summary-value">{formatCurrency(totalIncome - totalExpenses, true)}</span>
          </div>
        </div>
      </div>

      {/* Bulk Import Modal */}
      {!readOnly && (
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
      )}

      {/* Add Transaction Form */}
      <NewTransactionForm
        yearId={yearId}
        readOnly={readOnly}
        categories={allItems}
        transactions={transactions}
        paymentMethods={paymentMethods}
        isSubmitting={isSubmitting}
        onSubmittingChange={setIsSubmitting}
        onCreated={async () => {
          await loadTransactions();
          onTransactionsChanged?.();
        }}
      />

      {/* Transactions List */}
      <div className="transactions-list">
        <div className="transactions-table-scroll">
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
                    disabled={readOnly}
                  />
                </th>
                <th
                  className="col-order sortable"
                  onClick={() => handleSort('manual')}
                  aria-label={t('transactions.order')}
                  title={t('transactions.order')}
                >
                  <SortIcon field="manual" />
                </th>
                <th className="col-date sortable" onClick={() => handleSort('date')}>
                  {t('transactions.date')} <SortIcon field="date" />
                </th>
                <th className="col-accounting" title={t('transactions.accountingMonth')}>
                  {t('transactions.accounting')}
                </th>
                <th className="col-third-party sortable" onClick={() => handleSort('thirdParty')}>
                  {t('transactions.thirdParty')} <SortIcon field="thirdParty" />
                </th>
                <th className="col-description sortable" onClick={() => handleSort('description')}>
                  {t('transactions.description')} <SortIcon field="description" />
                </th>
                <th className="col-comment">{t('transactions.comment')}</th>
                <th className="col-payment sortable" onClick={() => handleSort('paymentMethod')}>
                  {t('transactions.paymentMethod')} <SortIcon field="paymentMethod" />
                </th>
                <th className="col-category sortable" onClick={() => handleSort('category')}>
                  {t('transactions.category')} <SortIcon field="category" />
                </th>
                <th className="col-amount sortable" onClick={() => handleSort('amount')}>
                  {t('transactions.amount')} <SortIcon field="amount" />
                </th>
                <th>{t('transactions.actions')}</th>
              </tr>
              <tr className="filter-row">
                <th></th>
                <th></th>
                <th className="col-date">
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
                <th>
                  <select
                    aria-label={t('transactions.accountingMonth')}
                    value={filters.accountingPeriod}
                    onChange={(e) => setFilters((f) => ({ ...f, accountingPeriod: e.target.value }))}
                    className="column-filter accounting-period-filter"
                  >
                    <option value="">{t('transactions.all')}</option>
                    {accountingPeriods.map(({ month, year }) => (
                      <option key={`${year}-${month}`} value={`${year}-${month}`}>
                        {formatAccountingPeriod(month, year, monthNames)}
                      </option>
                    ))}
                  </select>
                </th>
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
                <th>
                  <input
                    type="text"
                    aria-label={t('transactions.comment')}
                    placeholder={t('transactions.filterPlaceholder')}
                    value={filters.comment}
                    onChange={(e) => setFilters((f) => ({ ...f, comment: e.target.value }))}
                    className="column-filter comment-filter"
                  />
                </th>
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
                const transaction = entry.transaction;
                const isPotentialDuplicate = transaction.warning === 'potential_duplicate';

                return (
                  <tr
                    key={entry.id}
                    className={`${transaction.groupType} ${selectedIds.has(entry.id) ? 'selected' : ''} ${isPotentialDuplicate ? 'warning-row' : ''} ${editingId === entry.id ? 'editing-row' : ''}`}
                    title={isPotentialDuplicate ? t('transactions.potentialDuplicate') : undefined}
                  >
                    {editingId === entry.id ? (
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
                        <td className="order-cell">
                          <span className="order-placeholder" />
                        </td>
                        <td className="date-cell">
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
                            aria-label={t('transactions.accountingMonth')}
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
                            aria-label={t('transactions.accountingYear')}
                            className="edit-input accounting-year-input"
                            min="2000"
                            max="2100"
                          />
                        </td>
                        <td>
                          <ThirdPartyAutocomplete
                            value={editThirdParty}
                            onChange={setEditThirdParty}
                            onCommit={applyEditThirdPartySuggestion}
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
                          <button
                            className="btn-icon save"
                            disabled={readOnly || isSubmitting}
                            onClick={handleUpdate}
                            title={t('common.save')}
                          >
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
                      <>
                        <td>
                          <input
                            type="checkbox"
                            checked={selectedIds.has(entry.id)}
                            onChange={() => toggleSelect(entry.id)}
                            disabled={readOnly}
                          />
                        </td>
                        <td className="order-cell">
                          <div className="order-controls">
                            <button
                              type="button"
                              className="btn-icon reorder"
                              onClick={() => handleReorderSingle(entry.id, 'up')}
                              title={t('common.moveUp')}
                              disabled={readOnly || !canReorderRows || isSubmitting}
                            >
                              <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                              >
                                <polyline points="18 15 12 9 6 15" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              className="btn-icon reorder"
                              onClick={() => handleReorderSingle(entry.id, 'down')}
                              title={t('common.moveDown')}
                              disabled={readOnly || !canReorderRows || isSubmitting}
                            >
                              <svg
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                              >
                                <polyline points="6 9 12 15 18 9" />
                              </svg>
                            </button>
                          </div>
                        </td>
                        <td className="date-cell">{formatDateDisplay(entry.date)}</td>
                        <td className="accounting-cell">
                          {formatAccountingPeriod(entry.accountingMonth, entry.accountingYear, monthNames)}
                        </td>
                        <td className="third-party-cell">
                          {transaction.thirdParty || <span className="empty-field">-</span>}
                        </td>
                        <td className="description-cell">
                          {entry.description || <span className="empty-field">-</span>}
                          {transaction.createdBy && (
                            <span className="transaction-creator" title={transaction.createdBy.email}>
                              {t('transactions.createdBy', {
                                name: transaction.createdBy.name || transaction.createdBy.email,
                              })}
                            </span>
                          )}
                        </td>
                        <td className="comment-cell">
                          {transaction.comment ? transaction.comment : <span className="empty-field">-</span>}
                        </td>
                        <td className="payment-cell">
                          {transaction.paymentMethod || <span className="empty-field">-</span>}
                        </td>
                        <td className="category-cell">
                          {transaction.groupName && transaction.itemName ? (
                            `${transaction.groupName} → ${transaction.itemName}`
                          ) : (
                            <span className="uncategorized">{t('transactions.uncategorized')}</span>
                          )}
                        </td>
                        <td className={`amount-cell ${transaction.groupType} ${entry.amount < 0 ? 'negative' : ''}`}>
                          {formatCurrency(entry.amount, true)}
                        </td>
                        <td className="actions-cell">
                          {!readOnly && (
                            <>
                              {transaction.warning === 'potential_duplicate' && (
                                <button
                                  className="btn-icon dismiss-warning"
                                  onClick={() => handleDismissWarning(transaction.id)}
                                  title={t('transactions.dismissWarning')}
                                >
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
                              )}
                              <button
                                className="btn-icon edit"
                                onClick={() => startEditTransaction(transaction)}
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
                              <button
                                className="btn-icon delete"
                                onClick={() => handleDelete(entry.id)}
                                title={t('common.delete')}
                              >
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
        {filteredEntries.length === 0 && (
          <div className="empty-transactions" role="status">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              {transactionEntries.length === 0 ? (
                <>
                  <line x1="12" y1="1" x2="12" y2="23" />
                  <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
                </>
              ) : (
                <>
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </>
              )}
            </svg>
            <p>{t(transactionEntries.length === 0 ? 'transactions.empty' : 'transactions.emptyFiltered')}</p>
            {hasActiveFilters && (
              <button className="btn-link" onClick={clearFilters}>
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
