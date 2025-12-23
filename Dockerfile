# Build Stage
FROM node:20-alpine as builder

WORKDIR /app

# Copy package definition
COPY package*.json ./

# Install dependencies (including devDependencies for Vite)
RUN npm install

# Copy source code
COPY . .

# Build the frontend (Vite)
RUN npm run build

# Production Stage
FROM node:20-alpine

WORKDIR /app

# Install ffmpeg and hardware acceleration drivers
# intel-media-driver: for Intel Broadwell+ (iHD)
# libva-intel-driver: for older Intel (i965)
# mesa-va-gallium: for AMD
RUN apk add --no-cache ffmpeg mesa-va-gallium intel-media-driver libva-intel-driver

# Install production dependencies only (for server.js)
COPY package*.json ./
RUN npm install --production

# Install Git & OpenSSH for Auto-Update Feature
RUN apk add --no-cache git openssh

# Copy built frontend assets
COPY --from=builder /app/dist ./dist

# Copy server scripts
COPY --from=builder /app/server.js ./server.js
COPY --from=builder /app/database.js ./database.js

# Copy Runner & Scripts
COPY --from=builder /app/runner.js ./runner.js
COPY --from=builder /app/scripts ./scripts

ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "runner.js"]
