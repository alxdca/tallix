# Architecture Overview

Tallix is a single-page application with a REST backend and a Postgres database. Data is multi-tenant and protected with RLS.

## High level components

- **Frontend**: React + Vite, responsible for UI and client-side state.
- **Backend**: Express + TypeScript, exposes REST endpoints.
- **Database**: Postgres with Drizzle ORM and row-level security policies.

## Tenancy model

- Each user has one or more budgets.
- Most routes are scoped to the current budget via `requireBudget` middleware.
- Database access uses `withTenantContext` to set user and budget context for RLS.

## Core entities

- **Users**: Authentication and profile preferences.
- **Budgets**: Named, independently shareable root entities. Each owner may have multiple budgets, such as Family and Personal; access covers every year within a budget.
- **Years**: Multiple rows per budget, unique by `(budget_id, year)`, for planning and transactions. `start_year` retains the initial-year metadata.
- **Budget groups/items**: Categories for income and expenses.
- **Payment methods**: Accounts or cards with optional institution and savings flags.
- **Transactions**: Individual financial events.
- **Transfers**: Money movement between accounts.
- **Assets**: Multi-year assets and debts with optional system rows.

## Data flow

1. UI triggers API calls via `frontend/src/api.ts`.
2. Backend routes validate input and use services to execute logic.
3. Services use Drizzle queries with RLS context wrappers.
4. Results are returned to the UI and stored in component state.

## Security

- Row-level security is enforced at the database level.
- Guard scripts and runtime checks prevent accidental bypass.
- See `docs/rls` for details.
