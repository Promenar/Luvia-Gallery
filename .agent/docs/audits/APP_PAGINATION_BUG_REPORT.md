# APP 端图库分页无限加载 BUG 分析报告

> 分析日期: 2026-03-07  
> 分析范围: mobile/App.tsx 分页逻辑

---

## 📋 一、BUG 描述

**现象：** 向上滑动到初批加载的媒体文件底部时，触发后续分页加载会陷入无限疯狂加载中。

**预期行为：** 只加载一批，等待这一批快浏览结束触底时再自动加载下一批。

---

## 🔍 二、根因分析

### 问题 1：`onEndReachedThreshold` 设置过大

**代码位置：** [App.tsx:837](file:///Users/promenar/Codex/Luvia-Gallery/mobile/App.tsx#L837)

```javascript
onEndReachedThreshold={2}  // ❌ 问题：距离底部 2 个屏幕高度就触发
```

**问题说明：**
- FlashList 的 `onEndReachedThreshold` 表示距离列表底部多少个**屏幕高度**时触发
- 设置为 `2` 意味着用户滚动到距离底部 **2 个屏幕高度**时就会触发加载
- 这导致用户刚看到初批数据底部时，就已经触发了多次加载

### 问题 2：锁机制解锁时机错误

**代码位置：** [App.tsx:287](file:///Users/promenar/Codex/Luvia-Gallery/mobile/App.tsx#L287)

```javascript
const loadLibraryData = async (offset: number, append = false, refresh = false) => {
    // ...
    } finally {
      setLoading(false);
      setLoadingMore(false);
      setRefreshing(false);
      endReachedLock.current = false;  // ❌ 问题：在 finally 中解锁
    }
};
```

**问题说明：**
- `endReachedLock.current = true` 在加载开始时设置
- 但在 `finally` 块中解锁，此时请求可能还在进行中
- FlashList 的 `onEndReached` 可能在状态更新前被多次调用
- 虽然 `loadingMore` 状态检查存在，但 React 状态更新是异步的，可能在多次调用间未生效

### 问题 3：folders tab 完全缺少锁机制

**代码位置：** [App.tsx:1012-1016](file:///Users/promenar/Codex/Luvia-Gallery/mobile/App.tsx#L1012-L1016)

```javascript
onEndReached={() => {
    if (hasMoreFolderFiles && !loadingMore && !loading) {
      loadFolderData(currentPath, folderOffset + 50, true);  // ❌ 没有锁机制
    }
}}
```

**问题说明：**
- `folders` tab 的 FlashList 完全没有使用 `endReachedLock`
- 只有 `loadingMore` 和 `loading` 状态检查
- 在快速滚动时，`onEndReached` 会被多次调用

---

## 🛠 三、修复方案

### 修复 1：降低 `onEndReachedThreshold`

将所有 FlashList 的 `onEndReachedThreshold` 从 `2` 改为 `0.5`：

```javascript
onEndReachedThreshold={0.5}  // 距离底部 0.5 个屏幕高度时触发
```

### 修复 2：改进锁机制

将解锁逻辑从 `finally` 移到 `onEndReached` 回调中，确保在请求完成后才允许下一次加载：

```javascript
onEndReached={() => {
  if (endReachedLock.current) return;  // 已锁定，跳过
  if (hasMoreLibrary && !loadingMore && !loading) {
    endReachedLock.current = true;  // 加载前锁定
    loadLibraryData(libraryOffset + 100, true);
  }
}}
```

并在加载函数中移除 `finally` 中的解锁：

```javascript
const loadLibraryData = async (offset: number, append = false, refresh = false) => {
    // ...
    } finally {
      setLoading(false);
      setLoadingMore(false);
      setRefreshing(false);
      // 移除：endReachedLock.current = false;
    }
};
```

### 修复 3：为 folders tab 添加锁机制

```javascript
onEndReached={() => {
  if (endReachedLock.current) return;  // 添加锁检查
  if (hasMoreFolderFiles && !loadingMore && !loading) {
    endReachedLock.current = true;  // 加载前锁定
    loadFolderData(currentPath, folderOffset + 50, true);
  }
}}
```

### 修复 4：在 `onMomentumScrollBegin` 中解锁

保留现有的解锁逻辑，在用户开始滚动时解锁：

```javascript
onMomentumScrollBegin={() => { endReachedLock.current = false; }}
```

---

## 📝 四、具体代码修改

### 文件：`mobile/App.tsx`

#### 修改 1：loadLibraryData 函数（第 283-288 行）

```diff
    } catch (e) { handleApiError(e); } finally {
      setLoading(false);
      setLoadingMore(false);
      setRefreshing(false);
-     endReachedLock.current = false;
    }
```

#### 修改 2：loadFavoritesData 函数（第 344-348 行）

```diff
    } finally {
      setLoading(false);
      setLoadingMore(false);
      setRefreshing(false);
-     endReachedLock.current = false;
    }
```

#### 修改 3：loadFolderData 函数（第 397-401 行）

```diff
    } catch (e) { handleApiError(e); } finally {
      setLoading(false);
      setLoadingMore(false);
      setRefreshing(false);
-     endReachedLock.current = false;
    }
```

#### 修改 4：library FlashList（第 837 行）

```diff
- onEndReachedThreshold={2}
+ onEndReachedThreshold={0.5}
```

#### 修改 5：favorites FlashList（第 894 行）

```diff
- onEndReachedThreshold={2}
+ onEndReachedThreshold={0.5}
```

#### 修改 6：folders FlashList（第 1012-1016 行）

```diff
  onEndReached={() => {
+   if (endReachedLock.current) return;
    if (hasMoreFolderFiles && !loadingMore && !loading) {
+     endReachedLock.current = true;
      loadFolderData(currentPath, folderOffset + 50, true);
    }
  }}
```

#### 修改 7：folders FlashList 添加 onMomentumScrollBegin（第 1011 行后）

```diff
  refreshControl={<RefreshControl refreshing={refreshing || loading} onRefresh={onRefresh} />}
+ onMomentumScrollBegin={() => { endReachedLock.current = false; }}
  onEndReached={() => {
```

#### 修改 8：folders MasonryGallery（第 1071-1075 行）

```diff
  onEndReached={() => {
+   if (endReachedLock.current) return;
    if (hasMoreFolderFiles && !loadingMore && !loading) {
+     endReachedLock.current = true;
      loadFolderData(currentPath, folderOffset + 50, true);
    }
  }}
```

#### 修改 9：folders MasonryGallery 添加 onMomentumScrollBegin

```diff
  refreshing={refreshing || loading}
+ onMomentumScrollBegin={() => { endReachedLock.current = false; }}
  onEndReached={() => {
```

---

## ✅ 五、修复验证清单

- [ ] library tab 滚动到底部只触发一次加载
- [ ] favorites tab 滚动到底部只触发一次加载
- [ ] folders tab 滚动到底部只触发一次加载
- [ ] 加载完成后继续滚动可以触发下一次加载
- [ ] 快速滚动不会触发多次加载
- [ ] 下拉刷新后可以正常加载

---

## 📊 六、修复原理图

```
修复前：
┌─────────────────────────────────┐
│  用户滚动                        │
│       ↓                         │
│  onEndReached 触发（距离底部2屏）│
│       ↓                         │
│  loadingMore = true             │
│       ↓                         │
│  网络请求中...                   │
│       ↓                         │
│  onEndReached 再次触发（状态未更新）│
│       ↓                         │
│  ❌ 无限加载                     │
└─────────────────────────────────┘

修复后：
┌─────────────────────────────────┐
│  用户滚动                        │
│       ↓                         │
│  onEndReached 触发（距离底部0.5屏）│
│       ↓                         │
│  endReachedLock = true（锁定）   │
│       ↓                         │
│  loadingMore = true             │
│       ↓                         │
│  网络请求完成                    │
│       ↓                         │
│  用户继续滚动                    │
│       ↓                         │
│  onMomentumScrollBegin 解锁     │
│       ↓                         │
│  ✅ 可以触发下一次加载           │
└─────────────────────────────────┘
```
