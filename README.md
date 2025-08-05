# Tamilan24 Stremio Addon

A Stremio addon for Tamilan24 that scrapes movie content and provides it through a SQLite database.

## Features

- Scrapes Tamilan24 for movie content
- Stores data in SQLite database
- Provides catalog and streams to Stremio
- Configurable through environment variables
- Docker container with GitHub Actions workflow
- Automatic scraping scheduler

## Setup

### Environment Variables

Create a `.env` file with the following variables:

```env
# Server configuration
PORT=7000
DB_PATH=./tamilan24.db

# Scraper configuration
SCRAPER_START_PAGE=1
SCRAPER_END_PAGE=10
SCRAPER_SCHEDULE=0 */6 * * *  # Every 6 hours
SCRAPER_FULL_INITIAL=false    # Set to true for initial full scrape

# TMDB API (optional)
TMDB_API_KEY=your_tmdb_api_key
```

### Running with Docker

1. Build the Docker image:
```bash
docker build -t tamilan24-addon .
```

2. Run the container:
```bash
docker run -d \
  -p 7000:7000 \
  -v ./data:/app/data \
  --name tamilan24-addon \
  tamilan24-addon
```

### Running locally

1. Install dependencies:
```bash
npm install
```

2. Start the addon:
```bash
npm start
```

3. For initial full scrape:
```bash
SCRAPER_FULL_INITIAL=true npm run scrape
```

## Usage

Once running, the addon will be available at `http://localhost:7000/manifest.json`.

Add this URL to Stremio to use the addon.

## GitHub Actions

The repository includes a GitHub Actions workflow that:
1. Builds the Docker image on push to main branch
2. Pushes the image to GitHub Container Registry

To use this:
1. Set up GitHub Actions in your repository
2. The workflow will automatically run on pushes to main

## Manual Scraping

To manually trigger scraping:
```bash
npm run scrape
```

## Configuration

### Scraper Configuration

- `SCRAPER_START_PAGE`: First page to scrape (default: 1)
- `SCRAPER_END_PAGE`: Last page to scrape (default: 10)
- `SCRAPER_SCHEDULE`: Cron schedule for automatic scraping (default: every 6 hours)
- `SCRAPER_FULL_INITIAL`: Whether to do a full scrape on first run (default: false)

### Database

The SQLite database is stored at `./tamilan24.db` by default. You can change this with the `DB_PATH` environment variable.

## How it works

1. The scraper periodically visits Tamilan24 pages
2. It extracts movie information (title, year, poster, etc.)
3. For each movie, it visits the detail page to get the video URL
4. All information is stored in SQLite database
5. Stremio requests are served from this database
6. When a user requests a stream, the addon returns the direct video URL

## Development

To run in development mode with auto-reload:
```bash
npm run dev
