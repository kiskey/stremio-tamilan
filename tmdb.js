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
const { data } = await axios.get(${TMDB_API_URL}/search/movie, {
params: { api_key: TMDB_API_KEY, ...params }
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
const { data } = await axios.get(${TMDB_API_URL}/movie/${tmdbId}, {
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
async searchMovie(title, year) {
if (!TMDB_API_KEY) return null;
log('Searching TMDB for: %s (%s)', title, year);
code
Code
let result = await this.#search({ query: title, year: year, region: 'IN' });
if (result) return this.#getMovieDetails(result.id);

result = await this.#search({ query: title, region: 'IN' });
if (result) return this.#getMovieDetails(result.id);

result = await this.#search({ query: title, year: year });
if (result) return this.#getMovieDetails(result.id);

result = await this.#search({ query: title });
if (result) return this.#getMovieDetails(result.id);

log('No TMDB match found for: %s (%s)', title, year);
return null;
}
// R38: New function for manual linking
async getMovieDetailsByImdbId(imdbId) {
if (!TMDB_API_KEY || !imdbId) return null;
log('Finding TMDB entry for IMDb ID: %s', imdbId);
try {
const { data } = await axios.get(${TMDB_API_URL}/find/${imdbId}, {
params: {
api_key: TMDB_API_KEY,
external_source: 'imdb_id'
}
});
if (data.movie_results && data.movie_results.length > 0) {
return this.#getMovieDetails(data.movie_results[0].id);
}
return null;
} catch (error) {
log('Error finding by IMDb ID %s: %O', imdbId, error.message);
return null;
}
}
}
export default new TmdbProvider();
