import axios from 'axios';
import { getLanguageLLMName } from '../constants/languages.js';
import { logger } from '../logger.js';

// DeepSeek API configuration
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
const DEEPSEEK_API_URL = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/v1';

export interface TransactionToClassify {
  index: number;
  date: string;
  description: string;
  amount: number;
  thirdParty?: string;
  rawDescription?: string;
  rawThirdParty?: string;
  rawCategory?: string;
  rawPaymentMethod?: string;
}

export interface CategoryInfo {
  id: number;
  name: string;
  groupName: string;
  groupType: 'income' | 'expense' | 'savings';
}

export interface PaymentMethodInfo {
  id: number;
  name: string;
  institution: string | null;
}

export interface ClassificationResult {
  index: number;
  categoryId: number | null;
  categoryName: string | null;
  groupName: string | null;
  isIncome: boolean;
  description: string | null;
  thirdParty: string | null;
  paymentMethodId: number | null;
  paymentMethodName: string | null;
  paymentMethodInstitution: string | null;
  confidence: 'high' | 'medium' | 'low';
}

interface DeepSeekMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface DeepSeekResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    prompt_cache_hit_tokens?: number;
    prompt_cache_miss_tokens?: number;
  };
}

const DESCRIPTION_STOP_WORDS = new Set([
  'a',
  'achat',
  'achats',
  'and',
  'de',
  'des',
  'du',
  'et',
  'expense',
  'expenses',
  'for',
  'la',
  'le',
  'les',
  'of',
  'paiement',
  'payment',
  'pour',
  'purchase',
  'the',
  'transaction',
]);

const DESCRIPTION_CONCEPTS = new Map<string, string>([
  ['alimentaire', 'food'],
  ['alimentation', 'food'],
  ['course', 'food'],
  ['courses', 'food'],
  ['epicerie', 'food'],
  ['food', 'food'],
  ['groceries', 'food'],
  ['grocery', 'food'],
  ['supermarket', 'food'],
  ['bar', 'restaurant'],
  ['cafe', 'restaurant'],
  ['dining', 'restaurant'],
  ['meal', 'restaurant'],
  ['repas', 'restaurant'],
  ['restaurant', 'restaurant'],
  ['billet', 'transport'],
  ['bus', 'transport'],
  ['metro', 'transport'],
  ['taxi', 'transport'],
  ['ticket', 'transport'],
  ['train', 'transport'],
  ['tram', 'transport'],
  ['transport', 'transport'],
  ['travel', 'transport'],
  ['voyage', 'transport'],
  ['doctor', 'health'],
  ['health', 'health'],
  ['healthcare', 'health'],
  ['medecin', 'health'],
  ['medical', 'health'],
  ['medicaux', 'health'],
  ['pharmacie', 'health'],
  ['sante', 'health'],
  ['soin', 'health'],
]);

const LEGAL_ENTITY_SUFFIX = /(?:[\s,]+)\(?(?:gmbh(?:\s*&\s*co\.?\s*k\.?g\.?)?|s[.\s]*[aà][.\s]*r[.\s]*l|s[.\s]*a|l[.\s]*l[.\s]*c|ltd|limited|inc(?:orporated)?|corp(?:oration)?|plc|llp|pty\.?\s*ltd|co\.?\s*ltd|a[.\s]*g|k[.\s]*g|kgaa|sasu?|eurl|snc|b\.?v\.?|n\.?v\.?|oy|a\.?b\.?|a\.?s\.?|aps|s\.?p\.?a|s\.?r\.?l|s\.?l\.?u?)\)?[.,\s]*$/iu;

const GENERIC_BUSINESS_TYPE_PREFIX = /^(?:(?:pharmacie|pharmacy|apotheke|drogerie|drugstore|restaurant|ristorante|h[oô]tel|garage|boulangerie|b[aä]ckerei|bakery|supermarch[eé]|supermarket|clinique|klinik|clinic|coiffeur|hairdresser)\s+)+/iu;

function normalizeComparableToken(token: string): string {
  if (token.length > 4 && token.endsWith('ies')) return `${token.slice(0, -3)}y`;
  if (token.length > 3 && token.endsWith('s')) return token.slice(0, -1);
  return token;
}

