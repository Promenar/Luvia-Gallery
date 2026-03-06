# Luvia Gallery 前端审计问题修复方案

> **文档版本**: v1.0  
> **创建日期**: 2026-03-07  
> **执行者**: Gemini 3.1 Pro  
> **审计者**: Trae (GLM-5)  
> **关联审计报告**: [FRONTEND_AUDIT_REPORT.md](../audits/FRONTEND_AUDIT_REPORT.md)

---

## 📋 执行概览

本文档将审计发现的 74 个问题分为 4 个阶段进行修复，每个阶段完成后需通过验证测试方可进入下一阶段。

| 阶段 | 问题数量 | 预估工时 | 风险等级 |
|------|----------|----------|----------|
| Phase 1 (P0) | 3 个严重问题 | 4h | 🔴 高 |
| Phase 2 (P1) | 5 个高危问题 | 6h | 🟠 中高 |
| Phase 3 (P2) | 8 个中危问题 | 8h | 🟡 中 |
| Phase 4 (P3) | 5 个低危问题 | 4h | 🔵 低 |

---

## 🚀 Phase 1: 严重问题修复 (P0)

**执行顺序**: 必须按 C-01 → C-02 → C-03 顺序执行  
**验证要求**: 每个问题修复后必须通过验证测试

---

### C-01: APP MediaViewer 视频播放器单例竞态条件

**优先级**: 🔴 P0 - Critical  
**文件位置**: `mobile/components/MediaViewer.tsx`  
**问题行号**: 494-550

#### 问题分析

视频播放器使用单一 `useVideoPlayer` 实例，在快速滑动切换媒体时存在竞态条件：
- 多个 `replaceAsync` 调用同时执行
- 后一个请求可能先于前一个完成
- 播放器状态混乱

#### 修复步骤

**Step 1**: 添加 AbortController 引用

在 `MediaViewer` 组件顶部添加 ref：

```typescript
// 在第 461 行附近，添加新的 ref
const abortControllerRef = useRef<AbortController | null>(null);
const isMountedRef = useRef(true);
```

**Step 2**: 修改视频加载逻辑

找到 `useEffect` 中的视频加载代码（约 500-550 行），替换为：

```typescript
useEffect(() => {
    isMountedRef.current = true;
    
    if (items[currentIndex]) {
        const item = items[currentIndex];
        setIsFavorite(item.isFavorite || false);

        if (item.mediaType === 'video') {
            // 取消之前的加载请求
            abortControllerRef.current?.abort();
            const controller = new AbortController();
            abortControllerRef.current = controller;

            const updateBitrate = () => {
                try {
                    if (item.size && player && player.duration) {
                        const kbps = Math.round((item.size * 8) / (player.duration * 1024));
                        setBitrate(`${kbps} kbps`);
                    } else if (item.size) {
                        setBitrate('Calculating...');
                    }
                } catch (e) {
                    console.log('Update bitrate error (safe to ignore during transition):', e);
                }
            };

            player.replaceAsync(getFileUrl(item.id)).then(() => {
                // 检查是否已被取消或组件已卸载
                if (controller.signal.aborted || !isMountedRef.current) {
                    return;
                }
                player.play();
                setTimeout(() => {
                    if (!controller.signal.aborted && isMountedRef.current && !player.playing) {
                        player.play();
                    }
                }, 100);
                setTimeout(() => {
                    if (!controller.signal.aborted && isMountedRef.current) {
                        updateBitrate();
                    }
                }, 1000);
            }).catch(e => {
                if (!controller.signal.aborted) {
                    console.error('Video load error:', e);
                }
            });
            updateBitrate();
        } else {
            player.pause();
            setBitrate('--');
        }

        if (item.mediaType === 'image' || item.mediaType === 'video') {
            setExif(null);
            fetchExif(item.id).then((data: any) => {
                if (isMountedRef.current) {
                    if (data) setExif(data);
                }
            });
        } else {
            setExif(null);
        }
    }
    
    return () => {
        isMountedRef.current = false;
        abortControllerRef.current?.abort();
    };
}, [currentIndex, items, player]);
```

**Step 3**: 添加组件卸载清理

在组件顶部添加卸载清理：

```typescript
useEffect(() => {
    return () => {
        isMountedRef.current = false;
        abortControllerRef.current?.abort();
    };
}, []);
```

#### 验证方法

1. 打开 APP，进入媒体库
2. 快速左右滑动切换视频（至少 10 次）
3. 确认视频能正常播放，无黑屏或卡死
4. 检查控制台无竞态相关错误

---

### C-02: Web ImageViewer 幻灯片模式内存泄漏

**优先级**: 🔴 P0 - Critical  
**文件位置**: `components/ImageViewer.tsx`  
**问题行号**: 128-139

#### 问题分析

幻灯片定时器存在两个问题：
1. `onNext` 回调每次渲染都会变化，导致 useEffect 重新执行
2. 组件卸载时定时器可能未清理

#### 修复步骤

**Step 1**: 添加 ref 存储回调

在 `ImageViewer` 组件顶部（约第 28 行后）添加：

