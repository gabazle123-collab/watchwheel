// ── Config ────────────────────────────────────────────────────────────────────

const SUPABASE_URL      = 'https://myavvindcywasqstoaze.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im15YXZ2aW5kY3l3YXNxc3RvYXplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2MTk4NDksImV4cCI6MjA5NTE5NTg0OX0.qbTk9KFribC9GzOX5FsfTuWMPJK4jsOYLHUYpG1tKbk';
const API_BASE          = 'https://watchwheel.onrender.com';

// supabase is the UMD global injected by the CDN script in index.html
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ── State ─────────────────────────────────────────────────────────────────────

const state = {
  // auth
  session:  null,
  user:     null,
  profile:  null,
  // existing
  username:      localStorage.getItem('ww_username') || null,
  watchlist:     [],
  selectedMoods: new Set(),
  moodText:      '',
  decade:        null,
  runtime:       null,
  history:       JSON.parse(localStorage.getItem('ww_history') || '[]'),
  currentMovie:  null,
  // wizard
  wizUsername:    '',
  wizDigestOptIn: true,
  wizDigestHour:  18,
};

// ── Core helpers ──────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);
const logo = document.querySelector('.logo');

const ALL_SCREENS = [
  'auth-entry', 'auth-signup', 'auth-signin',
  'wizard',
  'home', 'screening', 'library', 'account', 'trailers',
];

function show(screenId) {
  ALL_SCREENS.forEach(id => {
    const el = $(id);
    if (el) el.hidden = (id !== screenId);
  });
  // Hide the settings dot-menu on auth / wizard screens — they have their own back nav
  const authScreens = ['auth-entry', 'auth-signup', 'auth-signin', 'wizard'];
  $('settingsBtn').style.visibility = authScreens.includes(screenId) ? 'hidden' : 'visible';
  closeAllDisclosures();
  showBottomNav(screenId);
  window.scrollTo({ top: 0, behavior: 'instant' });
}

// ── Bottom nav ────────────────────────────────────────────────────────────────

const NAV_SCREENS = ['home', 'trailers', 'library'];

function showBottomNav(screenId) {
  const nav = $('bottomNav');
  if (!nav) return;
  const visible = NAV_SCREENS.includes(screenId);
  nav.hidden = !visible;
  document.body.classList.toggle('nav-visible', visible);
  nav.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.nav === screenId);
  });
}

function setBgWarm(on) { document.body.classList.toggle('warm-bg', on); }

// "the seventeenth of October"
const ORDINALS = [
  '','first','second','third','fourth','fifth','sixth','seventh','eighth','ninth',
  'tenth','eleventh','twelfth','thirteenth','fourteenth','fifteenth','sixteenth',
  'seventeenth','eighteenth','nineteenth','twentieth','twenty-first','twenty-second',
  'twenty-third','twenty-fourth','twenty-fifth','twenty-sixth','twenty-seventh',
  'twenty-eighth','twenty-ninth','thirtieth','thirty-first',
];
const MONTH_NAMES = [
  'January','February','March','April','May','June',
  'July','August','September','October','November','December',
];
function wordedDate(date) {
  return `the ${ORDINALS[date.getDate()]} of ${MONTH_NAMES[date.getMonth()]}`;
}

// Authenticated fetch to the Render backend
async function apiFetch(path, opts = {}) {
  const token = state.session?.access_token;
  return fetch(`${API_BASE}${path}`, {
    ...opts,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(opts.headers || {}),
    },
  });
}

// ── Programme eyebrow ─────────────────────────────────────────────────────────

function setProgrammeEyebrow() {
  const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const day  = days[new Date().getDay()];
  const num  = state.history.length + 1;
  $('programmeNo').textContent  = `No. ${num}`;
  $('programmeDay').textContent = `A ${day} programme`;
}

// ── Disclosure component ──────────────────────────────────────────────────────

const DECADE_OPTIONS = [
  { value: null,    label: 'Any era',                   sub: '—'      },
  { value: '1930s', label: 'The thirties',              sub: '1930s'  },
  { value: '1940s', label: 'The forties',               sub: '1940s'  },
  { value: '1950s', label: 'The fifties',               sub: '1950s'  },
  { value: '1960s', label: 'The sixties',               sub: '1960s'  },
  { value: '1970s', label: 'The seventies',             sub: '1970s'  },
  { value: '1980s', label: 'The eighties',              sub: '1980s'  },
  { value: '1990s', label: 'The nineties',              sub: '1990s'  },
  { value: '2000s', label: 'The two thousands',         sub: '2000s'  },
  { value: '2010s', label: 'The two thousand tens',     sub: '2010s'  },
  { value: '2020s', label: 'The two thousand twenties', sub: '2020s'  },
];

const RUNTIME_OPTIONS = [
  { value: null,       label: 'Any length',       sub: '—'           },
  { value: 'short',    label: 'A short evening',  sub: '‹ 90 min'    },
  { value: 'standard', label: 'Standard feature', sub: '90–120 min'  },
  { value: 'long',     label: 'Long form',        sub: '120–150 min' },
  { value: 'epic',     label: 'An epic',          sub: '› 150 min'   },
];

function buildDisclosure(name, options, valueLabelId) {
  const root       = document.querySelector(`[data-disclosure="${name}"]`);
  const panel      = root.querySelector('[data-disclosure-panel]');
  const trigger    = root.querySelector('[data-disclosure-trigger]');
  const affordance = trigger.querySelector('.glass-affordance');

  function render() {
    panel.innerHTML = options.map(opt => {
      const isSelected = state[name] === opt.value;
      return `
        <button class="panel-option ${isSelected ? 'selected' : ''}" data-value="${opt.value ?? ''}">
          <span class="opt-value">${opt.label}</span>
          <span class="opt-sub">${opt.sub}</span>
        </button>`;
    }).join('');
    panel.querySelectorAll('.panel-option').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const val = btn.dataset.value === '' ? null : btn.dataset.value;
        state[name] = val;
        $(valueLabelId).textContent = options.find(o => o.value === val).label;
        close();
      });
    });
  }

  function open()  {
    closeAllDisclosures(root);
    render();
    panel.hidden = false;
    root.classList.add('open');
    affordance.textContent = '˅';
  }
  function close() {
    panel.hidden = true;
    root.classList.remove('open');
    affordance.textContent = '›';
  }
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    root.classList.contains('open') ? close() : open();
  });
  return { open, close, root };
}