function descriptionTokens(value: string): Set<string> {
  const normalized = value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase();
  const words = normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
  const tokens = words
    .filter((word) => !DESCRIPTION_STOP_WORDS.has(word))
    .map((word) => {
      const stemmed = normalizeComparableToken(word);
      return DESCRIPTION_CONCEPTS.get(word) ?? DESCRIPTION_CONCEPTS.get(stemmed) ?? stemmed;
    });
  return new Set(tokens);
}

/**
 * Drop AI descriptions that do not add information beyond the category or merchant.
 */
export function removeRedundantAiDescription(
  description: string | null | undefined,
  categoryName: string | null,
  thirdParty?: string | null
): string | null {
  const cleaned = description?.trim().replace(/\s+/g, ' ');
  if (!cleaned) return null;

  const descriptionSet = descriptionTokens(cleaned);
  if (descriptionSet.size === 0) return null;

  const knownValues = [categoryName, thirdParty].filter((value): value is string => !!value?.trim());
  const onlyRepeatsKnownValue = knownValues.some((value) => {
    const knownValueSet = descriptionTokens(value);
    return knownValueSet.size > 0 && [...descriptionSet].every((token) => knownValueSet.has(token));
  });
  return onlyRepeatsKnownValue ? null : cleaned;
}

/**
 * Normalize merchant names returned by the AI without damaging short brand acronyms.
 */