```typescript
// 使用 ref 存储回调，避免依赖变化
const onNextRef = useRef(onNext);
const onPrevRef = useRef(onPrev);
const onCloseRef = useRef(onClose);

// 同步更新 ref
useEffect(() => {
    onNextRef.current = onNext;
    onPrevRef.current = onPrev;
    onCloseRef.current = onClose;
}, [onNext, onPrev, onClose]);
```

**Step 2**: 修改幻灯片逻辑

替换原有的幻灯片 useEffect（约 128-139 行）：

```typescript
// Slideshow Logic
useEffect(() => {
    if (isPlaying) {
        slideshowIntervalRef.current = setInterval(() => {
            if (onNextRef.current) onNextRef.current();
        }, 4000);
    } else {
        if (slideshowIntervalRef.current) {
            clearInterval(slideshowIntervalRef.current);
            slideshowIntervalRef.current = null;
        }
    }
    return () => {
        if (slideshowIntervalRef.current) {
            clearInterval(slideshowIntervalRef.current);
            slideshowIntervalRef.current = null;
        }
    };
}, [isPlaying]); // 移除 onNext 依赖
```

**Step 3**: 修改键盘事件处理

替换键盘事件 useEffect（约 173-202 行）：

```typescript
// Handle keyboard navigation
useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
        if (!item) return;
        if (isRenaming) return;

        if (e.key === 'Escape') onCloseRef.current?.();
        if (transform.scale === 1) {
            if (e.key === 'ArrowRight') {
                setIsPlaying(false);
                onNextRef.current?.();
            }
            if (e.key === 'ArrowLeft') {
                setIsPlaying(false);
                onPrevRef.current?.();
            }
            if (e.key === ' ' || e.key === 'Spacebar') {
                e.preventDefault();
                if (item.mediaType === 'video' && videoRef.current) {
                    if (videoRef.current.paused) videoRef.current.play();
                    else videoRef.current.pause();
                } else {
                    setIsPlaying(prev => !prev);
                }
            }
        }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
}, [item, transform.scale, isRenaming]); // 移除 onClose, onNext, onPrev 依赖
```

#### 验证方法

1. 打开 Web 应用，进入图片查看器
2. 启动幻灯片模式
3. 等待 2-3 张图片自动切换
4. 按 ESC 关闭查看器
5. 打开浏览器开发者工具 → Memory → 检查无定时器残留
6. 重复打开/关闭查看器 5 次，确认无内存增长

---

### C-03: APP CarouselView 无限循环边界条件错误

**优先级**: 🔴 P0 - Critical  
**文件位置**: `mobile/components/CarouselView.tsx`  
**问题行号**: 348-365

#### 问题分析

轮播图边界条件处理存在 off-by-one 错误：
- 当 `displayItems.length <= 2` 时，`realLastIndex` 可能为负数
- 导致 `scrollToIndex` 调用失败

#### 修复步骤

**Step 1**: 修改 `handleMomentumScrollEnd` 函数

找到并替换 `handleMomentumScrollEnd` 函数（约 348-365 行）：

```typescript
const handleMomentumScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const offsetX = event.nativeEvent.contentOffset.x;
    const index = Math.round(offsetX / itemWidth);
    
    // 边界保护：单张或两张图片时不循环
    if (displayItems.length <= 2) {
        setActiveIndex(Math.max(0, Math.min(index, displayItems.length - 1)));
        return;
    }
    
    if (index <= 0) {
        const realLastIndex = displayItems.length - 2;
        flatListRef.current?.scrollToIndex({ index: realLastIndex, animated: false });
        setActiveIndex(realLastIndex);
    } else if (index >= displayItems.length - 1) {
        flatListRef.current?.scrollToIndex({ index: 1, animated: false });
        setActiveIndex(1);
    } else {
        setActiveIndex(index);
    }
};
```

**Step 2**: 修改 `processData` 函数

找到 `processData` 函数（约 292-307 行），添加边界保护：

```typescript
const processData = (data: MediaItem[]) => {
    if (!data || data.length === 0) return;

    if (data.length > 1) {
        const lastItem = data[data.length - 1];
        const firstItem = data[0];
        const extended = [lastItem, ...data, firstItem];
        setItems(data);
        setDisplayItems(extended);
        setActiveIndex(prev => (prev === 0 ? 1 : prev));
    } else {
        // 单张图片：不添加循环项
        setItems(data);
        setDisplayItems(data);
        setActiveIndex(0);
    }
};
```

**Step 3**: 修改 `scrollToNext` 函数

找到 `scrollToNext` 函数（约 332-346 行），添加边界检查：

```typescript
const scrollToNext = () => {
    if (displayItems.length <= 1) return; // 单张图片不滚动
    
    setFadeOutIndex(activeIndex);
    setTimeout(() => {
        const nextIndex = activeIndex + 1;
        
        // 边界保护
        if (nextIndex >= displayItems.length) {
            setFadeOutIndex(null);
            return;
        }
        
        if (flatListRef.current) {
            flatListRef.current.scrollToIndex({ index: nextIndex, animated: true });
            setFadeOutIndex(null);
        }
    }, 600);
};
```

#### 验证方法

