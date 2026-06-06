# WatchWheel — Session Handoff

Snapshot of what shipped in this working session, why decisions look the way
they do, and what's left for the operator to do.

Session starts at commit **`239a6ef`** (Reels-style trailers rebuild) and ends
at **`dc7a2d3`** (Explore tab). Roughly **30 commits**, **~3,000 LOC moved**,
across the backend, frontend, and Supabase migrations.

---

## TL;DR — what the app looks like now

- **Five-tab bottom nav**: Tonight (home/picker) · Trailers · Library · Explore · Account
- **Onboarding** is import-first: signup → 3-step Letterboxd-export upload (or skip) → digest preferences → home
- **Films come from `user_films`** (a per-user Supabase table), populated either by importing a Letterboxd export ZIP (TMDB-enriched) or by adding via Explore
- **Trailers feed** is a vertical TikTok-style snap-scroll with raw `<iframe>` lifecycle (no YT.Player SDK), tap card to mute
- **No more Letterboxd scraping anywhere** — the `/watchlist/:username` endpoint and entire guest mode are gone
- **Explore tab** is a TMDB-backed discovery surface: search + trending/top-rated + decade chips, "+ Add to watchlist" + "Also on Letterboxd ↗"

---

## What ships this session, by feature area

### 1. Reels-style trailers feed (commits `239a6ef`, later iterations through `3f407d9`)

Replaced a card-list trailer feed with a full-screen vertical snap-scroll feed.
The architecture went through several iterations as we learned how mobile
browsers actually behave; the final state is:

- Each card is a `<div class="trailer-card">` 100% height of a snap-scroll
  parent (`scroll-snap-type: y mandatory` + `scroll-snap-align: start`)
- Card body contains a raw `<iframe>` (empty src until needed), a
  `<div class="trailer-poster-bg">` backdrop using `user_films.poster_url`,
  a hidden "No trailer available" overlay for null-trailer films, and a
  bottom info gradient with title + year + Letterboxd link
- An `IntersectionObserver` at **threshold 0.3** sets `iframe.src` on entry
  and clears it on exit (`f.src = ''`)
- The mute icon top-right is a **passive indicator** (`pointer-events: none`);
  tapping anywhere else on the card calls `toggleMute(card)` which sends a
  `postMessage` mute/unMute command to the iframe via `enablejsapi=1`
- Embed URL always uses `mute=1` — the only autoplay variant browsers
  reliably allow including iOS

The mute toggle is **per-card, not sticky** — we tried sticky-mute (commits
`7afd3c8`, `11ed01f`) but it broke iOS playback. The final decision in commit
`cec8deb`: each card autoplays muted, user re-taps mute per card.

### 2. Persistent bottom nav (commit `88a220f`)

Editorial cinema-programme footer style — fixed `position: bottom`, max-width
380px centered, z-index 8 (above content, below sheet 10/11). Active item
flips icon + label to `--ww-amber-text`.

Nav was 4 items originally; the Explore feature added a 5th in commit
`dc7a2d3`. Items at `flex: 1`, so 5 items get 76px each — still readable at
9px uppercase labels.

The trailers screen lives at `z-index: 6` (above container, below nav + sheet)
and reserves `bottom: 64px + safe-area` so the nav stays visible during the
reels feed. Sheet at z-index 10/11 overlays everything including trailers.

### 3. Letterboxd import + TMDB data source (commit `d9e68e7`)

The biggest single feature this session. End-to-end flow:

1. **Frontend** — file picker in the wizard's step 3 or in the settings sheet
   sends a multipart POST to `/import/letterboxd`
2. **Backend** (`backend/server.js`) — `multer` (memory storage) catches the
   ZIP; `unzipper` extracts `watchlist.csv` and `profile.csv`; `csv-parse`
   parses them; an `imports` row is created with `total_count` and status
   `'processing'`; the response returns immediately with `importId`
3. **Background processing** — fires `processImport()` as fire-and-forget.
   Uses a 5-concurrent TMDB limiter (`limitTmdb = createLimiter(5)`). For
   each film: searches TMDB, fetches details with `append_to_response=videos`
   in a single call, builds a `user_films` row with poster/runtime/synopsis/
   genres/youtube_id, upserts by `(user_id, letterboxd_url)`. Updates the
   `imports` row every 3 films
4. **Frontend** — polls `/import/:importId/status` every 700ms, drives a
   progress bar. On `status === 'complete'` calls `refreshWatchlist()`,
   navigates home or advances the wizard

**Username auto-population**: `profile.csv` is parsed for the `Username`
column; `profiles.letterboxd_username` is updated before processing kicks
off (commit `229954a`).

