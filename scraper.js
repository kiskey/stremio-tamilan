const axios = require('axios');
const cheerio = require('cheerio');
const Database = require('./database');

class Tamilan24Scraper {
  constructor() {
    this.baseUrl = 'https://tamilan24.com';
    this.userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
    this.db = new Database();
  }

  async init() {
    await this.db.init();
  }

  async scrapePage(pageUrl) {
    try {
      console.log(`Scraping: ${pageUrl}`);
      
      const response = await axios.get(pageUrl, {
        headers: {
          'User-Agent': this.userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.5',
          'Accept-Encoding': 'gzip, deflate',
          'Connection': 'keep-alive',
        },
        timeout: 10000
      });

      const $ = cheerio.load(response.data);
      const movies = [];

      $('.col-md-3').each((index, element) => {
        const $element = $(element);
        const $link = $element.find('a.thumb');
        const $title = $element.find('h4 a');
        
        if ($link.length && $title.length) {
          const navigationUrl = $link.attr('href');
          const titleText = $title.attr('title') || $title.text().trim();
          
          // Extract title and year from text like "Movie Title (2025)"
          let title = titleText;
          let year = null;
          
          const yearMatch = titleText.match(/\((\d{4})\)$/);
          if (yearMatch) {
            title = titleText.replace(/\s*\(\d{4}\)$/, '').trim();
            year = parseInt(yearMatch[1]);
          }
          
          const poster = $element.find('img').attr('src');
          
          if (navigationUrl && title) {
            movies.push({
              title,
              year,
              poster,
              navigation_url: navigationUrl.startsWith('http') ? navigationUrl : `${this.baseUrl}${navigationUrl}`
            });
          }
        }
      });

      console.log(`Found ${movies.length} movies on page`);
      return movies;
    } catch (error) {
      console.error(`Error scraping ${pageUrl}:`, error.message);
      return [];
    }
  }

  async scrapeMovieDetails(movie) {
    try {
      console.log(`Scraping details for: ${movie.title}`);
      
      const response = await axios.get(movie.navigation_url, {
        headers: {
          'User-Agent': this.userAgent
        },
        timeout: 10000
      });

      const $ = cheerio.load(response.data);
      
      // Extract video URL
      const videoUrl = $('video source').first().attr('src');
      
      // Extract additional details
      const description = $('.tag_video_title').first().text().trim();
      const poster = $('video').attr('poster') || movie.poster;
      
      // Try to get more details from the page
      const yearText = $('.text-muted span').first().text();
      if (yearText && !movie.year) {
        const yearMatch = yearText.match(/\d{2}\/\d{2}\/(\d{2})/);
        if (yearMatch) {
          movie.year = 2000 + parseInt(yearMatch[1]);
        }
      }
      
      return {
        ...movie,
        video_url: videoUrl,
        description: description || movie.description,
        poster: poster || movie.poster,
        quality: $('video source').first().attr('data-quality') || 'HD'
      };
    } catch (error) {
      console.error(`Error scraping details for ${movie.title}:`, error.message);
      return movie;
    }
  }

  async lookupTmdb(movie) {
    // In a real implementation, you would call TMDB API here
    // For this example, we'll just return the movie as-is
    // You would need to add your TMDB API key as an environment variable
    return movie;
  }

  async scrapeCatalog(startPage = 1, endPage = 1, fullScrape = false) {
    await this.init();
    
    // If full scrape is requested or no movies exist, clear the database
    if (fullScrape) {
      console.log('Performing full scrape - clearing database');
      await this.db.clearMovies();
    }
    
    const pagesToScrape = [];
    
    if (fullScrape) {
      // For full scrape, scrape all configured pages
      for (let i = startPage; i <= endPage; i++) {
        pagesToScrape.push(i);
      }
    } else {
      // For incremental scrape, only scrape first page
      pagesToScrape.push(startPage);
    }
    
    console.log(`Scraping pages: ${pagesToScrape.join(', ')}`);
    
    let totalMovies = 0;
    
    for (const pageNum of pagesToScrape) {
      const pageUrl = `${this.baseUrl}/videos/latest?page_id=${pageNum}`;
      const movies = await this.scrapePage(pageUrl);
      
      for (const movie of movies) {
        // Check if movie already exists
        const existingMovie = await this.db.getMovieByNavigationUrl(movie.navigation_url);
        
        if (!existingMovie || fullScrape) {
          // Scrape movie details
          const detailedMovie = await this.scrapeMovieDetails(movie);
          
          // Lookup TMDB info
          const finalMovie = await this.lookupTmdb(detailedMovie);
          
          // Save to database
          await this.db.insertMovie(finalMovie);
          totalMovies++;
          
          // Add delay to avoid overwhelming the server
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
      }
    }
    
    console.log(`Scraping completed. Added/updated ${totalMovies} movies.`);
    await this.db.close();
  }
}

// Run scraper if called directly
if (require.main === module) {
  const scraper = new Tamilan24Scraper();
  
  // Get configuration from environment variables
  const startPage = parseInt(process.env.SCRAPER_START_PAGE) || 1;
  const endPage = parseInt(process.env.SCRAPER_END_PAGE) || 5;
  const fullScrape = process.env.SCRAPER_FULL === 'true';
  
  scraper.scrapeCatalog(startPage, endPage, fullScrape)
    .then(() => {
      console.log('Scraping finished successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Scraping failed:', error);
      process.exit(1);
    });
}

module.exports = Tamilan24Scraper;
