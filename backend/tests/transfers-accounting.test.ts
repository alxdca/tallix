import { describe, expect, it, vi } from 'vitest';
import type { DbClient } from '../src/db/index.js';
import { createTransfer, updateTransfer } from '../src/services/transfers.js';

type Account = {
  id: number;
  userId: string;
  name: string;
  institution: string | null;
  isSavingsAccount: boolean;
  settlementDay: number | null;
};

type TransferRow = {
  id: number;
  yearId: number;
  date: string;
  amount: string;
  description: string | null;
  sourceAccountId: number;
  destinationAccountId: number;
  accountingMonth: number;
  accountingYear: number;
  destinationAccountingMonth: number | null;
  destinationAccountingYear: number | null;
  updatedAt?: Date;
  year?: { id: number; budgetId: number; year: number };
};

const budgetYear = { id: 2026, budgetId: 7, year: 2026 };
const sourceCard: Account = {
  id: 1,
  userId: 'user-1',
  name: 'Cembra',
  institution: 'Cembra',
  isSavingsAccount: false,
  settlementDay: 20,
};
const revolut: Account = {
  id: 2,
  userId: 'user-1',
  name: 'Revolut',
  institution: 'Revolut',
  isSavingsAccount: false,
  settlementDay: null,
};

function makeTx(accounts: Account[], existing?: TransferRow) {
  let insertedValues: Partial<TransferRow> | undefined;
  let updatedValues: Partial<TransferRow> | undefined;
  const accountMap = new Map(accounts.map((account) => [account.id, account]));
  const accountLookups = [...accounts];

  const tx = {
    query: {
      budgetYears: {
        findFirst: vi.fn().mockResolvedValue(budgetYear),
      },
      paymentMethods: {
        findFirst: vi.fn(async () => accountMap.get(accountLookups.shift()?.id ?? -1)),
      },
      transfers: {
        findFirst: vi.fn().mockResolvedValue(existing),
      },
    },
    insert: vi.fn(() => ({
      values: vi.fn((values: Partial<TransferRow>) => {
        insertedValues = values;
        return {
          returning: vi.fn(async () => [
            {
              id: 101,
              yearId: values.yearId,
              date: values.date,
              amount: values.amount,
              description: values.description ?? null,
              sourceAccountId: values.sourceAccountId,
              destinationAccountId: values.destinationAccountId,
              accountingMonth: values.accountingMonth,
              accountingYear: values.accountingYear,
              destinationAccountingMonth: values.destinationAccountingMonth ?? null,
              destinationAccountingYear: values.destinationAccountingYear ?? null,
            },
          ]),
        };
      }),
    })),
    update: vi.fn(() => ({
      set: vi.fn((values: Partial<TransferRow>) => {
        updatedValues = values;
        return {
          where: vi.fn(() => ({
            returning: vi.fn(async () => [{ ...existing, ...values }]),
          })),
        };
      }),
    })),
  };

  return {
    tx: tx as unknown as DbClient,
    getInsertedValues: () => insertedValues,
    getUpdatedValues: () => updatedValues,
  };
}

function existingTransfer(overrides: Partial<TransferRow> = {}): TransferRow {
  return {
    id: 5,
    yearId: budgetYear.id,
    date: '2026-08-24',
    amount: '200.00',
    description: 'manual',
    sourceAccountId: sourceCard.id,
    destinationAccountId: revolut.id,
    accountingMonth: 7,
    accountingYear: 2026,
    destinationAccountingMonth: 6,
    destinationAccountingYear: 2026,
    year: budgetYear,
    ...overrides,
  };
}

