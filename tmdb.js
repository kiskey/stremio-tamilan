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

  // R9, R14: Ensures that imdb_id is truly null if not found or empty
  async #getAndValidateMovieDetails(tmdbId, contextTitle) {
    if (!TMDB_API_KEY || !tmdbId) {
      log('TMDB API Key or TMDB ID missing for validation. Returning null.');
      return null;
    }
    try {
      const detailedMovie = await axios.get(`${TMDB_API_URL}/movie/${tmdbId}`, {
        params: { api_key: TMDB_API_KEY, append_to_response: 'external_ids' },
        timeout: TIMEOUT
      });
      
      const movieData = detailedMovie.data;

      if (movieData && movieData.external_ids?.imdb_id) {
        // R9, R14: Explicitly check for empty string and treat as null
        const imdbIdValue = movieData.external_ids.imdb_id;
        if (typeof imdbIdValue === 'string' && imdbIdValue.trim() === '') {
          log('Match found for "%s" (TMDB ID: %s), but REJECTED due to empty IMDb ID string.', contextTitle, tmdbId);
          return null; // Treat empty string as no IMDb ID
        }
        return movieData;
      } else {
        log('Match found for "%s" (TMDB ID: %s), but REJECTED due to missing or invalid IMDb ID.', contextTitle, tmdbId);
        return null;
      }
    } catch (error) {
      log('Error getting TMDB movie details for id %s. Message: %s', tmdbId, error.message);
      if (error.response) { log('TMDB API Error Response: %o', error.response.data); }
      return null;
    }
  }

  // R6, R8: Searches TMDB for a movie using a multi-tiered priority system
  async searchMovie(title, year) {
    if (!TMDB_API_KEY) {
      log('TMDB_API_KEY is not set. Skipping TMDB search for "%s" (%s).', title, year);
      return null;
    }
    
    const sanitizedTitle = this.#sanitizeTitle(title);
    log('Searching TMDB for sanitized title: "%s" (original: "%s"), year: %s', sanitizedTitle, title, year || 'N/A');
    
    // R6: Fetch results from various search permutations
    const resultsByYearIN = await this.#search({ query: sanitizedTitle, year: year, region: 'IN' });
    const resultsIN = await this.#search({ query: sanitizedTitle, region: 'IN' }); // For the new tier
    const resultsByYear = await this.#search({ query: sanitizedTitle, year: year });
    const resultsGlobal = await this.#search({ query: sanitizedTitle });

    const allResults = [...resultsByYearIN, ...resultsIN, ...resultsByYear, ...resultsGlobal];
    const uniqueResults = [...new Map(allResults.map(item => [item.id, item])).values()];
    
    if (uniqueResults.length === 0) {
        log('No TMDB candidate matches found for: %s (%s)', sanitizedTitle, year);
        return null;
    }

    const lowerCaseTitle = sanitizedTitle.toLowerCase();
    const getYearFromResult = (result) => result.release_date ? new Date(result.release_date).getFullYear() : null;

    // R8: Update scoring logic to include the new Tier 3.
    const prioritizedCandidates = uniqueResults.sort((a, b) => {
      const aTitleMatch = a.title.toLowerCase() === lowerCaseTitle;
      const bTitleMatch = b.title.toLowerCase() === lowerCaseTitle;
      const aYearMatch = getYearFromResult(a) === year;
      const bYearMatch = getYearFromResult(b) === year;
      const aLangMatch = INDIAN_LANGUAGES.includes(a.original_language);
      const bLangMatch = INDIAN_LANGUAGES.includes(b.original_language);

      // Give a score to each result based on our 5-tier priority. Higher is better.
      const aScore = (aTitleMatch && aYearMatch && aLangMatch ? 16 : 0) + // Tier 1: Title, Year, Indian Language
                     (aTitleMatch && aYearMatch ? 8 : 0) +                // Tier 2: Title, Year
                     (aTitleMatch && aLangMatch ? 4 : 0) +                // Tier 3 (New): Title, Indian Language
                     (aTitleMatch ? 2 : 0) +                              // Tier 4: Title match only
                     (a.popularity > 0.5 ? 1 : 0);                        // Popularity bonus
                     
      const bScore = (bTitleMatch && bYearMatch && bLangMatch ? 16 : 0) +
                     (bTitleMatch && bYearMatch ? 8 : 0) +
                     (bTitleMatch && bLangMatch ? 4 : 0) +
                     (bTitleMatch ? 2 : 0) +
                     (b.popularity > 0.5 ? 1 : 0);

      return bScore - aScore; // Sort descending by score
    });

    log(`Found ${prioritizedCandidates.length} unique candidates for "%s". Validating in order of priority...`, sanitizedTitle);
    for (const candidate of prioritizedCandidates) {
      log(`Attempting validation for candidate: "${candidate.title}" (ID: ${candidate.id}, Score: ${prioritizedCandidates.indexOf(candidate)})`);
      const validatedMovieDetails = await this.#getAndValidateMovieDetails(candidate.id, sanitizedTitle);
      if (validatedMovieDetails) {
        log(`Validation successful for "${candidate.title}"! Selecting this as the best match. IMDb ID: ${validatedMovieDetails.external_ids.imdb_id}`);
        return validatedMovieDetails;
      }
    }

    log('Exhausted all candidates. No valid TMDB match with an IMDb ID found for: %s (%s)', sanitizedTitle, year);
    return null;
  }

  // R6: Finds movie details by IMDb ID
  async getMovieDetailsByImdbId(imdbId) {
    if (!TMDB_API_KEY || !imdbId) {
      log('TMDB API Key or IMDb ID missing for lookup. Returning null.');
      return null;
    }
    log('Finding TMDB entry for IMDb ID: %s', imdbId);
    try {
      const { data } = await axios.get(`${TMDB_API_URL}/find/${imdbId}`, {
        params: { api_key: TMDB_API_KEY, external_source: 'imdb_id' },
        timeout: TIMEOUT
      });
      if (data.movie_results && data.movie_results.length > 0) {
        log('Found TMDB results for IMDb ID %s. TMDB ID: %s', imdbId, data.movie_results[0].id);
        return this.#getAndValidateMovieDetails(data.movie_results[0].id, imdbId);
      }
      log('No TMDB results found for IMDb ID: %s', imdbId);
      return null;
    } catch (error) {
      log('Error finding by IMDb ID %s. Message: %s', imdbId, error.message);
      if (error.response) { log('TMDB API Error Response: %o', error.response.data); }
      return null;
    }
  }
}

export default new TmdbProvider();
