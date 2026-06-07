import express from 'express';
import cors from 'cors';
import axios from 'axios';
import * as cheerio from 'cheerio';
import multer from 'multer';
import unzipper from 'unzipper';
import { parse as parseCsv } from 'csv-parse/sync';
import supabase from './supabase.js';

const app = express();
app.use(cors());
app.use(express.json());

// Shared browser-like headers for Letterboxd scraping — plain axios gets
// rejected, but a desktop Chrome UA + Accept headers behaves like a real visit.
const LETTERBOXD_HEADERS = {
  'User-Agent':                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept':                    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language':           'en-US,en;q=0.9',
  'Accept-Encoding':           'gzip, deflate, br',
  'DNT':                       '1',
  'Upgrade-Insecure-Requests': '1',
  'Cache-Control':             'no-cache',
};

// ── Auth middleware ──────────────────────────────────────────────────────────

async function requireAuth(req, res, next) {
  if (!supabase) {
    return res.status(503).json({ error: 'Auth not configured — set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the server' });
  }
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing Bearer token' });
  }
  const { data: { user }, error } = await supabase.auth.getUser(header.slice(7));
  if (error || !user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
  req.user = user;
  next();
}

// ── Profile routes ───────────────────────────────────────────────────────────

// GET /api/profile — fetch the signed-in user's profile row
app.get('/api/profile', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', req.user.id)
    .single();
  if (error) return res.status(404).json({ error: 'Profile not found' });
  res.json(data);
});

// PATCH /api/profile — update allowed profile fields
app.patch('/api/profile', requireAuth, async (req, res) => {
  const allowed = ['letterboxd_username', 'digest_opt_in', 'digest_hour', 'timezone'];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  if (updates.digest_hour !== undefined) {
    const h = parseInt(updates.digest_hour, 10);
    if (isNaN(h) || h < 0 || h > 23) {
      return res.status(400).json({ error: 'digest_hour must be an integer 0–23' });
    }
    updates.digest_hour = h;
  }
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No valid fields provided' });
  }
  const { data, error } = await supabase
    .from('profiles')
    .update(updates)
    .eq('id', req.user.id)
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ── Film history routes ──────────────────────────────────────────────────────

// GET /api/history — last 50 films served to this user
app.get('/api/history', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('film_history')
    .select('*')
    .eq('user_id', req.user.id)
    .order('served_at', { ascending: false })
    .limit(50);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ history: data });
});

// POST /api/history — record a film pick (from app picker)
app.post('/api/history', requireAuth, async (req, res) => {
  const { letterboxd_url, title, year, poster_url, mood, source } = req.body;
  if (!letterboxd_url || !title) {
    return res.status(400).json({ error: 'letterboxd_url and title are required' });
  }
  const { data, error } = await supabase
    .from('film_history')
    .insert({
      user_id: req.user.id,
      letterboxd_url,
      title,
      year: year || null,
      poster_url: poster_url || null,
      mood: mood || null,
      source: source || 'app',
    })
    .select()
    .single();
  if (error) return res.status(500).json({ error: error.message });
  res.status(201).json(data);
});

// DELETE /api/account — permanently removes the auth.users row (cascades to profiles + history)
app.delete('/api/account', requireAuth, async (req, res) => {
  const { error } = await supabase.auth.admin.deleteUser(req.user.id);
  if (error) return res.status(500).json({ error: error.message });
  res.json({ success: true });
});

// ── Existing routes ──────────────────────────────────────────────────────────

app.get('/', (req, res) => res.send('WatchWheel backend running'));

function parseIso8601Duration(dur) {
  if (!dur) return null;
  const hours = parseInt(dur.match(/(\d+)H/)?.[1] || '0');
  const mins  = parseInt(dur.match(/(\d+)M/)?.[1] || '0');
  const total = hours * 60 + mins;
  return total > 0 ? total : null;
}

app.get('/poster', async (req, res) => {
  const filmUrl = req.query.url;
  let image = null, tagline = null, synopsis = null, runtimeMinutes = null;

  try {
    if (!filmUrl) throw new Error('No url query param');

    const response = await axios.get(filmUrl, {
      // Don't throw on 4xx — let us log the status and still return gracefully
      validateStatus: () => true,
      timeout: 15000,
      headers: LETTERBOXD_HEADERS,
    });

    console.log(`[poster] ${filmUrl} → HTTP ${response.status} (${String(response.data).length} bytes)`);

    if (response.status !== 200) {
      console.warn(`[poster] Non-200 from Letterboxd — skipping scrape`);
    } else {
      const $ = cheerio.load(response.data);

      image   = $('meta[property="og:image"]').attr('content') || null;
      tagline = $('h4.tagline').first().text().trim() || null;

      // Title for the cache (column is NOT NULL). og:title is "Title (YYYY)".
      const ogTitle = $('meta[property="og:title"]').attr('content') || '';
      const titleForCache = ogTitle.replace(/\s*\(\d{4}\)\s*$/, '').trim()
        || $('h1.primaryname .name').text().trim()
        || null;

      // Runtime + synopsis from JSON-LD
      const ldRaw = $('script[type="application/ld+json"]').first().html();
      if (ldRaw) {
        try {
          const ld = JSON.parse(ldRaw);
          runtimeMinutes = parseIso8601Duration(ld.duration);
          if (ld.description) synopsis = ld.description.trim();
        } catch (parseErr) {
          console.error('[poster] JSON-LD parse error:', parseErr.message);
        }
      }
      // Fallback synopsis: meta description
      if (!synopsis) {
        synopsis = $('meta[name="description"]').attr('content')?.trim() || null;
      }

      console.log(`[poster] scraped → image=${!!image} tagline=${JSON.stringify(tagline)} synopsis=${synopsis?.length ?? 0}ch runtime=${runtimeMinutes}`);

      if (supabase) {
        // title column is NOT NULL — always provide one, fall back to URL slug
        const fallbackTitle = (filmUrl.match(/\/film\/([^/]+)\/?$/)?.[1] || 'unknown')
          .replace(/-\d{4}$/, '').replace(/-/g, ' ');
        const upsertData = {
          letterboxd_url: filmUrl,
          title:          titleForCache || fallbackTitle,
          cached_at:      new Date().toISOString(),
        };
        if (image)          upsertData.poster_url      = image;
        if (runtimeMinutes) upsertData.runtime_minutes = runtimeMinutes;
        supabase.from('film_metadata_cache').upsert(upsertData, { onConflict: 'letterboxd_url' })
          .then(({ error }) => { if (error) console.error('[poster] cache upsert error:', error.message); });
      }
    }
  } catch (e) {
    console.error(`[poster] fetch error for ${filmUrl}:`, e.message);
  }

  res.json({ image, tagline, synopsis, runtime_minutes: runtimeMinutes });
});