describe('transfer accounting periods', () => {
  it('defaults source and destination periods independently from account settlement days', async () => {
    const { tx, getInsertedValues } = makeTx([sourceCard, revolut]);

    const transfer = await createTransfer(
      tx,
      2026,
      { date: '2026-08-24', amount: 200, sourceAccountId: sourceCard.id, destinationAccountId: revolut.id },
      budgetYear.budgetId,
      'user-1'
    );

    expect(getInsertedValues()).toMatchObject({
      accountingMonth: 9,
      accountingYear: 2026,
      destinationAccountingMonth: 8,
      destinationAccountingYear: 2026,
    });
    expect(transfer.accountingMonth).toBe(9);
    expect(transfer.sourceAccountingMonth).toBe(9);
    expect(transfer.destinationAccountingMonth).toBe(8);
  });

  it('rolls source accounting into the next year while keeping destination on the transfer date period', async () => {
    const { tx } = makeTx([sourceCard, revolut]);

    const transfer = await createTransfer(
      tx,
      2026,
      { date: '2026-12-24', amount: 50, sourceAccountId: sourceCard.id, destinationAccountId: revolut.id },
      budgetYear.budgetId,
      'user-1'
    );

    expect(transfer.sourceAccountingMonth).toBe(1);
    expect(transfer.sourceAccountingYear).toBe(2027);
    expect(transfer.destinationAccountingMonth).toBe(12);
    expect(transfer.destinationAccountingYear).toBe(2026);
  });

  it('keeps legacy create overrides shared and falls partial legacy fields back to the old date-based period', async () => {
    const { tx } = makeTx([sourceCard, revolut]);

    const transfer = await createTransfer(
      tx,
      2026,
      {
        date: '2026-12-24',
        amount: 50,
        sourceAccountId: sourceCard.id,
        destinationAccountId: revolut.id,
        accountingMonth: 9,
      },
      budgetYear.budgetId,
      'user-1'
    );

    expect(transfer.sourceAccountingMonth).toBe(9);
    expect(transfer.sourceAccountingYear).toBe(2026);
    expect(transfer.destinationAccountingMonth).toBe(9);
    expect(transfer.destinationAccountingYear).toBe(2026);
  });

  it('falls back destination response fields to legacy source period for rows created before the migration', async () => {
    const existing = existingTransfer({
      description: 'legacy',
      accountingMonth: 9,
      destinationAccountingMonth: null,
      destinationAccountingYear: null,
    });
    const { tx } = makeTx([sourceCard, revolut], existing);

    const transfer = await updateTransfer(
      tx,
      existing.id,
      { description: 'still legacy' },
      budgetYear.budgetId,
      'user-1'
    );

    expect(transfer?.destinationAccountingMonth).toBe(9);
    expect(transfer?.destinationAccountingYear).toBe(2026);
  });

  it('preserves manual periods when an edit submits unchanged date and account ids', async () => {
    const existing = existingTransfer();
    const { tx, getUpdatedValues } = makeTx([sourceCard, revolut], existing);

    await updateTransfer(
      tx,
      existing.id,
      {
        date: existing.date,
        sourceAccountId: existing.sourceAccountId,
        destinationAccountId: existing.destinationAccountId,
        description: 'renamed',
      },
      budgetYear.budgetId,
      'user-1'
    );

    expect(getUpdatedValues()).toMatchObject({
      description: 'renamed',
    });
    expect(getUpdatedValues()).not.toHaveProperty('accountingMonth');
    expect(getUpdatedValues()).not.toHaveProperty('accountingYear');
    expect(getUpdatedValues()).not.toHaveProperty('destinationAccountingMonth');
    expect(getUpdatedValues()).not.toHaveProperty('destinationAccountingYear');
  });

  it('uses legacy update fields as a shared source and destination override unless destination is explicit', async () => {
    const existing = existingTransfer();
    const { tx } = makeTx([sourceCard, revolut], existing);

    const transfer = await updateTransfer(
      tx,
      existing.id,
      { accountingMonth: 10, destinationAccountingMonth: 8 },
      budgetYear.budgetId,
      'user-1'
    );

    expect(transfer?.sourceAccountingMonth).toBe(10);
    expect(transfer?.sourceAccountingYear).toBe(2026);
    expect(transfer?.destinationAccountingMonth).toBe(8);
    expect(transfer?.destinationAccountingYear).toBe(2026);
  });

  it('rejects invalid destination months before inserting or updating', async () => {
    const createTx = makeTx([sourceCard, revolut]);

    await expect(
      createTransfer(
        createTx.tx,
        2026,
        {
          date: '2026-08-24',
          amount: 200,
          sourceAccountId: sourceCard.id,
          destinationAccountId: revolut.id,
          destinationAccountingMonth: 13,
          destinationAccountingYear: 2026,
        },
        budgetYear.budgetId,
        'user-1'
      )
    ).rejects.toThrow('Accounting month must be an integer between 1 and 12');
    expect(createTx.getInsertedValues()).toBeUndefined();

    const updateTx = makeTx([sourceCard, revolut], existingTransfer());

    await expect(
      updateTransfer(
        updateTx.tx,
        5,
        { destinationAccountingMonth: 0, destinationAccountingYear: 2026 },
        budgetYear.budgetId,
        'user-1'
      )
    ).rejects.toThrow('Accounting month must be an integer between 1 and 12');
    expect(updateTx.getUpdatedValues()).toBeUndefined();
  });

  it('recalculates both sides when the transfer date actually changes', async () => {
    const existing = existingTransfer();
    const { tx, getUpdatedValues } = makeTx([sourceCard, revolut], existing);

    const transfer = await updateTransfer(tx, existing.id, { date: '2026-12-24' }, budgetYear.budgetId, 'user-1');

    expect(getUpdatedValues()).toMatchObject({
      accountingMonth: 1,
      accountingYear: 2027,
      destinationAccountingMonth: 12,
      destinationAccountingYear: 2026,
    });
    expect(transfer?.sourceAccountingMonth).toBe(1);
    expect(transfer?.sourceAccountingYear).toBe(2027);
    expect(transfer?.destinationAccountingMonth).toBe(12);
    expect(transfer?.destinationAccountingYear).toBe(2026);
  });

  it('recalculates only the destination side when only the destination account changes', async () => {
    const noCutoffSavings: Account = {
      id: 3,
      userId: 'user-1',
      name: 'Savings',
      institution: 'Bank',
      isSavingsAccount: true,
      settlementDay: null,
    };
    const existing = existingTransfer({
      accountingMonth: 4,
      accountingYear: 2026,
      destinationAccountingMonth: 5,
      destinationAccountingYear: 2026,
    });
    const { tx, getUpdatedValues } = makeTx([sourceCard, noCutoffSavings], existing);

    const transfer = await updateTransfer(
      tx,
      existing.id,
      { destinationAccountId: noCutoffSavings.id },
      budgetYear.budgetId,
      'user-1'
    );

    expect(getUpdatedValues()).toMatchObject({
      destinationAccountId: noCutoffSavings.id,
      destinationAccountingMonth: 8,
      destinationAccountingYear: 2026,
    });
    expect(getUpdatedValues()).not.toHaveProperty('accountingMonth');
    expect(getUpdatedValues()).not.toHaveProperty('accountingYear');
    expect(transfer?.sourceAccountingMonth).toBe(4);
    expect(transfer?.sourceAccountingYear).toBe(2026);
    expect(transfer?.destinationAccountingMonth).toBe(8);
    expect(transfer?.destinationAccountingYear).toBe(2026);
  });
});