1. **单张图片测试**：
   - 配置轮播图仅显示 1 张图片
   - 确认不崩溃，正常显示
   - 等待自动轮播时间，确认无错误

2. **两张图片测试**：
   - 配置轮播图显示 2 张图片
   - 手动滑动切换
   - 确认无崩溃，正常工作

3. **多张图片测试**：
   - 配置轮播图显示 5+ 张图片
   - 快速滑动到边界
   - 确认循环正常工作

---

## 🔶 Phase 2: 高危问题修复 (P1)

**执行顺序**: H-01 → H-02 → H-03 → H-04 → H-05  
**依赖关系**: H-01 必须先于 H-02 完成

---

### H-01: Web/APP Token 双重追加漏洞

**优先级**: 🟠 P1 - High  
**文件位置**: 
- Web: `utils/fileUtils.ts` (128-136 行)
- APP: `mobile/utils/api.ts` (162-165 行)

#### 问题分析

认证 Token 可能被重复追加到 URL：
- Web 端仅检查但不清理已存在的 token
- APP 端未处理 ID 中可能包含 token 参数的情况

#### 修复步骤

**Step 1**: 修复 Web 端 `getAuthUrl` 函数

替换 `utils/fileUtils.ts` 中的 `getAuthUrl` 函数：

```typescript
export const getAuthUrl = (url: string): string => {
    if (!url) return '';
    if (url.startsWith('blob:') || url.startsWith('data:')) return url;
    
    // 移除已存在的 token 参数（防止双重追加）
    const cleanUrl = url
        .replace(/[?&]token=[^&]*/g, '')
        .replace(/[?&]$/, '')
        .replace(/\?$/, '');
    
    const token = localStorage.getItem('luvia_token') || localStorage.getItem('lumina_token');
    if (!token) return cleanUrl;
    
    const separator = cleanUrl.includes('?') ? '&' : '?';
    return `${cleanUrl}${separator}token=${token}`;
};
```

**Step 2**: 修复 APP 端 `getFileUrl` 和 `getThumbnailUrl` 函数

替换 `mobile/utils/api.ts` 中的相关函数：

```typescript
export const getFileUrl = (id: string) => {
    // ID 应该是纯 base64，但做防御性处理
    const cleanId = id.split('?')[0]; // 移除可能的查询参数
    const url = `${API_URL}/api/file/${encodeURIComponent(cleanId)}`;
    return authToken ? `${url}?token=${authToken}` : url;
};

export const getThumbnailUrl = (id: string) => {
    const cleanId = id.split('?')[0];
    return `${API_URL}/api/thumb/${encodeURIComponent(cleanId)}${authToken ? `?token=${authToken}` : ''}`;
};
```

**Step 3**: 添加 Token 清理工具函数

在两端的工具文件中添加：

```typescript
// Web: utils/fileUtils.ts
// APP: mobile/utils/api.ts

export const cleanTokenFromUrl = (url: string): string => {
    return url
        .replace(/[?&]token=[^&]*/g, '')
        .replace(/[?&]$/, '')
        .replace(/\?$/, '');
};
```

#### 验证方法

1. 打开浏览器开发者工具 → Network 面板
2. 查看所有 API 请求
3. 确认每个请求 URL 中只有一个 `token` 参数
4. 测试场景：
   - 直接访问媒体文件
   - 刷新页面后访问
   - 切换用户后访问

---

### H-02: APP 收藏状态乐观更新竞态

**优先级**: 🟠 P1 - High  
**文件位置**: `mobile/App.tsx` (1117-1133 行)

#### 问题分析

收藏切换使用乐观更新，但网络请求失败时状态未回滚，导致 UI 与服务器不一致。

#### 修复步骤

**Step 1**: 创建状态快照函数

在 `MainScreen` 组件中添加：

```typescript
// 在组件顶部，约第 50 行后
const createFavoritesSnapshot = () => ({
    recentMedia: [...recentMedia],
    libraryFiles: [...libraryFiles],
    favoriteFiles: [...favoriteFiles],
    folderFiles: [...folderFiles]
});

const restoreFavoritesSnapshot = (snapshot: ReturnType<typeof createFavoritesSnapshot>) => {
    setRecentMedia(snapshot.recentMedia);
    setLibraryFiles(snapshot.libraryFiles);
    setFavoriteFiles(snapshot.favoriteFiles);
    setFolderFiles(snapshot.folderFiles);
};
```

**Step 2**: 修改 `onToggleFavorite` 回调

找到 `MediaViewer` 的 `onToggleFavorite` 属性（约 1117-1133 行），替换为：

