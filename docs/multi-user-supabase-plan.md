# Multi-user Supabase Migration Plan

This app now treats `household-finance` as the single production codebase. Firebase/Firestore plans are replaced by Supabase Auth, Postgres, and Row Level Security.

## Implemented In Code

- Google OAuth entry point on `/flow/setup`
- Auth session fallback for local mock mode when Supabase env vars are missing
- Server-side bearer-token user verification helper in `lib/auth.ts`
- Auth inspection route at `/api/auth/me`
- RLS migration draft at `supabase/migrations/001_multi_user_rls.sql`
- Environment variable template in `.env.example`

## Required Supabase Dashboard Setup

1. Enable Google provider in Supabase Auth.
2. Add this callback URL in Google Cloud OAuth and Supabase:
   - `https://household-finance-smoky.vercel.app/flow/setup`
   - local development URL if needed, such as `http://localhost:3000/flow/setup`
3. Add Vercel environment variables:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
4. Run `supabase/migrations/001_multi_user_rls.sql` in Supabase SQL Editor after a backup.

## Data Backfill Warning

Existing production rows do not yet have a `user_id`. Before enforcing RLS for real users, backfill existing rows to the correct `auth.users.id`.

Example:

```sql
update transactions set user_id = '<your-auth-user-id>' where user_id is null;
update scheduled_payments set user_id = '<your-auth-user-id>' where user_id is null;
update account_balance set user_id = '<your-auth-user-id>' where user_id is null;
update stock_holdings set user_id = '<your-auth-user-id>' where user_id is null;
```

After backfill, user-specific API routes can be switched from `supabaseAdmin` to authenticated user-scoped queries.

## Next Implementation Step

Update each Route Handler to require auth and never accept `user_id` from the client:

1. Read the user with `getAuthenticatedUser(request)`.
2. Return `401` when missing.
3. Add `.eq('user_id', user.id)` to reads.
4. Insert `{ ...body, user_id: user.id }` on writes.
5. Keep `SUPABASE_SERVICE_ROLE_KEY` server-only.
