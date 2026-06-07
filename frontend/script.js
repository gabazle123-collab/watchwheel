// ── Config ────────────────────────────────────────────────────────────────────

const SUPABASE_URL      = 'https://myavvindcywasqstoaze.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im15YXZ2aW5kY3l3YXNxc3RvYXplIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2MTk4NDksImV4cCI6MjA5NTE5NTg0OX0.qbTk9KFribC9GzOX5FsfTuWMPJK4jsOYLHUYpG1tKbk';
const API_BASE          = 'https://watchwheel.onrender.com';

// ── Mood → genre mapping ──────────────────────────────────────────────────────
// Keys must match the textContent of each .chip button exactly.
// genres[] are TMDB genre name strings stored in user_films.genres.
// minRuntime is an optional lower bound (minutes) applied on top of genre match.

const MOOD_FILTERS = {
  'Slow burn':    { genres: ['Drama', 'Mystery', 'Thriller'], minRuntime: 110 },
  'Sun-drenched': { genres: ['Comedy', 'Romance', 'Adventure', 'Family'] },
  'Noir':         { genres: ['Crime', 'Thriller', 'Mystery'] },
  'Melancholy':   { genres: ['Drama', 'Romance'] },
  'First date':   { genres: ['Romance', 'Comedy'] },
  'Wintry':       { genres: ['Drama', 'Mystery', 'Fantasy'] },
};

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
  selectedMood:  null,   // string matching a MOOD_FILTERS key, or null
  moodText:      '',
  decade:        null,
  runtime:       null,
  history:       JSON.parse(localStorage.getItem('ww_history') || '[]'),
  watchedFilms:  [],                // populated by GET /api/user-watched
  currentMovie:  null,
  // ui
  currentScreen:       null,
  libraryNeedsRefresh: false,
  libraryTab:          'watchlist', // 'watchlist' | 'watched'
  // wizard
  wizUsername:    '',
  wizDigestOptIn: true,
  wizDigestHour:  18,
};

// ── Core helpers ──────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);
const logo = document.querySelector('.logo');

// ── Toast ─────────────────────────────────────────────────────────────────────

let toastTimer = null;
function showToast(msg, durationMs = 3200) {
  const el = $('toast');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  // Force reflow so the transition plays even on rapid re-calls
  void el.offsetWidth;
  el.classList.add('visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('visible');
    // hide after transition completes
    toastTimer = setTimeout(() => { el.hidden = true; }, 300);
  }, durationMs);
}

const ALL_SCREENS = [
  'auth-entry', 'auth-signup', 'auth-signin',
  'wizard', 'import',
  'home', 'screening', 'library', 'account', 'trailers', 'explore', 'discover',
];

function show(screenId) {
  state.currentScreen = screenId;
  ALL_SCREENS.forEach(id => {
    const el = $(id);
    if (el) el.hidden = (id !== screenId);
  });
  // Hide the settings dot-menu on auth / wizard / import — they have their own back nav
  const authScreens = ['auth-entry', 'auth-signup', 'auth-signin', 'wizard', 'import'];
  $('settingsBtn').style.visibility = authScreens.includes(screenId) ? 'hidden' : 'visible';
  closeAllDisclosures();
  showBottomNav(screenId);
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function currentScreen() { return state.currentScreen; }

// ── Bottom nav ────────────────────────────────────────────────────────────────

const NAV_SCREENS = ['home', 'trailers', 'library', 'explore'];

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

function buildDisclosure(name, options, valueLabelId, onSelect) {
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
        if (onSelect) onSelect();
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
  const hasText = moodTextEl.value.trim().length > 0;
  moodTextEl.classList.toggle('has-content', hasText);
  chipsBlock.classList.toggle('dim', hasText);

  // Free-text and chip moods conflict — clear the chip selection when the
  // user starts typing. (Free-text mood interpretation via LLM is a future
  // enhancement; for now it's display-only in the screening result.)
  if (hasText && state.selectedMood) {
    state.selectedMood = null;
    document.querySelectorAll('.chip').forEach(c => c.classList.remove('selected'));
  }
  updateMoodCount();
});

document.querySelectorAll('.chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const mood = chip.dataset.mood;
    if (state.selectedMood === mood) {
      // Tapping the already-selected chip deselects it
      state.selectedMood = null;
      chip.classList.remove('selected');
    } else {
      document.querySelectorAll('.chip').forEach(c => c.classList.remove('selected'));
      state.selectedMood = mood;
      chip.classList.add('selected');
    }
    updateMoodCount();
  });
});

