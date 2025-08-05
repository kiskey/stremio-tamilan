import { runScraper } from './scraper.js';
import debug from 'debug';

const log = debug('addon:scheduler');
const SCRAPE_INTERVAL = process.env.SCRAPE_INTERVAL || 24 * 60 * 60 * 1000; // Default to 24 hours

class ScraperScheduler {
  constructor() {
    this.timer = null;
  }

  start() {
    log('Starting scheduler...');
    // Run once immediately, then start the timer
    runScraper().then(() => {
      this.timer = setInterval(runScraper, SCRAPE_INTERVAL);
      log(`Scheduler started. Next scrape in ${SCRAPE_INTERVAL / 1000 / 60} minutes.`);
    });
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      log('Scheduler stopped.');
    }
  }
}

export default ScraperScheduler;
