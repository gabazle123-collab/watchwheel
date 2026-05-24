import express from 'express';
import cors from 'cors';
import axios from 'axios';
import * as cheerio from 'cheerio';

const app = express();

app.use(cors());

async function scrapeWatchlist(username) {
  const rssUrl = `https://letterboxd.com/${username}/watchlist/rss/`;

  const response = await axios.get(rssUrl, {
    headers: {
      'User-Agent':
        'Mozilla/5.0'
    }
  });

  const $ = cheerio.load(response.data, {
    xmlMode: true
  });

  const movies = [];

  $('item').each((_, el) => {
    const title = $(el).find('title').text();

    if (title) {
      movies.push({
        title,
        year: '',
        url: $(el).find('link').text()
      });
    }
  });

  return movies;
}

app.get('/', (req, res) => {
  res.send('WatchWheel backend running');
});

app.get('/watchlist/:username', async (req, res) => {
  try {
    const movies = await scrapeWatchlist(req.params.username);

    res.json({ movies });
  } catch (error) {
    console.error(error);

    res.status(500).json({
      error: 'Failed to fetch watchlist'
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