function composeMoodDescription() {
  const text = state.moodText.trim();
  const chip = state.selectedMood;
  if (text && chip) return `${text}. Mood: ${chip}`;
  if (text) return text;
  if (chip) return `Mood: ${chip}`;
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
    await Promise.all([refreshWatchlist(), refreshWatchedFilms()]);
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

// Step 3 — Import Letterboxd export ZIP (or skip). Uses the shared
// file-picker helper so the wizard and settings paths stay in sync; the
// `advanceToWizardStep` opt makes the success state route to wz2 instead
// of going home.
$('wizImportBtn').addEventListener('click', () => {
  openLetterboxdFilePicker({ advanceToWizardStep: 2 });
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
    await Promise.all([refreshWatchlist(), refreshWatchedFilms()]);
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

async function refreshWatchedFilms() {
  if (!state.session) return;
  try {
    const res = await apiFetch('/api/user-watched');
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`/api/user-watched ${res.status}: ${body.slice(0, 200)}`);
    }
    const films = await res.json();
    state.watchedFilms = Array.isArray(films) ? films : [];
    console.log('[watched] loaded', state.watchedFilms.length, 'films from user_watched');
  } catch (e) {
    console.error('[watched] /api/user-watched failed:', e);
  }
}

// Watched films come back camelCase (runtimeMinutes/youtubeId/tmdbId) while
// watchlist films are snake_case. Normalise so the screening + trailer code
// (which expects snake_case) works for both.
function normalizeFilm(f) {
  if (!f) return f;
  return {
    ...f,
    tmdb_id:         f.tmdb_id ?? f.tmdbId ?? null,
    runtime_minutes: f.runtime_minutes ?? f.runtimeMinutes ?? null,
    youtube_id:      f.youtube_id ?? f.youtubeId ?? null,
    user_rating:     f.user_rating ?? f.userRating ?? null,
    tmdb_rating:     f.tmdb_rating ?? f.tmdbRating ?? null,
  };
}

// Personal rating for a watchlist film: prefer the row's own user_rating,
// else cross-reference user_watched by tmdb_id then letterboxd_url.
function ratingForFilm(film) {
  if (film.user_rating != null) return film.user_rating;
  if (film.userRating != null)  return film.userRating;
  const tmdbId = film.tmdb_id ?? film.tmdbId;
  const match = (state.watchedFilms || []).find(w =>
    (tmdbId && w.tmdbId === tmdbId) || (film.url && w.url === film.url));
  return match?.userRating ?? null;
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

function matchesDecade(film, decade) {
  if (!decade) return true;
  const y = parseInt(film.year);
  if (!y) return false;
  const d = parseInt(decade); // parseInt('1990s') === 1990
  return y >= d && y < d + 10;
}

function matchesRuntime(film, runtime) {
  if (!runtime) return true;
  const mins = film.runtime_minutes;
  if (!mins) return false; // unknown runtime → excluded when a filter is set
  if (runtime === 'short')    return mins < 90;
  if (runtime === 'standard') return mins >= 90  && mins <= 120;
  if (runtime === 'long')     return mins >  120 && mins <= 150;
  if (runtime === 'epic')     return mins >  150;
  return true;
}

// Build the filtered pool from state. Does NOT fall back automatically —
// pickFilm() handles the "pool too small" relaxation so the user gets
// feedback when filters are contradictory.
function getFilteredPool() {
  let pool = state.watchlist.slice();

  // Apply mood filter first (most selective)
  if (state.selectedMood && MOOD_FILTERS[state.selectedMood]) {
    const mood = MOOD_FILTERS[state.selectedMood];
    pool = pool.filter(film => {
      const filmGenres = Array.isArray(film.genres) ? film.genres : [];
      const genreMatch = mood.genres.some(g => filmGenres.includes(g));
      const runtimeMatch = !mood.minRuntime
        || (film.runtime_minutes && film.runtime_minutes >= mood.minRuntime);
      return genreMatch && runtimeMatch;
    });
  }

  // Apply decade filter
  if (state.decade) {
    pool = pool.filter(film => matchesDecade(film, state.decade));
  }

  // Apply runtime filter
  if (state.runtime) {
    pool = pool.filter(film => matchesRuntime(film, state.runtime));
  }

  return pool;
}

// Show how many films match the current mood (+ decade/runtime) selection.
// Called after every chip click and filter change.
function updateMoodCount() {
  const el = $('moodCount');
  if (!el) return;
  if (!state.selectedMood) { el.textContent = ''; return; }
  const count = getFilteredPool().length;
  el.textContent = count === 0
    ? 'No films match this mood with current filters'
    : `${count} film${count === 1 ? '' : 's'} match this mood`;
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

// Wire the screening poster to flip and reveal the trailer on tap.
// The iframe is injected lazily on the flip (not at render) so the flip
// gesture itself satisfies iOS's user-gesture requirement for autoplay.
function setupPosterFlip(film) {
  const flip = $('posterFlip');
  if (!flip) return;
  const slot = flip.querySelector('.trailer-embed-slot');
  const hint = flip.querySelector('.flip-hint');

  // Reset to front for the new film + tear down any previous trailer
  flip.classList.remove('flipped');
  slot.innerHTML = '';

  const hasTrailer = !!film.youtube_id;
  hint.style.display = hasTrailer ? 'flex' : 'none';
  flip.style.cursor = hasTrailer ? 'pointer' : 'default';

  flip.onclick = () => {
    if (!hasTrailer) return;
    const isFlipped = flip.classList.toggle('flipped');
    if (isFlipped) {
      // mute=1 + playsinline=1 keep iOS autoplay working under the flip tap
      slot.innerHTML =
        `<iframe src="https://www.youtube.com/embed/${film.youtube_id}` +
        `?autoplay=1&mute=1&rel=0&modestbranding=1&iv_load_policy=3&playsinline=1&enablejsapi=1" ` +
        `allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen ` +
        `style="width:100%;height:100%;"></iframe>`;
    } else {
      slot.innerHTML = ''; // flipping back stops + frees the trailer
    }
  };
}

// Stop the trailer + reset the poster when leaving the screening screen.
function resetPosterFlip() {
  const flip = $('posterFlip');
  if (!flip) return;
  flip.classList.remove('flipped');
  const slot = flip.querySelector('.trailer-embed-slot');
  if (slot) slot.innerHTML = '';
}

async function pickFilm(opts = {}) {
  let pool = opts.ignoreFilters ? state.watchlist : getFilteredPool();

  if (pool.length === 0 && state.selectedMood && !opts.ignoreFilters) {
    // Mood filter + other filters produced nothing — relax mood, keep decade/runtime
    showToast(`No ${state.selectedMood} films match your other filters. Showing a wider pick.`);
    pool = state.watchlist.slice();
    if (state.decade) pool = pool.filter(f => matchesDecade(f, state.decade));
    if (state.runtime) pool = pool.filter(f => matchesRuntime(f, state.runtime));
  }

  if (pool.length === 0) {
    $('homeStatus').textContent = 'No films match these filters. Try clearing some.'; return;
  }

  logo.classList.add('spinning');
  $('homeStatus').textContent = 'Selecting tonight\'s film…';
  await new Promise(r => setTimeout(r, 1100));

  const movie = pool[Math.floor(Math.random() * pool.length)];
  $('homeStatus').textContent = '';
  await showScreeningFor(movie);
}

// Render the screening result for a specific film. Shared by the picker
// (random choice) and the Library (direct "pick this film" / suggested tap).
async function showScreeningFor(movie) {
  if (!movie) return;
  movie = normalizeFilm(movie);   // accept watchlist (snake) + watched (camel) shapes
  state.currentMovie = movie;

  logo.classList.add('spinning');

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
  // Fall back to stored synopsis (e.g. Explore-added films have no scrapeable
  // Letterboxd page yet) so the result is never blank.
  if (!synopsis && movie.synopsis) synopsis = movie.synopsis;

  const moodDisplay = state.selectedMood
    ? state.selectedMood
    : (state.moodText.trim() ? 'Your own words' : 'Open');

  $('resultPoster').src     = posterUrl || movie.poster || '';
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

  // Expanded credits block (director / runtime / cast)
  $('screeningDirector').textContent = movie.director || 'Unknown';
  $('screeningRuntime').textContent  = movie.runtime_minutes ? `${movie.runtime_minutes} min` : '—';
  $('screeningCast').textContent     = (movie.cast && movie.cast.length)
    ? movie.cast.join(', ')
    : '—';

  // Ratings block — TMDB community score (if we have it) + the user's own
  // rating (only if they've rated it before). Whole block hides if neither.
  const personalRating = ratingForFilm(movie);
  const communityRating = movie.tmdb_rating != null ? Math.round(movie.tmdb_rating * 10) / 10 : null;
  const tmdbRow = $('screeningTmdbRow');
  const yourRow = $('screeningYourRow');
  if (communityRating != null) {
    $('screeningTmdbValue').textContent = `★ ${communityRating}`;
    tmdbRow.hidden = false;
  } else {
    tmdbRow.hidden = true;
  }
  if (personalRating != null) {
    $('screeningYourValue').textContent = `★ ${personalRating}`;
    yourRow.hidden = false;
  } else {
    yourRow.hidden = true;
  }
  $('screeningRatings').hidden = (communityRating == null && personalRating == null);

  // Flip-to-trailer poster — injects the iframe on flip (the flip tap is the
  // user gesture iOS requires for autoplay)
  setupPosterFlip(movie);

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
  resetPosterFlip();
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
    } else if (target === 'explore') {
      setBgWarm(false);
      renderExplore();
      show('explore');
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

// Settings → Import: send the user to the standalone #import screen so
// they see the same step-by-step instructions as during onboarding,
// instead of dumping them straight into a system file picker.
$('sheetImportLetterboxd').addEventListener('click', () => {
  closeSheet();
  setBgWarm(false);
  show('import');
});

// Empty-watchlist banner on home — also routes through the instructions screen
$('emptyImportBtn').addEventListener('click', () => {
  setBgWarm(false);
  show('import');
});

// Standalone import screen wiring
$('importBackBtn').addEventListener('click', () => {
  show('home');
  setProgrammeEyebrow();
});

$('importUploadBtn').addEventListener('click', () => openLetterboxdFilePicker());

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

    // Refresh the picker's source — user_films + user_watched now exist
    await Promise.all([refreshWatchlist(), refreshWatchedFilms()]);
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
//
// Two sections: a horizontal "Recently suggested" row (last 6 from history)
// and a full watchlist browser (poster grid + client-side search + sort +
// "seen" indicator). Tapping a grid card opens a detail bottom sheet.

const libraryState = { search: '', sort: 'added' };
const watchedState = { search: '', sort: 'watched' };

// Resolve a history/suggested reference to the full user_films record so the
// screening + detail sheet have director/cast/runtime/genres. Falls back to
// the reference itself if the film isn't in the current watchlist.
function findFilmFor(ref) {
  if (!ref) return null;
  const list = state.watchlist || [];
  return (
    (ref.url     && list.find(f => f.url === ref.url)) ||
    (ref.tmdb_id && list.find(f => f.tmdb_id === ref.tmdb_id)) ||
    (ref.title   && list.find(f =>
      f.title === ref.title && String(f.year || '') === String(ref.year || ''))) ||
    ref
  );
}

function renderLibrary() {
  renderSuggestedRow();
  renderLibraryGrid();
  renderWatchedGrid();
  state.libraryNeedsRefresh = false; // consumed
}

// Switch between the Watchlist and Watched tabs (content is cached in state,
// so this just toggles visibility — no refetch).
function setLibraryTab(tab) {
  state.libraryTab = tab;
  $('libraryWatchlistTab').hidden = tab !== 'watchlist';
  $('libraryWatchedTab').hidden   = tab !== 'watched';
  $('libraryTabs').querySelectorAll('.library-tab').forEach(b =>
    b.classList.toggle('active', b.dataset.tab === tab));
}

function renderSuggestedRow() {
  const section = $('librarySuggestedSection');
  const row     = $('librarySuggestedRow');
  const recent  = (state.history || []).slice(0, 6);
  if (recent.length === 0) { section.hidden = true; row.innerHTML = ''; return; }
  section.hidden = false;
  row.innerHTML = recent.map((item, i) => {
    const poster = item.poster || findFilmFor(item)?.poster || '';
    return `
      <div class="suggested-card" data-suggested="${i}">
        <div class="suggested-poster"${poster ? ` style="background-image:url(${escAttr(poster)})"` : ''}></div>
        <div class="suggested-title">${italiciseTitle(item.title)}</div>
        ${item.year ? `<div class="suggested-year">${escapeHtml(String(item.year))}</div>` : ''}
      </div>`;
  }).join('');
}

function renderLibraryGrid() {
  const grid = $('libraryGrid');
  const all  = state.watchlist || [];

  $('libraryCount').textContent =
    all.length === 0 ? '' : `${all.length} film${all.length === 1 ? '' : 's'}`;

  if (all.length === 0) {
    grid.innerHTML = '<div class="library-empty">Your watchlist is empty. Import from Letterboxd or add films in Explore.</div>';
    return;
  }

  // Filter by title (client-side, live)
  const q = libraryState.search.trim().toLowerCase();
  let films = q ? all.filter(f => (f.title || '').toLowerCase().includes(q)) : all.slice();

  // Sort. 'added' keeps the API order (created_at desc).
  if (libraryState.sort === 'az') {
    films.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  } else if (libraryState.sort === 'year') {
    films.sort((a, b) => (parseInt(b.year) || 0) - (parseInt(a.year) || 0));
  }

  if (films.length === 0) {
    grid.innerHTML = '<div class="library-empty">No films match your search.</div>';
    return;
  }

  // "Seen" = the film has appeared in the suggestion history
  const seen = new Set((state.history || []).map(h => h.url).filter(Boolean));
  const seenCheck = `<svg viewBox="0 0 14 14" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 7 L5.5 10 L11.5 4"/></svg>`;

  grid.innerHTML = films.map(f => {
    const isSeen = seen.has(f.url);
    const genre  = Array.isArray(f.genres) && f.genres.length ? f.genres[0] : null;
    const rating = ratingForFilm(f);
    return `
      <div class="library-card" data-url="${escAttr(f.url)}">
        <div class="lib-card-poster"${f.poster ? ` style="background-image:url(${escAttr(f.poster)})"` : ''}>
          ${isSeen ? `<div class="lib-seen-overlay">${seenCheck}</div>` : ''}
        </div>
        <div class="lib-card-title">${italiciseTitle(f.title)}</div>
        <div class="lib-card-year-row">
          <span class="lib-card-year">${f.year ? escapeHtml(String(f.year)) : '—'}</span>
          ${rating != null ? `<span class="lib-card-rating">★ ${rating}</span>` : ''}
        </div>
        ${genre ? `<span class="genre-pill">${escapeHtml(genre)}</span>` : ''}
      </div>`;
  }).join('');
}

function renderWatchedGrid() {
  const grid = $('watchedGrid');
  const all  = state.watchedFilms || [];

  $('watchedCount').textContent =
    all.length === 0 ? '' : `${all.length} watched film${all.length === 1 ? '' : 's'}`;

  if (all.length === 0) {
    grid.innerHTML = '<div class="library-empty">No watched films yet. Re-import your Letterboxd export to populate this.</div>';
    return;
  }

  const q = watchedState.search.trim().toLowerCase();
  let films = q ? all.filter(f => (f.title || '').toLowerCase().includes(q)) : all.slice();

  // 'watched' keeps the API order (watched_date desc).
  if (watchedState.sort === 'rating') {
    films.sort((a, b) => (b.userRating ?? -1) - (a.userRating ?? -1));
  } else if (watchedState.sort === 'az') {
    films.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
  }

  if (films.length === 0) {
    grid.innerHTML = '<div class="library-empty">No films match your search.</div>';
    return;
  }

  grid.innerHTML = films.map((f, i) => {
    const genre = Array.isArray(f.genres) && f.genres.length ? f.genres[0] : null;
    return `
      <div class="library-card" data-watched="${i}">
        <div class="lib-card-poster"${f.poster ? ` style="background-image:url(${escAttr(f.poster)})"` : ''}>
          ${f.review ? `<div class="lib-review-badge" title="You wrote a review">✍</div>` : ''}
        </div>
        <div class="lib-card-title">${italiciseTitle(f.title)}</div>
        <div class="lib-card-year-row">
          <span class="lib-card-year">${f.year ? escapeHtml(String(f.year)) : '—'}</span>
          ${f.userRating != null ? `<span class="lib-card-rating">★ ${f.userRating}</span>` : ''}
        </div>
        ${genre ? `<span class="genre-pill">${escapeHtml(genre)}</span>` : ''}
      </div>`;
  }).join('');

  // Stash the currently-rendered (filtered+sorted) order so taps resolve to
  // the right film object regardless of search/sort state.
  grid._rendered = films;
}

// ── Film detail bottom sheet ──
// Handles both watchlist films (snake_case: tmdb_id, runtime_minutes,
// user_rating) and watched films (camelCase: tmdbId, runtimeMinutes,
// userRating, review). Shows the personal rating, review, and discovery
// buttons when the data is available.
function openFilmSheet(film) {
  if (!film) return;

  const tmdbId  = film.tmdb_id ?? film.tmdbId ?? null;
  const runtime = film.runtime_minutes ?? film.runtimeMinutes ?? null;
  const rating  = ratingForFilm(film);

  $('filmSheetPoster').src = film.poster || '';
  $('filmSheetPoster').alt = film.title || '';
  $('filmSheetTitle').innerHTML = italiciseTitle(film.title || '');
  $('filmSheetYear').textContent = film.year ? String(film.year) : '';
  $('filmSheetDirector').textContent = film.director || 'Unknown';
  $('filmSheetRuntime').textContent  = runtime ? `${runtime} min` : '—';
  $('filmSheetCast').textContent     = (film.cast && film.cast.length) ? film.cast.join(', ') : '—';
  $('filmSheetSynopsis').textContent = film.synopsis || '';

  // Personal rating
  const ratingEl = $('filmSheetRating');
  if (rating != null) {
    ratingEl.textContent = `★ ${rating} · your rating`;
    ratingEl.hidden = false;
  } else {
    ratingEl.hidden = true;
  }

  // Personal review (watched films only)
  const reviewWrap = $('filmSheetReview');
  if (film.review) {
    $('filmSheetReviewText').textContent = film.review;
    reviewWrap.hidden = false;
  } else {
    reviewWrap.hidden = true;
  }

  const genres = Array.isArray(film.genres) ? film.genres : [];
  $('filmSheetGenres').innerHTML = genres
    .map(g => `<span class="genre-pill">${escapeHtml(g)}</span>`).join('');

  $('filmSheetPickBtn').onclick = () => {
    closeFilmSheet();
    showScreeningFor(film);
  };

  // Discovery buttons — built from whatever metadata we have
  renderDiscoverButtons(film, tmdbId);

  $('filmSheetBackdrop').hidden = false;
  $('filmSheet').hidden = false;
}

// Build the "Discover more" buttons in the sheet: similar films (needs a
// tmdb_id), director filmography, and the top 2 billed cast members.
function renderDiscoverButtons(film, tmdbId) {
  const wrap = $('filmSheetDiscover');
  const list = $('filmSheetDiscoverBtns');
  const btns = [];

  if (tmdbId) {
    btns.push({ action: 'similar', tmdbId, label: 'Films like this' });
  }
  if (film.director) {
    btns.push({ action: 'director', name: film.director, tmdbId,
                label: `More from ${film.director}` });
  }
  (film.cast || []).slice(0, 2).forEach(actor => {
    btns.push({ action: 'actor', name: actor, tmdbId, label: `More with ${actor}` });
  });

  if (btns.length === 0) { wrap.hidden = true; list.innerHTML = ''; return; }
  wrap.hidden = false;
  list.innerHTML = btns.map((b, i) =>
    `<button class="discover-btn" data-discover="${i}">${escapeHtml(b.label)}</button>`).join('');
  list._btns = btns;
  list._sourceFilm = film;
}

function closeFilmSheet() {
  $('filmSheetBackdrop').hidden = true;
  $('filmSheet').hidden = true;
}

$('filmSheetBackdrop').addEventListener('click', closeFilmSheet);

// Grid card tap → open detail sheet
$('libraryGrid').addEventListener('click', e => {
  const card = e.target.closest('.library-card');
  if (!card) return;
  const film = findFilmFor({ url: card.dataset.url });
  openFilmSheet(film);
});

// Suggested card tap → straight to the screening result
$('librarySuggestedRow').addEventListener('click', e => {
  const card = e.target.closest('.suggested-card');
  if (!card) return;
  const idx = parseInt(card.dataset.suggested, 10);
  const ref = (state.history || [])[idx];
  showScreeningFor(findFilmFor(ref));
});

// Live search
$('librarySearch').addEventListener('input', e => {
  libraryState.search = e.target.value;
  renderLibraryGrid();
});

// Sort control
$('librarySort').querySelectorAll('.library-sort-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (libraryState.sort === btn.dataset.sort) return;
    libraryState.sort = btn.dataset.sort;
    $('librarySort').querySelectorAll('.library-sort-btn').forEach(b =>
      b.classList.toggle('active', b === btn));
    renderLibraryGrid();
  });
});

// Manual refresh — re-pull user_films and re-render, with a spin animation
$('libraryRefreshBtn').addEventListener('click', async () => {
  const btn = $('libraryRefreshBtn');
  btn.style.transform  = 'rotate(360deg)';
  btn.style.transition = 'transform 0.5s ease';
  await refreshWatchlist();
  await loadUserHistory().catch(() => {});
  renderLibrary();
  setTimeout(() => {
    btn.style.transform  = '';
    btn.style.transition = '';
  }, 500);
});

// ── Library: tab switching ──
$('libraryTabs').querySelectorAll('.library-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    if (state.libraryTab === btn.dataset.tab) return;
    setLibraryTab(btn.dataset.tab);
  });
});

