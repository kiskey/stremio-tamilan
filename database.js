const sqlite = require('sqlite-async');
const debug = require('debug')('addon:database');

class Database {
  constructor() {
    this.db = null;
  }

  async init() {
    try {
      this.db = await sqlite.open(':memory:');
      debug('Database initialized in-memory');
      await this.createTables();
    } catch (error) {
      console.error('Database initialization failed:', error);
      debug('Database initialization failed: %O', error);
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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;
    await this.db.run(createTableQuery);
    debug('Movies table created or already exists');
  }

  async addMovie(movie) {
    const insertQuery = `
      INSERT INTO movies (title, year, imdb_id, tmdb_id, genre, rating, poster, description, video_url, quality, runtime, language)
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
    await this.db.run(insertQuery, params);
    debug('Added movie: %s', movie.title);
  }

  async getMovies(limit = 100, skip = 0) {
    const query = 'SELECT * FROM movies ORDER BY created_at DESC LIMIT ? OFFSET ?';
    const movies = await this.db.all(query, [limit, skip]);
    debug('Retrieved %d movies (limit: %d, skip: %d)', movies.length, limit, skip);
    return movies;
  }

  async searchMovies(searchTerm, limit = 100, skip = 0) {
    const query = 'SELECT * FROM movies WHERE title LIKE ? ORDER BY created_at DESC LIMIT ? OFFSET ?';
    const movies = await this.db.all(query, [`%${searchTerm}%`, limit, skip]);
    debug('Found %d movies for search term "%s"', movies.length, searchTerm);
    return movies;
  }

  async getMovieById(id) {
    const query = 'SELECT * FROM movies WHERE id = ?';
    const movie = await this.db.get(query, [id]);
    debug('Retrieved movie by ID %s: %O', id, movie);
    return movie;
  }

  async getMovieByImdbId(imdbId) {
    const query = 'SELECT * FROM movies WHERE imdb_id = ?';
    const movie = await this.db.get(query, [imdbId]);
    debug('Retrieved movie by IMDb ID %s: %O', imdbId, movie);
    return movie;
  }

  async close() {
    if (this.db) {
      await this.db.close();
      debug('Database connection closed');
    }
  }
}

module.exports = Database;
