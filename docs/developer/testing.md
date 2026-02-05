# Testing

## Backend tests

```bash
pnpm -C backend test
```

RLS-specific checks:

```bash
pnpm -C backend check:rls
pnpm -C backend rls:guard
```

## Frontend tests

```bash
pnpm -C frontend test
```

## Notes

- Backend tests use Vitest.
- If `node` is not on PATH, Vitest may fail to run from scripts.
- Use `pnpm -C backend exec vitest --run` as a fallback.
