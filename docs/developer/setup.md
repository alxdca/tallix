# Setup

This guide covers local development setup for Tallix.

## Prerequisites

- Node.js 20+
- pnpm 9+
- PostgreSQL 16 (or Docker)

## Install dependencies

From the repo root:

```bash
pnpm install
```

## Environment variables

Tallix reads environment variables from two places:

- Root `.env` (shared)
- `backend/.env` (backend specific)

Start by copying the example file if available:

```bash
cp .env.example .env
```

Then create `backend/.env` with at least:

```env
NODE_ENV=development
DATABASE_URL=postgresql://user:password@localhost:5432/tallix
# Local dev only; production/staging must use a random 32+ char secret
JWT_SECRET=local-dev-jwt-secret
CORS_ORIGIN=http://localhost:5173
```

Generate a production secret with:

```bash
openssl rand -base64 48
```

Optional:

```env
DEEPSEEK_API_KEY=your_key_here
DEEPSEEK_API_URL=https://api.deepseek.com/v1
LOG_LEVEL=info
DEBUG_LOG_BODY=false
```

## Start the database

```bash
docker-compose up -d
```

## Run migrations

```bash
pnpm -C backend db:migrate
```

## Start backend and frontend

```bash
pnpm -C backend dev
```

In another terminal:

```bash
pnpm -C frontend dev
```

The frontend runs on port 5173 and the backend on port 3001 by default.

## Demo mode

Set `MODE=demo` in `backend/.env` to seed a demo user at startup.
