import axios from 'axios';
// R1: Changed from `import cheerio from 'cheerio'` to `import * as cheerio from 'cheerio'`.
// This correctly imports the cheerio module which does not have a default export.
import * as cheerio from 'cheerio';
import debug from 'debug';
// R2: Import the singleton database instance.
import db from './database.js';

const log = debug('addon:scraper');
const baseUrl = 'https://tamilan24.com';

async function scrapeMovies(page = 1) {
  const url = `${baseUrl}/movies/page/${page}/`;
  log('Scraping movies from URL: %s', url);
  try {
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);
    const movies = [];

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
    console.error(`Error scraping movies from ${url}:`, error);
    log('Error scraping movies from %s: %O', url, error);
    return [];
  }
}

async function scrapeMovieDetails(movieUrl) {
  log('Scraping movie details from URL: %s', movieUrl);
  try {
    const { data } = await axios.get(movieUrl);
    const $ = cheerio.load(data);

    const description = $('.sbox.synp .wp-content p').text().trim();
    const genre = $('.sgeneros a').map((i, el) => $(el).text()).get().join(', ');
    const videoUrl = $('iframe').attr('src');
    // Note: The original scraper looked for .imdb_r, but the site might use different selectors.
    // This is a potential point of failure if the website structure changes.
    // For now, keeping original logic.
    const imdbIdText = $('.imdb_r').text().trim();
    // A more robust way to get year might be needed, this is also from site structure.
    const year = new Date().getFullYear(); // Placeholder, as year is not reliably scraped here

    const details = {
      description,
      genre,
      video_url: videoUrl,
      imdb_id: imdbIdText || null,
      year: year // Add year to details
    };

    log('Scraped movie details for %s: %O', movieUrl, details);
    return details;
  } catch (error) {
    console.error(`Error scraping movie details from ${movieUrl}:`, error);
    log('Error scraping movie details from %s: %O', movieUrl, error);
    return {};
  }
}

export async function runScraper() {
  log('Starting scraper...');
  // R2: No longer need to instantiate or close the database. It's managed by index.js.
  // The singleton `db` instance is already initialized.
  try {
    const movies = await scrapeMovies();
    for (const movie of movies) {
      if (movie.title) { // Basic validation
        await db.addMovie(movie);
      }
    }
    log('Scraper finished.');
  } catch (error) {
    console.error('Scraper failed:', error);
    log('Scraper run failed: %O', error);
  }
  // R2: We no longer close the DB connection here.
}
