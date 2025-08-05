# Tamilan Stremio Addon

This Stremio addon provides Tamil movies from Tamilan.

## Features

- Latest movies from Tamilan
- Search for movies
- Movie details (poster, description, genre, rating)
- Direct video streams

## Running the Addon

### Prerequisites

- Node.js (v14 or later)
- npm

### Installation

1.  Clone the repository:
    ```bash
    git clone https://github.com/your-username/tamilan24-stremio-addon.git
    cd tamilan24-stremio-addon
    ```
2.  Install the dependencies:
    ```bash
    npm install
    ```

### Running Locally

To run the addon locally, use the following command:

```bash
npm start
```

The addon will be available at `http://localhost:7000`.

### Running with Docker

You can also run the addon using Docker:

1.  Build the Docker image:
    ```bash
    docker build -t tamilan24-stremio-addon .
    ```
2.  Run the Docker container:
    ```bash
    docker run -p 7000:7000 tamilan24-stremio-addon
    ```

## Debugging

This addon uses the `debug` library for logging. You can enable logging for different parts of the application by setting the `DEBUG` environment variable.

### Enabling All Logs

To see all debug messages, set the `DEBUG` variable to `addon:*`:

```bash
DEBUG=addon:* npm start
```

Or with Docker:

```bash
docker run -p 7000:7000 -e DEBUG=addon:* tamilan24-stremio-addon
```

### Specific Logs

You can also enable logs for specific components:

-   `addon:server`: For server-related messages.
-   `addon:database`: For database operations.
-   `addon:scraper`: For web scraping activities.

Example:

```bash
DEBUG=addon:scraper,addon:server npm start
```

This will only show logs from the scraper and the server.