// ── Trailer discovery (YouTube-only, 2-tier) ─────────────────────────────────
//
// For each film, try in order — stop at the first hit:
//   1. YouTube search "{title} {year} official trailer"
//   2. YouTube search "{title} {year} teaser"
// Results cached on film_metadata_cache.youtube_id + trailer_checked_at.
// Cache hit (id or 30-day-fresh null) short-circuits — zero quota cost.

// Concurrency limiter — used to throttle YouTube API fan-out so we don't
// hit the per-minute rate cap when many films fall through to tier 2/3.
function createLimiter(maxConcurrent) {
  let active = 0;
  const queue = [];
  const drain = () => {
    while (active < maxConcurrent && queue.length > 0) {
      const { fn, resolve, reject } = queue.shift();
      active++;
      Promise.resolve().then(fn).then(resolve, reject).finally(() => {
        active--;
        drain();
      });
    }
  };
  return (fn) => new Promise((resolve, reject) => {
    queue.push({ fn, resolve, reject });
    drain();
  });
}
const limitYouTube = createLimiter(5);

// Tiers 2 & 3: YouTube Data API search with a suffix ("official trailer"/"teaser")
async function searchYouTubeForFilm(title, year, suffix) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    console.error('[trailer] YOUTUBE_API_KEY not set');
    return { youtube_id: null, error: 'no_api_key' };
  }

  const q = `${title} ${year || ''} ${suffix}`.trim();
  const params = new URLSearchParams({
    part:             'snippet',
    type:             'video',
    maxResults:       '1',
    videoEmbeddable:  'true',
    q,
    key:              apiKey,
  });

  try {
    const res = await axios.get(`https://www.googleapis.com/youtube/v3/search?${params}`, {
      validateStatus: () => true,
      timeout: 10000,
    });

    if (res.status === 403) {
      const reason = res.data?.error?.errors?.[0]?.reason;
      if (reason === 'quotaExceeded' || reason === 'dailyLimitExceeded') {
        console.error('[trailer] YouTube quota exceeded');
        return { youtube_id: null, error: 'quota_exceeded' };
      }
      console.error('[trailer] YouTube 403:', JSON.stringify(res.data?.error));
      return { youtube_id: null, error: 'forbidden' };
    }
    if (res.status !== 200) {
      console.error(`[trailer] YouTube ${res.status}:`, JSON.stringify(res.data).slice(0, 300));
      return { youtube_id: null, error: 'api_error' };
    }

    return { youtube_id: res.data?.items?.[0]?.id?.videoId || null };
  } catch (e) {
    console.error('[trailer] fetch error:', e.message);
    return { youtube_id: null, error: 'fetch_error' };
  }
}

// Errors we shouldn't cache — they mean "we couldn't check", not "no trailer".
function isTransientError(err) {
  return err === 'quota_exceeded' || err === 'fetch_error' || err === 'api_error';
}

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

// Cache-aware YouTube lookup. Per-film tiers run sequentially (don't burn
// a teaser search if the trailer search already hit); /trailers/batch
// parallelises across films via Promise.all.
async function getTrailerForFilm({ title, year, filmUrl }) {
  // ── Cache lookup ──
  if (supabase && filmUrl) {
    const { data: cached } = await supabase
      .from('film_metadata_cache')
      .select('youtube_id, trailer_checked_at')
      .eq('letterboxd_url', filmUrl)
      .maybeSingle();

    if (cached?.youtube_id) {
      return { youtube_id: cached.youtube_id, source: 'cache', cached: true };
    }
    if (cached?.trailer_checked_at) {
      const age = Date.now() - new Date(cached.trailer_checked_at).getTime();
      if (age < THIRTY_DAYS_MS) {
        // Recently confirmed no trailer — don't burn another search
        return { youtube_id: null, source: 'cache', cached: true };
      }
    }
  }

  // ── Tier 1: YouTube "official trailer" (throttled to 5 concurrent) ──
  let videoId = null;
  let source  = null;

  {
    const r = await limitYouTube(() => searchYouTubeForFilm(title, year, 'official trailer'));
    if (isTransientError(r.error)) return r;
    if (r.youtube_id) {
      videoId = r.youtube_id;
      source  = 'youtube_trailer';
      console.log(`[trailer] youtube_trailer → ${videoId} for ${title}`);
    }
  }

  // ── Tier 2: YouTube "teaser" (throttled to 5 concurrent) ──
  if (!videoId) {
    const r = await limitYouTube(() => searchYouTubeForFilm(title, year, 'teaser'));
    if (isTransientError(r.error)) return r;
    if (r.youtube_id) {
      videoId = r.youtube_id;
      source  = 'youtube_teaser';
      console.log(`[trailer] youtube_teaser → ${videoId} for ${title}`);
    }
  }

  if (!videoId) {
    console.log(`[trailer] no trailer found for ${title}`);
  }

  // ── Cache the definitive result (hit or confirmed-null) ──
  // film_metadata_cache.title is NOT NULL — always include it in the upsert.
  if (supabase && filmUrl) {
    supabase.from('film_metadata_cache').upsert({
      letterboxd_url:     filmUrl,
      title:              title || 'Unknown',
      youtube_id:         videoId,
      trailer_checked_at: new Date().toISOString(),
      cached_at:          new Date().toISOString(),
    }, { onConflict: 'letterboxd_url' })
      .then(({ error }) => { if (error) console.error('[trailer] cache upsert error:', error.message); });
  }

  return { youtube_id: videoId, source };
}

