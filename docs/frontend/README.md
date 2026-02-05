# Frontend Architecture

This document summarizes how the frontend is structured and how data flows through the UI.

## Structure

- `frontend/src/App.tsx`: top-level view switching and data loading.
- `frontend/src/components/*`: page components and shared UI pieces.
- `frontend/src/api.ts`: REST client used across the app.
- `frontend/src/contexts/*`: Auth, i18n, and settings contexts.
- `frontend/src/styles/index.css`: global styles.

## View model

- The app loads current-year budget data on startup.
- Archive views load a separate year without changing the current-year selector.
- Transactions, accounts, assets, and settings fetch data on demand.

## Internationalization

Strings are defined in `frontend/src/i18n.ts` and accessed via `I18nContext`.

## Key views

- **Transactions**: add/edit/delete, duplicate warnings, bulk actions.
- **Budget Planning**: monthly and yearly budgets per item.
- **Accounts**: balances per payment method.
- **Assets**: split tables for assets, debts, and net worth.
- **Settings**: categories, accounts, and preferences.