const disclosures = [];
function closeAllDisclosures(except) {
  disclosures.forEach(d => { if (d.root !== except) d.close(); });
}
document.addEventListener('click', () => closeAllDisclosures());

// ── Mood text + chips ─────────────────────────────────────────────────────────

const moodTextEl = $('moodText');
const chipsBlock = $('chipsBlock');

moodTextEl.addEventListener('input', () => {
  state.moodText = moodTextEl.value;
  moodTextEl.classList.toggle('has-content', moodTextEl.value.trim().length > 0);
  chipsBlock.classList.toggle('dim', moodTextEl.value.trim().length > 0);
});

document.querySelectorAll('.chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const mood = chip.dataset.mood;
    if (state.selectedMoods.has(mood)) {
      state.selectedMoods.delete(mood);
      chip.classList.remove('selected');
    } else {
      state.selectedMoods.add(mood);
      chip.classList.add('selected');
    }
  });
});

function composeMoodDescription() {
  const text  = state.moodText.trim();
  const chips = Array.from(state.selectedMoods);
  if (text && chips.length) return `${text}. Mood: ${chips.join(', ')}`;
  if (text)        return text;
  if (chips.length) return `Mood: ${chips.join(', ')}`;
  return '';
}

// ── Digest time options ───────────────────────────────────────────────────────

const DIGEST_TIMES = [
  { hour: 15, label: 'Three in the afternoon', sub: '3:00 PM'  },
  { hour: 16, label: 'Four in the afternoon',  sub: '4:00 PM'  },
  { hour: 17, label: 'Five in the afternoon',  sub: '5:00 PM'  },
  { hour: 18, label: 'Six in the evening',     sub: '6:00 PM'  },
  { hour: 19, label: 'Seven in the evening',   sub: '7:00 PM'  },
  { hour: 20, label: 'Eight in the evening',   sub: '8:00 PM'  },
  { hour: 21, label: 'Nine in the evening',    sub: '9:00 PM'  },
  { hour: 22, label: 'Ten in the evening',     sub: '10:00 PM' },
];

function renderTimeOptions(containerId, selectedHour, onChange) {
  const container = $(containerId);
  container.innerHTML = DIGEST_TIMES.map(t => `
    <button class="time-option${t.hour === selectedHour ? ' selected' : ''}" data-hour="${t.hour}">
      <span class="time-label">${t.label}</span>
      <span class="time-sub">${t.sub}</span>
    </button>`).join('');
  container.querySelectorAll('.time-option').forEach(btn => {
    btn.addEventListener('click', () => {
      const h = parseInt(btn.dataset.hour, 10);
      onChange(h);
      container.querySelectorAll('.time-option').forEach(b =>
        b.classList.toggle('selected', parseInt(b.dataset.hour, 10) === h));
    });
  });
}

// ── Auth entry ────────────────────────────────────────────────────────────────

$('goSignupBtn').addEventListener('click', () => show('auth-signup'));
$('goSigninBtn').addEventListener('click', () => show('auth-signin'));

// ── Sign up ───────────────────────────────────────────────────────────────────

$('signupBackBtn').addEventListener('click',  () => show('auth-entry'));
$('signupToSignin').addEventListener('click', () => show('auth-signin'));

$('signupSubmitBtn').addEventListener('click', async () => {
  const email    = $('signupEmail').value.trim();
  const password = $('signupPassword').value;
  const status   = $('signupStatus');

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    status.textContent = 'Please enter a valid email address.'; return;
  }
  if (password.length < 8) {
    status.textContent = 'Password must be at least 8 characters.'; return;
  }

  $('signupSubmitBtn').disabled = true;
  status.textContent = 'Creating your account…';
  logo.classList.add('spinning');

  const { data, error } = await sb.auth.signUp({ email, password });

  logo.classList.remove('spinning');
  $('signupSubmitBtn').disabled = false;

  if (error) { status.textContent = error.message; return; }

  state.session = data.session;
  state.user    = data.user;
  status.textContent = '';

  // Save detected timezone immediately — non-blocking
  apiFetch('/api/profile', {
    method: 'PATCH',
    body: JSON.stringify({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }),
  }).catch(() => {});

  enterWizard();
});

// ── Sign in ───────────────────────────────────────────────────────────────────

$('signinBackBtn').addEventListener('click',  () => show('auth-entry'));
$('signinToSignup').addEventListener('click', () => show('auth-signup'));

$('signinSubmitBtn').addEventListener('click', async () => {
  const email    = $('signinEmail').value.trim();
  const password = $('signinPassword').value;
  const status   = $('signinStatus');

  if (!email)    { status.textContent = 'Please enter your email.';    return; }
  if (!password) { status.textContent = 'Please enter your password.'; return; }

  $('signinSubmitBtn').disabled = true;
  status.textContent = 'Signing in…';
  logo.classList.add('spinning');

  const { data, error } = await sb.auth.signInWithPassword({ email, password });

  logo.classList.remove('spinning');
  $('signinSubmitBtn').disabled = false;

  if (error) { status.textContent = error.message; return; }

  state.session = data.session;
  state.user    = data.user;
  status.textContent = '';

  await loadUserProfile();
  await loadUserHistory();

  if (!state.profile?.letterboxd_username) {
    enterWizard();
  } else {
    state.username = state.profile.letterboxd_username;
    localStorage.setItem('ww_username', state.username);
    // Pull imported films BEFORE showing home so the picker has data the
    // moment the screen is visible. Without awaiting, the picker reads an
    // empty state.watchlist and "no films" briefly flashes.
    await refreshWatchlist();
    show('home');
    setProgrammeEyebrow();
  }
});

$('forgotPasswordBtn').addEventListener('click', async () => {
  const email = $('signinEmail').value.trim();
  if (!email) { $('signinStatus').textContent = 'Enter your email above first.'; return; }
  const { error } = await sb.auth.resetPasswordForEmail(email, {
    redirectTo: window.location.origin,
  });
  $('signinStatus').textContent = error
    ? error.message
    : 'Reset link sent — check your email.';
});

// ── Onboarding wizard ─────────────────────────────────────────────────────────

function enterWizard() {
  state.wizUsername    = '';
  state.wizDigestOptIn = true;
  state.wizDigestHour  = 18;
  $('wizUsername').value             = '';
  $('wizUsernameStatus').textContent = '';
  $('digestToggle').classList.add('active');
  $('toggleCheck').classList.add('checked');
  showWizardStep(1);
  show('wizard');
}

