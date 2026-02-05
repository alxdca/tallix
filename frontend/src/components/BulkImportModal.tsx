import React, { type DragEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  bulkCreateTransactions,
  type CategoryForClassification,
  checkLLMStatus,
  classifyTransactionsWithLLM,
  fetchPaymentMethods,
  type ParsedTransaction,
  type PaymentMethod,
  parsePdf,
  parsePdfWithLlm,
} from '../api';
import type { BudgetGroup } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import { getErrorMessage } from '../utils/errorMessages';
import { logger } from '../utils/logger';
import { formatDateDisplay, getTodayDisplay, isValidDateFormat, parseDateInput } from '../utils';
import CategoryCombobox from './CategoryCombobox';
import ThirdPartyAutocomplete from './ThirdPartyAutocomplete';

interface BulkImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  yearId: number;
  groups: BudgetGroup[];
  onImportComplete: () => void;
}

type ImportStep = 'select' | 'upload' | 'paste' | 'preview' | 'success';
type ImportSource = 'pdf' | 'spreadsheet';

type ColumnType = 'date' | 'thirdParty' | 'description' | 'amount' | 'category' | 'paymentMethod' | 'comment';

interface ColumnConfig {
  id: ColumnType;
  label: string;
  color: string;
}

const DEFAULT_COLUMN_ORDER: ColumnType[] = [
  'date',
  'description',
  'category',
  'thirdParty',
  'paymentMethod',
  'amount',
  'comment',
];

// Calculate accounting period based on date and settlement day
function calculateAccountingPeriod(
  dateStr: string, // DD/MM/YYYY format
  settlementDay: number | null
): { accountingMonth: number; accountingYear: number } {
  const parts = dateStr.split('/');
  const day = parseInt(parts[0], 10);
  let month = parseInt(parts[1], 10);
  let year = parseInt(parts[2], 10);

  // If no settlement day or day is before settlement day, use the transaction's month
  if (settlementDay === null || day < settlementDay) {
    return { accountingMonth: month, accountingYear: year };
  }

  // Day is on or after settlement day, so it goes to next month
  month++;
  if (month > 12) {
    month = 1;
    year++;
  }

  return { accountingMonth: month, accountingYear: year };
}

interface EditableTransaction extends ParsedTransaction {
  id: string;
  itemId: number | null;
  paymentMethod: string;
  // Raw fields from import (before any processing/matching)
  rawDescription: string;
  rawThirdParty: string;
  rawCategory: string;
  rawPaymentMethod: string;
  comment: string;
  selected: boolean;
  accountingMonth: number;
  accountingYear: number;
  isIncome: boolean; // True = income/refund (will be stored as negative for expense categories)
}

