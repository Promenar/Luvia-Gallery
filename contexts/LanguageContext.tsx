
import React, { createContext, useContext, useState, useEffect } from 'react';

type Language = 'en' | 'zh';

const translations = {
  en: {
    // Navigation & General
    home: 'Home',
    library: 'Library',
    all_photos: 'All Photos',
    folders: 'Folders',
    favorites: 'Favorites',
    settings: 'Settings',
    light_mode: 'Light Mode',
    dark_mode: 'Dark Mode',
    follow_system: 'System Theme',
    menu: 'Menu',
    system: 'System',
    load_folder: 'Load Folder',

    // Home Screen
    enter_library: 'Enter Library',
    items_count: 'Items',
    view_in: 'View in',

    // Sort & Filter
    sort_filter: 'Sort & Filter',
    newest_first: 'Newest First',
    oldest_first: 'Oldest First',
    shuffle_random: 'Shuffle Random',
    all_types: 'All Types',
    videos_only: 'Videos Only',
    audio_only: 'Audio Only',

    // Photo Card
    video_badge: 'VIDEO',
    audio_badge: 'AUDIO',
    confirm_regenerate_folder: 'Are you sure you want to regenerate thumbnails for this folder?',
    regenerate_thumbnails: 'Regenerate Thumbnails',

    // Viewer
    file_info: 'Info',
    file_details: 'File Details',
    camera_details: 'Camera Details',
    name: 'Name',
    path: 'Path',
    size: 'Size',
    type: 'Type',
    date_modified: 'Date Modified',
    camera: 'Camera',
    lens: 'Lens',
    aperture: 'Aperture',
    shutter: 'Shutter',
    iso: 'ISO',
    focal_length: 'Focal Length',
    dimensions: 'Dimensions',
    date_taken: 'Date Taken',
    no_exif: 'No EXIF data found.',
    loading_metadata: 'Loading metadata...',
    delete_confirm: 'Are you sure you want to delete',

    // Scan Modal
    scanning_library: 'Scanning Library',
    generating_thumbnails: 'Generating Thumbnails',
    processing: 'Processing...',
    found: 'Found',
    processed: 'Processed',
    paused: 'Paused',
    complete: 'Complete',
    stopped: 'Stopped',
    operation_finished: 'Operation finished successfully',
    processing_bg: 'Processing in background',
    current_file: 'Current File',
    pause: 'Pause',
    resume: 'Resume',
    stop: 'Stop',
    close: 'Close',
    background_tasks: 'Background Tasks',
    library_scan: 'Library Scan',
    thumbnails: 'Thumbnails',
    waiting_finished: 'Waiting / Finished',
    tasks_completed: 'Tasks Completed',
    all_jobs_finished: 'All background jobs finished',
    files_processed: 'files processed',
    percent_complete: '% complete',

    // Settings - Dashboard
    system_monitoring: 'System Monitoring',
    backend_components: 'Backend Components',
    database: 'Database',
    video_engine: 'Video Engine',
    image_engine: 'Image Engine',
    image_processor: 'Image Processor',
    hw_accel: 'HW Acceleration',
    total_assets: 'Total Assets',
    server_offline: 'Server Offline or Unreachable',
    server_offline_desc: 'Backend monitoring is unavailable. Ensure server is running.',
    retry: 'Retry',
    auto_scan: 'Auto-Scan / Watcher',

    processors: 'Processors',
    hw_acceleration: 'HW Acceleration',
    cpu_only: 'CPU ONLY',
    library_stats: 'Library Stats',
    cached: 'Cached',
    active: 'ACTIVE',
    missing: 'MISSING',
    realtime_monitoring: 'Real-time File Monitoring',
    enabled: 'ENABLED',
    disabled: 'DISABLED',
    toggle: 'Toggle',
    cache_coverage: 'Thumbnail Coverage',

    // Settings - Performance
    performance_settings: 'Performance Settings',
    thumbnail_threads: 'Thumbnail Threads',
    thumbnail_threads_desc: 'Controls how many thumbnails are generated in parallel.',


    // Settings - General
    general: 'General',
    appearance: 'Appearance',
    theme: 'Theme',
    website_title: 'Website Title',
    home_subtitle: 'Home Subtitle',
    home_screen_conf: 'Home Screen Configuration',
    random_all: 'Random All',
    specific_folder: 'Specific Folder',
    single_item: 'Single Item',
    enter_rel_path: 'Enter relative path (e.g. Photos/Vacation)',
    connection: 'Connection',
    connection_mode: 'Connection Mode',
    client_mode: 'Client Mode',
    server_mode: 'Server Mode (NAS)',
    client_mode_description: 'Running purely in browser (LocalStorage)',
    server_mode_description: 'Connected to backend API',
    connected_to_nas: 'Connected to NAS',
    running_in_browser: 'Running in Browser',
    switch_to_client: 'Switch to Client',
    switch_to_server: 'Switch to Server',
    language: 'Language',

    // Settings - Storage
    storage_database: 'Storage & Database',
    server_persistence: 'Server Persistence Active',
    media_served: 'Media is served from configured paths.',
    library_scan_paths: 'Library Scan Paths',
    scanning_default: 'Scanning Default',
    add_path: 'Add Path',
    scan_library: 'Scan Library',
    scan_library_desc: 'Detects new files',
    scan_started: 'Scan started',
    generate_thumbs: 'Generate Thumbs',
    generate_thumbs_desc: 'Creates missing previews',
    thumbs_started: 'Thumbnail generation started',
    running_client_mode: 'Running in Client Mode',
    backup_config: 'Backup Config',
    cache_management: 'Cache Management',
    clear_all_cache: 'Clear All Cache',
    prune_cache: 'Prune Cache',
    prune_legacy_cache: 'Prune Legacy Cache (JPG)',
    clean_duplicate_cache: 'Clean Duplicate Cache',
    cache_cleared: 'Cache Cleared',
    cache_pruned: 'Cache Pruned',

    // Settings - Monitoring
    monitoring_strategy: 'Monitoring Strategy',
    manual_mode: 'Manual',
    periodic_mode: 'Periodic',
    realtime_mode: 'Real-time',
    scan_every: 'Scan every',
    minutes: 'Minutes',
    hour: 'Hour',
    hours: 'Hours',
    monitoring_desc_realtime: 'Real-time monitoring uses system watchers to instantly detect changes. Best for small libraries. May hit system limits on large libraries.',
    monitoring_desc_manual: 'Automatic scanning is disabled. You must manually start scans to update the library.',
    monitoring_desc_periodic: 'Periodic mode runs a quick check for changes at a set interval. Recommended for large libraries.',


    // Directory Picker
    select_folder: 'Select Folder',
    go_up: 'Up',
    loading_folders: 'Loading folders',
    no_subfolders: 'No subfolders found',
    select_this_folder: 'Select This Folder',
    browse: 'Browse',

    // Settings - Users
    users: 'Users',
    hide: 'Hide',
    manage: 'Manage',
    sign_out: 'Sign Out',
    done: 'Done',
    user_management: 'User Management',
    add_user: 'Add User',
    reset_password: 'Reset Password',
    delete_user: 'Delete User',
    username: 'Username',
    password: 'Password',
    is_admin: 'Administrator Access',
    cancel: 'Cancel',
    save: 'Save',
    delete_user_confirm: 'Are you sure you want to delete this user?',

    // Auth
    welcome: 'Welcome',
    init_nas: 'Initialize your NAS Gallery.',
    setup_admin: 'Set up your admin account.',
    create_admin: 'Create Admin',
    import_db: 'Import Database File',
    sign_in: 'Sign In',
    nas_connected: 'NAS Server Connected',
    invalid_credentials: 'Invalid credentials',
    passwords_not_match: 'Passwords do not match',

    // Errors/Empty
    empty_library: 'Library is empty',
    import_local: 'Import local folders to begin.',
    configure_nas: 'Connected to NAS. Configure Library Paths in Settings and Scan.',
    configure_library: 'Configure Library',
    import_local_folder: 'Import Local Folder',
    no_favorites: 'No Favorites Yet',
    click_heart_to_favorite: 'Click the heart icon to add favorites',

    // Media Statistics
    media_statistics: 'Media Statistics',
    images: 'Images',
    videos: 'Videos',
    audio: 'Audio',
    total_files: 'Total Files',
    favorite_folders: 'Favorite Folders',
  },
  zh: {
    // Navigation & General
    home: '首页',
    library: '图库',
    all_photos: '媒体库',
    folders: '文件夹',
    favorites: '收藏夹',
    settings: '设置',
    light_mode: '浅色模式',
    dark_mode: '深色模式',
    follow_system: '跟随系统',
    menu: '菜单',
    system: '系统',
    load_folder: '加载文件夹',

    // Home Screen
    enter_library: '进入图库',
    items_count: '项',
    view_in: '查看于',

    // Sort & Filter
    sort_filter: '排序与筛选',
    newest_first: '最新优先',
    oldest_first: '最早优先',
    shuffle_random: '随机打乱',
    all_types: '所有类型',
    videos_only: '仅视频',
    audio_only: '仅音频',

    // Photo Card
    video_badge: '视频',
    audio_badge: '音频',
    confirm_regenerate_folder: '您确定要为该文件夹重新生成缩略图吗？',
    regenerate_thumbnails: '重新生成缩略图',

    // Viewer
    file_info: '信息',
    file_details: '文件详情',
    camera_details: '相机详情',
    name: '名称',
    path: '路径',
    size: '大小',
    type: '类型',
    date_modified: '修改日期',
    camera: '相机型号',
    lens: '镜头',
    aperture: '光圈',
    shutter: '快门',
    iso: 'ISO',
    focal_length: '焦距',
    dimensions: '尺寸',
    date_taken: '拍摄日期',
    no_exif: '未找到 EXIF 数据',
    loading_metadata: '正在加载元数据...',
    delete_confirm: '你确定要删除',

    // Scan Modal
    scanning_library: '正在扫描图库',
    generating_thumbnails: '正在生成缩略图',
    processing: '处理中...',
    found: '已发现',
    processed: '已处理',
    paused: '已暂停',
    complete: '完成',
    stopped: '已停止',
    operation_finished: '操作成功完成',
    processing_bg: '正在后台处理',
    current_file: '当前文件',
    pause: '暂停',
    resume: '继续',
    stop: '停止',
    close: '关闭',
    background_tasks: '后台任务',
    library_scan: '图库扫描',
    thumbnails: '缩略图',
    waiting_finished: '等待 / 完成',
    tasks_completed: '任务已完成',
    all_jobs_finished: '所有后台任务已结束',
    files_processed: '个文件已处理',
    percent_complete: '% 完成',

    // Settings - Dashboard
    system_monitoring: '系统监控',
    backend_components: '后端组件状态',
    database: '数据库',
    video_engine: '视频引擎',
    image_engine: '图像引擎',
    image_processor: '图像处理',
    hw_accel: '硬件加速',
    total_assets: '总资产',
    server_offline: '服务器离线或无法连接',
    server_offline_desc: '后端监控不可用，请确保服务器正在运行。',
    retry: '重试',
    auto_scan: '自动扫描 / 监控',

    processors: '处理器',
    hw_acceleration: '硬件加速',
    cpu_only: '仅 CPU',
    library_stats: '图库统计',
    cached: '已缓存',
    active: '已激活',
    missing: '缺失',
    realtime_monitoring: '实时文件监控',
    enabled: '已启用',
    disabled: '已禁用',
    toggle: '切换',
    cache_coverage: '缩略图覆盖率',

    // Settings - Performance
    performance_settings: '性能设置',
    thumbnail_threads: '缩略图线程数',
    thumbnail_threads_desc: '控制并行生成缩略图的数量。',


    // Settings - General
    general: '常规设置',
    appearance: '外观设置',
    theme: '主题',
    website_title: '网站标题',
    home_subtitle: '首页副标题',
    home_screen_conf: '首页配置',
    random_all: '随机展示所有',
    specific_folder: '指定文件夹',
    single_item: '单个文件',
    enter_rel_path: '输入相对路径 (例如 Photos/Vacation)',
    connection: '连接设置',
    connection_mode: '连接模式',
    client_mode: '客户端模式',
    server_mode: '服务器模式 (NAS)',
    client_mode_description: '数据仅存储在浏览器中',
    server_mode_description: '已连接至后端 API',
    connected_to_nas: 'NAS 已连接',
    running_in_browser: '仅浏览器运行',
    switch_to_client: '切到客户端',
    switch_to_server: '切到服务器',
    language: '语言 / Language',

    // Settings - Storage
    storage_database: '存储与数据库',
    server_persistence: '服务器持久化已激活',
    media_served: '媒体文件由配置的路径提供服务。',
    library_scan_paths: '图库扫描路径',
    scanning_default: '默认扫描路径',
    add_path: '添加路径',
    scan_library: '扫描图库',
    scan_library_desc: '检测新文件',
    scan_started: '扫描已开始',
    generate_thumbs: '生成缩略图',
    generate_thumbs_desc: '创建缺失的预览',
    thumbs_started: '缩略图生成已开始',
    running_client_mode: '运行于客户端模式',
    backup_config: '备份配置',
    cache_management: '缓存管理',
    clear_all_cache: '清除所有缓存',
    prune_cache: '清理无效缓存',
    prune_legacy_cache: '清除旧缓存 (JPG)',
    clean_duplicate_cache: '清理重复缓存',
    cache_cleared: '缓存已清除',
    cache_pruned: '缓存已清理',

    // Settings - Monitoring
    monitoring_strategy: '监控策略',
    manual_mode: '手动',
    periodic_mode: '周期性',
    realtime_mode: '实时',
    scan_every: '扫描间隔',
    minutes: '分钟',
    hour: '小时',
    hours: '小时',
    monitoring_desc_realtime: '实时监控使用系统文件监视器即时检测更改。最适合小型图库。在大型图库上可能会达到系统限制。',
    monitoring_desc_manual: '自动扫描已禁用。您必须手动开始扫描以更新图库。',
    monitoring_desc_periodic: '周期模式会按设定的间隔快速检查更改。推荐用于大型图库。',

    // Directory Picker
    select_folder: '选择文件夹',
    go_up: '返回上级',
    loading_folders: '正在加载文件夹',
    no_subfolders: '未发现子文件夹',
    select_this_folder: '选择此文件夹',
    browse: '浏览',

    // Settings - Users
    users: '用户管理',
    hide: '隐藏',
    manage: '管理',
    sign_out: '退出登录',
    done: '完成',
    user_management: '用户管理',
    add_user: '添加用户',
    reset_password: '重置密码',
    delete_user: '删除用户',
    username: '用户名',
    password: '密码',
    is_admin: '管理员权限',
    cancel: '取消',
    save: '保存',
    delete_user_confirm: '确定要删除该用户吗？',

    // Auth
    welcome: '欢迎',
    init_nas: '初始化您的 NAS 图库。',
    setup_admin: '设置管理员账户。',
    create_admin: '创建管理员',
    import_db: '导入数据库文件',
    sign_in: '登录',
    nas_connected: 'NAS 服务器已连接',
    invalid_credentials: '凭证无效',
    passwords_not_match: '两次输入的密码不匹配',

    // Errors/Empty
    empty_library: '图库为空',
    import_local: '导入本地文件夹以开始使用。',
    configure_nas: '已连接至 NAS。请在设置中配置扫描路径并开始扫描。',
    configure_library: '配置图库',
    import_local_folder: '导入本地文件夹',
    no_favorites: '暂无收藏',
    click_heart_to_favorite: '点击红心图标添加收藏',

    // Media Statistics
    media_statistics: '媒体统计',
    images: '图片',
    videos: '视频',
    audio: '音频',
    total_files: '总文件数',
    favorite_folders: '收藏的文件夹',
  }
};

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: keyof typeof translations['en']) => string;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [language, setLanguageState] = useState<Language>('en');

  useEffect(() => {
    const savedLang = localStorage.getItem('lumina_language') as Language;
    if (savedLang && (savedLang === 'en' || savedLang === 'zh')) {
      setLanguageState(savedLang);
    } else {
      // Auto-detect
      const browserLang = navigator.language;
      if (browserLang.toLowerCase().includes('zh')) {
        setLanguageState('zh');
      }
    }
  }, []);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem('lumina_language', lang);
  };

  const t = (key: keyof typeof translations['en']) => {
    return translations[language][key] || key;
  };

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t }}>
      {children}
    </LanguageContext.Provider>
  );
};

export const useLanguage = () => {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
};
