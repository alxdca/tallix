# Backend Guide

## Structure

- `backend/src/index.ts`: Express app setup and route registration.
- `backend/src/routes/*`: HTTP endpoints.
- `backend/src/services/*`: Business logic and database access.
- `backend/src/db/*`: Drizzle schema, db client, and RLS context helpers.
- `backend/src/middleware/*`: Auth, budget, and error handling.

## Request flow

1. `requireAuth` attaches the user to the request.
2. `requireBudget` resolves the budget and attaches it to the request.
3. A route handler validates input.
4. Service methods run inside `withTenantContext` for RLS.
5. Responses are serialized as JSON.

## Transactions and duplicate warnings

When creating a transaction, the service checks for possible duplicates based on:

- Third party match
- Amount within +/- 5 percent
- Date within +/- 1 day

If a match is found, the `warning` field is set. The UI can dismiss it by calling the dismiss endpoint.

## Assets and debts

Assets are stored in a dedicated table with an `isDebt` flag. The API accepts `isDebt` on creation to classify records.

## Error handling

Routes use `asyncHandler` and `AppError` to standardize responses. Unhandled errors are captured by `errorHandler`.

## Auth and budgets

Authentication uses JWT. The budget middleware ensures all budget-scoped routes are tied to a valid budget and year.

## Scripts

Key scripts:

- `pnpm -C backend db:migrate`: run migrations
- `pnpm -C backend check:rls`: static checks on unsafe DB access
- `pnpm -C backend rls:guard`: runtime guard allowlist validation
