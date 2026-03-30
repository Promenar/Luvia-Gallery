//
//  ContentView.swift
//  LuviaGalleryWidget
//
//  Widget Configuration UI
//

import SwiftUI

struct ContentView: View {
    @State private var serverUrl: String = ""
    @State private var token: String = ""
    @State private var selectedMode: WidgetConfig.DisplayMode = .random
    @State private var folderPath: String = ""
    @State private var showVideos: Bool = false
    @State private var refreshInterval: Int = 30
    @State private var showSaveSuccess: Bool = false
    
    var body: some View {
        VStack(spacing: 20) {
            // Header
            HStack {
                Image(systemName: "photo.on.rectangle.angled")
                    .font(.largeTitle)
                    .foregroundStyle(Color.accentColor)
                VStack(alignment: .leading) {
                    Text("Luvia Gallery")
                        .font(.title)
                        .fontWeight(.bold)
                    Text("Widget Configuration")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            }
            .padding(.bottom, 10)
            
            Form {
                Section("Server Settings") {
                    TextField("Server URL", text: $serverUrl, prompt: Text("http://localhost:3000"))
                        .textFieldStyle(.roundedBorder)
                    
                    TextField("API Token", text: $token, prompt: Text("Paste your token here..."))
                        .textFieldStyle(.roundedBorder)
                }
                
                Section("Display Options") {
                    Picker("Mode", selection: $selectedMode) {
                        Text("Random Photos").tag(WidgetConfig.DisplayMode.random)
                        Text("Favorites").tag(WidgetConfig.DisplayMode.favorites)
                        Text("Specific Folder").tag(WidgetConfig.DisplayMode.folder)
                    }
                    
                    if selectedMode == .folder {
                        TextField("Folder Path", text: $folderPath, prompt: Text("Photos/Vacation"))
                            .textFieldStyle(.roundedBorder)
                    }
                    
                    Toggle("Include Videos", isOn: $showVideos)
                    
                    Picker("Refresh Interval", selection: $refreshInterval) {
                        Text("15 Minutes").tag(15)
                        Text("30 Minutes").tag(30)
                        Text("1 Hour").tag(60)
                    }
                }
            }
            .formStyle(.grouped)
            
            // Save Button
            Button(action: saveConfiguration) {
                HStack {
                    Image(systemName: "checkmark.circle.fill")
                    Text("Save Configuration")
                }
                .frame(maxWidth: .infinity)
                .padding()
            }
            .buttonStyle(.borderedProminent)
            .disabled(serverUrl.isEmpty || token.isEmpty)
            .padding(.horizontal)
            
            if showSaveSuccess {
                HStack {
                    Image(systemName: "checkmark.circle")
                        .foregroundStyle(.green)
                    Text("Configuration saved! Add widget to your desktop.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .transition(.opacity)
            }
            
            Spacer()
            
            // Instructions
            VStack(alignment: .leading, spacing: 8) {
                Text("How to use:")
                    .font(.headline)
                
                Text("1. Generate a Wallpaper Token in Luvia Gallery web settings")
                Text("2. Enter the server URL and token above")
                Text("3. Click Save Configuration")
                Text("4. Right-click your desktop → Edit Widgets → Add Luvia Gallery")
            }
            .font(.caption)
            .foregroundStyle(.secondary)
            .padding()
            .background(Color(.windowBackgroundColor))
            .cornerRadius(8)
            .padding(.horizontal)
        }
        .padding()
        .frame(width: 450, height: 600)
        .onAppear {
            loadConfiguration()
        }
    }
    
    private func saveConfiguration() {
        let config = WidgetConfig(
            serverUrl: serverUrl,
            token: token,
            mode: selectedMode,
            folderPath: folderPath,
            showVideos: showVideos,
            refreshInterval: refreshInterval
        )
        
        TokenStore.shared.saveConfig(config)
        
        withAnimation {
            showSaveSuccess = true
        }
        
        // Hide success message after 3 seconds
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) {
            withAnimation {
                showSaveSuccess = false
            }
        }
    }
    
    private func loadConfiguration() {
        if let config = TokenStore.shared.loadConfig() {
            serverUrl = config.serverUrl
            token = config.token
            selectedMode = config.mode
            folderPath = config.folderPath
            showVideos = config.showVideos
            refreshInterval = config.refreshInterval
        }
    }
}

#Preview {
    ContentView()
}
