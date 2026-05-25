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
  wizWatchlist:   [],
  wizDigestOptIn: true,
  wizDigestHour:  18,
};

// ── Core helpers ──────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);
const logo = document.querySelector('.logo');

const ALL_SCREENS = [
  'auth-entry', 'auth-signup', 'auth-signin',
  'onboarding', 'wizard',
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
  window.scrollTo({ top: 0, behavior: 'instant' });
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
$('guestBtn').addEventListener('click',    () => show('onboarding'));

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
    const cached = localStorage.getItem('ww_watchlist');
    if (cached) state.watchlist = JSON.parse(cached);
    show('home');
    setProgrammeEyebrow();
    refreshWatchlist();
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
  state.wizWatchlist   = [];
  state.wizDigestOptIn = true;
  state.wizDigestHour  = 18;
  $('wizUsername').value             = '';
  $('wizUsernameStatus').textContent = '';
  $('wizPreview').hidden             = true;
  $('wz1NextBtn').hidden             = true;
  $('digestToggle').classList.add('active');
  $('toggleCheck').classList.add('checked');
  showWizardStep(1);
  show('wizard');
}

function showWizardStep(n) {
  [1, 2, 3].forEach(i => { $(`wz${i}`).hidden = (i !== n); });
  $('wizardStepLabel').textContent          = `Step ${n} of 3`;
  $('wizardBackBtn').style.visibility       = n === 1 ? 'hidden' : 'visible';
  if (n === 3) renderTimeOptions('timeOptions', state.wizDigestHour, h => { state.wizDigestHour = h; });
}

$('wizardBackBtn').addEventListener('click', () => {
  const cur = [1, 2, 3].find(i => !$(`wz${i}`).hidden);
  if (cur > 1) showWizardStep(cur - 1);
});

// Step 1 — username + live preview
$('wizPreviewBtn').addEventListener('click', async () => {
  const username = $('wizUsername').value.trim();
  const statusEl = $('wizUsernameStatus');
  if (!username) { statusEl.textContent = 'Enter a Letterboxd username.'; return; }

  statusEl.textContent = 'Loading your watchlist…';
  logo.classList.add('spinning');
  $('wizPreviewBtn').disabled = true;
  $('wizPreview').hidden      = true;
  $('wz1NextBtn').hidden      = true;

  try {
    const res  = await fetch(`${API_BASE}/watchlist/${username}`);
    const data = await res.json();
    logo.classList.remove('spinning');
    $('wizPreviewBtn').disabled = false;

    if (!data.movies || data.movies.length === 0) {
      statusEl.textContent = 'No films found — is this watchlist public?'; return;
    }

    state.wizUsername  = username;
    state.wizWatchlist = data.movies;
    statusEl.textContent = '';

    const six = data.movies.slice(0, 6);
    $('wizPreview').innerHTML = `
      <div class="eyebrow eyebrow-sm" style="margin-bottom:10px;">
        <span class="rule"></span>${data.movies.length} films found
      </div>
      <div class="wiz-preview-grid">
        ${six.map(m => `
          <div class="wiz-preview-item">
            <div>${m.title}</div>
            <div class="wiz-film-year">${m.year || '—'}</div>
          </div>`).join('')}
      </div>`;
    $('wizPreview').hidden = false;
    $('wz1NextBtn').hidden = false;

  } catch (e) {
    logo.classList.remove('spinning');
    $('wizPreviewBtn').disabled = false;
    statusEl.textContent = 'Couldn\'t reach Letterboxd. Try again?';
  }
});

