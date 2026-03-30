import Foundation

// MARK: - TokenStore
// 通过 App Groups UserDefaults 在主应用与 Widget 间共享配置

final class TokenStore {
    
    // MARK: - Singleton
    
    static let shared = TokenStore()
    
    // MARK: - Constants
    
    private let suiteName = "group.com.luvia.gallery"
    private let configKey = "widget_config"
    
    // MARK: - Properties
    
    private var userDefaults: UserDefaults? {
        UserDefaults(suiteName: suiteName)
    }
    
    // MARK: - Initialization
    
    private init() {}
    
    // MARK: - Public API
    
    /// 保存配置到 App Groups
    func saveConfig(_ config: WidgetConfig) {
        guard let data = try? JSONEncoder().encode(config) else {
            print("[TokenStore] Failed to encode config")
            return
        }
        userDefaults?.set(data, forKey: configKey)
        print("[TokenStore] Config saved: server=\(config.serverUrl.prefix(30))...")
    }
    
    /// 从 App Groups 读取配置
    func loadConfig() -> WidgetConfig? {
        guard let data = userDefaults?.data(forKey: configKey) else {
            print("[TokenStore] No config found in UserDefaults")
            return nil
        }
        
        do {
            let config = try JSONDecoder().decode(WidgetConfig.self, from: data)
            print("[TokenStore] Config loaded: server=\(config.serverUrl.prefix(30))...")
            return config
        } catch {
            print("[TokenStore] Failed to decode config: \(error)")
            return nil
        }
    }
    
    /// 清除配置
    func clearConfig() {
        userDefaults?.removeObject(forKey: configKey)
        print("[TokenStore] Config cleared")
    }
    
    /// 检查是否有有效配置
    func hasValidConfig() -> Bool {
        guard let config = loadConfig() else { return false }
        return config.isValid
    }
    
    /// 获取 App Groups 容器 URL
    func containerURL() -> URL? {
        FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: suiteName)
    }
}
