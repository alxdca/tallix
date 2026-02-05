import { relations } from 'drizzle-orm';
import {
  boolean,
  date,
  decimal,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

// Users
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  name: varchar('name', { length: 255 }),
  language: varchar('language', { length: 10 }).default('fr').notNull(),
  country: varchar('country', { length: 2 }), // ISO 3166-1 alpha-2 country code
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Budgets (the main container for multi-year accounting)
export const budgets = pgTable('budgets', {
  id: serial('id').primaryKey(),
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  description: varchar('description', { length: 500 }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Budget Shares (grant access to other users)
// role: 'reader' (view only) | 'writer' (add transactions) | 'admin' (edit categories)
// The budget owner (budgets.user_id) always has full access
export const budgetShares = pgTable(
  'budget_shares',
  {
    id: serial('id').primaryKey(),
    budgetId: integer('budget_id')
      .references(() => budgets.id, { onDelete: 'cascade' })
      .notNull(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    role: varchar('role', { length: 20 }).notNull(), // 'reader' | 'writer' | 'admin'
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    // Each user can only have one share per budget
    budgetUserUnique: uniqueIndex('budget_shares_budget_user_unique').on(table.budgetId, table.userId),
  })
);

// Budget Years (individual years within a budget)
export const budgetYears = pgTable(
  'budget_years',
  {
    id: serial('id').primaryKey(),
    budgetId: integer('budget_id')
      .references(() => budgets.id, { onDelete: 'cascade' })
      .notNull(),
    year: integer('year').notNull(),
    initialBalance: decimal('initial_balance', { precision: 12, scale: 2 }).notNull().default('0'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    // Unique constraint on (budget_id, year) - each budget can have one entry per year
    budgetYearUnique: uniqueIndex('budget_years_budget_year_unique').on(table.budgetId, table.year),
  })
);

// Budget Groups (categories like REVENUS, MAISON, etc.)
// type: 'income' | 'expense'
// Groups are per-budget and shared across all years within that budget
export const budgetGroups = pgTable(
  'budget_groups',
  {
    id: serial('id').primaryKey(),
    budgetId: integer('budget_id')
      .references(() => budgets.id, { onDelete: 'cascade' })
      .notNull(),
    name: varchar('name', { length: 100 }).notNull(),
    slug: varchar('slug', { length: 100 }).notNull(),
    type: varchar('type', { length: 20 }).notNull().default('expense'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    // Unique constraint on (budget_id, slug) to prevent duplicate slugs within a budget
    budgetSlugUnique: uniqueIndex('budget_groups_budget_slug_unique').on(table.budgetId, table.slug),
  })
);

// Budget Items (individual line items within groups)
export const budgetItems = pgTable(
  'budget_items',
  {
    id: serial('id').primaryKey(),
    yearId: integer('year_id')
      .references(() => budgetYears.id, { onDelete: 'cascade' })
      .notNull(),
    groupId: integer('group_id').references(() => budgetGroups.id, { onDelete: 'set null' }), // nullable for unassigned items
    name: varchar('name', { length: 200 }).notNull(),
    slug: varchar('slug', { length: 200 }).notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    // Yearly budget for irregular/variable spending (e.g., vacations, restaurants)
    // This is in addition to monthly budgets - some items may have both
    yearlyBudget: decimal('yearly_budget', { precision: 12, scale: 2 }).notNull().default('0'),
    // Link to savings account (payment method) - for auto-generated savings budget items
    savingsAccountId: integer('savings_account_id').references(() => paymentMethods.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    // Unique constraint on (year_id, group_id, slug) to prevent duplicate slugs within a group
    // Note: This only applies when group_id is not null (partial index in migration)
    yearGroupSlugUnique: uniqueIndex('budget_items_year_group_slug_unique').on(table.yearId, table.groupId, table.slug),
  })
);

// Monthly Values (budget and actual amounts per item per month)
export const monthlyValues = pgTable(
  'monthly_values',
  {
    id: serial('id').primaryKey(),
    itemId: integer('item_id')
      .references(() => budgetItems.id, { onDelete: 'cascade' })
      .notNull(),
    month: integer('month').notNull(), // 1-12
    budget: decimal('budget', { precision: 12, scale: 2 }).notNull().default('0'),
    actual: decimal('actual', { precision: 12, scale: 2 }).notNull().default('0'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    // Unique constraint on (item_id, month) to enable upsert and prevent duplicates
    itemMonthUnique: uniqueIndex('monthly_values_item_month_unique').on(table.itemId, table.month),
  })
);

// Transactions
export const transactions = pgTable('transactions', {
  id: serial('id').primaryKey(),
  yearId: integer('year_id')
    .references(() => budgetYears.id, { onDelete: 'cascade' })
    .notNull(),
  itemId: integer('item_id').references(() => budgetItems.id, { onDelete: 'set null' }), // nullable, can be unassigned
  date: date('date').notNull(),
  description: varchar('description', { length: 500 }),
  comment: varchar('comment', { length: 500 }),
  thirdParty: varchar('third_party', { length: 200 }),
  // Payment method ID (foreign key to payment_methods table)
  paymentMethodId: integer('payment_method_id')
    .references(() => paymentMethods.id, { onDelete: 'restrict' })
    .notNull(),
  // Legacy payment method string (deprecated, kept for backwards compatibility)
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
  userId: uuid('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  // Institution name (e.g., bank name, card issuer)
  institution: varchar('institution', { length: 100 }),
  sortOrder: integer('sort_order').notNull().default(0),
  // Is this payment method a trackable account (shows in Accounts view)
  isAccount: boolean('is_account').notNull().default(false),
  // Is this a savings account (e.g., money market, term deposit)
  isSavingsAccount: boolean('is_savings_account').notNull().default(false),
  // Savings type stored in the database
  savingsType: varchar('savings_type', { length: 20 }),
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
// Accounts are payment methods with isAccount=true
export const accountBalances = pgTable(
  'account_balances',
  {
    id: serial('id').primaryKey(),
    yearId: integer('year_id')
      .references(() => budgetYears.id, { onDelete: 'cascade' })
      .notNull(),
    paymentMethodId: integer('payment_method_id')
      .references(() => paymentMethods.id, { onDelete: 'cascade' })
      .notNull(),
    initialBalance: decimal('initial_balance', { precision: 12, scale: 2 }).notNull().default('0'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    // Unique constraint on (year_id, payment_method_id) to prevent duplicates and enable upsert
    yearAccountUnique: uniqueIndex('account_balances_year_payment_method_unique').on(
      table.yearId,
      table.paymentMethodId
    ),
  })
);

// Transfers (between accounts)
// Accounts are payment methods with isAccount=true
export const transfers = pgTable('transfers', {
  id: serial('id').primaryKey(),
  yearId: integer('year_id')
    .references(() => budgetYears.id, { onDelete: 'cascade' })
    .notNull(),
  date: date('date').notNull(),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  description: varchar('description', { length: 500 }),
  // Source account (payment method with isAccount=true)
  sourceAccountId: integer('source_account_id')
    .references(() => paymentMethods.id, { onDelete: 'cascade' })
    .notNull(),
  // Destination account (payment method with isAccount=true)
  destinationAccountId: integer('destination_account_id')
    .references(() => paymentMethods.id, { onDelete: 'cascade' })
    .notNull(),
  // Accounting period
  accountingMonth: integer('accounting_month').notNull(),
  accountingYear: integer('accounting_year').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

// Settings (per-user)
export const settings = pgTable(
  'settings',
  {
    id: serial('id').primaryKey(),
    userId: uuid('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    key: varchar('key', { length: 100 }).notNull(),
    value: text('value'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    // Unique constraint on (user_id, key) - each user can have one value per setting key
    userKeyUnique: uniqueIndex('settings_user_key_unique').on(table.userId, table.key),
  })
);

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  budgets: many(budgets),
  budgetShares: many(budgetShares),
  paymentMethods: many(paymentMethods),
  settings: many(settings),
}));

export const budgetsRelations = relations(budgets, ({ one, many }) => ({
  user: one(users, {
    fields: [budgets.userId],
    references: [users.id],
  }),
  shares: many(budgetShares),
  years: many(budgetYears),
  groups: many(budgetGroups),
}));

export const budgetSharesRelations = relations(budgetShares, ({ one }) => ({
  budget: one(budgets, {
    fields: [budgetShares.budgetId],
    references: [budgets.id],
  }),
  user: one(users, {
    fields: [budgetShares.userId],
    references: [users.id],
  }),
}));

export const budgetYearsRelations = relations(budgetYears, ({ one, many }) => ({
  budget: one(budgets, {
    fields: [budgetYears.budgetId],
    references: [budgets.id],
  }),
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
  paymentMethod: one(paymentMethods, {
    fields: [accountBalances.paymentMethodId],
    references: [paymentMethods.id],
  }),
}));

export const budgetGroupsRelations = relations(budgetGroups, ({ one, many }) => ({
  budget: one(budgets, {
    fields: [budgetGroups.budgetId],
    references: [budgets.id],
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
  paymentMethodRel: one(paymentMethods, {
    fields: [transactions.paymentMethodId],
    references: [paymentMethods.id],
  }),
}));

export const transfersRelations = relations(transfers, ({ one }) => ({
  year: one(budgetYears, {
    fields: [transfers.yearId],
    references: [budgetYears.id],
  }),
  sourceAccount: one(paymentMethods, {
    fields: [transfers.sourceAccountId],
    references: [paymentMethods.id],
    relationName: 'sourceAccount',
  }),
  destinationAccount: one(paymentMethods, {
    fields: [transfers.destinationAccountId],
    references: [paymentMethods.id],
    relationName: 'destinationAccount',
  }),
}));

export const paymentMethodsRelations = relations(paymentMethods, ({ one }) => ({
  user: one(users, {
    fields: [paymentMethods.userId],
    references: [users.id],
  }),
}));

export const settingsRelations = relations(settings, ({ one }) => ({
  user: one(users, {
    fields: [settings.userId],
    references: [users.id],
  }),
}));