**Required env var on Render**: `TMDB_API_KEY` (free tier from
themoviedb.org/settings/api).

### 4. Import-first onboarding (commit `229954a`)

The wizard's step 3 originally collected a Letterboxd username and scraped a
watchlist preview. That step is now replaced with the import flow: upload an
export ZIP (advances to step 4 on success) or skip (advances immediately).

The wizard label reads "Step 3 of 4" on the import screen and "Step 4 of 4"
on both digest sub-screens (the digest sub-steps share label since they're
one conceptual step).

A new **#import standalone screen** (commit `a5391e1`) accessible from the
settings sheet and the home empty-state banner uses the same 3-step
instruction block. Both entry points route through identical instructions
instead of dumping the user straight into a file picker.

### 5. Letterboxd watchlist scraper removed (commit `08831af`)

Originally `GET /watchlist/:username` scraped Letterboxd HTML with `cheerio`
+ paginated `axios.get`. Deleted entirely along with:

- `scrapeWatchlist()` function
- The `/watchlist/:username` endpoint
- The guest `#onboarding` screen + `saveUsernameBtn` handler
- `showGuestPrompt()` and the dismissible guest banner on home
- The `sheetChangeUser` sheet row + handler
- The `guestBtn` ("Continue as guest →") on `auth-entry`
- The `refreshWatchlist()` guest fallback
- All `ww_watchlist` localStorage reads/writes in signed-in paths
- The account-screen change-username verification (now a plain PATCH)

`cheerio` and `LETTERBOXD_HEADERS` are kept — `/poster` still uses them for
the og-image + JSON-LD scrape per film. The app is **signed-in only** now.

### 6. Trailer batch uses `user_films.youtube_id` (commits `da8b84b`, `fecf0c3`)

`/trailers/batch` opens with a single bulk SELECT against `user_films` for
the requested film URLs. Resolution waterfall per film:

1. `user_films.youtube_id` set → `source: 'tmdb'`, zero quota cost
2. `user_films` row exists with `youtube_id IS NULL` → `source: 'tmdb_none'`,
   confirmed no trailer (TMDB already searched), zero cost, **no YouTube
   fallback** (added in commit `fecf0c3` — previously these films wasted
   100 quota units re-confirming what we already knew)
3. No `user_films` row → fall through to existing `getTrailerForFilm()` (film_metadata_cache → YouTube "official trailer" → YouTube "teaser")

Per-batch summary log includes the `tmdb` + `tmdb_none` dimensions:

```
[trailers/batch] 20 films → 18 trailers (tmdb: 17, tmdb_none: 2, cache: 0, youtube_trailer: 1, youtube_teaser: 0, none: 0)
```

Frontend `renderTrailers()` mirror-checks: films with `youtube_id` in
`state.watchlist` get stamped synchronously and skip the network round-trip
entirely. For a freshly-imported user, the trailers feed costs **0 YouTube
quota units** per visit.

### 7. Bug fixes — post-import data flow (commits `9e07fe5`, `54513f1`)

Two real bugs found after the import feature shipped:

- **Field name mismatch**: `processImport` was writing `runtime: <int>` but
  the deployed `user_films` table column is `runtime_minutes`. Aligned the
  upsert, the API response mapping, and the migration file (`54513f1`).
- **Refresh-before-render race**: `refreshWatchlist()` was called as
  fire-and-forget after `show('home')`, so the picker rendered against an
  empty `state.watchlist` while the API call was in flight, briefly flashing
  the empty-state banner. Now awaited before `show('home')` in both the
  sign-in handler and `boot()` (`9e07fe5`). Also: `/api/user-films` now
  returns a bare array (was `{ films: [...] }`); `refreshWatchlist()` throws
  on non-OK responses and logs `[watchlist] loaded N films` for diagnosis.

### 8. Redesigned import screen (commit `a5391e1`)

Replaces the tiny "Letterboxd → Settings → Data → Export your data" hint
card with a proper 3-step instruction block:

1. **Open your Letterboxd data settings** — direct link button to
   `https://letterboxd.com/settings/data` (opens in new tab)
2. **Click "Export your data"** — non-interactive "chip" mimicking the
   button shape so users know what to look for
3. **Upload the ZIP here** — the actual upload button

Used by both the wizard step 3 (`#wz1`) and a standalone `#import` screen
reachable from the settings sheet and the home empty-state banner. Same
content, different chrome (wizard has step indicator + skip link; standalone
has back button only).

### 9. Explore tab — TMDB-backed discovery (commit `dc7a2d3`)

