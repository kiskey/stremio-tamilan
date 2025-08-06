import axios from 'axios';
import * as cheerio from 'cheerio';
import debug from 'debug';
import db from './database.js';

const log = debug('addon:scraper');
const scraperTargetUrl = process.env.SCRAPER_TARGET_URL || 'https://tamilan24.com/videos/latest';

async function scrapeMovies(page = 1) {
  const url = `${scraperTargetUrl}?page_id=${page}`;
  log('Scraping movies from URL: %s', url);
  try {
    const { data } = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
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
    if (error.response) {
      console.error(`Error scraping ${url}: Status ${error.response.status}`);
      log(`Error scraping ${url}: Status ${error.response.status}, Data: %o`, error.response.data);
    } else {
      console.error(`Error scraping ${url}:`, error.message);
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

    const description = $('.sbox.synp .wp-content p').text().trim();
    const genre = $('.sgeneros a').map((i, el) => $(el).text()).get().join(', ');
    const videoUrl = $('iframe').attr('src');
    const imdbIdText = $('.imdb_r').text().trim();
    const yearText = $('.date').text().trim() || new Date().getFullYear().toString();
    const year = parseInt(yearText.match(/\d{4}/)?.[0]) || new Date().getFullYear();

    const details = {
      description,
      genre,
      video_url: videoUrl, // This will be handled by addMovieAndStream
      quality: 'HD', // Assuming quality, can be scraped if available
      imdb_id: imdbIdText || null,
      year: year
    };

    return details;
  } catch (error) {
    console.error(`Error scraping details from ${movieUrl}:`, error.message);
    return {};
  }
}

// R11 & R14: Implement full vs. incremental scrape logic.
export async function runScraper() {
  log('Starting scraper run...');
  const isFullScrape = process.env.SCRAPE_MODE === 'full';

  if (isFullScrape) {
    log('Full scrape mode enabled. Scraping all pages...');
    let page = 1;
    while (true) {
      log(`Scraping page ${page}...`);
      const movies = await scrapeMovies(page);
      if (movies.length === 0) {
        log(`No more movies found on page ${page}. Full scrape finished.`);
        break;
      }
      for (const movie of movies) {
        if (movie.title && movie.video_url) {
          await db.addMovieAndStream(movie);
        }
      }
      page++;
    }
  } else {
    log('Incremental scrape mode. Scraping first page for new content...');
    const movies = await scrapeMovies(1);
    for (const movie of movies) {
      if (movie.title && movie.video_url) {
        await db.addMovieAndStream(movie);
      }
    }
    log('Incremental scrape finished.');
  }
}
