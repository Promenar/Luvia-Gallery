#!/bin/sh

echo "[Update] Starting update process..."

# Get dynamic config from environment (injected by runner.js)
REPO_URL=${REPO_URL:-"git@github.com:NarcisWL/Luvia-Gallery.git"}
BRANCH=${BRANCH:-"main"}

echo "[Update] Tracking Address: $REPO_URL"
echo "[Update] Tracking Branch: $BRANCH"

# --- 0. Setup SSH (Fix Permissions for Windows Mounts) ---
echo "[Update] Setting up Secure SSH..."
mkdir -p /root/.ssh
chmod 700 /root/.ssh

# Copy keys from temporary mount point (configured in docker-compose)
if [ -d "/tmp/ssh_mount" ]; then
    echo "[Update] Importing keys from /tmp/ssh_mount..."
    # Copy all files from mount to .ssh dir
    cp -rf /tmp/ssh_mount/* /root/.ssh/
fi

# FIX: Set strict permissions (Critical for OpenSSH)
# Docker bind mounts from Windows are often 777, causing "Bad owner/permissions" errors.
chmod 600 /root/.ssh/*
# config needs to be readable but strict is better. 600 is fine.
if [ -f "/root/.ssh/config" ]; then
    chmod 600 /root/.ssh/config
fi

# Auto-add GitHub to known_hosts to prevent interactive prompt hang
if [ ! -f "/root/.ssh/known_hosts" ]; then
    echo "[Update] Scanning GitHub host key..."
    ssh-keyscan github.com >> /root/.ssh/known_hosts
fi

# DEBUG: Check what keys we actually have
echo "[Update Debug] /root/.ssh contents:"
ls -la /root/.ssh

# DEBUG: Test Connection to GitHub
echo "[Update Debug] Testing SSH connection..."
ssh -T git@github.com
# Note: ssh -T returns 1 on success (because it disallows shell access), so we don't exit on error here.

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
# Ensure we are on the right branch/remote
git fetch origin "$BRANCH"
if [ $? -ne 0 ]; then
    echo "[Update] Git fetch failed! Check SSH keys."
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

# 4. Cleanup (Optional)
# Prune dev dependencies to save space after build
# echo "[Update] Pruning dev dependencies..."
# npm prune --production

echo "[Update] Success!"
exit 0
