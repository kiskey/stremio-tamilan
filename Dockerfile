# R7: Stage 1: The "Builder" stage.
# Its only purpose is to install dependencies and create a correct package-lock.json
# for the target Node.js version.
FROM node:18.20.8-alpine AS builder

# Set the working directory
WORKDIR /usr/src/app

# Copy only the package.json file to leverage Docker's layer caching.
# This step will only be re-run if package.json changes.
COPY package.json ./

# Install dependencies. This will also generate a package-lock.json inside this stage's
# filesystem that is guaranteed to be compatible with Node.js v18.
RUN npm install

# ---

# R7: Stage 2: The "Production" stage.
# This stage builds the final, lean image for running the application.
FROM node:18.20.8-alpine

# Set the working directory
WORKDIR /app

# Copy the package.json AND the generated package-lock.json from the builder stage.
COPY --from=builder /usr/src/app/package.json ./
COPY --from=builder /usr/src/app/package-lock.json ./

# Use 'npm ci' for clean, deterministic, and fast installation based on the lock file.
# This is the best practice for production/CI environments.
RUN npm ci

# Copy the rest of the application source code into the final image.
COPY . .

# Expose the port the app runs on.
EXPOSE 7000

# The command to run the application.
CMD [ "npm", "start" ]
