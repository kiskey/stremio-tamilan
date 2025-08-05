const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const schedule = require('node-schedule');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

// Database initialization
const db = new sqlite3.Database('./tamilan24.db', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  }
  console.log('Connected to the database.');
  initializeDatabase();
});

function initializeDatabase() {
  db.serialize(() => {
    // Create table for catalog items
    db.run(`CREATE TABLE IF NOT EXISTS catalog_items (
      id INTEGER PRIMARY KEY,
      title TEXT,
      imageUrl TEXT,
      year TEXT,
      rating TEXT,
      streamUrl TEXT,
      lastUpdated TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    // Create table for last scraped page
    db.run(`CREATE TABLE IF NOT EXISTS last_scraped (
      page_number INTEGER
    )`);

    // Initialize last scraped page if not exists
    db.get('SELECT page_number FROM last_scraped LIMIT 1', (err, row) => {
      if (err) {
        console.error('Error checking last scraped page:', err.message);
        db.run('INSERT INTO last_scraped (page_number) VALUES (0)', (err) => {
          if (err) console.error('Error initializing last scraped page:', err.message);
        });
      } else if (!row) {
        db.run('INSERT INTO last_scraped (page_number) VALUES (0)', (err) => {
          if (err) console.error('Error initializing last scraped page:', err.message);
        });
      }
    });
  });
}

// Function to fetch page with optional proxy
async function fetchPage(url, proxyUrl = '') {
  try {
    const options = {
      method: 'GET',
      url: url,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/37.36'
      }
    };

    if (proxyUrl) {
      options.agent = new (require('http-proxy-agent'))(proxyUrl);
    }

    const response = await axios(options);
    return response.data;
  } catch (error) {
    console.error('Error fetching page:', error.message);
    return null;
  }
}

// Function to extract catalog items from a specific page
function extractCatalog(html) {
  const $ = cheerio.load(html);
  const items = [];

  // Extract catalog items from the video grid
  $('.tag_video_grid_list').each((i, element) => {
    const $element = $(element);
    const title = $element.find('h4 a').text().trim();
    const imageUrl = $element.find('img').attr('src');
    const id = $element.find('a').attr('href').split('/').pop().split('.')[0];
    const year = $element.find('.year').text().trim();
    const rating = $element.find('.rating').text().trim();
    
    items.push({
      id,
      title,
      imageUrl,
      year,
      rating,
      streamUrl: null
    });
  });

  return items;
}

// Function to extract stream URL
async function extractStreamUrl(itemId) {
  try {
    const response = await fetchPage(`https://tamilan24.com/watch/${itemId}`, CONFIG.PROXY_URL);
    if (!response) {
      throw new Error('Failed to fetch movie page');
    }

    const $ = cheerio.load(response);
    // Find the video source
    const source = $('video source').first();
    if (!source.length) {
      throw new Error('Video source not found');
    }

    return source.attr('src');
  } catch (error) {
    console.error('Error extracting stream URL:', error.message);
    return null;
  }
}

// Function to save catalog items to database
async function saveCatalogItems(items) {
  try {
    for (const item of items) {
      // Check if item already exists
      db.get(`SELECT id FROM catalog_items WHERE id = ${item.id} LIMIT 1`, (err, row) => {
        if (err) {
          console.error('Error checking item existence:', err.message);
          return;
        }

        if (!row) {
          // Item doesn't exist, insert it
          const sql = `INSERT INTO catalog_items (id, title, imageUrl, year, rating, streamUrl) VALUES (?, ?, ?, ?, ?, ?)`;
          db.run(sql, [item.id, item.title, item.imageUrl, item.year, item.rating, item.streamUrl], (err) => {
            if (err) console.error('Error inserting item:', err.message);
          });
        } else {
          // Item exists, update it with new streamUrl if available
          if (item.streamUrl) {
            const sql = `UPDATE catalog_items SET streamUrl = ?, lastUpdated = CURRENT_TIMESTAMP WHERE id = ${item.id}`;
            db.run(sql, [item.streamUrl], (err) => {
              if (err) console.error('Error updating item:', err.message);
            });
          }
        }
      });
    }
  } catch (error) {
    console.error('Error saving catalog items:', error.message);
  }
}

// Function to get all catalog items from database
function getCatalogItems() {
  const items = [];
  db.all('SELECT * FROM catalog_items', [], (err, rows) => {
    if (err) {
      console.error('Error fetching catalog items:', err.message);
      return [];
    }
    return rows;
  });
  return items;
}

// Function to get last scraped page
function getLastScrapedPage() {
  return new Promise((resolve, reject) => {
    db.get('SELECT page_number FROM last_scraped LIMIT 1', (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row ? row.page_number : 0);
      }
    });
  });
}