// GET /trailer?title=...&year=...&filmUrl=...
app.get('/trailer', async (req, res) => {
  const { title, year, filmUrl } = req.query;
  if (!title) return res.status(400).json({ error: 'title required' });

  const result = await getTrailerForFilm({ title, year, filmUrl });
  res.json({
    youtube_id: result.youtube_id,
    title,
    year:       year || null,
    ...(result.error ? { error: result.error } : {}),
  });
});

// POST /trailers/batch  body: { films: [{title, year, url}] }
//
// Resolution order per film:
//   1. user_films row with youtube_id    → return it (source: 'tmdb')
//   2. user_films row with youtube_id IS NULL → confirmed no trailer (source: 'tmdb_none').
//      TMDB already searched its videos table and found nothing — burning a
//      YouTube search would just confirm that result at 100 quota/film.
//   3. No user_films row at all → fall through to getTrailerForFilm():
//        a. film_metadata_cache hit (zero cost)
//        b. YouTube "official trailer" search (100 units)
//        c. YouTube "teaser" search (100 units)
// Tier 1+2 share one bulk lookup at the top; tier 3 runs per-film
// (parallel across films, sequential waterfall within each).
app.post('/trailers/batch', requireAuth, async (req, res) => {
  const films = Array.isArray(req.body?.films) ? req.body.films.slice(0, 20) : [];
  if (films.length === 0) return res.json({ trailers: [] });

  // ── Tier 1+2: bulk-lookup user_films ──
  // Distinguishes between "have trailer" (cachedMap) and "TMDB checked, no
  // trailer exists" (confirmedNoTrailer). Films absent from user_films
  // entirely fall through to the YouTube waterfall.
  const urls               = films.map(f => f.url).filter(Boolean);
  const cachedMap          = {};
  const confirmedNoTrailer = new Set();
  if (urls.length > 0 && supabase) {
    const { data: userFilms, error } = await supabase
      .from('user_films')
      .select('letterboxd_url, youtube_id')
      .eq('user_id', req.user.id)
      .in('letterboxd_url', urls);
    if (error) {
      console.error('[trailers/batch] user_films lookup failed:', error.message);
    } else {
      (userFilms || []).forEach(f => {
        if (f.youtube_id) cachedMap[f.letterboxd_url] = f.youtube_id;
        else              confirmedNoTrailer.add(f.letterboxd_url);
      });
    }
  }

  // ── Tier 3: only for films not in user_films at all ──
  const results = await Promise.all(films.map(async (f) => {
    if (cachedMap[f.url]) {
      return { url: f.url, youtube_id: cachedMap[f.url], source: 'tmdb' };
    }
    if (confirmedNoTrailer.has(f.url)) {
      // TMDB already verified there's no trailer — don't burn YouTube quota
      return { url: f.url, youtube_id: null, source: 'tmdb_none' };
    }
    const r = await getTrailerForFilm({ title: f.title, year: f.year, filmUrl: f.url });
    return { url: f.url, youtube_id: r.youtube_id, source: r.source || null, error: r.error };
  }));

  // Per-source summary.
  //   tmdb        — served from user_films (had a youtube_id from import)
  //   tmdb_none   — user_films row exists, TMDB confirmed no trailer (zero cost)
  //   cache       — served from film_metadata_cache (earlier YouTube search)
  //   youtube_*   — fresh YouTube search this batch (the only quota-burners)
  //   none        — fell through every tier with no trailer found
  const counts = { tmdb: 0, tmdb_none: 0, cache: 0, youtube_trailer: 0, youtube_teaser: 0, none: 0 };
  for (const r of results) {
    if (r.source && counts[r.source] !== undefined) counts[r.source]++;
    else if (!r.youtube_id) counts.none++;
  }
  const hits  = counts.tmdb + counts.cache + counts.youtube_trailer + counts.youtube_teaser;
  const quota = results.some(r => r.error === 'quota_exceeded');
  console.log(
    `[trailers/batch] ${films.length} films → ${hits} trailers ` +
    `(tmdb: ${counts.tmdb}, tmdb_none: ${counts.tmdb_none}, cache: ${counts.cache}, ` +
    `youtube_trailer: ${counts.youtube_trailer}, youtube_teaser: ${counts.youtube_teaser}, ` +
    `none: ${counts.none})` +
    (quota ? ' [quota exceeded]' : '')
  );

  // Frontend doesn't need source — strip before returning
  const trailers = results.map(({ url, youtube_id, error }) => ({
    url, youtube_id, ...(error ? { error } : {}),
  }));
  res.json({ trailers });
});

// ─── Letterboxd import ───────────────────────────────────────────────────────
//
// Flow:
//   1. POST /import/letterboxd (multipart ZIP)  → parse watchlist.csv, create
//      an `imports` row, return importId immediately, kick off background
//      processing (TMDB search + details + videos, upserting `user_films`).
//   2. GET /import/:importId/status  → frontend polls every ~700ms to drive
//      the progress overlay until status === 'complete'.
//   3. GET /api/user-films  → returns the user's films in the shape the
//      existing picker expects ({ title, year, url, poster, ... }).

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB — Letterboxd exports are <5 MB
});

