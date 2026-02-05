// Budget Types (shared with backend)

export type GroupType = 'income' | 'expense' | 'savings';

export interface MonthlyValue {
  budget: number;
  actual: number;
}

export interface BudgetItem {
  id: number;
  name: string;
  slug: string;
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

// Layer 1: Fixed sections (Revenue / Spending / Savings)
export interface BudgetSection {
  type: GroupType;
  name: string;
  groups: BudgetGroup[];
}

export interface BudgetData {
  yearId: number;
  year: number;
  initialBalance: number;
  groups: BudgetGroup[];
}

// Organized budget data with 3 layers
export interface OrganizedBudgetData {
  year: number;
  initialBalance: number;
  sections: BudgetSection[];
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
  totalSavings: AnnualTotals;
  remainingBalance: number;
}
