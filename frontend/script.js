const API_BASE = 'https://watchwheel.onrender.com';

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
  try {
    const response = await fetch(`${API_BASE}/watchlist/${username}`);
    const data = await response.json();
    watchlist = data.movies || [];
    status.innerText = watchlist.length > 0
      ? `Loaded ${watchlist.length} movies`
      : 'No movies found. Is the watchlist public?';
  } catch (err) {
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
