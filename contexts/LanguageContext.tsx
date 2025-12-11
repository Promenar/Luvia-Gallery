
import React, { createContext, useContext, useState, useEffect } from 'react';

type Language = 'en' | 'zh';

const translations = {
  en: {
    // Navigation & General
    home: 'Home',
    library: 'Library',
    all_photos: 'All Photos',
    folders: 'Folders',
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
    
    // Settings - Dashboard
    system_monitoring: 'System Monitoring',
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
    
    // Settings - General
    general: 'General',
    website_title: 'Website Title',
    home_subtitle: 'Home Subtitle',
    home_screen_bg: 'Home Screen Background',
    random_all: 'Random All',
    specific_folder: 'Specific Folder',
    single_item: 'Single Item',
    enter_rel_path: 'Enter the relative path (e.g. Photos/Vacation).',
    connection_mode: 'Connection Mode',
    client_mode: 'Client Mode',
    server_mode: 'Server Mode (NAS)',
    language: 'Language',
    
    // Settings - Storage
    storage_database: 'Storage & Database',
    server_persistence: 'Server Persistence Active',
    media_served: 'Media is served from configured paths.',
    library_scan_paths: 'Library Scan Paths',
    scanning_default: 'Scanning Default',
    add_path: 'Add Path',
    scan_library: 'Scan Library',
    scan_started: 'Scan started',
    generate_thumbs: 'Generate Thumbs',
    thumbs_started: 'Thumbnail generation started',
    running_client_mode: 'Running in Client Mode',
    backup_config: 'Backup Config',
    
    // Settings - Users
    users: 'Users',
    hide: 'Hide',
    manage: 'Manage',
    sign_out: 'Sign Out',
    done: 'Done',
    
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
  },
  zh: {
    // Navigation & General
    home: '首页',
    library: '图库',
    all_photos: '所有照片',
    folders: '文件夹',
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
    
    // Settings - Dashboard
    system_monitoring: '系统监控',
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
    
    // Settings - General
    general: '常规设置',
    website_title: '网站标题',
    home_subtitle: '首页副标题',
    home_screen_bg: '首页背景',
    random_all: '随机展示所有',
    specific_folder: '指定文件夹',
    single_item: '单个文件',
    enter_rel_path: '输入相对路径 (例如 Photos/Vacation)',
    connection_mode: '连接模式',
    client_mode: '客户端模式',
    server_mode: '服务器模式 (NAS)',
    language: '语言 / Language',
    
    // Settings - Storage
    storage_database: '存储与数据库',
    server_persistence: '服务器持久化已激活',
    media_served: '媒体文件由配置的路径提供服务。',
    library_scan_paths: '图库扫描路径',
    scanning_default: '默认扫描路径',
    add_path: '添加路径',
    scan_library: '扫描图库',
    scan_started: '扫描已开始',
    generate_thumbs: '生成缩略图',
    thumbs_started: '缩略图生成已开始',
    running_client_mode: '运行于客户端模式',
    backup_config: '备份配置',
    
    // Settings - Users
    users: '用户管理',
    hide: '隐藏',
    manage: '管理',
    sign_out: '退出登录',
    done: '完成',
    
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