// Concurrency-limited TMDB fan-out — TMDB allows 50 req/sec but we keep it
// conservative so a 400-film import doesn't trip rate limits.
const limitTmdb = createLimiter(5);

async function searchTmdb(title, year) {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) {
    console.error('[import] TMDB_API_KEY not set');
    return null;
  }
  const params = new URLSearchParams({ query: title, api_key: apiKey });
  if (year) params.set('primary_release_year', String(year));
  try {
    const res = await axios.get(
      `https://api.themoviedb.org/3/search/movie?${params}`,
      { validateStatus: () => true, timeout: 10000 },
    );
    if (res.status !== 200) return null;
    return res.data?.results?.[0] || null;
  } catch (e) {
    console.error('[import] TMDB search failed:', title, e.message);
    return null;
  }
}

async function fetchTmdbDetails(tmdbId) {
  const apiKey = process.env.TMDB_API_KEY;
  // append_to_response=videos,credits folds details + trailers + credits into
  // a single request (one TMDB call instead of three)
  try {
    const res = await axios.get(
      `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${apiKey}&append_to_response=videos,credits`,
      { validateStatus: () => true, timeout: 10000 },
    );
    if (res.status !== 200) return null;
    return res.data;
  } catch (e) {
    console.error('[import] TMDB details failed:', tmdbId, e.message);
    return null;
  }
}

// Parse Letterboxd's watchlist.csv → [{ title, year, letterboxd_url }, ...]
// Headers: "Date","Name","Year","Letterboxd URI"
function parseWatchlistCsv(csvText) {
  const records = parseCsv(csvText, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_quotes: true,
    relax_column_count: true,
  });
  return records
    .map(r => ({
      title:          r['Name'] || r['name'] || '',
      year:           parseInt(r['Year'] || r['year'] || '', 10) || null,
      letterboxd_url: r['Letterboxd URI'] || r['letterboxd_uri'] || r['URI'] || '',
      // present in watched.csv / reviews.csv; null for watchlist.csv
      logged_date:    r['Date'] || null,
    }))
    .filter(r => r.title && r.letterboxd_url);
}

// Low-level CSV → array of row objects (shared options).
function parseCsvRows(csvText) {
  return parseCsv(csvText, {
    columns: true, skip_empty_lines: true, trim: true,
    relax_quotes: true, relax_column_count: true,
  });
}

// ratings.csv → { [letterboxd_url]: rating(float) }
// Headers: Date, Name, Year, Letterboxd URI, Rating
function parseRatingsCsv(csvText) {
  const map = {};
  for (const r of parseCsvRows(csvText)) {
    const url = r['Letterboxd URI'] || r['URI'] || '';
    const rating = parseFloat(r['Rating']);
    if (url && !Number.isNaN(rating)) map[url] = rating;
  }
  return map;
}

// reviews.csv → { [letterboxd_url]: { review, watchedDate, rating } }
// Headers: Date, Name, Year, Letterboxd URI, Rating, Review, Tags, Watched Date
function parseReviewsCsv(csvText) {
  const map = {};
  for (const r of parseCsvRows(csvText)) {
    const url = r['Letterboxd URI'] || r['URI'] || '';
    if (!url) continue;
    const rating = parseFloat(r['Rating']);
    map[url] = {
      review:      (r['Review'] || '').trim() || null,
      watchedDate: r['Watched Date'] || r['Date'] || null,
      rating:      Number.isNaN(rating) ? null : rating,
    };
  }
  return map;
}

// Background processing — walks the entries, hits TMDB, upserts user_films,
// updates the imports row's progress counters. Runs async; the HTTP response
// for /import/letterboxd has already been sent by the time this kicks off.
const NULL_META = {
  tmdb_id: null, poster_url: null, runtime_minutes: null,
  synopsis: null, genres: null, director: null, cast_list: null,
  tmdb_rating: null, youtube_id: null,
};

// Resolve a {title, year} entry to TMDB metadata (or null if no match).
async function resolveTmdbMeta(entry) {
  const hit = await searchTmdb(entry.title, entry.year);
  if (!hit?.id) return null;
  const details = await fetchTmdbDetails(hit.id);
  const trailer =
    details?.videos?.results?.find(v => v.site === 'YouTube' && v.type === 'Trailer') ||
    details?.videos?.results?.find(v => v.site === 'YouTube' && v.type === 'Teaser')  ||
    details?.videos?.results?.find(v => v.site === 'YouTube');
  const director = details?.credits?.crew?.find(p => p.job === 'Director')?.name || null;
  const castList = (details?.credits?.cast || []).slice(0, 5).map(p => p.name);
  return {
    tmdb_id:         hit.id,
    poster_url:      details?.poster_path
      ? `https://image.tmdb.org/t/p/w500${details.poster_path}`
      : (hit.poster_path ? `https://image.tmdb.org/t/p/w500${hit.poster_path}` : null),
    runtime_minutes: details?.runtime || null,
    synopsis:        details?.overview || hit.overview || null,
    genres:          details?.genres?.map(g => g.name) || null,
    director:        director,
    cast_list:       castList.length ? castList : null,
    tmdb_rating:     details?.vote_average ?? null,
    youtube_id:      trailer?.key || null,
  };
}

