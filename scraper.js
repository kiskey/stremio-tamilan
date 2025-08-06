import axios from 'axios';
import * as cheerio from 'cheerio';
import debug from 'debug';
import db from './database.js';
import tmdb from './tmdb.js'; // R18: Import TMDB module

const log = debug('addon:scraper');
const scraperTargetUrl = process.env.SCRAPER_TARGET_URL || 'https://tamilan24.com/videos/latest';

// R17: Helper for throttling requests
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function scrapeMovieListPage(page = 1) {
  const url = `${scraperTargetUrl}?page_id=${page}`;
  log('Scraping movie list from URL: %s', url);
  try {
    const { data } = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      timeout: 15000 // R17: Set a 15-second timeout
    });
    const $ = cheerio.load(data);
    const movies = [];

    for (const element of $('div.videos-latest-list .video-list').get()) {
      const $element = $(element);
      const moviePageUrl = $element.find('a.thumb').attr('href');
      const poster = $element.find('img').attr('src');
      const altText = $element.find('img').attr('alt');
      
      if (!altText || !moviePageUrl) continue;

      const match = altText.match(/^(.*?)\s*\((\d{4})\)$/);
      let title, year;

      if (match) {
        title = match[1].trim();
        year = parseInt(match[2], 10);
      } else {
        title = altText.trim();
        year = new Date().getFullYear();
      }

      movies.push({ title, year, poster, moviePageUrl });
    }
    log('Found %d movies on page %d', movies.length, page);
    return movies;
  } catch (error) {
    console.error(`Error scraping ${url}:`, error.message);
    return [];
  }
}

// R17: Add retry logic
async function scrapeStreamUrl(moviePageUrl, retries = 2) {
  log('Scraping stream URL from detail page: %s', moviePageUrl);
  try {
    const { data } = await axios.get(moviePageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Referer': scraperTargetUrl // Add Referer header
      },
      timeout: 15000 // 15-second timeout
    });
    const $ = cheerio.load(data);
    const videoUrl = $('div.player-video source').attr('src');
    const quality = $('div.player-video source').attr('data-quality') || 'HD';

    if (!videoUrl) return null;

    const description = $('.post-description-box p').text().trim() || 'No description available.';
    const genre = $('.post-genres a').map((i, el) => $(el).text()).get().join(', ') || 'General';

    return { video_url: videoUrl, quality, description, genre };
  } catch (error) {
    log('Error scraping %s: %s. Retries left: %d', moviePageUrl, error.message, retries);
    if (retries > 0) {
      await delay(2000); // Wait 2 seconds before retrying
      return scrapeStreamUrl(moviePageUrl, retries - 1);
    } else {
      console.error(`Failed to scrape ${moviePageUrl} after multiple retries.`);
      return null;
    }
  }
}

export async function runScraper() {
  log('Starting scraper run...');
  const isFullScrape = process.env.SCRAPE_MODE === 'full';
  const processPage = async (page) => {
    const moviesFromList = await scrapeMovieListPage(page);
    if (moviesFromList.length === 0) {
      log(`No more movies found on page ${page}.`);
      return false; // No more pages
    }

    for (const movie of moviesFromList) {
      // R17: Throttle requests to avoid being blocked
      await delay(1000 + Math.random() * 1000); // Wait 1-2 seconds

      const streamDetails = await scrapeStreamUrl(movie.moviePageUrl);
      if (streamDetails && streamDetails.video_url) {
        let finalMovieData = { ...movie, ...streamDetails };

        // R18: Enrich with TMDB data
        const tmdbData = await tmdb.searchMovie(finalMovieData.title, finalMovieData.year);
        if (tmdbData && tmdbData.external_ids?.imdb_id) {
          log('TMDB success for "%s": Found imdb_id %s', finalMovieData.title, tmdbData.external_ids.imdb_id);
          finalMovieData.imdb_id = tmdbData.external_ids.imdb_id;
          finalMovieData.tmdb_id = tmdbData.id;
          finalMovieData.description = tmdbData.overview || finalMovieData.description;
          finalMovieData.rating = tmdbData.vote_average?.toFixed(1) || finalMovieData.rating;
          finalMovieData.genre = tmdbData.genres?.map(g => g.name).join(', ') || finalMovieData.genre;
        } else {
            log('TMDB fail for "%s". Using scraped data.', finalMovieData.title);
        }
        await db.addMovieAndStream(finalMovieData);
      }
    }
    return true; // More pages may exist
  };

  if (isFullScrape) {
    log('Full scrape mode enabled. Scraping all pages...');
    let page = 1;
    while (await processPage(page)) {
      page++;
    }
    log('Full scrape finished.');
  } else {
    log('Incremental scrape mode. Scraping first page...');
    await processPage(1);
    log('Incremental scrape finished.');
  }
}
```--- END OF MODIFIED FILE `scraper.js` ---

### 3. `index.js` (Removing Meta Handler)

--- START OF MODIFIED FILE `index.js` ---
```javascript
import sdk from 'stremio-addon-sdk';
const { addonBuilder, getRouter } = sdk;
import express from 'express';
import debug from 'debug';
import db from './database.js';
import ScraperScheduler from './scheduler.js';

