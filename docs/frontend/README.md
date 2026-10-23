# Frontend Architecture

This document summarizes how the frontend is structured and how data flows through the UI.

## Structure

- `frontend/src/App.tsx`: top-level view switching and data loading.
- `frontend/src/components/*`: page components and shared UI pieces.
- `frontend/src/api.ts`: REST client used across the app.
- `frontend/src/contexts/*`: Auth, i18n, and settings contexts.
- `frontend/src/styles/index.css`: global styles.

## View model

- The app loads the selected budget and remembers its selected year.
- Transactions contains two sidebar subpages: Transactions and Transfers.
- Each subpage owns its form, list, filters, selection, editing, and data refreshes. Switching subpages resets local drafts and selection; changing the budget or year remounts the current view.
- Transactions, transfers, accounts, assets, and settings fetch data on demand.

## Internationalization

Strings are defined in `frontend/src/i18n.ts` and accessed via `I18nContext`.

## Key views

- **Transactions**: transaction add/edit/delete, categories, comments, imports, duplicate warnings, and bulk actions.
- **Transfers**: account-to-account transfers, separate source/destination accounting periods, account filters, savings movement, and bulk actions. Both subpages reuse the typed reorder API while ordering records within their own domain.
- **Budget Planning**: monthly and yearly budgets per item.
- **Accounts**: balances per payment method.
- **Assets**: split tables for assets, debts, and net worth.
- **Settings**: categories, accounts, and preferences.
