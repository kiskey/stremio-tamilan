import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import { fileURLToPath } from 'url';
import debug from 'debug';

const log = debug('addon:database');
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, 'database.sqlite');

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
    const createTableQuery = `
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
        video_url TEXT,
        quality TEXT,
        runtime INTEGER,
        language TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        -- R12: Add a unique constraint on title and year to prevent exact duplicates.
        -- If a new scrape finds the same title and year, we'll replace the record.
        -- Note: This is a simple approach for preventing duplicate movie entries.
        -- True stream aggregation (multiple streams per movie) would require a separate 'streams' table.
        UNIQUE(title, year)
      )
    `;
    await this.db.run(createTableQuery);
    log('Movies table created or already exists');
  }

  async addMovie(movie) {
    // R12: Using INSERT OR REPLACE. If a movie with the same title and year exists,
    // this will replace the existing row with the new data. This ensures that
    // we don't have duplicate movie entries for the same title/year.
    // However, it doesn't aggregate multiple video_urls or other details if they
    // change across scrapes for the same movie, unless those fields are part of the unique constraint and update.
    // For true stream aggregation, a separate 'streams' table linked to 'movies' is needed.
    const insertQuery = `
      INSERT OR REPLACE INTO movies (title, year, imdb_id, tmdb_id, genre, rating, poster, description, video_url, quality, runtime, language)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
      movie.title,
      movie.year,
      movie.imdb_id,
      movie.tmdb_id,
      movie.genre,
      movie.rating,
      movie.poster,
      movie.description,
      movie.video_url,
      movie.quality,
      movie.runtime,
      movie.language
    ];
    try {
      const result = await this.db.run(insertQuery, params);
      // The 'changes' property indicates if a row was inserted or replaced.
      if (result.changes > 0) {
        if (movie.title) {
           // Check if it was an insert or replace. This is a heuristic.
           // A more robust way would involve checking existence before insert/replace.
           // For simplicity, we log it as added, but know it could be an update.
           log('Added/Replaced movie: %s (Year: %s)', movie.title, movie.year);
        }
      } else {
        log('Movie %s (Year: %s) already exists and no changes were made.', movie.title, movie.year);
      }
    } catch (error) {
      log('Failed to add/replace movie %s (Year: %s): %O', movie.title, movie.year, error);
    }
  }

  async getMovies(limit = 100, skip = 0) {
    const query = 'SELECT * FROM movies ORDER BY created_at DESC LIMIT ? OFFSET ?';
    const movies = await this.db.all(query, [limit, skip]);
    log('Retrieved %d movies (limit: %d, skip: %d)', movies.length, limit, skip);
    return movies;
  }

  async searchMovies(searchTerm, limit = 100, skip = 0) {
    const query = 'SELECT * FROM movies WHERE title LIKE ? ORDER BY created_at DESC LIMIT ? OFFSET ?';
    const movies = await this.db.all(query, [`%${searchTerm}%`, limit, skip]);
    log('Found %d movies for search term "%s"', movies.length, searchTerm);
    return movies;
  }

  async getMovieById(id) {
    const query = 'SELECT * FROM movies WHERE id = ?';
    const movie = await this.db.get(query, [id]);
    log('Retrieved movie by ID %s: %O', id, movie);
    return movie;
  }

  async getMovieByImdbId(imdbId) {
    const query = 'SELECT * FROM movies WHERE imdb_id = ?';
    const movie = await this.db.get(query, [imdbId]);
    log('Retrieved movie by IMDb ID %s: %O', imdbId, movie);
    return movie;
  }

  async close() {
    if (this.db) {
      await this.db.close();
      this.db = null; // Ensure re-initialization is possible if needed
      log('Database connection closed');
    }
  }
}

const databaseInstance = new Database();
export default databaseInstance;