// Background processing — two phases sharing the same concurrency limiter and
// progress counter: (1) watchlist films → user_films (with personal rating),
// (2) watched films → user_watched (with rating + review + watched date).
async function processImport(userId, importId, opts) {
  const watchlistEntries = opts.watchlistEntries || [];
  const watchedEntries   = opts.watchedEntries   || [];
  const ratingsMap       = opts.ratingsMap       || {};
  const reviewsMap       = opts.reviewsMap        || {};

  const total = watchlistEntries.length + watchedEntries.length;
  let processed = 0;
  let watchlistMatched = 0;
  let watchedMatched = 0;
  let ratingsApplied = 0;

  const writeProgress = async (title) => {
    await supabase.from('imports').update({
      processed_count:      processed,
      matched_count:        watchlistMatched + watchedMatched,
      last_processed_title: title,
    }).eq('id', importId);
  };
  const tick = async (title) => {
    processed++;
    if (processed % 3 === 0 || processed === total) await writeProgress(title).catch(() => {});
  };

  // Phase 1 — watchlist → user_films
  await Promise.all(watchlistEntries.map(entry => limitTmdb(async () => {
    try {
      const meta = await resolveTmdbMeta(entry);
      const rating = ratingsMap[entry.letterboxd_url] ?? null;
      if (rating != null) ratingsApplied++;
      const row = {
        user_id:        userId,
        title:          entry.title,
        year:           entry.year,
        letterboxd_url: entry.letterboxd_url,
        user_rating:    rating,
        ...(meta || NULL_META),
        status:         meta ? 'ready' : 'unmatched',
      };
      if (meta) watchlistMatched++;
      const { error } = await supabase
        .from('user_films')
        .upsert(row, { onConflict: 'user_id,letterboxd_url' });
      if (error) console.error('[import] user_films upsert failed:', entry.title, error.message);
    } catch (e) {
      console.error('[import] watchlist film failed:', entry.title, e.message);
    } finally {
      await tick(entry.title);
    }
  })));

  // Phase 2 — watched → user_watched
  await Promise.all(watchedEntries.map(entry => limitTmdb(async () => {
    try {
      const meta   = await resolveTmdbMeta(entry);
      const review = reviewsMap[entry.letterboxd_url] || null;
      const rating = ratingsMap[entry.letterboxd_url] ?? review?.rating ?? null;
      if (rating != null) ratingsApplied++;
      const row = {
        user_id:        userId,
        title:          entry.title,
        year:           entry.year,
        letterboxd_url: entry.letterboxd_url,
        user_rating:    rating,
        watched_date:   review?.watchedDate || entry.logged_date || null,
        review:         review?.review || null,
        ...(meta || NULL_META),
      };
      if (meta) watchedMatched++;
      const { error } = await supabase
        .from('user_watched')
        .upsert(row, { onConflict: 'user_id,letterboxd_url' });
      if (error) console.error('[import] user_watched upsert failed:', entry.title, error.message);
    } catch (e) {
      console.error('[import] watched film failed:', entry.title, e.message);
    } finally {
      await tick(entry.title);
    }
  })));

  console.log(
    `[import] complete — watchlist: ${watchlistEntries.length}, ` +
    `watched: ${watchedEntries.length}, ratings applied: ${ratingsApplied}`
  );

  await supabase.from('imports').update({
    status:          'complete',
    processed_count: processed,
    matched_count:   watchlistMatched + watchedMatched,
  }).eq('id', importId);
}

// POST /import/letterboxd — accepts a ZIP, kicks off background TMDB matching
app.post('/import/letterboxd', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  let entries;
  let watchedEntries = [];
  let ratingsMap = {};
  let reviewsMap = {};
  let extractedUsername = null;
  try {
    const dir = await unzipper.Open.buffer(req.file.buffer);
    // CSVs live at the export root, but some users zip inside a folder —
    // match either way.
    const findCsv = (name) => dir.files.find(f =>
      f.path === name || f.path.endsWith(`/${name}`));
    const readCsv = async (name) => {
      const f = findCsv(name);
      if (!f) return null;
      try { return (await f.buffer()).toString('utf8'); }
      catch (e) { console.error(`[import] ${name} read failed:`, e.message); return null; }
    };

    const wlText = await readCsv('watchlist.csv');
    if (!wlText) return res.status(400).json({ error: 'watchlist.csv not found in ZIP' });
    entries = parseWatchlistCsv(wlText);

    // watched.csv / ratings.csv / reviews.csv are optional — degrade gracefully
    const watchedText = await readCsv('watched.csv');
    if (watchedText) watchedEntries = parseWatchlistCsv(watchedText); // same shape
    const ratingsText = await readCsv('ratings.csv');
    if (ratingsText) ratingsMap = parseRatingsCsv(ratingsText);
    const reviewsText = await readCsv('reviews.csv');
    if (reviewsText) reviewsMap = parseReviewsCsv(reviewsText);

    // profile.csv → username (cosmetic; avoids the user typing it in)
    const profileText = await readCsv('profile.csv');
    if (profileText) {
      try {
        const profileRows = parseCsvRows(profileText);
        extractedUsername =
          profileRows[0]?.Username || profileRows[0]?.username || null;
      } catch (e) {
        console.error('[import] profile.csv parse failed:', e.message);
      }
    }
  } catch (e) {
    console.error('[import] zip parse failed:', e.message);
    return res.status(400).json({ error: 'Invalid Letterboxd export file' });
  }

  if (entries.length === 0 && watchedEntries.length === 0) {
    return res.status(400).json({ error: 'No films found in the export' });
  }

  const totalCount = entries.length + watchedEntries.length;

  // Update the Letterboxd username on the user's profile if the export
  // included one (cosmetic — used for display in account / sheet only).
  if (extractedUsername) {
    await supabase.from('profiles')
      .update({ letterboxd_username: extractedUsername })
      .eq('id', req.user.id)
      .then(({ error }) => {
        if (error) console.error('[import] profile username update failed:', error.message);
      });
  }

  const { data: importRow, error: importErr } = await supabase
    .from('imports')
    .insert({
      user_id:         req.user.id,
      status:          'processing',
      total_count:     totalCount,
      processed_count: 0,
      matched_count:   0,
    })
    .select()
    .single();

  if (importErr || !importRow) {
    console.error('[import] insert imports row failed:', importErr?.message);
    return res.status(500).json({ error: 'Could not create import record' });
  }

  // Fire-and-forget — frontend polls /import/:importId/status for progress
  processImport(req.user.id, importRow.id, {
    watchlistEntries: entries,
    watchedEntries,
    ratingsMap,
    reviewsMap,
  }).catch(async (e) => {
    console.error('[import] background processing crashed:', e);
    await supabase.from('imports')
      .update({ status: 'failed', error_message: e.message || 'unknown' })
      .eq('id', importRow.id);
  });

  res.json({ importId: importRow.id, totalCount });
});