```typescript
onToggleFavorite={async (id, isFavorite) => {
    // 创建状态快照用于回滚
    const snapshot = createFavoritesSnapshot();
    
    const updateItem = (item: MediaItem) => 
        item.id === id ? { ...item, isFavorite } : item;
    
    try {
        // 乐观更新 UI
        if (viewerContext) {
            setViewerContext(prev => 
                prev ? { ...prev, items: prev.items.map(updateItem) } : null
            );
        }
        setRecentMedia(prev => prev.map(updateItem));
        setLibraryFiles(prev => prev.map(updateItem));
        setFavoriteFiles(prev => {
            if (isFavorite) {
                return prev.map(updateItem);
            } else {
                return prev.filter(i => i.id !== id);
            }
        });
        setFolderFiles(prev => prev.map(updateItem));
        
        // 发送网络请求
        await toggleFavorite(id, isFavorite);
        
        // 成功提示
        showToast(
            isFavorite ? t('menu.add_favorite') : t('menu.remove_favorite'), 
            'success'
        );
    } catch (error) {
        // 网络失败，回滚状态
        restoreFavoritesSnapshot(snapshot);
        
        // 恢复 viewerContext
        if (viewerContext) {
            setViewerContext(prev => {
                if (!prev) return null;
                const restoredItems = prev.items.map(item => 
                    item.id === id ? { ...item, isFavorite: !isFavorite } : item
                );
                return { ...prev, items: restoredItems };
            });
        }
        
        showToast(t('common.error'), 'error');
        console.error('Toggle favorite failed:', error);
    }
}}
```

#### 验证方法

1. 打开 APP，进入媒体库
2. 点击收藏按钮
3. **模拟网络失败**：
   - 在开发者工具中设置为离线模式
   - 或临时修改 API 返回错误
4. 确认 UI 回滚到原始状态
5. 显示错误提示

---

### H-03: APP 无限滚动加载死锁

**优先级**: 🟠 P1 - High  
**文件位置**: `mobile/App.tsx` (758-764 行)

#### 问题分析

`endReachedLock` 在某些条件下永远不会被重置：
- 仅在 `onMomentumScrollBegin` 时重置
- 键盘导航或程序化滚动不会触发
- 加载失败时锁未释放

#### 修复步骤

**Step 1**: 修改加载函数，确保锁被释放

找到 `loadLibraryData` 函数（约 249-286 行），修改 finally 块：

```typescript
const loadLibraryData = async (offset: number, append = false, refresh = false) => {
    if (offset === 0 && !append) setLoading(true);
    else setLoadingMore(true);

    try {
        const limit = 100;
        const random = sortMode === 'random';
        const filesRes = await fetchFiles({ 
            offset, limit, excludeMediaType: 'audio', refresh, 
            sort: random ? undefined : sortMode, random 
        });
        const newFiles = filesRes.files || [];

        if (typeof filesRes.hasMore === 'boolean') {
            setHasMoreLibrary(filesRes.hasMore);
        } else if (!filesRes.fromCache && newFiles.length < limit) {
            setHasMoreLibrary(false);
        } else {
            setHasMoreLibrary(true);
        }

        if (append) {
            setLibraryFiles(prev => {
                const existingIds = new Set(prev.map(p => p.id));
                const uniqueNew = newFiles.filter((i: MediaItem) => !existingIds.has(i.id));
                return applySort([...prev, ...uniqueNew]);
            });
        } else {
            setLibraryFiles(applySort(newFiles));
        }
        setLibraryOffset(offset);

    } catch (e) { 
        handleApiError(e);
        // 加载失败时也要重置锁
        endReachedLock.current = false;
    } finally {
        setLoading(false);
        setLoadingMore(false);
        setRefreshing(false);
        // 无论成功失败，都重置锁
        endReachedLock.current = false;
    }
};
```

**Step 2**: 同样修改 `loadFavoritesData` 和 `loadFolderData`

在 `loadFavoritesData`（约 288-341 行）和 `loadFolderData`（约 343-389 行）的 finally 块中添加：

```typescript
finally {
    setLoading(false);
    setLoadingMore(false);
    setRefreshing(false);
    endReachedLock.current = false; // 添加此行
}
```

**Step 3**: 优化 `onEndReached` 逻辑

修改 `onEndReached` 回调（约 758-764 行）：

```typescript
onEndReached={() => {
    // 防抖：如果已经在加载中，直接返回
    if (loadingMore || loading) return;
    
    // 检查锁状态
    if (endReachedLock.current) return;
    
    if (hasMoreLibrary) {
        endReachedLock.current = true;
        loadLibraryData(libraryOffset + 100, true);
    }
}}
```

#### 验证方法

1. 打开 APP，进入媒体库
2. 滚动到底部触发加载
3. **测试场景**：
   - 正常加载更多
   - 网络失败后重试
   - 快速滚动到底部多次
4. 确认每次都能正常加载

---

### H-04: Web VirtualGallery Timeline 布局计算溢出

**优先级**: 🟠 P1 - High  
**文件位置**: `components/VirtualGallery.tsx` (56-60 行)

#### 问题分析

`resetAfterIndex` 在 `items.length` 变化时也会触发，导致滚动时布局抖动。

#### 修复步骤

**Step 1**: 添加宽度变化追踪

在 `InnerTimeline` 组件中添加 ref：

```typescript
const InnerTimeline: React.FC<{...}> = ({ width, height, items, ... }) => {
    const listRef = useRef<any>(null);
    const loadLockRef = useRef(false);
    const prevWidthRef = useRef(width); // 新增：追踪宽度变化
    const prevItemsLengthRef = useRef(items.length); // 新增：追踪项目数量变化
    
    // ...
};
```

**Step 2**: 修改 resetAfterIndex 触发条件

