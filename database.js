import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import debug from 'debug';
import fs from 'fs';

const log = debug('addon:database');
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) {
  log('Creating data directory at %s', dataDir);
  fs.mkdirSync(dataDir, { recursive: true });
}
const dbPath = path.join(dataDir, 'database.sqlite');

class Database {
  constructor() {
    if (Database.instance) {
      return Database.instance;
    }
    this.db = null;
    Database.instance = this;
  }

  async init() {
    if (this.db) {
      log('Database already initialized.');
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
      log('Database initialization failed: %O', error);
      throw error;
    }
  }

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

  async movieExists(title, year) {
    const query = 'SELECT 1 FROM movies WHERE title = ? AND year = ? LIMIT 1';
    const result = await this.db.get(query, [title, year]);
    return !!result;
  }

  async addMovieAndStream(movie) {
    const findMovieQuery = 'SELECT id FROM movies WHERE title = ? AND year = ?';
    let existingMovie = await this.db.get(findMovieQuery, [movie.title, movie.year]);

    let movieId;
    if (existingMovie) {
      movieId = existingMovie.id;
      const updateMovieQuery = `
        UPDATE movies 
        SET poster = ?, description = ?, genre = ?, rating = ?, imdb_id = ?, tmdb_id = ?
        WHERE id = ?
      `;
      await this.db.run(updateMovieQuery, [
        movie.poster, movie.description, movie.genre, movie.rating, movie.imdb_id, movie.tmdb_id, movieId
      ]);
      log('Found existing movie "%s (%s)". ID: %d. Updating metadata.', movie.title, movie.year, movieId);
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
      log('Inserted new movie "%s (%s)". ID: %d', movie.title, movie.year, movieId);
    }

    if (movieId && movie.video_url) {
      const streamTitle = `Tamilan24 - ${movie.quality || 'HD'}`;
      const insertStreamQuery = `
        INSERT OR IGNORE INTO streams (movie_id, title, url, quality)
        VALUES (?, ?, ?, ?)
      `;
      const streamResult = await this.db.run(insertStreamQuery, [movieId, streamTitle, movie.video_url, movie.quality]);
      if (streamResult.changes > 0) {
        log('Added new stream for movie ID %d: %s', movieId, movie.video_url);
      }
    }
  }

  async getMovies(limit = 100, skip = 0) {
    // R32: Filter directly in the query for efficiency.
    const query = 'SELECT * FROM movies WHERE imdb_id IS NOT NULL ORDER BY year DESC, created_at DESC LIMIT ? OFFSET ?';
    const movies = await this.db.all(query, [limit, skip]);
    log('Retrieved %d linked movies from DB (limit: %d, skip: %d)', movies.length, limit, skip);
    return movies;
  }

  async searchMovies(searchTerm, limit = 100, skip = 0) {
    // R32: Also apply the filter to search results.
    const query = 'SELECT * FROM movies WHERE title LIKE ? AND imdb_id IS NOT NULL ORDER BY year DESC, created_at DESC LIMIT ? OFFSET ?';
    const movies = await this.db.all(query, [`%${searchTerm}%`, limit, skip]);
    log('Found %d linked movies for search term "%s"', movies.length, searchTerm);
    return movies;
  }

  // R34 & R35: New functions for the admin dashboard
  async getStats() {
    const query = `
      SELECT
        COUNT(*) AS total,
        COUNT(CASE WHEN imdb_id IS NOT NULL THEN 1 END) AS linked,
        COUNT(CASE WHEN imdb_id IS NULL THEN 1 END) AS unlinked
      FROM movies
    `;
    return this.db.get(query);
  }

  async getUnlinkedMovies() {
    const query = 'SELECT id, title, year, created_at FROM movies WHERE imdb_id IS NULL ORDER BY created_at DESC';
    return this.db.all(query);
  }

  async getMovieById(id) {
    const query = 'SELECT * FROM movies WHERE id = ?';
    return this.db.get(query, [id]);
  }

  async getMovieByImdbId(imdbId) {
    const query = 'SELECT * FROM movies WHERE imdb_id = ?';
    return this.db.get(query, [imdbId]);
  }

  async getStreamsForMovieId(movieId) {
    const query = 'SELECT * FROM streams WHERE movie_id = ?';
    return this.db.all(query, [movieId]);
  }

  async close() {
    if (this.db) {
      await this.db.close();
      this.db = null;
      log('Database connection closed');
    }
  }
}

const databaseInstance = new Database();
export default databaseInstance;