function showWizardStep(n) {
  [1, 2, 3].forEach(i => { $(`wz${i}`).hidden = (i !== n); });
  // Step 1 = Import (conceptually step 3 of 4); steps 2 + 3 are both the
  // digest "step 4 of 4" — toggle then time-picker on separate screens.
  const label = n === 1 ? 'Step 3 of 4' : 'Step 4 of 4';
  $('wizardStepLabel').textContent          = label;
  $('wizardBackBtn').style.visibility       = n === 1 ? 'hidden' : 'visible';
  if (n === 3) renderTimeOptions('timeOptions', state.wizDigestHour, h => { state.wizDigestHour = h; });
}

$('wizardBackBtn').addEventListener('click', () => {
  const cur = [1, 2, 3].find(i => !$(`wz${i}`).hidden);
  if (cur > 1) showWizardStep(cur - 1);
});

// Step 3 — Import Letterboxd export ZIP (or skip)
$('wizImportBtn').addEventListener('click', () => {
  const input = document.createElement('input');
  input.type    = 'file';
  input.accept  = '.zip,application/zip';
  input.onchange = (e) => {
    const file = e.target.files?.[0];
    if (file) uploadLetterboxdImport(file, { advanceToWizardStep: 2 });
  };
  input.click();
});

$('wizImportSkip').addEventListener('click', () => {
  // Capture optional username if the user typed one — it's stored on profile
  // at the end of the wizard (Step 4). No scraping.
  state.wizUsername = $('wizUsername').value.trim();
  showWizardStep(2);
});

// Step 2 — digest toggle
$('digestToggle').addEventListener('click', () => {
  state.wizDigestOptIn = !state.wizDigestOptIn;
  $('digestToggle').classList.toggle('active',  state.wizDigestOptIn);
  $('toggleCheck').classList.toggle('checked', state.wizDigestOptIn);
});

$('wz2NextBtn').addEventListener('click', () => showWizardStep(3));

// Step 3 — finish
$('wz3DoneBtn').addEventListener('click', async () => {
  $('wz3DoneBtn').disabled = true;
  logo.classList.add('spinning');

  // Capture the optional typed username (display-only) from the import step.
  // If the user uploaded an export, processImport() will have already set
  // letterboxd_username from profile.csv — we only override here when the
  // user typed one explicitly.
  const typedUsername = ($('wizUsername').value || '').trim();
  if (typedUsername) {
    state.username = typedUsername;
    localStorage.setItem('ww_username', typedUsername);
  }

  const profileUpdate = {
    digest_opt_in: state.wizDigestOptIn,
    digest_hour:   state.wizDigestHour,
  };
  if (typedUsername) profileUpdate.letterboxd_username = typedUsername;

  try {
    await apiFetch('/api/profile', {
      method: 'PATCH',
      body:   JSON.stringify(profileUpdate),
    });
    await loadUserProfile();
    // Pull whatever the user just imported (no-op if they skipped)
    await refreshWatchlist();
  } catch (e) {}

  logo.classList.remove('spinning');
  $('wz3DoneBtn').disabled = false;
  setBgWarm(false);
  show('home');
  setProgrammeEyebrow();
  updateEmptyState();
});

// ── Account screen ────────────────────────────────────────────────────────────

async function openAccount() {
  closeSheet();
  if (!state.profile) await loadUserProfile();
  const p = state.profile;

  $('accountSince').textContent =
    p?.date_joined ? `Member since ${wordedDate(new Date(p.date_joined))}.` : '';
  $('accountUsername').textContent = p?.letterboxd_username || '—';

  const digestOn = p?.digest_opt_in !== false;
  $('accountDigestToggle').classList.toggle('checked', digestOn);
  $('digestHourRow').style.opacity = digestOn ? '1' : '0.45';

  const timeOpt = DIGEST_TIMES.find(t => t.hour === (p?.digest_hour ?? 18)) || DIGEST_TIMES[3];
  $('accountDigestHour').textContent = timeOpt.label;

  $('changeUsernameForm').hidden       = true;
  $('changeHourOptions').hidden        = true;
  $('changeUsernameStatus').textContent = '';

  setBgWarm(false);
  show('account');
}

$('accountBackBtn').addEventListener('click', () => {
  show('home');
  setProgrammeEyebrow();
});

// Change Letterboxd username
$('changeUsernameBtn').addEventListener('click', () => {
  const form = $('changeUsernameForm');
  form.hidden = !form.hidden;
  if (!form.hidden) $('newUsernameInput').focus();
});

$('saveNewUsernameBtn').addEventListener('click', async () => {
  const username = $('newUsernameInput').value.trim();
  const status   = $('changeUsernameStatus');
  if (!username) return;

  $('saveNewUsernameBtn').disabled = true;
  status.textContent = 'Saving…';
  logo.classList.add('spinning');

  // The username is display-only now — the actual film data lives in
  // user_films (populated by the Letterboxd-export import). We just
  // PATCH the profile; no scrape verification.
  try {
    const res = await apiFetch('/api/profile', {
      method: 'PATCH',
      body:   JSON.stringify({ letterboxd_username: username }),
    });
    if (!res.ok) throw new Error('save failed');
    state.username = username;
    localStorage.setItem('ww_username', username);
    await loadUserProfile();
    $('accountUsername').textContent = username;
    $('changeUsernameForm').hidden   = true;
    $('newUsernameInput').value      = '';
    status.textContent = '';
  } catch (e) {
    status.textContent = 'Something went wrong. Try again.';
  }

  logo.classList.remove('spinning');
  $('saveNewUsernameBtn').disabled = false;
});

// Digest on/off toggle
$('accountDigestToggle').addEventListener('click', async () => {
  const next = !$('accountDigestToggle').classList.contains('checked');
  $('accountDigestToggle').classList.toggle('checked', next);
  $('digestHourRow').style.opacity = next ? '1' : '0.45';
  apiFetch('/api/profile', {
    method: 'PATCH',
    body: JSON.stringify({ digest_opt_in: next }),
  }).then(() => loadUserProfile()).catch(() => {});
});

