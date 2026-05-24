
import express from 'express';
import cors from 'cors';
import axios from 'axios';
import * as cheerio from 'cheerio';

const app = express();

app.use(cors());

async function scrapeWatchlist(username) {
  const url = `https://letterboxd.com/${username}/watchlist/`;

  const response = await axios.get(url);

  const $ = cheerio.load(response.data);

  const movies = [];

  $('.poster-container').each((_, el) => {
    const film = $(el).find('.film-poster');

    movies.push({
      title: film.attr('data-film-name'),
      year: film.attr('data-film-release-year'),
      url: 'https://letterboxd.com' + film.attr('data-target-link')
    });
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
