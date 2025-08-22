import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } = from 'url';
import debug from 'debug';
import fs from 'fs';

const log = debug('addon:database');
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}
const dbPath = path.join(dataDir, 'database.sqlite');

class Database {
  // R1: Constructor for singleton pattern
  constructor() {
    if (Database.instance) {
      return Database.instance;
    }
    this.db = null;
    Database.instance = this;
  }

  // R1: Initializes the database connection and creates tables
  async init() {
    if (this.db) {
      return;
    }
    try {
      this.db = await open({
        filename: dbPath,
        driver: sqlite3.Database
      });
      log('Database initialized at %s', dbPath);
      await this.createTables();
    } catch (error) {
      console.error('Database initialization failed:', error);
      throw error;
    }
  }

  // R1: Creates necessary tables if they don't exist
  async createTables() {
    const createMoviesTableQuery = `
      CREATE TABLE IF NOT EXISTS movies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        year INTEGER,
        imdb_id TEXT,
        tmdb_id TEXT,
        genre TEXT,
        rating REAL,
        poster TEXT,
        description TEXT,
        runtime INTEGER,
        language TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(title, year)
      )
    `;
    await this.db.run(createMoviesTableQuery);
    log('Movies table created or already exists');

    const createStreamsTableQuery = `
      CREATE TABLE IF NOT EXISTS streams (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        movie_id INTEGER,
        title TEXT,
        url TEXT,
        quality TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(movie_id) REFERENCES movies(id) ON DELETE CASCADE,
        UNIQUE(movie_id, url)
      )
    `;
    await this.db.run(createStreamsTableQuery);
    log('Streams table created or already exists');

    const createSortIndexQuery = `
      CREATE INDEX IF NOT EXISTS idx_movies_sort ON movies (year DESC, created_at DESC)
    `;
    await this.db.run(createSortIndexQuery);
    log('Sort index for movies table created or already exists.');
  }

  // R10: New method to get a movie's full data by title and year
  async getMovieByTitleAndYear(title, year) {
    const query = 'SELECT id, title, year, imdb_id FROM movies WHERE title = ? AND year = ? LIMIT 1';
    const result = await this.db.get(query, [title, year]);
    if (result) {
      log('Found existing movie in DB by title/year: %s (%s) with ID: %d, IMDb ID: %s', title, year, result.id, result.imdb_id || 'NULL');
    }
    return result;
  }

  // R2, R12: Adds a new movie and stream, or updates existing movie metadata
  async addMovieAndStream(movie) {
    const findMovieQuery = 'SELECT id, imdb_id FROM movies WHERE title = ? AND year = ?';
    let existingMovie = await this.db.get(findMovieQuery, [movie.title, movie.year]);

    let movieId;
    if (existingMovie) {
      movieId = existingMovie.id;
      log('Found existing movie "%s (%s)". ID: %d. Current IMDb ID: %s. Attempting to update metadata.', 
          movie.title, movie.year, movieId, existingMovie.imdb_id || 'NULL');
      
      // R12: Log the proposed metadata update for an existing movie
      log('Updating metadata for movie ID %d: imdb_id=%s, tmdb_id=%s, description=%s, genre=%s, rating=%s, poster=%s',
          movieId, movie.imdb_id || 'NULL', movie.tmdb_id || 'NULL', movie.description?.substring(0, 50) + '...', 
          movie.genre, movie.rating, movie.poster?.substring(0, 50) + '...');

      await this.updateMovieMetadata(movieId, {
          imdb_id: movie.imdb_id,
          tmdb_id: movie.tmdb_id,
          poster: movie.poster,
          description: movie.description,
          genre: movie.genre,
          rating: movie.rating
      });
      // After update, re-fetch to see final state of imdb_id
      const updatedMovie = await this.db.get(findMovieQuery, [movie.title, movie.year]);
      log('Metadata update for "%s (%s)" complete. Final IMDb ID: %s', movie.title, movie.year, updatedMovie.imdb_id || 'NULL');
    } else {
      const insertMovieQuery = `
        INSERT INTO movies (title, year, imdb_id, tmdb_id, genre, rating, poster, description, runtime, language)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `;
      const result = await this.db.run(insertMovieQuery, [
        movie.title, movie.year, movie.imdb_id, movie.tmdb_id, movie.genre,
        movie.rating, movie.poster, movie.description, movie.runtime, movie.language
      ]);
      movieId = result.lastID;
      log('Inserted new movie "%s (%s)". ID: %d, IMDb ID: %s', movie.title, movie.year, movieId, movie.imdb_id || 'NULL');
    }

    if (movieId && movie.video_url) {
      const streamTitle = `Tamilan24 - ${movie.quality || 'HD'}`;
      const insertStreamQuery = `
        INSERT OR IGNORE INTO streams (movie_id, title, url, quality)
        VALUES (?, ?, ?, ?)
      `;
      const streamResult = await this.db.run(insertStreamQuery, [movieId, streamTitle, movie.video_url, movie.quality]);
      if (streamResult.changes > 0) {
        log('Added new stream for movie ID %d: %s (Quality: %s)', movieId, movie.video_url, movie.quality);
      } else {
        log('Stream already exists for movie ID %d: %s', movieId, movie.video_url);
      }
    }
  }
  
