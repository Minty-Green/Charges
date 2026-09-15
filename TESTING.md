# Mintygreen Charges — Regression Test Workflow

This branch introduces a lightweight automated smoke check before future changes are merged to `main`.

## Automated smoke check

Run from the repository root:

```bash
node scripts/smoke-check.mjs
node scripts/login-audit-check.mjs
```

The check is dependency-free and validates the current `index.html` for the most important application safeguards, including:

- Supabase / Turnstile / PWA wiring
- no public sign-up flow
- authentication and login-audit code paths
- Staff / Admin / Super Admin role wiring
- branch-switch state clearing
- branch-aware export labelling
- resident-level billing-cycle locking code
- recurring charge and Special Month code paths
- permanent recurring price history
- Package / Service / Machine Rental read-only safeguards
- Daily Entry and Master Calendar code paths
- Residents, Items, Staff, Audit and Backup sections
- Excel/PDF export code paths
- duplicate HTML IDs
- unresolved static `$('<id>')` references
- missing inline `onclick` function handlers
- inline JavaScript syntax parsing

A non-zero exit code means the branch should not be merged until the failed check has been reviewed.

The focused login-audit regression check verifies that successful-login writes retry after transient failures, remain queued after a longer outage, and treat an idempotent duplicate as safely recorded.

## Manual release checklist

The automated smoke check does not replace role-based browser testing. Before merging a meaningful billing/security change, verify:

1. **Staff** — can save a normal stock entry in their own branch.
2. **Staff** — cannot modify a locked resident/cycle.
3. **Admin** — can close and reopen one resident without affecting another resident.
4. **Admin** — Monthly Packages, Special Month and permanent price changes work on unlocked residents and are blocked on locked residents.
5. **Admin** — Residents, Items, Staff, Audit and Backups load for the correct branch only.
6. **Super Admin** — switching branches refreshes all branch-specific views and exports carry the selected branch name.
7. **Daily Entry + Master Calendar** — Package, Service and Machine Rental remain read-only to prevent accidental double charging.
8. **Excel + PDF** — resident totals, recurring totals and grand total match the screen.
9. **Authentication** — normal sign-in/sign-out, Forgot Password and Settings remain accessible.
10. **Mobile** — Daily Entry, navigation drawer and branch/account controls remain usable.

## Production rule

Do not develop directly on `main`. Use a working branch, run the smoke check, perform the relevant manual tests, then merge only after the branch is confirmed stable.
