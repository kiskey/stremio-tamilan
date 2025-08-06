import axios from 'axios';
import debug from 'debug';

const log = debug('addon:tmdb');
const TMDB_API_KEY = process.env.TMDB_API_KEY;
const TMDB_API_URL = 'https://api.themoviedb.org/3';

if (!TMDB_API_KEY) {
  log('Warning: TMDB_API_KEY environment variable not set. Metadata lookups will be skipped.');
}

class TmdbProvider {
  async #search(params) {
    if (!TMDB_API_KEY) return null;
    try {
      const { data } = await axios.get(`${TMDB_API_URL}/search/movie`, {
        params: {
          api_key: TMDB_API_KEY,
          ...params
        }
      });
      return data.results && data.results.length > 0 ? data.results[0] : null;
    } catch (error) {
      log('Error during TMDB search: %O', error.message);
      return null;
    }
  }

  async #getMovieDetails(tmdbId) {
    if (!TMDB_API_KEY || !tmdbId) return null;
    try {
      const { data } = await axios.get(`${TMDB_API_URL}/movie/${tmdbId}`, {
        params: {
          api_key: TMDB_API_KEY,
          append_to_response: 'external_ids'
        }
      });
      return data;
    } catch (error) {
      log('Error getting TMDB movie details for id %s: %O', tmdbId, error.message);
      return null;
    }
  }

  // R19: Implement the 4-tier fallback search logic.
  async searchMovie(title, year) {
    if (!TMDB_API_KEY) return null;

    log('Searching TMDB for: %s (%s)', title, year);
    
    // Tier 1: Title + Year, region India
    let result = await this.#search({ query: title, year: year, region: 'IN' });
    if (result) {
      log('Found match on Tier 1 (Title+Year, IN)');
      return this.#getMovieDetails(result.id);
    }

    // Tier 2: Title only, region India
    result = await this.#search({ query: title, region: 'IN' });
    if (result) {
      log('Found match on Tier 2 (Title, IN)');
      return this.#getMovieDetails(result.id);
    }
    
    // Tier 3: Title + Year, no region
    result = await this.#search({ query: title, year: year });
    if (result) {
      log('Found match on Tier 3 (Title+Year, Global)');
      return this.#getMovieDetails(result.id);
    }
    
    // Tier 4: Title only, no region
    result = await this.#search({ query: title });
    if (result) {
      log('Found match on Tier 4 (Title, Global)');
      return this.#getMovieDetails(result.id);
    }
    
    log('No TMDB match found for: %s (%s)', title, year);
    return null;
  }
}

export default new TmdbProvider();