// GET /import/:importId/status — polling endpoint for the progress overlay
app.get('/import/:importId/status', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('imports')
    .select('*')
    .eq('id', req.params.importId)
    .eq('user_id', req.user.id) // belt-and-braces; RLS would also block cross-user reads
    .single();
  if (error || !data) return res.status(404).json({ error: 'Import not found' });
  res.json({
    status:   data.status,
    imported: data.matched_count,
    progress: {
      current:     data.processed_count,
      total:       data.total_count,
      currentFilm: data.last_processed_title,
    },
    error: data.error_message || null,
  });
});

// GET /api/user-films — returns the user's imported films in the picker shape.
// Response is a bare array (no wrapper) so the frontend can do
// `state.watchlist = await res.json()` without any extra unwrapping.
app.get('/api/user-films', requireAuth, async (req, res) => {
  const { data, error } = await supabase
    .from('user_films')
    .select('*')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });
  if (error) {
    console.error('[user-films] select failed:', error.message);
    return res.status(500).json({ error: error.message });
  }
  console.log(`[user-films] ${req.user.id} → ${data?.length || 0} rows`);
  // Map to the picker's contract; year normalised to a string so the
  // filterWatchlist() parseInt(m.year) call keeps working.
  const films = (data || []).map(f => ({
    title:           f.title,
    year:            f.year ? String(f.year) : '',
    url:             f.letterboxd_url,
    poster:          f.poster_url,
    tmdb_id:         f.tmdb_id,
    runtime_minutes: f.runtime_minutes,
    synopsis:        f.synopsis,
    genres:          f.genres,
    director:        f.director,
    cast:            f.cast_list,
    user_rating:     f.user_rating,
    tmdb_rating:     f.tmdb_rating,
    youtube_id:      f.youtube_id,
    status:          f.status,
  }));
  res.json(films);
});

// ─── Explore (TMDB-backed film discovery) ────────────────────────────────────
//
// Three modes drive a single endpoint:
//   /api/explore?mode=trending                  → trending this week
//   /api/explore?mode=top_rated                 → all-time top rated
//   /api/explore?mode=search&q=parasite         → search by title
//   /api/explore?mode=discover&decade=1990      → filtered discover
// Plus POST /api/user-films/add for the "+ Add to watchlist" action.

async function tmdbFetch(path, params = {}) {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) {
    console.error('[explore] TMDB_API_KEY not set');
    return { error: 'TMDB not configured', status: 503 };
  }
  const q = new URLSearchParams({ ...params, api_key: apiKey });
  try {
    const res = await axios.get(`https://api.themoviedb.org/3${path}?${q}`, {
      validateStatus: () => true,
      timeout: 10000,
    });
    if (res.status !== 200) return { error: `TMDB ${res.status}`, status: res.status };
    return { data: res.data };
  } catch (e) {
    console.error('[explore] tmdb network error:', e.message);
    return { error: e.message, status: 500 };
  }
}

// Shape a TMDB list-style result into the explore-card contract the
// frontend expects. Note: list endpoints (trending/discover/search) don't
// return runtime or videos — those only come from /movie/:id, fetched at
// add-time inside /api/user-films/add.
function shapeTmdbCard(t) {
  if (!t || !t.id) return null;
  return {
    tmdb_id:        t.id,
    title:          t.title || t.original_title || 'Untitled',
    year:           t.release_date ? Number(t.release_date.slice(0, 4)) : null,
    poster_url:     t.poster_path
      ? `https://image.tmdb.org/t/p/w342${t.poster_path}` : null,
    overview:       t.overview || '',
    vote_average:   typeof t.vote_average === 'number'
      ? Math.round(t.vote_average * 10) / 10 : null,
    // Letterboxd has a stable redirect at letterboxd.com/tmdb/<id> that
    // resolves to the film page — used both for the "Also on Letterboxd"
    // link on the card and as the user_films.letterboxd_url on add.
    letterboxd_url: `https://letterboxd.com/tmdb/${t.id}/`,
  };
}

app.get('/api/explore', requireAuth, async (req, res) => {
  const mode = (req.query.mode || 'trending').toString();
  const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);

  let result;
  if (mode === 'search') {
    const q = (req.query.q || '').toString().trim();
    if (!q) return res.json({ films: [], page });
    result = await tmdbFetch('/search/movie', { query: q, page, include_adult: 'false' });
  } else if (mode === 'top_rated') {
    result = await tmdbFetch('/movie/top_rated', { page });
  } else if (mode === 'discover') {
    const params = {
      page,
      sort_by:        'popularity.desc',
      'vote_count.gte': 100,        // skip obscure films with <100 votes
      include_adult:  'false',
    };
    const decade = parseInt(req.query.decade || '', 10);
    if (decade) {
      params['primary_release_date.gte'] = `${decade}-01-01`;
      params['primary_release_date.lte'] = `${decade + 9}-12-31`;
    }
    if (req.query.genre) params.with_genres = req.query.genre.toString();
    result = await tmdbFetch('/discover/movie', params);
  } else {
    // default: trending this week
    result = await tmdbFetch('/trending/movie/week', { page });
  }

  if (result.error) {
    return res.status(result.status || 500).json({ error: result.error });
  }

  const cards = (result.data?.results || []).map(shapeTmdbCard).filter(Boolean);

  // Annotate films already in the user's watchlist so the frontend can
  // render "+ Add" vs "✓ In watchlist" without an extra round-trip.
  const tmdbIds = cards.map(c => c.tmdb_id);
  let inWatchlist = new Set();
  if (tmdbIds.length > 0) {
    const { data } = await supabase
      .from('user_films')
      .select('tmdb_id')
      .eq('user_id', req.user.id)
      .in('tmdb_id', tmdbIds);
    inWatchlist = new Set((data || []).map(r => r.tmdb_id));
  }

  const films = cards.map(c => ({ ...c, in_watchlist: inWatchlist.has(c.tmdb_id) }));
  res.json({ films, page });
});