$('wz1NextBtn').addEventListener('click', () => showWizardStep(2));

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

  state.username  = state.wizUsername;
  state.watchlist = state.wizWatchlist;
  localStorage.setItem('ww_username',  state.username);
  localStorage.setItem('ww_watchlist', JSON.stringify(state.watchlist));
  localStorage.setItem('ww_watchlist_fetched', Date.now().toString());

  try {
    await apiFetch('/api/profile', {
      method: 'PATCH',
      body: JSON.stringify({
        letterboxd_username: state.username,
        digest_opt_in:       state.wizDigestOptIn,
        digest_hour:         state.wizDigestHour,
      }),
    });
    await loadUserProfile();
  } catch (e) {}

  logo.classList.remove('spinning');
  $('wz3DoneBtn').disabled = false;
  setBgWarm(false);
  show('home');
  setProgrammeEyebrow();
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
  status.textContent = 'Checking watchlist…';
  logo.classList.add('spinning');

  try {
    const res  = await fetch(`${API_BASE}/watchlist/${username}`);
    const data = await res.json();
    if (!data.movies || data.movies.length === 0) {
      status.textContent = 'No films found — is this watchlist public?';
    } else {
      await apiFetch('/api/profile', {
        method: 'PATCH',
        body: JSON.stringify({ letterboxd_username: username }),
      });
      state.username  = username;
      state.watchlist = data.movies;
      localStorage.setItem('ww_username',  username);
      localStorage.setItem('ww_watchlist', JSON.stringify(data.movies));
      await loadUserProfile();
      $('accountUsername').textContent = username;
      $('changeUsernameForm').hidden   = true;
      $('newUsernameInput').value      = '';
      status.textContent = '';
    }
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
  if (!state.username) return;
  try {
    const res  = await fetch(`${API_BASE}/watchlist/${state.username}`);
    const data = await res.json();
    if (data.movies?.length) {
      state.watchlist = data.movies;
      localStorage.setItem('ww_watchlist', JSON.stringify(data.movies));
      localStorage.setItem('ww_watchlist_fetched', Date.now().toString());
    }
  } catch (e) {}
}

// ── Guest prompt ──────────────────────────────────────────────────────────────

function showGuestPrompt() {
  if (localStorage.getItem('ww_guest_prompt_dismissed')) return;
  const el = document.createElement('div');
  el.className = 'guest-prompt';
  el.innerHTML = `
    <p class="guest-prompt-text">Create an account for cross-device history and a nightly film note curated for you.</p>
    <div class="guest-prompt-actions">
      <button class="btn-primary" id="guestPromptCreate"
        style="font-size:12px; padding:10px 14px; min-height:0; letter-spacing:0.06em;">
        Create an account
      </button>
      <button class="guest-prompt-dismiss" id="guestPromptDismiss">Not now</button>
    </div>`;
  const home = $('home');
  home.insertBefore(el, home.querySelector('.dek').nextSibling);
  $('guestPromptCreate').addEventListener('click',  () => { el.remove(); show('auth-signup'); });
  $('guestPromptDismiss').addEventListener('click', () => {
    localStorage.setItem('ww_guest_prompt_dismissed', '1');
    el.remove();
  });
}

// ── Onboarding (guest path) ───────────────────────────────────────────────────

