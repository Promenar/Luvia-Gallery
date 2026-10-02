# WebUI 视觉底座与“暗房影院”视觉契约

> 状态：第 0 阶段已完成（a051be3）；第 1 阶段已完成，待提交验证（2026-10-02）
> 决策来源：用户确认采用 shadcn/ui（Base UI 底层）+ Tailwind v4，视觉方向选择“A · 暗房影院”，时间线后续借用“章节式日期”。

## 1. 视觉契约

**主风格**：`atmosphere-background`（cinematic、dark）——低对比雾与光晕建立舞台感，背景服务于前景内容。
**辅助维度**：`animation-systems`（克制动效：层级、反馈、连续性）；`dark-glass-clean-layout`（仅用于浮层与工具栏，不用于媒体卡片）。
**时间线（第 4 阶段）**：借用 `book-serif-index` 的章节式日期标题，衬线仅用于日期，调为暖色以服从主风格。

### 1.1 色彩

| 语义 | 深色（暗房） | 浅色（画廊白墙） |
|---|---|---|
| 页面底色 background | 暖黑 `#0e0c0b` | 暖白墙 `#f4f1ec` |
| 卡片 card | `#161311` | `#faf8f4` |
| 浮层 popover | `#1d1916` | `#ffffff` |
| 正文 foreground | `#efe7dc` | `#1f1b17` |
| 次要文字 muted-foreground | `#a39a8f` | `#6f675f` |
| 分隔线 border | 前景 8% | 前景 10% |
| 唯一强调色 primary | 黄铜 `#e2a65c` | 深黄铜 `#9a6a2f` |
| 焦点环 ring | `#e2a65c` | `#b07a36` |
| 危险 destructive | `#e5645a` | `#c2412f` |

- 只有一个强调色（黄铜）；不使用冷蓝/靛紫光晕，避免给照片偏色。
- 氛围光晕（`--ambient`）在运行时取自当前查看或悬停照片的主色，仅出现在页头与大图查看器背后；默认值为低饱和黄铜。

### 1.2 排版

- 无衬线：Inter Variable（本地托管）+ `PingFang SC`、`Hiragino Sans GB`、`Noto Sans SC`、`Microsoft YaHei` 中文回退。
- 计数与日期使用等宽数字（`tabular-nums`）。
- 标题字重 600、字距 -0.01em；正文 400；元信息 12px 次要色。
- 衬线（仅时间线日期，第 4 阶段）：`Songti SC`、`Noto Serif SC`。

### 1.3 材质与影像

- 缩略图小圆角（6px），深色模式不加投影；浅色模式使用柔和双层投影。
- 胶片颗粒只叠加在页头与查看器的背景层，绝不覆盖照片本身。
- 加载占位使用照片主色或中性暖灰，不使用脉冲高亮。

### 1.4 动效

- 时长 150 / 220 / 320ms，缓动 `cubic-bezier(0.2, 0.8, 0.2, 1)`。
- 网格卡片无逐张入场动画、无悬停上浮；仅保留缩略图轻微缩放（可关闭）。
- 动效集中在：页面切换、大图打开/关闭的共享元素过渡、氛围光晕的颜色过渡。
- 遵守 `prefers-reduced-motion`：关闭位移与缩放，仅保留透明度过渡。

### 1.5 禁止项

- 媒体卡片使用 `backdrop-filter`（百万级网格的性能红线）。
- WebGL / Canvas 全屏动态背景、全屏噪点混合层。
- 冷色（蓝、靛、紫）氛围光与多个强调色并存。
- 文字发光、霓虹描边、厚重阴影。
- 颗粒或滤镜覆盖照片内容。
- 降低正文对比度（正文与背景对比度不低于 WCAG AA 4.5:1）。

## 2. 技术底座约定

- Tailwind CSS v4（`@tailwindcss/vite`），设计令牌以 CSS 变量 + `@theme inline` 定义在 `index.css`；移除 `tailwind.config.js`、`postcss.config.js` 与 autoprefixer。
- shadcn/ui 使用 `base-nova` 风格、Base UI 底层，组件目录为 `components/kit/`（避免与现有 `components/ui/` 的大写文件在大小写不敏感文件系统上冲突），`cn` 工具位于 `utils/cn.ts`（`lib/` 为后端代码目录，不放前端文件）。
- 现有 `components/ui/` 与 `glass-*`、`surface-*`、`text-text-*`、`primary-*`、`accent-*` 等旧令牌在迁移期保留，数值改指向新色板，随第 1–3 阶段按页面替换后删除。
- 浏览器下限随 Tailwind v4 提升为 Chrome 111、Safari/iOS 16.4、Firefox 128。

## 3. 第 0 阶段（底座）实施步骤

1. 使用官方 `@tailwindcss/upgrade` 迁移到 v4，切换为 `@tailwindcss/vite` 插件，移除 PostCSS 链路；人工复核升级工具改写的工具类。
2. 新增依赖：`@base-ui/react`、`class-variance-authority`、`cn`、`tw-animate-css`、`@fontsource-variable/inter`；`shadcn` 作为开发依赖（提供 `shadcn/tailwind.css`）。
3. 编写 `components.json`（别名见第 2 节），通过 shadcn CLI 添加 `button` 验证生成链路。
4. 在 `index.css` 中建立第 1 节色板的语义令牌（shadcn 语义变量 + `--ambient`），旧令牌改指向新色板。
5. 字体本地化：移除 Google Fonts，引入 Inter Variable；`<html lang>` 随界面语言切换；`theme-color` 与 PWA 清单颜色改为新底色。
6. 移除 `AmbientDotField`（WebGL 点阵）与全屏 `.bg-noise` 注入及相应测试。

