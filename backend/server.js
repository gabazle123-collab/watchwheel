import express from 'express';
import cors from 'cors';
import axios from 'axios';

const app = express();
app.use(cors());

async function getWatchlist(username) {
  const url = `https://letterboxd.com/${username}/watchlist/rss/`;
  
  const response = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (compatible; WatchWheel/1.0)',
    }
  });

  const xml = response.data;

  const movies = [];
  const items = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];

  for (const item of items) {
    const title = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/)?.[1] || '';
    const link = item.match(/<link>(.*?)<\/link>/)?.[1] || '';
    const year = title.match(/\((\d{4})\)/)?.[1] || '';
    const cleanTitle = title.replace(/\s*\(\d{4}\)/, '').trim();

    if (cleanTitle) {
      movies.push({ title: cleanTitle, year, url: link });
    }
  }

  return movies;
}

app.get('/', (req, res) => {
  res.send('WatchWheel backend running');
});

app.get('/watchlist/:username', async (req, res) => {
  try {
    const movies = await getWatchlist(req.params.username);
    res.json({ movies });
  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ error: 'Failed to fetch watchlist' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
