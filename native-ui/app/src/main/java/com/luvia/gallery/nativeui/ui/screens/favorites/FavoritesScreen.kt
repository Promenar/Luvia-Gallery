package com.luvia.gallery.nativeui.ui.screens.favorites

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.luvia.gallery.nativeui.ui.screens.gallery.MediaThumbnail

@Composable
fun FavoritesScreen(
    onMediaClick: (String) -> Unit,
    viewModel: FavoritesViewModel = hiltViewModel()
) {
    val state by viewModel.uiState.collectAsState()

    Box(modifier = Modifier.fillMaxSize()) {
        if (state.isLoading && state.items.isEmpty()) {
            CircularProgressIndicator(modifier = Modifier.align(Alignment.Center))
        }

        if (!state.isLoading && state.items.isEmpty()) {
            Text(text = "No favorites yet", modifier = Modifier.align(Alignment.Center))
        }

        LazyVerticalGrid(
            columns = GridCells.Adaptive(minSize = 120.dp),
            contentPadding = PaddingValues(2.dp),
            horizontalArrangement = Arrangement.spacedBy(2.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp)
        ) {
            items(state.items, key = { it.id }) { item ->
                MediaThumbnail(
                    item = item,
                    onClick = { onMediaClick(item.id) }
                )
            }
        }

        if (state.error != null) {
            Text(
                text = state.error!!,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.align(Alignment.Center)
            )
        }
    }
}
