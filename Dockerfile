# Build Stage
FROM node:20-bookworm as builder

WORKDIR /app

# Copy package definition
COPY package*.json ./

# Set NPM mirror for faster install
RUN npm config set registry https://registry.npmmirror.com/

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build the frontend (Vite)
RUN npm run build

# Production Stage: Switch to NVIDIA CUDA Base for guaranteed driver compatibility
# Using runtime-ubuntu22.04 matches verified working environment logic
FROM nvidia/cuda:12.4.1-runtime-ubuntu22.04

WORKDIR /app

# Prevent interactive prompts during apt install
ENV DEBIAN_FRONTEND=noninteractive

# 1. Install Utilities and Node.js 20 Setup
RUN apt-get update && apt-get install -y \
    curl \
    gnupg \
    ca-certificates \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" | tee /etc/apt/sources.list.d/nodesource.list

# 2. Install Node.js, FFmpeg, and other runtime Deps
RUN apt-get update && apt-get install -y \
    nodejs \
    ffmpeg \
    git \
    openssh-client \
    procps \
    && rm -rf /var/lib/apt/lists/*

# Copy package definition for production install
COPY package*.json ./
RUN npm config set registry https://registry.npmmirror.com/
RUN npm install --production

# Copy built frontend assets
COPY --from=builder /app/dist ./dist

# Copy server scripts
COPY --from=builder /app/server.js ./server.js
COPY --from=builder /app/database.js ./database.js

# Copy Runner & Scripts
COPY --from=builder /app/runner.js ./runner.js
COPY --from=builder /app/scripts ./scripts
# Ensure shell scripts are executable and have LF endings
RUN sed -i 's/\r$//' ./scripts/*.sh && chmod +x ./scripts/*.sh

ENV NODE_ENV=production
# Force NVIDIA driver capabilities env vars (redundant but safe)
ENV NVIDIA_DRIVER_CAPABILITIES=compute,video,utility
ENV NVIDIA_VISIBLE_DEVICES=all

EXPOSE 3001

CMD ["node", "runner.js"]