// Digest hour inline picker
$('changeDigestHourBtn').addEventListener('click', () => {
  const panel = $('changeHourOptions');
  if (panel.hidden) {
    renderTimeOptions('changeHourOptions', state.profile?.digest_hour ?? 18, async (h) => {
      await apiFetch('/api/profile', {
        method: 'PATCH',
        body: JSON.stringify({ digest_hour: h }),
      }).catch(() => {});
      await loadUserProfile();
      const opt = DIGEST_TIMES.find(t => t.hour === h) || DIGEST_TIMES[3];
      $('accountDigestHour').textContent = opt.label;
      panel.hidden = true;
    });
    panel.hidden = false;
  } else {
    panel.hidden = true;
  }
});

// Sign out
$('signOutBtn').addEventListener('click', async () => {
  await sb.auth.signOut(); // onAuthStateChange handles the redirect
});

// Delete account — calls DELETE /api/account on the backend (service-role delete)
$('deleteAccountBtn').addEventListener('click', async () => {
  if (!confirm('This will permanently delete your account and all viewing history. This cannot be undone.')) return;
  $('deleteAccountBtn').disabled = true;
  try {
    const res = await apiFetch('/api/account', { method: 'DELETE' });
    if (res.ok) {
      await sb.auth.signOut();
    } else {
      $('deleteAccountBtn').disabled = false;
      alert('Deletion failed — try signing out and back in, then try again.');
    }
  } catch (e) {
    $('deleteAccountBtn').disabled = false;
  }
});

// ── Profile / history API helpers ─────────────────────────────────────────────

async function loadUserProfile() {
  try {
    const res = await apiFetch('/api/profile');
    if (res.ok) state.profile = await res.json();
  } catch (e) {}
}

async function loadUserHistory() {
  if (!state.user) return;
  try {
    const res = await apiFetch('/api/history');
    if (res.ok) {
      const { history } = await res.json();
      if (history?.length) {
        state.history = history.map(h => ({
          title:  h.title,
          year:   h.year,
          url:    h.letterboxd_url,
          poster: h.poster_url,
          mood:   h.mood,
          when:   new Date(h.served_at).getTime(),
        }));
        localStorage.setItem('ww_history', JSON.stringify(state.history));
      }
    }
  } catch (e) {}
}

async function refreshWatchlist() {
  // user_films (populated by the Letterboxd-export import) is the only
  // film source now. No session → nothing to load (boot routes guests to
  // auth-entry). Empty result → empty-state banner on home.
  if (!state.session) return;
  try {
    const res = await apiFetch('/api/user-films');
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`/api/user-films ${res.status}: ${body.slice(0, 200)}`);
    }
    const films = await res.json();
    state.watchlist = Array.isArray(films) ? films : [];
    console.log('[watchlist] loaded', state.watchlist.length, 'films from user_films');
    updateEmptyState();
  } catch (e) {
    console.error('[watchlist] /api/user-films failed:', e);
    // Leave state.watchlist as-is so a transient blip doesn't blank the picker.
    updateEmptyState();
  }
}

function updateEmptyState() {
  const banner = $('emptyImportBanner');
  if (!banner) return;
  // Only show for signed-in users with zero imported films — guests don't
  // have a user_films table, so the banner doesn't apply to them.
  const shouldShow = !!state.session && (!state.watchlist || state.watchlist.length === 0);
  banner.hidden = !shouldShow;
}

// ── Pick logic ────────────────────────────────────────────────────────────────

function filterWatchlist() {
  let pool = state.watchlist.slice();
  if (state.decade) {
    pool = pool.filter(m => {
      const y = parseInt(m.year);
      if (!y) return false;
      const d = parseInt(state.decade);
      return y >= d && y < d + 10;
    });
  }
  return pool.length > 0 ? pool : state.watchlist;
}

const QUOTES = [
  '"A near-silent meditation on what is left unsaid."',
  '"Dim the lights. Let it work on you slowly."',
  '"Hardly a film — more a long, held breath."',
  '"For an evening when the world feels far away."',
  '"A picture to be watched once and remembered always."',
  '"The kind of film one returns to in different weather."',
];
function pickQuote() { return QUOTES[Math.floor(Math.random() * QUOTES.length)]; }

function italiciseTitle(title) {
  const words = title.split(' ');
  if (words.length === 1) return title;
  const idx = words.length > 2 ? words.length - 1 : 1;
  words[idx] = `<em>${words[idx]}</em>`;
  return words.join(' ');
}

async function pickFilm(opts = {}) {
  const pool = opts.ignoreFilters ? state.watchlist : filterWatchlist();
  if (pool.length === 0) {
    $('homeStatus').textContent = 'No films match those filters.'; return;
  }

  logo.classList.add('spinning');
  $('homeStatus').textContent = 'Selecting tonight\'s film…';
  await new Promise(r => setTimeout(r, 1100));

  const movie = pool[Math.floor(Math.random() * pool.length)];
  state.currentMovie = movie;

  let posterUrl = null;
  let tagline   = null;
  let synopsis  = null;
  try {
    const res  = await fetch(`${API_BASE}/poster?url=${encodeURIComponent(movie.url)}`);
    const data = await res.json();
    posterUrl = data.image;
    tagline   = data.tagline  || null;
    synopsis  = data.synopsis || null;
  } catch (e) {}

  const moodDisplay = state.selectedMoods.size > 0
    ? Array.from(state.selectedMoods)[0]
    : (state.moodText ? 'Your own words' : 'Open');

  $('resultPoster').src     = posterUrl || '';
  $('resultPoster').alt     = movie.title;
  $('resultTitle').innerHTML = italiciseTitle(movie.title);
  $('resultMeta').innerHTML  = [movie.year, 'Letterboxd'].filter(Boolean).join(' &nbsp;·&nbsp; ');
  $('resultDirector').textContent = '';

  // Pull-quote: prefer real tagline, then first sentence of synopsis, then fallback
  let quoteText;
  if (tagline) {
    quoteText = `“${tagline}”`;
  } else if (synopsis) {
    const firstSentence = (synopsis.match(/[^.!?]+[.!?]+/) || [synopsis])[0].trim();
    quoteText = `“${firstSentence}”`;
  } else {
    quoteText = pickQuote();
  }
  $('resultQuote').textContent = quoteText;
  // When synopsis follows, reduce the pull-quote's bottom margin
  $('resultQuote').style.marginBottom = synopsis ? '0' : '';

  // Synopsis block
  const synopsisEl = $('resultSynopsis');
  if (synopsis) {
    synopsisEl.hidden = false;
    if (synopsis.length > 280) {
      synopsisEl.innerHTML =
        `<span class="synopsis-text synopsis-clamped">${synopsis}</span>` +
        `<button class="synopsis-more">Read more</button>`;
      synopsisEl.querySelector('.synopsis-more').addEventListener('click', function () {
        synopsisEl.querySelector('.synopsis-text').classList.remove('synopsis-clamped');
        this.remove();
      });
    } else {
      synopsisEl.innerHTML = `<span class="synopsis-text">${synopsis}</span>`;
    }
  } else {
    synopsisEl.hidden = true;
    synopsisEl.innerHTML = '';
  }

  $('statMood').textContent = moodDisplay.charAt(0).toUpperCase() + moodDisplay.slice(1);
  $('statPace').textContent = state.runtime
    ? RUNTIME_OPTIONS.find(o => o.value === state.runtime).label
    : 'Unhurried';
  $('watchLink').href = movie.url;

  const entry = { ...movie, poster: posterUrl, when: Date.now(), mood: moodDisplay };
  state.history.unshift(entry);
  state.history = state.history.slice(0, 20);
  localStorage.setItem('ww_history', JSON.stringify(state.history));

  // Sync pick to DB — non-blocking, doesn't affect the UI
  if (state.user) {
    apiFetch('/api/history', {
      method: 'POST',
      body: JSON.stringify({
        letterboxd_url: movie.url,
        title:          movie.title,
        year:           movie.year   || null,
        poster_url:     posterUrl    || null,
        mood:           moodDisplay,
        source:         'app',
      }),
    }).catch(() => {});
  }

  logo.classList.remove('spinning');
  $('homeStatus').textContent = '';
  setBgWarm(true);
  show('screening');
}

