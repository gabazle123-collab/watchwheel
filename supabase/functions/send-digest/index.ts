// WatchWheel — send-digest Edge Function
// Triggered hourly by pg_cron. Finds users whose digest_hour matches the
// current hour in their timezone, picks 5 films, and sends via Resend.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically
// into every Edge Function — no need to set them as secrets.
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const RESEND_KEY  = Deno.env.get('RESEND_API_KEY')!;
const CRON_SECRET = Deno.env.get('CRON_SECRET')!;
const RENDER_URL  = Deno.env.get('RENDER_API_URL') || 'https://watchwheel.onrender.com';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Profile {
  id: string;
  letterboxd_username: string;
  digest_hour: number;
  digest_count: number;
  timezone: string;
}

interface Movie { title: string; year: string; url: string; }

// ── Film-picking algorithm ────────────────────────────────────────────────────

const TAGLINES = [
  'For an evening when the world feels far away.',
  'Dim the lights. Let it work on you slowly.',
  'A picture to be watched once and remembered always.',
  'The kind of film one returns to in different weather.',
  'Hardly a film — more a long, held breath.',
  'For the hours after, not just the hours during.',
  'A near-silent meditation on what is left unsaid.',
  'Worth the discomfort. Worth the silence after.',
  'Begin it without expectation.',
  'The sort of film that changes depending on when you see it.',
];

function pickDigestFilms(
  watchlist: Movie[],
  recentlyServed: string[],
  runtimeCache: Map<string, number>,
): Movie[] {
  // Prefer films not served in the last 14 days; fall back to full list if needed
  let pool = watchlist.filter(m => !recentlyServed.includes(m.url));
  if (pool.length < 5) pool = watchlist.slice();

  const used = new Set<string>();

  function pickFrom(candidates: Movie[]): Movie | null {
    const avail = candidates.filter(m => !used.has(m.url));
    if (!avail.length) return null;
    const pick = avail[Math.floor(Math.random() * avail.length)];
    used.add(pick.url);
    return pick;
  }

  const picks: Movie[] = [];

  // Constraint 1: at least one film from before 1990
  const pre1990 = pool.filter(m => {
    const y = parseInt(m.year);
    return !isNaN(y) && y < 1990;
  });
  const oldPick = pickFrom(pre1990);
  if (oldPick) picks.push(oldPick);

  // Constraint 2: at least one short film (<90 min) — only when runtime is cached
  const shorts = pool.filter(m => {
    const rt = runtimeCache.get(m.url);
    return rt !== undefined && rt < 90;
  });
  const shortPick = pickFrom(shorts);
  if (shortPick) picks.push(shortPick);

  // Fill remaining picks from the open pool
  while (picks.length < 5) {
    const pick = pickFrom(pool);
    if (!pick) break;
    picks.push(pick);
  }

  // Shuffle so the editorial constraints aren't always the first two entries
  return picks.sort(() => Math.random() - 0.5);
}

// ── Data fetching ─────────────────────────────────────────────────────────────