// ── Watched tab interactions ──
$('watchedGrid').addEventListener('click', e => {
  const card = e.target.closest('.library-card');
  if (!card) return;
  const idx = parseInt(card.dataset.watched, 10);
  const film = ($('watchedGrid')._rendered || [])[idx];
  if (film) openFilmSheet(film);
});

$('watchedSearch').addEventListener('input', e => {
  watchedState.search = e.target.value;
  renderWatchedGrid();
});

$('watchedSort').querySelectorAll('.library-sort-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (watchedState.sort === btn.dataset.sort) return;
    watchedState.sort = btn.dataset.sort;
    $('watchedSort').querySelectorAll('.library-sort-btn').forEach(b =>
      b.classList.toggle('active', b === btn));
    renderWatchedGrid();
  });
});

$('watchedRefreshBtn').addEventListener('click', async () => {
  const btn = $('watchedRefreshBtn');
  btn.style.transform  = 'rotate(360deg)';
  btn.style.transition = 'transform 0.5s ease';
  await refreshWatchedFilms();
  renderWatchedGrid();
  setTimeout(() => { btn.style.transform = ''; btn.style.transition = ''; }, 500);
});

// ── Discovery (from the film sheet's "Discover more" buttons) ──
$('filmSheetDiscoverBtns').addEventListener('click', e => {
  const el = e.target.closest('.discover-btn');
  if (!el) return;
  const list = $('filmSheetDiscoverBtns');
  const spec = (list._btns || [])[parseInt(el.dataset.discover, 10)];
  const film = list._sourceFilm;
  if (spec) openDiscover(spec, film);
});

