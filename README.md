
# Tamilan Stremio Addon

This Stremio addon provides Tamil movies from Tamilan, enriched with metadata from TMDB.

## Features

- Latest movies from Tamilan, with rich metadata from TMDB.
- Search for movies.
- Uses Stremio's default Cinemata for posters, descriptions, ratings, etc.
- Aggregates multiple video streams for a single movie.

## Running with Docker (Recommended)

This project includes a multi-stage `Dockerfile` for building a clean, production-ready image.

1.  **Get a TMDB API Key:** You must get a free API key from [The Movie Database](https://www.themoviedb.org/signup).

2.  Build the Docker image:
    ```bash
    docker build -t tamilan24-stremio-addon .
    ```

3.  Run the Docker container, providing your TMDB API key:
    ```bash
    docker run -p 7000:7000 -d --name tamilan-addon \
      -e "TMDB_API_KEY=your_tmdb_api_key_here" \
      tamilan24-stremio-addon
    ```

## Configuration

The application is configured using environment variables.

| Variable             | Description                                                                    | Default                                | Required |
| -------------------- | ------------------------------------------------------------------------------ | -------------------------------------- | -------- |
| `TMDB_API_KEY`       | Your API key for The Movie Database.                                           | (none)                                 | **Yes**  |
| `PORT`               | The port the addon server will run on.                                         | `7000`                                 | No       |
| `SCRAPE_INTERVAL`    | The interval for scraping new content, in milliseconds.                        | `86400000` (24 hours)                  | No       |
| `SCRAPER_TARGET_URL` | The base URL for the scraper to fetch the movie list from.                     | `https://website/videos/latest`  | No       |
| `SCRAPE_MODE`        | Set to `full` to scrape all pages. By default, it's incremental (first page only). | (not set)                              | No       |
| `DEBUG`              | Controls debug logging. Set to `addon:*` to see all logs.                      | (not set)                              | No       |

## Debugging

To see all debug messages when running locally:
```bash
export DEBUG=addon:*
export TMDB_API_KEY=your_key
npm start
