import React, { type DragEvent, useCallback, useState } from 'react';
import {
  bulkCreateTransactions,
  fetchPaymentMethods,
  type ParsedTransaction,
  type PaymentMethod,
  parsePdf,
} from '../api';
import type { BudgetGroup } from '../types';
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

const AVAILABLE_COLUMNS: ColumnConfig[] = [
  { id: 'date', label: 'Date', color: '#3b82f6' },
  { id: 'thirdParty', label: 'Tiers', color: '#10b981' },
  { id: 'description', label: 'Description', color: '#8b5cf6' },
  { id: 'amount', label: 'Montant', color: '#f59e0b' },
  { id: 'category', label: 'Catégorie', color: '#ec4899' },
  { id: 'paymentMethod', label: 'Mode', color: '#06b6d4' },
  { id: 'comment', label: 'Commentaire', color: '#64748b' },
];

const DEFAULT_COLUMN_ORDER: ColumnType[] = [
  'date',
  'description',
  'category',
  'thirdParty',
  'paymentMethod',
  'amount',
  'comment',
];

const MONTH_NAMES = ['Jan', 'Fév', 'Mar', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sep', 'Oct', 'Nov', 'Déc'];

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
  comment: string;
  selected: boolean;
  accountingMonth: number;
  accountingYear: number;
  isIncome: boolean; // True = income/refund (will be stored as negative for expense categories)
}

