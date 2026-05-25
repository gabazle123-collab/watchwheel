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

async function scrapeWatchlist(username) {
  const firstUrl = `https://letterboxd.com/${username}/watchlist/`;
  const firstResponse = await axios.get(firstUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    }
  });
  const $first = cheerio.load(firstResponse.data);
  const total = parseInt($first('.js-watchlist-content').attr('data-num-entries') || '0');
  const totalPages = Math.ceil(total / 28);

  const pageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1);

  const pageResponses = await Promise.all(
    pageNumbers.map(page =>
      axios.get(`https://letterboxd.com/${username}/watchlist/page/${page}/`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        }
      })
    )
  );

  const movies = [];
  for (const response of pageResponses) {
    const $ = cheerio.load(response.data);
    $('[data-item-name]').each((_, el) => {
      const fullName = $(el).attr('data-item-name');
      const link = $(el).attr('data-item-link');
      const yearMatch = fullName.match(/\((\d{4})\)$/);
      const year = yearMatch ? yearMatch[1] : '';
      const title = fullName.replace(/\s*\(\d{4}\)$/, '').trim();
      if (title) {
        movies.push({ title, year, url: 'https://letterboxd.com' + link });
      }
    });
  }

  return movies;
}

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

app.get('/watchlist/:username', async (req, res) => {
  try {
    const movies = await scrapeWatchlist(req.params.username);
    res.json({ movies });
  } catch (error) {
    console.error('Scrape error:', error.response?.status, error.message);
    res.status(500).json({ error: 'Failed to scrape', status: error.response?.status });
  }
});

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
// Waterfall is sequential per film but parallel across films — 20 Letterboxd
// scrapes fire at once; tier 2/3 only run for films where earlier tiers missed.
app.post('/trailers/batch', async (req, res) => {
  const films = Array.isArray(req.body?.films) ? req.body.films.slice(0, 20) : [];
  if (films.length === 0) return res.json({ trailers: [] });

  const results = await Promise.all(films.map(async (f) => {
    const r = await getTrailerForFilm({ title: f.title, year: f.year, filmUrl: f.url });
    return { url: f.url, youtube_id: r.youtube_id, source: r.source || null, error: r.error };
  }));

  // Per-tier summary. `cache` covers films served from the DB cache (where
  // we don't know which YouTube tier originally produced the hit). The
  // youtube_trailer / youtube_teaser columns count THIS-batch fresh searches,
  // so they're the only ones that cost quota — useful for spotting drift.
  const counts = { cache: 0, youtube_trailer: 0, youtube_teaser: 0, none: 0 };
  for (const r of results) {
    if (r.youtube_id && r.source && counts[r.source] !== undefined) counts[r.source]++;
    else counts.none++;
  }
  const hits  = films.length - counts.none;
  const quota = results.some(r => r.error === 'quota_exceeded');
  console.log(
    `[trailers/batch] ${films.length} films → ${hits} trailers found ` +
    `(cache: ${counts.cache}, youtube_trailer: ${counts.youtube_trailer}, ` +
    `youtube_teaser: ${counts.youtube_teaser}, none: ${counts.none})` +
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
  // append_to_response=videos folds details + videos into a single request
  try {
    const res = await axios.get(
      `https://api.themoviedb.org/3/movie/${tmdbId}?api_key=${apiKey}&append_to_response=videos`,
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
    }))
    .filter(r => r.title && r.letterboxd_url);
}

// Background processing — walks the entries, hits TMDB, upserts user_films,
// updates the imports row's progress counters. Runs async; the HTTP response
// for /import/letterboxd has already been sent by the time this kicks off.
async function processImport(userId, importId, entries) {
  let processed = 0;
  let matched   = 0;
  // Throttle progress writes to every 3 films (avoid 400 UPDATEs for a 400-film import).
  const writeProgress = async (title) => {
    await supabase.from('imports').update({
      processed_count:      processed,
      matched_count:        matched,
      last_processed_title: title,
    }).eq('id', importId);
  };

  await Promise.all(entries.map(entry => limitTmdb(async () => {
    try {
      const hit = await searchTmdb(entry.title, entry.year);
      let row = {
        user_id:        userId,
        title:          entry.title,
        year:           entry.year,
        letterboxd_url: entry.letterboxd_url,
        tmdb_id:        null,
        poster_url:     null,
        runtime:        null,
        synopsis:       null,
        genres:         null,
        youtube_id:     null,
        status:         'unmatched',
      };
      if (hit?.id) {
        const details = await fetchTmdbDetails(hit.id);
        const trailer =
          details?.videos?.results?.find(v => v.site === 'YouTube' && v.type === 'Trailer') ||
          details?.videos?.results?.find(v => v.site === 'YouTube' && v.type === 'Teaser')  ||
          details?.videos?.results?.find(v => v.site === 'YouTube');
        row = {
          ...row,
          tmdb_id:    hit.id,
          poster_url: details?.poster_path
            ? `https://image.tmdb.org/t/p/w500${details.poster_path}`
            : (hit.poster_path ? `https://image.tmdb.org/t/p/w500${hit.poster_path}` : null),
          runtime:    details?.runtime || null,
          synopsis:   details?.overview || hit.overview || null,
          genres:     details?.genres?.map(g => g.name) || null,
          youtube_id: trailer?.key || null,
          status:     'ready',
        };
        matched++;
      }
      const { error } = await supabase
        .from('user_films')
        .upsert(row, { onConflict: 'user_id,letterboxd_url' });
      if (error) console.error('[import] upsert failed:', entry.title, error.message);
    } catch (e) {
      console.error('[import] film failed:', entry.title, e.message);
    } finally {
      processed++;
      if (processed % 3 === 0 || processed === entries.length) {
        await writeProgress(entry.title).catch(() => {});
      }
    }
  })));

  await supabase.from('imports').update({
    status:          'complete',
    processed_count: processed,
    matched_count:   matched,
  }).eq('id', importId);
}

// POST /import/letterboxd — accepts a ZIP, kicks off background TMDB matching
app.post('/import/letterboxd', requireAuth, upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  let entries;
  let extractedUsername = null;
  try {
    const dir = await unzipper.Open.buffer(req.file.buffer);
    // watchlist.csv lives at the root of the export, but some users zip it
    // inside a folder — match either way.
    const wl = dir.files.find(f =>
      f.path === 'watchlist.csv' || f.path.endsWith('/watchlist.csv')
    );
    if (!wl) return res.status(400).json({ error: 'watchlist.csv not found in ZIP' });
    const csvBuf = await wl.buffer();
    entries = parseWatchlistCsv(csvBuf.toString('utf8'));

    // Letterboxd exports also include profile.csv with the user's username.
    // Pull it so we can populate profiles.letterboxd_username without the
    // user having to type it in.
    const profileEntry = dir.files.find(f =>
      f.path === 'profile.csv' || f.path.endsWith('/profile.csv')
    );
    if (profileEntry) {
      try {
        const profileBuf = await profileEntry.buffer();
        const profileRows = parseCsv(profileBuf.toString('utf8'), {
          columns: true, skip_empty_lines: true, trim: true, relax_quotes: true,
          relax_column_count: true,
        });
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

  if (entries.length === 0) {
    return res.status(400).json({ error: 'watchlist.csv is empty' });
  }

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
      total_count:     entries.length,
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
  processImport(req.user.id, importRow.id, entries).catch(async (e) => {
    console.error('[import] background processing crashed:', e);
    await supabase.from('imports')
      .update({ status: 'failed', error_message: e.message || 'unknown' })
      .eq('id', importRow.id);
  });

  res.json({ importId: importRow.id, totalCount: entries.length });
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
    title:      f.title,
    year:       f.year ? String(f.year) : '',
    url:        f.letterboxd_url,
    poster:     f.poster_url,
    tmdb_id:    f.tmdb_id,
    runtime:    f.runtime,
    synopsis:   f.synopsis,
    genres:     f.genres,
    youtube_id: f.youtube_id,
    status:     f.status,
  }));
  res.json(films);
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