// ─── Explore: "similar to" recommendation finder ─────────────────────────────
//
// Two-step flow:
//   1. GET /api/explore/search?title=...   → up to 5 disambiguation matches
//   2. GET /api/explore/similar?tmdbId=... → up to 20 TMDB recommendations,
//      each annotated with whether it's already in the user's watchlist.

// Annotate a list of TMDB cards with in_watchlist flags via one bulk lookup.
async function annotateWatchlist(userId, cards) {
  const tmdbIds = cards.map(c => c.tmdb_id).filter(Boolean);
  if (tmdbIds.length === 0) return cards.map(c => ({ ...c, in_watchlist: false }));
  const { data } = await supabase
    .from('user_films')
    .select('tmdb_id')
    .eq('user_id', userId)
    .in('tmdb_id', tmdbIds);
  const have = new Set((data || []).map(r => r.tmdb_id));
  return cards.map(c => ({ ...c, in_watchlist: have.has(c.tmdb_id) }));
}

app.get('/api/explore/search', requireAuth, async (req, res) => {
  const title = (req.query.title || '').toString().trim();
  if (!title) return res.status(400).json({ error: 'title required' });

  const result = await tmdbFetch('/search/movie', {
    query: title,
    include_adult: 'false',
  });
  if (result.error) return res.status(result.status || 500).json({ error: result.error });

  const results = (result.data?.results || [])
    .slice(0, 5)
    .map(shapeTmdbCard)
    .filter(Boolean);
  res.json({ results });
});

app.get('/api/explore/similar', requireAuth, async (req, res) => {
  const tmdbId = parseInt(req.query.tmdbId ?? req.query.tmdb_id, 10);
  if (!tmdbId) return res.status(400).json({ error: 'tmdbId required' });

  // Recommendations + source details in parallel
  const [recRes, srcRes] = await Promise.all([
    tmdbFetch(`/movie/${tmdbId}/recommendations`),
    tmdbFetch(`/movie/${tmdbId}`),
  ]);
  if (recRes.error) return res.status(recRes.status || 500).json({ error: recRes.error });

  let cards = (recRes.data?.results || [])
    .slice(0, 20)
    .map(shapeTmdbCard)
    .filter(Boolean);
  cards = await annotateWatchlist(req.user.id, cards);

  const src = srcRes.data || {};
  res.json({
    source: {
      tmdb_id: tmdbId,
      title:   src.title || null,
      year:    src.release_date ? Number(src.release_date.slice(0, 4)) : null,
    },
    results: cards,
  });
});

// Shared: search for a person by name, pull their movie_credits, and run
// `pick` over the response to select+order the relevant films. Returns up to
// 20 shaped cards annotated with in_watchlist. Used by director + actor below.
async function personFilmography(userId, name, excludeId, pick) {
  const search = await tmdbFetch('/search/person', { query: name });
  if (search.error) return { error: search.error, status: search.status };
  const person = search.data?.results?.[0];
  if (!person) return { person: null, results: [] };

  const credits = await tmdbFetch(`/person/${person.id}/movie_credits`);
  if (credits.error) return { error: credits.error, status: credits.status };

  const seen = new Set();
  const cards = [];
  for (const m of pick(credits.data || {})) {
    if (!m.id || m.id === excludeId || seen.has(m.id)) continue;
    seen.add(m.id);
    const card = shapeTmdbCard(m);
    if (card) cards.push(card);
    if (cards.length >= 20) break;
  }
  const results = await annotateWatchlist(userId, cards);
  return { person: { name: person.name, id: person.id }, results };
}

