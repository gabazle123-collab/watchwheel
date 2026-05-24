const PROXY = 'https://api.allorigins.win/raw?url=';

const usernameInput = document.getElementById('username');
const loadBtn = document.getElementById('loadBtn');
const status = document.getElementById('status');

loadBtn.addEventListener('click', async () => {
  const username = usernameInput.value.trim();
  if (!username) return;

  const url = `https://letterboxd.com/${username}/watchlist/`;
  const res = await fetch(PROXY + encodeURIComponent(url));
  const html = await res.text();

  // Find the first occurrence of data-item-name and show surrounding HTML
  const idx = html.indexOf('data-item-name');
  console.log('Surrounding HTML:', html.substring(idx - 200, idx + 300));
});