$('pickBtn').addEventListener('click',     () => pickFilm());
$('surpriseBtn').addEventListener('click', () => pickFilm({ ignoreFilters: true }));
$('anotherBtn').addEventListener('click',  () => pickFilm());

$('backBtn').addEventListener('click', () => {
  setBgWarm(false);
  show('home');
  setProgrammeEyebrow();
});

// ── Settings sheet ────────────────────────────────────────────────────────────

function openSheet() {
  const isSignedIn = !!state.user;
  $('sheetAccount').hidden          = !isSignedIn;
  $('sheetImportLetterboxd').hidden = !isSignedIn; // import only makes sense for signed-in users
  if (isSignedIn) {
    $('currentUser').textContent = state.profile?.letterboxd_username || state.user.email || '';
  }
  $('sheetBackdrop').hidden = false;
  $('sheet').hidden         = false;
}

function closeSheet() {
  $('sheetBackdrop').hidden = true;
  $('sheet').hidden         = true;
}

$('settingsBtn').addEventListener('click', openSheet);
$('sheetBackdrop').addEventListener('click', closeSheet);

// Bottom-nav item wiring — Account opens the sheet; tapping the active item is a no-op
document.querySelectorAll('#bottomNav .nav-item').forEach(item => {
  item.addEventListener('click', () => {
    const target = item.dataset.nav;
    if (target === 'account') { openSheet(); return; }
    if (item.classList.contains('active')) return; // already here
    if (target === 'home') {
      show('home');
      setProgrammeEyebrow();
    } else if (target === 'trailers') {
      setBgWarm(false);
      renderTrailers();
      show('trailers');
    } else if (target === 'library') {
      setBgWarm(false);
      renderLibrary();
      show('library');
    }
  });
});

$('sheetTrailers').addEventListener('click', () => {
  closeSheet();
  setBgWarm(false);
  show('trailers');
  renderTrailers();
});

$('sheetLibrary').addEventListener('click', () => {
  closeSheet();
  renderLibrary();
  setBgWarm(false);
  show('library');
});

$('sheetAccount').addEventListener('click', openAccount);

// ── Letterboxd import ─────────────────────────────────────────────────────────

function openLetterboxdFilePicker(opts = {}) {
  const input = document.createElement('input');
  input.type    = 'file';
  input.accept  = '.zip,application/zip';
  input.onchange = (e) => {
    const file = e.target.files?.[0];
    if (file) uploadLetterboxdImport(file, opts);
  };
  input.click();
}

$('sheetImportLetterboxd').addEventListener('click', () => {
  closeSheet();
  openLetterboxdFilePicker();
});

// Empty-watchlist banner on home — same file picker as Settings → Import
$('emptyImportBtn').addEventListener('click', () => openLetterboxdFilePicker());

function showImportOverlay() {
  $('importOverlay').hidden          = false;
  $('importDismiss').hidden          = true;
  $('importDismiss').textContent     = 'Close';
  $('importDismiss').onclick         = hideImportOverlay;
  $('importProgressBar').style.width = '0%';
  $('importStatus').textContent      = 'Reading export…';
  document.querySelector('.import-title').textContent = 'Importing your watchlist…';
}

function hideImportOverlay() {
  $('importOverlay').hidden = true;
}

function updateImportProgress(current, total, label) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0;
  $('importProgressBar').style.width = `${pct}%`;
  if (label) $('importStatus').textContent = label;
}

function showImportError(msg) {
  document.querySelector('.import-title').textContent = 'Import failed';
  $('importStatus').textContent = msg;
  $('importProgressBar').style.width = '0%';
  $('importDismiss').textContent = 'Close';
  $('importDismiss').onclick     = hideImportOverlay;
  $('importDismiss').hidden      = false;
}

// opts.advanceToWizardStep — when set (e.g. from the wizard import step),
// shows a "Continue →" button on success instead of auto-navigating home.
async function uploadLetterboxdImport(file, opts = {}) {
  showImportOverlay();

  try {
    const formData = new FormData();
    formData.append('file', file);
    const token = state.session?.access_token;

    const res = await fetch(`${API_BASE}/import/letterboxd`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body:    formData,
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || `Upload failed (${res.status})`);
    }

    const { importId, totalCount } = await res.json();
    updateImportProgress(0, totalCount, `Matching ${totalCount} films to TMDB…`);

    const finalStatus = await pollImport(importId);

    // Refresh the picker's source — user_films now exists for this user
    await refreshWatchlist();
    // The export's profile.csv may have set letterboxd_username; pull it.
    await loadUserProfile().catch(() => {});

    updateImportProgress(
      finalStatus.progress.total,
      finalStatus.progress.total,
      `Imported ${finalStatus.imported} of ${finalStatus.progress.total} films.`,
    );

    if (opts.advanceToWizardStep) {
      // Wizard mode: stay on overlay until user clicks Continue
      document.querySelector('.import-title').textContent = "You're ready.";
      $('importDismiss').textContent = 'Continue →';
      $('importDismiss').onclick     = () => {
        hideImportOverlay();
        showWizardStep(opts.advanceToWizardStep);
      };
      $('importDismiss').hidden = false;
    } else {
      // Settings-sheet path: brief success animation, then navigate home
      document.querySelector('.import-title').textContent = "That's tonight's library, ready.";
      await new Promise(r => setTimeout(r, 1200));
      hideImportOverlay();
      show('home');
      setProgrammeEyebrow();
      updateEmptyState();
    }
  } catch (e) {
    console.error('[import] failed:', e);
    showImportError(e.message || 'Something went wrong. Try again.');
  }
}

