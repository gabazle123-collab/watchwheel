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
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  }
});

    const html = response.data;

    const $ = cheerio.load(html);

const movies = [];

const regex = /"filmSlug":"(.*?)".*?"name":"(.*?)"/g;

let match;

while ((match = regex.exec(html)) !== null) {
  const slug = match[1];
  const title = match[2];

  movies.push({
    title,
    url: `https://letterboxd.com/film/${slug}/`
  });
}

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