async function fetchWatchlist(username: string): Promise<Movie[]> {
  const res = await fetch(`${RENDER_URL}/watchlist/${username}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.movies || [];
}

async function fetchPoster(movieUrl: string): Promise<string | null> {
  try {
    const res  = await fetch(`${RENDER_URL}/poster?url=${encodeURIComponent(movieUrl)}`);
    const data = await res.json();
    return data.image || null;
  } catch { return null; }
}

async function getRecentlyServed(userId: string): Promise<string[]> {
  const cutoff = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
  const { data } = await supabase
    .from('digest_sends')
    .select('film_urls')
    .eq('user_id', userId)
    .gte('sent_at', cutoff);
  return (data || []).flatMap((row: { film_urls: string[] }) => row.film_urls);
}

async function getCachedMetadata(
  urls: string[]
): Promise<{ runtimes: Map<string, number>; posters: Map<string, string> }> {
  const { data } = await supabase
    .from('film_metadata_cache')
    .select('letterboxd_url, runtime_minutes, poster_url')
    .in('letterboxd_url', urls);

  const runtimes = new Map<string, number>();
  const posters  = new Map<string, string>();
  for (const row of data || []) {
    if (row.runtime_minutes != null) runtimes.set(row.letterboxd_url, row.runtime_minutes);
    if (row.poster_url)              posters.set(row.letterboxd_url,  row.poster_url);
  }
  return { runtimes, posters };
}

// ── Email builder ─────────────────────────────────────────────────────────────

function italiciseLastWord(title: string): string {
  const words = title.split(' ');
  if (words.length === 1) return `<em style="color:#7a5a3a;">${title}</em>`;
  const idx = words.length > 2 ? words.length - 1 : 1;
  words[idx] = `<em style="font-style:italic; color:#7a5a3a;">${words[idx]}</em>`;
  return words.join(' ');
}

function buildEmail(params: {
  picks:       Movie[];
  posters:     Map<string, string>;
  runtimes:    Map<string, number>;
  digestNo:    number;
  userId:      string;
  renderUrl:   string;
}): string {
  const { picks, posters, runtimes, digestNo, userId, renderUrl } = params;
  const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const day  = days[new Date().getDay()];

  const filmRows = picks.map((film, i) => {
    const poster    = posters.get(film.url);
    const runtime   = runtimes.get(film.url);
    const metaParts = [film.year, runtime ? `${runtime} min` : ''].filter(Boolean);
    const tagline   = TAGLINES[i % TAGLINES.length];

    const posterCell = poster
      ? `<td width="72" style="vertical-align:top; padding-right:16px;">
           <img src="${poster}" width="72" alt="${film.title}"
                style="display:block; width:72px; height:104px; object-fit:cover; border-radius:3px;">
         </td>`
      : `<td width="72" style="vertical-align:top; padding-right:16px;">
           <div style="width:72px; height:104px; background:#d4cfc6; border-radius:3px;"></div>
         </td>`;

    return `
      <tr>
        <td style="padding-bottom:22px;">
          <table cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
            ${posterCell}
            <td style="vertical-align:top;">
              <p style="margin:0 0 3px; font-family:'Fraunces',Georgia,serif; font-size:17px; font-weight:400; color:#1a2333; line-height:1.2;">
                ${italiciseLastWord(film.title)}
              </p>
              <p style="margin:0 0 8px; font-family:Arial,sans-serif; font-size:10px; letter-spacing:0.12em; text-transform:uppercase; color:#9a907d;">
                ${metaParts.join(' &nbsp;·&nbsp; ')}
              </p>
              <p style="margin:0 0 8px; font-family:'Fraunces',Georgia,serif; font-style:italic; font-size:13px; color:#5a6272; line-height:1.5;">
                ${tagline}
              </p>
              <a href="${film.url}" style="font-family:Arial,sans-serif; font-size:10px; letter-spacing:0.12em; text-transform:uppercase; color:#b8956a; text-decoration:none;">
                View on Letterboxd &rarr;
              </a>
            </td>
          </tr></table>
        </td>
      </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Tonight&#8217;s programme &middot; No.&nbsp;${digestNo}</title>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;1,9..144,400&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:#f0e9d8;">
<table cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#f0e9d8;">
  <tr><td align="center" style="padding:36px 16px;">
    <table cellpadding="0" cellspacing="0" border="0" width="520" style="max-width:520px;width:100%;">

      <!-- Wordmark -->
      <tr><td style="padding-bottom:18px;">
        <p style="margin:0;font-family:'Fraunces',Georgia,serif;font-size:12px;font-weight:400;letter-spacing:0.22em;text-transform:uppercase;color:#1a2333;">
          WATCHWHEEL
        </p>
      </td></tr>

      <!-- Amber rule -->
      <tr><td style="padding-bottom:16px;">
        <div style="height:1px;background:#b8956a;opacity:0.5;"></div>
      </td></tr>

      <!-- Eyebrow + headline -->
      <tr><td style="padding-bottom:24px;">
        <p style="margin:0 0 8px;font-family:'Fraunces',Georgia,serif;font-style:italic;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:#b8956a;">
          &mdash;&nbsp;Tonight&#8217;s Programme
        </p>
        <p style="margin:0;font-family:'Fraunces',Georgia,serif;font-size:28px;font-weight:400;color:#1a2333;line-height:1.12;">
          No.&nbsp;${digestNo} &nbsp;&middot;&nbsp; A <em>${day}</em> evening.
        </p>
      </td></tr>

      <!-- Divider -->
      <tr><td style="padding-bottom:22px;">
        <div style="height:1px;background:rgba(26,35,51,0.12);"></div>
      </td></tr>

      <!-- Films -->
      <tr><td>
        <table cellpadding="0" cellspacing="0" border="0" width="100%">
          ${filmRows}
        </table>
      </td></tr>

      <!-- Footer divider -->
      <tr><td style="padding-top:4px;padding-bottom:18px;">
        <div style="height:1px;background:rgba(26,35,51,0.12);"></div>
      </td></tr>

      <!-- Footer -->
      <tr><td>
        <p style="margin:0 0 12px;font-family:'Fraunces',Georgia,serif;font-style:italic;font-size:12px;color:#9a907d;line-height:1.6;">
          &mdash;&nbsp;Edited and curated for you. Sleep on the choices you don&#8217;t pick.
        </p>
        <a href="${renderUrl}/api/unsubscribe?uid=${userId}"
           style="font-family:Arial,sans-serif;font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:#9a907d;text-decoration:none;">
          Unsubscribe
        </a>
      </td></tr>

    </table>
  </td></tr>
</table>
</body>
</html>`;
}

// ── Send one user's digest ────────────────────────────────────────────────────

async function sendDigest(user: Profile, email: string): Promise<void> {
  const watchlist = await fetchWatchlist(user.letterboxd_username);
  if (watchlist.length === 0) return;

  const urls = watchlist.map(m => m.url);
  const [recentlyServed, { runtimes, posters }] = await Promise.all([
    getRecentlyServed(user.id),
    getCachedMetadata(urls),
  ]);

  const picks = pickDigestFilms(watchlist, recentlyServed, runtimes);
  if (picks.length === 0) return;

  // Fetch missing posters in parallel — each also warms the /poster cache on Render
  await Promise.allSettled(picks.map(async (film) => {
    if (posters.has(film.url)) return;
    const img = await fetchPoster(film.url);
    if (img) posters.set(film.url, img);
  }));

  const digestNo = user.digest_count + 1;
  const html     = buildEmail({ picks, posters, runtimes, digestNo, userId: user.id, renderUrl: RENDER_URL });

  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${RESEND_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      from:    'WatchWheel <onboarding@resend.dev>',
      to:      [email],
      subject: `Tonight’s programme · No. ${digestNo}`,
      html,
    }),
  });

  if (!emailRes.ok) {
    const body = await emailRes.text();
    throw new Error(`Resend API error ${emailRes.status}: ${body}`);
  }

  // Record the send and increment the user's digest counter
  await Promise.all([
    supabase.from('digest_sends').insert({
      user_id:       user.id,
      digest_number: digestNo,
      film_urls:     picks.map(p => p.url),
    }),
    supabase.from('profiles')
      .update({ digest_count: digestNo })
      .eq('id', user.id),
  ]);
}

// ── Entry point ───────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  // Guard: only pg_cron (or a manual test curl) may trigger this
  if (req.headers.get('Authorization') !== `Bearer ${CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  // Fetch all opted-in users with a Letterboxd username
  const { data: profiles, error } = await supabase
    .from('profiles')
    .select('id, letterboxd_username, digest_hour, digest_count, timezone')
    .eq('digest_opt_in', true)
    .not('letterboxd_username', 'is', null);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Get emails from auth.users via admin API
  const { data: authData } = await supabase.auth.admin.listUsers({ perPage: 1000 });
  const emailMap = new Map<string, string>();
  for (const u of authData?.users ?? []) {
    if (u.email) emailMap.set(u.id, u.email);
  }

  // Filter to users whose local hour matches their preferred digest_hour right now
  const now = new Date();
  const due = (profiles as Profile[]).filter(user => {
    try {
      const localHour = parseInt(
        new Intl.DateTimeFormat('en-US', {
          timeZone: user.timezone || 'UTC',
          hour:     'numeric',
          hour12:   false,
        }).format(now)
      );
      return localHour === user.digest_hour;
    } catch { return false; }
  });

  // Send digests sequentially to avoid hammering Render
  const results: { id: string; ok: boolean; error?: string }[] = [];
  for (const user of due) {
    const email = emailMap.get(user.id);
    if (!email) continue;
    try {
      await sendDigest(user, email);
      results.push({ id: user.id, ok: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`Digest failed for ${user.id}:`, msg);
      results.push({ id: user.id, ok: false, error: msg });
    }
  }

  return new Response(
    JSON.stringify({
      checked: profiles.length,
      due:     due.length,
      sent:    results.filter(r => r.ok).length,
      results,
    }),
    { headers: { 'Content-Type': 'application/json' } }
  );
});