export default function BulkImportModal({ isOpen, onClose, yearId, groups, onImportComplete }: BulkImportModalProps) {
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

  // Track newly created items during this session
  const [localGroups, setLocalGroups] = useState<BudgetGroup[]>(groups);

  // Update localGroups when groups prop changes
  React.useEffect(() => {
    setLocalGroups(groups);
  }, [groups]);

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

        // Parse PDF with yearId for category suggestions
        const result = await parsePdf(file, yearId);

        if (result.transactions.length === 0) {
          setError('No transactions found in the PDF. The format may not be supported.');
          setIsLoading(false);
          return;
        }

        // Convert to editable transactions, using suggested categories
        // Convert dates from YYYY-MM-DD to DD/MM/YYYY for display
        // Preserve isIncome flag from PDF detection for user review
        const editableTransactions: EditableTransaction[] = result.transactions.map((t, index) => {
          const dateDisplay = formatDateDisplay(t.date); // Convert to DD/MM/YYYY
          // Default accounting period (no payment method yet, so use transaction date)
          const { accountingMonth, accountingYear } = calculateAccountingPeriod(dateDisplay, null);
          return {
            ...t,
            date: dateDisplay,
            id: `import-${index}-${Date.now()}`,
            itemId: t.suggestedItemId || null, // Use suggested category if available
            paymentMethod: '',
            comment: '',
            selected: true,
            accountingMonth,
            accountingYear,
            isIncome: t.isIncome ?? false, // Preserve PDF detection for user review
          };
        });

        setTransactions(editableTransactions);
        setImportSource('pdf');
        setStep('preview');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to parse PDF');
      } finally {
        setIsLoading(false);
      }
    },
    [yearId]
  );

  const handleDrop = useCallback(
    async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragging(false);

      const files = Array.from(e.dataTransfer.files);
      const pdfFile = files.find((f) => f.type === 'application/pdf');

      if (!pdfFile) {
        setError('Please drop a PDF file');
        return;
      }

      await processFile(pdfFile);
    },
    [processFile]
  );

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      await processFile(file);
    }
  };

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

    // Try exact match first
    const exactMatch = methods.find((m) => m.name.toLowerCase() === normalized);
    if (exactMatch) return exactMatch;

    // Try partial match
    const partialMatch = methods.find(
      (m) => m.name.toLowerCase().includes(normalized) || normalized.includes(m.name.toLowerCase())
    );
    if (partialMatch) return partialMatch;

    return null;
  };

  // Parse spreadsheet data using configured column order
  // Accepts methods list as parameter to avoid stale state issues
  const parseSpreadsheetData = (
    data: string,
    columns: ColumnType[],
    methods: PaymentMethod[]
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

      // Try to match category and payment method
      const matchedCategory = findCategory(categoryName);
      const matchedPM = findPaymentMethod(paymentMethodName, methods);
      const matchedPaymentMethod = matchedPM?.name || '';

      // Calculate accounting period based on payment method's settlement day
      const { accountingMonth, accountingYear } = calculateAccountingPeriod(date, matchedPM?.settlementDay ?? null);

      // Determine if income based on matched category type or negative amount
      const isIncome = matchedCategory?.groupType === 'income' || amount < 0;

      transactions.push({
        id: `paste-${i}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        date,
        description: description.trim(),
        amount: Math.abs(amount), // Store as absolute value, sign determined by isIncome
        thirdParty,
        itemId: matchedCategory?.id ?? null,
        paymentMethod: matchedPaymentMethod,
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
      setError('Veuillez coller des données');
      return;
    }

    // Validate column order has required columns
    if (!columnOrder.includes('date') || !columnOrder.includes('amount')) {
      setError('Les colonnes Date et Montant sont obligatoires');
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
        setError(
          "Aucune transaction valide trouvée. Vérifiez que vos données correspondent à l'ordre des colonnes configuré."
        );
        setIsLoading(false);
        return;
      }

      setTransactions(parsedTransactions);
      setImportSource('spreadsheet');
      setStep('preview');
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur lors de l'analyse des données");
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
      setError('Veuillez sélectionner au moins une transaction à importer');
      return;
    }

    // Check for incomplete transactions
    const incompleteTransactions = selectedTransactions
      .map((t) => ({ transaction: t, rowNum: transactions.indexOf(t) + 1, missing: getMissingFields(t) }))
      .filter((item) => item.missing.length > 0);

    if (incompleteTransactions.length > 0) {
      const rows = incompleteTransactions.map((item) => item.rowNum).join(', ');
      setError(
        `Les lignes ${rows} sont incomplètes. Chaque transaction doit avoir une date valide, un tiers, un mode de paiement et un montant.`
      );
      return;
    }

    // Check all have categories
    const missingCategory = selectedTransactions.filter((t) => !t.itemId);
    if (missingCategory.length > 0) {
      const rows = missingCategory.map((t) => transactions.indexOf(t) + 1).join(', ');
      setError(`Les lignes ${rows} n'ont pas de catégorie. Veuillez assigner une catégorie à chaque transaction.`);
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
      setError(err instanceof Error ? err.message : "Échec de l'importation des transactions");
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

  const getColumnConfig = (type: ColumnType): ColumnConfig => {
    return AVAILABLE_COLUMNS.find((c) => c.id === type) || AVAILABLE_COLUMNS[4];
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal-content import-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>
            {step === 'select' && 'Import en masse'}
            {step === 'upload' && 'Importer un PDF'}
            {step === 'paste' && 'Coller depuis un tableur'}
            {step === 'preview' && 'Vérifier les transactions'}
            {step === 'success' && 'Import terminé'}
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
              <p className="import-description">Sélectionnez la source des données à importer</p>
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
                  <span className="option-label">PDF</span>
                  <span className="option-hint">Relevé bancaire PDF</span>
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
                  <span className="option-label">Tableur</span>
                  <span className="option-hint">Coller depuis Excel/Sheets</span>
                </button>
              </div>
            </div>
          )}

          {step === 'upload' && (
            <div className="upload-area">
              <div
                className={`drop-zone ${isDragging ? 'dragging' : ''}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                {isLoading ? (
                  <div className="loading-state">
                    <div className="loading-spinner" />
                    <p>Analyse du fichier en cours...</p>
                  </div>
                ) : (
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
                    <p className="drop-text">Glissez-déposez votre fichier PDF ici</p>
                    <p className="drop-hint">ou</p>
                    <label className="file-select-btn">
                      <input type="file" accept=".pdf,application/pdf" onChange={handleFileSelect} hidden />
                      Parcourir les fichiers
                    </label>
                  </>
                )}
              </div>
              <button className="btn-back" onClick={() => setStep('select')}>
                ← Retour
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
                    <strong>Instructions :</strong>
                  </p>
                  <ol>
                    <li>Configurez l'ordre des colonnes ci-dessous (glisser-déposer)</li>
                    <li>Ouvrez votre fichier Excel ou Google Sheets</li>
                    <li>Sélectionnez et copiez les cellules (Ctrl+C / Cmd+C)</li>
                    <li>Collez dans la zone ci-dessous (Ctrl+V / Cmd+V)</li>
                  </ol>
                </div>
              </div>

              {/* Column Order Configurator */}
              <div className="column-configurator">
                <div className="column-config-header">
                  <span className="column-config-label">Ordre des colonnes :</span>
                  <button
                    className="column-reset-btn"
                    onClick={() => setColumnOrder(DEFAULT_COLUMN_ORDER)}
                    title="Réinitialiser"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                      <path d="M3 3v5h5" />
                    </svg>
                    Réinitialiser
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
                        <button className="column-chip-remove" onClick={() => removeColumn(index)} title="Supprimer">
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
                  {AVAILABLE_COLUMNS.filter((col) => !columnOrder.includes(col.id)).length > 0 && (
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
                        <option value="">+ Ajouter</option>
                        {AVAILABLE_COLUMNS.filter((col) => !columnOrder.includes(col.id)).map((col) => (
                          <option key={col.id} value={col.id}>
                            {col.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
                <p className="column-config-hint">
                  <strong>Requis :</strong> Date, Tiers, Mode, Montant · <strong>Optionnel :</strong> Description,
                  Catégorie, Commentaire
                </p>
              </div>

              <textarea
                className="paste-textarea"
                placeholder="Collez vos données ici...&#10;&#10;Exemple :&#10;15/01/2026    Migros    Courses alimentaires    -125.50&#10;16/01/2026    Employeur    Salaire janvier    4500.00"
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
                  ← Retour
                </button>
                <button
                  className="btn-primary"
                  onClick={processSpreadsheetData}
                  disabled={isLoading || !pasteContent.trim()}
                >
                  {isLoading ? (
                    <>
                      <div className="loading-spinner small" />
                      Analyse en cours...
                    </>
                  ) : (
                    <>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="9 18 15 12 9 6" />
                      </svg>
                      Analyser les données
                    </>
                  )}
                </button>
              </div>
            </div>
          )}

          {step === 'preview' && (
            <div className="preview-area">
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
                      <span className="summary-label">Total revenus</span>
                      <span className="summary-value">+{totalIncome.toFixed(2)}</span>
                    </div>
                    <div className="summary-item expense">
                      <span className="summary-label">Total dépenses</span>
                      <span className="summary-value">-{totalExpenses.toFixed(2)}</span>
                    </div>
                    <div className={`summary-item net ${netBalance >= 0 ? 'positive' : 'negative'}`}>
                      <span className="summary-label">Solde net</span>
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
                    {transactions.filter((t) => t.selected).length} / {transactions.length} transactions sélectionnées
                  </span>
                </div>
                <div className="preview-actions">
                  <button className="btn-text" onClick={toggleSelectAll}>
                    {transactions.every((t) => t.selected) ? 'Tout désélectionner' : 'Tout sélectionner'}
                  </button>
                  <button className="btn-add-row" onClick={addTransaction}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="12" y1="5" x2="12" y2="19" />
                      <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    Ajouter une ligne
                  </button>
                </div>
              </div>

              {/* Bulk apply controls */}
              <div className="bulk-apply-row">
                <span className="bulk-apply-label">Appliquer à toutes les sélectionnées :</span>
                <div className="bulk-apply-controls">
                  <div className="bulk-apply-field">
                    <label>Catégorie</label>
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
                      <optgroup label="Revenus">
                        {incomeItems.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.groupName} → {item.name}
                          </option>
                        ))}
                      </optgroup>
                      <optgroup label="Dépenses">
                        {expenseItems.map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.groupName} → {item.name}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                  </div>
                  <div className="bulk-apply-field">
                    <label>Mode</label>
                    <select
                      onChange={(e) => {
                        applyPaymentMethodToAll(e.target.value);
                        // Don't reset for payment as empty is valid
                      }}
                      className="preview-select"
                    >
                      <option value="">—</option>
                      {paymentMethods.map((m) => (
                        <option key={m.id} value={m.name}>
                          {m.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              <div className="preview-table-container">
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
                      <th className="col-date">Date *</th>
                      <th className="col-accounting">Comptabilisé</th>
                      <th className="col-description">Description</th>
                      <th className="col-third-party">Tiers *</th>
                      <th className="col-amount">Montant *</th>
                      <th className="col-type" title="Type: Dépense ou Revenu/Crédit">
                        Type
                      </th>
                      <th className="col-category">Catégorie *</th>
                      <th className="col-payment">Mode *</th>
                      <th className="col-comment">Commentaire</th>
                      <th className="col-actions"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {transactions.map((t) => {
                      const missing = t.selected ? getMissingFields(t) : [];
                      const hasErrors = missing.length > 0;
                      const missingCategory = t.selected && !t.itemId;

                      return (
                        <tr
                          key={t.id}
                          className={`${!t.selected ? 'deselected' : ''} ${hasErrors || missingCategory ? 'has-errors' : ''}`}
                        >
                          <td>
                            <input type="checkbox" checked={t.selected} onChange={() => toggleSelect(t.id)} />
                          </td>
                          <td>
                            <input
                              type="text"
                              value={t.date}
                              onChange={(e) => {
                                const newDate = e.target.value;
                                if (isValidDateFormat(newDate)) {
                                  const pm = paymentMethods.find((m) => m.name === t.paymentMethod);
                                  const newAccounting = calculateAccountingPeriod(newDate, pm?.settlementDay ?? null);
                                  updateTransaction(t.id, {
                                    date: newDate,
                                    accountingMonth: newAccounting.accountingMonth,
                                    accountingYear: newAccounting.accountingYear,
                                  });
                                } else {
                                  updateTransaction(t.id, { date: newDate });
                                }
                              }}
                              placeholder="JJ/MM/AAAA"
                              className={`preview-input date ${missing.includes('date') ? 'missing-field' : ''} ${!isValidDateFormat(t.date) && t.date ? 'invalid' : ''}`}
                            />
                          </td>
                          <td className="accounting-cell">
                            <select
                              value={t.accountingMonth}
                              onChange={(e) =>
                                updateTransaction(t.id, { accountingMonth: parseInt(e.target.value, 10) })
                              }
                              className="preview-select accounting-month"
                            >
                              {MONTH_NAMES.map((name, i) => (
                                <option key={i + 1} value={i + 1}>
                                  {name}
                                </option>
                              ))}
                            </select>
                            <input
                              type="number"
                              value={t.accountingYear}
                              onChange={(e) =>
                                updateTransaction(t.id, {
                                  accountingYear: parseInt(e.target.value, 10) || t.accountingYear,
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
                              value={t.description}
                              onChange={(e) => updateTransaction(t.id, { description: e.target.value })}
                              className="preview-input description"
                              placeholder="Description"
                            />
                          </td>
                          <td>
                            <ThirdPartyAutocomplete
                              value={t.thirdParty || ''}
                              onChange={(value) => updateTransaction(t.id, { thirdParty: value })}
                              placeholder="Tiers *"
                              className={`preview-input third-party ${missing.includes('tiers') ? 'missing-field' : ''}`}
                            />
                          </td>
                          <td>
                            <input
                              type="number"
                              value={t.amount}
                              onChange={(e) => updateTransaction(t.id, { amount: parseFloat(e.target.value) || 0 })}
                              className={`preview-input amount ${missing.includes('montant') ? 'missing-field' : ''}`}
                              step="0.01"
                            />
                          </td>
                          <td className="type-cell">
                            <button
                              type="button"
                              className={`type-toggle ${t.isIncome ? 'income' : 'expense'}`}
                              onClick={() => updateTransaction(t.id, { isIncome: !t.isIncome })}
                              title={
                                t.isIncome
                                  ? 'Revenu/Crédit (cliquer pour changer en Dépense)'
                                  : 'Dépense (cliquer pour changer en Revenu/Crédit)'
                              }
                            >
                              {t.isIncome ? (
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
                                  <span>Crédit</span>
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
                                  <span>Dépense</span>
                                </>
                              )}
                            </button>
                          </td>
                          <td>
                            <CategoryCombobox
                              value={t.itemId}
                              onChange={(itemId) => updateTransaction(t.id, { itemId })}
                              groups={localGroups}
                              yearId={yearId}
                              isRequired={t.selected && !t.itemId}
                              onItemCreated={handleItemCreated}
                            />
                          </td>
                          <td>
                            <select
                              value={t.paymentMethod}
                              onChange={(e) => {
                                const pm = paymentMethods.find((m) => m.name === e.target.value);
                                const newAccounting = calculateAccountingPeriod(t.date, pm?.settlementDay ?? null);
                                updateTransaction(t.id, {
                                  paymentMethod: e.target.value,
                                  accountingMonth: newAccounting.accountingMonth,
                                  accountingYear: newAccounting.accountingYear,
                                });
                              }}
                              className={`preview-select ${missing.includes('mode') ? 'missing-field' : ''}`}
                            >
                              <option value="">- Mode * -</option>
                              {paymentMethods.map((m) => (
                                <option key={m.id} value={m.name}>
                                  {m.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <input
                              type="text"
                              value={t.comment || ''}
                              onChange={(e) => updateTransaction(t.id, { comment: e.target.value })}
                              className="preview-input comment"
                              placeholder="Commentaire"
                            />
                          </td>
                          <td>
                            <button
                              className="btn-icon delete"
                              onClick={() => removeTransaction(t.id)}
                              title="Supprimer"
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
                  ← Retour
                </button>
                <button
                  className="btn-primary"
                  onClick={handleImport}
                  disabled={isLoading || transactions.filter((t) => t.selected && t.itemId).length === 0}
                >
                  {isLoading ? (
                    <>
                      <div className="loading-spinner small" />
                      Import en cours...
                    </>
                  ) : (
                    <>
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      Importer {transactions.filter((t) => t.selected && t.itemId).length} transactions
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
              <h3>{importedCount} transactions importées avec succès</h3>
              <p>Les transactions ont été ajoutées à votre budget.</p>
              <button className="btn-primary" onClick={handleClose}>
                Fermer
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