function pollImport(importId) {
  return new Promise((resolve, reject) => {
    const interval = setInterval(async () => {
      try {
        const res    = await apiFetch(`/import/${importId}/status`);
        const status = await res.json();
        if (status.progress) {
          updateImportProgress(
            status.progress.current,
            status.progress.total,
            status.progress.currentFilm
              ? `Matched ${status.progress.current}/${status.progress.total} — ${status.progress.currentFilm}`
              : `Matched ${status.progress.current}/${status.progress.total} films…`,
          );
        }
        if (status.status === 'complete') {
          clearInterval(interval);
          resolve(status);
        } else if (status.status === 'failed') {
          clearInterval(interval);
          reject(new Error(status.error || 'Import failed on the server.'));
        }
      } catch (e) {
        // Transient errors — keep polling
      }
    }, 700);
  });
}

// ── Library ───────────────────────────────────────────────────────────────────

function timeAgo(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7)  return `${d}d ago`;
  return `${Math.floor(d / 7)}w ago`;
}

function renderLibrary() {
  const list = $('libraryList');
  if (state.history.length === 0) {
    list.innerHTML = '<div class="library-empty">No films programmed yet.</div>'; return;
  }
  list.innerHTML = state.history.map(item => `
    <a class="library-row" href="${item.url}" target="_blank" rel="noopener">
      ${item.poster
        ? `<img class="thumb" src="${item.poster}" alt="">`
        : `<div class="thumb"></div>`}
      <div>
        <div class="lib-title">${italiciseTitle(item.title)}</div>
        <div class="lib-meta">${[item.year, item.mood].filter(Boolean).join(' · ')}</div>
      </div>
      <span class="lib-time">${timeAgo(item.when)}</span>
    </a>`).join('');
}

$('libBackBtn').addEventListener('click', () => { show('home'); setProgrammeEyebrow(); });

// ── Trailers ──────────────────────────────────────────────────────────────────
//
// Architecture: raw <iframe> per card, src set/cleared by an
// IntersectionObserver at 0.3 threshold. No YouTube IFrame API SDK loaded —
// we just enable JS commands via enablejsapi=1 and use window.postMessage
// to send mute/unMute commands directly.
//
// Mute state is sticky across cards via the module-level `stickyMuted`
// flag, mirrored onto each card as data-muted. Every iframe is loaded
// with mute=1 in the URL (the only autoplay variant browsers reliably
// allow — mobile blocks mute=0 outright). If the user has previously
// tapped unmute, an unMute + playVideo postMessage fires ~300ms after
// iframe load. Unmuting an already-playing video doesn't require a fresh
// user gesture, so this works on mobile where the mute=0 URL path can't.

let trailerObserver = null;
let stickyMuted     = true;

// iOS Safari blocks iframe autoplay triggered by IntersectionObserver — it
// requires a direct user tap. On iOS we render a poster + play-button
// overlay instead, and only load the iframe on tap. Detection is the
// standard UA check; iPadOS 13+ pretends to be Mac in the UA but the
// previous attempt at maxTouchPoints-based detection caused false
// positives on touch-enabled MacBooks — sticking with the spec's regex.
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;

function trailerEmbedUrl(ytId) {
  // controls=0 hides the YouTube UI; modestbranding=1 removes the YouTube
  // logo; rel=0 keeps related-video overlays off; iv_load_policy=3 hides
  // annotations; playsinline=1 keeps iOS from going fullscreen;
  // enablejsapi=1 lets us send postMessage mute commands. mute=1 is
  // hard-coded — the always-muted autoplay path is the only one that
  // works across mobile + desktop. Unmute happens via postMessage after
  // load, not via a URL flag.
  return `https://www.youtube.com/embed/${ytId}` +
    `?autoplay=1&mute=1&controls=0&modestbranding=1&rel=0` +
    `&iv_load_policy=3&playsinline=1&enablejsapi=1`;
}

