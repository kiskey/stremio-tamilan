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
      // R52: Ensured backticks are used for the template literal string.
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

  async #getAndValidateMovieDetails(tmdbId, contextTitle) {
    if (!TMDB_API_KEY || !tmdbId) return null;
    try {
      // R52: Ensured backticks are used for the template literal string.
      const detailedMovie = await axios.get(`${TMDB_API_URL}/movie/${tmdbId}`, {
        params: { api_key: TMDB_API_KEY, append_to_response: 'external_ids' },
        timeout: TIMEOUT
      });
      
      const movieData = detailedMovie.data;

      if (movieData && movieData.external_ids?.imdb_id) {
        return movieData;
      } else {
        log('Match found for "%s" (TMDB ID: %s), but REJECTED due to missing IMDb ID.', contextTitle, tmdbId);
        return null;
      }
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
    
    const resultsByYearIN = await this.#search({ query: sanitizedTitle, year: year, region: 'IN' });
    const resultsByYear = await this.#search({ query: sanitizedTitle, year: year });
    const resultsGlobal = await this.#search({ query: sanitizedTitle });

    const allResults = [...resultsByYearIN, ...resultsByYear, ...resultsGlobal];
    const uniqueResults = [...new Map(allResults.map(item => [item.id, item])).values()];
    
    if (uniqueResults.length === 0) {
        log('No TMDB candidate matches found for: %s (%s)', sanitizedTitle, year);
        return null;
    }

    const lowerCaseTitle = sanitizedTitle.toLowerCase();
    const getYearFromResult = (result) => result.release_date ? new Date(result.release_date).getFullYear() : null;

    const prioritizedCandidates = uniqueResults.sort((a, b) => {
      const aTitleMatch = a.title.toLowerCase() === lowerCaseTitle;
      const bTitleMatch = b.title.toLowerCase() === lowerCaseTitle;
      const aYearMatch = getYearFromResult(a) === year;
      const bYearMatch = getYearFromResult(b) === year;
      const aLangMatch = INDIAN_LANGUAGES.includes(a.original_language);
      const bLangMatch = INDIAN_LANGUAGES.includes(b.original_language);

      const aScore = (aTitleMatch && aYearMatch && aLangMatch ? 8 : 0) +
                     (aTitleMatch && aYearMatch ? 4 : 0) +
                     (aTitleMatch ? 2 : 0) +
                     (a.popularity > 0.5 ? 1 : 0);
                     
      const bScore = (bTitleMatch && bYearMatch && bLangMatch ? 8 : 0) +
                     (bTitleMatch && bYearMatch ? 4 : 0) +
                     (bTitleMatch ? 2 : 0) +
                     (b.popularity > 0.5 ? 1 : 0);

      return bScore - aScore;
    });

    log(`Found ${prioritizedCandidates.length} unique candidates. Validating in order of priority...`);
    for (const candidate of prioritizedCandidates) {
      log(`Attempting validation for candidate: "${candidate.title}" (ID: ${candidate.id})`);
      const validatedMovieDetails = await this.#getAndValidateMovieDetails(candidate.id, sanitizedTitle);
      if (validatedMovieDetails) {
        log(`Validation successful for "${candidate.title}"! Selecting this as the best match.`);
        return validatedMovieDetails;
      }
    }

    log('Exhausted all candidates. No valid TMDB match with an IMDb ID found for: %s (%s)', sanitizedTitle, year);
    return null;
  }

  async getMovieDetailsByImdbId(imdbId) {
    if (!TMDB_API_KEY || !imdbId) return null;
    log('Finding TMDB entry for IMDb ID: %s', imdbId);
    try {
      // R52: Ensured backticks are used for the template literal string.
      const { data } = await axios.get(`${TMDB_API_URL}/find/${imdbId}`, {
        params: { api_key: TMDB_API_KEY, external_source: 'imdb_id' },
        timeout: TIMEOUT
      });
      if (data.movie_results && data.movie_results.length > 0) {
        return this.#getAndValidateMovieDetails(data.movie_results.id, imdbId);
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
