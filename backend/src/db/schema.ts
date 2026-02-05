import { pgTable, serial, varchar, integer, decimal, boolean, timestamp, text, date, uniqueIndex } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// Budget Years
export const budgetYears = pgTable('budget_years', {
  id: serial('id').primaryKey(),
  year: integer('year').notNull().unique(),
  initialBalance: decimal('initial_balance', { precision: 12, scale: 2 }).notNull().default('0'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Budget Groups (categories like REVENUS, MAISON, etc.)
// type: 'income' | 'expense' | 'savings'
export const budgetGroups = pgTable('budget_groups', {
  id: serial('id').primaryKey(),
  yearId: integer('year_id').references(() => budgetYears.id, { onDelete: 'cascade' }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull(),
  type: varchar('type', { length: 20 }).notNull().default('expense'),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  // Unique constraint on (year_id, slug) to prevent duplicate slugs within a year
  yearSlugUnique: uniqueIndex('budget_groups_year_slug_unique').on(table.yearId, table.slug),
}));

// Budget Items (individual line items within groups)
export const budgetItems = pgTable('budget_items', {
  id: serial('id').primaryKey(),
  yearId: integer('year_id').references(() => budgetYears.id, { onDelete: 'cascade' }).notNull(),
  groupId: integer('group_id').references(() => budgetGroups.id, { onDelete: 'set null' }), // nullable for unassigned items
  name: varchar('name', { length: 200 }).notNull(),
  slug: varchar('slug', { length: 200 }).notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  // Yearly budget for irregular/variable spending (e.g., vacations, restaurants)
  // This is in addition to monthly budgets - some items may have both
  yearlyBudget: decimal('yearly_budget', { precision: 12, scale: 2 }).notNull().default('0'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  // Unique constraint on (year_id, group_id, slug) to prevent duplicate slugs within a group
  // Note: This only applies when group_id is not null (partial index in migration)
  yearGroupSlugUnique: uniqueIndex('budget_items_year_group_slug_unique').on(table.yearId, table.groupId, table.slug),
}));

// Monthly Values (budget and actual amounts per item per month)
export const monthlyValues = pgTable('monthly_values', {
  id: serial('id').primaryKey(),
  itemId: integer('item_id').references(() => budgetItems.id, { onDelete: 'cascade' }).notNull(),
  month: integer('month').notNull(), // 1-12
  budget: decimal('budget', { precision: 12, scale: 2 }).notNull().default('0'),
  actual: decimal('actual', { precision: 12, scale: 2 }).notNull().default('0'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  // Unique constraint on (item_id, month) to enable upsert and prevent duplicates
  itemMonthUnique: uniqueIndex('monthly_values_item_month_unique').on(table.itemId, table.month),
}));

// Transactions
export const transactions = pgTable('transactions', {
  id: serial('id').primaryKey(),
  yearId: integer('year_id').references(() => budgetYears.id, { onDelete: 'cascade' }).notNull(),
  itemId: integer('item_id').references(() => budgetItems.id, { onDelete: 'set null' }), // nullable, can be unassigned
  date: date('date').notNull(),
  description: varchar('description', { length: 500 }),
  comment: varchar('comment', { length: 500 }),
  thirdParty: varchar('third_party', { length: 200 }),
  paymentMethod: varchar('payment_method', { length: 100 }),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  // Accounting month/year: when the transaction is accounted for (based on payment method's settlement day)
  // Can be manually overridden by user
  accountingMonth: integer('accounting_month').notNull(), // 1-12
  accountingYear: integer('accounting_year').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Payment Methods
export const paymentMethods = pgTable('payment_methods', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  isAccount: boolean('is_account').notNull().default(false),
  // Settlement day: day of month when billing cycle starts (1-31)
  // null means no threshold - use transaction date's month
  // e.g., settlementDay=18 means transactions from 18th of month N to 17th of month N+1 are billed in month N+1
  settlementDay: integer('settlement_day'),
  // Linked account: if set, transactions with this payment method affect the linked account's balance
  // e.g., TWINT linked to Checking Account means TWINT transactions reduce the Checking Account balance
  linkedPaymentMethodId: integer('linked_payment_method_id'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Account Balances (initial balance per account per year)
// accountType: 'savings_item' (budget item in savings group) | 'payment_method'
export const accountBalances = pgTable('account_balances', {
  id: serial('id').primaryKey(),
  yearId: integer('year_id').references(() => budgetYears.id, { onDelete: 'cascade' }).notNull(),
  accountType: varchar('account_type', { length: 20 }).notNull(), // 'savings_item' | 'payment_method'
  accountId: integer('account_id').notNull(), // references budget_items or payment_methods
  initialBalance: decimal('initial_balance', { precision: 12, scale: 2 }).notNull().default('0'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (table) => ({
  // Unique constraint on (year_id, account_type, account_id) to prevent duplicates and enable upsert
  yearAccountUnique: uniqueIndex('account_balances_year_account_unique').on(table.yearId, table.accountType, table.accountId),
}));

// Transfers (between accounts)
// sourceAccountType/destinationAccountType: 'payment_method' or 'savings_item'
export const transfers = pgTable('transfers', {
  id: serial('id').primaryKey(),
  yearId: integer('year_id').references(() => budgetYears.id, { onDelete: 'cascade' }).notNull(),
  date: date('date').notNull(),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  description: varchar('description', { length: 500 }),
  // Source account
  sourceAccountType: varchar('source_account_type', { length: 20 }).notNull(), // 'payment_method' | 'savings_item'
  sourceAccountId: integer('source_account_id').notNull(),
  // Destination account
  destinationAccountType: varchar('destination_account_type', { length: 20 }).notNull(), // 'payment_method' | 'savings_item'
  destinationAccountId: integer('destination_account_id').notNull(),
  // Optional: link to a savings item for budget tracking
  // If destination is a savings item, this defaults to that item
  // If source is a savings item (withdrawal), this links to that item
  savingsItemId: integer('savings_item_id').references(() => budgetItems.id, { onDelete: 'set null' }),
  // Accounting period
  accountingMonth: integer('accounting_month').notNull(),
  accountingYear: integer('accounting_year').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Settings
export const settings = pgTable('settings', {
  id: serial('id').primaryKey(),
  key: varchar('key', { length: 100 }).notNull().unique(),
  value: text('value'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Relations
export const budgetYearsRelations = relations(budgetYears, ({ many }) => ({
  groups: many(budgetGroups),
  items: many(budgetItems),
  transactions: many(transactions),
  transfers: many(transfers),
  accountBalances: many(accountBalances),
}));

export const accountBalancesRelations = relations(accountBalances, ({ one }) => ({
  year: one(budgetYears, {
    fields: [accountBalances.yearId],
    references: [budgetYears.id],
  }),
}));

export const budgetGroupsRelations = relations(budgetGroups, ({ one, many }) => ({
  year: one(budgetYears, {
    fields: [budgetGroups.yearId],
    references: [budgetYears.id],
  }),
  items: many(budgetItems),
}));

export const budgetItemsRelations = relations(budgetItems, ({ one, many }) => ({
  year: one(budgetYears, {
    fields: [budgetItems.yearId],
    references: [budgetYears.id],
  }),
  group: one(budgetGroups, {
    fields: [budgetItems.groupId],
    references: [budgetGroups.id],
  }),
  monthlyValues: many(monthlyValues),
  transactions: many(transactions),
}));

export const monthlyValuesRelations = relations(monthlyValues, ({ one }) => ({
  item: one(budgetItems, {
    fields: [monthlyValues.itemId],
    references: [budgetItems.id],
  }),
}));

export const transactionsRelations = relations(transactions, ({ one }) => ({
  year: one(budgetYears, {
    fields: [transactions.yearId],
    references: [budgetYears.id],
  }),
  item: one(budgetItems, {
    fields: [transactions.itemId],
    references: [budgetItems.id],
  }),
}));

export const transfersRelations = relations(transfers, ({ one }) => ({
  year: one(budgetYears, {
    fields: [transfers.yearId],
    references: [budgetYears.id],
  }),
  savingsItem: one(budgetItems, {
    fields: [transfers.savingsItemId],
    references: [budgetItems.id],
  }),
}));