async function renderTrailers() {
  const feed   = $('trailerFeed');
  const dots   = $('trailerDots');
  const status = $('trailerStatus');

  // Teardown previous observer + clear any in-flight iframes
  if (trailerObserver) { trailerObserver.disconnect(); trailerObserver = null; }
  feed.querySelectorAll('iframe').forEach(f => { f.src = ''; });

  if (!state.watchlist || state.watchlist.length === 0) {
    feed.innerHTML = `
      <div class="trailer-end-card">
        <p class="trailer-end-title">Nothing in your<br><em>watchlist</em> yet.</p>
        <p class="trailer-end-sub">Add films on Letterboxd first, then come back.</p>
      </div>`;
    dots.innerHTML = '';
    status.textContent = '';
    return;
  }

  // Randomised subset of up to 20 films — fresh feel each visit
  const pool = state.watchlist.slice().sort(() => Math.random() - 0.5).slice(0, 20);

  // Cards render with an empty-src <iframe> + a "No trailer available" overlay
  // that's hidden by default. After /trailers/batch resolves, cards with a
  // null youtube_id get .trailer-no-video, which shows the overlay and hides
  // the iframe via CSS. Cards in the .trailer-skeleton state stay shimmery
  // until either path stamps them.
  feed.innerHTML = pool.map((m, i) => `
    <div class="trailer-card trailer-skeleton"
         data-film-url="${escAttr(m.url)}"
         data-film-index="${i}">
      <div class="trailer-poster-bg"${m.poster ? ` style="background-image:url(${escAttr(m.poster)});"` : ''}></div>
      <div class="trailer-video-wrap">
        <iframe allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>
      </div>
      <div class="trailer-no-trailer-overlay">
        <span class="trailer-no-trailer-text">No trailer available</span>
      </div>
      <button class="trailer-mute-btn" aria-label="Toggle mute">${muteSvg(true)}</button>
      <div class="trailer-info-overlay">
        <h3 class="trailer-card-title">${italiciseTitle(m.title)}</h3>
        <div class="trailer-card-meta">${m.year || '—'}</div>
        <div class="trailer-card-actions">
          <a class="trailer-lbx-link" href="${escAttr(m.url)}" target="_blank" rel="noopener">View on Letterboxd</a>
        </div>
      </div>
    </div>
  `).join('') + `
    <div class="trailer-end-card" data-film-index="${pool.length}">
      <p class="trailer-end-title">That's all<br><em>for tonight.</em></p>
      <p class="trailer-end-sub">You've seen every preview in tonight's selection.</p>
      <button class="btn-primary" id="trailerEndHome" style="margin-top:8px;">Back to home</button>
    </div>`;

  // Progress dots — one per film card + end card
  dots.innerHTML = Array.from({ length: pool.length + 1 }, (_, i) =>
    `<div class="trailer-dot${i === 0 ? ' active' : ''}"></div>`).join('');

  // Wire end-card CTA
  const endBtn = $('trailerEndHome');
  if (endBtn) endBtn.addEventListener('click', () => { show('home'); setProgrammeEyebrow(); });

  // Wire mute buttons — each tap toggles the audio on its own card only
  feed.querySelectorAll('.trailer-mute-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      toggleMute(btn.closest('.trailer-card'));
    });
  });

  // Split: films we already have a youtube_id for (from the TMDB import)
  // can be stamped without hitting the backend at all. The rest fall
  // through to /trailers/batch which checks film_metadata_cache + YouTube.
  const known     = new Map();
  const needLookup = [];
  for (const f of pool) {
    if (f.youtube_id) known.set(f.url, f.youtube_id);
    else              needLookup.push(f);
  }

  // Apply the known IDs to their cards immediately
  feed.querySelectorAll('.trailer-card').forEach(card => {
    const id = known.get(card.dataset.filmUrl);
    if (id) {
      card.dataset.youtubeId = id;
      card.classList.remove('trailer-skeleton');
    }
  });

  console.log(
    `[trailers] pool=${pool.length} from import=${known.size} need lookup=${needLookup.length}`
  );

  // Start observing now — the observer will load iframes for any card with
  // a youtube_id once it intersects (including any we just stamped).
  initTrailerObserver();

  // No films need a lookup → skip the network round-trip entirely.
  if (needLookup.length === 0) {
    status.textContent = '';
    return;
  }

  status.textContent = needLookup.length === pool.length
    ? 'Finding trailers…'
    : `Finding ${needLookup.length} more…`;
  logo.classList.add('spinning');
  try {
    const res  = await apiFetch('/trailers/batch', {
      method: 'POST',
      body:   JSON.stringify({ films: needLookup }),
    });
    const data = await res.json();
    const trailerMap = new Map((data.trailers || []).map(t => [t.url, t.youtube_id]));
    const quotaHit   = (data.trailers || []).some(t => t.error === 'quota_exceeded');

    // Stamp only the cards that were waiting on a lookup; cards already
    // resolved by the TMDB-import path are left alone.
    feed.querySelectorAll('.trailer-card.trailer-skeleton').forEach(card => {
      const ytId = trailerMap.get(card.dataset.filmUrl) || null;
      card.dataset.youtubeId = ytId || '';
      card.classList.remove('trailer-skeleton');
      if (!ytId) card.classList.add('trailer-no-video');
    });

    // The observer may have already fired for visible cards before they had
    // a youtube_id. Sweep visible-and-stamped cards to make sure their
    // iframe.src got set.
    feed.querySelectorAll('.trailer-card').forEach(card => {
      if (card.dataset.youtubeId && cardIsVisible(card)) loadCardIframe(card);
    });

    status.textContent = quotaHit ? 'Daily trailer quota reached — try again tomorrow.' : '';
  } catch (e) {
    console.error('[trailers] batch lookup failed:', e);
    status.textContent = "Couldn't load trailers.";
  } finally {
    logo.classList.remove('spinning');
  }
}

function cardIsVisible(card) {
  // Cheap check: cards are 100% viewport-height with scroll-snap, so we just
  // ask whether the card's centre is anywhere inside its scrolling parent.
  const root = $('trailerFeed');
  const rRoot = root.getBoundingClientRect();
  const rCard = card.getBoundingClientRect();
  const centre = rCard.top + rCard.height / 2;
  return centre >= rRoot.top && centre <= rRoot.bottom;
}

function updateMuteIcon(card, muted) {
  const btn = card.querySelector('.trailer-mute-btn');
  if (btn) btn.innerHTML = muteSvg(muted);
}

// Shared iframe-loading core — called either directly (desktop / Android
// when the observer fires) or from the tap-to-play overlay's click handler
// on iOS. Always uses the muted-URL autoplay path; if !stickyMuted, posts
// unMute + playVideo commands 300ms after the iframe loads.
function attachIframeSrc(card) {
  const iframe = card.querySelector('iframe');
  const ytId   = card.dataset.youtubeId;
  if (!iframe || !ytId) return;
  if (iframe.src.includes(`/embed/${ytId}`)) return; // already loaded

  iframe.src         = trailerEmbedUrl(ytId);
  card.dataset.muted = 'true';
  updateMuteIcon(card, stickyMuted);

  if (!stickyMuted) {
    iframe.addEventListener('load', () => {
      setTimeout(() => {
        if (stickyMuted) return; // user re-muted while we waited
        try {
          iframe.contentWindow?.postMessage(
            JSON.stringify({ event: 'command', func: 'unMute', args: [] }),
            'https://www.youtube.com',
          );
          iframe.contentWindow?.postMessage(
            JSON.stringify({ event: 'command', func: 'playVideo', args: [] }),
            'https://www.youtube.com',
          );
          card.dataset.muted = 'false';
        } catch (_) { /* cross-origin / not ready — give up silently */ }
      }, 300);
    }, { once: true });
  }
}

function loadCardIframe(card) {
  const ytId = card.dataset.youtubeId;
  if (!ytId) return;

  // iOS: show poster + play button. iframe.src is set only when the user
  // actually taps, which gives the iframe a real user-gesture context and
  // lets autoplay through.
  if (isIOS) {
    showTapToPlay(card);
    return;
  }

  // Desktop / Android — fire-and-forget autoplay works directly.
  attachIframeSrc(card);
}

