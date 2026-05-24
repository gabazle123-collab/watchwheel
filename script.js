
const pickBtn = document.getElementById('pickBtn');
const shuffleBtn = document.getElementById('shuffleBtn');
const watchlistInput = document.getElementById('watchlist');
const movieResult = document.getElementById('movieResult');
const movieMeta = document.getElementById('movieMeta');

let currentPool = [];

function parseWatchlist() {
  return watchlistInput.value
    .split('\n')
    .map(movie => movie.trim())
    .filter(movie => movie.length > 0);
}

function pickMovie() {
  const movies = parseWatchlist();

  if (movies.length === 0) {
    movieResult.textContent = "Add some movies first 🎥";
    movieMeta.textContent = "";
    return;
  }

  currentPool = movies;

  const selected = movies[Math.floor(Math.random() * movies.length)];

  animateResult(selected, movies.length);
}

function animateResult(title, total) {
  const fakeTitles = [
    "Loading cinema magic...",
    "Consulting the film gods...",
    "Spinning the reel...",
    "Finding your vibe..."
  ];

  let index = 0;

  const interval = setInterval(() => {
    movieResult.textContent = fakeTitles[index % fakeTitles.length];
    index++;
  }, 120);

  setTimeout(() => {
    clearInterval(interval);

    movieResult.textContent = title;
    movieMeta.textContent = `Chosen from ${total} movies`;
  }, 1300);
}

pickBtn.addEventListener('click', pickMovie);

shuffleBtn.addEventListener('click', () => {
  if (currentPool.length === 0) {
    pickMovie();
    return;
  }

  const selected = currentPool[Math.floor(Math.random() * currentPool.length)];
  animateResult(selected, currentPool.length);
});
