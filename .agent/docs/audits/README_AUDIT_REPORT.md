# README.md 文档审计报告

> 审计日期: 2026-03-07  
> 审计范围: README.md、docker-compose.yml、项目实际功能

---

## 📋 一、审计结论

**⚠️ README.md 与项目实际功能存在多处不一致，需要更新。**

| 问题类型 | 数量 | 严重程度 |
|----------|------|----------|
| 配置不一致 | 2 | 高 |
| 功能遗漏 | 8 | 中 |
| 配置遗漏 | 4 | 低 |

---

## 🔍 二、详细问题清单

### 2.1 配置不一致（高优先级）

#### 问题 1：端口映射不一致

**README.md（第 29-30 行）：**
```yaml
ports:
  - "3000:3000"
```

**docker-compose.yml（第 8 行）：**
```yaml
ports:
  - "3000:3001"
```

**实际行为：**
- `server.js` 监听 `process.env.PORT || 3001`
- `runner.js`（Supervisor）监听 `EXTERNAL_PORT = 3001`
- 容器对外暴露 3001，映射到宿主机 3000

**修正建议：** README.md 应改为 `3000:3001`，并说明端口映射关系。

---

#### 问题 2：服务名称不一致

**README.md：**
```yaml
services:
  luvia:
```

**docker-compose.yml：**
```yaml
services:
  lumina-gallery:
```

**修正建议：** 统一使用 `luvia` 作为服务名。

---

### 2.2 功能遗漏（中优先级）

README.md 未提及以下已实现的核心功能：

| 功能 | 代码位置 | 说明 |
|------|----------|------|
| **用户认证系统** | server.js:239-260 | 多用户登录/登出，JWT 认证 |
| **收藏功能** | database.js:580-687 | 文件/文件夹收藏 |
| **音频播放** | mobile/components/MediaViewer.tsx:171 | 支持 MP3/FLAC/WAV 等格式 |
| **壁纸服务** | server.js:263-300 | 为 Wallpaper Engine 提供动态壁纸 |
| **多用户管理** | App.tsx + SettingsModal | 管理员可创建/编辑/删除用户 |
| **权限控制** | server.js:325-362 | 用户级别路径访问限制 |
| **热更新** | runner.js + scripts/update.sh | Git 拉取 + 自动重部署 |
| **多库路径** | server.js:17-20 | MEDIA_ROOT 支持分号分隔多路径 |

---

### 2.3 配置遗漏（低优先级）

docker-compose.yml 包含以下 README.md 未说明的配置：

| 配置项 | 说明 |
|--------|------|
| `ssh:/tmp/ssh_mount:ro` | SSH 密钥挂载，用于私有仓库热更新 |
| `NVIDIA_VISIBLE_DEVICES=all` | GPU 加速支持 |
| `NVIDIA_DRIVER_CAPABILITIES` | CUDA/NVENC 功能 |
| `privileged: true` | 特权模式（GPU 访问需要） |
| `UPDATE_TOKEN` | 热更新 API 安全令牌 |

---

## 🛠 三、建议的 README.md 更新

### 修正后的 Docker Compose 示例

```yaml
services:
  luvia:
    image: promenarleng/luvia-gallery:latest
    container_name: luvia-gallery
    restart: unless-stopped
    ports:
      - "3000:3001"  # 宿主机:容器端口
    volumes:
      # 媒体库映射（支持多个，用分号分隔）
      - /your/media/path:/media:ro
      # - /another/media:/mnt/ext:ro
      
      # 持久化配置
      - ./data:/app/data
      
      # 缩略图缓存
      - ./cache:/app/cache
      
      # SSH 密钥（可选，用于热更新）
      # - ./ssh:/tmp/ssh_mount:ro
    environment:
      - NODE_ENV=production
      # 多媒体库路径（分号分隔）
      - MEDIA_ROOT=/media
      # 热更新安全令牌（可选）
      # - UPDATE_TOKEN=your_secret_token
      # GPU 加速（NVIDIA）
      - NVIDIA_VISIBLE_DEVICES=all
      - NVIDIA_DRIVER_CAPABILITIES=compute,video,utility
```

### 建议新增的功能说明

```markdown
## ✨ 功能特性

- 🔐 **用户认证**: 多用户支持，JWT 安全认证
- ⭐ **收藏功能**: 快速收藏文件和文件夹
- 🎵 **音频支持**: 支持 MP3、FLAC、WAV 等格式
- 🖼️ **壁纸服务**: 为 Wallpaper Engine 提供动态壁纸
- 👥 **权限管理**: 用户级别路径访问控制
- 🔄 **热更新**: Git 拉取自动重部署
- 📂 **多库支持**: 支持多个媒体库路径
- 🚀 **GPU 加速**: NVIDIA NVENC 视频转码
```

---

## 📝 四、docker-compose.yml 审计

### 发现的问题

| 问题 | 位置 | 说明 |
|------|------|------|
| 服务名称不一致 | 第 2 行 | `lumina-gallery` 应改为 `luvia` |
| 缺少 `:ro` 标记 | 第 12 行 | 建议媒体目录设为只读 |
| 缺少注释说明 | 多处 | 环境变量缺少中文说明 |

### 建议的 docker-compose.yml 更新

```yaml
services:
  luvia:
    image: promenarleng/luvia-gallery:latest
    container_name: luvia-gallery
    restart: unless-stopped
    ports:
      - "3000:3001"
    volumes:
      # 媒体库：支持多个目录映射
      - ./media:/media:ro  # 建议只读挂载
      # - /mnt/external:/mnt/ext:ro

      # 持久化配置和数据库
      - ./data:/app/data

      # 缩略图缓存
      - ./cache:/app/cache

      # SSH 密钥（用于私有仓库热更新）
      # - ./ssh:/tmp/ssh_mount:ro
    environment:
      - NODE_ENV=production
      # 多媒体库路径（分号分隔）
      - MEDIA_ROOT=/media
      # 热更新 API 安全令牌
      # - UPDATE_TOKEN=change_this_to_a_secret_string
      # GPU 加速配置
      - NVIDIA_VISIBLE_DEVICES=all
      - NVIDIA_DRIVER_CAPABILITIES=compute,video,utility
    # NVIDIA GPU 支持
    privileged: true
    runtime: nvidia
    deploy:
      resources:
        reservations:
          devices:
            - driver: nvidia
              count: all
              capabilities: [gpu]
```

---

## ✅ 五、修复优先级

| 优先级 | 问题 | 修复文件 |
|--------|------|----------|
| **P0** | 端口映射错误 | README.md |
| **P1** | 服务名称不一致 | docker-compose.yml |
| **P1** | 缺少核心功能说明 | README.md |
| **P2** | 缺少配置说明 | README.md |
| **P2** | 媒体目录应设为只读 | docker-compose.yml |

---

## 📊 六、总结

README.md 作为项目的主要入口文档，目前缺少以下关键信息：

1. **端口映射说明**：`3000:3001` 而非 `3000:3000`
2. **核心功能列表**：用户认证、收藏、音频、壁纸等
3. **环境变量说明**：`MEDIA_ROOT`、`UPDATE_TOKEN` 等
4. **GPU 加速配置**：NVIDIA 相关设置

建议尽快更新 README.md，确保用户能够正确部署和使用项目。