**文件所有权**：`index.css`、`index.html`、`vite.config.ts`、`package.json`/`package-lock.json`、`components.json`、`utils/cn.ts`、`components/kit/`、`App.tsx`（仅背景与语言相关行）、`contexts/LanguageContext.tsx`（仅 `lang` 同步）、`components/AmbientDotField.tsx` 与其测试、`tailwind.config.js`、`postcss.config.js`。

**边界条件**：现有页面在迁移期必须可用且无明显错位；暗色与浅色均可读；PWA 构建仍成功；无外部字体请求。

## 4. 验收命令与证据

- `npm run typecheck`、`npx vitest run`、`npm run build` 全部通过（本机）；后端测试与容器构建按 PDEC 在 FNOS Node 20 执行。
- 视觉验收：以本地模拟 API 服务承载构建产物，在浏览器中检查登录页、全部照片、文件夹、收藏、设置、播放器，覆盖深色、浅色与 375px 手机宽度；确认无外部字体请求、控制台无错误。
- 回滚：第 0 阶段为单一提交，可整体 `git revert`。

## 5. 后续阶段

1. 外壳：侧栏、工具栏、设置与弹窗迁移到 `components/kit`；`alert`/`confirm` 替换为 sonner 提示与确认对话框。
2. 画廊卡片与浅色主题：移除卡片毛玻璃与逐张动效，替换旧白色半透明工具类，主色占位。
3. 大图：共享元素过渡、渐进加载、预加载、氛围光晕取色；沉浸模式评估接入 yet-another-react-lightbox。
4. 时间线：服务端年月分桶与游标分页，章节式日期标题与时间拖动条。

## 6. 第 1 阶段（外壳）可执行计划

**目标**：应用外壳与全部弹层迁移到 `components/kit`，具备对话框语义（焦点限制、Esc、焦点归还、`role="dialog"`），原生 `alert`/`confirm`/`prompt` 清零，登录页重做，修复移动端页头与工具栏重叠。

**非目标**：媒体卡片与网格（第 2 阶段）、大图查看器（第 3 阶段）、工具栏菜单结构与导航行为（仅做令牌化换色，不改交互与测试契约）、`mobile/` 原生端。

**步骤**

1. 通过 shadcn CLI 添加 `dialog`、`alert-dialog`、`sonner`、`input`、`label`、`switch`（`separator`、`tabs` 暂未使用，未保留）；`sonner` 改为读取应用自身主题（`html.dark`），不引入 next-themes。
2. 新增 `components/feedback/`：`notify`（成功/错误/信息提示，封装 sonner）与 `ConfirmProvider` + `useConfirm()`（基于 alert-dialog 的 Promise 确认，支持危险操作样式）；在应用根挂载。
3. 替换 `App.tsx`、`PhotoCard`、`ScanReportModal`、`SettingsModal` 中的 `alert`/`confirm`；`SystemUpdater` 的令牌输入改为对话框内输入框。
4. 登录/初始化页改用 kit 输入框、标签、按钮，暗房氛围背景（暖黑 + 黄铜低对比光晕），中英文案统一走语言包。
5. 弹层外壳迁移到 kit `Dialog`：设置、用户编辑、目录选择、任务进度、扫描报告；内部 `bg-black/xx`、`border-white/xx` 等旧写法替换为语义令牌（`bg-muted`、`border-border`、`bg-card` 等），保证浅色主题可读。
6. 侧栏与移动端页头令牌化；移动端非首页视图隐藏 `MobileHeader`（工具栏已提供菜单入口），首页保留透明页头。
7. 工具栏与其下拉面板令牌化换色（`white/5` → `accent`/`muted`），结构与交互不变。

**文件所有权**：`components/kit/*`、`components/feedback/*`、`App.tsx`（弹窗调用与登录页）、`components/SettingsModal.tsx`、`components/settings/*`、`components/UserModal.tsx`、`components/DirectoryPicker.tsx`、`components/UnifiedProgressModal.tsx`、`components/ScanReportModal.tsx`、`components/SystemUpdater.tsx`、`components/PhotoCard.tsx`（仅修复按钮反馈）、`components/Navigation.tsx`、`components/navigation/{Sidebar,MobileHeader,NavItem,NavSection,GalleryNavigationBar,Breadcrumbs}.tsx`、`index.css`、`contexts/LanguageContext.tsx`（新增文案键）、对应测试。

**边界条件**：确认对话框在 Esc/点击遮罩时等同“取消”；危险操作按钮使用 destructive 样式；提示条不阻塞操作；弹层打开时焦点进入、关闭后回到触发元素；浅色/深色/375px 均可读；`prefers-reduced-motion` 下无缩放动画。

**验收**：`npm run typecheck`、`npx vitest run`、`npm run build`；新增 `useConfirm` 行为测试与“源码中不再出现原生弹窗”的约束测试；模拟 API 下浏览器检查登录、设置五个分页、用户编辑、目录选择、确认删除、提示条，覆盖深浅色与手机宽度；FNOS Node 20 全量测试与构建。
