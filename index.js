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
  // Back to the lean version, as we don't need a meta handler for the main catalog.
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
      // R32: This function now correctly filters for linked movies at the DB level.
      movies = await db.getMovies(limit, skip);
    }
    
    // The movies array now only contains items with an imdb_id.
    const metas = movies.map(movie => ({
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
    
    if (!streamsFromDb || streamsFromDb.length === 0) {
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

// R33, R34, R35: Add the new admin dashboard route
app.get('/admin', async (req, res) => {
  log('Admin dashboard request');
  try {
    const stats = await db.getStats();
    const unlinkedMovies = await db.getUnlinkedMovies();

    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Addon Admin Dashboard</title>
        <style>
          body { font-family: Arial, sans-serif; background: #f4f4f4; color: #333; padding: 20px; }
          .container { max-width: 800px; margin: auto; background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 0 10px rgba(0,0,0,0.1); }
          h1, h2 { color: #555; }
          .stats { display: flex; justify-content: space-around; text-align: center; margin-bottom: 30px; }
          .stat { padding: 20px; background: #eee; border-radius: 8px; width: 30%; }
          .stat h3 { margin: 0; font-size: 2.5em; }
          .unlinked-container { max-height: 400px; overflow-y: auto; border: 1px solid #ddd; padding: 10px; border-radius: 8px; }
          table { width: 100%; border-collapse: collapse; }
          th, td { padding: 8px; text-align: left; border-bottom: 1px solid #ddd; }
          th { background: #f0f0f0; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>Addon Admin Dashboard</h1>
          <h2>Content Summary</h2>
          <div class="stats">
            <div class="stat"><h3>${stats.total}</h3><p>Total Items</p></div>
            <div class="stat" style="color: green;"><h3>${stats.linked}</h3><p>Linked (in Catalog)</p></div>
            <div class="stat" style="color: orange;"><h3>${stats.unlinked}</h3><p>Unlinked (Not in Catalog)</p></div>
          </div>
          <h2>Unlinked Content (imdb_id is NULL)</h2>
          <div class="unlinked-container">
            <table>
              <thead>
                <tr>
                  <th>DB ID</th>
                  <th>Title</th>
                  <th>Year</th>
                  <th>Date Scraped</th>
                </tr>
              </thead>
              <tbody>
                ${unlinkedMovies.map(m => `
                  <tr>
                    <td>${m.id}</td>
                    <td>${m.title}</td>
                    <td>${m.year}</td>
                    <td>${m.created_at}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
      </body>
      </html>
    `;
    res.send(html);
  } catch (error) {
    console.error('Admin dashboard error:', error);
    res.status(500).send('Error generating dashboard.');
  }
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

const port = process.env.PORT || 7000;
const scheduler = new ScraperScheduler();

db.init().then(() => {
  app.listen(port, '0.0.0.0', () => {
    console.log(`Addon running on http://0.0.0.0:${port}`);
    console.log(`Admin dashboard available at http://0.0.0.0:${port}/admin`);
    log(`Addon server started on port ${port}`);
    scheduler.start();
  });
}).catch(err => {
  console.error('Failed to initialize application dependencies:', err);
  process.exit(1);
});
