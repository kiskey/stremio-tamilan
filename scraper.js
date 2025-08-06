import axios from 'axios';
import * as cheerio from 'cheerio';
import debug from 'debug';
import db from './database.js';
import tmdb from './tmdb.js';

const log = debug('addon:scraper');
const scraperTargetUrl = process.env.SCRAPER_TARGET_URL || 'https://tamilan24.com/videos/latest';

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function scrapeMovieListPage(page = 1) {
  const url = `${scraperTargetUrl}?page_id=${page}`;
  log('Scraping movie list from URL: %s', url);
  try {
    const { data } = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      },
      timeout: 15000
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

async function scrapeStreamUrl(moviePageUrl, retries = 2) {
  log('Scraping stream URL from detail page: %s', moviePageUrl);
  try {
    const { data } = await axios.get(moviePageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Referer': scraperTargetUrl
      },
      timeout: 15000
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
      await delay(2000);
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
      return false;
    }

    for (const movie of moviesFromList) {
      // R30: Implement the "Check Before You Fetch" optimization for incremental scrapes.
      if (!isFullScrape) {
        const exists = await db.movieExists(movie.title, movie.year);
        if (exists) {
          log('Skipping existing movie: %s (%s)', movie.title, movie.year);
          continue; // Skip to the next movie in the list
        }
      }

      await delay(1000 + Math.random() * 1000);

      const streamDetails = await scrapeStreamUrl(movie.moviePageUrl);
      if (streamDetails && streamDetails.video_url) {
        let finalMovieData = { ...movie, ...streamDetails };

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
    return true;
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
