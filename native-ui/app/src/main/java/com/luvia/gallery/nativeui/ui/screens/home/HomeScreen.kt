package com.luvia.gallery.nativeui.ui.screens.home

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import coil.compose.AsyncImage
import com.luvia.gallery.nativeui.data.model.MediaItem

@Composable
fun HomeScreen(
    onMediaClick: (String) -> Unit,
    viewModel: HomeViewModel = hiltViewModel()
) {
    val state by viewModel.uiState.collectAsState()

    Column(
        modifier = Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
    ) {
        // Hero Carousel
        if (state.carouselItems.isNotEmpty()) {
            val pagerState = rememberPagerState(pageCount = { state.carouselItems.size })
            HorizontalPager(
                state = pagerState,
                modifier = Modifier
                    .fillMaxWidth()
                    .height(300.dp)
            ) { page ->
                val item = state.carouselItems[page]
                AsyncImage(
                    model = item.url,
                    contentDescription = null,
                    modifier = Modifier
                        .fillMaxSize()
                        .clickable { onMediaClick(item.id) },
                    contentScale = ContentScale.Crop
                )
            }
        }

        Spacer(modifier = Modifier.height(24.dp))

        // Recent Added
        Text(
            text = "Recently Added",
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(horizontal = 16.dp)
        )
        
        Spacer(modifier = Modifier.height(16.dp))

        LazyRow(
            contentPadding = PaddingValues(horizontal = 16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            items(state.recentItems) { item ->
                RecentItemCard(item = item, onClick = { onMediaClick(item.id) })
            }
        }
        
        Spacer(modifier = Modifier.height(24.dp))
    }
}

@Composable
fun RecentItemCard(item: MediaItem, onClick: () -> Unit) {
    Card(
        modifier = Modifier
            .width(140.dp)
            .height(140.dp)
            .clickable(onClick = onClick)
    ) {
        AsyncImage(
            model = item.thumbnailUrl,
            contentDescription = null,
            modifier = Modifier.fillMaxSize(),
            contentScale = ContentScale.Crop
        )
    }
}
