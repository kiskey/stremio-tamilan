const axios = require('axios');
const cheerio = require('cheerio');
const debug = require('debug')('addon:scraper');
const Database = require('./database');

const baseUrl = 'https://tamilan24.com';

async function scrapeMovies(page = 1) {
  const url = `${baseUrl}/movies/page/${page}/`;
  debug('Scraping movies from URL: %s', url);
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

    debug('Scraped %d movies from page %d', movies.length, page);
    return movies;
  } catch (error) {
    console.error(`Error scraping movies from ${url}:`, error);
    debug('Error scraping movies from %s: %O', url, error);
    return [];
  }
}

async function scrapeMovieDetails(movieUrl) {
  debug('Scraping movie details from URL: %s', movieUrl);
  try {
    const { data } = await axios.get(movieUrl);
    const $ = cheerio.load(data);

    const description = $('.sbox.synp .wp-content p').text().trim();
    const genre = $('.sgeneros a').map((i, el) => $(el).text()).get().join(', ');
    const videoUrl = $('iframe').attr('src');
    const imdbId = $('.imdb_r').text().trim();

    const details = {
      description,
      genre,
      video_url: videoUrl,
      imdb_id: imdbId || null
    };

    debug('Scraped movie details for %s: %O', movieUrl, details);
    return details;
  } catch (error) {
    console.error(`Error scraping movie details from ${movieUrl}:`, error);
    debug('Error scraping movie details from %s: %O', movieUrl, error);
    return {};
  }
}

async function runScraper() {
  debug('Starting scraper...');
  const db = new Database();
  await db.init();

  try {
    const movies = await scrapeMovies();
    for (const movie of movies) {
      await db.addMovie(movie);
    }
    debug('Scraper finished.');
  } catch (error) {
    console.error('Scraper failed:', error);
  } finally {
    await db.close();
  }
}

module.exports = { runScraper };
