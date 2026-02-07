# Deployment Guide

This guide covers the standard deployment flow for Tallix.

## Build

From the repo root:

```bash
pnpm -C backend build
pnpm -C frontend build
```

## Run backend

Provide required env vars:

- `DATABASE_URL` (or DB host/user/password vars in `.env`)
- `JWT_SECRET` (random secret, minimum 32 characters in production/staging)
- `CORS_ORIGIN`
- `MODE=demo` (optional)
- `DEEPSEEK_API_KEY` (optional)

Then start:

```bash
pnpm -C backend start
```

## Serve frontend

The frontend build output lives in `frontend/dist`. Serve it with any static server or a CDN.

## Docker

- `docker-compose.yml` for local development.
- `docker-compose.prod.yml` for production-oriented setup.

## Database role safety

The backend checks for RLS-safe database roles at startup. Do not use a superuser or a role with BYPASSRLS in production. To override locally:

```
ALLOW_UNSAFE_DB_ROLE=true
```
