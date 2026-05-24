const API_BASE = 'https://watchwheel.onrender.com';

const state = {
  username: localStorage.getItem('ww_username') || null,
  watchlist: [],
  selectedMoods: new Set(),
  decade: null,
  runtime: null,
  history: JSON.parse(localStorage.getItem('ww_history') || '[]'),
  currentMovie: null,
};

const $ = (id) => document.getElementById(id);
const logo = document.querySelector('.logo');

function show(screenId) {
  ['onboarding', 'home', 'screening', 'library'].forEach(id => {
    $(id).hidden = (id !== screenId);
  });
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function setBgWarm(on) {
  document.body.classList.toggle('warm-bg', on);
}

// ── PROGRAMME EYEBROW ──
function setProgrammeEyebrow() {
  const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const day = days[new Date().getDay()];
  const num = state.history.length + 1;
  $('programmeNo').textContent = `No. ${num}`;
  $('programmeDay').textContent = `A ${day} programme`;
}

// ── DECADE / RUNTIME PICKERS ──
const DECADES = ['Any era', '2020s', '2010s', '2000s', '1990s', '1980s', '1970s', '1960s', 'Pre-1960'];
const RUNTIMES = ['Any length', 'Under 90 min', '90–120 min', 'Over 2 hours'];

function cycle(arr, current) {
  const i = arr.indexOf(current);
  return arr[(i + 1) % arr.length];
}

$('decadeCard').addEventListener('click', () => {
  const next = cycle(DECADES, $('decadeValue').textContent);
  $('decadeValue').textContent = next;
  state.decade = next === 'Any era' ? null : next;
});

$('runtimeCard').addEventListener('click', () => {
  const next = cycle(RUNTIMES, $('runtimeValue').textContent);
  $('runtimeValue').textContent = next;
  state.runtime = next === 'Any length' ? null : next;
});

// ── MOOD CHIPS ──
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

// ── ONBOARDING ──
$('saveUsernameBtn').addEventListener('click', async () => {
  const name = $('usernameInput').value.trim();
  if (!name) return;
  $('onboardStatus').textContent = 'Loading your watchlist…';
  logo.classList.add('spinning');
  try {
    const res = await fetch(`${API_BASE}/watchlist/${name}`);
    const data = await res.json();
    if (!data.movies || data.movies.length === 0) {
      $('onboardStatus').textContent = 'No films found. Is the watchlist public?';
      logo.classList.remove('spinning');
      return;
    }
    state.username = name;
    state.watchlist = data.movies;
    localStorage.setItem('ww_username', name);
    localStorage.setItem('ww_watchlist', JSON.stringify(data.movies));
    localStorage.setItem('ww_watchlist_fetched', Date.now().toString());
    logo.classList.remove('spinning');
    show('home');
    setProgrammeEyebrow();
  } catch (e) {
    logo.classList.remove('spinning');
    $('onboardStatus').textContent = 'Couldn\'t reach Letterboxd. Try again?';
  }
});

// ── PICK LOGIC ──
function filterWatchlist() {
  let pool = state.watchlist.slice();

  if (state.decade) {
    pool = pool.filter(m => {
      const y = parseInt(m.year);
      if (!y) return false;
      if (state.decade === 'Pre-1960') return y < 1960;
      const d = parseInt(state.decade);
      return y >= d && y < d + 10;
    });
  }

  return pool.length > 0 ? pool : state.watchlist;
}

const MOODS_META = {
  'slow-burn': { mood: 'Contemplative', pace: 'Patient' },
  'sun-drenched': { mood: 'Languid', pace: 'Drifting' },
  'noir': { mood: 'Shadowed', pace: 'Taut' },
  'melancholy': { mood: 'Wistful', pace: 'Lingering' },
  'first-date': { mood: 'Tender', pace: 'Easy' },
  'wintry': { mood: 'Hushed', pace: 'Still' },
};

const QUOTES = [
  '"A near-silent meditation on what is left unsaid."',
  '"Dim the lights. Let it work on you slowly."',
  '"Hardly a film — more a long, held breath."',
  '"For an evening when the world feels far away."',
  '"A picture to be watched once and remembered always."',
  '"The kind of film one returns to in different weather."',
];

function pickQuote() {
  return QUOTES[Math.floor(Math.random() * QUOTES.length)];
}

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
    $('homeStatus').textContent = 'No films match those filters.';
    return;
  }

  logo.classList.add('spinning');
  $('homeStatus').textContent = 'Selecting tonight\'s film…';
  await new Promise(r => setTimeout(r, 1100));

  const movie = pool[Math.floor(Math.random() * pool.length)];
  state.currentMovie = movie;

  // Pull poster
  let posterUrl = null;
  try {
    const res = await fetch(`${API_BASE}/poster?url=${encodeURIComponent(movie.url)}`);
    const data = await res.json();
    posterUrl = data.image;
  } catch (e) {}

  // Determine mood metadata
  const chosenMoods = Array.from(state.selectedMoods);
  const moodKey = chosenMoods[0] || 'slow-burn';
  const meta = MOODS_META[moodKey] || MOODS_META['slow-burn'];

  // Render
  $('resultPoster').src = posterUrl || '';
  $('resultPoster').alt = movie.title;
  $('resultTitle').innerHTML = italiciseTitle(movie.title);
  $('resultMeta').innerHTML = [movie.year, 'Letterboxd'].filter(Boolean).join(' &nbsp;·&nbsp; ');
  $('resultDirector').textContent = '';
  $('resultQuote').textContent = pickQuote();
  $('statMood').textContent = meta.mood;
  $('statPace').textContent = meta.pace;
  $('watchLink').href = movie.url;

  // Save to history
  const entry = { ...movie, poster: posterUrl, when: Date.now(), mood: meta.mood };
  state.history.unshift(entry);
  state.history = state.history.slice(0, 20);
  localStorage.setItem('ww_history', JSON.stringify(state.history));

  logo.classList.remove('spinning');
  $('homeStatus').textContent = '';
  setBgWarm(true);
  show('screening');
}

