const API_BASE = 'https://watchwheel.onrender.com';

const state = {
  username: localStorage.getItem('ww_username') || null,
  watchlist: [],
  selectedMoods: new Set(),
  moodText: '',
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
  closeAllDisclosures();
  window.scrollTo({ top: 0, behavior: 'instant' });
}

function setBgWarm(on) { document.body.classList.toggle('warm-bg', on); }

// PROGRAMME EYEBROW
function setProgrammeEyebrow() {
  const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
  const day = days[new Date().getDay()];
  const num = state.history.length + 1;
  $('programmeNo').textContent = `No. ${num}`;
  $('programmeDay').textContent = `A ${day} programme`;
}

// DISCLOSURE OPTIONS
const DECADE_OPTIONS = [
  { value: null,       label: 'Any era',                  sub: '—'      },
  { value: '1930s',    label: 'The thirties',             sub: '1930s'  },
  { value: '1940s',    label: 'The forties',              sub: '1940s'  },
  { value: '1950s',    label: 'The fifties',              sub: '1950s'  },
  { value: '1960s',    label: 'The sixties',              sub: '1960s'  },
  { value: '1970s',    label: 'The seventies',            sub: '1970s'  },
  { value: '1980s',    label: 'The eighties',             sub: '1980s'  },
  { value: '1990s',    label: 'The nineties',             sub: '1990s'  },
  { value: '2000s',    label: 'The two thousands',        sub: '2000s'  },
  { value: '2010s',    label: 'The two thousand tens',    sub: '2010s'  },
  { value: '2020s',    label: 'The two thousand twenties',sub: '2020s'  },
];

const RUNTIME_OPTIONS = [
  { value: null,       label: 'Any length',       sub: '—'           },
  { value: 'short',    label: 'A short evening',  sub: '‹ 90 min'    },
  { value: 'standard', label: 'Standard feature', sub: '90–120 min'  },
  { value: 'long',     label: 'Long form',        sub: '120–150 min' },
  { value: 'epic',     label: 'An epic',          sub: '› 150 min'   },
];

// DISCLOSURE COMPONENT
function buildDisclosure(name, options, valueLabelId, displayMap) {
  const root = document.querySelector(`[data-disclosure="${name}"]`);
  const panel = root.querySelector('[data-disclosure-panel]');
  const trigger = root.querySelector('[data-disclosure-trigger]');
  const affordance = trigger.querySelector('.glass-affordance');

  function render() {
    panel.innerHTML = options.map(opt => {
      const isSelected = state[name] === opt.value;
      return `
        <button class="panel-option ${isSelected ? 'selected' : ''}" data-value="${opt.value ?? ''}">
          <span class="opt-value">${opt.label}</span>
          <span class="opt-sub">${opt.sub}</span>
        </button>
      `;
    }).join('');

    panel.querySelectorAll('.panel-option').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const raw = btn.dataset.value;
        const val = raw === '' ? null : raw;
        state[name] = val;
        const chosen = options.find(o => o.value === val);
        $(valueLabelId).textContent = chosen.label;
        close();
      });
    });
  }

  function open() {
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
    if (root.classList.contains('open')) close();
    else open();
  });

  return { open, close, root };
}

const disclosures = [];

function closeAllDisclosures(except) {
  disclosures.forEach(d => { if (d.root !== except) d.close(); });
}

document.addEventListener('click', () => closeAllDisclosures());

// MOOD TEXT + CHIPS
const moodTextEl = $('moodText');
const chipsBlock = $('chipsBlock');

function autoGrow(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 140) + 'px';
}

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
  const text = state.moodText.trim();
  const chips = Array.from(state.selectedMoods);
  if (text && chips.length) return `${text}. Mood: ${chips.join(', ')}`;
  if (text) return text;
  if (chips.length) return `Mood: ${chips.join(', ')}`;
  return '';
}

// ONBOARDING
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

// PICK LOGIC
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
    $('homeStatus').textContent = 'No films match those filters.';
    return;
  }

  logo.classList.add('spinning');
  $('homeStatus').textContent = 'Selecting tonight\'s film…';
  await new Promise(r => setTimeout(r, 1100));

  const movie = pool[Math.floor(Math.random() * pool.length)];
  state.currentMovie = movie;

  let posterUrl = null;
  try {
    const res = await fetch(`${API_BASE}/poster?url=${encodeURIComponent(movie.url)}`);
    const data = await res.json();
    posterUrl = data.image;
  } catch (e) {}

  const moodDescription = composeMoodDescription();
  const moodDisplay = state.selectedMoods.size > 0
    ? Array.from(state.selectedMoods)[0]
    : (state.moodText ? 'Your own words' : 'Open');

  $('resultPoster').src = posterUrl || '';
  $('resultPoster').alt = movie.title;
  $('resultTitle').innerHTML = italiciseTitle(movie.title);
  $('resultMeta').innerHTML = [movie.year, 'Letterboxd'].filter(Boolean).join(' &nbsp;·&nbsp; ');
  $('resultDirector').textContent = '';
  $('resultQuote').textContent = pickQuote();
  $('statMood').textContent = moodDisplay.charAt(0).toUpperCase() + moodDisplay.slice(1);
  $('statPace').textContent = state.runtime
    ? RUNTIME_OPTIONS.find(o => o.value === state.runtime).label
    : 'Unhurried';
  $('watchLink').href = movie.url;

  const entry = { ...movie, poster: posterUrl, when: Date.now(), mood: moodDisplay };
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

// SHEET
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

// LIBRARY
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

// BOOT
async function boot() {
  disclosures.push(buildDisclosure('decade', DECADE_OPTIONS, 'decadeValue'));
  disclosures.push(buildDisclosure('runtime', RUNTIME_OPTIONS, 'runtimeValue'));

  if (!state.username) {
    show('onboarding');
    return;
  }

  const cached = localStorage.getItem('ww_watchlist');
  if (cached) state.watchlist = JSON.parse(cached);

  show('home');
  setProgrammeEyebrow();

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