替换原有的 useEffect（约 56-60 行）：

```typescript
useEffect(() => {
    if (listRef.current) {
        // 仅在宽度变化时重置布局
        if (prevWidthRef.current !== width) {
            listRef.current.resetAfterIndex(0);
            prevWidthRef.current = width;
        }
        // 仅在项目数量显著变化时重置（避免滚动时的微小变化）
        const lengthDiff = Math.abs(items.length - prevItemsLengthRef.current);
        if (lengthDiff > 5) {
            listRef.current.resetAfterIndex(0);
            prevItemsLengthRef.current = items.length;
        }
    }
}, [width, items.length]);
```

#### 验证方法

1. 打开 Web 应用，进入时间线视图
2. 滚动浏览图片
3. 确认无布局抖动或白屏闪烁
4. 调整浏览器窗口大小
5. 确认布局正确重排

---

### H-05: APP AudioContext 播放状态同步延迟

**优先级**: 🟠 P1 - High  
**文件位置**: `mobile/utils/AudioContext.tsx` (54-64 行)

#### 问题分析

音频播放状态使用 250ms 轮询同步，导致 UI 延迟。

#### 修复步骤

**Step 1**: 添加事件监听替代轮询

替换原有的轮询 useEffect：

```typescript
// Status synchronization - 使用事件监听替代轮询
useEffect(() => {
    if (!player) return;

    // 尝试使用事件监听（如果 expo-audio 支持）
    const subscriptions: any[] = [];
    
    try {
        // 添加播放状态变化监听
        const playingSub = player.addListener('playingChange', (isPlaying: boolean) => {
            setIsPlaying(isPlaying);
        });
        subscriptions.push(playingSub);
        
        // 添加时间更新监听
        const timeSub = player.addListener('timeUpdate', (time: number) => {
            setPosition(time * 1000);
        });
        subscriptions.push(timeSub);
        
        // 添加时长变化监听
        const durationSub = player.addListener('durationChange', (dur: number) => {
            setDuration(dur * 1000);
        });
        subscriptions.push(durationSub);
    } catch (e) {
        // 如果事件监听不支持，回退到轮询（但提高频率）
        console.log('Audio events not supported, using polling fallback');
        const interval = setInterval(() => {
            if (player) {
                setIsPlaying(player.playing);
                setPosition(player.currentTime * 1000);
                setDuration(player.duration * 1000);
            }
        }, 100); // 提高到 100ms
        
        return () => clearInterval(interval);
    }

    return () => {
        subscriptions.forEach(sub => {
            try {
                sub.remove();
            } catch (e) {}
        });
    };
}, [player]);
```

**Step 2**: 添加即时状态同步

在 `togglePlayPause` 函数中添加即时更新：

```typescript
const togglePlayPause = async () => {
    if (player.playing) {
        player.pause();
        setIsPlaying(false); // 即时更新
    } else {
        player.play();
        setIsPlaying(true); // 即时更新
    }
};
```

#### 验证方法

1. 打开 APP，播放音频
2. 点击播放/暂停按钮
3. 确认按钮状态立即变化（无延迟）
4. 观察进度条是否平滑更新

---

## 🟡 Phase 3: 中危问题修复 (P2)

---

### M-01: Web Home 组件随机排序不稳定

**优先级**: 🟡 P2 - Medium  
**文件位置**: `components/Home.tsx` (42-48 行)

#### 修复步骤

替换原有的随机排序逻辑：

```typescript
// 使用 useMemo 缓存随机结果
const featured = useMemo(() => {
    if (filteredItems.length === 0) return [];
    
    // 使用基于内容的稳定随机种子
    const seed = filteredItems.reduce((acc, item) => {
        return acc + item.id.charCodeAt(0);
    }, 0);
    
    // Fisher-Yates 洗牌算法（带种子）
    const shuffled = [...filteredItems];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor((seed * (i + 1)) % (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    
    return shuffled.slice(0, 10);
}, [filteredItems.map(i => i.id).join(',')]); // 仅在内容变化时重新计算
```

---

### M-02: APP Database JSON_EXTRACT 性能问题

**优先级**: 🟡 P2 - Medium  
**文件位置**: `mobile/utils/Database.ts` (66-92 行)

#### 修复步骤

**Step 1**: 修改数据库 Schema

```typescript
// 在 initDatabase 中添加新列
db.execSync(`
    CREATE TABLE IF NOT EXISTS media_items (
        id TEXT PRIMARY KEY,
        value TEXT,
        path TEXT,           -- 新增：提取路径
        is_favorite INTEGER, -- 新增：收藏状态
        last_modified INTEGER -- 新增：修改时间
    );
`);

// 创建索引
db.execSync(`CREATE INDEX IF NOT EXISTS idx_path ON media_items(path)`);
db.execSync(`CREATE INDEX IF NOT EXISTS idx_is_favorite ON media_items(is_favorite)`);
db.execSync(`CREATE INDEX IF NOT EXISTS idx_last_modified ON media_items(last_modified DESC)`);
```

**Step 2**: 修改 `saveMediaItem` 函数

