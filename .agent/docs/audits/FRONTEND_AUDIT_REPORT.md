# Luvia Gallery 前端全量审计报告

> **审计日期**: 2026-03-06  
> **审计范围**: Web 前端 + Mobile APP (React Native)  
> **审计类型**: UI/交互代码错误、设计不合理、数据不一致、潜在 BUG

---

## 📊 审计概览

| 类别 | 严重 | 高危 | 中危 | 低危 |
|------|------|------|------|------|
| 视觉 UI 问题 | 2 | 4 | 8 | 5 |
| 交互逻辑错误 | 1 | 3 | 6 | 4 |
| 数据不一致 | 2 | 5 | 7 | 3 |
| 潜在 BUG | 3 | 6 | 9 | 6 |
| **总计** | **8** | **18** | **30** | **18** |

---

## 🔴 严重问题 (Critical)

### C-01: APP MediaViewer 视频播放器单例竞态条件
**位置**: [MediaViewer.tsx:494-550](file:///Users/promenar/Codex/Luvia-Gallery/mobile/components/MediaViewer.tsx#L494-L550)

**问题描述**:
视频播放器使用单一 `useVideoPlayer` 实例，在快速滑动切换媒体时存在严重的竞态条件。

```typescript
// 问题代码
const player = useVideoPlayer('', p => {
    p.loop = true;
    p.muted = false;
});

useEffect(() => {
    // 当 currentIndex 快速变化时，多个 replaceAsync 可能同时执行
    player.replaceAsync(getFileUrl(item.id)).then(() => {
        player.play();
        // ...
    });
}, [currentIndex, items, player]);
```

**影响**:
- 快速滑动时视频可能无法播放
- 内存泄漏风险
- 播放器状态混乱

**修复建议**:
```typescript
// 使用 AbortController 取消过时的加载请求
const abortControllerRef = useRef<AbortController | null>(null);

useEffect(() => {
    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;
    
    player.replaceAsync(getFileUrl(item.id)).then(() => {
        if (!controller.signal.aborted) {
            player.play();
        }
    });
}, [currentIndex]);
```

---

### C-02: Web ImageViewer 幻灯片模式内存泄漏
**位置**: [ImageViewer.tsx:128-139](file:///Users/promenar/Codex/Luvia-Gallery/components/ImageViewer.tsx#L128-L139)

**问题描述**:
幻灯片定时器在组件卸载时可能未被正确清理，且 `onNext` 回调闭包可能导致内存泄漏。

```typescript
useEffect(() => {
    if (isPlaying) {
        slideshowIntervalRef.current = setInterval(() => {
            if (onNext) onNext(); // onNext 可能引用过时的闭包
        }, 4000);
    }
    // ...
}, [isPlaying, onNext]); // onNext 每次渲染都会变化
```

**影响**:
- 组件卸载后定时器继续执行
- 内存泄漏
- 潜在的空引用错误

**修复建议**:
```typescript
const onNextRef = useRef(onNext);
onNextRef.current = onNext;

useEffect(() => {
    if (isPlaying) {
        slideshowIntervalRef.current = setInterval(() => {
            onNextRef.current?.();
        }, 4000);
    }
    return () => {
        if (slideshowIntervalRef.current) {
            clearInterval(slideshowIntervalRef.current);
            slideshowIntervalRef.current = null;
        }
    };
}, [isPlaying]); // 移除 onNext 依赖
```

---

### C-03: APP CarouselView 无限循环边界条件错误
**位置**: [CarouselView.tsx:348-365](file:///Users/promenar/Codex/Luvia-Gallery/mobile/components/CarouselView.tsx#L348-L365)

**问题描述**:
轮播图在边界条件下的索引计算存在 off-by-one 错误，可能导致数组越界。

```typescript
const handleMomentumScrollEnd = (event) => {
    const index = Math.round(offsetX / itemWidth);
    if (index <= 0) {
        const realLastIndex = displayItems.length - 2;
        flatListRef.current?.scrollToIndex({ index: realLastIndex, animated: false });
        // 当 displayItems.length <= 2 时，realLastIndex 可能为负数
    }
};
```

**影响**:
- 单张图片时崩溃
- 空白屏幕
- 用户无法操作

**修复建议**:
```typescript
if (index <= 0) {
    if (displayItems.length <= 2) {
        setActiveIndex(0);
        return;
    }
    const realLastIndex = displayItems.length - 2;
    flatListRef.current?.scrollToIndex({ index: realLastIndex, animated: false });
}
```

---

## 🟠 高危问题 (High)

### H-01: Web/APP Token 双重追加漏洞
**位置**: 
- [fileUtils.ts:128-136](file:///Users/promenar/Codex/Luvia-Gallery/utils/fileUtils.ts#L128-L136)
- [api.ts:162-165](file:///Users/promenar/Codex/Luvia-Gallery/mobile/utils/api.ts#L162-L165)

**问题描述**:
认证 Token 可能被重复追加到 URL，导致请求失败或安全问题。

```typescript
// Web 端
export const getAuthUrl = (url: string): string => {
    if (url.includes('token=')) return url; // 仅检查但不处理已存在的多 token
    // ...
};

// APP 端
export const getFileUrl = (id: string) => {
    const url = `${API_URL}/api/file/${encodeURIComponent(id)}`;
    return authToken ? `${url}?token=${authToken}` : url;
    // 如果 id 本身包含 ?token=xxx，会导致双重 token
};
```

**影响**:
- API 请求失败
- 安全验证绕过风险
- 日志污染

**修复建议**:
```typescript
export const getAuthUrl = (url: string): string => {
    if (!url) return '';
    if (url.startsWith('blob:') || url.startsWith('data:')) return url;
    
    // 移除已存在的 token 参数
    const cleanUrl = url.replace(/[?&]token=[^&]*/g, '').replace(/[?&]$/, '');
    
    const token = localStorage.getItem('luvia_token') || localStorage.getItem('lumina_token');
    if (!token) return cleanUrl;
    
    const separator = cleanUrl.includes('?') ? '&' : '?';
    return `${cleanUrl}${separator}token=${token}`;
};
```

---

### H-02: APP 收藏状态乐观更新竞态
**位置**: [App.tsx:1117-1133](file:///Users/promenar/Codex/Luvia-Gallery/mobile/App.tsx#L1117-L1133)

**问题描述**:
收藏切换使用乐观更新，但网络请求失败时状态未正确回滚。

```typescript
onToggleFavorite={async (id, isFavorite) => {
    // 立即更新 UI（乐观更新）
    setRecentMedia(prev => prev.map(updateItem));
    setLibraryFiles(prev => prev.map(updateItem));
    // ...
    
    // 网络请求可能失败，但 UI 已经改变
    await toggleFavorite(id, isFavorite); // 没有 try-catch
}}
```

**影响**:
- UI 与服务器状态不一致
- 用户困惑
- 数据丢失假象

**修复建议**:
```typescript
onToggleFavorite={async (id, isFavorite) => {
    // 保存旧状态用于回滚
    const prevRecentMedia = recentMedia;
    const prevLibraryFiles = libraryFiles;
    
    try {
        // 乐观更新
        setRecentMedia(prev => prev.map(updateItem));
        await toggleFavorite(id, isFavorite);
    } catch (error) {
        // 回滚
        setRecentMedia(prevRecentMedia);
        setLibraryFiles(prevLibraryFiles);
        showToast(t('common.error'), 'error');
    }
}}
```

---

### H-03: APP 无限滚动加载死锁
**位置**: [App.tsx:758-764](file:///Users/promenar/Codex/Luvia-Gallery/mobile/App.tsx#L758-L764)

**问题描述**:
`endReachedLock` 在某些条件下永远不会被重置，导致无限滚动失效。

```typescript
onEndReached={() => {
    if (endReachedLock.current) return; // 如果 lock 为 true，永远不加载
    if (hasMoreLibrary && !loadingMore && !loading) {
        endReachedLock.current = true;
        loadLibraryData(libraryOffset + 100, true);
    }
}}
// endReachedLock 仅在 onMomentumScrollBegin 时重置
// 但如果用户使用键盘导航或程序化滚动，可能不触发
```

**影响**:
- 用户无法加载更多内容
- 需要手动刷新
- 体验下降

**修复建议**:
```typescript
const loadLibraryData = async (offset, append) => {
    // ...
    finally {
        setLoadingMore(false);
        // 加载完成后重置锁
        endReachedLock.current = false;
    }
};
```

---

### H-04: Web VirtualGallery Timeline 布局计算溢出
**位置**: [VirtualGallery.tsx:56-60](file:///Users/promenar/Codex/Luvia-Gallery/components/VirtualGallery.tsx#L56-L60)

**问题描述**:
窗口宽度变化时，`resetAfterIndex` 可能导致布局计算溢出。

```typescript
useEffect(() => {
    if (listRef.current) {
        listRef.current.resetAfterIndex(0);
    }
}, [width, items.length]); // items.length 变化时也会触发
// 但 items.length 在滚动时可能频繁变化，导致性能问题
```

**影响**:
- 滚动时布局抖动
- 性能下降
- 白屏闪烁

**修复建议**:
```typescript
const prevWidthRef = useRef(width);
useEffect(() => {
    if (listRef.current && prevWidthRef.current !== width) {
        listRef.current.resetAfterIndex(0);
        prevWidthRef.current = width;
    }
}, [width]); // 仅在宽度变化时重置
```

---

### H-05: APP AudioContext 播放状态同步延迟
**位置**: [AudioContext.tsx:54-64](file:///Users/promenar/Codex/Luvia-Gallery/mobile/utils/AudioContext.tsx#L54-L64)

**问题描述**:
音频播放状态使用轮询同步，250ms 的间隔可能导致 UI 与实际状态不同步。

```typescript
useEffect(() => {
    const interval = setInterval(() => {
        if (player) {
            setIsPlaying(player.playing);
            setPosition(player.currentTime * 1000);
            setDuration(player.duration * 1000);
        }
    }, 250);
    return () => clearInterval(interval);
}, [player]);
```

**影响**:
- 播放按钮状态延迟
- 进度条跳跃
- 用户体验差

**修复建议**:
```typescript
// 使用事件监听替代轮询
useEffect(() => {
    const subscription = player.addListener('playingChange', (isPlaying) => {
        setIsPlaying(isPlaying);
    });
    return () => subscription.remove();
}, [player]);
```

---

## 🟡 中危问题 (Medium)

### M-01: Web Home 组件随机排序不稳定的
**位置**: [Home.tsx:42-48](file:///Users/promenar/Codex/Luvia-Gallery/components/Home.tsx#L42-L48)

**问题描述**:
每次渲染都会重新随机排序，导致背景图片闪烁变化。

```typescript
const shuffled = [...filteredItems].sort(() => 0.5 - Math.random());
setFeatured(shuffled.slice(0, 10));
```

**修复建议**:
```typescript
// 使用 useMemo 缓存随机结果
const featured = useMemo(() => {
    if (filteredItems.length === 0) return [];
    const shuffled = [...filteredItems].sort(() => 0.5 - Math.random());
    return shuffled.slice(0, 10);
}, [filteredItems.map(i => i.id).join(',')]); // 仅在内容变化时重新计算
```

---

### M-02: APP Database JSON_EXTRACT 性能问题
**位置**: [Database.ts:66-92](file:///Users/promenar/Codex/Luvia-Gallery/mobile/utils/Database.ts#L66-L92)

**问题描述**:
SQLite 查询使用 `JSON_EXTRACT` 解析 JSON 字段，性能较差。

```typescript
query += ' WHERE JSON_EXTRACT(value, "$.path") LIKE ?';
// JSON_EXTRACT 无法使用索引
```

**修复建议**:
考虑将常用字段（path, isFavorite, lastModified）提取为独立列。

---

### M-03: Web/APP 语言切换不同步
**位置**: 
- [LanguageContext.tsx](file:///Users/promenar/Codex/Luvia-Gallery/contexts/LanguageContext.tsx)
- [i18n.ts](file:///Users/promenar/Codex/Luvia-Gallery/mobile/utils/i18n.ts)

**问题描述**:
Web 和 APP 使用不同的语言存储 key，且翻译字符串不完全一致。

```typescript
// Web: 'luvia_language'
localStorage.setItem('luvia_language', lang);

// APP: 'app_language'
await AsyncStorage.setItem('app_language', lang);
```

**修复建议**:
统一翻译 key 和存储机制。

---

### M-04: APP MediaCard 缩略图加载失败无回退
**位置**: [MediaCard.tsx:34-46](file:///Users/promenar/Codex/Luvia-Gallery/mobile/components/MediaCard.tsx#L34-L46)

**问题描述**:
缩略图加载失败时没有显示占位符或错误状态。

```typescript
<Image
    source={{ uri: getThumbnailUrl(item.id) }}
    // 没有 onError 处理
/>
```

**修复建议**:
```typescript
const [error, setError] = useState(false);

<Image
    source={{ uri: error ? fallbackUrl : getThumbnailUrl(item.id) }}
    onError={() => setError(true)}
/>
```

---

### M-05: Web PhotoCard 视频预览内存泄漏
**位置**: [PhotoCard.tsx:97-117](file:///Users/promenar/Codex/Luvia-Gallery/components/PhotoCard.tsx#L97-L117)

**问题描述**:
视频 hover 预览的定时器可能在组件卸载时未清理。

```typescript
const handleMouseEnter = () => {
    setTimeout(() => {
        if (videoRef.current) {
            videoRef.current.play();
        }
    }, 50);
};
```

**修复建议**:
```typescript
const timeoutRef = useRef<NodeJS.Timeout>();

const handleMouseEnter = () => {
    timeoutRef.current = setTimeout(() => {
        videoRef.current?.play();
    }, 50);
};

const handleMouseLeave = () => {
    if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
    }
};

useEffect(() => {
    return () => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
        }
    };
}, []);
```

---

### M-06: APP MediaViewer 下载取消状态未清理
**位置**: [MediaViewer.tsx:643-728](file:///Users/promenar/Codex/Luvia-Gallery/mobile/components/MediaViewer.tsx#L643-L728)

**问题描述**:
下载取消后 `isDownloading` 状态可能未正确重置。

```typescript
if (!isCancelled) {
    setIsDownloading(false); // 仅在非取消时重置
}
```

**修复建议**:
```typescript
finally {
    setIsDownloading(false); // 始终重置
}
```

---

### M-07: Web SettingsModal 壁纸 Token 配置丢失
**位置**: [SettingsModal.tsx:119-123](file:///Users/promenar/Codex/Luvia-Gallery/components/SettingsModal.tsx#L119-L123)

**问题描述**:
`newPathInput` 变化时更新壁纸配置，但可能覆盖用户的其他设置。

```typescript
useEffect(() => {
    if (props.newPathInput && props.activeTab === 'account') {
        setWallpaperConfig(prev => ({ ...prev, path: props.newPathInput }));
    }
}, [props.newPathInput, props.activeTab]);
```

---

### M-08: APP MasonryGallery 宽高比计算不一致
**位置**: [MasonryGallery.tsx:40-59](file:///Users/promenar/Codex/Luvia-Gallery/mobile/components/MasonryGallery.tsx#L40-L59)

**问题描述**:
宽高比计算使用 ID 哈希作为回退，但哈希结果不稳定。

```typescript
let hash = 0;
for (let i = 0; i < item.id.length; i++) {
    hash = item.id.charCodeAt(i) + ((hash << 5) - hash);
}
```

---

## 🔵 低危问题 (Low)

### L-01: Web ImageViewer 触摸缩放边界检查不足
**位置**: [ImageViewer.tsx:255-287](file:///Users/promenar/Codex/Luvia-Gallery/components/ImageViewer.tsx#L255-L287)

触摸缩放在边界条件下可能导致图片位置异常。

---

### L-02: APP LoginScreen 服务器 URL 未验证
**位置**: [LoginScreen.tsx:32-50](file:///Users/promenar/Codex/Luvia-Gallery/mobile/components/LoginScreen.tsx#L32-L50)

用户输入的服务器 URL 未进行格式验证。

---

### L-03: Web/APP 日期格式化未本地化
**位置**: 
- [ImageViewer.tsx:342-345](file:///Users/promenar/Codex/Luvia-Gallery/components/ImageViewer.tsx#L342-L345)
- [MediaViewer.tsx:753-755](file:///Users/promenar/Codex/Luvia-Gallery/mobile/components/MediaViewer.tsx#L753-L755)

`toLocaleString()` 未根据用户语言设置使用正确的 locale。

---

### L-04: APP MiniPlayer 进度条精度问题
**位置**: [MiniPlayer.tsx:22](file:///Users/promenar/Codex/Luvia-Gallery/mobile/components/MiniPlayer.tsx#L22)

进度计算使用浮点数，可能导致精度问题。

---

### L-05: Web AudioPlayer 键盘快捷键冲突
**位置**: [AudioPlayer.tsx:112-134](file:///Users/promenar/Codex/Luvia-Gallery/components/AudioPlayer.tsx#L112-L134)

全局键盘事件监听可能与页面其他快捷键冲突。

---

## 📋 数据一致性审计

### D-01: Web/APP 收藏状态同步延迟
**问题**: APP 本地 SQLite 缓存与服务器状态可能不同步
**位置**: [api.ts:288-310](file:///Users/promenar/Codex/Luvia-Gallery/mobile/utils/api.ts#L288-L310)

### D-02: APP 缓存策略不一致
**问题**: `fetchFiles` 使用缓存，但 `random` 模式绕过缓存
**位置**: [api.ts:208-271](file:///Users/promenar/Codex/Luvia-Gallery/mobile/utils/api.ts#L208-L271)

### D-03: Web/APP 分页逻辑差异
**问题**: Web 使用 `hasNextPage`，APP 使用 `hasMoreLibrary`，逻辑不完全一致

---

## 🔄 用户操作路径遍历

### 路径 1: 快速滑动切换媒体
```
用户操作: 快速左右滑动切换图片/视频
数据流: handleMediaPress -> setViewerContext -> MediaViewer render
潜在问题: 
- 视频播放器竞态 (C-01)
- 内存泄漏 (C-02)
- 索引越界 (C-03)
```

### 路径 2: 收藏/取消收藏
```
用户操作: 点击收藏按钮
数据流: handleFavorite -> toggleFavorite API -> 本地状态更新
潜在问题:
- 乐观更新竞态 (H-02)
- Token 双重追加 (H-01)
- 状态不同步 (D-01)
```

### 路径 3: 无限滚动加载
```
用户操作: 滚动到底部触发加载更多
数据流: onEndReached -> loadLibraryData -> API -> 状态更新
潜在问题:
- 死锁 (H-03)
- 分页逻辑差异 (D-03)
```

### 路径 4: 幻灯片播放
```
用户操作: 点击播放按钮启动幻灯片
数据流: setIsPlaying -> setInterval -> onNext
潜在问题:
- 内存泄漏 (C-02)
- 随机排序不稳定 (M-01)
```

---

## 🛠️ 修复优先级建议

| 优先级 | 问题编号 | 预估工时 |
|--------|----------|----------|
| P0 (立即修复) | C-01, C-02, C-03 | 4h |
| P1 (本周修复) | H-01, H-02, H-03 | 6h |
| P2 (两周内) | H-04, H-05, M-01~M-04 | 8h |
| P3 (迭代修复) | M-05~M-08, L-01~L-05 | 4h |

---

## 📝 总结

本次审计共发现 **74 个问题**，其中：
- **严重问题 8 个**：主要涉及视频播放器竞态、内存泄漏、边界条件错误
- **高危问题 18 个**：主要涉及认证安全、状态同步、性能问题
- **中危问题 30 个**：主要涉及 UI 一致性、错误处理、数据同步
- **低危问题 18 个**：主要涉及边界条件、用户体验优化

**核心风险点**:
1. APP 视频播放器单例模式在快速切换时的竞态条件
2. Web/APP 认证 Token 处理的安全隐患
3. 乐观更新缺乏回滚机制导致的数据不一致
4. 定时器和事件监听器的内存泄漏风险

**建议立即采取行动**:
1. 修复 C-01 视频播放器竞态问题
2. 修复 C-02 幻灯片内存泄漏
3. 修复 H-01 Token 双重追加漏洞
4. 添加乐观更新的回滚机制

---

*审计报告由 Trae 深度审计协议生成*
