# Row-Level Security (RLS) Documentation

This directory contains comprehensive documentation for the multi-tenant Row-Level Security implementation.

## 📖 Documentation

### For Developers

**[RLS Enforcement Guide](RLS_ENFORCEMENT_GUIDE.md)** - Start here!
- Rules and patterns for day-to-day development
- How to add new services, routes, and tables
- Common mistakes and how to avoid them
- Verification and testing guide
- rawDb allowlist documentation

### For Architecture & Security Review

**[RLS Implementation](RLS_IMPLEMENTATION.md)** - Deep dive
- Complete security architecture
- Context management system
- RLS policy coverage and details
- Runtime guard implementation
- Database role requirements
- Defense-in-depth strategy

## 🔍 Quick Reference

### Security Layers

The application implements 4 defensive layers:

1. **Static Analysis** - Guard scripts fail CI if rawDb used incorrectly
2. **Runtime Guard** - Proxy wrapper prevents db access without context
3. **Application Logic** - Explicit userId/budgetId checks in services
4. **RLS Policies** - PostgreSQL-level enforcement (last line of defense)

### Key Commands

```bash
# Check RLS service imports
cd backend && pnpm check:rls

# Check rawDb allowlist
cd backend && pnpm rls:guard

# Run RLS enforcement tests
cd backend && pnpm test:rls

# Run all tests
cd backend && pnpm test
```

### Critical Files

- `backend/src/db/context.ts` - Context wrappers (withTenantContext, withUserContext)
- `backend/src/db/index.ts` - Runtime guard implementation
- `backend/drizzle/0013_enable_rls.sql` - Initial RLS policies
- `backend/drizzle/0014_harden_rls_policies.sql` - Hardened policies with authorization
- `backend/drizzle/0015_narrow_auth_policy.sql` - Narrowed auth bypass

## 🎯 Related Tickets

Implementation history:
- TICKET-014: Runtime guard
- TICKET-015: Enforce safe DB role
- TICKET-016: Budget authorization in RLS
- TICKET-017: Settings RLS coverage
- TICKET-018: Payment methods ownership guards
- TICKET-019: Remove global DB fallback
- TICKET-020: Tighten auth RLS bypass
- TICKET-021: rawDb guardrail

See `TICKETS/` directory for detailed implementation documentation.
