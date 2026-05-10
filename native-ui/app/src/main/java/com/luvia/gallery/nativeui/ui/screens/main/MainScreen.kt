package com.luvia.gallery.nativeui.ui.screens.main

import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector

enum class MainTab(val title: String, val icon: ImageVector) {
    Home("Home", Icons.Default.Home),
    Gallery("Gallery", Icons.Default.PhotoLibrary),
    Folders("Folders", Icons.Default.Folder),
    Favorites("Favorites", Icons.Default.Favorite),
    Settings("Settings", Icons.Default.Settings)
}

import com.luvia.gallery.nativeui.ui.screens.home.HomeScreen
import com.luvia.gallery.nativeui.ui.screens.gallery.GalleryScreen
import com.luvia.gallery.nativeui.ui.screens.folders.FoldersScreen
import com.luvia.gallery.nativeui.ui.screens.favorites.FavoritesScreen
import com.luvia.gallery.nativeui.ui.screens.settings.SettingsScreen

@Composable
fun MainScreen(
    onMediaClick: (String) -> Unit,
    onLogout: () -> Unit
) {
    var selectedTab by remember { mutableStateOf(MainTab.Home) }

    Scaffold(
        bottomBar = {
            NavigationBar {
                MainTab.values().forEach { tab ->
                    NavigationBarItem(
                        selected = selectedTab == tab,
                        onClick = { selectedTab = tab },
                        icon = { Icon(tab.icon, contentDescription = tab.title) },
                        label = { Text(tab.title) }
                    )
                }
            }
        }
    ) { paddingValues ->
        androidx.compose.foundation.layout.Box(modifier = Modifier.padding(paddingValues)) {
            when (selectedTab) {
                MainTab.Home -> HomeScreen(onMediaClick = onMediaClick)
                MainTab.Gallery -> GalleryScreen(onMediaClick = onMediaClick)
                MainTab.Folders -> FoldersScreen(onFolderClick = { /* TODO: folder drill down */ })
                MainTab.Favorites -> FavoritesScreen(onMediaClick = onMediaClick)
                MainTab.Settings -> SettingsScreen(onLogout = onLogout)
            }
        }
    }
}

