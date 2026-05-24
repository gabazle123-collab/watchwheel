const PROXY = 'https://api.allorigins.win/raw?url=';

let watchlist = [];

const usernameInput = document.getElementById('username');
const loadBtn = document.getElementById('loadBtn');
const pickBtn = document.getElementById('pickBtn');
const status = document.getElementById('status');
const movieTitle = document.getElementById('movieTitle');
const movieMeta = document.getElementById('movieMeta');

loadBtn.addEventListener('click', async () => {
  const username = usernameInput.value.trim();
  if (!username) return;

  status.innerText = 'Loading watchlist...';
  watchlist = [];

  try {
    let page = 1;
    while (true) {
      const url = `https://letterboxd.com/${username}/watchlist/page/${page}/`;
      const res = await fetch(PROXY + encodeURIComponent(url));
      const html = await res.text();

      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const films = doc.querySelectorAll('[data-item-name]');

      if (films.length === 0) break;

      films.forEach(film => {
        const fullName = film.getAttribute('data-item-name');
        const link = film.getAttribute('data-item-link');
        const yearMatch = fullName.match(/\((\d{4})\)$/);
        const year = yearMatch ? yearMatch[1] : '';
        const title = fullName.replace(/\s*\(\d{4}\)$/, '').trim();
        watchlist.push({ title, year, url: 'https://letterboxd.com' + link });
      });

      page++;
      if (page > 50) break;
    }

    watchlist = [...new Map(watchlist.map(m => [m.title, m])).values()];

    status.innerText = watchlist.length > 0
      ? `Loaded ${watchlist.length} movies`
      : 'No movies found. Is the watchlist public?';

  } catch (err) {
    console.error(err);
    status.innerText = 'Failed to fetch watchlist';
  }
});

pickBtn.addEventListener('click', () => {
  if (watchlist.length === 0) {
    movieTitle.innerText = 'Load a watchlist first 🎥';
    movieMeta.innerText = '';
    return;
  }
  const movie = watchlist[Math.floor(Math.random() * watchlist.length)];
  movieTitle.innerText = movie.title;
  movieMeta.innerText = `${movie.year || ''} • ${movie.url}`;
});