$('discoverBackBtn').addEventListener('click', () => {
  // Return to the film's detail sheet (over the Library screen)
  show('library');
  if (discoverState.sourceFilm) openFilmSheet(discoverState.sourceFilm);
});

$('discoverResults').addEventListener('click', e => {
  const btn = e.target.closest('.btn-add-watchlist[data-add]');
  if (!btn) return;
  addToWatchlist(parseInt(btn.dataset.add, 10), btn);
});

$('libBackBtn').addEventListener('click', () => { show('home'); setProgrammeEyebrow(); });

// ── Explore (TMDB discovery) ──────────────────────────────────────────────────
//
// State machine: search > decade > mode.
//   • Query in the search box  → always wins (TMDB /search/movie)
//   • Else decade chip != Any  → /discover with primary_release_date range
//   • Else mode toggle         → /trending/movie/week  or  /movie/top_rated
// Each user action calls fetchExploreResults() which re-derives the request.

const exploreState = {
  mode:    'trending',   // 'trending' | 'top_rated'
  query:   '',
  decade:  '',           // '' = any, else 4-digit decade start ("1990")
  loading: false,
};
let exploreSearchTimer = null;

function renderExplore() {
  // Reset on each entry so the screen feels fresh
  exploreState.mode   = 'trending';
  exploreState.query  = '';
  exploreState.decade = '';
  $('exploreSearch').value = '';
  $('exploreModeToggle').classList.remove('disabled');
  $('exploreModeToggle').querySelectorAll('.explore-mode-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === 'trending');
  });
  $('exploreDecades').querySelectorAll('.explore-chip').forEach(c => {
    c.classList.toggle('active', !c.dataset.decade);
  });
  $('exploreResults').innerHTML = '';

  // Reset the similar-to finder
  similarState.query = '';
  similarState.sourceId = null;
  $('exploreSimilarSearch').value = '';
  $('exploreDisambig').hidden = true;
  $('exploreDisambig').innerHTML = '';
  $('exploreSimilarHeader').hidden = true;
  $('exploreSimilarResults').innerHTML = '';
  $('exploreSimilarStatus').textContent = '';

  fetchExploreResults();
}

