import { eq } from 'drizzle-orm';
import { budgetItems, budgetYears, db } from '../db/index.js';

export interface ParsedTransaction {
  date: string;
  description: string;
  amount: number; // Positive = expense, negative = income/refund (user can override in preview)
  thirdParty?: string;
  isIncome?: boolean; // Detected from PDF context - helps user review
  suggestedItemId?: number | null;
  suggestedItemName?: string;
  suggestedGroupName?: string;
  suggestedGroupType?: 'income' | 'expense' | 'savings';
}

// Category keyword mappings
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  // Groceries
  alimentation: [
    'migros',
    'coop',
    'lidl',
    'aldi',
    'denner',
    'spar',
    'volg',
    'manor food',
    'aligro',
    'carrefour',
    'leclerc',
    'auchan',
    'intermarché',
    'casino',
    'franprix',
    'monoprix',
    'picard',
    'boulangerie',
    'boucherie',
    'primeur',
  ],
  courses: ['migros', 'coop', 'lidl', 'aldi', 'denner', 'spar', 'volg', 'supermarché', 'épicerie', 'grocery'],

  // Restaurants / Dining
  restaurant: [
    'restaurant',
    'resto',
    'pizzeria',
    'brasserie',
    'bistro',
    'café',
    'starbucks',
    'mcdonald',
    'burger king',
    'subway',
    'kfc',
    'kebab',
    'sushi',
    'thai',
    'chinois',
    'italien',
    'take away',
    'takeaway',
    'uber eats',
    'deliveroo',
    'just eat',
    'smood',
  ],
  sorties: ['restaurant', 'bar', 'pub', 'club', 'cinema', 'cinéma', 'concert', 'spectacle', 'théâtre', 'musée'],

  // Transport
  transport: [
    'sbb',
    'cff',
    'ffs',
    'tpg',
    'tl',
    'bls',
    'ratp',
    'sncf',
    'train',
    'tram',
    'bus',
    'metro',
    'métro',
    'uber',
    'taxi',
    'bolt',
    'lyft',
    'parking',
    'parcmètre',
    'essence',
    'shell',
    'bp',
    'esso',
    'migrol',
    'agrola',
    'péage',
    'autoroute',
    'vignette',
  ],
  voiture: [
    'essence',
    'shell',
    'bp',
    'esso',
    'migrol',
    'agrola',
    'garage',
    'pneu',
    'révision',
    'entretien auto',
    'parking',
    'tcs',
    'assurance auto',
  ],

  // Housing / Home
  loyer: ['loyer', 'rent', 'gérance', 'régie', 'immobilier'],
  logement: ['loyer', 'rent', 'gérance', 'électricité', 'gaz', 'chauffage', 'eau', 'copropriété', 'charges'],
  électricité: ['electricité', 'électricité', 'sig', 'romande energie', 'edf', 'engie', 'alpiq'],

  // Telecom / Internet
  téléphone: [
    'swisscom',
    'sunrise',
    'salt',
    'wingo',
    'yallo',
    'lebara',
    'lycamobile',
    'orange',
    'sfr',
    'bouygues',
    'free mobile',
    'apple',
    'samsung',
    'mobile',
  ],
  internet: ['swisscom', 'sunrise', 'salt', 'upc', 'orange', 'sfr', 'free', 'bouygues'],
  abonnements: ['netflix', 'spotify', 'apple', 'disney', 'hbo', 'youtube', 'amazon prime', 'dazn', 'canal+'],

  // Health
  santé: [
    'pharmacie',
    'pharmacy',
    'médecin',
    'docteur',
    'hôpital',
    'clinique',
    'dentiste',
    'opticien',
    'optique',
    'lunettes',
    'lentilles',
    'laboratoire',
    'radiologie',
    'kiné',
    'physio',
    'ostéo',
    'css',
    'swica',
    'helsana',
    'sanitas',
    'visana',
    'concordia',
    'groupe mutuel',
    'assura',
    'atupri',
  ],
  'assurance maladie': [
    'css',
    'swica',
    'helsana',
    'sanitas',
    'visana',
    'concordia',
    'groupe mutuel',
    'assura',
    'atupri',
    'mutuelle',
  ],

  // Shopping
  vêtements: [
    'h&m',
    'zara',
    'mango',
    'uniqlo',
    'c&a',
    'manor',
    'globus',
    'zalando',
    'la redoute',
    'asos',
    'primark',
    'décathlon',
    'intersport',
    'ochsner',
  ],
  shopping: [
    'amazon',
    'galaxus',
    'digitec',
    'fnac',
    'darty',
    'ikea',
    'conforama',
    'manor',
    'globus',
    'jelmoli',
    'wish',
    'aliexpress',
    'temu',
    'shein',
  ],

  // Insurance
  assurance: [
    'axa',
    'allianz',
    'zurich',
    'helvetia',
    'mobilière',
    'mobiliar',
    'bâloise',
    'generali',
    'vaudoise',
    'maif',
    'macif',
    'matmut',
    'groupama',
  ],

  // Bank / Finance
  banque: [
    'ubs',
    'credit suisse',
    'raiffeisen',
    'bcv',
    'bcge',
    'postfinance',
    'bnp',
    'société générale',
    'crédit agricole',
    'banque populaire',
    'caisse épargne',
    'lcl',
    'frais bancaires',
    'commission',
    'intérêts',
  ],

  // Income
  salaire: ['salaire', 'salary', 'paie', 'virement employeur', 'wage'],
  revenus: ['dividende', 'intérêts', 'loyer reçu', 'remboursement'],
};

