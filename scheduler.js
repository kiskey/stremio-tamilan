const cron = require('node-cron');
const { spawn } = require('child_process');
const path = require('path');

class ScraperScheduler {
  constructor() {
    // Default schedule: every 6 hours
    this.schedule = process.env.SCRAPER_SCHEDULE || '0 */6 * * *';
    this.isRunning = false;
  }

  start() {
    console.log(`Starting scraper scheduler with schedule: ${this.schedule}`);
    
    // Run immediately on startup
    this.runScraper();
    
    // Schedule periodic runs
    cron.schedule(this.schedule, () => {
      this.runScraper();
    });
    
    console.log('Scheduler started');
  }

  runScraper() {
    if (this.isRunning) {
      console.log('Scraper is already running, skipping this run');
      return;
    }
    
    this.isRunning = true;
    console.log('Starting scraper process...');
    
    const scraperProcess = spawn('node', [path.join(__dirname, 'scraper.js')], {
      stdio: 'inherit',
      env: {
        ...process.env,
        SCRAPER_FULL: process.env.SCRAPER_FULL_INITIAL || 'false'
      }
    });
    
    scraperProcess.on('close', (code) => {
      this.isRunning = false;
      console.log(`Scraper process exited with code ${code}`);
      
      // Reset SCRAPER_FULL_INITIAL after first run
      if (process.env.SCRAPER_FULL_INITIAL === 'true') {
        process.env.SCRAPER_FULL_INITIAL = 'false';
      }
    });
    
    scraperProcess.on('error', (error) => {
      this.isRunning = false;
      console.error('Failed to start scraper process:', error);
    });
  }
}

// Start scheduler if called directly
if (require.main === module) {
  const scheduler = new ScraperScheduler();
  scheduler.start();
}

module.exports = ScraperScheduler;
