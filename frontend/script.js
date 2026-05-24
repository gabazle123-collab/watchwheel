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

  status.innerText = 'Loading...';

  const url = `https://letterboxd.com/${username}/watchlist/`;
  const res = await fetch(PROXY + encodeURIComponent(url));
  const html = await res.text();

  console.log('HTML length:', html.length);
  console.log('First 2000 chars:', html.substring(0, 2000));
  console.log('Contains data-film-name:', html.includes('data-film-name'));
  console.log('Contains data-item-name:', html.includes('data-item-name'));
  console.log('Contains film-poster:', html.includes('film-poster'));

  status.innerText = 'Check console (F12)';
});