// GET /api/explore/director?name=...&excludeTmdbId=...
app.get('/api/explore/director', requireAuth, async (req, res) => {
  try {
    const name = (req.query.name || '').toString().trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    const excludeId = parseInt(req.query.excludeTmdbId, 10) || null;
    const out = await personFilmography(req.user.id, name, excludeId, data =>
      (data.crew || [])
        .filter(f => f.job === 'Director')
        .sort((a, b) => (b.popularity || 0) - (a.popularity || 0)));
    if (out.error) return res.status(out.status || 500).json({ error: out.error });
    res.json(out);
  } catch (err) {
    console.error('[explore/director] failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/explore/actor?name=...&excludeTmdbId=...
app.get('/api/explore/actor', requireAuth, async (req, res) => {
  try {
    const name = (req.query.name || '').toString().trim();
    if (!name) return res.status(400).json({ error: 'name required' });
    const excludeId = parseInt(req.query.excludeTmdbId, 10) || null;
    const out = await personFilmography(req.user.id, name, excludeId, data =>
      (data.cast || []).sort((a, b) => (a.order ?? 999) - (b.order ?? 999)));
    if (out.error) return res.status(out.status || 500).json({ error: out.error });
    res.json(out);
  } catch (err) {
    console.error('[explore/actor] failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/user-watched — the user's watched films (from the Letterboxd export)
app.get('/api/user-watched', requireAuth, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('user_watched')
      .select('*')
      .eq('user_id', req.user.id)
      .order('watched_date', { ascending: false, nullsFirst: false });
    if (error) {
      console.error('[user-watched] select failed:', error.message);
      return res.status(500).json({ error: error.message });
    }
    const films = (data || []).map(f => ({
      title:          f.title,
      year:           f.year,
      url:            f.letterboxd_url,
      poster:         f.poster_url,
      userRating:     f.user_rating,
      watchedDate:    f.watched_date,
      review:         f.review,
      director:       f.director,
      cast:           f.cast_list,
      genres:         f.genres,
      synopsis:       f.synopsis,
      runtimeMinutes: f.runtime_minutes,
      tmdbRating:     f.tmdb_rating,
      youtubeId:      f.youtube_id,
      tmdbId:         f.tmdb_id,
    }));
    console.log(`[user-watched] ${req.user.id} → ${films.length} rows`);
    res.json(films);
  } catch (err) {
    console.error('[user-watched] failed:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/user-films/add  body: { tmdb_id: 12345 }
// Adds a single film to the user's watchlist. Fetches full TMDB details
// (including videos for the trailer key) so the picker + trailers feed
// have everything they need without a follow-up backfill.
app.post('/api/user-films/add', requireAuth, async (req, res) => {
  try {
    // Accept either tmdb_id (Explore browse cards) or tmdbId (similar-to flow).
    const tmdbId = parseInt(req.body?.tmdb_id ?? req.body?.tmdbId, 10);
    if (!tmdbId) return res.status(400).json({ error: 'tmdb_id required' });

    // App-level dedup on (user_id, tmdb_id). The existing unique index is on
    // (user_id, letterboxd_url) which won't catch this case — a film added
    // via Explore (tmdb-style URL) and the same film imported from
    // Letterboxd (slug-style URL) are different URLs for the same row.
    const { data: existing, error: selErr } = await supabase
      .from('user_films')
      .select('id')
      .eq('user_id', req.user.id)
      .eq('tmdb_id', tmdbId)
      .maybeSingle();
    if (selErr) {
      console.error('[user-films/add] dedup select failed:', selErr.message);
      return res.status(500).json({ error: selErr.message });
    }
    if (existing) return res.json({ ok: true, already_in_watchlist: true });

    const details = await tmdbFetch(`/movie/${tmdbId}`, { append_to_response: 'videos,credits' });
    if (details.error) {
      console.error('[user-films/add] tmdb fetch failed:', details.error);
      return res.status(details.status || 500).json({ error: details.error });
    }
    const d = details.data;
    if (!d?.title) return res.status(404).json({ error: 'Film not found on TMDB' });

    const trailer =
      d.videos?.results?.find(v => v.site === 'YouTube' && v.type === 'Trailer') ||
      d.videos?.results?.find(v => v.site === 'YouTube' && v.type === 'Teaser')  ||
      d.videos?.results?.find(v => v.site === 'YouTube');
    const director = d.credits?.crew?.find(p => p.job === 'Director')?.name || null;
    const castList = (d.credits?.cast || []).slice(0, 5).map(p => p.name);

    const row = {
      user_id:         req.user.id,
      title:           d.title,
      year:            d.release_date ? parseInt(d.release_date.slice(0, 4), 10) : null,
      letterboxd_url:  `https://letterboxd.com/tmdb/${tmdbId}/`,
      tmdb_id:         tmdbId,
      poster_url:      d.poster_path ? `https://image.tmdb.org/t/p/w500${d.poster_path}` : null,
      runtime_minutes: d.runtime || null,
      synopsis:        d.overview || null,
      genres:          (d.genres || []).map(g => g.name),
      director:        director,
      cast_list:       castList.length ? castList : null,
      tmdb_rating:     d.vote_average ?? null,
      youtube_id:      trailer?.key || null,
      status:          'ready',
      added_via:       'explore',
    };

    const { error } = await supabase.from('user_films').insert(row);
    if (error) {
      console.error('[user-films/add] insert failed:', error.message);
      return res.status(500).json({ error: error.message });
    }
    console.log(`[user-films/add] ${req.user.id} → tmdb:${tmdbId} (${d.title})`);
    res.json({ ok: true, added: true });
  } catch (err) {
    console.error('[user-films/add] failed:', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// GET /api/unsubscribe?uid=... — no auth required; called from email unsubscribe link
app.get('/api/unsubscribe', async (req, res) => {
  const { uid } = req.query;
  if (!uid || !supabase) {
    return res.status(400).send('Invalid request.');
  }
  await supabase.from('profiles').update({ digest_opt_in: false }).eq('id', uid);
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Unsubscribed &middot; WatchWheel</title>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;1,9..144,400&display=swap" rel="stylesheet">
  <style>
    body { margin:0; padding:0; background:#f0e9d8; display:flex; align-items:center; justify-content:center; min-height:100vh; }
    .card { max-width:420px; padding:48px 40px; text-align:center; }
    .wordmark { font-family:'Fraunces',Georgia,serif; font-size:11px; letter-spacing:0.22em; text-transform:uppercase; color:#1a2333; margin:0 0 24px; }
    .rule { height:1px; background:#b8956a; opacity:0.5; margin:0 0 28px; }
    h1 { font-family:'Fraunces',Georgia,serif; font-size:26px; font-weight:400; color:#1a2333; margin:0 0 16px; line-height:1.15; }
    p { font-family:'Fraunces',Georgia,serif; font-style:italic; font-size:14px; color:#5a6272; line-height:1.6; margin:0; }
  </style>
</head>
<body>
  <div class="card">
    <p class="wordmark">WATCHWHEEL</p>
    <div class="rule"></div>
    <h1>The programme has been cancelled.</h1>
    <p>You won&rsquo;t receive any more digest emails. You can re-enable them from your account settings at any time.</p>
  </div>
</body>
</html>`);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
