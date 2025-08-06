import axios from 'axios';
import debug from 'debug';

const log = debug('addon:tmdb');
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_API_URL = 'https://api.themoviedb.org/3';
const TIMEOUT = 10000;

const INDIAN_LANGUAGES = ['ta', 'te', 'hi', 'ml', 'kn', 'bn', 'mr', 'pa', 'gu'];

if (!TMDB_API_KEY) {
  log('Warning: TMDB_API_KEY environment variable not set. Metadata lookups will be skipped.');
}

class TmdbProvider {
  #sanitizeTitle(title) {
    return title.replace(/_/g, ' ').trim();
  }

  async #search(params) {
    if (!TMDB_API_KEY) return [];
    try {
      const { data } = await axios.get(`${TMDB_API_URL}/search/movie`, {
        params: { api_key: TMDB_API_KEY, ...params },
        timeout: TIMEOUT
      });
      return data.results || [];
    } catch (error) {
      log('Error during TMDB search for params %o. Message: %s', params, error.message);
      if (error.response) { log('TMDB API Error Response: %o', error.response.data); }
      return [];
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
      log('Error getting TMDB movie details for id %s: %O', tmdbId, error.message);
      if (error.response) { log('TMDB API Error Response: %o', error.response.data); }
      return null;
    }
  }

  // R48: Completely overhauled search logic to include year in local filtering.
  async searchMovie(title, year) {
    if (!TMDB_API_KEY) return null;
    
    const sanitizedTitle = this.#sanitizeTitle(title);
    log('Searching TMDB for sanitized title: "%s" (original: "%s"), year: %s', sanitizedTitle, title, year);
    
    // Step 1: Gather all possible candidates from the API, biasing towards the year.
    const resultsByYearIN = await this.#search({ query: sanitizedTitle, year: year, region: 'IN' });
    const resultsByYear = await this.#search({ query: sanitizedTitle, year: year });
    const resultsGlobal = await this.#search({ query: sanitizedTitle });

    // Combine results and create a unique set based on TMDB ID to avoid duplicates.
    const allResults = [...resultsByYearIN, ...resultsByYear, ...resultsGlobal];
    const uniqueResults = [...new Map(allResults.map(item => [item.id, item])).values()];
    
    if (uniqueResults.length === 0) {
        log('No TMDB match found for: %s (%s)', sanitizedTitle, year);
        return null;
    }

    const lowerCaseTitle = sanitizedTitle.toLowerCase();

    // Step 2: Apply our strict, tiered filtering logic locally.
    const getYearFromResult = (result) => result.release_date ? new Date(result.release_date).getFullYear() : null;

    // Tier 1: Exact Title + Exact Year + Indian Language
    let bestMatch = uniqueResults.find(r => 
      r.title.toLowerCase() === lowerCaseTitle &&
      getYearFromResult(r) === year &&
      INDIAN_LANGUAGES.includes(r.original_language)
    );
    if (bestMatch) {
      log('Found best match on Tier 1 (Exact Title + Year + Indian Language): %s', bestMatch.title);
      return this.#getMovieDetails(bestMatch.id);
    }
    
    // Tier 2: Exact Title + Exact Year + Any Language
    bestMatch = uniqueResults.find(r => 
      r.title.toLowerCase() === lowerCaseTitle &&
      getYearFromResult(r) === year
    );
    if (bestMatch) {
      log('Found best match on Tier 2 (Exact Title + Year + Any Language): %s', bestMatch.title);
      return this.#getMovieDetails(bestMatch.id);
    }
    
    // Tier 3: Fallback to the very first result from the original combined list (respecting API bias).
    const fallbackResult = allResults[0];
    if (fallbackResult) {
        log('No exact match found. Falling back to API top result: %s', fallbackResult.title);
        return this.#getMovieDetails(fallbackResult.id);
    }

    log('No TMDB match found after filtering for: %s (%s)', sanitizedTitle, year);
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
    } catch (error)
    {
      log('Error finding by IMDb ID %s. Message: %s', imdbId, error.message);
      if (error.response) { log('TMDB API Error Response: %o', error.response.data); }
      return null;
    }
  }
}

export default new TmdbProvider();