```typescript
export const saveMediaItem = (item: MediaItem) => {
    db.runSync(
        'INSERT OR REPLACE INTO media_items (id, value, path, is_favorite, last_modified) VALUES (?, ?, ?, ?, ?)',
        [
            item.id, 
            JSON.stringify(item),
            item.path || item.folderPath,
            item.isFavorite ? 1 : 0,
            item.lastModified || Date.now()
        ]
    );
};
```

**Step 3**: 修改 `getCachedFiles` 函数

```typescript
export const getCachedFiles = async ({ limit = 10, offset = 0, folderPath, favorite }: {...}): Promise<MediaItem[]> => {
    try {
        let query = 'SELECT value FROM media_items';
        let params: any[] = [];
        let where: string[] = [];

        if (folderPath) {
            where.push('path LIKE ?');
            params.push(`${folderPath}%`);
        }
        if (favorite !== undefined) {
            where.push('is_favorite = ?');
            params.push(favorite ? 1 : 0);
        }

        if (where.length > 0) {
            query += ' WHERE ' + where.join(' AND ');
        }
        query += ' ORDER BY last_modified DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        const rows = db.getAllSync(query, params);
        return rows.map((row: any) => JSON.parse(row.value));
    } catch (e) {
        return [];
    }
};
```

---

### M-03: Web/APP 语言切换不同步

**优先级**: 🟡 P2 - Medium  
**文件位置**: 
- Web: `contexts/LanguageContext.tsx`
- APP: `mobile/utils/i18n.ts`

#### 修复步骤

**Step 1**: 统一存储 Key

Web 端修改：

```typescript
// LanguageContext.tsx
const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem('luvia_language', lang);
    // 移除旧 key
    localStorage.removeItem('lumina_language');
};
```

APP 端修改：

```typescript
// i18n.ts
export const useLanguage = create<I18nState>((set, get) => ({
    language: 'zh',
    setLanguage: async (lang: Language) => {
        set({ language: lang });
        await AsyncStorage.setItem('luvia_language', lang); // 统一 key
    },
    // ...
}));

export const initLanguage = async () => {
    const stored = await AsyncStorage.getItem('luvia_language');
    if (stored === 'en' || stored === 'zh') {
        useLanguage.getState().setLanguage(stored as Language);
    }
};
```

**Step 2**: 同步翻译字符串

对比 Web 和 APP 的翻译字符串，确保一致性。建议创建共享的翻译文件。

---

### M-04: APP MediaCard 缩略图加载失败无回退

**优先级**: 🟡 P2 - Medium  
**文件位置**: `mobile/components/MediaCard.tsx` (34-46 行)

#### 修复步骤

```typescript
export const MediaCard = React.memo<MediaCardProps>(({ item, onPress, onLongPress, aspectRatio = 1 }) => {
    const [error, setError] = useState(false);
    const [retryCount, setRetryCount] = useState(0);

    const handleRetry = () => {
        setError(false);
        setRetryCount(prev => prev + 1);
    };

    return (
        <Pressable
            onPress={() => onPress(item)}
            onLongPress={() => onLongPress?.(item)}
            className="w-full"
        >
            <View
                className="rounded-lg overflow-hidden bg-transparent relative border border-gray-100/50 w-full"
                style={{ aspectRatio }}
            >
                {item.mediaType === 'audio' ? (
                    <View className="w-full h-full bg-indigo-500 items-center justify-center">
                        <Music size={24} color="white" />
                        <View className="absolute bottom-2 left-2 right-2">
                            <Text numberOfLines={1} className="text-white text-[10px] font-medium">{item.name}</Text>
                        </View>
                    </View>
                ) : error ? (
                    // 错误状态回退
                    <TouchableOpacity 
                        onPress={handleRetry}
                        className="w-full h-full bg-gray-200 dark:bg-zinc-800 items-center justify-center"
                    >
                        <ImageIcon size={32} color="#9ca3af" />
                        <Text className="text-gray-400 text-[10px] mt-1">Tap to retry</Text>
                    </TouchableOpacity>
                ) : (
                    <Image
                        source={{
                            uri: getThumbnailUrl(item.id),
                            headers: { Authorization: `Bearer ${getToken()}` }
                        }}
                        style={{ width: '100%', height: '100%' }}
                        contentFit="cover"
                        transition={100}
                        cachePolicy="memory-disk"
                        priority="normal"
                        recyclingKey={`${item.id}-${retryCount}`}
                        placeholderContentFit="cover"
                        onError={() => setError(true)}
                    />
                )}

                {/* ... 其余代码 ... */}
            </View>
        </Pressable>
    );
});
```

---

### M-05: Web PhotoCard 视频预览内存泄漏

**优先级**: 🟡 P2 - Medium  
**文件位置**: `components/PhotoCard.tsx` (97-117 行)

#### 修复步骤

