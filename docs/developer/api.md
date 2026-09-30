# API Reference

All endpoints are under `/api`. Most require authentication and budget context.

## Auth

- `POST /api/auth/login`
- `POST /api/auth/register`
- `GET /api/auth/me`
- `GET /api/auth/setup`
- `POST /api/auth/change-password`

## Yearly budgets and sharing

- `GET /api/budgets` — list accessible yearly budgets with `year`, role and owner details.
- `POST /api/budgets` — create an owned budget with `{ year, description?, parentBudgetId? }`; returns the selected budget shape, including `parentBudgetId`. Years must be integers from 1900 through 9999. The optional parent must be owned by the caller and be from the immediately previous year. Its category structure is copied without planned amounts or transactions. Each child opening account balance follows the parent's computed December balance until explicitly overridden in the child; deleting the parent freezes the latest effective balances.
- `DELETE /api/budgets/:budgetId` — permanently delete an owned budget and its budget-scoped data; returns `{ budgets, defaultBudgetId }`. Payment methods are retained. If no owned budget remains, a new empty default budget is created atomically. The path ID selects the target independently of `X-Budget-Id`. Collaborators receive 403; nonexistent or inaccessible budgets receive 404.
- `GET /api/budgets/current/shares`
- `POST /api/budgets/current/shares` — grant access by `{ email, role: "read" | "write" }`.
- `PUT /api/budgets/current/shares/:shareId`
- `DELETE /api/budgets/current/shares/:shareId`

Use `X-Budget-Id` to select the budget for data and sharing endpoints. Share management is owner-only.
Each budget has one year; requests for another year return 404. Multiple budgets may use the same year.

## Budget

- `GET /api/budget` (selected budget year)
- `GET /api/budget/year/:year`
- `GET /api/budget/summary?year=:year` (selected budget year)
- `GET /api/budget/years`
- `PUT /api/budget/years/:id`
- `GET /api/budget/months`
- `POST /api/budget/groups`
- `PUT /api/budget/groups/reorder`
- `PUT /api/budget/groups/:id`
- `DELETE /api/budget/groups/:id`
- `POST /api/budget/items`
- `PUT /api/budget/items/move`
- `PUT /api/budget/items/reorder`
- `PUT /api/budget/items/:id`
- `DELETE /api/budget/items/:id`
- `PUT /api/budget/items/:itemId/months/:month`
- `GET /api/budget/start-year`

`POST /api/budget/years` and `PUT /api/budget/start-year` return 410. Create a separate budget using `POST /api/budgets`.

## Transactions

- `GET /api/transactions`
- `GET /api/transactions/year/:year`
- `GET /api/transactions/third-parties`
- `POST /api/transactions`
- `PUT /api/transactions/:id`
- `POST /api/transactions/:id/dismiss-warning`
- `DELETE /api/transactions/bulk`
- `DELETE /api/transactions/:id`

## Transfers

- `GET /api/transfers/:year`
- `GET /api/transfers/:year/accounts`
- `POST /api/transfers/:year`
- `PUT /api/transfers/:id`
- `DELETE /api/transfers/:id`

## Payment methods

- `GET /api/payment-methods`
- `POST /api/payment-methods`
- `PUT /api/payment-methods/reorder`
- `PUT /api/payment-methods/:id`
- `DELETE /api/payment-methods/:id`

## Accounts

- `GET /api/accounts/:year`
- `PUT /api/accounts/:year/balance`
- `PUT /api/accounts/payment-method/:id/savings`

## Assets

- `GET /api/assets`
- `POST /api/assets`
- `PUT /api/assets/:id/value`
- `DELETE /api/assets/:id`
- `PUT /api/assets/reorder`

## Import

- `POST /api/import/pdf`
- `POST /api/import/pdf-llm`
- `POST /api/import/bulk`
- `GET /api/import/llm-status`
- `POST /api/import/classify`

## Settings

- `GET /api/settings`
- `GET /api/settings/:key`
- `PUT /api/settings/:key`
- `DELETE /api/settings/:key`

## Health

- `GET /api/health`