// Common header/label keywords to filter out
const HEADER_KEYWORDS = [
  'solde',
  'disponible',
  'payable',
  'montant minimum',
  'date de',
  'votre paiement',
  'numéro de compte',
  'iban',
  'bic',
  'relevé',
  'extrait',
  'période',
  'page',
  'total',
  'sous-total',
  'récapitulatif',
  'résumé',
  'balance',
  'ancien solde',
  'nouveau solde',
  'solde initial',
  'solde final',
  'solde créditeur',
  'solde débiteur',
  'date valeur',
  "date d'opération",
  'libellé',
  'débit',
  'crédit',
  'référence',
  'n° de compte',
  'titulaire',
  'agence',
  'code guichet',
  'intérêts',
  'frais',
  'commission',
  'taux',
  'plafond',
  'limite',
  'échéance',
  'prélèvement automatique',
  'conditions',
  'tarif',
  'barème',
  'en notre faveur',
  'en votre faveur',
  'au en notre',
  "jusqu'au",
  'aturation',
  'maturation',
  'encours',
];

interface ItemForMatching {
  id: number;
  name: string;
  slug: string;
  groupName: string;
  groupSlug: string;
  groupType: 'income' | 'expense' | 'savings';
}

// Get all items for a year with their groups
export async function getItemsForMatching(yearId: number): Promise<ItemForMatching[]> {
  const items = await db.query.budgetItems.findMany({
    where: eq(budgetItems.yearId, yearId),
    with: {
      group: true,
    },
  });

  return items.map((item) => ({
    id: item.id,
    name: item.name,
    slug: item.slug,
    groupName: item.group?.name || '',
    groupSlug: item.group?.slug || '',
    groupType: (item.group?.type || 'expense') as 'income' | 'expense' | 'savings',
  }));
}

// Get year ID by year number
export async function getYearIdByYear(year: number): Promise<number | null> {
  const budgetYear = await db.query.budgetYears.findFirst({
    where: eq(budgetYears.year, year),
  });
  return budgetYear?.id ?? null;
}

