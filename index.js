// R4: Correctly import from the CommonJS 'stremio-addon-sdk' module.
import sdk from 'stremio-addon-sdk';
const { addonBuilder, getRouter } = sdk;

import express from 'express';
import debug from 'debug';
// R2: Import the singleton database instance.
import db from './database.js';
import ScraperScheduler from './scheduler.js';

const log = debug('addon:server');

const manifest = {
  id: 'org.tamilan24.addon',
  version: '1.0.0',
  name: 'Tamilan24 Movies',
  description: 'Tamil movies from Tamilan24',
  logo: 'https://tamilan24.com/themes/tamilan24/assets/images/logo.png',
  background: 'https://tamilan24.com/themes/tamilan24/assets/images/logo.png',
  resources: ['catalog', 'meta', 'stream'],
  types: ['movie'],
  catalogs: [
    {
      type: 'movie',
      id: 'tamilan24-latest',
      name: 'Tamilan24 Latest Movies',
      extra: [
        { name: 'skip', isRequired: false },
        { name: 'search', isRequired: false }
      ]
    }
  ]
};

const builder = new addonBuilder(manifest);

// R2: Handlers now use the shared 'db' instance, without creating/closing connections.
builder.defineCatalogHandler(async (args) => {
  log('Catalog request: %O', args);
  try {
    const limit = 100;
    const skip = parseInt(args.extra.skip) || 0;
    
    let movies;
    if (args.extra.search) {
      log('Searching movies with term: "%s"', args.extra.search);
      movies = await db.searchMovies(args.extra.search, limit, skip);
    } else {
      log('Fetching latest movies (skip: %d, limit: %d)', skip, limit);
      movies = await db.getMovies(limit, skip);
    }
    
    const metas = movies.map(movie => ({
      id: movie.imdb_id || `t24:${movie.id}`, // Use a prefix to avoid ID collisions
      type: 'movie',
      name: movie.title,
      poster: movie.poster,
      background: movie.poster,
      description: movie.description,
      releaseInfo: movie.year ? movie.year.toString() : '',
      imdbRating: movie.rating ? parseFloat(movie.rating).toFixed(1) : null,
      genres: movie.genre ? movie.genre.split(',').map(g => g.trim()) : []
    }));
    
    log('Responding with %d metas for catalog request', metas.length);
    return Promise.resolve({ metas });
  } catch (error) {
    console.error('Catalog error:', error);
    log('Error in catalog handler: %O', error);
    return Promise.resolve({ metas: [] });
  }
});

builder.defineMetaHandler(async (args) => {
  log('Meta request: %O', args);
  try {
    // R2: Use a prefix for internal IDs to distinguish them from imdb_id
    const id = args.id.startsWith('t24:') ? args.id.replace('t24:', '') : args.id;
    let movie;
    
    if (args.id.startsWith('tt')) {
      movie = await db.getMovieByImdbId(id);
    } else {
      movie = await db.getMovieById(id);
    }
    
    if (!movie) {
      log('Meta not found for ID: %s', args.id);
      return Promise.resolve({ meta: null });
    }
    
    const meta = {
      id: movie.imdb_id || `t24:${movie.id}`,
      type: 'movie',
      name: movie.title,
      poster: movie.poster,
      background: movie.poster,
      description: movie.description,
      releaseInfo: movie.year ? movie.year.toString() : '',
      imdbRating: movie.rating ? parseFloat(movie.rating).toFixed(1) : null,
      genres: movie.genre ? movie.genre.split(',').map(g => g.trim()) : [],
      runtime: movie.runtime ? `${movie.runtime} min` : null,
      language: movie.language || 'Tamil'
    };
    
    log('Responding with meta for ID: %s', args.id);
    return Promise.resolve({ meta });
  } catch (error) {
    console.error('Meta error:', error);
    log('Error in meta handler: %O', error);
    return Promise.resolve({ meta: null });
  }
});

builder.defineStreamHandler(async (args) => {
  log('Stream request: %O', args);
  try {
    const id = args.id.startsWith('t24:') ? args.id.replace('t24:', '') : args.id;
    let movie;

    if (args.id.startsWith('tt')) {
      log('Fetching stream by IMDb ID: %s', id);
      movie = await db.getMovieByImdbId(id);
    } else {
      log('Fetching stream by internal ID: %s', id);
      movie = await db.getMovieById(id);
    }
    
    if (!movie || !movie.video_url) {
      log('No stream found for ID: %s', args.id);
      return Promise.resolve({ streams: [] });
    }
    
    const streams = [{
      title: `Tamilan24 - ${movie.quality || 'HD'}`,
      url: movie.video_url,
      behaviorHints: {
        bingeGroup: `tamilan24-${movie.id}`
      }
    }];
    
    log('Responding with %d streams for ID: %s', streams.length, args.id);
    return Promise.resolve({ streams });
  } catch (error) {
    console.error('Stream error:', error);
    log('Error in stream handler: %O', error);
    return Promise.resolve({ streams: [] });
  }
});

const app = express();
const addonInterface = builder.getInterface();
app.use('/', getRouter(addonInterface));

app.get('/health', (req, res) => {
  log('Health check request');
  res.status(200).json({ status: 'ok' });
});

const port = process.env.PORT || 7000;
const scheduler = new ScraperScheduler();

// R2: Initialize the database once before starting the server.
db.init().then(() => {
  app.listen(port, '0.0.0.0', () => {
    console.log(`Addon running on http://0.0.0.0:${port}`);
    log(`Addon server started on port ${port}`);
    // Start the scheduler after the DB is ready and the server is listening.
    scheduler.start();
  });
}).catch(err => {
  console.error('Failed to initialize application dependencies:', err);
  process.exit(1);
});