```typescript
export const MediaCard: React.FC<MediaCardProps> = React.memo(({ item, onClick, layout, isVirtual }) => {
    const videoRef = useRef<HTMLVideoElement>(null);
    const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null); // 新增
    const [isPlaying, setIsPlaying] = useState(false);
    const [isHovered, setIsHovered] = useState(false);
    // ...

    const handleMouseEnter = () => {
        setIsHovered(true);
        if (item.mediaType === 'video') {
            // 使用 ref 存储定时器
            hoverTimeoutRef.current = setTimeout(() => {
                if (videoRef.current) {
                    videoRef.current.play().catch(() => { });
                    setIsPlaying(true);
                }
            }, 50);
        }
    };

    const handleMouseLeave = () => {
        setIsHovered(false);
        setIsVideoLoaded(false);
        
        // 清理定时器
        if (hoverTimeoutRef.current) {
            clearTimeout(hoverTimeoutRef.current);
            hoverTimeoutRef.current = null;
        }
        
        if (item.mediaType === 'video' && videoRef.current) {
            videoRef.current.pause();
            videoRef.current.currentTime = 0;
            setIsPlaying(false);
        }
    };

    // 组件卸载时清理
    useEffect(() => {
        return () => {
            if (hoverTimeoutRef.current) {
                clearTimeout(hoverTimeoutRef.current);
            }
        };
    }, []);

    // ... 其余代码
});
```

---

### M-06: APP MediaViewer 下载取消状态未清理

**优先级**: 🟡 P2 - Medium  
**文件位置**: `mobile/components/MediaViewer.tsx` (643-728 行)

#### 修复步骤

修改 `handleDownload` 函数的错误处理：

```typescript
const handleDownload = async () => {
    if (isDownloading) return;

    try {
        // ... 权限请求代码 ...

        setIsDownloading(true);

        // ... 下载代码 ...

    } catch (e: any) {
        const errorMsg = e.message?.toLowerCase() || '';
        const isCancelled = errorMsg.includes('cancel') || errorMsg.includes('cancelled');

        if (!isCancelled) {
            console.error('Download error:', e);
            showToast(t('common.download_failed'), 'error');
        }
    } finally {
        // 始终重置状态
        setIsDownloading(false);
        hideToast();
    }
};
```

---

### M-07: Web SettingsModal 壁纸 Token 配置丢失

**优先级**: 🟡 P2 - Medium  
**文件位置**: `components/SettingsModal.tsx` (119-123 行)

#### 修复步骤

修改 useEffect：

```typescript
useEffect(() => {
    // 仅在明确是壁纸路径选择时更新
    if (props.newPathInput && props.activeTab === 'account' && props.dirPickerContext === 'wallpaper') {
        setWallpaperConfig(prev => ({ ...prev, path: props.newPathInput }));
    }
}, [props.newPathInput, props.activeTab, props.dirPickerContext]); // 添加上下文检查
```

---

### M-08: APP MasonryGallery 宽高比计算不一致

**优先级**: 🟡 P2 - Medium  
**文件位置**: `mobile/components/MasonryGallery.tsx` (40-59 行)

#### 修复步骤

使用稳定的哈希算法：

```typescript
const getAspectRatio = (item: MediaItem): number => {
    if (item.aspectRatio && item.aspectRatio > 0) {
        return item.aspectRatio;
    }

    if (item.width && item.height && item.height > 0) {
        return item.width / item.height;
    }

    // 使用稳定的字符串哈希
    const hashString = (str: string): number => {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            const char = str.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32bit integer
        }
        return Math.abs(hash);
    };

    const hash = hashString(item.id);
    const min = 0.75;
    const max = 1.35;
    return min + (hash % 100) / 100 * (max - min);
};
```

---

## 🔵 Phase 4: 低危问题修复 (P3)

---

### L-01: Web ImageViewer 触摸缩放边界检查

**优先级**: 🔵 P3 - Low  
**文件位置**: `components/ImageViewer.tsx` (255-287 行)

#### 修复步骤

在 `handleTouchMove` 中添加边界检查：

```typescript
const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && lastDist.current !== null) {
        const dist = Math.hypot(
            e.touches[0].clientX - e.touches[1].clientX,
            e.touches[0].clientY - e.touches[1].clientY
        );
        const delta = dist - lastDist.current;
        const sensitivity = 0.01;
        const newScale = Math.min(Math.max(1, transform.scale + delta * sensitivity), 5);

        setTransform(prev => ({
            ...prev,
            scale: newScale,
            x: newScale === 1 ? 0 : Math.max(-500, Math.min(500, prev.x)),
            y: newScale === 1 ? 0 : Math.max(-500, Math.min(500, prev.y))
        }));
        lastDist.current = dist;
    }
};
```

---

### L-02: APP LoginScreen 服务器 URL 验证

**优先级**: 🔵 P3 - Low  
**文件位置**: `mobile/components/LoginScreen.tsx` (32-50 行)

#### 修复步骤

添加 URL 验证：

```typescript
const validateUrl = (url: string): boolean => {
    try {
        const parsed = new URL(url);
        return ['http:', 'https:'].includes(parsed.protocol);
    } catch {
        return false;
    }
};

const handleLogin = async () => {
    if (!username || !password) {
        showToast(t('login.error_missing'), 'error');
        return;
    }

    if (!validateUrl(serverUrl)) {
        showToast('Invalid server URL', 'error');
        return;
    }

    setLoading(true);
    // ... 其余代码
};
```

---

### L-03: Web/APP 日期格式化本地化