  // R2, R12: Updates specific metadata fields for a movie
  async updateMovieMetadata(id, { imdb_id, tmdb_id, genre, rating, description, poster }) {
    // R12: Log values being passed to COALESCE
    log('Executing updateMovieMetadata for ID %d with imdb_id: %s, tmdb_id: %s, genre: %s, rating: %s, description: %s, poster: %s',
        id, imdb_id || 'NULL', tmdb_id || 'NULL', genre || 'NULL', rating || 'NULL', 
        description?.substring(0, 50) + '...' || 'NULL', poster?.substring(0, 50) + '...' || 'NULL');
    const query = `
      UPDATE movies 
      SET 
        imdb_id = COALESCE(?, imdb_id),
        tmdb_id = COALESCE(?, tmdb_id),
        genre = COALESCE(?, genre),
        rating = COALESCE(?, rating),
        description = COALESCE(?, description),
        poster = COALESCE(?, poster)
      WHERE id = ?
    `;
    return this.db.run(query, [imdb_id, tmdb_id, genre, rating, description, poster, id]);
  }

  // R3: Retrieves movies for the catalog
  async getMovies(limit = 100, skip = 0) {
    const query = 'SELECT * FROM movies WHERE imdb_id IS NOT NULL ORDER BY year DESC, created_at DESC LIMIT ? OFFSET ?';
    return this.db.all(query, [limit, skip]);
  }
  
  // R3: Searches movies for the catalog
  async searchMovies(searchTerm, limit = 100, skip = 0) {
    const query = 'SELECT * FROM movies WHERE title LIKE ? AND imdb_id IS NOT NULL ORDER BY year DESC, created_at DESC LIMIT ? OFFSET ?';
    return this.db.all(query, [`%${searchTerm}%`, limit, skip]);
  }

  // R4: Retrieves overall statistics for the admin dashboard
  async getStats() {
    const query = `SELECT COUNT(*) AS total, COUNT(imdb_id) AS linked, (COUNT(*) - COUNT(imdb_id)) as unlinked FROM movies`;
    return this.db.get(query);
  }

  // R4, R7: Retrieves unlinked movies for the admin dashboard
  async getUnlinkedMovies(limit = 50, skip = 0) {
    const query = 'SELECT id, title, year, created_at FROM movies WHERE imdb_id IS NULL ORDER BY created_at DESC LIMIT ? OFFSET ?';
    return this.db.all(query, [limit, skip]);
  }

  // R4: Retrieves specific unlinked movies by IDs
  async getUnlinkedMoviesByIds(ids) {
    const placeholders = ids.map(() => '?').join(',');
    const query = `SELECT id, title, year FROM movies WHERE id IN (${placeholders}) AND imdb_id IS NULL`;
    return this.db.all(query, ids);
  }

  // R3: Retrieves a single movie by its internal ID
  async getMovieById(id) {
    const query = 'SELECT * FROM movies WHERE id = ?';
    return this.db.get(query, [id]);
  }

  // R3: Retrieves a single movie by its IMDb ID
  async getMovieByImdbId(imdbId) {
    const query = 'SELECT * FROM movies WHERE imdb_id = ?';
    return this.db.get(query, [imdbId]);
  }

  // R3: Retrieves streams for a given movie ID
  async getStreamsForMovieId(movieId) {
    const query = 'SELECT * FROM streams WHERE movie_id = ?';
    return this.db.all(query, [movieId]);
  }
  
  // R1: Closes the database connection
  async close() {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }
}

const databaseInstance = new Database();
export default databaseInstance;