export default function BulkImportModal({ isOpen, onClose, yearId, groups, onImportComplete }: BulkImportModalProps) {
  const { user } = useAuth();
  const { t, monthNames } = useI18n();
  const [step, setStep] = useState<ImportStep>('select');
  const [importSource, setImportSource] = useState<ImportSource>('pdf');
  const [isDragging, setIsDragging] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [transactions, setTransactions] = useState<EditableTransaction[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [importedCount, setImportedCount] = useState(0);
  const [pasteContent, setPasteContent] = useState('');
  const [columnOrder, setColumnOrder] = useState<ColumnType[]>(DEFAULT_COLUMN_ORDER);
  const [draggedColumn, setDraggedColumn] = useState<number | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);

  const availableColumns = useMemo<ColumnConfig[]>(
    () => [
      { id: 'date', label: t('bulkImport.columns.date'), color: '#3b82f6' },
      { id: 'thirdParty', label: t('bulkImport.columns.thirdParty'), color: '#10b981' },
      { id: 'description', label: t('bulkImport.columns.description'), color: '#8b5cf6' },
      { id: 'amount', label: t('bulkImport.columns.amount'), color: '#f59e0b' },
      { id: 'category', label: t('bulkImport.columns.category'), color: '#ec4899' },
      { id: 'paymentMethod', label: t('bulkImport.columns.paymentMethod'), color: '#06b6d4' },
      { id: 'comment', label: t('bulkImport.columns.comment'), color: '#64748b' },
    ],
    [t]
  );

  // LLM Classification state
  const [llmAvailable, setLlmAvailable] = useState(false);
  const [isClassifying, setIsClassifying] = useState(false);
  const [skipPreprocessing, setSkipPreprocessing] = useState(false);

  // Track newly created items during this session
  const [localGroups, setLocalGroups] = useState<BudgetGroup[]>(groups);

  // Update localGroups when groups prop changes
  React.useEffect(() => {
    setLocalGroups(groups);
  }, [groups]);

  // Savings accounts are now real budget items in the "Épargne" group - no need for virtual groups

  // Check LLM availability when modal opens
  useEffect(() => {
    if (isOpen) {
      checkLLMStatus()
        .then((status) => setLlmAvailable(status.available))
        .catch(() => setLlmAvailable(false));
    }
  }, [isOpen]);

  // Handle when a new item is created
  const handleItemCreated = (newItem: {
    id: number;
    name: string;
    groupId: number;
    groupName: string;
    groupType: 'income' | 'expense' | 'savings';
  }) => {
    setLocalGroups((prev) =>
      prev.map((group) => {
        if (group.id === newItem.groupId) {
          return {
            ...group,
            items: [
              ...group.items,
              {
                id: newItem.id,
                name: newItem.name,
                slug: newItem.name.toLowerCase().replace(/\s+/g, '-'),
                yearlyBudget: 0,
                months: Array(12).fill({ budget: 0, actual: 0 }),
              },
            ],
          };
        }
        return group;
      })
    );
  };

  // Get all items from all groups (use localGroups to include newly created items)
  // Savings accounts are now real budget items in the "Épargne" group
  const allItems = localGroups.flatMap((g) =>
    g.items.map((item) => ({
      ...item,
      groupName: g.name,
      groupId: g.id,
      groupType: g.type,
    }))
  );

  const incomeItems = allItems.filter((i) => i.groupType === 'income');
  const expenseItems = allItems.filter((i) => i.groupType === 'expense');
  const savingsCategoryItems = allItems.filter((i) => i.groupType === 'savings');

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const processFile = useCallback(
    async (file: File) => {
      setIsLoading(true);
      setError(null);

      try {
        // Load payment methods
        const methods = await fetchPaymentMethods();
        setPaymentMethods(methods);

        // If skipPreprocessing is enabled and LLM is available, use LLM for extraction + classification
        if (skipPreprocessing && llmAvailable) {
          logger.info('Using LLM for PDF extraction and classification');
          setIsClassifying(true);
          setClassifyProgress({ done: 0, total: 1 });

          // Build categories for LLM
          const categories: CategoryForClassification[] = localGroups.flatMap((group) =>
            group.items.map((item) => ({
              id: item.id,
              name: item.name,
              groupName: group.name,
              groupType: group.type as 'income' | 'expense' | 'savings',
            }))
          );

          // Build payment methods for LLM
          const pmForLlm = methods.map((pm) => ({
            id: pm.id,
            name: pm.name,
            institution: pm.institution,
          }));

          const result = await parsePdfWithLlm(
            file,
            categories,
            pmForLlm,
            user?.language || 'fr',
            user?.country || undefined
          );
          setClassifyProgress({ done: 1, total: 1 });

          if (result.transactions.length === 0) {
            setError(t('bulkImport.errors.noPdfTransactions'));
            setIsLoading(false);
            setIsClassifying(false);
            return;
          }

          // Convert LLM-extracted transactions to editable format
          const editableTransactions: EditableTransaction[] = result.transactions.map((t, index) => {
            const dateDisplay = formatDateDisplay(t.date);
            const pm = t.paymentMethodId ? methods.find((m) => m.id === t.paymentMethodId) : null;
            const { accountingMonth, accountingYear } = calculateAccountingPeriod(
              dateDisplay,
              pm?.settlementDay ?? null
            );
            // Use full "Name (Institution)" format for payment method to match rest of the app
            const paymentMethodDisplay = pm
              ? pm.institution
                ? `${pm.name} (${pm.institution})`
                : pm.name
              : '';
            return {
              id: `import-${index}-${Date.now()}`,
              date: dateDisplay,
              description: t.description,
              thirdParty: t.thirdParty || '',
              amount: t.amount,
              itemId: t.categoryId,
              paymentMethod: paymentMethodDisplay,
              rawDescription: t.description,
              rawThirdParty: t.thirdParty || '',
              rawCategory: t.categoryName || '',
              rawPaymentMethod: t.paymentMethodName || '',
              comment: '',
              selected: true,
              accountingMonth,
              accountingYear,
              isIncome: t.isIncome,
            };
          });

          setTransactions(editableTransactions);
          setImportSource('pdf');
          setStep('preview');
          setIsClassifying(false);

          logger.info(`LLM extracted and classified ${result.transactions.length} transactions from PDF`);
          return;
        }

        // Standard PDF parsing with optional category suggestions
        const result = await parsePdf(file, yearId, skipPreprocessing);

        if (result.transactions.length === 0) {
          setError(t('bulkImport.errors.noPdfTransactionsUnsupported'));
          setIsLoading(false);
          return;
        }

        // Convert to editable transactions, using suggested categories
        const editableTransactions: EditableTransaction[] = result.transactions.map((t, index) => {
          const dateDisplay = formatDateDisplay(t.date);
          const { accountingMonth, accountingYear } = calculateAccountingPeriod(dateDisplay, null);
          return {
            ...t,
            date: dateDisplay,
            id: `import-${index}-${Date.now()}`,
            itemId: t.suggestedItemId || null,
            paymentMethod: '',
            rawDescription: t.description,
            rawThirdParty: t.thirdParty || '',
            rawCategory: '',
            rawPaymentMethod: '',
            comment: '',
            selected: true,
            accountingMonth,
            accountingYear,
            isIncome: t.isIncome ?? false,
          };
        });

        setTransactions(editableTransactions);
        setImportSource('pdf');
        setStep('preview');
      } catch (err) {
        const message = getErrorMessage(err, t);
        setError(message === t('errors.UNKNOWN') ? t('bulkImport.errors.parsePdfFailed') : message);
      } finally {
        setIsLoading(false);
        setIsClassifying(false);
      }
    },
    [yearId, skipPreprocessing, llmAvailable, localGroups, user?.language, user?.country, t]
  );

  const handleDrop = useCallback(
    async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const files = Array.from(e.dataTransfer.files);
      const pdfFile = files.find((f) => f.type === 'application/pdf');

      if (!pdfFile) {
        setError(t('bulkImport.errors.pdfRequired'));
        return;
      }

      setError(null);
      setPendingFile(pdfFile);
    },
    [t]
  );

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.type !== 'application/pdf') {
      setError(t('bulkImport.errors.selectPdf'));
      return;
    }
    setError(null);
    setPendingFile(file);
    e.target.value = '';
  };

  const handleStartImport = useCallback(async () => {
    if (!pendingFile || isLoading || isClassifying) return;
    await processFile(pendingFile);
  }, [pendingFile, isLoading, isClassifying, processFile]);

  // Try to match a category name to an existing item
  // Returns the full item with groupType for determining income/expense
  const findCategory = (categoryName: string): { id: number; groupType: 'income' | 'expense' | 'savings' } | null => {
    if (!categoryName) return null;
    const normalized = categoryName.toLowerCase().trim();

    // Try exact match first
    const exactMatch = allItems.find((item) => item.name.toLowerCase() === normalized);
    if (exactMatch) return { id: exactMatch.id, groupType: exactMatch.groupType };

    // Try partial match (category name contains or is contained in item name)
    const partialMatch = allItems.find(
      (item) => item.name.toLowerCase().includes(normalized) || normalized.includes(item.name.toLowerCase())
    );
    if (partialMatch) return { id: partialMatch.id, groupType: partialMatch.groupType };

    // Try matching with group name prefix (e.g., "Maison → Loyer" or "Maison - Loyer")
    const withGroupMatch = allItems.find((item) => {
      const fullName = `${item.groupName} ${item.name}`.toLowerCase();
      return fullName.includes(normalized) || normalized.includes(fullName);
    });
    if (withGroupMatch) return { id: withGroupMatch.id, groupType: withGroupMatch.groupType };

    return null;
  };

  // Try to match a payment method name to an existing payment method
  // Returns the payment method object or null
  // Accepts methods list as parameter to avoid stale state issues
  const findPaymentMethod = (methodName: string, methods: PaymentMethod[] = paymentMethods): PaymentMethod | null => {
    if (!methodName) return null;
    const normalized = methodName.toLowerCase().trim();

    // Try exact match with institution format "Name (Institution)" FIRST
    // This is important when multiple payment methods have the same name but different institutions
    const exactWithInstitution = methods.find((m) => {
      const fullName = m.institution ? `${m.name} (${m.institution})`.toLowerCase() : m.name.toLowerCase();
      return fullName === normalized;
    });
    if (exactWithInstitution) return exactWithInstitution;

    // Try exact match on name only
    const exactMatch = methods.find((m) => m.name.toLowerCase() === normalized);
    if (exactMatch) return exactMatch;

    // Check if input contains institution in parentheses, e.g., "Carte de crédit (Swisscard)"
    const institutionMatch = normalized.match(/^(.+?)\s*\((.+?)\)$/);
    if (institutionMatch) {
      const [, baseName, institution] = institutionMatch;
      // Find payment method with matching name AND institution
      const matchByNameAndInstitution = methods.find(
        (m) =>
          m.name.toLowerCase() === baseName.trim() &&
          m.institution &&
          m.institution.toLowerCase() === institution.trim()
      );
      if (matchByNameAndInstitution) return matchByNameAndInstitution;

      // Try partial match on institution
      const matchByPartialInstitution = methods.find(
        (m) =>
          m.name.toLowerCase() === baseName.trim() &&
          m.institution &&
          (m.institution.toLowerCase().includes(institution.trim()) ||
            institution.trim().includes(m.institution.toLowerCase()))
      );
      if (matchByPartialInstitution) return matchByPartialInstitution;
    }

    // Try partial match on name (only if no institution in input)
    if (!institutionMatch) {
      const partialMatch = methods.find(
        (m) => m.name.toLowerCase().includes(normalized) || normalized.includes(m.name.toLowerCase())
      );
      if (partialMatch) return partialMatch;
    }

    // Try matching by institution only (exact)
    const byInstitutionExact = methods.find((m) => m.institution && m.institution.toLowerCase() === normalized);
    if (byInstitutionExact) return byInstitutionExact;

    // Try matching by institution (partial)
    const byInstitutionPartial = methods.find(
      (m) =>
        m.institution &&
        (m.institution.toLowerCase().includes(normalized) || normalized.includes(m.institution.toLowerCase()))
    );
    if (byInstitutionPartial) return byInstitutionPartial;

    return null;
  };

  // Parse spreadsheet data using configured column order
  // Accepts methods list as parameter to avoid stale state issues
  // If skipMatching is true, skip category/payment method matching (for AI-only mode)
  const parseSpreadsheetData = (
    data: string,
    columns: ColumnType[],
    methods: PaymentMethod[],
    skipMatching: boolean = false
  ): EditableTransaction[] => {
    const lines = data.trim().split('\n');
    const transactions: EditableTransaction[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      // Try tab first, then semicolon, then comma
      let cells: string[];
      if (line.includes('\t')) {
        cells = line.split('\t');
      } else if (line.includes(';')) {
        cells = line.split(';');
      } else {
        cells = line.split(',');
      }

      // Clean cells
      cells = cells.map((c) => c.trim().replace(/^["']|["']$/g, ''));

      // Skip header rows (detect by common header keywords)
      const firstCell = cells[0]?.toLowerCase() || '';
      if (
        firstCell === 'date' ||
        firstCell === 'datum' ||
        firstCell === 'data' ||
        firstCell === 'description' ||
        firstCell === 'tiers' ||
        firstCell === 'montant' ||
        firstCell === 'amount' ||
        firstCell === 'betrag' ||
        firstCell === 'category' ||
        firstCell === 'catégorie' ||
        firstCell === 'kategorie' ||
        firstCell === 'comment'
      ) {
        continue;
      }

      // Parse using configured column order
      let date = '';
      let thirdParty = '';
      let description = '';
      let comment = '';
      let amount = 0;
      let categoryName = '';
      let paymentMethodName = '';

      columns.forEach((colType, index) => {
        const cellValue = cells[index] || '';

        switch (colType) {
          case 'date': {
            const parsedDate = tryParseDate(cellValue);
            if (parsedDate) date = parsedDate;
            break;
          }
          case 'thirdParty':
            thirdParty = cellValue;
            break;
          case 'description':
            description = description ? `${description} ${cellValue}` : cellValue;
            break;
          case 'amount': {
            const parsedAmount = tryParseAmount(cellValue);
            if (parsedAmount !== null) {
              amount = parsedAmount;
            }
            break;
          }
          case 'category':
            categoryName = cellValue;
            break;
          case 'paymentMethod':
            paymentMethodName = cellValue;
            break;
          case 'comment':
            comment = cellValue;
            break;
        }
      });

      // Skip rows without valid date or amount
      if (!date || amount === 0) continue;

      // Try to match category and payment method (unless skipMatching for AI-only mode)
      const matchedCategory = skipMatching ? null : findCategory(categoryName);
      const matchedPM = skipMatching ? null : findPaymentMethod(paymentMethodName, methods);
      // Store full "Name (Institution)" format to preserve uniqueness
      const matchedPaymentMethod = matchedPM
        ? matchedPM.institution
          ? `${matchedPM.name} (${matchedPM.institution})`
          : matchedPM.name
        : '';

      // Calculate accounting period based on payment method's settlement day
      const { accountingMonth, accountingYear } = calculateAccountingPeriod(date, matchedPM?.settlementDay ?? null);

      // Determine if income based on matched category type or negative amount (unless skipMatching)
      const isIncome = skipMatching ? false : matchedCategory?.groupType === 'income' || amount < 0;

      transactions.push({
        id: `paste-${i}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        date,
        description: description.trim(),
        amount: Math.abs(amount), // Store as absolute value, sign determined by isIncome
        thirdParty,
        itemId: matchedCategory?.id ?? null,
        paymentMethod: matchedPaymentMethod,
        // Keep all raw fields for LLM classification
        rawDescription: description.trim(),
        rawThirdParty: thirdParty,
        rawCategory: categoryName,
        rawPaymentMethod: paymentMethodName,
        comment: comment.trim(),
        selected: true,
        accountingMonth,
        accountingYear,
        isIncome,
      });
    }

    return transactions;
  };

  // Try to parse a date string into DD/MM/YYYY format
  const tryParseDate = (str: string): string | null => {
    if (!str) return null;
    const cleaned = str.trim();

    // DD/MM/YYYY or DD.MM.YYYY or DD-MM-YYYY
    const dmyMatch = cleaned.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
    if (dmyMatch) {
      const day = dmyMatch[1].padStart(2, '0');
      const month = dmyMatch[2].padStart(2, '0');
      let year = dmyMatch[3];
      if (year.length === 2) {
        year = (parseInt(year, 10) > 50 ? '19' : '20') + year;
      }
      return `${day}/${month}/${year}`;
    }

    // YYYY-MM-DD (ISO format)
    const isoMatch = cleaned.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/);
    if (isoMatch) {
      const day = isoMatch[3].padStart(2, '0');
      const month = isoMatch[2].padStart(2, '0');
      const year = isoMatch[1];
      return `${day}/${month}/${year}`;
    }

    return null;
  };

  // Try to parse an amount string
  const tryParseAmount = (str: string): number | null => {
    if (!str) return null;
    // Remove currency symbols and spaces
    let cleaned = str.trim().replace(/[€$£CHF\s]/gi, '');
    // Handle European format (1.234,56) vs US format (1,234.56)
    if (cleaned.includes(',') && cleaned.includes('.')) {
      // If comma comes after dot, it's European (1.234,56)
      if (cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')) {
        cleaned = cleaned.replace(/\./g, '').replace(',', '.');
      } else {
        // US format (1,234.56)
        cleaned = cleaned.replace(/,/g, '');
      }
    } else if (cleaned.includes(',') && !cleaned.includes('.')) {
      // Could be European decimal (123,45) or thousand separator
      // If comma is followed by exactly 2 digits at end, it's decimal
      if (/,\d{2}$/.test(cleaned)) {
        cleaned = cleaned.replace(',', '.');
      } else {
        cleaned = cleaned.replace(/,/g, '');
      }
    }
    // Handle apostrophe as thousand separator (Swiss format: 1'234.56)
    cleaned = cleaned.replace(/'/g, '');

    const num = parseFloat(cleaned);
    return Number.isNaN(num) ? null : num;
  };

  const processSpreadsheetData = async () => {
    if (!pasteContent.trim()) {
      setError(t('bulkImport.errors.pasteData'));
      return;
    }

    // Validate column order has required columns
    if (!columnOrder.includes('date') || !columnOrder.includes('amount')) {
      setError(t('bulkImport.errors.columnsRequired'));
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      // Load payment methods
      const methods = await fetchPaymentMethods();
      setPaymentMethods(methods);

      // Pass methods directly to avoid stale state issue
      const parsedTransactions = parseSpreadsheetData(pasteContent, columnOrder, methods);

      if (parsedTransactions.length === 0) {
        setError(t('bulkImport.errors.noValidTransactions'));
        setIsLoading(false);
        return;
      }

      setTransactions(parsedTransactions);
      setImportSource('spreadsheet');
      setStep('preview');
    } catch (err) {
      const message = getErrorMessage(err, t);
      setError(message === t('errors.UNKNOWN') ? t('bulkImport.errors.parseError') : message);
    } finally {
      setIsLoading(false);
    }
  };

  const updateTransaction = (id: string, updates: Partial<EditableTransaction>) => {
    setTransactions((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)));
  };

  const removeTransaction = (id: string) => {
    setTransactions((prev) => prev.filter((t) => t.id !== id));
  };

  const addTransaction = () => {
    const today = new Date();
    const currentMonth = today.getMonth() + 1;
    const currentYear = today.getFullYear();
    const newTransaction: EditableTransaction = {
      id: `manual-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      date: getTodayDisplay(),
      description: '',
      amount: 0,
      thirdParty: '',
      itemId: null,
      paymentMethod: '',
      rawDescription: '',
      rawThirdParty: '',
      rawCategory: '',
      rawPaymentMethod: '',
      comment: '',
      selected: true,
      accountingMonth: currentMonth,
      accountingYear: currentYear,
      isIncome: false, // Default to expense
    };
    setTransactions((prev) => [...prev, newTransaction]);
  };

  const toggleSelect = (id: string) => {
    setTransactions((prev) => prev.map((t) => (t.id === id ? { ...t, selected: !t.selected } : t)));
  };

  const toggleSelectAll = () => {
    const allSelected = transactions.every((t) => t.selected);
    setTransactions((prev) => prev.map((t) => ({ ...t, selected: !allSelected })));
  };

  // Bulk apply functions
  const applyCategoryToAll = (itemId: number | null) => {
    setTransactions((prev) => prev.map((t) => (t.selected ? { ...t, itemId } : t)));
  };

  const applyPaymentMethodToAll = (paymentMethod: string) => {
    setTransactions((prev) => prev.map((t) => (t.selected ? { ...t, paymentMethod } : t)));
  };

  // LLM Classification with parallel batching
  const BATCH_SIZE = 25;
  const MAX_CONCURRENT = 6;
  const [classifyProgress, setClassifyProgress] = useState<{ done: number; total: number } | null>(null);

  // Process batches in waves with concurrency limit, tracking timing
  interface BatchResult<R> {
    results: R[];
    batchTimes: number[];
  }

  async function processInWaves<T, R>(
    items: T[],
    concurrency: number,
    processor: (item: T) => Promise<R>,
    onProgress?: (done: number, total: number) => void
  ): Promise<BatchResult<R>> {
    const results: R[] = [];
    const batchTimes: number[] = [];
    let completed = 0;

    for (let i = 0; i < items.length; i += concurrency) {
      const wave = items.slice(i, i + concurrency);
      const waveStart = performance.now();
      const waveResults = await Promise.all(wave.map(processor));
      const waveTime = performance.now() - waveStart;

      // Record time for each batch in this wave (approximate as wave time / batch count)
      for (let j = 0; j < wave.length; j++) {
        batchTimes.push(waveTime);
      }

      results.push(...waveResults);
      completed += wave.length;
      onProgress?.(completed, items.length);
    }

    return { results, batchTimes };
  }

  const handleLLMClassification = async () => {
    if (!llmAvailable || isClassifying) return;

    // Prepare transactions for classification - send both raw and processed data
    const transactionsToClassify = transactions.map((t, index) => ({
      index,
      date: t.date,
      description: t.description,
      amount: t.amount,
      thirdParty: t.thirdParty || undefined,
      // Include raw fields so LLM has full context
      rawDescription: t.rawDescription || undefined,
      rawThirdParty: t.rawThirdParty || undefined,
      rawCategory: t.rawCategory || undefined,
      rawPaymentMethod: t.rawPaymentMethod || undefined,
    }));

    // Prepare categories list (income, expense, and savings)
    const categories: CategoryForClassification[] = allItems.map((item) => ({
      id: item.id,
      name: item.name,
      groupName: item.groupName,
      groupType: item.groupType,
    }));

    // Prepare payment methods list with IDs
    const paymentMethodsForLLM = paymentMethods.map((pm) => ({
      id: pm.id,
      name: pm.name,
      institution: pm.institution,
    }));

    setIsClassifying(true);
    setClassifyProgress({ done: 0, total: 0 });
    setError(null);

    try {
      // Split transactions into batches for parallel processing
      const batches: (typeof transactionsToClassify)[] = [];
      for (let i = 0; i < transactionsToClassify.length; i += BATCH_SIZE) {
        batches.push(transactionsToClassify.slice(i, i + BATCH_SIZE));
      }

      setClassifyProgress({ done: 0, total: batches.length });
      const startTime = performance.now();
      logger.info(`Starting LLM classification: ${batches.length} batches, max ${MAX_CONCURRENT} concurrent`);

      // Process batches in waves with concurrency limit
      const { results: batchResults, batchTimes } = await processInWaves(
        batches,
        MAX_CONCURRENT,
        (batch) => classifyTransactionsWithLLM(batch, categories, paymentMethodsForLLM),
        (done, total) => setClassifyProgress({ done, total })
      );

      // Calculate timing stats
      const totalTime = performance.now() - startTime;
      const avgBatchTime = batchTimes.length > 0 ? batchTimes.reduce((a, b) => a + b, 0) / batchTimes.length : 0;

      // Merge all batch results into a single classifications array
      const classifications = batchResults.flat();

      // Merge classifications with transactions
      setTransactions((prev) =>
        prev.map((t, index) => {
          const classification = classifications.find((c) => c.index === index);
          if (!classification) return t;

          // Apply LLM classifications (override existing values)
          const updates: Partial<EditableTransaction> = {};

          if (classification.categoryId) {
            updates.itemId = classification.categoryId;
          }

          if (classification.description) {
            updates.description = classification.description;
          }

          if (classification.thirdParty) {
            updates.thirdParty = classification.thirdParty;
          }

          if (classification.paymentMethodId) {
            // Look up payment method by ID
            const matchedPM = paymentMethods.find((pm) => pm.id === classification.paymentMethodId);
            if (matchedPM) {
              // Store full "Name (Institution)" format to preserve uniqueness
              const fullName = matchedPM.institution ? `${matchedPM.name} (${matchedPM.institution})` : matchedPM.name;
              updates.paymentMethod = fullName;
            }
          }

          if (classification.isIncome !== undefined) {
            updates.isIncome = classification.isIncome;
          }

          return { ...t, ...updates };
        })
      );

      logger.info(
        `LLM classification complete: ` +
          `${transactions.length} transactions, ` +
          `${batches.length} batches, ` +
          `${(totalTime / 1000).toFixed(1)}s total, ` +
          `${(avgBatchTime / 1000).toFixed(1)}s avg/wave`
      );
    } catch (err) {
      logger.error('LLM classification failed', err);
      const message = getErrorMessage(err, t);
      setError(message === t('errors.UNKNOWN') ? t('bulkImport.errors.classifyError') : message);
    } finally {
      setIsClassifying(false);
      setClassifyProgress(null);
    }
  };

  // Check which required fields are missing for a transaction
  const getMissingFields = (t: EditableTransaction): string[] => {
    const missing: string[] = [];
    if (!t.date || !isValidDateFormat(t.date)) missing.push('date');
    if (!t.paymentMethod) missing.push('mode');
    if (t.amount === undefined || t.amount === null || t.amount === 0) missing.push('montant');
    return missing;
  };

  const handleImport = async () => {
    const selectedTransactions = transactions.filter((t) => t.selected);

    if (selectedTransactions.length === 0) {
      setError(t('bulkImport.errors.selectAtLeastOne'));
      return;
    }

    // Check for incomplete transactions
    const incompleteTransactions = selectedTransactions
      .map((t) => ({ transaction: t, rowNum: transactions.indexOf(t) + 1, missing: getMissingFields(t) }))
      .filter((item) => item.missing.length > 0);

    if (incompleteTransactions.length > 0) {
      const rows = incompleteTransactions.map((item) => item.rowNum).join(', ');
      setError(t('bulkImport.errors.rowsIncomplete', { rows }));
      return;
    }

    // Check all have categories
    const missingCategory = selectedTransactions.filter((t) => !t.itemId);
    if (missingCategory.length > 0) {
      const rows = missingCategory.map((t) => transactions.indexOf(t) + 1).join(', ');
      setError(t('bulkImport.errors.rowsNoCategory', { rows }));
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const result = await bulkCreateTransactions(
        yearId,
        selectedTransactions.map((t) => {
          // Determine the final amount with correct sign:
          // - For income categories: always positive (income)
          // - For expense/savings categories with isIncome=true: negative (refund/credit)
          // - For expense/savings categories with isIncome=false: positive (expense)
          const item = allItems.find((i) => i.id === t.itemId);
          const isIncomeCategory = item?.groupType === 'income';
          let finalAmount = Math.abs(t.amount);

          if (!isIncomeCategory && t.isIncome) {
            // Refund/credit on expense category - store as negative
            finalAmount = -finalAmount;
          }

          return {
            date: parseDateInput(t.date), // Convert DD/MM/YYYY back to YYYY-MM-DD
            description: t.description?.trim() || undefined,
            comment: t.comment?.trim() || undefined,
            thirdParty: t.thirdParty,
            paymentMethod: t.paymentMethod,
            amount: finalAmount,
            itemId: t.itemId!,
            accountingMonth: t.accountingMonth,
            accountingYear: t.accountingYear,
          };
        })
      );

      setImportedCount(result.created);
      setStep('success');
    } catch (err) {
      const message = getErrorMessage(err, t);
      setError(message === t('errors.UNKNOWN') ? t('bulkImport.errors.importFailed') : message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    setStep('select');
    setTransactions([]);
    setError(null);
    setImportedCount(0);
    setPasteContent('');
    setImportSource('pdf');
    setColumnOrder(DEFAULT_COLUMN_ORDER);
    setDraggedColumn(null);
    setPendingFile(null);
    onClose();
    if (step === 'success') {
      onImportComplete();
    }
  };

  // Column drag-and-drop handlers
  const handleColumnDragStart = (index: number) => {
    setDraggedColumn(index);
  };

  const handleColumnDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (draggedColumn === null || draggedColumn === index) return;

    const newOrder = [...columnOrder];
    const draggedItem = newOrder[draggedColumn];
    newOrder.splice(draggedColumn, 1);
    newOrder.splice(index, 0, draggedItem);
    setColumnOrder(newOrder);
    setDraggedColumn(index);
  };

  const handleColumnDragEnd = () => {
    setDraggedColumn(null);
  };

  const addColumn = (type: ColumnType) => {
    setColumnOrder([...columnOrder, type]);
  };

  const removeColumn = (index: number) => {
    if (columnOrder.length > 2) {
      setColumnOrder(columnOrder.filter((_, i) => i !== index));
    }
  };

  const getColumnConfig = useCallback(
    (type: ColumnType): ColumnConfig => {
      return availableColumns.find((c) => c.id === type) || availableColumns[0];
    },
    [availableColumns]
  );

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal-content import-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>
            {step === 'select' && t('bulkImport.titleSelect')}
            {step === 'upload' && t('bulkImport.titleUpload')}
            {step === 'paste' && t('bulkImport.titlePaste')}
            {step === 'preview' && t('bulkImport.titlePreview')}
            {step === 'success' && t('bulkImport.titleSuccess')}
          </h2>
          <button className="modal-close" onClick={handleClose}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="modal-body">
          {error && (
            <div className="error-banner">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              {error}
            </div>
          )}

          {step === 'select' && (
            <div className="import-options">
              <p className="import-description">{t('bulkImport.subtitle')}</p>
              <div className="import-option-cards">
                <button className="import-option-card" onClick={() => setStep('upload')}>
                  <div className="option-icon">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                      <line x1="16" y1="13" x2="8" y2="13" />
                      <line x1="16" y1="17" x2="8" y2="17" />
                    </svg>
                  </div>
                  <span className="option-label">{t('bulkImport.optionPdfLabel')}</span>
                  <span className="option-hint">{t('bulkImport.optionPdf')}</span>
                </button>
                <button className="import-option-card" onClick={() => setStep('paste')}>
                  <div className="option-icon">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                      <rect x="3" y="3" width="7" height="7" />
                      <rect x="14" y="3" width="7" height="7" />
                      <rect x="3" y="14" width="7" height="7" />
                      <rect x="14" y="14" width="7" height="7" />
                    </svg>
                  </div>
                  <span className="option-label">{t('bulkImport.optionSpreadsheetLabel')}</span>
                  <span className="option-hint">{t('bulkImport.optionSpreadsheetHint')}</span>
                </button>
              </div>
            </div>
          )}

          {step === 'upload' && (
            <div className="upload-area">
              {/* AI Classification progress overlay */}
              {isClassifying && (
                <div className="classification-overlay">
                  <div className="classification-popup">
                    <div className="classification-icon">
                      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z" />
                        <circle cx="8" cy="14" r="1" />
                        <circle cx="16" cy="14" r="1" />
                        <path d="M9 18h6" />
                      </svg>
                    </div>
                    <h3>{t('bulkImport.classificationTitle')}</h3>
                    {classifyProgress && (
                      <>
                        <div className="classification-progress-bar">
                          <div
                            className="classification-progress-fill"
                            style={{ width: `${(classifyProgress.done / classifyProgress.total) * 100}%` }}
                          />
                        </div>
                        <p className="classification-progress-text">{t('bulkImport.classificationProgress')}</p>
                      </>
                    )}
                    <p className="classification-hint">{t('bulkImport.classificationHint')}</p>
                  </div>
                </div>
              )}

              <div
                className={`drop-zone ${isDragging ? 'dragging' : ''}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                {isLoading && !isClassifying ? (
                  <div className="loading-state">
                    <div className="loading-spinner" />
                    <p>{t('bulkImport.analyzingFile')}</p>
                  </div>
                ) : !isLoading ? (
                  <>
                    <div className="drop-icon">
                      <svg
                        width="64"
                        height="64"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.5"
                      >
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                        <polyline points="17 8 12 3 7 8" />
                        <line x1="12" y1="3" x2="12" y2="15" />
                      </svg>
                    </div>
                    <p className="drop-text">{t('bulkImport.dropPdf')}</p>
                    <p className="drop-hint">{t('common.or')}</p>
                    <label className="file-select-btn">
                      <input type="file" accept=".pdf,application/pdf" onChange={handleFileSelect} hidden />
                      {t('common.browseFiles')}
                    </label>
                    {pendingFile && (
                      <div className="selected-file">
                        <p className="selected-file-name">
                          {t('bulkImport.selectedFile', { name: pendingFile.name })}
                        </p>
                        <div className="selected-file-actions">
                          <button className="btn-primary" onClick={handleStartImport} disabled={isLoading || isClassifying}>
                            {t('bulkImport.startImport')}
                          </button>
                          <button className="btn-back" onClick={() => setPendingFile(null)} disabled={isLoading || isClassifying}>
                            {t('common.remove')}
                          </button>
                        </div>
                      </div>
                    )}
                  </>
                ) : null}
              </div>

              {llmAvailable && (
                <label className="skip-preprocessing-option">
                  <input
                    type="checkbox"
                    checked={skipPreprocessing}
                    onChange={(e) => setSkipPreprocessing(e.target.checked)}
                  />
                  <span className="checkbox-label">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z" />
                    </svg>
                    {t('bulkImport.aiOnlyLabel')}
                  </span>
                  <span className="checkbox-hint">{t('bulkImport.sendDirectToAi')}</span>
                </label>
              )}

              <button
                className="btn-back"
                onClick={() => {
                  setPendingFile(null);
                  setStep('select');
                }}
              >
                ← {t('common.back')}
              </button>
            </div>
          )}

          {step === 'paste' && (
            <div className="paste-area">
              <div className="paste-instructions">
                <div className="paste-instruction-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
                    <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
                  </svg>
                </div>
                <div className="paste-instruction-text">
                  <p>
                    <strong>{t('bulkImport.instructionsTitle')} :</strong>
                  </p>
                  <ol>
                    <li>{t('bulkImport.instructionOrder')}</li>
                    <li>{t('bulkImport.instructionOpenFile')}</li>
                    <li>{t('bulkImport.instructionCopy')}</li>
                    <li>{t('bulkImport.instructionPaste')}</li>
                  </ol>
                </div>
              </div>

              {/* Column Order Configurator */}
              <div className="column-configurator">
                <div className="column-config-header">
                  <span className="column-config-label">{t('bulkImport.columnOrderLabel')}</span>
                  <button
                    className="column-reset-btn"
                    onClick={() => setColumnOrder(DEFAULT_COLUMN_ORDER)}
                    title={t('bulkImport.reset')}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                      <path d="M3 3v5h5" />
                    </svg>
                    {t('bulkImport.reset')}
                  </button>
                </div>
                <div className="column-order-list">
                  {columnOrder.map((colType, index) => {
                    const config = getColumnConfig(colType);
                    return (
                      <div
                        key={`${colType}-${index}`}
                        className={`column-chip ${draggedColumn === index ? 'dragging' : ''}`}
                        draggable
                        onDragStart={() => handleColumnDragStart(index)}
                        onDragOver={(e) => handleColumnDragOver(e, index)}
                        onDragEnd={handleColumnDragEnd}
                        style={{ '--chip-color': config.color } as React.CSSProperties}
                      >
                        <span className="column-chip-handle">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                            <circle cx="9" cy="6" r="2" />
                            <circle cx="15" cy="6" r="2" />
                            <circle cx="9" cy="12" r="2" />
                            <circle cx="15" cy="12" r="2" />
                            <circle cx="9" cy="18" r="2" />
                            <circle cx="15" cy="18" r="2" />
                          </svg>
                        </span>
                        <span className="column-chip-label">{config.label}</span>
                        <button className="column-chip-remove" onClick={() => removeColumn(index)} title={t('common.remove')}>
                          <svg
                            width="12"
                            height="12"
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
                    );
                  })}
                  {availableColumns.filter((col) => !columnOrder.includes(col.id)).length > 0 && (
                    <div className="column-add-dropdown">
                      <select
                        onChange={(e) => {
                          if (e.target.value) {
                            addColumn(e.target.value as ColumnType);
                            e.target.value = '';
                          }
                        }}
                        className="column-add-select"
                      >
                        <option value="">{t('bulkImport.addColumn')}</option>
                        {availableColumns.filter((col) => !columnOrder.includes(col.id)).map((col) => (
                          <option key={col.id} value={col.id}>
                            {col.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
                <p className="column-config-hint">
                  <strong>{t('bulkImport.requiredLabel')}</strong> {t('bulkImport.requiredFields')} ·{' '}
                  <strong>{t('bulkImport.optionalLabel')}</strong> {t('bulkImport.optionalFields')}
                </p>
              </div>

              <textarea
                className="paste-textarea"
                placeholder={t('bulkImport.pastePlaceholder')}
                value={pasteContent}
                onChange={(e) => setPasteContent(e.target.value)}
                rows={12}
              />
              <div className="paste-footer">
                <button
                  className="btn-back"
                  onClick={() => {
                    setStep('select');
                    setPasteContent('');
                  }}
                >
                  ← {t('common.back')}
                </button>
                <button
                  className="btn-primary"
                  onClick={processSpreadsheetData}
                  disabled={isLoading || !pasteContent.trim()}
                >
                  {isLoading ? (
                    <>
                      <div className="loading-spinner small" />
                      {t('bulkImport.analyzing')}
                    </>
                  ) : (
                    <>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                      {t('bulkImport.analyzeData')}
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {step === 'preview' && (
            <div className={`preview-area ${isClassifying ? 'classifying' : ''}`}>
              {/* Classification progress overlay */}
              {isClassifying && (
                <div className="classification-overlay">
                  <div className="classification-popup">
                    <div className="classification-icon">
                      <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z" />
                        <circle cx="8" cy="14" r="1" />
                        <circle cx="16" cy="14" r="1" />
                        <path d="M9 18h6" />
                      </svg>
                    </div>
                    <h3>{t('bulkImport.classificationInProgress')}</h3>
                    {classifyProgress && (
                      <>
                        <div className="classification-progress-bar">
                          <div
                            className="classification-progress-fill"
                            style={{ width: `${(classifyProgress.done / classifyProgress.total) * 100}%` }}
                          />
                        </div>
                        <p className="classification-progress-text">
                          {t('bulkImport.classificationBatchProgress', {
                            done: classifyProgress.done,
                            total: classifyProgress.total,
                          })}
                        </p>
                      </>
                    )}
                    <p className="classification-hint">
                      {t('bulkImport.classificationTransactions', { count: transactions.length })}
                    </p>
                  </div>
                </div>
              )}

              {/* Summary totals */}
              {(() => {
                const selected = transactions.filter((t) => t.selected);
                // Derive type from category's group type
                const getGroupType = (itemId: number | null) => {
                  if (!itemId) return 'expense'; // Default to expense if no category
                  const item = allItems.find((i) => i.id === itemId);
                  return item?.groupType || 'expense';
                };

                // Calculate totals considering isIncome flag:
                // - Income category items: always income
                // - Expense category items with isIncome=true: refund (reduces expenses)
                // - Expense category items with isIncome=false: expense
                let totalIncome = 0;
                let totalExpenses = 0;

                for (const t of selected) {
                  const groupType = getGroupType(t.itemId);
                  if (groupType === 'income') {
                    totalIncome += t.amount;
                  } else {
                    // For expense/savings categories
                    if (t.isIncome) {
                      // Refund - reduces expenses (or can be shown as negative expense)
                      totalExpenses -= t.amount;
                    } else {
                      totalExpenses += t.amount;
                    }
                  }
                }

                const netBalance = totalIncome - totalExpenses;

                return (
                  <div className="preview-summary">
                    <div className="summary-item income">
                      <span className="summary-label">{t('bulkImport.totalIncome')}</span>
                      <span className="summary-value">+{totalIncome.toFixed(2)}</span>
                    </div>
                    <div className="summary-item expense">
                      <span className="summary-label">{t('bulkImport.totalExpenses')}</span>
                      <span className="summary-value">-{totalExpenses.toFixed(2)}</span>
                    </div>
                    <div className={`summary-item net ${netBalance >= 0 ? 'positive' : 'negative'}`}>
                      <span className="summary-label">{t('bulkImport.netBalance')}</span>
                      <span className="summary-value">
                        {netBalance >= 0 ? '+' : ''}
                        {netBalance.toFixed(2)}
                      </span>
                    </div>
                  </div>
                );
              })()}

              <div className="preview-header">
                <div className="preview-stats">
                  <span>
                    {t('bulkImport.transactionsSelected', {
                      selected: transactions.filter((t) => t.selected).length,
                      total: transactions.length,
                    })}
                  </span>
                </div>
                <div className="preview-actions">
                  <button className="btn-text" onClick={toggleSelectAll}>
                    {transactions.every((t) => t.selected) ? t('bulkImport.toggleNone') : t('bulkImport.toggleAll')}
                  </button>
                  {llmAvailable && (
                    <button
                      className="btn-llm-classify"
                      onClick={handleLLMClassification}
                      disabled={isClassifying || transactions.length === 0}
                      title={t('bulkImport.classifyWithAiTitle')}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1v1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2z" />
                        <circle cx="8" cy="14" r="1" />
                        <circle cx="16" cy="14" r="1" />
                        <path d="M9 18h6" />
                      </svg>
                      {isClassifying
                        ? classifyProgress
                          ? t('bulkImport.classificationBatchProgress', {
                              done: classifyProgress.done,
                              total: classifyProgress.total,
                            })
                          : t('bulkImport.classificationRunning')
                        : t('bulkImport.classifyWithAi')}
                    </button>
                  )}
                  <button className="btn-add-row" onClick={addTransaction}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    {t('bulkImport.addRow')}
                  </button>
                </div>
              </div>

              {/* Bulk apply controls */}
              <div className="bulk-apply-row">
                <span className="bulk-apply-label">{t('bulkImport.applyAll')}</span>
                <div className="bulk-apply-controls">
                  <div className="bulk-apply-field">
                    <label>{t('bulkImport.category')}</label>
                    <select
                      onChange={(e) => {
                        if (e.target.value) {
                          applyCategoryToAll(Number(e.target.value));
                          e.target.value = '';
                        }
                      }}
                      className="preview-select"
                    >
                      <option value="">—</option>
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
                  </div>
                  <div className="bulk-apply-field">
                    <label>{t('bulkImport.paymentMethod')}</label>
                    <select
                      onChange={(e) => {
                        applyPaymentMethodToAll(e.target.value);
                        // Don't reset for payment as empty is valid
                      }}
                      className="preview-select"
                    >
                      <option value="">—</option>
                      {paymentMethods
                        .filter((m) => !m.isSavingsAccount)
                        .map((m) => {
                          const fullName = m.institution ? `${m.name} (${m.institution})` : m.name;
                          return (
                            <option key={m.id} value={fullName}>
                              {fullName}
                            </option>
                          );
                        })}
                      {paymentMethods.some((m) => m.isSavingsAccount) && (
                        <optgroup label={t('bulkImport.savingsAccounts')}>
                          {paymentMethods
                            .filter((m) => m.isSavingsAccount)
                            .map((m) => {
                              const fullName = m.institution ? `${m.name} (${m.institution})` : m.name;
                              return (
                                <option key={m.id} value={fullName}>
                                  {fullName}
                                </option>
                              );
                            })}
                        </optgroup>
                      )}
                    </select>
                  </div>
                </div>
              </div>

              <div className={`preview-table-container ${isClassifying ? 'classifying' : ''}`}>
                <table className="preview-table">
                  <thead>
                    <tr>
                      <th className="col-select">
                        <input
                          type="checkbox"
                          checked={transactions.every((t) => t.selected)}
                          onChange={toggleSelectAll}
                        />
                      </th>
                      <th className="col-date">{t('bulkImport.columns.date')} *</th>
                      <th className="col-accounting">{t('bulkImport.accounted')}</th>
                      <th className="col-description">{t('bulkImport.columns.description')}</th>
                      <th className="col-third-party">{t('bulkImport.columns.thirdParty')} *</th>
                      <th className="col-amount">{t('bulkImport.columns.amount')} *</th>
                      <th className="col-type" title={t('bulkImport.typeHint')}>
                        {t('bulkImport.type')}
                      </th>
                      <th className="col-category">{t('bulkImport.categoryRequired')}</th>
                      <th className="col-payment">{t('bulkImport.paymentMethod')} *</th>
                      <th className="col-comment">{t('bulkImport.columns.comment')}</th>
                      <th className="col-actions"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((tx) => {
                      const missing = tx.selected ? getMissingFields(tx) : [];
                      const hasErrors = missing.length > 0;
                      const missingCategory = tx.selected && !tx.itemId;

                      return (
                        <tr
                          key={tx.id}
                          className={`${!tx.selected ? 'deselected' : ''} ${hasErrors || missingCategory ? 'has-errors' : ''}`}
                        >
                          <td>
                            <input type="checkbox" checked={tx.selected} onChange={() => toggleSelect(tx.id)} />
                          </td>
                          <td>
                            <input
                              type="text"
                              value={tx.date}
                              onChange={(e) => {
                                const newDate = e.target.value;
                                if (isValidDateFormat(newDate)) {
                                  const pm = findPaymentMethod(tx.paymentMethod);
                                  const newAccounting = calculateAccountingPeriod(newDate, pm?.settlementDay ?? null);
                                  updateTransaction(tx.id, {
                                    date: newDate,
                                    accountingMonth: newAccounting.accountingMonth,
                                    accountingYear: newAccounting.accountingYear,
                                  });
                                } else {
                                  updateTransaction(tx.id, { date: newDate });
                                }
                              }}
                              placeholder={t('transactions.datePlaceholder')}
                              className={`preview-input date ${missing.includes('date') ? 'missing-field' : ''} ${!isValidDateFormat(tx.date) && tx.date ? 'invalid' : ''}`}
                            />
                          </td>
                          <td className="accounting-cell">
                            <select
                              value={tx.accountingMonth}
                              onChange={(e) =>
                                updateTransaction(tx.id, { accountingMonth: parseInt(e.target.value, 10) })
                              }
                              className="preview-select accounting-month"
                            >
                              {monthNames.map((name, i) => (
                                <option key={i + 1} value={i + 1}>
                                  {name}
                                </option>
                              ))}
                            </select>
                            <input
                              type="number"
                              value={tx.accountingYear}
                              onChange={(e) =>
                                updateTransaction(tx.id, {
                                  accountingYear: parseInt(e.target.value, 10) || tx.accountingYear,
                                })
                              }
                              className="preview-input accounting-year"
                              min="2000"
                              max="2100"
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              value={tx.description}
                              onChange={(e) => updateTransaction(tx.id, { description: e.target.value })}
                              className="preview-input description"
                              placeholder={t('bulkImport.columns.description')}
                            />
                          </td>
                          <td>
                            <ThirdPartyAutocomplete
                              value={tx.thirdParty || ''}
                              onChange={(value) => updateTransaction(tx.id, { thirdParty: value })}
                              placeholder={t('bulkImport.thirdPartyPlaceholder')}
                              className={`preview-input third-party ${missing.includes('tiers') ? 'missing-field' : ''}`}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              value={tx.amount}
                              onChange={(e) => updateTransaction(tx.id, { amount: parseFloat(e.target.value) || 0 })}
                              className={`preview-input amount ${missing.includes('montant') ? 'missing-field' : ''}`}
                              step="0.01"
                            />
                          </td>
                          <td className="type-cell">
                            <button
                              type="button"
                              className={`type-toggle ${tx.isIncome ? 'income' : 'expense'}`}
                              onClick={() => updateTransaction(tx.id, { isIncome: !tx.isIncome })}
                              title={
                                tx.isIncome
                                  ? t('bulkImport.incomeToggle')
                                  : t('bulkImport.expenseToggle')
                              }
                            >
                              {tx.isIncome ? (
                                <>
                                  <svg
                                    width="12"
                                    height="12"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                  >
                                    <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                                    <polyline points="17 6 23 6 23 12" />
                                  </svg>
                                  <span>{t('bulkImport.income')}</span>
                                </>
                              ) : (
                                <>
                                  <svg
                                    width="12"
                                    height="12"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                  >
                                    <polyline points="23 18 13.5 8.5 8.5 13.5 1 6" />
                                    <polyline points="17 18 23 18 23 12" />
                                  </svg>
                                  <span>{t('bulkImport.expense')}</span>
                                </>
                              )}
                            </button>
                          </td>
                          <td>
                            <CategoryCombobox
                              value={tx.itemId}
                              onChange={(itemId) => updateTransaction(tx.id, { itemId })}
                              groups={localGroups}
                              yearId={yearId}
                              isRequired={tx.selected && !tx.itemId}
                              onItemCreated={handleItemCreated}
                            />
                          </td>
                          <td>
                            <select
                              value={tx.paymentMethod}
                              onChange={(e) => {
                                const pm = findPaymentMethod(e.target.value);
                                const newAccounting = calculateAccountingPeriod(tx.date, pm?.settlementDay ?? null);
                                updateTransaction(tx.id, {
                                  paymentMethod: e.target.value,
                                  accountingMonth: newAccounting.accountingMonth,
                                  accountingYear: newAccounting.accountingYear,
                                });
                              }}
                              className={`preview-select ${missing.includes('mode') ? 'missing-field' : ''}`}
                            >
                              <option value="">{t('bulkImport.paymentMethodPlaceholder')}</option>
                              {paymentMethods
                                .filter((m) => !m.isSavingsAccount)
                                .map((m) => {
                                  const fullName = m.institution ? `${m.name} (${m.institution})` : m.name;
                                  return (
                                    <option key={m.id} value={fullName}>
                                      {fullName}
                                    </option>
                                  );
                                })}
                              {paymentMethods.some((m) => m.isSavingsAccount) && (
                                <optgroup label={t('bulkImport.savingsAccounts')}>
                                  {paymentMethods
                                    .filter((m) => m.isSavingsAccount)
                                    .map((m) => {
                                      const fullName = m.institution ? `${m.name} (${m.institution})` : m.name;
                                      return (
                                        <option key={m.id} value={fullName}>
                                          {fullName}
                                        </option>
                                      );
                                    })}
                                </optgroup>
                              )}
                            </select>
                          </td>
                          <td>
                            <input
                              type="text"
                              value={tx.comment || ''}
                              onChange={(e) => updateTransaction(tx.id, { comment: e.target.value })}
                              className="preview-input comment"
                              placeholder={t('bulkImport.commentPlaceholder')}
                            />
                          </td>
                          <td>
                            <button
                              className="btn-icon delete"
                              onClick={() => removeTransaction(tx.id)}
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
                                <line x1="18" y1="6" x2="6" y2="18" />
                                <line x1="6" y1="6" x2="18" y2="18" />
                              </svg>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="preview-footer">
                <button
                  className="btn-back"
                  onClick={() => setStep(importSource === 'spreadsheet' ? 'paste' : 'upload')}
                >
                  ← {t('common.back')}
                </button>
                <button
                  className="btn-primary"
                  onClick={handleImport}
                  disabled={isLoading || transactions.filter((t) => t.selected && t.itemId).length === 0}
                >
                  {isLoading ? (
                    <>
                      <div className="loading-spinner small" />
                      {t('bulkImport.importing')}
                    </>
                  ) : (
                    <>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      {t('bulkImport.importButton', {
                        count: transactions.filter((t) => t.selected && t.itemId).length,
                      })}
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {step === 'success' && (
            <div className="success-area">
              <div className="success-icon">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="16 10 11 15 8 12" />
                </svg>
              </div>
              <h3>{t('bulkImport.importedSuccessTitle', { count: importedCount })}</h3>
              <p>{t('bulkImport.importedSuccessSubtitle')}</p>
              <button className="btn-primary" onClick={handleClose}>
                {t('common.close')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
