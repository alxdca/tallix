# Deployment

This project ships as a Node backend and a static frontend bundle.

## Docker (local or production)

- `docker-compose.yml` is for local development.
- `docker-compose.prod.yml` is for production.

Typical flow:

```bash
pnpm -C backend build
pnpm -C frontend build
```

Serve the frontend build with a static server and run the backend with the proper env vars.

## Environment variables

Ensure the following are set:

- `DATABASE_URL` (or DB host/user/password vars in `.env`)
- `JWT_SECRET`
- `CORS_ORIGIN`
- `MODE=demo` (optional)
- `DEEPSEEK_API_KEY` (optional)

## Database role safety

The backend checks that the DB role cannot bypass RLS. In production, do not use a superuser or a role with BYPASSRLS.

To override locally:

```
ALLOW_UNSAFE_DB_ROLE=true
```
