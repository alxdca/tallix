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
- **Budgets**: Root entity per user with a start year.
- **Years**: Generated per budget year for planning and transactions.
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