function showTapToPlay(card) {
  if (card.querySelector('.tap-to-play')) return; // already showing

  const overlay = document.createElement('div');
  overlay.className = 'tap-to-play';
  overlay.innerHTML = `
    <div class="tap-play-btn" aria-label="Play trailer">
      <svg viewBox="0 0 24 24" width="44" height="44" fill="currentColor">
        <path d="M8 5v14l11-7z"/>
      </svg>
    </div>`;

  overlay.addEventListener('click', () => {
    overlay.remove();
    attachIframeSrc(card);
  }, { once: true });

  const wrap = card.querySelector('.trailer-video-wrap');
  if (wrap) wrap.appendChild(overlay);
}

function unloadCardIframe(card) {
  const iframe = card.querySelector('iframe');
  if (iframe && iframe.src) iframe.src = '';
  card.querySelector('.tap-to-play')?.remove();
  delete card.dataset.muted;
  // On iOS, prime the card for re-entry by immediately re-showing the
  // tap-to-play overlay. The observer will fire again on scroll-in and
  // call loadCardIframe → showTapToPlay (which no-ops if already present),
  // but priming it here avoids a flash of empty poster between scrolls.
  if (isIOS) showTapToPlay(card);
}

function escAttr(s) {
  return (s || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

function muteSvg(muted) {
  return muted
    ? `<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
         <path d="M11.5 5 L7 9 H4 v2 h3 l4.5 4 Z" fill="currentColor" stroke="none" opacity="0.85"/>
         <line x1="14" y1="8" x2="18" y2="12"/><line x1="18" y1="8" x2="14" y2="12"/>
       </svg>`
    : `<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
         <path d="M11.5 5 L7 9 H4 v2 h3 l4.5 4 Z" fill="currentColor" stroke="none" opacity="0.85"/>
         <path d="M14 8.5 Q16.5 10 14 11.5"/>
         <path d="M15.5 6.5 Q20 10 15.5 13.5"/>
       </svg>`;
}

// IntersectionObserver at 0.3 — cards begin loading their iframe before
// they've fully snapped into view, so by the time the snap completes the
// video is already playing. Below 0.3, the iframe is unloaded to free
// memory and stop background playback.
function initTrailerObserver() {
  if (trailerObserver) trailerObserver.disconnect();
  const feed  = $('trailerFeed');
  const items = [...feed.querySelectorAll('.trailer-card, .trailer-end-card')];
  trailerObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      const card = entry.target;
      if (entry.isIntersecting) {
        // Card is ≥30% visible — load iframe + update dots
        if (!card.classList.contains('trailer-end-card')) {
          loadCardIframe(card);
        }
        activateCard(card);
      } else {
        // Card scrolled out — unload iframe to free memory + stop playback
        unloadCardIframe(card);
      }
    });
  }, { root: feed, threshold: 0.3 });
  items.forEach(el => trailerObserver.observe(el));
}

// Just dots + lifecycle accounting now — iframe lifecycle is the observer's job.
function activateCard(card) {
  const dotEls   = [...$('trailerDots').querySelectorAll('.trailer-dot')];
  const allItems = [...$('trailerFeed').querySelectorAll('.trailer-card, .trailer-end-card')];
  const idx      = allItems.indexOf(card);
  dotEls.forEach((d, i) => d.classList.toggle('active', i === idx));
}

// Per-card mute toggle. Updates sticky state + icon synchronously; sends
// the postMessage command to the iframe only if one is loaded (on iOS the
// iframe may still be in tap-to-play state with no src, in which case
// flipping stickyMuted now means the next attachIframeSrc call honours
// the new preference).
function toggleMute(card) {
  if (!card) return;
  const iframe = card.querySelector('iframe');
  if (!iframe) return;

  const isMuted  = card.dataset.muted !== 'false';
  const newMuted = !isMuted;

  card.dataset.muted = newMuted ? 'true' : 'false';
  stickyMuted       = newMuted;
  updateMuteIcon(card, newMuted);

  if (iframe.src && iframe.contentWindow) {
    try {
      iframe.contentWindow.postMessage(
        JSON.stringify({
          event: 'command',
          func:  newMuted ? 'mute' : 'unMute',
          args:  [],
        }),
        'https://www.youtube.com',
      );
    } catch (_) { /* cross-origin / not ready — give up silently */ }
  }
}

$('trailersBackBtn').addEventListener('click', () => {
  if (trailerObserver) { trailerObserver.disconnect(); trailerObserver = null; }
  // Clear every iframe so audio stops and we drop memory cleanly
  $('trailerFeed').querySelectorAll('iframe').forEach(f => { f.src = ''; });
  show('home');
  setProgrammeEyebrow();
});

// ── Auth state listener ───────────────────────────────────────────────────────

sb.auth.onAuthStateChange((event, session) => {
  state.session = session;
  state.user    = session?.user || null;
  if (event === 'SIGNED_OUT') {
    state.profile  = null;
    state.username = null;
    state.watchlist = [];
    state.history   = [];
    localStorage.removeItem('ww_username');
    localStorage.removeItem('ww_watchlist');
    localStorage.removeItem('ww_history');
    localStorage.removeItem('ww_guest_prompt_dismissed');
    show('auth-entry');
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────────

async function boot() {
  disclosures.push(buildDisclosure('decade',  DECADE_OPTIONS,  'decadeValue'));
  disclosures.push(buildDisclosure('runtime', RUNTIME_OPTIONS, 'runtimeValue'));

  const { data: { session } } = await sb.auth.getSession();
  state.session = session;
  state.user    = session?.user || null;

  if (state.user) {
    // ── Signed-in user ──
    await loadUserProfile();
    state.username = state.profile?.letterboxd_username || null;

    if (!state.username) {
      // New account — no Letterboxd username set yet
      enterWizard(); return;
    }

    // Source of truth is user_films — fetched by refreshWatchlist() below.
    // Await before show('home') so the picker has its data on first paint;
    // empty-state banner covers users who skipped import.
    await loadUserHistory();
    await refreshWatchlist();
    show('home');
    setProgrammeEyebrow();

  } else {
    // No session → must sign in / sign up. Guest mode was removed when the
    // scraper went away (the app is import-only now).
    show('auth-entry');
  }
}

boot();