// Suggest a category based on description/third party
export function suggestCategory(
  text: string,
  items: ItemForMatching[]
): { itemId: number | null; itemName: string; groupName: string } | null {
  const lowerText = text.toLowerCase();

  // First, try to match against existing items/groups by name
  for (const item of items) {
    const itemNameLower = item.name.toLowerCase();

    if (lowerText.includes(itemNameLower) || itemNameLower.includes(lowerText)) {
      return { itemId: item.id, itemName: item.name, groupName: item.groupName };
    }
  }

  // Then try keyword matching
  for (const [categoryKey, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    for (const keyword of keywords) {
      if (lowerText.includes(keyword.toLowerCase())) {
        for (const item of items) {
          const itemSlugLower = item.slug.toLowerCase();
          const groupSlugLower = item.groupSlug.toLowerCase();
          const itemNameLower = item.name.toLowerCase();
          const groupNameLower = item.groupName.toLowerCase();

          if (
            itemSlugLower.includes(categoryKey) ||
            groupSlugLower.includes(categoryKey) ||
            itemNameLower.includes(categoryKey) ||
            groupNameLower.includes(categoryKey)
          ) {
            return { itemId: item.id, itemName: item.name, groupName: item.groupName };
          }
        }
      }
    }
  }

  return null;
}

// Clean and extract third party from description
export function extractThirdParty(description: string): { thirdParty: string; cleanDescription: string } {
  let thirdParty = '';
  let cleanDescription = description;

  // Remove common prefixes
  const prefixes = [
    /^(paiement|payment|achat|purchase|virement|transfer|prélèvement|direct debit)\s+(à|to|chez|at|de|from)?\s*/i,
    /^(carte|card)\s*\d*\s*/i,
    /^pos\s*/i,
    /^(e-banking|twint|paypal)\s*/i,
  ];

  for (const prefix of prefixes) {
    cleanDescription = cleanDescription.replace(prefix, '');
  }

  // Remove trailing location/date info
  const suffixes = [
    /\s+(suisse|switzerland|france|ch|fr)\s*$/i,
    /\s+\d{2}[./]\d{2}[./]?\d{0,4}\s*$/i,
    /\s+\*+\d+\s*$/i,
  ];

  for (const suffix of suffixes) {
    cleanDescription = cleanDescription.replace(suffix, '');
  }

  cleanDescription = cleanDescription.trim();

  // For credit card statements, the whole cleaned description is often the merchant
  if (cleanDescription.length > 2 && cleanDescription.length < 50) {
    const words = cleanDescription.split(/\s+/);
    if (words.length <= 5) {
      thirdParty = cleanDescription;
    }
  }

  // Try to extract from patterns like "at X" or "from X"
  if (!thirdParty) {
    const thirdPartyMatch = cleanDescription.match(/(?:chez|à|at|de|from|pour|to)\s+([A-Za-zÀ-ÿ][A-Za-zÀ-ÿ\s&'.-]+)/i);
    if (thirdPartyMatch) {
      thirdParty = thirdPartyMatch[1].trim();
    }
  }

  return { thirdParty, cleanDescription };
}

// Parse date from various formats
export function parseDate(dateStr: string): string | null {
  const match = dateStr.match(/(\d{1,2})[./](\d{1,2})[./](\d{4})/);
  if (match) {
    const [, day, month, year] = match;
    return `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }

  const isoMatch = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) {
    return dateStr;
  }

  return null;
}

// Parse amount from string (handles Swiss/European format)
// Preserves sign: positive for expenses, negative for income/credits/refunds
export function parseAmount(amountStr: string): number | null {
  // Check for explicit sign before cleaning
  const trimmed = amountStr.trim();
  const hasExplicitMinus = trimmed.startsWith('-');
  const hasExplicitPlus = trimmed.startsWith('+');

  let cleaned = amountStr.replace(/[CHF€$\s]/gi, '').trim();

  // Preserve the sign character for parsing
  const signMatch = cleaned.match(/^([+-])/);
  const sign = signMatch ? signMatch[1] : '';
  cleaned = cleaned.replace(/^[+-]/, '');

  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');

  if (lastComma > lastDot) {
    cleaned = cleaned.replace(/[.']/g, '').replace(',', '.');
  } else {
    cleaned = cleaned.replace(/[',\s]/g, '');
  }

  const amount = parseFloat(sign + cleaned);
  if (Number.isNaN(amount)) return null;

  // Return absolute value - sign detection is handled separately via detectTransactionType
  // This preserves explicit signs from the PDF while defaulting to positive
  if (hasExplicitMinus) return -Math.abs(amount);
  if (hasExplicitPlus) return Math.abs(amount);
  return Math.abs(amount);
}

// Detect if transaction is income or expense based on context
export function detectTransactionType(line: string, context: string[]): boolean {
  const incomeKeywords = ['salaire', 'virement', 'crédit', 'credit', 'versement', 'remboursement', 'avoir'];
  const expenseKeywords = ['achat', 'paiement', 'retrait', 'débit', 'debit', 'prélèvement', 'carte'];

  const lowerLine = line.toLowerCase();
  const lowerContext = context.join(' ').toLowerCase();

  if (lowerLine.includes('+') || lowerContext.includes('crédit') || lowerContext.includes('credit')) {
    return true;
  }
  if (lowerLine.includes('-') || lowerContext.includes('débit') || lowerContext.includes('debit')) {
    return false;
  }

  for (const keyword of incomeKeywords) {
    if (lowerLine.includes(keyword)) return true;
  }
  for (const keyword of expenseKeywords) {
    if (lowerLine.includes(keyword)) return false;
  }

  return false;
}

// Check if a description looks like a header/label
export function isHeaderOrLabel(description: string): boolean {
  const lower = description.toLowerCase();

  for (const keyword of HEADER_KEYWORDS) {
    if (lower.includes(keyword)) {
      return true;
    }
  }

  if (description.length < 5) return true;

  const genericPatterns = [
    /^(date|montant|solde|total|page|n°|numéro|compte)\s*$/i,
    /^(disponible|payable|minimum|maximum)\s*(au|le|du|à)?$/i,
  ];
  for (const pattern of genericPatterns) {
    if (pattern.test(description)) return true;
  }

  return false;
}

// Check if amount looks like a real transaction amount
export function isReasonableTransactionAmount(amount: number): boolean {
  const absAmount = Math.abs(amount);
  if (absAmount < 0.5) return false;
  return true;
}

// Extract transactions from PDF text
export function extractTransactionsFromText(text: string): ParsedTransaction[] {
  const transactions: ParsedTransaction[] = [];
  const lines = text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const context = lines.slice(Math.max(0, i - 2), i + 3);

    const dateMatch = line.match(/(\d{1,2}[./]\d{1,2}[./]\d{4})/);
    if (!dateMatch) continue;

    const date = parseDate(dateMatch[1]);
    if (!date) continue;

    const amountPatterns = [
      /([+-]?\s*[\d',.]+)\s*(?:CHF|EUR|€|\$)?$/i,
      /(?:CHF|EUR|€|\$)\s*([+-]?\s*[\d',.]+)/i,
      /(\d{1,3}(?:[',.\s]\d{3})*(?:[.,]\d{2})?)\s*$/,
    ];

    let amount: number | null = null;
    let amountMatch: RegExpMatchArray | null = null;
    let rawAmountStr = '';

    for (const pattern of amountPatterns) {
      amountMatch = line.match(pattern);
      if (amountMatch) {
        rawAmountStr = amountMatch[1];
        amount = parseAmount(rawAmountStr);
        if (amount !== null && Math.abs(amount) > 0) break;
      }
    }

    if (amount === null && i + 1 < lines.length) {
      for (const pattern of amountPatterns) {
        amountMatch = lines[i + 1].match(pattern);
        if (amountMatch) {
          rawAmountStr = amountMatch[1];
          amount = parseAmount(rawAmountStr);
          if (amount !== null && Math.abs(amount) > 0) break;
        }
      }
    }

    if (amount === null || amount === 0) continue;
    if (!isReasonableTransactionAmount(amount)) continue;

    let description = line
      .replace(dateMatch[0], '')
      .replace(amountMatch ? amountMatch[0] : '', '')
      .replace(/[CHF€$]/gi, '')
      .trim();

    description = description.replace(/\s+/g, ' ').trim();
    if (description.length < 2) {
      if (i + 1 < lines.length && !lines[i + 1].match(/\d{1,2}[./]\d{1,2}[./]\d{4}/)) {
        description = lines[i + 1].trim();
      }
    }

    if (description.length < 2) continue;
    if (isHeaderOrLabel(description)) continue;

    const { thirdParty, cleanDescription } = extractThirdParty(description);

    // Detect if this is income based on:
    // 1. Explicit negative sign in the raw amount string
    // 2. Context keywords (salary, credit, etc.)
    const hasExplicitSign = rawAmountStr.trim().startsWith('-') || rawAmountStr.trim().startsWith('+');
    let isIncome = amount < 0; // Negative amounts from explicit signs are income

    // If no explicit sign, use context-based detection
    if (!hasExplicitSign) {
      isIncome = detectTransactionType(line, context);
    }

    // Store absolute amount - sign is indicated by isIncome flag
    // User can override in the preview UI
    transactions.push({
      date,
      description: cleanDescription.substring(0, 200),
      amount: Math.abs(amount),
      thirdParty: thirdParty || undefined,
      isIncome,
    });
  }

  return transactions;
}

// Parse PDF buffer and extract transactions
// If skipSuggestions is true, skip category matching (for AI-only classification)
export async function parsePdfAndExtract(
  buffer: Buffer,
  yearId?: number | null,
  skipSuggestions: boolean = false
): Promise<{
  transactions: ParsedTransaction[];
  totalFound: number;
  rawTextSample: string;
}> {
  // Dynamic import pdf-parse
  const { PDFParse } = await import('pdf-parse');

  const parser = new PDFParse({ data: buffer }) as any;
  await parser.load();
  const textResult = await parser.getText();
  const text = textResult.text || '';

  const parsedTransactions = extractTransactionsFromText(text);

  // Skip category suggestions if requested (for AI-only mode)
  if (skipSuggestions) {
    return {
      transactions: parsedTransactions.map((t) => ({
        ...t,
        suggestedItemId: null,
        suggestedItemName: undefined,
        suggestedGroupName: undefined,
      })),
      totalFound: parsedTransactions.length,
      rawTextSample: text.substring(0, 500),
    };
  }

  // Get items for category matching
  let items: ItemForMatching[] = [];
  if (yearId) {
    items = await getItemsForMatching(yearId);
  } else {
    const currentYear = new Date().getFullYear();
    const currentYearId = await getYearIdByYear(currentYear);
    if (currentYearId) {
      items = await getItemsForMatching(currentYearId);
    }
  }

  // Add category suggestions to transactions
  const transactionsWithSuggestions = parsedTransactions.map((t) => {
    const textToMatch = t.thirdParty || t.description;
    const suggestion = suggestCategory(textToMatch, items);

    const descSuggestion = !suggestion && t.thirdParty ? suggestCategory(t.description, items) : null;

    const finalSuggestion = suggestion || descSuggestion;

    return {
      ...t,
      suggestedItemId: finalSuggestion?.itemId || null,
      suggestedItemName: finalSuggestion?.itemName || undefined,
      suggestedGroupName: finalSuggestion?.groupName || undefined,
    };
  });

  return {
    transactions: transactionsWithSuggestions,
    totalFound: transactionsWithSuggestions.length,
    rawTextSample: text.substring(0, 500),
  };
}