**优先级**: 🔵 P3 - Low  
**文件位置**: 多处

#### 修复步骤

创建统一的日期格式化工具：

```typescript
// Web: utils/formatters.ts
// APP: mobile/utils/formatters.ts

import { useLanguage } from './LanguageContext'; // 或 i18n

export const formatDate = (ts: number | Date | undefined, language: 'en' | 'zh'): string => {
    if (!ts) return '-';
    const locale = language === 'zh' ? 'zh-CN' : 'en-US';
    return new Date(ts).toLocaleString(locale, {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
    });
};

export const formatSize = (bytes: number, language: 'en' | 'zh'): string => {
    const mb = bytes / 1024 / 1024;
    return mb < 1 
        ? `${(bytes / 1024).toFixed(1)} KB` 
        : `${mb.toFixed(1)} MB`;
};
```

---

### L-04: APP MiniPlayer 进度条精度

**优先级**: 🔵 P3 - Low  
**文件位置**: `mobile/components/MiniPlayer.tsx` (22 行)

#### 修复步骤

```typescript
const progress = duration > 0 ? Math.min(1, Math.max(0, position / duration)) : 0;

// 使用整数百分比避免浮点精度问题
<View style={{ width: `${Math.round(progress * 100)}%` }} className="h-full bg-indigo-500/50" />
```

---

### L-05: Web AudioPlayer 键盘快捷键冲突

**优先级**: 🔵 P3 - Low  
**文件位置**: `components/AudioPlayer.tsx` (112-134 行)

#### 修复步骤

添加焦点检查：

```typescript
useEffect(() => {
    const handleKeyPress = (e: KeyboardEvent) => {
        // 仅在音频播放器有焦点或无其他输入焦点时响应
        const activeElement = document.activeElement;
        if (activeElement?.tagName === 'INPUT' || activeElement?.tagName === 'TEXTAREA') {
            return;
        }

        if (!isMinimized) {
            if (e.code === 'Space') {
                e.preventDefault();
                togglePlayPause();
            }
            // ... 其余快捷键
        }
    };

    window.addEventListener('keydown', handleKeyPress);
    return () => window.removeEventListener('keydown', handleKeyPress);
}, [isMinimized, isPlaying, duration]);
```

---

## ✅ 验证测试方案

### Phase 1 验证清单

```markdown
## C-01 验证
- [ ] 快速滑动切换视频 10 次无崩溃
- [ ] 视频能正常播放
- [ ] 控制台无竞态错误

## C-02 验证
- [ ] 幻灯片模式正常切换
- [ ] 关闭查看器后无定时器残留
- [ ] 内存使用稳定

## C-03 验证
- [ ] 单张图片轮播正常
- [ ] 两张图片轮播正常
- [ ] 多张图片循环正常
```

### Phase 2 验证清单

```markdown
## H-01 验证
- [ ] 所有 API 请求只有一个 token 参数
- [ ] 刷新页面后请求正常

## H-02 验证
- [ ] 收藏功能正常
- [ ] 网络失败时 UI 回滚
- [ ] 显示错误提示

## H-03 验证
- [ ] 无限滚动正常加载
- [ ] 网络失败后能重试
- [ ] 无死锁现象
```

### 回归测试

完成所有修复后，执行以下回归测试：

1. **Web 端**：
   - 登录/登出
   - 浏览媒体库
   - 查看图片/视频
   - 收藏/取消收藏
   - 幻灯片模式
   - 文件夹导航

2. **APP 端**：
   - 登录/登出
   - 轮播图浏览
   - 媒体库滚动加载
   - 媒体查看器
   - 收藏功能
   - 音频播放

---

## 📝 执行注意事项

### 给 Gemini 3.1 Pro 的执行指南

1. **按阶段执行**：必须完成 Phase 1 并通过验证后，才能进入 Phase 2
2. **代码风格**：遵循项目现有的代码风格和命名规范
3. **类型安全**：确保 TypeScript 类型正确
4. **注释**：在关键修改处添加注释说明修复的问题编号
5. **测试**：每个问题修复后进行基本功能测试

### 修复完成后的交接

修复完成后，请更新 `.agent/memory/SESSION_HANDOVER.md`：

```markdown
## 修复完成状态

### Phase 1 (P0)
- [x] C-01: 视频播放器竞态 - 已修复
- [x] C-02: 幻灯片内存泄漏 - 已修复
- [x] C-03: 轮播边界条件 - 已修复

### Phase 2 (P1)
- [x] H-01: Token 双重追加 - 已修复
- [x] H-02: 收藏状态竞态 - 已修复
- [x] H-03: 无限滚动死锁 - 已修复
- [x] H-04: Timeline 布局溢出 - 已修复
- [x] H-05: 音频状态同步 - 已修复

### Phase 3 (P2)
- [x] M-01 ~ M-08 - 已修复

### Phase 4 (P3)
- [x] L-01 ~ L-05 - 已修复

## 待 Trae 审计
请 Trae 对以上修复进行代码审计，确认修复正确且无引入新问题。
```

---

*修复方案文档由 Trae 生成，供 Gemini 3.1 Pro 执行*