export function normalizeAiThirdParty(thirdParty: string | null | undefined): string | null {
  const cleaned = thirdParty?.trim().replace(/\s+/g, ' ');
  if (!cleaned) return null;

  let withoutLegalSuffix = cleaned;
  while (LEGAL_ENTITY_SUFFIX.test(withoutLegalSuffix)) {
    withoutLegalSuffix = withoutLegalSuffix.replace(LEGAL_ENTITY_SUFFIX, '').trim();
  }
  if (!withoutLegalSuffix) return null;

  const withoutBusinessType = withoutLegalSuffix.replace(GENERIC_BUSINESS_TYPE_PREFIX, '').trim();
  const brandName = withoutBusinessType || withoutLegalSuffix;

  const hasUppercase = /\p{Lu}/u.test(brandName);
  const hasLowercase = /\p{Ll}/u.test(brandName);
  if (!hasUppercase || hasLowercase) return brandName;

  return brandName.replace(/\p{L}+(?:['’‘-]\p{L}+)*/gu, (word) => {
    const letters = word.match(/\p{L}/gu)?.length ?? 0;
    if (letters <= 3) return word;

    return word
      .toLocaleLowerCase()
      .replace(/(^|['’‘-])\p{L}/gu, (letter) => letter.toLocaleUpperCase());
  });
}

export function normalizeExtractedPdfTextFields(
  description: string | null | undefined,
  thirdParty: string | null | undefined,
  categoryName: string | null
): { description: string; thirdParty: string | null } {
  const normalizedThirdParty = normalizeAiThirdParty(thirdParty);
  const meaningfulDescription = removeRedundantAiDescription(description, categoryName, normalizedThirdParty);

  if (!normalizedThirdParty && meaningfulDescription) {
    return {
      description: '',
      thirdParty: normalizeAiThirdParty(meaningfulDescription),
    };
  }

  return {
    description: meaningfulDescription ?? '',
    thirdParty: normalizedThirdParty,
  };
}

/**
 * Check if LLM service is configured
 */
export function isLLMConfigured(): boolean {
  return !!DEEPSEEK_API_KEY;
}

/**
 * Build the system prompt with categories and known third parties
 * Uses compact JSON format for token efficiency
 */
function buildSystemPrompt(
  categories: CategoryInfo[],
  knownThirdParties: string[],
  paymentMethods: PaymentMethodInfo[],
  language: string,
  country?: string
): string {
  // Build compact category catalog: {id, n: name, g: group, t: "i"|"e"|"s"}
  const categoryCatalog = categories.map((c) => ({
    id: c.id,
    n: c.name,
    g: c.groupName,
    t: c.groupType === 'income' ? 'i' : c.groupType === 'savings' ? 's' : 'e',
  }));

  // Build compact payment methods catalog: {id, n: name (institution)}
  const pmCatalog = paymentMethods.map((pm) => ({
    id: pm.id,
    n: pm.institution ? `${pm.name} (${pm.institution})` : pm.name,
  }));

  // Format known third parties as compact array
  const thirdPartiesLine = knownThirdParties.length > 0 ? `\nThird parties: ${JSON.stringify(knownThirdParties)}` : '';

  // Format payment methods catalog
  const pmLine = pmCatalog.length > 0 ? `\nPayment methods (id,n=name): ${JSON.stringify(pmCatalog)}` : '';

  // Get language name for prompt
  const langName = getLanguageLLMName(language);

  const countryLine = country
    ? `\nUser country: ${country}. Classify based on what merchants actually sell in this country (e.g. a store name may be a retailer, not an event).`
    : '';

  return `Classify bank transactions.

Cat(id,n,g,t=i/e/s):${JSON.stringify(categoryCatalog)}
${pmLine}${thirdPartiesLine}${countryLine}

Return: catId,pmId (from lists),desc,tp,conf(h/m/l). Omit null fields. Use s(savings) categories for transfers to savings accounts.
desc: Optional. Omit unless it adds specific useful detail not already conveyed by cat or tp. Never infer a generic description from the merchant/category. If useful, simplify to 3-8 words, Title Case, in ${langName}; remove dates/refs/codes/country codes and don't repeat tp.
tp: Merchant/store brand only. Always remove branch names, locations, cities, addresses, country codes, and generic business-type labels (pharmacy, restaurant, hotel, garage, etc.); keep only the location-free brand name. Omit legal company suffixes (SA, Sarl, GmbH, LLC, etc.) and use natural name casing, never an all-uppercase company name (except genuine short acronyms).
pmId: Match from rawPaymentMethod if provided, else infer from transaction pattern if obvious (e.g., ATM withdrawal, card payment patterns).

JSON:[{index,catId?,pmId?,desc,tp?,conf},...]`;
}

/**
 * Build the user prompt with transactions to classify
 * Uses compact JSON array format: [index, date, amount, rawDesc, rawTp, rawCat, rawPm]
 */
function buildUserPrompt(transactions: TransactionToClassify[]): string {
  // Build compact array: [i, date, amount, rawDesc, rawTp, rawCat, rawPm]
  const data = transactions.map((t) => [
    t.index,
    t.date,
    t.amount,
    t.rawDescription || t.description,
    t.rawThirdParty || null,
    t.rawCategory || null,
    t.rawPaymentMethod || null,
  ]);

  return `[i,date,amt,desc,tp,cat,pm]\n${JSON.stringify(data)}`;
}

/**
 * Call the DeepSeek API
 */
async function callDeepSeekAPI(messages: DeepSeekMessage[], transactionCount: number): Promise<DeepSeekResponse> {
  if (!DEEPSEEK_API_KEY) {
    throw new Error('DeepSeek API key not configured');
  }

  // Dynamic max_tokens: ~80 tokens per transaction (LLM uses verbose JSON formatting)
  const maxTokens = Math.min(Math.max(transactionCount * 80 + 200, 1000), 8192);
  // Dynamic timeout: 10s base + 3s per transaction
  const timeout = Math.min(10000 + transactionCount * 3000, 120000);

  const url = `${DEEPSEEK_API_URL}/chat/completions`;
  logger.info({ url, maxTokens, timeout, transactionCount }, 'Calling DeepSeek API');

  try {
    const response = await axios.post<DeepSeekResponse>(
      url,
      {
        model: 'deepseek-chat',
        messages,
        max_tokens: maxTokens,
        temperature: 0.1,
        stream: false,
      },
      {
        headers: {
          Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
          'Content-Type': 'application/json',
        },
        timeout,
      }
    );

    logger.info(
      {
        status: response.status,
        hasChoices: !!response.data?.choices?.length,
      },
      'DeepSeek API response received'
    );

    return response.data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNABORTED') {
        throw new Error(`DeepSeek API timeout after ${timeout}ms`);
      }
      throw new Error(`DeepSeek API error: ${error.response?.status} - ${error.message}`);
    }
    throw error;
  }
}

/**
 * Parse LLM response into classification results
 */
function parseClassificationResponse(
  content: string,
  categories: CategoryInfo[],
  paymentMethods: PaymentMethodInfo[],
  sourceTransactions: TransactionToClassify[]
): ClassificationResult[] {
  let parsed: unknown;

  // Try to extract JSON from the response
  const jsonMatch = content.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    logger.error({ content: content.slice(0, 500) }, 'No JSON array found in LLM response');
    throw new Error('Failed to parse LLM response: no JSON array found');
  }

  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch (e) {
    logger.error({ content: content.slice(0, 500), error: e }, 'Failed to parse LLM response as JSON');
    throw new Error('Failed to parse LLM response as JSON');
  }

  if (!Array.isArray(parsed)) {
    throw new Error('LLM response is not an array');
  }

  // Create maps for category lookup by ID and name
  const categoryById = new Map<number, CategoryInfo>();
  const categoryByName = new Map<string, CategoryInfo>();
  for (const cat of categories) {
    categoryById.set(cat.id, cat);
    categoryByName.set(cat.name.toLowerCase(), cat);
  }

  // Create map for payment methods
  const paymentMethodById = new Map<number, PaymentMethodInfo>();
  for (const pm of paymentMethods) {
    paymentMethodById.set(pm.id, pm);
  }
  const validPmIds = new Set(paymentMethods.map((pm) => pm.id));

  // Confidence mapping from short to full
  const confMap: Record<string, 'high' | 'medium' | 'low'> = {
    h: 'high',
    m: 'medium',
    l: 'low',
    high: 'high',
    medium: 'medium',
    low: 'low',
  };

  const classifications: ClassificationResult[] = [];
  const transactionByIndex = new Map(sourceTransactions.map((transaction) => [transaction.index, transaction]));

  for (const raw of parsed as Array<Record<string, unknown>>) {
    const index = typeof raw.index === 'number' ? raw.index : typeof raw.i === 'number' ? raw.i : -1;
    if (index < 0) {
      continue;
    }
    // Batch indexes are global, so look up source fields by their explicit index.
    const sourceTransaction = transactionByIndex.get(index);

    // Get category by ID (new compact format) or by name (legacy fallback)
    let categoryId: number | null = null;
    let categoryName: string | null = null;
    let groupName: string | null = null;

    // Try catId first (new compact format)
    if (typeof raw.catId === 'number') {
      const category = categoryById.get(raw.catId);
      if (category) {
        categoryId = category.id;
        categoryName = category.name;
        groupName = category.groupName;
      }
    }
    // Fallback to categoryName (legacy format)
    else if (typeof raw.categoryName === 'string' && raw.categoryName) {
      const category = categoryByName.get(raw.categoryName.toLowerCase());
      if (category) {
        categoryId = category.id;
        categoryName = category.name;
        groupName = category.groupName;
      }
    }

    // Get payment method by ID (only accept valid IDs from our list)
    let paymentMethodId: number | null = null;
    const rawPmId = typeof raw.pmId === 'number' ? raw.pmId : null;
    if (rawPmId !== null && validPmIds.has(rawPmId)) {
      paymentMethodId = rawPmId;
      logger.info({ index, rawPmId, accepted: true }, 'LLM payment method classification');
    } else if (rawPmId !== null) {
      logger.warn({ index, rawPmId, accepted: false, validPmIds: Array.from(validPmIds) }, 'LLM returned invalid payment method ID for classification');
    }

    // Derive isIncome from the matched category's groupType
    const matchedCategory = categoryId ? categoryById.get(categoryId) : null;
    const isIncome = matchedCategory?.groupType === 'income';

    // Extract fields with compact (desc, tp, conf) and legacy support
    const description = (raw.desc ?? raw.description) as string | undefined;
    const thirdParty = (raw.tp ?? raw.thirdParty) as string | undefined;
    const thirdPartyToNormalize =
      typeof thirdParty === 'string'
        ? thirdParty
        : sourceTransaction?.rawThirdParty || sourceTransaction?.thirdParty || null;
    const confidence = confMap[(raw.conf ?? raw.confidence) as string] || 'low';

    // Get payment method details
    const paymentMethod = paymentMethodId !== null ? paymentMethodById.get(paymentMethodId) : null;
    const normalizedThirdParty = normalizeAiThirdParty(thirdPartyToNormalize);

    classifications.push({
      index,
      categoryId,
      categoryName,
      groupName,
      isIncome,
      description: removeRedundantAiDescription(
        typeof description === 'string' ? description : null,
        categoryName,
        normalizedThirdParty
      ),
      thirdParty: normalizedThirdParty,
      paymentMethodId,
      paymentMethodName: paymentMethod ? paymentMethod.name : null,
      paymentMethodInstitution: paymentMethod ? paymentMethod.institution : null,
      confidence,
    });
  }

  return classifications;
}

/**
 * Build prompt for extracting transactions from raw PDF text
 * Uses compact format for token efficiency (same style as classification prompt)
 */
function buildExtractPrompt(
  categories: CategoryInfo[],
  paymentMethods: PaymentMethodInfo[],
  language: string,
  country: string
): string {
  // Build compact category catalog: {id, n: name, g: group, t: "i"|"e"|"s"}
  const categoryCatalog = categories.map((c) => ({
    id: c.id,
    n: c.name,
    g: c.groupName,
    t: c.groupType === 'income' ? 'i' : c.groupType === 'savings' ? 's' : 'e',
  }));

  // Build compact payment methods catalog: {id, n: name (institution)}
  const pmCatalog = paymentMethods.map((pm) => ({
    id: pm.id,
    n: pm.institution ? `${pm.name} (${pm.institution})` : pm.name,
  }));

  const pmLine = pmCatalog.length > 0 ? `\nPM(id,n):${JSON.stringify(pmCatalog)}` : '';
  const langName = getLanguageLLMName(language);

  const countryLine = `\nUser country: ${country}. Classify based on what merchants actually sell in this country.`;

  return `Extract bank transactions from raw PDF text and classify.

Cat(id,n,g,t=i/e/s):${JSON.stringify(categoryCatalog)}${pmLine}${countryLine}

Identify the PDF issuer (bank/card company) from header/logo/footer. Match issuer to a payment method from PM list by name or institution. Return issuerPmId at top level for ALL transactions from this document.

Return:{issuerPmId?:number,txs:[{d,a,catId?,desc,tp?,conf},...]}
issuerPmId=detected document issuer's payment method ID (applies to all txs).
d=YYYY-MM-DD, a=amount(+expense/-income), catId from list.
If a transaction has both transaction and accounting dates, use the earliest date for d.
tp=merchant/store brand only. ALWAYS remove branch names, locations, cities, addresses, country codes, and generic business-type labels (pharmacy, restaurant, hotel, garage, etc.); return only the location-free brand name. Omit legal company suffixes such as SA, Sarl, GmbH, LLC. Use natural name casing, never an all-uppercase company name except genuine short acronyms. Remove abbreviations/codes/prefixes unless part of brand. Reconstruct truncated names if possible using common completions of the remaining tokens.
desc=optional useful detail about what was bought, Title Case in ${langName}. Omit unless the PDF contains specific detail not already conveyed by cat or tp. DON'T repeat tp and never infer a generic description from merchant type.
conf=h/m/l. Use s(savings) for transfers. Omit null fields.`;
}

export interface ExtractedTransaction {
  date: string;
  amount: number;
  categoryId: number | null;
  categoryName: string | null;
  groupName: string | null;
  isIncome: boolean;
  description: string;
  thirdParty: string | null;
  paymentMethodId: number | null;
  paymentMethodName: string | null;
  paymentMethodInstitution: string | null;
  confidence: 'high' | 'medium' | 'low';
}

/** Select the earliest valid transaction/accounting date, normalized to ISO format. */
export function selectEarliestExtractedTransactionDate(raw: Record<string, unknown>): string {
  const dates: string[] = [];
  for (const value of [raw.d, raw.date, raw.transactionDate, raw.accountingDate]) {
    if (typeof value !== 'string') continue;

    for (const match of value.matchAll(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b|\b(\d{1,2})([./-])(\d{1,2})\5(\d{4})\b/g)) {
      const year = Number(match[1] ?? match[7]);
      const month = Number(match[2] ?? match[6]);
      const day = Number(match[3] ?? match[4]);
      const normalized = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const parsed = new Date(`${normalized}T00:00:00Z`);
      if (
        parsed.getUTCFullYear() === year &&
        parsed.getUTCMonth() + 1 === month &&
        parsed.getUTCDate() === day
      ) {
        dates.push(normalized);
      }
    }
  }
  return dates.sort()[0] ?? '';
}

/**
 * Parse LLM response for extracted transactions
 * Supports both new format {issuerPmId, txs:[...]} and legacy array format [...]
 */
function parseExtractResponse(
  content: string,
  categories: CategoryInfo[],
  paymentMethods: PaymentMethodInfo[]
): ExtractedTransaction[] {
  let parsed: unknown;
  let issuerPmId: number | null = null;
  let txsArray: unknown[];

  // Try to extract JSON object first (new format with issuerPmId)
  const jsonObjMatch = content.match(/\{[\s\S]*\}/);
  const jsonArrMatch = content.match(/\[[\s\S]*\]/);

  if (jsonObjMatch) {
    try {
      const obj = JSON.parse(jsonObjMatch[0]);
      if (typeof obj === 'object' && obj !== null) {
        // Extract issuerPmId if present
        if (typeof obj.issuerPmId === 'number') {
          issuerPmId = obj.issuerPmId;
          logger.info({ issuerPmId }, 'Detected PDF issuer payment method');
        }
        // Get transactions array from txs field or fallback to finding array
        if (Array.isArray(obj.txs)) {
          txsArray = obj.txs;
        } else if (Array.isArray(obj.transactions)) {
          txsArray = obj.transactions;
        } else {
          // Object doesn't have txs, try array match
          throw new Error('No txs array in object');
        }
      } else {
        throw new Error('Parsed value is not an object');
      }
    } catch {
      // Fall back to array format
      if (!jsonArrMatch) {
        logger.error({ content: content.slice(0, 500) }, 'No JSON found in extract response');
        throw new Error('Failed to parse extract response: no JSON found');
      }
      try {
        parsed = JSON.parse(jsonArrMatch[0]);
        if (!Array.isArray(parsed)) {
          throw new Error('Extract response is not an array');
        }
        txsArray = parsed;
      } catch (e) {
        logger.error({ content: content.slice(0, 500), error: e }, 'Failed to parse extract response as JSON');
        throw new Error('Failed to parse extract response as JSON');
      }
    }
  } else if (jsonArrMatch) {
    // Legacy array format
    try {
      parsed = JSON.parse(jsonArrMatch[0]);
      if (!Array.isArray(parsed)) {
        throw new Error('Extract response is not an array');
      }
      txsArray = parsed;
    } catch (e) {
      logger.error({ content: content.slice(0, 500), error: e }, 'Failed to parse extract response as JSON');
      throw new Error('Failed to parse extract response as JSON');
    }
  } else {
    logger.error({ content: content.slice(0, 500) }, 'No JSON found in extract response');
    throw new Error('Failed to parse extract response: no JSON found');
  }

  const categoryMap = new Map(categories.map((c) => [c.id, c]));
  const pmMap = new Map(paymentMethods.map((pm) => [pm.id, pm]));

  // Validate issuerPmId exists in payment methods
  const validIssuerPmId = issuerPmId !== null && pmMap.has(issuerPmId) ? issuerPmId : null;
  if (issuerPmId !== null && validIssuerPmId === null) {
    logger.warn({ issuerPmId, validPmIds: Array.from(pmMap.keys()) }, 'LLM returned invalid issuerPmId - not found in payment methods list');
  } else if (validIssuerPmId !== null) {
    const pm = pmMap.get(validIssuerPmId);
    logger.info({ issuerPmId: validIssuerPmId, pmName: pm?.name, pmInstitution: pm?.institution }, 'LLM detected valid PDF issuer payment method');
  } else {
    logger.info({ issuerPmId: null }, 'LLM did not detect PDF issuer payment method');
  }

  const transactions: ExtractedTransaction[] = [];

  for (const item of txsArray) {
    if (typeof item !== 'object' || item === null) continue;

    const raw = item as Record<string, unknown>;
    // Support both compact (catId) and any variations LLM might use
    const catId = typeof raw.catId === 'number' ? raw.catId : null;
    // Per-transaction pmId (rare in new format, but support for flexibility)
    const txPmId = typeof raw.pmId === 'number' ? raw.pmId : null;
    const category = catId !== null ? categoryMap.get(catId) : null;
    // Use transaction-level pmId if present, otherwise use document-level issuerPmId
    const effectivePmId = txPmId !== null ? txPmId : validIssuerPmId;
    const pm = effectivePmId !== null ? pmMap.get(effectivePmId) : null;
    
    if (txPmId !== null) {
      if (pm) {
        logger.info({ txPmId, pmName: pm.name, pmInstitution: pm.institution }, 'Per-transaction payment method detected');
      } else {
        logger.warn({ txPmId, validPmIds: Array.from(pmMap.keys()) }, 'Per-transaction payment method ID invalid');
      }
    }

    const date = selectEarliestExtractedTransactionDate(raw);

    // Parse amount - support both compact 'a' and full 'amount'
    const rawAmount = raw.a !== undefined ? raw.a : raw.amount;
    const amount = typeof rawAmount === 'number' ? rawAmount : parseFloat(String(rawAmount)) || 0;

    const finalPaymentMethodId = pm ? pm.id : null;
    
    // Log payment method application for each transaction
    logger.info(
      {
        desc: typeof raw.desc === 'string' ? raw.desc.slice(0, 50) : null,
        txPmId,
        validIssuerPmId,
        effectivePmId,
        pmFound: pm !== null,
        pmName: pm?.name,
        pmInstitution: pm?.institution,
        finalPaymentMethodId,
      },
      'Applying payment method to extracted transaction'
    );

    const normalizedText = normalizeExtractedPdfTextFields(
      typeof raw.desc === 'string' ? raw.desc : null,
      typeof raw.tp === 'string' ? raw.tp : null,
      category?.name ?? null
    );

    transactions.push({
      date,
      amount: Math.abs(amount),
      categoryId: category ? category.id : null,
      categoryName: category ? category.name : null,
      groupName: category ? category.groupName : null,
      isIncome: category?.groupType === 'income' || amount < 0,
      description: normalizedText.description,
      thirdParty: normalizedText.thirdParty,
      paymentMethodId: finalPaymentMethodId,
      paymentMethodName: pm ? pm.name : null,
      paymentMethodInstitution: pm ? pm.institution : null,
      confidence: raw.conf === 'h' ? 'high' : raw.conf === 'm' ? 'medium' : 'low',
    });
  }

  return transactions;
}

/**
 * Extract and classify transactions from raw PDF text
 */
export async function extractAndClassifyFromPdf(
  rawPdfText: string,
  categories: CategoryInfo[],
  paymentMethods: PaymentMethodInfo[] = [],
  language: string = 'fr',
  country: string
): Promise<ExtractedTransaction[]> {
  if (!isLLMConfigured()) {
    throw new Error('LLM service not configured. Set DEEPSEEK_API_KEY environment variable.');
  }

  if (!country) {
    throw new Error('Country is required for PDF LLM classification.');
  }

  if (!rawPdfText || rawPdfText.trim().length === 0) {
    return [];
  }

  logger.info(
    {
      textLength: rawPdfText.length,
      categoriesCount: categories.length,
      paymentMethodsCount: paymentMethods.length,
    },
    'Extracting transactions from raw PDF text with LLM'
  );

  const systemPrompt = buildExtractPrompt(categories, paymentMethods, language, country);

  // Limit text to avoid excessive tokens (keep first ~20K chars which should be plenty)
  const truncatedText = rawPdfText.length > 20000 ? `${rawPdfText.slice(0, 20000)}\n...[truncated]` : rawPdfText;

  const messages: DeepSeekMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: truncatedText },
  ];

  try {
    const startTime = Date.now();
    // Estimate ~100 transactions max from a PDF
    const response = await callDeepSeekAPI(messages, 100);
    const apiTimeMs = Date.now() - startTime;

    logger.info(
      {
        timeMs: apiTimeMs,
        timeSec: (apiTimeMs / 1000).toFixed(1),
        promptTokens: response.usage?.prompt_tokens,
        completionTokens: response.usage?.completion_tokens,
        totalTokens: response.usage?.total_tokens,
      },
      'PDF extraction completed'
    );

    const content = response.choices?.[0]?.message?.content;
    if (!content) {
      logger.error({ response: JSON.stringify(response).slice(0, 500) }, 'Empty response from LLM');
      throw new Error('Empty response from LLM');
    }

    logger.info({ contentLength: content.length, content: content.slice(0, 1000) }, 'LLM PDF extraction response');

    const transactions = parseExtractResponse(content, categories, paymentMethods);
    logger.info({ extractedCount: transactions.length }, 'Parsed extracted transactions');

    return transactions;
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Failed to extract transactions from PDF'
    );
    throw error;
  }
}

