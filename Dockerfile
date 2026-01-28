# Stage 1: Build Frontend
FROM node:20-bookworm as builder
WORKDIR /app
COPY package*.json ./
RUN npm config set registry https://registry.npmmirror.com/ && npm install
COPY . .
RUN npm run build

# Stage 2: Production node_modules
FROM node:20-bookworm as prod-deps
WORKDIR /app
COPY package*.json ./
RUN npm config set registry https://registry.npmmirror.com/ && npm install --production

# Stage 3: Final Image (Extremely slimmed down)
# 'base' variant is only ~40MB compared to 'runtime' which is ~400MB+ (compressed)
FROM nvidia/cuda:12.4.1-base-ubuntu22.04

WORKDIR /app
ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production

# Combined installation & cleanup to keep layers slim
# We only install the bare minimum required for the app to run
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gnupg \
    && mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update && apt-get install -y --no-install-recommends \
    nodejs \
    ffmpeg \
    git \
    openssh-client \
    procps \
    && apt-get purge -y curl gnupg \
    && apt-get autoremove -y \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/* \
    && rm -rf /tmp/*

# Copy runtime artifacts
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server.js /app/database.js /app/runner.js ./
COPY --from=builder /app/scripts ./scripts
COPY package*.json ./

# Permissions and line endings
RUN sed -i 's/\r$//' ./scripts/*.sh && chmod +x ./scripts/*.sh

# NVIDIA Runtime Configuration
# 'video' is crucial for NVENC, 'compute' covers CUDA filters like scale_cuda
ENV NVIDIA_DRIVER_CAPABILITIES=compute,video,utility
ENV NVIDIA_VISIBLE_DEVICES=all

EXPOSE 3001
CMD ["node", "runner.js"]
