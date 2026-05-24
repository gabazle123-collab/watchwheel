
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
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  }
});

  const $ = cheerio.load(response.data);

  const movies = [];

$('li.poster-container').each((_, el) => {
  const film = $(el).find('div[data-film-slug]');

  const title = film.attr('data-film-name');
  const year = film.attr('data-film-release-year');
  const slug = film.attr('data-film-slug');

  if (title) {
    movies.push({
      title,
      year,
      url: `https://letterboxd.com/film/${slug}/`
    });
  }
});

  return movies.filter(movie => movie.title);
}

app.get('/', (req, res) => {
  res.send('WatchWheel backend running');
});

app.get('/watchlist/:username', async (req, res) => {
  try {
    const movies = await scrapeWatchlist(req.params.username);

    res.json({ movies });
  } catch (error) {
    res.status(500).json({
      error: 'Failed to scrape Letterboxd watchlist'
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
