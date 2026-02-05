# Frontend Guide

## Structure

- `frontend/src/App.tsx`: top-level routing and data loading.
- `frontend/src/components/*`: views and shared UI components.
- `frontend/src/api.ts`: REST client.
- `frontend/src/contexts/*`: auth, i18n, settings.
- `frontend/src/styles/index.css`: global styles.

## Data loading

The app loads:

- Current year budget and groups.
- Archive data for past years when requested.
- Transactions, accounts, assets, and settings as needed.

## Internationalization

- `I18nContext` handles language selection.
- All UI strings are defined in `frontend/src/i18n.ts`.

## Settings and preferences

`SettingsContext` manages theme, decimal separator, and budget display preferences.

## Assets view

Assets are split into Assets, Debts, and Net Worth tables. Account-derived rows appear as system rows and are read only for the current year.

## Transactions view

Transactions highlight potential duplicates with a row background. The dismiss button clears the warning.
