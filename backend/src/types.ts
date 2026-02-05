// Budget Types

export type GroupType = 'income' | 'expense' | 'savings';

export interface MonthlyValue {
  budget: number;
  actual: number;
}

export interface BudgetItem {
  id: number;
  name: string;
  slug: string;
  yearlyBudget: number; // Budget for irregular/variable spending (in addition to monthly)
  months: MonthlyValue[];
}

export interface BudgetGroup {
  id: number;
  name: string;
  slug: string;
  type: GroupType;
  sortOrder: number;
  items: BudgetItem[];
}

export interface BudgetYear {
  id: number;
  year: number;
  initialBalance: number;
  groups: BudgetGroup[];
}

export interface BudgetData {
  yearId: number;
  year: number;
  initialBalance: number;
  groups: BudgetGroup[];
}

export interface AnnualTotals {
  budget: number;
  actual: number;
}

export interface GroupTotals {
  annual: AnnualTotals;
  months: MonthlyValue[];
}

export interface BudgetSummary {
  initialBalance: number;
  totalIncome: AnnualTotals;
  totalExpenses: AnnualTotals;
  remainingBalance: number;
}

// Settings
export interface Setting {
  id: number;
  key: string;
  value: string | null;
}
