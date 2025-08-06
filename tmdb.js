import axios from 'axios';
import debug from 'debug';

const log = debug('addon:tmdb');
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_API_URL = 'https://api.themoviedb.org/3';
const TIMEOUT = 10000;

if (!TMDB_API_KEY) {
  log('Warning: TMDB_API_KEY environment variable not set. Metadata lookups will be skipped.');
}

class TmdbProvider {
  // R45: Add a title sanitization step to improve match rate.
  #sanitizeTitle(title) {
    // Replaces underscores with spaces and removes excess whitespace.
    return title.replace(/_/g, ' ').trim();
  }

  async #search(params) {
    if (!TMDB_API_KEY) return null;
    try {
      const { data } = await axios.get(`${TMDB_API_URL}/search/movie`, {
        params: { api_key: TMDB_API_KEY, ...params },
        timeout: TIMEOUT
      });
      return data.results && data.results.length > 0 ? data.results[0] : null;
    } catch (error) {
      log('Error during TMDB search for params %o. Message: %s', params, error.message);
      if (error.response) { log('TMDB API Error Response: %o', error.response.data); }
      return null;
    }
  }

  async #getMovieDetails(tmdbId) {
    if (!TMDB_API_KEY || !tmdbId) return null;
    try {
      const { data } = await axios.get(`${TMDB_API_URL}/movie/${tmdbId}`, {
        params: { api_key: TMDB_API_KEY, append_to_response: 'external_ids' },
        timeout: TIMEOUT
      });
      return data;
    } catch (error) {
      log('Error getting TMDB movie details for id %s. Message: %s', tmdbId, error.message);
      if (error.response) { log('TMDB API Error Response: %o', error.response.data); }
      return null;
    }
  }

  async searchMovie(title, year) {
    if (!TMDB_API_KEY) return null;
    
    const sanitizedTitle = this.#sanitizeTitle(title);
    log('Searching TMDB for sanitized title: "%s" (original: "%s"), year: %s', sanitizedTitle, title, year);
    
    let result = await this.#search({ query: sanitizedTitle, year: year, region: 'IN' });
    if (result) return this.#getMovieDetails(result.id);
    
    result = await this.#search({ query: sanitizedTitle, region: 'IN' });
    if (result) return this.#getMovieDetails(result.id);
    
    result = await this.#search({ query: sanitizedTitle, year: year });
    if (result) return this.#getMovieDetails(result.id);
    
    result = await this.#search({ query: sanitizedTitle });
    if (result) return this.#getMovieDetails(result.id);
    
    log('No TMDB match found for: %s (%s)', sanitizedTitle, year);
    return null;
  }

  async getMovieDetailsByImdbId(imdbId) {
    if (!TMDB_API_KEY || !imdbId) return null;
    log('Finding TMDB entry for IMDb ID: %s', imdbId);
    try {
      const { data } = await axios.get(`${TMDB_API_URL}/find/${imdbId}`, {
        params: { api_key: TMDB_API_KEY, external_source: 'imdb_id' },
        timeout: TIMEOUT
      });
      if (data.movie_results && data.movie_results.length > 0) {
        return this.#getMovieDetails(data.movie_results[0].id);
      }
      return null;
    } catch (error) {
      log('Error finding by IMDb ID %s. Message: %s', imdbId, error.message);
      if (error.response) { log('TMDB API Error Response: %o', error.response.data); }
      return null;
    }
  }
}

export default new TmdbProvider();
