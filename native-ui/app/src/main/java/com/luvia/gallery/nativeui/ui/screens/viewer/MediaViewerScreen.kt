package com.luvia.gallery.nativeui.ui.screens.viewer

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Favorite
import androidx.compose.material.icons.filled.FavoriteBorder
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import coil.compose.AsyncImage

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MediaViewerScreen(
    mediaId: String,
    onBack: () -> Unit,
    viewModel: MediaViewerViewModel = hiltViewModel()
) {
    LaunchedEffect(mediaId) {
        viewModel.init(mediaId)
    }

    val state by viewModel.uiState.collectAsState()
    var showInfo by remember { mutableStateOf(false) }

    Scaffold(
        containerColor = Color.Black,
        topBar = {
            TopAppBar(
                title = { },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back", tint = Color.White)
                    }
                },
                actions = {
                    IconButton(onClick = { viewModel.toggleFavorite() }) {
                        Icon(Icons.Default.FavoriteBorder, contentDescription = "Favorite", tint = Color.White)
                    }
                    IconButton(onClick = { showInfo = !showInfo }) {
                        Icon(Icons.Default.Info, contentDescription = "Info", tint = Color.White)
                    }
                },
                colors = TopAppBarDefaults.topAppBarColors(
                    containerColor = Color.Black.copy(alpha = 0.5f)
                )
            )
        }
    ) { paddingValues ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(paddingValues),
            contentAlignment = Alignment.Center
        ) {
            // Placeholder for full image. In real app, use ZoomableImage or Media3
            AsyncImage(
                model = "http://localhost/api/file/$mediaId", // Simplified URL
                contentDescription = null,
                modifier = Modifier.fillMaxSize(),
                contentScale = ContentScale.Fit
            )

            if (showInfo && state.exifData != null) {
                ExifInfoOverlay(exif = state.exifData!!)
            }
        }
    }
}

@Composable
fun ExifInfoOverlay(exif: com.luvia.gallery.nativeui.data.model.ExifData) {
    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .padding(16.dp),
        color = Color.Black.copy(alpha = 0.7f),
        shape = MaterialTheme.shapes.medium
    ) {
        Column(modifier = Modifier.padding(16.dp)) {
            Text("Model: ${exif.model ?: "Unknown"}", color = Color.White)
            Text("Exposure: ${exif.exposureTime ?: "Unknown"}", color = Color.White)
            Text("ISO: ${exif.iso ?: "Unknown"}", color = Color.White)
            Text("F-Stop: ${exif.fNumber ?: "Unknown"}", color = Color.White)
        }
    }
}
