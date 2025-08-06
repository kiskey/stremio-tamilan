# Tamilan Stremio Addon

This Stremio addon provides Tamil movies from Tamilan, enriched with metadata from TMDB.

## Features

- Latest movies from Tamilan, with rich metadata from TMDB.
- Search for movies.
- Uses Stremio's default Cinemata for posters, descriptions, ratings, etc.
- Aggregates multiple video streams for a single movie.

## Running with Docker (Recommended)

This project includes a multi-stage `Dockerfile` for building a clean, production-ready image. The database is persisted using a Docker Named Volume to prevent data loss when the container is updated or removed.

1.  **Get a TMDB API Key:** You must get a free API key from [The Movie Database](https://www.themoviedb.org/signup).

2.  **Create a Docker Volume (First time only):**
    This step is optional as Docker will create it on first use, but it's good practice.
    ```bash
    docker volume create tamilan-db-data
    ```

3.  **Build the Docker image:**
    ```bash
    docker build -t tamilan24-stremio-addon .
    ```

4.  **Run the Docker container:**
    Use the `-v` flag to mount the named volume to the `/app` directory inside the container.
    ```bash
    docker run -p 7000:7000 -d --name tamilan-addon \
      -e "TMDB_API_KEY=your_tmdb_api_key_here" \
      -v tamilan-db-data:/app \
      tamilan24-stremio-addon
    ```

### Managing the Database

-   **To see your volume:** `docker volume ls`
-   **To inspect the volume (and see where it's stored on your host):** `docker volume inspect tamilan-db-data`
-   **To back up your database:** You can run a temporary container that mounts the volume and creates a backup.

## Configuration

The application is configured using environment variables.

| Variable             | Description                                                                    | Default                                | Required |
| -------------------- | ------------------------------------------------------------------------------ | -------------------------------------- | -------- |
| `TMDB_API_KEY`       | Your API key for The Movie Database.                                           | (none)                                 | **Yes**  |
| `PORT`               | The port the addon server will run on.                                         | `7000`                                 | No       |
| `SCRAPE_INTERVAL`    | The interval for scraping new content, in milliseconds.                        | `86400000` (24 hours)                  | No       |
| `SCRAPER_TARGET_URL` | The base URL for the scraper to fetch the movie list from.                     | `https://tamilan/videos/latest`  | No       |
| `SCRAPE_MODE`        | Set to `full` to scrape all pages. By default, it's incremental (first page only). | (not set)                              | No       |
| `DEBUG`              | Controls debug logging. Set to `addon:*` to see all logs.                      | (not set)                              | No       |

## Debugging

To see all debug messages when running locally:
```bash
export DEBUG=addon:*
export TMDB_API_KEY=your_key
npm start
