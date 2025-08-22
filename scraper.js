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
  log('Scraping movie list from URL: %s (Page %d)', url, page);
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
      
      if (!altText || !moviePageUrl) {
        log('Skipping element due to missing altText or moviePageUrl: %s', altText);
        continue;
      }

      const match = altText.match(/^(.*?)\s*\((\d{4})\)$/);
      let title, year;

      if (match) {
        title = match[1].trim();
        year = parseInt(match[2], 10);
      } else {
        // Fallback for titles without a year in the alt text
        title = altText.trim();
        year = null; // Or consider a default/current year if applicable, but null is safer for TMDB search
        log('Warning: Could not parse year from alt text "%s" for movie "%s". Year set to NULL.', altText, title);
      }

      movies.push({ title, year, poster, moviePageUrl });
    }
    log('Found %d movies on page %d from list scrape.', movies.length, page);
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

    if (!videoUrl) {
      log('No video URL found on detail page: %s', moviePageUrl);
      return null;
    }

    const description = $('.post-description-box p').text().trim() || 'No description available.';
    const genre = $('.post-genres a').map((i, el) => $(el).text()).get().join(', ') || 'General';

    log('Successfully scraped stream and details for %s. Video URL found, quality: %s', moviePageUrl, quality);
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

// R5, R11: Main scraper function
export async function runScraper() {
  log('Starting scraper run...');
  const isFullScrape = process.env.SCRAPE_MODE === 'full';
  
  const processPage = async (page) => {
    const moviesFromList = await scrapeMovieListPage(page);
    if (moviesFromList.length === 0) {
      log(`No more movies found on page ${page}. Terminating page processing.`);
      return false;
    }

    for (const movie of moviesFromList) {
      let existingMovie = null;
      if (movie.year) { // Only check for existing if we have a valid year
        existingMovie = await db.getMovieByTitleAndYear(movie.title, movie.year);
      } else {
        log('Skipping existing movie check for "%s" due to missing year.', movie.title);
      }

      // R11: Smarter handling of existing movies based on IMDb ID presence
      if (existingMovie && existingMovie.imdb_id) {
        log('Movie "%s (%s)" (ID: %d) already linked with IMDb ID: %s. Skipping detailed scrape/TMDB lookup.', 
            movie.title, movie.year, existingMovie.id, existingMovie.imdb_id);
        if (!isFullScrape) { // In incremental mode, skip movies that are already fully linked
          continue; 
        }
        // In full scrape mode, we might want to refresh metadata even if linked, 
        // but for now, let's keep the existing behavior of updating metadata for existing entries.
        // The addMovieAndStream will handle updates if it proceeds.
      } else if (existingMovie && !existingMovie.imdb_id) {
        log('Movie "%s (%s)" (ID: %d) exists but is UNLINKED. Attempting to fetch stream and TMDB metadata.', 
            movie.title, movie.year, existingMovie.id);
        // Continue to scrape details and TMDB lookup
      } else {
        log('New movie "%s (%s)" found. Proceeding with detailed scrape and TMDB metadata.', movie.title, movie.year || 'N/A');
        // Continue to scrape details and TMDB lookup
      }
      
      await delay(1000 + Math.random() * 1000); // R5: Delay between requests

      const streamDetails = await scrapeStreamUrl(movie.moviePageUrl);
      if (streamDetails && streamDetails.video_url) {
        let finalMovieData = { ...movie, ...streamDetails };

        // R6, R11: TMDB lookup for metadata enrichment
        log('Attempting TMDB lookup for "%s (%s)"...', finalMovieData.title, finalMovieData.year || 'N/A');
        const tmdbData = await tmdb.searchMovie(finalMovieData.title, finalMovieData.year);

        if (tmdbData && tmdbData.external_ids?.imdb_id) {
          log('TMDB SUCCESS for "%s (%s)": Found IMDb ID %s, TMDB ID %s', 
              finalMovieData.title, finalMovieData.year, tmdbData.external_ids.imdb_id, tmdbData.id);
          finalMovieData.imdb_id = tmdbData.external_ids.imdb_id;
          finalMovieData.tmdb_id = tmdbData.id;
          finalMovieData.description = tmdbData.overview || finalMovieData.description;
          finalMovieData.rating = tmdbData.vote_average?.toFixed(1) || finalMovieData.rating;
          finalMovieData.genre = tmdbData.genres?.map(g => g.name).join(', ') || finalMovieData.genre;
          finalMovieData.poster = tmdbData.poster_path ? `https://image.tmdb.org/t/p/w500${tmdbData.poster_path}` : finalMovieData.poster;
        } else {
            log('TMDB FAILED to find valid IMDb ID for "%s (%s)". Using scraped data only. IMDb ID will be NULL.', 
                finalMovieData.title, finalMovieData.year || 'N/A');
            finalMovieData.imdb_id = null; // Ensure it's explicitly null if TMDB fails to link
            finalMovieData.tmdb_id = null;
        }
        await db.addMovieAndStream(finalMovieData);
        log('Finished processing movie data for "%s (%s)". Final IMDb ID: %s', 
            finalMovieData.title, finalMovieData.year, finalMovieData.imdb_id || 'NULL');
      } else {
        log('Skipping movie "%s (%s)" due to no stream URL found after detail page scrape.', movie.title, movie.year);
      }
    }
    return true; // Indicate that movies were processed, continue to next page if full scrape
  };

  if (isFullScrape) {
    log('Full scrape mode enabled. Scraping all pages...');
    let page = 1;
    while (await processPage(page)) {
      page++;
      await delay(2000); // R5: Delay between pages
    }
    log('Full scrape finished.');
  } else {
    log('Incremental scrape mode. Scraping first page only...');
    await processPage(1); // Process only the first page for incremental
    log('Incremental scrape finished.');
  }
}
