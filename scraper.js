import axios from 'axios';
import * as cheerio from 'cheerio';
import debug from 'debug';
import db from './database.js';

const log = debug('addon:scraper');
const scraperTargetUrl = process.env.SCRAPER_TARGET_URL || 'https://tamilan24.com/videos/latest';

// R15 & R16: This function now scrapes the list of movies and their detail page URLs.
async function scrapeMovieListPage(page = 1) {
  const url = `${scraperTargetUrl}?page_id=${page}`;
  log('Scraping movie list from URL: %s', url);
  try {
    const { data } = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    const $ = cheerio.load(data);
    const movies = [];

    // R15: Use the new, correct selector for the movie grid.
    for (const element of $('div.videos-latest-list .video-list').get()) {
      const $element = $(element);
      
      // R15: Extract data using the new HTML structure.
      const moviePageUrl = $element.find('a.thumb').attr('href');
      const poster = $element.find('img').attr('src');
      
      // Title and Year are in the 'alt' attribute of the image.
      const altText = $element.find('img').attr('alt');
      
      if (!altText || !moviePageUrl) {
        continue;
      }

      // Regex to parse "Movie Title (YYYY)"
      const match = altText.match(/^(.*?)\s*\((\d{4})\)$/);
      let title, year;

      if (match) {
        title = match[1].trim();
        year = parseInt(match[2], 10);
      } else {
        title = altText.trim(); // Fallback if year is not in parenthesis
        year = new Date().getFullYear();
        log('Could not parse year from alt text: "%s". Falling back to current year.', altText);
      }

      movies.push({
        title,
        year,
        poster,
        moviePageUrl, // URL to the page we need to visit next
        // Other details will be added after visiting the moviePageUrl
      });
    }

    log('Found %d movies on page %d', movies.length, page);
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

// R15 & R16: New function specifically to get the final stream URL from the detail page.
async function scrapeStreamUrl(moviePageUrl) {
  log('Scraping stream URL from detail page: %s', moviePageUrl);
  try {
    const { data } = await axios.get(moviePageUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });
    const $ = cheerio.load(data);

    // R15: Use the correct selector for the video player to find the source URL.
    const videoUrl = $('div.player-video source').attr('src');
    const quality = $('div.player-video source').attr('data-quality') || 'HD';

    if (!videoUrl) {
      log('Could not find video stream URL on page: %s', moviePageUrl);
      return null;
    }

    // This is also a good place to scrape other details if they exist on this page
    const description = $('.post-description-box p').text().trim() || 'No description available.';
    const genre = $('.post-genres a').map((i, el) => $(el).text()).get().join(', ') || 'General';


    return {
        video_url: videoUrl,
        quality: quality,
        description: description,
        genre: genre
    };
  } catch (error) {
    console.error(`Error scraping stream details from ${moviePageUrl}:`, error.message);
    return null;
  }
}

export async function runScraper() {
  log('Starting scraper run...');
  const isFullScrape = process.env.SCRAPE_MODE === 'full';

  if (isFullScrape) {
    log('Full scrape mode enabled. Scraping all pages...');
    let page = 1;
    while (true) {
      log(`Scraping page ${page}...`);
      const moviesFromList = await scrapeMovieListPage(page);
      if (moviesFromList.length === 0) {
        log(`No more movies found on page ${page}. Full scrape finished.`);
        break;
      }

      for (const movie of moviesFromList) {
        const streamDetails = await scrapeStreamUrl(movie.moviePageUrl);
        if (streamDetails && streamDetails.video_url) {
          const finalMovieData = { ...movie, ...streamDetails };
          await db.addMovieAndStream(finalMovieData);
        }
      }
      page++;
    }
  } else {
    log('Incremental scrape mode. Scraping first page for new content...');
    const moviesFromList = await scrapeMovieListPage(1);
    for (const movie of moviesFromList) {
      const streamDetails = await scrapeStreamUrl(movie.moviePageUrl);
      if (streamDetails && streamDetails.video_url) {
        const finalMovieData = { ...movie, ...streamDetails };
        await db.addMovieAndStream(finalMovieData);
      }
    }
    log('Incremental scrape finished.');
  }
}
