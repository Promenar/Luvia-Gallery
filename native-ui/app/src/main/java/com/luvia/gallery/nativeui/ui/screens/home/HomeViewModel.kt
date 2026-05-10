package com.luvia.gallery.nativeui.ui.screens.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.luvia.gallery.nativeui.data.model.MediaItem
import com.luvia.gallery.nativeui.data.repository.MediaRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class HomeUiState(
    val carouselItems: List<MediaItem> = emptyList(),
    val recentItems: List<MediaItem> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null
)

@HiltViewModel
class HomeViewModel @Inject constructor(
    private val mediaRepository: MediaRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(HomeUiState())
    val uiState = _uiState.asStateFlow()

    init {
        loadHomeData()
    }

    fun loadHomeData() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            
            // For carousel, we might want random or specific items
            val carouselResult = mediaRepository.getMedia(offset = 0, limit = 5, sort = "random")
            val recentResult = mediaRepository.getMedia(offset = 0, limit = 10, sort = "time_desc")
            
            if (carouselResult.isSuccess && recentResult.isSuccess) {
                _uiState.update { it.copy(
                    isLoading = false,
                    carouselItems = carouselResult.getOrDefault(emptyList()),
                    recentItems = recentResult.getOrDefault(emptyList())
                ) }
            } else {
                _uiState.update { it.copy(isLoading = false, error = "Failed to load home data") }
            }
        }
    }
}