// Function to update last scraped page
async function updateLastScrapedPage(pageNumber) {
  try {
    const sql = 'INSERT OR REPLACE INTO last_scraped (page_number) VALUES (?)';
    db.run(sql, [pageNumber], (err) => {
      if (err) console.error('Error updating last scraped page:', err.message);
    });
  } catch (error) {
    console.error('Error updating last scraped page:', error.message);
  }
}

// API endpoint to get catalog
app.get('/catalog', async (req, res) => {
  try {
    console.log('Fetching catalog...');
    const lastPage = await getLastScrapedPage();
    let items = [];
    let hasMore = false;

    // Determine range to scrape
    let startPage = 1;
    let endPage = 40; // Initial run: scrape pages 1-40

    if (lastPage > 0) {
      // Subsequent run: only scrape page 1
      startPage = 1;
      endPage = 1;
      hasMore = true;
    }

    // Fetch catalog items
    for (let page = startPage; page <= endPage; page++) {
      const url = `https://tamilan24.com/videos/latest?page_id=${page}`;
      console.log(`Fetching page ${page}...`);
      const html = await fetchPage(url, CONFIG.PROXY_URL);
      if (!html) {
        console.error(`Failed to fetch page ${page}`);
        continue;
      }

      const pageItems = extractCatalog(html);
      items = items.concat(pageItems);
      
      // Save items to database
      await saveCatalogItems(pageItems);
    }

    // Update last scraped page
    await updateLastScrapedPage(endPage);

    // Return catalog items
    res.json({ catalog: items, hasMore });
  } catch (error) {
    console.error('Error in /catalog endpoint:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API endpoint to get stream URL
app.get('/stream/:id', async (req, res) => {
  try {
    console.log(`Fetching stream URL for item ${req.params.id}`);
    const streamUrl = await extractStreamUrl(req.params.id);
    if (!streamUrl) {
      return res.status(404).json({ error: 'Stream not found' });
    }
    console.log('Stream URL found');
    res.json({ streamUrl });
  } catch (error) {
    console.error('Error in /stream endpoint:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Scheduled scraping
schedule.scheduleJob(CONFIG.SCRAPE_INTERVAL, async () => {
  try {
    console.log('Starting scheduled catalog update');
    const lastPage = await getLastScrapedPage();
    let items = [];
    let hasMore = false;

    // Determine range to scrape
    let startPage = 1;
    let endPage = 40; // Initial run: scrape pages 1-40

    if (lastPage > 0) {
      // Subsequent run: only scrape page 1
      startPage = 1;
      endPage = 1;
      hasMore = true;
    }

    // Fetch catalog items
    for (let page = startPage; page <= endPage; page++) {
      const url = `https://tamilan24.com/videos/latest?page_id=${page}`;
      console.log(`Fetching page ${page}...`);
      const html = await fetchPage(url, CONFIG.PROXY_URL);
      if (!html) {
        console.error(`Failed to fetch page ${page}`);
        continue;
      }

      const pageItems = extractCatalog(html);
      items = items.concat(pageItems);
      
      // Save items to database
      await saveCatalogItems(pageItems);
    }

    // Update last scraped page
    await updateLastScrapedPage(endPage);

    console.log(`Catalog updated with ${items.length} items`);
  } catch (error) {
    console.error('Error during scheduled catalog update:', error.message);
  }
});

app.listen(portI'll update the code to implement pagination and database storage for the catalog items. This will allow us to scrape all pages initially and then only check for new content on the first page in subsequent runs.

```javascript
<dyad-write path="index.js" description="Updating video stream extraction logic with pagination and database storage">
const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const schedule = require('node-schedule');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

// Database initialization
const db = new sqlite3.Database('./tamilan24.db', (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  }
  console.log('Connected to the database.');
  initializeDatabase();
});

function initializeDatabase() {
  db.serialize(() => {
    // Create table for catalog items
    db.run(`CREATE TABLE IF NOT EXISTS catalog_items (
      id INTEGER PRIMARY KEY,
      title TEXT,
      imageUrl TEXT,
      year TEXT,
      rating TEXT,
      streamUrl TEXT,
      lastUpdated TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    // Create table for last scraped page
    db.run(`CREATE TABLE IF NOT EXISTS last_scraped (
      page_number INTEGER
    )`);

    // Initialize last scraped page if not exists
    db.get('SELECT page_number FROM last_scraped LIMIT 1', (err, row) => {
      if (err) {
        console.error('Error checking last scraped page:', err.message);
        db.run('INSERT INTO last_scraped (page_number) VALUES (0)', (err) => {
          if (err) console.error('Error initializing last scraped page:', err.message);
        });
      } else if (!row) {
        db.run('INSERT INTO last_scraped (page_number) VALUES (0)', (err) => {
          if (err) console.error('Error initializing last scraped page:', err.message);
        });
      }
    });
  });
}

// Function to fetch page with optional proxy
async function fetchPage(url, proxyUrl = '') {
  try {
    const options = {
      method: 'GET',
      url: url,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/37.36'
      }
    };

    if (proxyUrl) {
      options.agent = new (require('http-proxy-agent'))(proxyUrl);
    }

    const response = await axios(options);
    return response.data;
  } catch (error) {
    console.error('Error fetching page:', error.message);
    return null;
  }
}

// Function to extract catalog items from a specific page
function extractCatalog(html) {
  const $ = cheerio.load(html);
  const items = [];

  // Extract catalog items from the video grid
  $('.tag_video_grid_list').each((i, element) => {
    const $element = $(element);
    const title = $element.find('h4 a').text().trim();
    const imageUrl = $element.find('img').attr('src');
    const id = $element.find('a').attr('href').split('/').pop().split('.')[0];
    const year = $element.find('.year').text().trim();
    const rating = $element.find('.rating').text().trim();
    
    items.push({
      id,
      title,
      imageUrl,
      year,
      rating,
      streamUrl: null
    });
  });

  return items;
}

// Function to extract stream URL
async function extractStreamUrl(itemId) {
  try {
    const response = await fetchPage(`https://tamilan24.com/watch/${itemId}`, CONFIG.PROXY_URL);
    if (!response) {
      throw new Error('Failed to fetch movie page');
    }

    const $ = cheerio.load(response);
    // Find the video source
    const source = $('video source').first();
    if (!source.length) {
      throw new Error('Video source not found');
    }

    return source.attr('src');
  } catch (error) {
    console.error('Error extracting stream URL:', error.message);
    return null;
  }
}

// Function to save catalog items to database
async function saveCatalogItems(items) {
  try {
    for (const item of items) {
      // Check if item already exists
      db.get(`SELECT id FROM catalog_items WHERE id = ${item.id} LIMIT 1`, (err, row) => {
        if (err) {
          console.error('Error checking item existence:', err.message);
          return;
        }

        if (!row) {
          // Item doesn't exist, insert it
          const sql = `INSERT INTO catalog_items (id, title, imageUrl, year, rating, streamUrl) VALUES (?, ?, ?, ?, ?, ?)`;
          db.run(sql, [item.id, item.title, item.imageUrl, item.year, item.rating, item.streamUrl], (err) => {
            if (err) console.error('Error inserting item:', err.message);
          });
        } else {
          // Item exists, update it with new streamUrl if available
          if (item.streamUrl) {
            const sql = `UPDATE catalog_items SET streamUrl = ?, lastUpdated = CURRENT_TIMESTAMP WHERE id = ${item.id}`;
            db.run(sql, [item.streamUrl], (err) => {
              if (err) console.error('Error updating item:', err.message);
            });
          }
        }
      });
    }
  } catch (error) {
    console.error('Error saving catalog items:', error.message);
  }
}

// Function to get all catalog items from database
function getCatalogItems() {
  const items = [];
  db.all('SELECT * FROM catalog_items', [], (err, rows) => {
    if (err) {
      console.error('Error fetching catalog items:', err.message);
      return [];
    }
    return rows;
  });
  return items;
}

// Function to get last scraped page
function getLastScrapedPage() {
  return new Promise((resolve, reject) => {
    db.get('SELECT page_number FROM last_scraped LIMIT 1', (err, row) => {
      if (err) {
        reject(err);
      } else {
        resolve(row ? row.page_number : 0);
      }
    });
  });
}

// Function to update last scraped page
async function updateLastScrapedPage(pageNumber) {
  try {
    const sql = 'INSERT OR REPLACE INTO last_scraped (page_number) VALUES (?)';
    db.run(sql, [pageNumber], (err) => {
      if (err) console.error('Error updating last scraped page:', err.message);
    });
  } catch (error) {
    console.error('Error updating last scraped page:', error.message);
  }
}

// API endpoint to get catalog
app.get('/catalog', async (req, res) => {
  try {
    console.log('Fetching catalog...');
    const lastPage = await getLastScrapedPage();
    let items = [];
    let hasMore = false;

    // Determine range to scrape
    let startPage = 1;
    let endPage = 40; // Initial run: scrape pages 1-40

    if (lastPage > 0) {
      // Subsequent run: only scrape page 1
      startPage = 1;
      endPage = 1;
      hasMore = true;
    }

    // Fetch catalog items
    for (let page = startPage; page <= endPage; page++) {
      const url = `https://tamilan24.com/videos/latest?page_id=${page}`;
      console.log(`Fetching page ${page}...`);
      const html = await fetchPage(url, CONFIG.PROXY_URL);
      if (!html) {
        console.error(`Failed to fetch page ${page}`);
        continue;
      }

      const pageItems = extractCatalog(html);
      items = items.concat(pageItems);
      
      // Save items to database
      await saveCatalogItems(pageItems);
    }

    // Update last scraped page
    await updateLastScrapedPage(endPage);

    // Return catalog items
    res.json({ catalog: items, hasMore });
  } catch (error) {
    console.error('Error in /catalog endpoint:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// API endpoint to get stream URL
app.get('/stream/:id', async (req, res) => {
  try {
    console.log(`Fetching stream URL for item ${req.params.id}`);
    const streamUrl = await extractStreamUrl(req.params.id);
    if (!streamUrl) {
      return res.status(404).json({ error: 'Stream not found' });
    }
    console.log('Stream URL found');
    res.json({ streamUrl });
  } catch (error) {
    console.error('Error in /stream endpoint:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Scheduled scraping
schedule.scheduleJob(CONFIG.SCRAPE_INTERVAL, async () => {
  try {
    console.log('Starting scheduled catalog update');
    const lastPage = await getLastScrapedPage();
    let items = [];
    let hasMore = false;

    // Determine range to scrape
    let startPage = 1;
    let endPage = 40; // Initial run: scrape pages 1-40

    if (lastPage > 0) {
      // Subsequent run: only scrape page 1
      startPage = 1;
      endPage = 1;
      hasMore = true;
    }

    // Fetch catalog items
    for (let page = startPage; page <= endPage; page++) {
      const url = `https://tamilan24.com/videos/latest?page_id=${page}`;
      console.log(`Fetching page ${page}...`);
      const html = await fetchPage(url, CONFIG.PROXY_URL);
      if (!html) {
        console.error(`Failed to fetch page ${page}`);
        continue;
      }

      const pageItems = extractCatalog(html);
      items = items.concat(pageItems);
      
      // Save items to database
      await saveCatalogItems(pageItems);
    }

    // Update last scraped page
    await updateLastScrapedPage(endPage);

    console.log(`Catalog updated with ${items.length} items`);
  } catch (error) {
    console.error('Error during scheduled catalog update:', error.message);
  }
});

app.listen(port, () => {
  console.log(`Stream.io addon server running on port ${port}`);
});
