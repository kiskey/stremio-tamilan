import axios from 'axios';
// R1: Changed from `import cheerio from 'cheerio'` to `import * as cheerio from 'cheerio'`.
import * as cheerio from 'cheerio';
import debug from 'debug';
// R2: Import the singleton database instance.
import db from './database.js';

const log = debug('addon:scraper');

// R8 & R9: Make the scraper URL configurable via environment variable.
// Default to the new, correct URL structure.
const scraperTargetUrl = process.env.SCRAPER_TARGET_URL || 'https://tamilan24.com/videos/latest';

async function scrapeMovies(page = 1) {
  // R8: Use the new URL structure with ?page_id= query parameter.
  const url = `${scraperTargetUrl}?page_id=${page}`;
  log('Scraping movies from URL: %s', url);
  try {
    const { data } = await axios.get(url, {
      // Add a realistic User-Agent header to avoid being blocked.
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    const $ = cheerio.load(data);
    const movies = [];

    // ASSUMPTION: The HTML selectors from the old URL are still valid for the new one.
    // These may need to be updated if the website's structure is different at the new URL.
    for (const element of $('.item.movies').get()) {
      const title = $(element).find('h3 a').text();
      const poster = $(element).find('.poster img').attr('src');
      const movieUrl = $(element).find('h3 a').attr('href');

      if (movieUrl) {
        const details = await scrapeMovieDetails(movieUrl);
        movies.push({
          title,
          poster,
          ...details
        });
      }
    }

    log('Scraped %d movies from page %d', movies.length, page);
    return movies;
  } catch (error) {
    // Improved error logging to distinguish between network errors and HTTP status errors.
    if (error.response) {
      console.error(`Error scraping ${url}: Status ${error.response.status}`);
      log(`Error scraping ${url}: Status ${error.response.status}, Data: %o`, error.response.data);
    } else if (error.request) {
      console.error(`Error scraping ${url}: No response received.`);
      log(`Error scraping ${url}: No response received, Request: %o`, error.request);
    } else {
      console.error(`Error scraping ${url}:`, error.message);
      log(`Error scraping ${url}: %O`, error);
    }
    return [];
  }
}

async function scrapeMovieDetails(movieUrl) {
  log('Scraping movie details from URL: %s', movieUrl);
  try {
    const { data } = await axios.get(movieUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    const $ = cheerio.load(data);

    // ASSUMPTION: These selectors are still valid for the movie detail pages.
    const description = $('.sbox.synp .wp-content p').text().trim();
    const genre = $('.sgeneros a').map((i, el) => $(el).text()).get().join(', ');
    const videoUrl = $('iframe').attr('src');
    const imdbIdText = $('.imdb_r').text().trim();
    // A more robust way to get year might be needed, this is also from site structure.
    const yearText = $('.date').text().trim() || new Date().getFullYear().toString();
    const year = parseInt(yearText.match(/\d{4}/)?.[0]) || new Date().getFullYear();

    const details = {
      description,
      genre,
      video_url: videoUrl,
      imdb_id: imdbIdText || null,
      year: year
    };

    log('Scraped movie details for %s: %O', movieUrl, details);
    return details;
  } catch (error) {
    if (error.response) {
      console.error(`Error scraping details from ${movieUrl}: Status ${error.response.status}`);
      log(`Error scraping details from ${movieUrl}: Status ${error.response.status}`);
    } else {
      console.error(`Error scraping details from ${movieUrl}:`, error.message);
      log(`Error scraping details from ${movieUrl}: %O`, error);
    }
    return {};
  }
}

export async function runScraper() {
  log('Starting scraper...');
  // R2: The singleton `db` instance is already initialized.
  try {
    // You could potentially scrape more than one page here in the future.
    const movies = await scrapeMovies(1); 
    for (const movie of movies) {
      if (movie.title && movie.video_url) { // Basic validation
        await db.addMovie(movie);
      }
    }
    log('Scraper finished.');
  } catch (error) {
    console.error('Scraper run failed:', error);
    log('Scraper run failed: %O', error);
  }
  // R2: We no longer close the DB connection here.
}
