package com.luvia.gallery.nativeui.ui.screens.settings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.Logout
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel

@Composable
fun SettingsScreen(
    onLogout: () -> Unit,
    viewModel: SettingsViewModel = hiltViewModel()
) {
    val serverUrl by viewModel.serverUrl.collectAsState()

    LazyColumn(modifier = Modifier.fillMaxSize()) {
        item {
            ListItem(
                headlineContent = { Text("Server Status") },
                supportingContent = { Text(serverUrl ?: "Not connected") },
                leadingContent = { Icon(Icons.Default.Dns, contentDescription = null) }
            )
        }
        
        item { Divider() }

        item {
            ListItem(
                headlineContent = { Text("Logout", color = MaterialTheme.colorScheme.error) },
                leadingContent = { Icon(Icons.Default.Logout, contentDescription = null, tint = MaterialTheme.colorScheme.error) },
                modifier = Modifier.clickable { viewModel.logout(onLogout) }
            )
        }
    }
}
