# Tamilan Stremio Addon

This Stremio addon provides Tamil movies from Tamilan, enriched with metadata from TMDB.

## Features

- Latest movies from Tamilan, with rich metadata from TMDB.
- Search for movies.
- Uses Stremio's default Cinemata for posters, descriptions, ratings, etc.
- Aggregates multiple video streams for a single movie.

## Running with Docker (Recommended)

This project is designed to persist its database on the host machine to prevent data loss. You can choose one of two methods.

### Method 1: Bind Mount (Direct Host Access - Recommended for you)

This method lets you choose a specific folder on your machine to store the database, making it easy to access and back up.

1.  **Get a TMDB API Key:** You must get a free API key from [The Movie Database](https://www.themoviedb.org/signup).

2.  **Create a Directory on Your Host:**
    Choose a location on your machine where you want to store the data.
    ```bash
    mkdir -p /home/your-user/docker-data/tamilan-addon
    ```
    *(Replace `/home/your-user/` with your actual home directory or any other path)*

3.  **Build the Docker image:**
    ```bash
    docker build -t tamilan24-stremio-addon .
    ```

4.  **Run the Docker Container:**
    We will use the `--user` flag to prevent any file permission issues. This command tells Docker to run the container using your current user ID.

    ```bash
    # Note the use of -v for the bind mount and --user to set permissions
    docker run -p 7000:7000 -d --name tamilan-addon \
      -e "TMDB_API_KEY=your_tmdb_api_key_here" \
      --user "$(id -u):$(id -g)" \
      -v "/home/your-user/docker-data/tamilan-addon:/app" \
      tamilan24-stremio-addon
    ```
    Your `database.sqlite` file will now appear in `/home/your-user/docker-data/tamilan-addon` on your host machine.

### Method 2: Named Volume (Docker Managed)

This is the more portable option if you don't need to specify the exact location of the database file.

1.  Build the image as shown above.
2.  Run the container with a named volume:
    ```bash
    docker run -p 7000:7000 -d --name tamilan-addon \
      -e "TMDB_API_KEY=your_tmdb_api_key_here" \
      -v tamilan-db-data:/app \
      tamilan24-stremio-addon
    ```
    To find where Docker stored the data, run `docker volume inspect tamilan-db-data`.

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
