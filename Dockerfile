# Stage 1: The "Builder" stage.
FROM node:18.20.8-alpine AS builder
WORKDIR /usr/src/app
COPY package.json ./
# Use --no-optional to potentially speed up builds if you don't need optional deps
RUN npm install --no-optional

# ---

# Stage 2: The "Production" stage.
FROM node:18.20.8-alpine
WORKDIR /app
COPY --from=builder /usr/src/app/package.json ./
COPY --from=builder /usr/src/app/package-lock.json ./
# Use --production for a smaller node_modules folder
RUN npm ci --production

COPY . .

ARG TMDB_API_KEY
ENV TMDB_API_KEY=${TMDB_API_KEY}

# R22: This instruction declares that the /app directory should be a mount point for a volume.
# When a named volume is mounted here, it will persist the contents of this directory,
# including the database.sqlite file that gets created at runtime.
VOLUME /app

EXPOSE 7000
CMD [ "npm", "start" ]
