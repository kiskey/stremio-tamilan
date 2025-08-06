# Stage 1: The "Builder" stage.
FROM node:18.20.8-alpine AS builder
WORKDIR /usr/src/app
COPY package.json ./
RUN npm install --no-optional

# ---

# Stage 2: The "Production" stage.
FROM node:18.20.8-alpine
WORKDIR /app
COPY --from=builder /usr/src/app/package.json ./
COPY --from=builder /usr/src/app/package-lock.json ./
RUN npm ci --production
COPY . .

ARG TMDB_API_KEY
ENV TMDB_API_KEY=${TMDB_API_KEY}

# The user will provide the volume mount at runtime.
# No VOLUME instruction is needed for bind mounts.

EXPOSE 7000
CMD [ "npm", "start" ]
