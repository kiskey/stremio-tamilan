import axios from 'axios';
import * as cheerio from 'cheerio';
import debug from 'debug';
import db from './database.js';
import tmdb from './tmdb.js';
import sessionManager from './session.js'; // R16: Import the new session manager

const log = debug('addon:scraper');
const scraperTargetUrl = process.env.SCRAPER_TARGET_URL || 'https://tamilan24.com/videos/latest';

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function scrapeMovieListPage(page = 1) {
  const url = `${scraperTargetUrl}?page_id=${page}`;
  log('Scraping movie list from URL: %s (Page %d)', url, page);
  try {
    const { data } = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Cookie': sessionManager.getCookie() // R16.4: Use session cookie for list page requests
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
        title = altText.trim();
        year = null;
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

async function scrapeStreamUrl(moviePageUrl) {
  log('Scraping stream URL from detail page: %s', moviePageUrl);

  const makeRequest = async () => {
    return axios.get(moviePageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Referer': scraperTargetUrl,
        'Cookie': sessionManager.getCookie() // R16.4: Use session cookie for detail page requests
      },
      timeout: 15000
    });
  };

  try {
    let response = await makeRequest();
    let $ = cheerio.load(response.data);
    let videoUrl = $('div.player-video source').attr('src');

    // R16.5: Handle session expiry and re-login by checking for the video URL
    if (!videoUrl) {
      log('No video URL found on first attempt for %s. Assuming session expired, attempting re-login.', moviePageUrl);
      const loginSuccess = await sessionManager.login();
      if (loginSuccess) {
        log('Re-login successful. Retrying scrape for %s with new cookie.', moviePageUrl);
        response = await makeRequest(); // Retry request with the new cookie
        $ = cheerio.load(response.data);
        videoUrl = $('div.player-video source').attr('src');
      } else {
        log('Re-login failed. Cannot scrape stream URL for %s.', moviePageUrl);
        return null;
      }
    }
    
    // Final check after potential retry
    if (!videoUrl) {
      log('No video URL found on detail page even after re-login attempt: %s', moviePageUrl);
      return null;
    }

    const quality = $('div.player-video source').attr('data-quality') || 'HD';
    const description = $('.post-description-box p').text().trim() || 'No description available.';
    const genre = $('.post-genres a').map((i, el) => $(el).text()).get().join(', ') || 'General';

    log('Successfully scraped stream and details for %s. Video URL found, quality: %s', moviePageUrl, quality);
    return { video_url: videoUrl, quality, description, genre };
  } catch (error) {
    console.error(`Failed to scrape ${moviePageUrl} due to an error: %s`, error.message);
    if (error.response) {
      log('Scrape error response status: %d', error.response.status);
    }
    return null;
  }
}

// R5, R11, R16: Main scraper function
export async function runScraper() {
  log('Starting scraper run...');

  // R16: Attempt initial login before starting any scraping.
  if (!sessionManager.isInitialized) {
      const loggedIn = await sessionManager.login();
      if (!loggedIn) {
          log('Initial login failed. Aborting scraper run. Please check SCRAPER_USERNAME and SCRAPER_PASSWORD.');
          return;
      }
  }

  const isFullScrape = process.env.SCRAPE_MODE === 'full';
  
  const processPage = async (page) => {
    const moviesFromList = await scrapeMovieListPage(page);
    if (moviesFromList.length === 0) {
      log(`No more movies found on page ${page}. Terminating page processing.`);
      return false;
    }

    for (const movie of moviesFromList) {
      let existingMovie = null;
      if (movie.year) {
        existingMovie = await db.getMovieByTitleAndYear(movie.title, movie.year);
      } else {
        log('Skipping existing movie check for "%s" due to missing year.', movie.title);
      }

      if (existingMovie && existingMovie.imdb_id) {
        log('Movie "%s (%s)" (ID: %d) already linked with IMDb ID: %s. Skipping detailed scrape/TMDB lookup.', 
            movie.title, movie.year, existingMovie.id, existingMovie.imdb_id);
        if (!isFullScrape) {
          continue; 
        }
      } else if (existingMovie && !existingMovie.imdb_id) {
        log('Movie "%s (%s)" (ID: %d) exists but is UNLINKED. Attempting to fetch stream and TMDB metadata.', 
            movie.title, movie.year, existingMovie.id);
      } else {
        log('New movie "%s (%s)" found. Proceeding with detailed scrape and TMDB metadata.', movie.title, movie.year || 'N/A');
      }
      
      await delay(1000 + Math.random() * 1000);

      const streamDetails = await scrapeStreamUrl(movie.moviePageUrl);
      if (streamDetails && streamDetails.video_url) {
        let finalMovieData = { ...movie, ...streamDetails };

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
            finalMovieData.imdb_id = null;
            finalMovieData.tmdb_id = null;
        }
        await db.addMovieAndStream(finalMovieData);
        log('Finished processing movie data for "%s (%s)". Final IMDb ID: %s', 
            finalMovieData.title, finalMovieData.year, finalMovieData.imdb_id || 'NULL');
      } else {
        log('Skipping movie "%s (%s)" due to no stream URL found after detail page scrape.', movie.title, movie.year);
      }
    }
    return true;
  };

  if (isFullScrape) {
    log('Full scrape mode enabled. Scraping all pages...');
    let page = 1;
    while (await processPage(page)) {
      page++;
      await delay(2000);
    }
    log('Full scrape finished.');
  } else {
    log('Incremental scrape mode. Scraping first page only...');
    await processPage(1);
    log('Incremental scrape finished.');
  }
}
