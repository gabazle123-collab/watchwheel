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
  try {
    const filmUrl = req.query.url;
    const response = await axios.get(filmUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      }
    });
    const $ = cheerio.load(response.data);
    const image = $('meta[property="og:image"]').attr('content') || null;

    // Tagline — Letterboxd puts it in <h4 class="tagline">
    const tagline = $('h4.tagline').first().text().trim() || null;

    // Extract runtime + synopsis from JSON-LD, then fall back to meta description
    let runtimeMinutes = null;
    let synopsis       = null;
    const ldJson = $('script[type="application/ld+json"]').first().html();
    if (ldJson) {
      try {
        const ld = JSON.parse(ldJson);
        runtimeMinutes = parseIso8601Duration(ld.duration);
        if (ld.description) synopsis = ld.description.trim();
      } catch {}
    }
    if (!synopsis) {
      const metaDesc = $('meta[name="description"]').attr('content') || null;
      if (metaDesc) synopsis = metaDesc.trim();
    }

    if (supabase && filmUrl) {
      const upsertData = { letterboxd_url: filmUrl, cached_at: new Date().toISOString() };
      if (image)          upsertData.poster_url      = image;
      if (runtimeMinutes) upsertData.runtime_minutes = runtimeMinutes;
      supabase.from('film_metadata_cache').upsert(upsertData, { onConflict: 'letterboxd_url' })
        .catch(() => {});
    }

    res.json({ image, tagline, synopsis, runtime_minutes: runtimeMinutes });
  } catch (e) {
    res.json({ image: null, runtime_minutes: null });
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
