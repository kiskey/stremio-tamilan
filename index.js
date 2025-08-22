import sdk from 'stremio-addon-sdk';
const { addonBuilder, getRouter } = sdk;
import express from 'express';
import debug from 'debug';
import db from './database.js';
import tmdb from './tmdb.js';
import ScraperScheduler from './scheduler.js';

const log = debug('addon:server');
const manifest = { /* ... manifest remains the same ... */ 
  id: 'org.tamilan24.addon',
  version: '1.0.0',
  name: 'Tamilan24 Movies',
  description: 'Tamil movies from Tamilan24',
  logo: 'https://tamilan24.com/themes/tamilan24/assets/images/logo.png',
  background: 'https://tamilan24.com/themes/tamilan24/assets/images/logo.png',
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

// R3, R13: Catalog handler for Stremio addon
builder.defineCatalogHandler(async (args) => {
  log('Catalog request: %O', args);
  try {
    const limit = 100;
    const skip = parseInt(args.extra.skip) || 0;
    
    let movies;
    if (args.extra.search) {
      movies = await db.searchMovies(args.extra.search, limit, skip);
      log('Search catalog for "%s" returned %d movies.', args.extra.search, movies.length);
    } else {
      movies = await db.getMovies(limit, skip);
      log('Latest catalog request returned %d movies.', movies.length);
    }
    
    if (movies.length === 0) {
      log('Catalog handler returned no movies. Check scraper and TMDB linking.');
    }

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

// R3, R13: Stream handler for Stremio addon
builder.defineStreamHandler(async (args) => {
  log('Stream request: %O', args);
  try {
    const imdbId = args.id;
    let movie;

    if (imdbId.startsWith('tt')) {
      movie = await db.getMovieByImdbId(imdbId);
      if (!movie) {
        log('No movie found in DB for IMDb ID: %s. This means it\'s either not in DB or lacks valid IMDb ID.', imdbId);
      } else {
        log('Found movie in DB for IMDb ID: %s (internal ID: %d)', imdbId, movie.id);
      }
    } else {
      const id = args.id.startsWith('t24:') ? args.id.replace('t24:', '') : args.id;
      movie = await db.getMovieById(id);
      if (!movie) {
        log('No movie found in DB for internal ID: %s.', id);
      } else {
        log('Found movie in DB for internal ID: %s (IMDb ID: %s)', id, movie.imdb_id || 'NULL');
      }
    }
    
    if (!movie) {
      return Promise.resolve({ streams: [] });
    }
    
    const streamsFromDb = await db.getStreamsForMovieId(movie.id);
    
    if (!streamsFromDb || streamsFromDb.length === 0) {
      log('No streams found in DB for movie ID: %d ("%s").', movie.id, movie.title);
      return Promise.resolve({ streams: [] });
    }
    
    const streams = streamsFromDb.map(stream => ({
      title: stream.title,
      url: stream.url,
      behaviorHints: {
        bingeGroup: `tamilan24-${movie.id}-${stream.quality}`
      }
    }));
    
    log('Responding with %d streams for ID: %s, movie: "%s"', streams.length, args.id, movie.title);
    return Promise.resolve({ streams });
  } catch (error) {
    console.error('Stream error:', error);
    return Promise.resolve({ streams: [] });
  }
});

const app = express();
app.use(express.json()); 
const addonInterface = builder.getInterface();
app.use('/', getRouter(addonInterface));

// R4, R7: Admin dashboard route
app.get('/admin', async (req, res) => {
  log('Admin dashboard request');
  try {
    const PAGE_SIZE = 50;
    let page = parseInt(req.query.page, 10) || 1;
    if (page < 1) page = 1;

    const skip = (page - 1) * PAGE_SIZE;

    const stats = await db.getStats();
    const unlinkedMovies = await db.getUnlinkedMovies(PAGE_SIZE, skip);
    const totalPages = Math.ceil(stats.unlinked / PAGE_SIZE);

    // Function to generate pagination HTML
    const renderPagination = () => {
      let html = '<div class="pagination">';
      if (page > 1) {
        html += `<a href="/admin?page=${page - 1}">&laquo; Previous</a>`;
      }
      for (let i = 1; i <= totalPages; i++) {
        if (i === page) {
          html += `<a class="active">${i}</a>`;
        } else {
          html += `<a href="/admin?page=${i}">${i}</a>`;
        }
      }
      if (page < totalPages) {
        html += `<a href="/admin?page=${page + 1}">Next &raquo;</a>`;
      }
      html += '</div>';
      return html;
    };

    const html = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8"><title>Addon Admin Dashboard</title>
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background: #f0f2f5; color: #1c1e21; padding: 20px; }
          .container { max-width: 1200px; margin: auto; background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 2px 4px rgba(0,0,0,0.1); }
          h1, h2 { color: #333; border-bottom: 1px solid #ddd; padding-bottom: 10px; }
          .stats { display: flex; justify-content: space-around; text-align: center; margin: 20px 0; }
          .stat { padding: 20px; background: #f7f7f7; border-radius: 8px; width: 30%; border: 1px solid #ddd; }
          .stat h3 { margin: 0; font-size: 2.5em; }
          .controls-container { display: flex; align-items: flex-start; gap: 20px; margin-top: 20px; }
          .list-box { width: 45%; }
          .list-box h3 { text-align: center; }
          select[multiple] { width: 100%; height: 300px; border: 1px solid #ddd; border-radius: 4px; padding: 5px; }
          .shuttle-controls { display: flex; flex-direction: column; justify-content: center; gap: 10px; margin-top: 50px; }
          button { padding: 8px 12px; cursor: pointer; border: 1px solid #ccc; background: #f7f7f7; border-radius: 4px; }
          button:hover { background: #e9e9e9; }
          #rematchBtn { background-color: #007bff; color: white; font-weight: bold; width: 100%; padding: 10px; margin-top: 10px;}
          #rematchBtn:hover { background-color: #0056b3; }
          .manual-link-table { width: 100%; margin-top: 20px; }
          .manual-link-table td { padding: 4px; }
          .manual-link-table input { width: 150px; padding: 4px; }
          .pagination { text-align: center; margin-top: 20px; }
          .pagination a { color: #007bff; padding: 8px 16px; text-decoration: none; transition: background-color .3s; border: 1px solid #ddd; margin: 0 4px; }
          .pagination a.active { background-color: #007bff; color: white; border: 1px solid #007bff; }
          .pagination a:hover:not(.active) { background-color: #ddd; }
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
          <h2>Unlinked Content Management</h2>
          <div class="controls-container">
            <div class="list-box">
              <h3>Unlinked Items (Page ${page} of ${totalPages})</h3>
              <select id="unlinkedList" multiple>
                ${unlinkedMovies.map(m => `<option value="${m.id}">${m.title} (${m.year})</option>`).join('')}
              </select>
            </div>
            <div class="shuttle-controls">
              <button onclick="moveItems('unlinkedList', 'rematchList', true)">&gt;&gt;</button>
              <button onclick="moveItems('unlinkedList', 'rematchList')">&gt;</button>
              <button onclick="moveItems('rematchList', 'unlinkedList')">&lt;</button>
              <button onclick="moveItems('rematchList', 'unlinkedList', true)">&lt;&lt;</button>
            </div>
            <div class="list-box">
              <h3>Items to Rematch</h3>
              <select id="rematchList" multiple></select>
              <button id="rematchBtn" onclick="rematchSelected()">Rematch Selected</button>
            </div>
          </div>
          ${renderPagination()}
          <h2>Manual Linking (Current Page)</h2>
          <div class="manual-link-table">
            <table>${unlinkedMovies.map(m => `
              <tr>
                <td>${m.title} (${m.year})</td>
                <td><input type="text" id="manualId-${m.id}" placeholder="tt... or tmdb..."></td>
                <td><button onclick="manualLink(${m.id})">Save</button></td>
              </tr>`).join('')}
            </table>
          </div>
          ${renderPagination()}
        </div>
        <script>
          // ... JS functions remain the same ...
          function moveItems(fromId, toId, all = false) {
            const fromList = document.getElementById(fromId);
            const toList = document.getElementById(toId);
            const itemsToMove = all ? Array.from(fromList.options) : Array.from(fromList.selectedOptions);
            itemsToMove.forEach(option => toList.appendChild(option));
          }

          async function rematchSelected() {
            const rematchList = document.getElementById('rematchList');
            const ids = Array.from(rematchList.options).map(opt => opt.value);
            if (ids.length === 0) {
              alert('No items selected to rematch.');
              return;
            }
            
            const btn = document.getElementById('rematchBtn');
            btn.disabled = true;
            btn.textContent = 'Rematching...';

            const response = await fetch('/admin/rematch', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ids })
            });
            const result = await response.json();
            alert(\`Rematch complete!\\nSuccess: \${result.success}\\nFailed: \${result.failed}\`);
            location.reload();
          }

          async function manualLink(id) {
            const input = document.getElementById('manualId-' + id);
            const imdbId = input.value.trim();
            if (!imdbId) {
              alert('Please enter an IMDb or TMDB ID.');
              return;
            }

            const response = await fetch('/admin/manual-link', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id, imdbId })
            });
            const result = await response.json();
            if (result.success) {
              alert('Successfully linked!');
              location.reload();
            } else {
              alert('Failed to link: ' + result.error);
            }
          }
        </script>
      </body>
      </html>`;
    res.send(html);
  } catch (error) {
    console.error('Admin dashboard error:', error);
    res.status(500).send('Error generating dashboard.');
  }
});

// R4: Admin endpoint for rematching movies
app.post('/admin/rematch', async (req, res) => {
    const { ids } = req.body;
    if (!ids || !Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: 'Invalid ID list provided.' });
    }

    log(`Admin Rematch: Request for ${ids.length} items.`);
    let successCount = 0;
    const moviesToRematch = await db.getUnlinkedMoviesByIds(ids);

    for (const movie of moviesToRematch) {
        const tmdbData = await tmdb.searchMovie(movie.title, movie.year);
        if (tmdbData && tmdbData.external_ids?.imdb_id) {
            log(`Admin Rematch SUCCESS for "${movie.title}": Found imdb_id ${tmdbData.external_ids.imdb_id}`);
            await db.updateMovieMetadata(movie.id, {
                imdb_id: tmdbData.external_ids.imdb_id,
                tmdb_id: tmdbData.id,
                description: tmdbData.overview,
                rating: tmdbData.vote_average?.toFixed(1),
                genre: tmdbData.genres?.map(g => g.name).join(', ')
            });
            successCount++;
        } else {
            log(`Admin Rematch FAIL for "${movie.title}": No match with imdb_id found.`);
        }
    }
    log(`Admin Rematch Complete: ${successCount} successful, ${moviesToRematch.length - successCount} failed.`);
    res.json({ success: successCount, failed: moviesToRematch.length - successCount });
});

// R4: Admin endpoint for manual linking movies
app.post('/admin/manual-link', async (req, res) => {
    const { id, imdbId } = req.body;
    if (!id || !imdbId) {
        return res.status(400).json({ error: 'Movie ID and IMDb/TMDB ID are required.' });
    }

    log(`Manual link request for movie ID ${id} with external ID ${imdbId}`);
    const tmdbData = await tmdb.getMovieDetailsByImdbId(imdbId);

    if (tmdbData && tmdbData.external_ids?.imdb_id) {
        await db.updateMovieMetadata(id, {
            imdb_id: tmdbData.external_ids.imdb_id,
            tmdb_id: tmdbData.id,
            description: tmdbData.overview,
            rating: tmdbData.vote_average?.toFixed(1),
            genre: tmdbData.genres?.map(g => g.name).join(', ')
        });
        return res.json({ success: true });
    } else {
        return res.status(404).json({ success: false, error: 'Could not find a matching movie on TMDB with that ID.' });
    }
});

app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

const port = process.env.PORT || 7000;
const scheduler = new ScraperScheduler();

db.init().then(() => {
  app.listen(port, '0.0.0.0', () => {
    console.log(`Addon running on http://0.0.0.0:${port}`);
    console.log(`Admin dashboard available at http://0.0.0.0:${port}/admin`);
    scheduler.start();
  });
}).catch(err => {
  console.error('Failed to initialize application dependencies:', err);
  process.exit(1);
});
