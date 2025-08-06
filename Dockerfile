# Stage 1: The "Builder" stage.
FROM node:18.20.8-alpine AS builder
WORKDIR /usr/src/app
COPY package.json ./
RUN npm install

# ---

# Stage 2: The "Production" stage.
FROM node:18.20.8-alpine
WORKDIR /app
COPY --from=builder /usr/src/app/package.json ./
COPY --from=builder /usr/src/app/package-lock.json ./
RUN npm ci
COPY . .

# R18: Add TMDB_API_KEY as an argument that can be passed during build or as an env var at runtime.
ARG TMDB_API_KEY
ENV TMDB_API_KEY=${TMDB_API_KEY}

EXPOSE 7000
CMD [ "npm", "start" ]
