import express from 'express';
import cors from 'cors';
import axios from 'axios';
import * as cheerio from 'cheerio';

const app = express();
app.use(cors());

async function scrapeWatchlist(username) {
  const url = `https://letterboxd.com/${username}/watchlist/`;
  const response = await axios.get(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    }
  });
  const $ = cheerio.load(response.data);
  const movies = [];
  $('[data-item-name]').each((_, el) => {
    const fullName = $(el).attr('data-item-name');
    const link = $(el).attr('data-item-link');
    const yearMatch = fullName.match(/\((\d{4})\)$/);
    const year = yearMatch ? yearMatch[1] : '';
    const title = fullName.replace(/\s*\(\d{4}\)$/, '').trim();
    if (title) {
      movies.push({ title, year, url: 'https://letterboxd.com' + link });
    }
  });
  return movies;
}

app.get('/', (req, res) => res.send('WatchWheel backend running'));

app.get('/watchlist/:username', async (req, res) => {
  try {
    const movies = await scrapeWatchlist(req.params.username);
    res.json({ movies });
  } catch (error) {
    console.error('Scrape error:', error.response?.status, error.message);
    res.status(500).json({ error: 'Failed to scrape', status: error.response?.status });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
