const API_BASE = 'https://watchwheel.onrender.com';

let watchlist = [];

const usernameInput = document.getElementById('username');
const loadBtn = document.getElementById('loadBtn');
const pickBtn = document.getElementById('pickBtn');
const status = document.getElementById('status');
const movieTitle = document.getElementById('movieTitle');
const movieMeta = document.getElementById('movieMeta');
const logo = document.querySelector('h1 img');

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

pickBtn.addEventListener('click', async () => {
  if (watchlist.length === 0) {
    movieTitle.innerText = 'Load a watchlist first 🎥';
    movieMeta.innerText = '';
    return;
  }

  // Spin the logo
  logo.classList.add('spinning');
  pickBtn.disabled = true;

  // Wait 1 second then reveal
  await new Promise(resolve => setTimeout(resolve, 1000));

  logo.classList.remove('spinning');
  pickBtn.disabled = false;

  const movie = watchlist[Math.floor(Math.random() * watchlist.length)];
  movieTitle.innerText = movie.title;
  movieMeta.innerText = `${movie.year || ''} • ${movie.url}`;

  // Fetch poster
  const poster = document.getElementById('poster');
  poster.innerHTML = '';
  try {
    const res = await fetch(`${API_BASE}/poster?url=${encodeURIComponent(movie.url)}`);
    const data = await res.json();
    if (data.image) {
      poster.innerHTML = `<img src="${data.image}" style="width:200px; border-radius:12px; margin-top:16px;">`;
    }
  } catch (e) {}
});
