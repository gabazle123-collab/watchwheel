# WatchWheel — Auth & Digest Reference

## Overview

WatchWheel uses **Supabase Auth** (email + password) for user accounts. The frontend is a vanilla JS SPA on Vercel; the backend is an Express server on Render. Auth state flows like this:

```
User signs up / signs in
  → Supabase issues a JWT access token
  → Frontend stores the session (supabase-js handles it in localStorage)
  → All protected API calls send:  Authorization: Bearer <access_token>
  → Render backend verifies the token with supabase.auth.getUser(token)
```

---

## Auth state in the frontend (`frontend/script.js`)

The global `state` object holds everything:

| Field | What it is |
|---|---|
| `state.session` | Supabase session object (has `.access_token`) |
| `state.user` | Supabase auth user (`id`, `email`) |
| `state.profile` | Row from `public.profiles` (username, digest settings, etc.) |

### Lifecycle hooks

- **`onAuthStateChange`** — fires on sign-in, sign-out, token refresh. The handler at the bottom of `script.js` is the single source of truth for routing:
  - `SIGNED_IN` → load profile → if no Letterboxd username → wizard, else home
  - `SIGNED_OUT` → clear state, show auth-entry screen
- **`boot()`** — runs once on page load; calls `supabase.auth.getSession()` to pick up a persisted session.

### Adding a new protected screen

1. Add the screen HTML in `index.html` (follow the existing `<section id="…">` pattern).
2. Add its ID to the `ALL_SCREENS` array in `script.js`.
3. Call `show('your-screen-id')` to navigate to it.
4. Gate it: check `state.session` before calling `show()`. If no session, redirect to `show('auth-entry')`.
5. For data from the backend, use `apiFetch('/api/your-endpoint')` — it automatically attaches the Bearer token.

### `apiFetch(path, options)`

Wrapper around `fetch` that:
- Prepends `BACKEND_URL` (set at the top of `script.js`)
- Adds `Authorization: Bearer <access_token>` from `state.session`
- Returns the parsed JSON response

---

## Auth state in the backend (`backend/server.js`)

### `requireAuth` middleware

Validates the JWT via the Supabase service-role client:

```js
const { data: { user }, error } = await supabase.auth.getUser(token);
```

On success, sets `req.user` (the Supabase auth user object, including `req.user.id`).

### Adding a new protected endpoint

```js
app.get('/api/my-thing', requireAuth, async (req, res) => {
  // req.user.id is the verified user UUID
  const { data } = await supabase.from('my_table').select('*').eq('user_id', req.user.id);
  res.json(data);
});
```

### Environment variables required on Render

| Variable | Purpose |
|---|---|
| `SUPABASE_URL` | Your Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (never expose in frontend) |

---

## Database schema (`supabase/schema.sql`)

| Table | Purpose |
|---|---|
| `public.profiles` | One row per user. Created automatically by trigger on `auth.users` insert. Holds Letterboxd username, digest settings, digest counter. |
| `public.film_history` | Every film served to a signed-in user (app picks + digest). |
| `public.digest_sends` | One row per digest email sent. Stores the array of film URLs served, used for the 14-day repeat window. |
| `public.film_metadata_cache` | Cached runtime (minutes) + poster URL per Letterboxd film URL. Populated lazily by the `/poster` backend endpoint. |

All user-facing tables have **Row Level Security** enabled. Users can only read and write their own rows.

---

## Daily email digest

### How it works

1. **pg_cron** (`supabase/cron.sql`) fires every hour at `:00` and calls the `send-digest` Edge Function via `net.http_post`.
2. The Edge Function (`supabase/functions/send-digest/index.ts`):
   - Fetches all opted-in profiles with a Letterboxd username.
   - Filters to users whose **local hour** (using `Intl.DateTimeFormat` with their stored timezone) matches their `digest_hour`.
   - For each due user: fetches their watchlist from Render → picks 5 films → sends via Resend.
3. After sending, it inserts a `digest_sends` row and increments `profiles.digest_count`.

### Film-picking algorithm

- Excludes films served in the last 14 days (from `digest_sends`).
- Constraint 1: at least 1 film from before 1990.
- Constraint 2: at least 1 short film (<90 min) — only applied when runtime is already cached; skipped gracefully otherwise.
- Fills remaining slots from the open pool.
- Shuffles the final 5 so constraints aren't always first.

### Runtime data

Runtimes are scraped **lazily** from Letterboxd film pages (JSON-LD `duration` field, ISO 8601 format like `PT2H15M`) whenever the `/poster` endpoint is called. They're stored in `film_metadata_cache` and reused by the digest without hitting Letterboxd again.

### Edge Function secrets (set in Supabase dashboard)

| Secret | Purpose |
|---|---|
| `RESEND_API_KEY` | Resend transactional email API key |
| `CRON_SECRET` | Shared secret between pg_cron and the Edge Function (any random string) |
| `RENDER_API_URL` | Your Render backend URL (e.g. `https://watchwheel.onrender.com`) |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are injected automatically into every Edge Function — no need to set them.

### Unsubscribe

The email footer contains a link to `GET /api/unsubscribe?uid=<user_id>` on the Render backend. No auth required — it sets `digest_opt_in = false` and returns a styled HTML confirmation page. Users can re-enable from their account settings.

---

## Deployment checklist

### Supabase setup (one-time)

1. Run `supabase/schema.sql` in the SQL Editor.
2. Run `supabase/migrations/002_film_metadata_cache.sql` in the SQL Editor.
3. Auth → Providers → Email → disable **Confirm email**.
4. Auth → URL Configuration → Site URL → set to your Vercel URL.
5. Deploy the Edge Function:
   - Edge Functions → New Function → name it `send-digest`
   - Paste contents of `supabase/functions/send-digest/index.ts`
6. Edge Functions → `send-digest` → Secrets → add `RESEND_API_KEY`, `CRON_SECRET`, `RENDER_API_URL`.
7. Run `supabase/cron.sql` in the SQL Editor (replace `YOUR_CRON_SECRET` with your `CRON_SECRET` value).

### Render

Set environment variables: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`.

### Vercel

Set environment variables: `SUPABASE_URL`, `SUPABASE_ANON_KEY`.
(The anon key is also hardcoded in `frontend/script.js` for the CDN-only setup — safe by design.)
