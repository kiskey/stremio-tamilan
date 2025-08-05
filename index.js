const { addonBuilder, getRouter } = require('stremio-addon-sdk');
const express = require('express');
const Database = require('./database');
const debug = require('debug')('addon:server');

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

builder.defineCatalogHandler(async (args) => {
  debug('Catalog request: %O', args);
  const db = new Database();
  await db.init();
  
  try {
    const limit = 100;
    const skip = parseInt(args.extra.skip) || 0;
    
    let movies;
    if (args.extra.search) {
      debug('Searching movies with term: "%s"', args.extra.search);
      movies = await db.searchMovies(args.extra.search, limit, skip);
    } else {
      debug('Fetching latest movies (skip: %d, limit: %d)', skip, limit);
      movies = await db.getMovies(limit, skip);
    }
    
    const metas = movies.map(movie => ({
      id: movie.imdb_id || movie.tmdb_id || movie.id.toString(),
      type: 'movie',
      name: movie.title,
      poster: movie.poster,
      background: movie.poster,
      description: movie.description,
      releaseInfo: movie.year.toString(),
      imdbRating: movie.rating ? parseFloat(movie.rating).toFixed(1) : null,
      genre: movie.genre ? movie.genre.split(',') : []
    }));
    
    debug('Responding with %d metas for catalog request', metas.length);
    return Promise.resolve({ metas });
  } catch (error) {
    console.error('Catalog error:', error);
    debug('Error in catalog handler: %O', error);
    return Promise.resolve({ metas: [] });
  } finally {
    await db.close();
  }
});

builder.defineMetaHandler(async (args) => {
  debug('Meta request: %O', args);
  const db = new Database();
  await db.init();
  
  try {
    const movie = await db.getMovieById(args.id);
    
    if (!movie) {
      debug('Meta not found for ID: %s', args.id);
      return Promise.resolve({ meta: {} });
    }
    
    const meta = {
      id: movie.imdb_id || movie.tmdb_id || movie.id.toString(),
      type: 'movie',
      name: movie.title,
      poster: movie.poster,
      background: movie.poster,
      description: movie.description,
      releaseInfo: movie.year.toString(),
      imdbRating: movie.rating ? parseFloat(movie.rating).toFixed(1) : null,
      genre: movie.genre ? movie.genre.split(',') : [],
      runtime: movie.runtime ? `${movie.runtime} min` : null,
      language: movie.language || 'Tamil'
    };
    
    debug('Responding with meta for ID: %s', args.id);
    return Promise.resolve({ meta });
  } catch (error) {
    console.error('Meta error:', error);
    debug('Error in meta handler: %O', error);
    return Promise.resolve({ meta: {} });
  } finally {
    await db.close();
  }
});

builder.defineStreamHandler(async (args) => {
  debug('Stream request: %O', args);
  const db = new Database();
  await db.init();
  
  try {
    // Handle both direct movie IDs and tt IDs
    let movie;
    if (args.id.startsWith('tt')) {
      debug('Fetching stream by IMDb ID: %s', args.id);
      movie = await db.getMovieByImdbId(args.id);
    } else {
      debug('Fetching stream by internal ID: %s', args.id);
      movie = await db.getMovieById(args.id);
    }
    
    if (!movie || !movie.video_url) {
      debug('No stream found for ID: %s', args.id);
      return Promise.resolve({ streams: [] });
    }
    
    const streams = [{
      title: `Tamilan24 - ${movie.quality || 'HD'}`,
      url: movie.video_url,
      behaviorHints: {
        bingeGroup: `tamilan24-${movie.id}`
      }
    }];
    
    debug('Responding with %d streams for ID: %s', streams.length, args.id);
    return Promise.resolve({ streams });
  } catch (error) {
    console.error('Stream error:', error);
    debug('Error in stream handler: %O', error);
    return Promise.resolve({ streams: [] });
  } finally {
    await db.close();
  }
});

const app = express();
const addonInterface = builder.getInterface();
app.use('/', getRouter(addonInterface));

// Health check endpoint
app.get('/health', (req, res) => {
  debug('Health check request');
  res.status(200).json({ status: 'ok' });
});

// Start the addon server
const port = process.env.PORT || 7000;

app.listen(port, '0.0.0.0', () => {
  console.log(`Addon running on http://0.0.0.0:${port}`);
  debug(`Addon server started on port ${port}`);
});

// Publish to Stremio Central (optional)
// publishToCentral('https://your-addon-url.com/manifest.json');
