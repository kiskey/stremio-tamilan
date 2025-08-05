const { runScraper } = require('./scraper');
const debug = require('debug')('addon:scheduler');

const SCRAPE_INTERVAL = process.env.SCRAPE_INTERVAL || 24 * 60 * 60 * 1000; // Default to 24 hours

class ScraperScheduler {
  constructor() {
    this.timer = null;
  }

  start() {
    debug('Starting scheduler...');
    // Run once immediately, then start the timer
    runScraper().then(() => {
      this.timer = setInterval(runScraper, SCRAPE_INTERVAL);
      debug(`Scheduler started. Next scrape in ${SCRAPE_INTERVAL / 1000 / 60} minutes.`);
    });
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      debug('Scheduler stopped.');
    }
  }
}

module.exports = ScraperScheduler;