$('saveUsernameBtn').addEventListener('click', async () => {
  const name = $('usernameInput').value.trim();
  if (!name) return;
  $('onboardStatus').textContent = 'Loading your watchlist…';
  logo.classList.add('spinning');
  try {
    const res  = await fetch(`${API_BASE}/watchlist/${name}`);
    const data = await res.json();
    if (!data.movies || data.movies.length === 0) {
      $('onboardStatus').textContent = 'No films found. Is the watchlist public?';
      logo.classList.remove('spinning');
      return;
    }
    state.username  = name;
    state.watchlist = data.movies;
    localStorage.setItem('ww_username',  name);
    localStorage.setItem('ww_watchlist', JSON.stringify(data.movies));
    localStorage.setItem('ww_watchlist_fetched', Date.now().toString());
    logo.classList.remove('spinning');
    show('home');
    setProgrammeEyebrow();
    showGuestPrompt();
  } catch (e) {
    logo.classList.remove('spinning');
    $('onboardStatus').textContent = 'Couldn\'t reach Letterboxd. Try again?';
  }
});

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
  $('sheetAccount').hidden    = !isSignedIn;
  $('sheetChangeUser').hidden = isSignedIn;
  if (isSignedIn) {
    $('currentUser').textContent = state.profile?.letterboxd_username || state.user.email || '';
  } else {
    $('currentUserGuest').textContent = state.username || '';
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

$('sheetChangeUser').addEventListener('click', () => {
  closeSheet();
  localStorage.removeItem('ww_username');
  localStorage.removeItem('ww_watchlist');
  state.username  = null;
  state.watchlist = [];
  $('usernameInput').value = '';
  setBgWarm(false);
  show('onboarding');
});

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

// ── YouTube IFrame API (loaded once globally) ─────────────────────────────────

let _ytReady = false;
const _ytQueue = [];

function ensureYouTubeAPI() {
  if (_ytReady || document.querySelector('script[src*="youtube.com/iframe_api"]')) return;
  const s = document.createElement('script');
  s.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(s);
}

window.onYouTubeIframeAPIReady = function () {
  _ytReady = true;
  _ytQueue.splice(0).forEach(fn => fn());
};

function whenYouTubeReady(fn) {
  if (_ytReady) { fn(); return; }
  _ytQueue.push(fn);
  ensureYouTubeAPI();
}

// ── Trailers ──────────────────────────────────────────────────────────────────

let trailerObserver = null;
let trailerMuted    = true;

async function renderTrailers() {
  const feed   = $('trailerFeed');
  const dots   = $('trailerDots');
  const status = $('trailerStatus');

  // Teardown previous observer
  if (trailerObserver) { trailerObserver.disconnect(); trailerObserver = null; }
  trailerMuted = true;

  // Kick off YT API loading in the background
  ensureYouTubeAPI();

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

  // Skeleton cards render immediately so the screen feels instant
  feed.innerHTML = pool.map((m, i) => `
    <div class="trailer-card trailer-skeleton"
         data-film-url="${escAttr(m.url)}"
         data-film-index="${i}">
      <div class="trailer-poster-bg"></div>
      <div class="trailer-video-wrap"><div class="trailer-slot"></div></div>
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

  // Wire mute buttons (per card — tap toggles globally)
  feed.querySelectorAll('.trailer-mute-btn').forEach(btn => {
    btn.addEventListener('click', e => { e.stopPropagation(); toggleMute(); });
  });

  // Start observing immediately — activates first card once data arrives
  initTrailerObserver();

  // Fetch video IDs from backend
  status.textContent = 'Finding trailers…';
  logo.classList.add('spinning');
  try {
    const res  = await apiFetch('/trailers/batch', {
      method: 'POST',
      body:   JSON.stringify({ films: pool }),
    });
    const data = await res.json();
    const trailerMap = new Map((data.trailers || []).map(t => [t.url, t.youtube_id]));
    const quotaHit   = (data.trailers || []).some(t => t.error === 'quota_exceeded');

    // Stamp each card with its youtube_id (or '') and remove skeleton
    feed.querySelectorAll('.trailer-card').forEach(card => {
      const ytId = trailerMap.get(card.dataset.filmUrl) || null;
      card.dataset.youtubeId = ytId || '';
      card.classList.remove('trailer-skeleton');
      if (!ytId) card.classList.add('trailer-no-video');
    });

    // Activate the top card now that video IDs are known
    const first = feed.querySelector('.trailer-card');
    if (first) activateCard(first);

    status.textContent = quotaHit ? 'Daily trailer quota reached — try again tomorrow.' : '';
  } catch (e) {
    status.textContent = 'Couldn\'t load trailers.';
  } finally {
    logo.classList.remove('spinning');
  }
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

function initTrailerObserver() {
  if (trailerObserver) trailerObserver.disconnect();
  const feed = $('trailerFeed');
  const items = [...feed.querySelectorAll('.trailer-card, .trailer-end-card')];
  trailerObserver = new IntersectionObserver(entries => {
    entries.forEach(entry => {
      if (entry.intersectionRatio >= 0.6) activateCard(entry.target);
    });
  }, { root: feed, threshold: 0.6 });
  items.forEach(el => trailerObserver.observe(el));
}

function activateCard(card) {
  const feed     = $('trailerFeed');
  const dotEls   = [...$('trailerDots').querySelectorAll('.trailer-dot')];
  const allItems = [...feed.querySelectorAll('.trailer-card, .trailer-end-card')];
  const idx      = allItems.indexOf(card);

  // Update progress dots
  dotEls.forEach((d, i) => d.classList.toggle('active', i === idx));

  // Manage iframe lifecycle — load active ±1, unload distant
  allItems.forEach((c, i) => {
    if (c.classList.contains('trailer-end-card')) return;
    if (Math.abs(i - idx) <= 1) loadTrailerIframe(c);
    else                        unloadTrailerIframe(c);
  });

  // Autoplay the active card's player
  const p = card._ytPlayer;
  if (p) {
    try { p.playVideo(); trailerMuted ? p.mute() : p.unMute(); } catch (_) {}
  }

  // Pause all other cards
  allItems.forEach(c => {
    if (c === card || !c._ytPlayer) return;
    try { c._ytPlayer.pauseVideo(); } catch (_) {}
  });
}

function loadTrailerIframe(card) {
  if (card._ytPlayer || card._ytLoading) return;
  const ytId = card.dataset.youtubeId;
  if (!ytId) return;
  if (!card.querySelector('.trailer-slot')) return;
  card._ytLoading = true;
  whenYouTubeReady(() => {
    card._ytLoading = false;
    if (card._ytPlayer) return;
    const target = card.querySelector('.trailer-slot');
    if (!target) return; // was unloaded while waiting
    card._ytPlayer = new window.YT.Player(target, {
      videoId: ytId,
      playerVars: {
        autoplay: 1, mute: 1, controls: 0,
        modestbranding: 1, rel: 0, playsinline: 1, enablejsapi: 1,
      },
      events: {
        onReady(e) {
          e.target.playVideo();
          if (!trailerMuted) e.target.unMute();
        },
        onError() { card.classList.add('trailer-no-video'); },
      },
    });
  });
}

function unloadTrailerIframe(card) {
  card._ytLoading = false;
  if (!card._ytPlayer) return;
  try { card._ytPlayer.destroy(); } catch (_) {}
  card._ytPlayer = null;
  // Recreate the slot so the next loadTrailerIframe() has a target
  const wrap = card.querySelector('.trailer-video-wrap');
  if (wrap) {
    const slot = document.createElement('div');
    slot.className = 'trailer-slot';
    wrap.appendChild(slot);
  }
}

function toggleMute() {
  trailerMuted = !trailerMuted;
  const feed = $('trailerFeed');
  // Apply to all loaded players
  feed.querySelectorAll('.trailer-card').forEach(c => {
    if (!c._ytPlayer) return;
    try { trailerMuted ? c._ytPlayer.mute() : c._ytPlayer.unMute(); } catch (_) {}
  });
  // Update all mute button icons
  feed.querySelectorAll('.trailer-mute-btn').forEach(btn => {
    btn.innerHTML = muteSvg(trailerMuted);
  });
}

$('trailersBackBtn').addEventListener('click', () => {
  // Teardown observer and destroy all active players
  if (trailerObserver) { trailerObserver.disconnect(); trailerObserver = null; }
  $('trailerFeed').querySelectorAll('.trailer-card').forEach(unloadTrailerIframe);
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

    // Serve home instantly from cache, hydrate in background
    const cached = localStorage.getItem('ww_watchlist');
    if (cached) state.watchlist = JSON.parse(cached);

    await loadUserHistory();
    show('home');
    setProgrammeEyebrow();
    refreshWatchlist(); // background — updates cache silently

  } else {
    // ── Guest / new visitor ──
    if (state.username) {
      // Returning guest with a stored Letterboxd username
      const cached = localStorage.getItem('ww_watchlist');
      if (cached) state.watchlist = JSON.parse(cached);
      show('home');
      setProgrammeEyebrow();
      showGuestPrompt();
      refreshWatchlist(); // background
    } else {
      show('auth-entry');
    }
  }
}

boot();
