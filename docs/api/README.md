# API Documentation

This document summarizes the REST API surface. For endpoint details, see `docs/developer/api.md`.

## Base URL

All endpoints are under `/api`.

## Auth

- `POST /api/auth/login`
- `POST /api/auth/register`
- `GET /api/auth/me`
- `GET /api/auth/setup`
- `POST /api/auth/change-password`

## Budget

- `GET /api/budget` (current year)
- `GET /api/budget/year/:year`
- `GET /api/budget/summary`
- `GET /api/budget/years`
- `POST /api/budget/years`
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
- `PUT /api/budget/start-year`

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
