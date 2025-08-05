const sqlite3 = require('sqlite3').verbose();
const path = require('path');

class Database {
  constructor() {
    this.dbPath = process.env.DB_PATH || path.join(__dirname, 'tamilan24.db');
    this.db = null;
  }

  async init() {
    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          reject(err);
        } else {
          this.createTables()
            .then(resolve)
            .catch(reject);
        }
      });
    });
  }

  async createTables() {
    const createMoviesTable = `
      CREATE TABLE IF NOT EXISTS movies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        year INTEGER,
        poster TEXT,
        description TEXT,
        rating REAL,
        genre TEXT,
        runtime INTEGER,
        language TEXT,
        navigation_url TEXT UNIQUE,
        video_url TEXT,
        quality TEXT,
        imdb_id TEXT,
        tmdb_id TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;

    const createIndexes = [
      'CREATE INDEX IF NOT EXISTS idx_title ON movies(title)',
      'CREATE INDEX IF NOT EXISTS idx_year ON movies(year)',
      'CREATE INDEX IF NOT EXISTS idx_imdb_id ON movies(imdb_id)',
      'CREATE INDEX IF NOT EXISTS idx_tmdb_id ON movies(tmdb_id)'
    ];

    return new Promise((resolve, reject) => {
      this.db.run(createMoviesTable, (err) => {
        if (err) {
          reject(err);
        } else {
          // Create indexes
          let completed = 0;
          const total = createIndexes.length;
          
          createIndexes.forEach(indexSql => {
            this.db.run(indexSql, (err) => {
              if (err) {
                reject(err);
              } else {
                completed++;
                if (completed === total) {
                  resolve();
                }
              }
            });
          });
        }
      });
    });
  }

  async insertMovie(movie) {
    const sql = `
      INSERT OR REPLACE INTO movies 
      (title, year, poster, description, rating, genre, runtime, language, 
       navigation_url, video_url, quality, imdb_id, tmdb_id, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `;

    return new Promise((resolve, reject) => {
      this.db.run(sql, [
        movie.title,
        movie.year,
        movie.poster,
        movie.description,
        movie.rating,
        movie.genre,
        movie.runtime,
        movie.language,
        movie.navigation_url,
        movie.video_url,
        movie.quality,
        movie.imdb_id,
        movie.tmdb_id
      ], function(err) {
        if (err) {
          reject(err);
        } else {
          resolve(this.lastID);
        }
      });
    });
  }

  async getMovies(limit = 100, offset = 0) {
    const sql = `
      SELECT * FROM movies 
      WHERE video_url IS NOT NULL 
      ORDER BY created_at DESC 
      LIMIT ? OFFSET ?
    `;

    return new Promise((resolve, reject) => {
      this.db.all(sql, [limit, offset], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  async searchMovies(query, limit = 100, offset = 0) {
    const sql = `
      SELECT * FROM movies 
      WHERE title LIKE ? AND video_url IS NOT NULL 
      ORDER BY created_at DESC 
      LIMIT ? OFFSET ?
    `;

    return new Promise((resolve, reject) => {
      this.db.all(sql, [`%${query}%`, limit, offset], (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  async getMovieById(id) {
    const sql = `SELECT * FROM movies WHERE id = ?`;

    return new Promise((resolve, reject) => {
      this.db.get(sql, [id], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  async getMovieByImdbId(imdbId) {
    const sql = `SELECT * FROM movies WHERE imdb_id = ?`;

    return new Promise((resolve, reject) => {
      this.db.get(sql, [imdbId], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  async getMovieByNavigationUrl(url) {
    const sql = `SELECT * FROM movies WHERE navigation_url = ?`;

    return new Promise((resolve, reject) => {
      this.db.get(sql, [url], (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  async clearMovies() {
    const sql = `DELETE FROM movies`;

    return new Promise((resolve, reject) => {
      this.db.run(sql, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async close() {
    return new Promise((resolve, reject) => {
      if (this.db) {
        this.db.close((err) => {
          if (err) {
            reject(err);
          } else {
            resolve();
          }
        });
      } else {
        resolve();
      }
    });
  }
}

module.exports = Database;
