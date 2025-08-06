import sdk from 'stremio-addon-sdk';
const { addonBuilder, getRouter } = sdk;
import express from 'express';
import debug from 'debug';
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
  // Reverting to the previous state for accurate diagnosis
  resources: ['catalog', 'stream'],
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
  log('Catalog request: %O', args);
  try {
    const limit = 100;
    const skip = parseInt(args.extra.skip) || 0;
    
    let movies;
    if (args.extra.search) {
      movies = await db.searchMovies(args.extra.search, limit, skip);
    } else {
      movies = await db.getMovies(limit, skip);
    }
    
    // R34: ADDED DIAGNOSTIC LOGGING
    // This will tell us exactly what's happening before the filter.
    if (movies && movies.length > 0) {
      const moviesWithImdbIdCount = movies.filter(m => m.imdb_id).length;
      log(`DIAGNOSTIC: Retrieved ${movies.length} movies from DB. Found ${moviesWithImdbIdCount} with an imdb_id.`);
      // Optional: Log the first few raw movie objects to see their state
      log('DIAGNOSTIC: First 3 movie objects from DB:', JSON.stringify(movies.slice(0, 3), null, 2));
    } else {
      log('DIAGNOSTIC: No movies were returned from the database query.');
    }
    
    // This is the original, problematic code we are diagnosing.
    const metas = movies
      .filter(movie => movie.imdb_id)
      .map(movie => ({
        id: movie.imdb_id,
        type: 'movie',
        name: movie.title,
        poster: movie.poster,
        description: movie.description,
        releaseInfo: movie.year ? movie.year.toString() : '',
        imdbRating: movie.rating ? movie.rating.toString() : null,
        genres: movie.genre ? movie.genre.split(',').map(g => g.trim()) : []
    }));
    
    return Promise.resolve({ metas });
  } catch (error) {
    console.error('Catalog error:', error);
    return Promise.resolve({ metas: [] });
  }
});


builder.defineStreamHandler(async (args) => {
  log('Stream request: %O', args);
  try {
    const imdbId = args.id;
    let movie;

    if (imdbId.startsWith('tt')) {
      movie = await db.getMovieByImdbId(imdbId);
    } else {
      const id = args.id.startsWith('t24:') ? args.id.replace('t24:', '') : args.id;
      movie = await db.getMovieById(id);
    }
    
    if (!movie) {
      log('No movie found for stream request ID: %s', args.id);
      return Promise.resolve({ streams: [] });
    }
    
    const streamsFromDb = await db.getStreamsForMovieId(movie.id);
    
    if (!streamsFromDb || !streamsFromDb.length) {
      return Promise.resolve({ streams: [] });
    }
    
    const streams = streamsFromDb.map(stream => ({
      title: stream.title,
      url: stream.url,
      behaviorHints: {
        bingeGroup: `tamilan24-${movie.id}-${stream.quality}`
      }
    }));
    
    log('Responding with %d streams for ID: %s', streams.length, args.id);
    return Promise.resolve({ streams });
  } catch (error) {
    console.error('Stream error:', error);
    return Promise.resolve({ streams: [] });
  }
});

const app = express();
const addonInterface = builder.getInterface();
app.use('/', getRouter(addonInterface));

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

const port = process.env.PORT || 7000;
const scheduler = new ScraperScheduler();

db.init().then(() => {
  app.listen(port, '0.0.0.0', () => {
    console.log(`Addon running on http://0.0.0.0:${port}`);
    log(`Addon server started on port ${port}`);
    scheduler.start();
  });
}).catch(err => {
  console.error('Failed to initialize application dependencies:', err);
  process.exit(1);
});
