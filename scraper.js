const axios = require('axios');
const cheerio = require('cheerio');
const debug = require('debug')('addon:scraper');

const baseUrl = 'https://tamilan24.com';

async function scrapeMovies(page = 1) {
  const url = `${baseUrl}/movies/page/${page}/`;
  debug('Scraping movies from URL: %s', url);
  try {
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);
    const movies = [];

    $('.item.movies').each((index, element) => {
      const title = $(element).find('h3 a').text();
      const poster = $(element).find('.poster img').attr('src');
      const movieUrl = $(element).find('h3 a').attr('href');
      const year = $(element).find('.metadata span:last-child').text().trim();
      const rating = $(element).find('.rating').text().trim();

      movies.push({
        title,
        poster,
        movieUrl,
        year: parseInt(year) || null,
        rating
      });
    });

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
    const videoUrl = $('iframe').attr('src'); // Simplified for this example
    const imdbId = $('.imdb_r').text().trim(); // Example, might need adjustment

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

module.exports = { scrapeMovies, scrapeMovieDetails };
