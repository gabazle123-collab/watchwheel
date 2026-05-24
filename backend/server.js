import express from 'express';
import cors from 'cors';
import axios from 'axios';
import * as cheerio from 'cheerio';

const app = express();

app.use(cors());

app.get('/', (req, res) => {
  res.send('WatchWheel backend running');
});

app.get('/watchlist/:username', async (req, res) => {
  try {
    const username = req.params.username;

    const url = `https://letterboxd.com/${username}/watchlist/`;

    const response = await axios.get(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
    });

    const html = response.data;

    const $ = cheerio.load(html);

    const movies = [];

    $('div.react-component.poster').each((i, el) => {
      const data = $(el).attr('data-item-slug');

      if (data) {
        const title = $(el).attr('data-item-name');

        movies.push({
          title: title || data,
          url: `https://letterboxd.com/film/${data}/`
        });
      }
    });

    res.json({ movies });

  } catch (err) {
    console.error(err);

    res.status(500).json({
      error: 'Failed to fetch watchlist'
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