Fifth nav tab. Single screen with three filter axes:

- **Search input** — typing > 350ms idle → `/search/movie`. Mode toggle
  visually disabled while a query is present
- **Mode toggle** — Trending (default) / Top rated → `/trending/movie/week`
  or `/movie/top_rated`
- **Decade chips** — Any era / 2020s ... 1960s → `/discover/movie` with
  `primary_release_date` range and popularity sort

Cards are 64×96 poster left, serif title + year + ★ rating + 2-line italic
synopsis right. Each card has a `+ Add to watchlist` pill (amber) and a
secondary `Also on Letterboxd ↗` link.

**Add flow**: `POST /api/user-films/add { tmdb_id }` →
app-level dedup on `user_films.tmdb_id` (catches the case where the same
film was imported from Letterboxd and is now being added via Explore — they
have different `letterboxd_url` values) → TMDB `/movie/:id` with
`append_to_response=videos` → insert a full `user_films` row with
`added_via: 'explore'`. Frontend swaps the button to "✓ Added" and fires
`refreshWatchlist()` so the picker and trailers feed reflect the new film.

The "Also on Letterboxd" link uses `letterboxd.com/tmdb/<id>/` — Letterboxd
has a stable redirect from TMDB IDs to film pages.

---

## Current architecture

### Tables (`supabase/migrations/`)

| File | What |
|---|---|
| `006_user_films_table.sql` | The watchlist. `(user_id, tmdb_id, title, year, letterboxd_url, poster_url, runtime_minutes, synopsis, genres[], youtube_id, status, created_at)`. RLS: user can only see their own films. Unique index on `(user_id, letterboxd_url)`. |
| `007_imports_table.sql` | Import job tracking. `(user_id, status, total_count, processed_count, matched_count, last_processed_title, error_message)`. RLS: user can only see their own jobs. |
| `008_user_films_added_via.sql` | Adds `added_via text default 'letterboxd'` column. `'explore'` for films added from the Explore tab. |

### Endpoints (`backend/server.js`)

**Films**
- `GET /api/user-films` (auth) — returns user's films in picker shape (bare array)
- `POST /api/user-films/add` (auth) — adds one film by `tmdb_id`, dedupes
- `POST /import/letterboxd` (auth, multer) — accepts ZIP, kicks off background import
- `GET /import/:importId/status` (auth) — polling endpoint for progress
- `GET /api/explore` (auth) — TMDB discovery proxy with `mode` query param

**Trailers**
- `POST /trailers/batch` (auth) — bulk-resolves trailers via the
  user_films → cache → YouTube waterfall
- `GET /trailer` — single film lookup (no auth, legacy)

**Posters & metadata**
- `GET /poster` — Letterboxd film-page scrape (og-image + JSON-LD)

**Profile / history**
- `GET /api/profile`, `PATCH /api/profile`
- `GET /api/history`, `POST /api/history`
- `DELETE /api/account`
- `GET /api/unsubscribe?uid=...` (no auth, called from email)

### Screens (`frontend/index.html`)

