#!/bin/sh

echo "[Update] Starting update process..."

# Get dynamic config from environment (injected by runner.js)
REPO_URL=${REPO_URL:-"git@github.com:NarcisWL/Luvia-Gallery.git"}
BRANCH=${BRANCH:-"main"}
GH_TOKEN=${GH_TOKEN:-""}

echo "[Update] Tracking Address: $REPO_URL"
echo "[Update] Tracking Branch: $BRANCH"

# --- 0. Convert SSH URL to HTTPS and setup credentials ---
echo "[Update] Setting up Git credentials..."

# Convert SSH URL (git@github.com:owner/repo.git) to HTTPS URL
# Public repos don't need authentication over HTTPS
if echo "$REPO_URL" | grep -q "^git@github.com:"; then
    HTTPS_URL=$(echo "$REPO_URL" | sed 's/git@github.com:/https:\/\/github.com\//')
    echo "[Update] Converted SSH URL to HTTPS: $HTTPS_URL"
    REPO_URL="$HTTPS_URL"
fi

# Configure git for HTTPS (no auth needed for public repos)
git config --global url."https://github.com/".insteadOf "git@github.com:"
echo "[Update] Git configured to use HTTPS for GitHub"

# ---------------------------------------------------------

# 0. Safety Check & Git Init
# If .git is missing (because Docker COPY excluded it or it wasn't there), we need to re-init
if [ ! -d ".git" ]; then
    echo "[Update] No .git directory found. Initializing..."
    git init
    # Configure git to trust the current directory
    git config --global --add safe.directory /app
    git remote add origin "$REPO_URL"
else
    # Ensure remote URL matches our current config
    echo "[Update] Synchronizing remote URL..."
    git remote set-url origin "$REPO_URL"
fi

echo "[Update] Configuring git safe directory..."
git config --global --add safe.directory /app

# 1. Pull latest code
echo "[Update] Fetching from origin/$BRANCH..."
git fetch origin "$BRANCH"
if [ $? -ne 0 ]; then
    echo "[Update] Git fetch failed!"
    exit 1
fi

echo "[Update] Resetting to origin/$BRANCH..."
git reset --hard "origin/$BRANCH"
if [ $? -ne 0 ]; then
    echo "[Update] Git reset failed!"
    exit 1
fi

# --- HOTFIX: Patch server.js for Supervisor compatibility ---
# Since remote repo might still have 'const port = 3001;', we must force it to use env var
# so it doesn't conflict with Runner (which binds 3001).
echo "[Update] Patching server.js for dynamic port..."
sed -i 's/const port = 3001;/const port = process.env.PORT || 3001;/g' server.js
# ------------------------------------------------------------

# 2. Dependency Check & Install
# Needed for vite build.
# NOTE: We must force --include=dev because NODE_ENV is production in Docker,
# which causes npm install to skip devDependencies (like vite).
echo "[Update] Installing dependencies (including dev)..."
npm install --include=dev
if [ $? -ne 0 ]; then
    echo "[Update] npm install failed!"
    exit 1
fi

# 3. Build Frontend
echo "[Update] Building frontend..."
npm run build
if [ $? -ne 0 ]; then
    echo "[Update] Build failed!"
    exit 1
fi

# 4. Run Database Migrations (if needed)
echo "[Update] Checking database migration status..."

# 4.1 Path normalization migration
if [ -f "scripts/normalize-paths.js" ]; then
    echo "[Update] Running path normalization migration..."
    node scripts/normalize-paths.js
    if [ $? -ne 0 ]; then
        echo "[Update] Path migration failed! Continuing with current state..."
        echo "[Update] Note: The app will attempt backward-compatible queries"
    else
        echo "[Update] Path migration completed successfully!"
    fi
else
    echo "[Update] Path migration script not found, skipping..."
fi

# 4.2 Timestamp fix migration (fixes millisecond timestamps in last_modified)
if [ -f "scripts/fix-timestamps.js" ]; then
    echo "[Update] Running timestamp fix migration..."
    node scripts/fix-timestamps.js
    if [ $? -ne 0 ]; then
        echo "[Update] Timestamp migration failed! Continuing with current state..."
    else
        echo "[Update] Timestamp migration completed successfully!"
    fi
else
    echo "[Update] Timestamp migration script not found, skipping..."
fi

# 5. Cleanup (Optional)
# Prune dev dependencies to save space after build
# echo "[Update] Pruning dev dependencies..."
# npm prune --production

echo "[Update] Success!"
exit 0