/**
 * Classify transactions using DeepSeek LLM
 */
export async function classifyTransactions(
  transactions: TransactionToClassify[],
  categories: CategoryInfo[],
  knownThirdParties: string[] = [],
  paymentMethods: PaymentMethodInfo[] = [],
  language: string = 'fr',
  country?: string
): Promise<ClassificationResult[]> {
  if (!isLLMConfigured()) {
    throw new Error('LLM service not configured. Set DEEPSEEK_API_KEY environment variable.');
  }

  if (transactions.length === 0) {
    return [];
  }

  logger.info(
    {
      transactionCount: transactions.length,
      knownThirdPartiesCount: knownThirdParties.length,
      paymentMethodsCount: paymentMethods.length,
    },
    'Classifying transactions with LLM'
  );

  const systemPrompt = buildSystemPrompt(categories, knownThirdParties, paymentMethods, language, country);
  const userPrompt = buildUserPrompt(transactions);

  logger.info(
    {
      systemPromptLength: systemPrompt.length,
      userPromptLength: userPrompt.length,
      systemPrompt,
      userPrompt,
    },
    'LLM prompts prepared'
  );

  const messages: DeepSeekMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  // Token budget thresholds (for monitoring only - DeepSeek handles 64K+ context)
  const TOKEN_BUDGET = 15000;
  const TOKEN_WARNING_THRESHOLD = 10000;

  try {
    const startTime = Date.now();
    const response = await callDeepSeekAPI(messages, transactions.length);
    const apiTimeMs = Date.now() - startTime;

    const promptTokens = response.usage?.prompt_tokens ?? 0;
    const completionTokens = response.usage?.completion_tokens ?? 0;
    const totalTokens = response.usage?.total_tokens ?? 0;
    const cacheHitTokens = response.usage?.prompt_cache_hit_tokens ?? 0;
    const cacheMissTokens = response.usage?.prompt_cache_miss_tokens ?? 0;
    const cacheHitRate = promptTokens > 0 ? Math.round((cacheHitTokens / promptTokens) * 100) : 0;

    // Log token usage with cache metrics and timing
    logger.info(
      {
        transactionCount: transactions.length,
        timeMs: apiTimeMs,
        timeSec: (apiTimeMs / 1000).toFixed(1),
        promptTokens,
        completionTokens,
        totalTokens,
        cacheHitTokens,
        cacheMissTokens,
        cacheHitRate: `${cacheHitRate}%`,
        choicesCount: response.choices?.length,
      },
      'LLM classification completed'
    );

    // Log if token usage is unusually high (for monitoring only)
    if (promptTokens > TOKEN_WARNING_THRESHOLD) {
      logger.info({ promptTokens, threshold: TOKEN_WARNING_THRESHOLD }, 'High prompt token usage');
    }
    if (totalTokens > TOKEN_BUDGET) {
      logger.info({ totalTokens, budget: TOKEN_BUDGET }, 'High total token usage');
    }

    const content = response.choices?.[0]?.message?.content;
    if (!content) {
      logger.error({ response: JSON.stringify(response).slice(0, 500) }, 'Empty or invalid response from LLM');
      throw new Error('Empty response from LLM');
    }

    logger.info({ contentLength: content.length, content: content.slice(0, 1000) }, 'Parsing LLM response');

    const classifications = parseClassificationResponse(content, categories, paymentMethods, transactions);

    logger.info({ classifiedCount: classifications.length }, 'Parsed LLM classifications');

    return classifications;
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : String(error) },
      'Failed to classify transactions with LLM'
    );
    throw error;
  }
}
