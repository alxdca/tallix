// Helper to format name with institution
export const formatWithInstitution = (name: string, institution: string | null): string => {
  return institution ? `${name} (${institution})` : name;
};

export function normalizeThirdParty(value?: string | null): string {
  return value?.trim().toLowerCase().replace(/\s+/g, ' ') ?? '';
}

// Parse account ID string
export const parseAccountString = (str: string): { id: number } | null => {
  if (!str) return null;
  const id = parseInt(str, 10);
  if (Number.isNaN(id)) return null;
  return { id };
};

export interface AccountingPeriod {
  month: number;
  year: number;
}

export function calculateAccountingPeriod(date: string, settlementDay?: number | null): AccountingPeriod {
  const match = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    const parsed = new Date(date);
    if (Number.isNaN(parsed.getTime())) {
      return { month: 1, year: new Date().getFullYear() };
    }
    return calculateAccountingPeriod(
      `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, '0')}-${String(
        parsed.getUTCDate()
      ).padStart(2, '0')}`,
      settlementDay
    );
  }

  let month = Number(match[2]);
  let year = Number(match[1]);
  const day = Number(match[3]);

  if (settlementDay !== null && settlementDay !== undefined && day >= settlementDay) {
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }

  return { month, year };
}

export function transferSourcePeriod(transfer: {
  accountingMonth: number;
  accountingYear: number;
  sourceAccountingMonth?: number;
  sourceAccountingYear?: number;
}): AccountingPeriod {
  return {
    month: transfer.sourceAccountingMonth ?? transfer.accountingMonth,
    year: transfer.sourceAccountingYear ?? transfer.accountingYear,
  };
}

export function transferDestinationPeriod(transfer: {
  accountingMonth: number;
  accountingYear: number;
  destinationAccountingMonth?: number;
  destinationAccountingYear?: number;
}): AccountingPeriod {
  return {
    month: transfer.destinationAccountingMonth ?? transfer.accountingMonth,
    year: transfer.destinationAccountingYear ?? transfer.accountingYear,
  };
}