| Screen ID | Purpose |
|---|---|
| `auth-entry`, `auth-signup`, `auth-signin` | Auth |
| `wizard` | 3-step onboarding (#wz1 import, #wz2 digest opt-in, #wz3 digest hour) |
| `import` | Standalone import instructions (from settings sheet / empty banner) |
| `home` | Picker (mood / decade / runtime) |
| `screening` | Result / film detail |
| `library` | Recently programmed history |
| `account` | Account settings |
| `trailers` | Full-screen reels feed |
| `explore` | TMDB discovery |

`NAV_SCREENS = ['home', 'trailers', 'library', 'explore']`. Bottom nav hidden
on auth/wizard/import/screening/account.

### Required env vars

- **Render** (backend): `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `YOUTUBE_API_KEY`, `TMDB_API_KEY`
- **Vercel** (frontend): `SUPABASE_URL`, `SUPABASE_ANON_KEY` (also
  hardcoded in `frontend/script.js` for the CDN setup)
- **Supabase Edge Function secrets** (for the digest): `RESEND_API_KEY`,
  `CRON_SECRET`, `RENDER_API_URL`

---

## Manual steps required to go live with what's in `main`

1. **Run three migrations** in Supabase SQL Editor (in this order):
   - `supabase/migrations/006_user_films_table.sql`
   - `supabase/migrations/007_imports_table.sql`
   - `supabase/migrations/008_user_films_added_via.sql`

2. **Confirm `TMDB_API_KEY` is set on Render**. Both the import flow and the
   Explore tab fail with `[explore] TMDB not configured` / `[import]
   TMDB_API_KEY not set` if it's missing.

3. **Verify Render auto-redeployed** after the latest push. The Explore tab
   adds new endpoints (`/api/explore`, `/api/user-films/add`); they 404 until
   redeploy completes.

4. **Smoke-test the full flow**:
   - Sign up fresh → wizard shows import-first step 3 with the 3 numbered steps
   - Upload your Letterboxd export ZIP → progress bar → "You're ready" → digest steps → home with imported films
   - Trailers feed: each card should autoplay muted, tap toggles mute, no postMessage warnings in console
   - Explore: search a film, tap "+ Add", check it appears in the home picker
   - Library: previously programmed films appear (from existing flow)

---

## Key decisions and trade-offs

### Trailers mute toggle: per-card, not sticky

Tried sticky-mute three times in this session (commits `7afd3c8`, `11ed01f`,
`5ee63dd`). Each version had a different mobile playback bug. The final
revert in `cec8deb` matches TikTok/Shorts/Reels: every card starts muted,
the user taps to unmute the current card only, the next card starts muted
again. Predictable, works on every browser, no autoplay-policy fights.

If sticky-mute is wanted again in the future, the cleanest path is probably
to track `stickyMuted` in `localStorage` and **only seed unmute from a
direct user tap on the card** (preserving gesture context), never from a
`setTimeout` or observer callback. The bones of that approach are visible
in git history at commit `5ee63dd`.

### No YouTube IFrame API SDK

Dropped in commit `4d1b088`. The `enablejsapi=1` URL flag is enough for the
postMessage mute commands we need; loading the full SDK script was
producing cross-origin postMessage warnings in the console and adding a
~30KB script for one feature. Trade-off: we can't listen for player state
events (`onReady`, `onStateChange`). We don't need to, currently.

### Application-level dedup on `tmdb_id`

`user_films` has a unique index on `(user_id, letterboxd_url)` but not on
`(user_id, tmdb_id)`. A film imported from Letterboxd (slug-style URL like
`letterboxd.com/film/parasite/`) and the same film added via Explore
(tmdb-style URL `letterboxd.com/tmdb/496243/`) have **different**
`letterboxd_url` values, so the index won't catch them as duplicates.

`POST /api/user-films/add` SELECTs by `tmdb_id` before inserting to dedupe.
This is one extra query per add but avoids a schema migration. **Race
condition**: two concurrent adds for the same `tmdb_id` could both pass
the SELECT and create duplicates. Probably fine until proven otherwise; if
it becomes an issue, add a unique index on `(user_id, tmdb_id) WHERE
tmdb_id IS NOT NULL` in a future migration.

### Backend response shape: bare array

`GET /api/user-films` returns the films array directly, not wrapped in
`{ films: [...] }`. Decided in commit `9e07fe5` after debugging the
"home shows no films after import" bug — the wrapped shape was harder to
inspect in DevTools and diverged from the spec's contract. Other endpoints
that return wrapped responses (`/api/explore` returns `{ films, page }`,
`/trailers/batch` returns `{ trailers }`) are intentional — they carry
additional metadata.

### Letterboxd is no longer the source of truth

Originally Letterboxd was the canonical watchlist; we scraped it on every
page load. Now `user_films` is canonical. Letterboxd lives on as:

- The **source for the initial import** (one-time ZIP upload)
- A **deep-link target** from Explore cards ("Also on Letterboxd ↗")
- The **logo on screening / library** items via `letterboxd_url`

Re-importing a Letterboxd export later will upsert by `letterboxd_url` so
existing rows are updated, not duplicated, but the user's "added via
Explore" films **stay** — they don't get reset by a re-import. This is
intentional: Explore additions are first-class watchlist entries.

### The `/poster` endpoint is still Letterboxd-backed

We removed the watchlist scraper but kept `/poster` (Letterboxd film-page
scrape for og-image + JSON-LD tagline / synopsis / runtime). It's still
used by the screening/result screen for films that came from the
Letterboxd export. For films added via Explore the data already lives in
`user_films` (synopsis from TMDB overview), so `/poster` is a non-issue
there. If we ever stop using `/poster` we can drop `cheerio` and
`LETTERBOXD_HEADERS` too.

---

## Known limitations

- **Trailer mute is not sticky.** Each card starts muted. Acceptable per
  the most recent decision; revisit if user testing shows friction.
- **Explore has no pagination.** Each request returns 20 results (TMDB's
  default). No "Load more" button. Add one if users hit the bottom and
  ask for more.
- **No genre filter on Explore.** Decades only. The backend supports
  `?genre=<id>` already; add chips in the UI when wanted.
- **Race in `POST /api/user-films/add`** — two concurrent adds could
  create duplicates (see "App-level dedup" above).
- **Re-import does not delete films that were removed from Letterboxd.**
  Only inserts new + updates existing. If a user removes a film from
  their Letterboxd watchlist and re-imports, the stale film stays in
  WatchWheel. Probably fine — Explore-added films also stay across
  re-imports, so deletion semantics are intentionally manual.
- **No "remove from watchlist" UI.** Would need a new endpoint and a
  card-level affordance. The film_metadata_cache invalidation note in
  AUTH.md describes the SQL for manual removal.
- **`profile.csv` parsing is best-effort.** Letterboxd's column header is
  `Username` in the version I tested; if they ever rename it, the
  username won't auto-populate (the wizard's typed-username field is the
  fallback).
- **Render free-tier idle timeout.** A 400-film import takes ~30s of
  TMDB calls. If Render's free tier kills the server mid-process, the
  import stalls and the polling endpoint keeps returning `processing`.
  Surface a 60-second timeout in the UI if users report this.

---

## What's left to do (operator-side)

- [ ] Run migrations 006, 007, 008 in Supabase (only 008 should be new
      since 006/007 were already run when the import feature shipped)
- [ ] Confirm `TMDB_API_KEY` is on Render
- [ ] Smoke-test the Explore flow once Render redeploys
- [ ] Watch Render logs for `[user-films/add]`, `[explore]`,
      `[trailers/batch] ... tmdb: N`, and `[user-films] <uid> → N rows`
      lines — they're the diagnostics we wired up this session

## What's left to do (future code work)

- [ ] **Re-evaluate sticky mute** after using the trailers feed for a few
      sessions. If tapping mute on every card feels heavy, implement the
      `localStorage` + gesture-only-seed approach noted above.
- [ ] **Add infinite scroll or pagination to Explore** if users hit the
      end of 20 results and want more.
- [ ] **Genre filter chips on Explore.** Backend already supports it via
      `?genre=<tmdb_id>`. TMDB exposes `/genre/movie/list` for the ID
      mapping.
- [ ] **Remove-from-watchlist UI**. Card-level "Remove" affordance +
      `DELETE /api/user-films/:id` endpoint. Useful for both Explore-
      added films and Letterboxd-imported films users no longer want.
- [ ] **Unique index on `(user_id, tmdb_id)`** if the dedup race becomes
      observable in production.
- [ ] **Letterboxd OAuth** for two-way sync (Explore adds → push to
      Letterboxd, Letterboxd watchlist changes → pull). Big project; not
      essential.
- [ ] **Drop `cheerio` + `LETTERBOXD_HEADERS`** if we ever stop using
      `/poster` (e.g. by storing poster_url for all films at add-time and
      reading it from `user_films` on the screening screen).

---

## File map of session changes

| Area | Files |
|---|---|
| **Backend** | `backend/server.js` — added /api/explore, /api/user-films/add, /import/letterboxd, /import/:id/status, /api/user-films, processImport, tmdbFetch, shapeTmdbCard, searchTmdb, fetchTmdbDetails, parseWatchlistCsv; removed scrapeWatchlist + /watchlist/:username; reworked /trailers/batch |
| **Frontend HTML** | `frontend/index.html` — new sections: #import, #explore; removed: #onboarding, sheetChangeUser, guestBtn, currentUserGuest; bottom nav (5 items); import overlay; reworked wz1; empty-import-banner on #home |
| **Frontend CSS** | `frontend/styles.css` — new blocks: bottom-nav, import overlay, import-steps, lbx-button-hint, explore-*, empty-import-banner, trailer-no-trailer-overlay; removed: auth-guest-link, guest-prompt-*, wiz-import-hint-*, wiz-preview-*, tap-to-play-* |
| **Frontend JS** | `frontend/script.js` — refreshWatchlist, updateEmptyState, renderTrailers + observer, renderExplore + fetchExploreResults + addExploreFilm, uploadLetterboxdImport + pollImport + showImportOverlay, showBottomNav, openLetterboxdFilePicker; removed: scrapeWatchlist callers, showGuestPrompt, saveUsernameBtn handler, guestBtn handler, sheetChangeUser handler |
| **Migrations** | `supabase/migrations/006_user_films_table.sql`, `007_imports_table.sql`, `008_user_films_added_via.sql` |
| **Docs** | `HANDOFF.md` (this file) |

---

*Generated at end of session — see git log for commit-by-commit detail.*
