import axios from 'axios';
import { describe, expect, it, vi } from 'vitest';
import { selectEarliestExtractedTransactionDate } from '../src/services/llm.js';

describe('LLM PDF date selection', () => {
  it('uses the earliest date when transaction and accounting dates are both present', () => {
    expect(
      selectEarliestExtractedTransactionDate({
        d: '2026-03-15',
        transactionDate: '14.03.2026',
        accountingDate: '15.03.2026',
      })
    ).toBe('2026-03-14');
  });

  it('uses the earliest date when the LLM returns both dates in one field', () => {
    expect(
      selectEarliestExtractedTransactionDate({
        date: 'Accounting 16/03/2026 Transaction 15/03/2026',
      })
    ).toBe('2026-03-15');
  });

  it.each(['2026-03-04', '4.3.2026', '04/03/2026', '04-03-2026'])('normalizes a single date in %s format', (date) => {
    expect(selectEarliestExtractedTransactionDate({ date })).toBe('2026-03-04');
  });

  it('compares dates across year boundaries', () => {
    expect(selectEarliestExtractedTransactionDate({ d: '2026-01-01', accountingDate: '31.12.2025' })).toBe(
      '2025-12-31'
    );
  });

  it('ignores invalid dates and unrelated text fields', () => {
    expect(
      selectEarliestExtractedTransactionDate({
        d: '2026-02-29',
        date: '31/04/2026 and 01/05/2026',
        description: '01/01/2020',
      })
    ).toBe('2026-05-01');
    expect(selectEarliestExtractedTransactionDate({ d: '2024-02-29' })).toBe('2024-02-29');
  });

  it('returns an empty date when no valid date is available', () => {
    expect(selectEarliestExtractedTransactionDate({})).toBe('');
    expect(selectEarliestExtractedTransactionDate({ d: null, date: 20260315 })).toBe('');
    expect(selectEarliestExtractedTransactionDate({ date: 'unknown 2026-13-01' })).toBe('');
  });

  it('applies date selection to the PDF extraction response', async () => {
    vi.stubEnv('DEEPSEEK_API_KEY', 'test-key');
    vi.resetModules();
    const post = vi.spyOn(axios, 'post').mockResolvedValue({
      data: {
        choices: [
          {
            message: {
              content: JSON.stringify({
                txs: [
                  { d: '2026-03-16', transactionDate: '15.03.2026', a: 10 },
                  { date: 'Accounting 16/03/2026 Transaction 14/03/2026', a: 20 },
                ],
              }),
            },
          },
        ],
      },
    });
    try {
      const { extractAndClassifyFromPdf } = await import('../src/services/llm.js');
      const transactions = await extractAndClassifyFromPdf('Statement text', [], [], 'en', 'CH');
      expect(transactions.map(({ date }) => date)).toEqual(['2026-03-15', '2026-03-14']);
    } finally {
      post.mockRestore();
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });
});
