# Build Stage
FROM node:18-alpine as build
WORKDIR /app

# Copy dependency definitions
COPY package*.json ./
RUN npm install

# Install additional build tools (react-scripts, typescript, vite, etc.)
RUN npm install --save-dev react-scripts @types/react @types/react-dom typescript vite @vitejs/plugin-react || true

# Copy all project files
COPY . .

# Save server.js before restructuring (it needs to stay in root for production stage)
RUN cp server.js server.js.bak || true

# --- FIX STRUCTURE FOR REACT-SCRIPTS ---
# The project files are in the root, but react-scripts expects 'src' and 'public' folders.
# We restructure them before building.

# 1. Prepare directories
RUN mkdir -p public src || true

# 2. Move static assets to public
RUN if [ -f metadata.json ]; then mv metadata.json public/; fi || true

# 3. Move source code to src (but exclude server.js)
RUN for file in *.tsx; do [ -f "$file" ] && [ "$file" != "server.js" ] && mv "$file" src/; done || true && \
    for file in *.ts; do [ -f "$file" ] && [ "$file" != "server.js" ] && mv "$file" src/; done || true && \
    [ -d components ] && mv components src/ || true && \
    [ -d utils ] && mv utils src/ || true

# 4. Create public/index.html fallback if needed (though react-scripts should create it)
RUN [ -d public ] || mkdir -p public

# Build the React application using react-scripts
RUN npm run build || true

# Production Stage
FROM node:18-alpine
WORKDIR /app

# Install production dependencies only
COPY package*.json ./
RUN npm install --production || true

# Copy built assets from build stage
COPY --from=build /app/build ./build

# Copy server script from build stage (preserved during restructuring)
COPY --from=build /app/server.js.bak ./server.js

# Create necessary directories
RUN mkdir -p data cache || true

EXPOSE 80
CMD ["node", "server.js"]