const log = debug('addon:server');

const manifest = {
  id: 'org.tamilan24.addon',
  version: '1.0.0',
  name: 'Tamilan24 Movies',
  description: 'Tamil movies from Tamilan24',
  logo: 'https://tamilan24.com/themes/tamilan24/assets/images/logo.png',
  background: 'https://tamilan24.com/themes/tamilan24/assets/images/logo.png',
  // R21: Remove 'meta' as we now rely on Cinemata via imdb_id
  resources: ['catalog', 'stream'],
  types: ['movie'],
  catalogs: [
    {
      type: 'movie',
      id: 'tamilan24-latest',
      name: 'Tamilan24 Latest Movies',
      extra: [
        { name: 'skip', isRequired: false },
        { name: 'search', isRequired: false }
      ]
    }
  ]
};

const builder = new addonBuilder(manifest);

builder.defineCatalogHandler(async (args) => {
  log('Catalog request: %O', args);
  try {
    const limit = 100;
    const skip = parseInt(args.extra.skip) || 0;
    
    let movies;
    if (args.extra.search) {
      movies = await db.searchMovies(args.extra.search, limit, skip);
    } else {
      movies = await db.getMovies(limit, skip);
    }
    
    const metas = movies
      .filter(movie => movie.imdb_id) // R21: Only show movies for which we found an imdb_id
      .map(movie => ({
        id: movie.imdb_id, // Use imdb_id directly
        type: 'movie',
        name: movie.title,
        poster: movie.poster,
        description: movie.description,
        releaseInfo: movie.year ? movie.year.toString() : '',
        imdbRating: movie.rating ? movie.rating.toString() : null,
        genres: movie.genre ? movie.genre.split(',').map(g => g.trim()) : []
    }));
    
    return Promise.resolve({ metas });
  } catch (error) {
    console.error('Catalog error:', error);
    return Promise.resolve({ metas: [] });
  }
});

// R21: The meta handler is no longer needed. Stremio will use the imdb_id from the
// catalog response to fetch metadata from its own sources (Cinemata).

builder.defineStreamHandler(async (args) => {
  log('Stream request: %O', args);
  try {
    // We get an imdb_id from Stremio now
    const imdbId = args.id;
    let movie;

    if (imdbId.startsWith('tt')) {
      movie = await db.getMovieByImdbId(imdbId);
    } else {
      // Fallback for any old IDs, though this should be rare now
      const id = args.id.startsWith('t24:') ? args.id.replace('t24:', '') : args.id;
      movie = await db.getMovieById(id);
    }
    
    if (!movie) {
      log('No movie found for stream request ID: %s', args.id);
      return Promise.resolve({ streams: [] });
    }
    
    const streamsFromDb = await db.getStreamsForMovieId(movie.id);
    
    if (!streamsFromDb || streamsFromDb.length === 0) {
      return Promise.resolve({ streams: [] });
    }
    
    const streams = streamsFromDb.map(stream => ({
      title: stream.title,
      url: stream.url,
      behaviorHints: {
        bingeGroup: `tamilan24-${movie.id}-${stream.quality}`
      }
    }));
    
    log('Responding with %d streams for ID: %s', streams.length, args.id);
    return Promise.resolve({ streams });
  } catch (error) {
    console.error('Stream error:', error);
    return Promise.resolve({ streams: [] });
  }
});

const app = express();
const addonInterface = builder.getInterface();
app.use('/', getRouter(addonInterface));

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

const port = process.env.PORT || 7000;
const scheduler = new ScraperScheduler();

db.init().then(() => {
  app.listen(port, '0.0.0.0', () => {
    console.log(`Addon running on http://0.0.0.0:${port}`);
    log(`Addon server started on port ${port}`);
    scheduler.start();
  });
}).catch(err => {
  console.error('Failed to initialize application dependencies:', err);
  process.exit(1);
});
