import express from 'express';
import cors from 'cors';
import axios from 'axios';
import * as cheerio from 'cheerio';
import supabase from './supabase.js';

const app = express();
app.use(cors());
app.use(express.json());

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
      headers: {
        'User-Agent':                'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept':                    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
        'Accept-Language':           'en-US,en;q=0.9',
        'Accept-Encoding':           'gzip, deflate, br',
        'DNT':                       '1',
        'Upgrade-Insecure-Requests': '1',
        'Cache-Control':             'no-cache',
      },
    });

    console.log(`[poster] ${filmUrl} → HTTP ${response.status} (${String(response.data).length} bytes)`);

    if (response.status !== 200) {
      console.warn(`[poster] Non-200 from Letterboxd — skipping scrape`);
    } else {
      const $ = cheerio.load(response.data);

      image   = $('meta[property="og:image"]').attr('content') || null;
      tagline = $('h4.tagline').first().text().trim() || null;

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
        const upsertData = { letterboxd_url: filmUrl, cached_at: new Date().toISOString() };
        if (image)          upsertData.poster_url      = image;
        if (runtimeMinutes) upsertData.runtime_minutes = runtimeMinutes;
        supabase.from('film_metadata_cache').upsert(upsertData, { onConflict: 'letterboxd_url' })
          .catch((err) => console.error('[poster] cache upsert error:', err.message));
      }
    }
  } catch (e) {
    console.error(`[poster] fetch error for ${filmUrl}:`, e.message);
  }

  res.json({ image, tagline, synopsis, runtime_minutes: runtimeMinutes });
});

// ── YouTube trailers ─────────────────────────────────────────────────────────

async function searchYouTubeTrailer(title, year) {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    console.error('[trailer] YOUTUBE_API_KEY not set');
    return { youtube_id: null, error: 'no_api_key' };
  }

  const q = `${title} ${year || ''} official trailer`.trim();
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

    const videoId = res.data?.items?.[0]?.id?.videoId || null;
    return { youtube_id: videoId };
  } catch (e) {
    console.error('[trailer] fetch error:', e.message);
    return { youtube_id: null, error: 'fetch_error' };
  }
}

// Cache-aware single-film trailer lookup
async function getTrailerForFilm({ title, year, filmUrl }) {
  // Cache check — trailer_checked_at being set means we already searched
  if (supabase && filmUrl) {
    const { data: cached } = await supabase
      .from('film_metadata_cache')
      .select('youtube_id, trailer_checked_at')
      .eq('letterboxd_url', filmUrl)
      .maybeSingle();

    if (cached?.trailer_checked_at) {
      return { youtube_id: cached.youtube_id || null, cached: true };
    }
  }

  // Cache miss — hit YouTube
  const result = await searchYouTubeTrailer(title, year);

  // Don't cache transient errors (quota / network) — only definitive results
  if (result.error === 'quota_exceeded' || result.error === 'fetch_error' || result.error === 'api_error') {
    return result;
  }

  if (supabase && filmUrl) {
    supabase.from('film_metadata_cache').upsert({
      letterboxd_url:     filmUrl,
      youtube_id:         result.youtube_id,
      trailer_checked_at: new Date().toISOString(),
      cached_at:          new Date().toISOString(),
    }, { onConflict: 'letterboxd_url' })
      .then(({ error }) => { if (error) console.error('[trailer] cache upsert error:', error.message); });
  }

  return result;
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
app.post('/trailers/batch', async (req, res) => {
  const films = Array.isArray(req.body?.films) ? req.body.films.slice(0, 20) : [];
  if (films.length === 0) return res.json({ trailers: [] });

  const trailers = await Promise.all(films.map(async (f) => {
    const r = await getTrailerForFilm({ title: f.title, year: f.year, filmUrl: f.url });
    return { url: f.url, youtube_id: r.youtube_id, ...(r.error ? { error: r.error } : {}) };
  }));

  const hits  = trailers.filter(t => t.youtube_id).length;
  const quota = trailers.some(t => t.error === 'quota_exceeded');
  console.log(`[trailers/batch] ${films.length} films → ${hits} trailers found${quota ? ' (quota exceeded mid-batch)' : ''}`);

  res.json({ trailers });
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
