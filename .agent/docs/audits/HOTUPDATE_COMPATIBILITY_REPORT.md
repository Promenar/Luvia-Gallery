# 热更新兼容性分析报告

> 分析日期: 2026-03-07  
> 分析范围: runner.js 热更新流程 + better-sqlite3 编译需求

---

## 📋 一、结论摘要

**⚠️ 当前 FTS5 方案与热更新流程存在兼容性问题**

| 问题 | 风险等级 | 影响 |
|------|----------|------|
| 生产镜像缺少编译工具 | **高** | `npm install` 会失败 |
| 热更新会触发重新安装 | **高** | better-sqlite3 编译失败 |

---

## 🔍 二、热更新流程分析

### 2.1 当前热更新流程

```
runner.js (Supervisor)
    │
    ├── 监听 /api/admin/system/update (POST)
    │
    └── 调用 scripts/update.sh
            │
            ├── git fetch + git reset --hard
            │
            ├── npm install --include=dev  ← ⚠️ 关键步骤
            │
            └── npm run build
```

### 2.2 问题定位

**update.sh 第 94 行：**
```bash
npm install --include=dev
```

**问题：** 
- `better-sqlite3` 是原生 C++ 模块，需要编译
- 当前生产镜像（Stage 3）缺少编译工具：
  ```dockerfile
  FROM nvidia/cuda:12.4.1-base-ubuntu22.04
  # 只安装了 nodejs, ffmpeg, git, openssh-client, procps
  # 缺少: python3, make, g++
  ```

**结果：** 热更新时 `npm install` 会因无法编译 `better-sqlite3` 而失败。

---

## 🛠 三、修正方案

### 方案 A：在最终镜像中添加编译工具（推荐）

**修改 Dockerfile：**

```dockerfile
# Stage 3: Final Image
FROM nvidia/cuda:12.4.1-base-ubuntu22.04

WORKDIR /app
ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production

# 添加编译工具（支持 better-sqlite3 热更新编译）
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gnupg \
    python3 \      # ← 新增
    make \         # ← 新增
    g++ \          # ← 新增
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
```

**优点：**
- ✅ 热更新可以正常编译原生模块
- ✅ 支持 better-sqlite3 版本更新
- ✅ 改动最小

**缺点：**
- ⚠️ 镜像体积增加约 50-100MB

---

### 方案 B：预编译 + 热更新跳过原生模块

**修改 update.sh：**

```bash
# 2. Dependency Check & Install
echo "[Update] Installing dependencies (excluding native rebuild)..."
# 跳过原生模块的重新编译
npm install --include=dev --ignore-scripts
if [ $? -ne 0 ]; then
    echo "[Update] npm install failed!"
    exit 1
fi

# 仅当 package.json 中的 better-sqlite3 版本变化时才重新编译
# （通过检查 node_modules/better-sqlite3 是否存在判断）
if [ ! -d "node_modules/better-sqlite3" ]; then
    echo "[Update] Rebuilding native modules..."
    npm rebuild better-sqlite3
fi
```

**优点：**
- ✅ 不增加镜像体积
- ✅ 热更新更快

**缺点：**
- ❌ better-sqlite3 版本更新时需要重新构建镜像
- ❌ 逻辑复杂，容易出错

---

## 📊 四、推荐方案对比

| 维度 | 方案 A（添加编译工具） | 方案 B（跳过编译） |
|------|----------------------|-------------------|
| 热更新可靠性 | ✅ 高 | ⚠️ 中 |
| 镜像体积 | ⚠️ +50-100MB | ✅ 无变化 |
| 实现复杂度 | ✅ 简单 | ⚠️ 复杂 |
| 维护成本 | ✅ 低 | ⚠️ 高 |

**推荐：方案 A**

---

## 🔧 五、完整修正后的 Dockerfile

```dockerfile
# Stage 1: Build Frontend
FROM node:20-bookworm as builder
WORKDIR /app
COPY package*.json ./
RUN npm config set registry https://registry.npmmirror.com/ && npm install
COPY . .
RUN npm run build

# Stage 2: Production node_modules (with native compilation support)
FROM node:20-bookworm as prod-deps
WORKDIR /app
COPY package*.json ./

# 安装编译工具
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

RUN npm config set registry https://registry.npmmirror.com/ && npm install --production

# Stage 3: Final Image
FROM nvidia/cuda:12.4.1-base-ubuntu22.04

WORKDIR /app
ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production

# 安装运行时依赖 + 编译工具（支持热更新时重新编译原生模块）
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gnupg \
    python3 \
    make \
    g++ \
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
ENV NVIDIA_DRIVER_CAPABILITIES=compute,video,utility
ENV NVIDIA_VISIBLE_DEVICES=all

EXPOSE 3001
CMD ["node", "runner.js"]
```

---

## ⚠️ 六、热更新流程验证清单

更新后需验证：

- [ ] 热更新触发后 `npm install` 成功
- [ ] `better-sqlite3` 编译成功
- [ ] 服务正常重启
- [ ] 数据库连接正常
- [ ] FTS5 搜索功能正常

---

## 📝 七、总结

| 修正项 | 文件 | 改动 |
|--------|------|------|
| Dockerfile Stage 2 | Dockerfile | 添加 `python3 make g++` |
| Dockerfile Stage 3 | Dockerfile | 添加 `python3 make g++` |

**热更新流程无需修改**，只需确保镜像包含编译工具即可。
