# Multi-user Supabase Migration Plan

This app now treats `household-finance` as the single production codebase. Firebase/Firestore plans are replaced by Supabase Auth, Postgres, and Row Level Security.

## Implemented In Code

- Google OAuth entry point on `/flow/setup` (login is mandatory — the old "skip login" bypass has been removed)
- Cookie-based Supabase session via `@supabase/ssr` (`lib/supabase/client.ts`, `lib/supabase/server.ts`, `lib/supabase/middleware.ts`)
- `proxy.ts` (Next.js 16's replacement for `middleware.ts`) redirects unauthenticated users away from `/dashboard`, `/transactions`, `/cashflow`, `/investments`, `/input`, `/assets` to `/flow/setup`
- Server-side session verification helper in `lib/auth.ts` (`getAuthenticatedUser`), supporting both cookie sessions and `Authorization: Bearer <token>`
- Auth inspection route at `/api/auth/me`
- Every data Route Handler (`transactions`, `scheduled-payments`, `stocks`, `cashflow`, `analysis/fixed-variable`, `parse-chat`) now calls `getAuthenticatedUser`, returns `401` when missing, and scopes reads/writes to `user_id`
- RLS migration draft at `supabase/migrations/001_multi_user_rls.sql`
- Environment variable template in `.env.example`

`.env.local` is not present in this environment, so Supabase is still running against placeholder values — none of the above can be exercised end-to-end until the dashboard setup below is done.

## Required Supabase Dashboard Setup

1. Create a Supabase project (or use an existing one) and enable the **Google** provider under Authentication → Sign In / Providers.
2. In Google Cloud Console, create an OAuth 2.0 Client ID (Web application) and set **Authorized redirect URIs** to the Supabase-managed callback — this must be the Supabase URL, not the app's own page:
   - `https://<your-project-ref>.supabase.co/auth/v1/callback`
   - Paste the resulting Client ID / Client Secret into Supabase's Google provider settings.
3. In Supabase → Authentication → URL Configuration, set:
   - **Site URL**: your production URL, e.g. `https://household-finance-smoky.vercel.app`
   - **Redirect URLs** (allow-list, one per line): the app pages the browser is sent back to after login —
     - `https://household-finance-smoky.vercel.app/flow/setup`
     - `http://localhost:3000/flow/setup` (local development)

   (Note: the previous version of this doc conflated this with the Google Cloud redirect URI — those are two different settings and mixing them up causes a `redirect_uri_mismatch` error from Google.)
4. Add environment variables (Vercel + local `.env.local`):
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (server-only, never exposed to the client)
   - `NEXT_PUBLIC_ENABLE_GOOGLE_AUTH=true` (the login button stays disabled until this is set)
5. Run `supabase/migrations/001_multi_user_rls.sql` in the Supabase SQL Editor after taking a backup.

## Data Backfill Warning

Existing production rows do not yet have a `user_id`. Before enforcing RLS for real users, backfill existing rows to the correct `auth.users.id`.

Example:

```sql
update transactions set user_id = '<your-auth-user-id>' where user_id is null;
update scheduled_payments set user_id = '<your-auth-user-id>' where user_id is null;
update account_balance set user_id = '<your-auth-user-id>' where user_id is null;
update stock_holdings set user_id = '<your-auth-user-id>' where user_id is null;
```

Because the API layer now filters every query by `user_id`, any pre-existing rows with a `null` user_id will simply stop appearing once auth is enforced — run the backfill above before real users log in, or that data will look like it "disappeared".

## Remaining Work (Not Done By This Pass)

- The onboarding wizard (`components/FlowSetupWizard.tsx`, steps after login) still uses hardcoded placeholder values for balance / income / fixed costs / card cycles — it does not persist anything yet. Wiring it up to `POST /api/cashflow/balance`, `scheduled_payments`, etc. is a separate follow-up.
- `credit_cards` and other tables defined in the RLS migration have no Route Handlers yet.