$('pickBtn').addEventListener('click', () => pickFilm());
$('surpriseBtn').addEventListener('click', () => pickFilm({ ignoreFilters: true }));
$('anotherBtn').addEventListener('click', () => pickFilm());

$('backBtn').addEventListener('click', () => {
  setBgWarm(false);
  show('home');
  setProgrammeEyebrow();
});

// ── SETTINGS SHEET ──
function openSheet() {
  $('currentUser').textContent = state.username || '';
  $('sheetBackdrop').hidden = false;
  $('sheet').hidden = false;
}
function closeSheet() {
  $('sheetBackdrop').hidden = true;
  $('sheet').hidden = true;
}
$('settingsBtn').addEventListener('click', openSheet);
$('sheetBackdrop').addEventListener('click', closeSheet);

$('sheetLibrary').addEventListener('click', () => {
  closeSheet();
  renderLibrary();
  setBgWarm(false);
  show('library');
});

$('sheetChangeUser').addEventListener('click', () => {
  closeSheet();
  localStorage.removeItem('ww_username');
  localStorage.removeItem('ww_watchlist');
  state.username = null;
  state.watchlist = [];
  $('usernameInput').value = '';
  setBgWarm(false);
  show('onboarding');
});

$('libBackBtn').addEventListener('click', () => {
  show('home');
  setProgrammeEyebrow();
});

// ── RECENTLY PROGRAMMED ──
function timeAgo(ts) {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return 'yesterday';
  if (d < 7) return `${d}d ago`;
  const w = Math.floor(d / 7);
  return `${w}w ago`;
}

function renderLibrary() {
  const list = $('libraryList');
  if (state.history.length === 0) {
    list.innerHTML = '<div class="library-empty">No films programmed yet.</div>';
    return;
  }
  list.innerHTML = state.history.map(item => `
    <a class="library-row" href="${item.url}" target="_blank" rel="noopener">
      ${item.poster ? `<img class="thumb" src="${item.poster}" alt="">` : `<div class="thumb"></div>`}
      <div>
        <div class="lib-title">${italiciseTitle(item.title)}</div>
        <div class="lib-meta">${[item.year, item.mood].filter(Boolean).join(' · ')}</div>
      </div>
      <span class="lib-time">${timeAgo(item.when)}</span>
    </a>
  `).join('');
}

// ── BOOT ──
async function boot() {
  if (!state.username) {
    show('onboarding');
    return;
  }

  // Load cached watchlist, refresh in background
  const cached = localStorage.getItem('ww_watchlist');
  if (cached) state.watchlist = JSON.parse(cached);

  show('home');
  setProgrammeEyebrow();

  // Refresh watchlist quietly in background
  try {
    const res = await fetch(`${API_BASE}/watchlist/${state.username}`);
    const data = await res.json();
    if (data.movies && data.movies.length > 0) {
      state.watchlist = data.movies;
      localStorage.setItem('ww_watchlist', JSON.stringify(data.movies));
    }
  } catch (e) {}
}

boot();