async function fetchExploreResults() {
  if (exploreState.loading) return;
  exploreState.loading = true;

  const status  = $('exploreStatus');
  const results = $('exploreResults');
  status.textContent = 'Loading…';
  logo.classList.add('spinning');

  // Build the right query — search > decade > mode (see state-machine note above)
  const params = new URLSearchParams();
  if (exploreState.query) {
    params.set('mode', 'search');
    params.set('q', exploreState.query);
  } else if (exploreState.decade) {
    params.set('mode', 'discover');
    params.set('decade', exploreState.decade);
  } else {
    params.set('mode', exploreState.mode);
  }

  try {
    const res = await apiFetch(`/api/explore?${params}`);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`/api/explore ${res.status}: ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    renderExploreResults(data.films || []);
    status.textContent = (data.films || []).length === 0
      ? (exploreState.query ? 'No films match that search.' : 'No films to show.')
      : '';
  } catch (e) {
    console.error('[explore] fetch failed:', e);
    results.innerHTML = '';
    status.textContent = "Couldn't load Explore. Try again?";
  } finally {
    logo.classList.remove('spinning');
    exploreState.loading = false;
  }
}

function renderExploreResults(films) {
  const results = $('exploreResults');
  if (films.length === 0) { results.innerHTML = ''; return; }

  results.innerHTML = films.map(f => {
    const meta = [f.year || '—'];
    if (typeof f.vote_average === 'number') meta.push(`★ ${f.vote_average}`);
    return `
      <div class="explore-card" data-tmdb-id="${f.tmdb_id}">
        <div class="explore-poster"${f.poster_url ? ` style="background-image:url(${escAttr(f.poster_url)})"` : ''}></div>
        <div class="explore-card-body">
          <h3 class="explore-card-title">${italiciseTitle(f.title)}</h3>
          <div class="explore-card-meta">${meta.join(' · ')}</div>
          ${f.overview ? `<p class="explore-card-overview">${escapeHtml(f.overview)}</p>` : ''}
          <div class="explore-card-actions">
            ${f.in_watchlist
              ? `<button class="explore-add-btn added" disabled>✓ In watchlist</button>`
              : `<button class="explore-add-btn" data-add="${f.tmdb_id}">+ Add to watchlist</button>`}
            <a class="explore-lbx-link" href="${escAttr(f.letterboxd_url)}" target="_blank" rel="noopener">
              Also on Letterboxd ↗
            </a>
          </div>
        </div>
      </div>
    `;
  }).join('');

  results.querySelectorAll('.explore-add-btn[data-add]').forEach(btn => {
    btn.addEventListener('click', () => addExploreFilm(btn));
  });
}

function escapeHtml(s) {
  return (s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function addExploreFilm(btn) {
  const tmdbId = parseInt(btn.dataset.add, 10);
  if (!tmdbId) return;

  btn.disabled    = true;
  btn.textContent = 'Adding…';
  btn.classList.remove('add-error');

  try {
    const res = await apiFetch('/api/user-films/add', {
      method: 'POST',
      body:   JSON.stringify({ tmdb_id: tmdbId }),
    });
    console.log('[add] response:', res);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
    }
    const data = await res.json();
    btn.textContent = data.already_in_watchlist ? '✓ Already in watchlist' : '✓ Added';
    btn.classList.add('added');
    // Refresh state.watchlist + the Library so the new film shows everywhere
    await syncLibraryAfterAdd();
  } catch (e) {
    console.error('[explore] add failed:', e);
    btn.textContent = 'Failed — tap to retry';
    btn.disabled    = false;
    btn.classList.add('add-error');
  }
}

// Wiring — runs once at script load (elements exist in markup)
$('exploreBackBtn').addEventListener('click', () => {
  show('home');
  setProgrammeEyebrow();
});

// Debounced search input. While a query is present the mode toggle is
// visually disabled (mode is irrelevant — we're doing /search/movie).
$('exploreSearch').addEventListener('input', e => {
  exploreState.query = e.target.value.trim();
  $('exploreModeToggle').classList.toggle('disabled', !!exploreState.query);
  // Clearing the search input restores the trending/top-rated mode UI
  clearTimeout(exploreSearchTimer);
  exploreSearchTimer = setTimeout(fetchExploreResults, 350);
});

$('exploreModeToggle').querySelectorAll('.explore-mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (exploreState.query) return; // disabled while searching
    if (exploreState.mode === btn.dataset.mode) return; // already active
    exploreState.mode = btn.dataset.mode;
    $('exploreModeToggle').querySelectorAll('.explore-mode-btn').forEach(b => {
      b.classList.toggle('active', b === btn);
    });
    fetchExploreResults();
  });
});

$('exploreDecades').querySelectorAll('.explore-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    if (exploreState.decade === chip.dataset.decade) return; // already active
    exploreState.decade = chip.dataset.decade;
    $('exploreDecades').querySelectorAll('.explore-chip').forEach(c => {
      c.classList.toggle('active', c === chip);
    });
    fetchExploreResults();
  });
});

// ── Explore: "similar to" recommendation finder ───────────────────────────────
//
// Flow: type a title → /api/explore/search returns up to 5 disambiguation
// matches → tap the right one → /api/explore/similar returns up to 20 TMDB
// recommendations as a poster grid, each with an add-to-watchlist button.

const similarState = { query: '', sourceId: null };
let similarSearchTimer = null;

async function runSimilarSearch() {
  const title = similarState.query.trim();
  const disambig = $('exploreDisambig');
  const status   = $('exploreSimilarStatus');

  // New search supersedes any previous recommendation grid
  $('exploreSimilarHeader').hidden = true;
  $('exploreSimilarResults').innerHTML = '';

  if (!title) {
    disambig.hidden = true;
    disambig.innerHTML = '';
    status.textContent = '';
    return;
  }

  status.textContent = 'Searching…';
  logo.classList.add('spinning');
  try {
    const res = await apiFetch(`/api/explore/search?title=${encodeURIComponent(title)}`);
    if (!res.ok) throw new Error(`search ${res.status}`);
    const { results } = await res.json();
    renderDisambig(results || []);
    status.textContent = (results || []).length === 0 ? 'No films found by that name.' : '';
  } catch (e) {
    console.error('[similar] search failed:', e);
    status.textContent = "Couldn't search. Try again?";
  } finally {
    logo.classList.remove('spinning');
  }
}

function renderDisambig(results) {
  const disambig = $('exploreDisambig');
  if (results.length === 0) { disambig.hidden = true; disambig.innerHTML = ''; return; }
  disambig.hidden = false;
  disambig.innerHTML = results.map(f => `
    <div class="disambig-row" data-tmdb-id="${f.tmdb_id}" data-title="${escAttr(f.title)}" data-year="${escAttr(String(f.year || ''))}">
      <div class="disambig-poster"${f.poster_url ? ` style="background-image:url(${escAttr(f.poster_url)})"` : ''}></div>
      <div class="disambig-info">
        <div class="disambig-title">${italiciseTitle(f.title)}</div>
        <div class="disambig-year">${f.year || '—'}</div>
      </div>
    </div>`).join('');
}

async function loadSimilar(tmdbId, label) {
  similarState.sourceId = tmdbId;
  $('exploreDisambig').hidden = true;
  const header  = $('exploreSimilarHeader');
  const results = $('exploreSimilarResults');
  const status  = $('exploreSimilarStatus');

  results.innerHTML = '';
  status.textContent = 'Finding similar films…';
  logo.classList.add('spinning');
  try {
    const res = await apiFetch(`/api/explore/similar?tmdbId=${encodeURIComponent(tmdbId)}`);
    if (!res.ok) throw new Error(`similar ${res.status}`);
    const data = await res.json();
    const srcTitle = data.source?.title || label || 'that film';
    header.textContent = `Because you searched ${srcTitle}`;
    header.hidden = false;
    renderSimilarGrid(data.results || []);
    status.textContent = (data.results || []).length === 0
      ? 'No recommendations found for that film.' : '';
  } catch (e) {
    console.error('[similar] load failed:', e);
    status.textContent = "Couldn't load recommendations. Try again?";
  } finally {
    logo.classList.remove('spinning');
  }
}

// Shared poster-grid card markup (similar results + discovery results).
function gridCardsHtml(films) {
  return films.map(f => `
    <div class="explore-grid-card">
      <div class="grid-poster"${f.poster_url ? ` style="background-image:url(${escAttr(f.poster_url)})"` : ''}></div>
      <div class="grid-title">${italiciseTitle(f.title)}</div>
      <div class="grid-year">${f.year || '—'}</div>
      ${f.in_watchlist
        ? `<button class="btn-add-watchlist in-watchlist" disabled>✓ In your watchlist</button>`
        : `<button class="btn-add-watchlist" data-add="${f.tmdb_id}">+ Add to watchlist</button>`}
    </div>`).join('');
}

function renderSimilarGrid(films) {
  $('exploreSimilarResults').innerHTML = gridCardsHtml(films);
}

// ── Discovery results (from a film sheet's "Discover more" buttons) ──
const discoverState = { sourceFilm: null };

async function openDiscover(spec, film) {
  discoverState.sourceFilm = film;
  closeFilmSheet();

  const headline = $('discoverHeadline');
  const results  = $('discoverResults');
  const status   = $('discoverStatus');
  results.innerHTML = '';
  status.textContent = 'Loading…';

  // Headline + endpoint per discovery type
  let url;
  if (spec.action === 'similar') {
    headline.textContent = 'Films like this';
    url = `/api/explore/similar?tmdbId=${encodeURIComponent(spec.tmdbId)}`;
  } else if (spec.action === 'director') {
    headline.textContent = `Films directed by ${spec.name}`;
    url = `/api/explore/director?name=${encodeURIComponent(spec.name)}` +
          (spec.tmdbId ? `&excludeTmdbId=${encodeURIComponent(spec.tmdbId)}` : '');
  } else {
    headline.textContent = `Films with ${spec.name}`;
    url = `/api/explore/actor?name=${encodeURIComponent(spec.name)}` +
          (spec.tmdbId ? `&excludeTmdbId=${encodeURIComponent(spec.tmdbId)}` : '');
  }

  show('discover');
  logo.classList.add('spinning');
  try {
    const res = await apiFetch(url);
    if (!res.ok) throw new Error(`discover ${res.status}`);
    const data = await res.json();
    const films = data.results || [];
    results.innerHTML = gridCardsHtml(films);
    status.textContent = films.length === 0 ? 'No films to show.' : '';
  } catch (e) {
    console.error('[discover] failed:', e);
    status.textContent = "Couldn't load these. Try again?";
  } finally {
    logo.classList.remove('spinning');
  }
}

// After a successful add: pull the fresh watchlist into state, then update
// the Library — immediately if it's the visible screen, otherwise flag it so
// the next visit re-renders. renderLibrary() reads from state.watchlist, so
// the new film appears in the grid once this resolves.
async function syncLibraryAfterAdd() {
  await refreshWatchlist();           // updates state.watchlist
  state.libraryNeedsRefresh = true;
  if (currentScreen() === 'library') renderLibrary(); // clears the flag
}

async function addToWatchlist(tmdbId, btn) {
  if (!tmdbId) return;
  btn.textContent = 'Adding…';
  btn.disabled = true;
  btn.classList.remove('add-error');
  try {
    const res = await apiFetch('/api/user-films/add', {
      method: 'POST',
      body:   JSON.stringify({ tmdbId }),
    });
    console.log('[add] response:', res);
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`add ${res.status}: ${body.slice(0, 300)}`);
    }
    btn.textContent = '✓ In your watchlist';
    btn.classList.add('in-watchlist');
    await syncLibraryAfterAdd();
  } catch (e) {
    console.error('[similar] add failed:', e);
    btn.textContent = 'Failed — tap to retry';
    btn.disabled = false;
    btn.classList.add('add-error');
  }
}

// Debounced similar-to search
$('exploreSimilarSearch').addEventListener('input', e => {
  similarState.query = e.target.value;
  clearTimeout(similarSearchTimer);
  similarSearchTimer = setTimeout(runSimilarSearch, 400);
});

// Pick a disambiguation match → load recommendations
$('exploreDisambig').addEventListener('click', e => {
  const row = e.target.closest('.disambig-row');
  if (!row) return;
  const tmdbId = parseInt(row.dataset.tmdbId, 10);
  const label  = row.dataset.year
    ? `${row.dataset.title} (${row.dataset.year})`
    : row.dataset.title;
  loadSimilar(tmdbId, label);
});

// Add a recommendation to the watchlist (delegated)
$('exploreSimilarResults').addEventListener('click', e => {
  const btn = e.target.closest('.btn-add-watchlist[data-add]');
  if (!btn) return;
  addToWatchlist(parseInt(btn.dataset.add, 10), btn);
});

// ── Trailers ──────────────────────────────────────────────────────────────────
//
// Architecture: raw <iframe> per card, src set/cleared by an
// IntersectionObserver at 0.3 threshold. No YouTube IFrame API SDK loaded —
// we just enable JS commands via enablejsapi=1 and use window.postMessage
// to send mute/unMute commands directly.
//
// Mute model: PER-CARD, NOT sticky. Every card autoplays muted (mute=1
// in URL — the only variant browsers reliably allow). Tapping the card
// body flips audio on the current card via postMessage; the next card
// starts muted again. The icon in the top-right is a passive indicator
// (pointer-events:none) — it doesn't catch the tap, it just reflects
// state. Tapping the Letterboxd link inside the info overlay still
// navigates normally (excluded from the toggle handler).

let trailerObserver = null;

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
      <div class="trailer-mute-btn" aria-label="Mute status" role="img">${muteSvg(true)}</div>
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

  // Tap anywhere on the card body toggles mute — the mute icon in the
  // corner is a passive indicator (see CSS pointer-events:none) so taps
  // pass through. Excludes the Letterboxd link, which navigates normally.
  feed.querySelectorAll('.trailer-card').forEach(card => {
    card.addEventListener('click', e => {
      if (e.target.closest('.trailer-lbx-link')) return;
      toggleMute(card);
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

function loadCardIframe(card) {
  const iframe = card.querySelector('iframe');
  const ytId   = card.dataset.youtubeId;
  if (!iframe || !ytId) return;
  if (iframe.src.includes(`/embed/${ytId}`)) return; // already loaded

  // Muted autoplay is allowed on every browser including iOS Safari,
  // provided playsinline=1 and mute=1 are set (both are in the URL).
  iframe.src         = trailerEmbedUrl(ytId);
  card.dataset.muted = 'true';
  updateMuteIcon(card, true);
}

function unloadCardIframe(card) {
  const iframe = card.querySelector('iframe');
  if (iframe && iframe.src) iframe.src = '';
  delete card.dataset.muted;
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

// Per-card mute toggle. Affects only this card — no carry-forward to
// other cards in the feed. The next card the user scrolls to will start
// muted again and they'll need to re-tap unmute if they want audio there.
// (Earlier sticky-mute attempts broke iOS playback; per-card is the
// stable path across every browser.)
function toggleMute(card) {
  if (!card) return;
  const iframe = card.querySelector('iframe');
  if (!iframe) return;

  const isMuted  = card.dataset.muted !== 'false';
  const newMuted = !isMuted;

  card.dataset.muted = newMuted ? 'true' : 'false';
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
  disclosures.push(buildDisclosure('decade',  DECADE_OPTIONS,  'decadeValue',  updateMoodCount));
  disclosures.push(buildDisclosure('runtime', RUNTIME_OPTIONS, 'runtimeValue', updateMoodCount));

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
    await Promise.all([refreshWatchlist(), refreshWatchedFilms()]);
    show('home');
    setProgrammeEyebrow();

  } else {
    // No session → must sign in / sign up. Guest mode was removed when the
    // scraper went away (the app is import-only now).
    show('auth-entry');
  }
}

boot();
