package com.luvia.gallery.nativeui.ui.screens.gallery

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

data class GalleryUiState(
    val items: List<MediaItem> = emptyList(),
    val isLoading: Boolean = false,
    val error: String? = null
)

@HiltViewModel
class GalleryViewModel @Inject constructor(
    private val mediaRepository: MediaRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(GalleryUiState())
    val uiState = _uiState.asStateFlow()

    init {
        loadMedia()
    }

    fun loadMedia() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            val result = mediaRepository.getMedia(offset = 0, limit = 100)
            if (result.isSuccess) {
                _uiState.update { it.copy(isLoading = false, items = result.getOrDefault(emptyList())) }
            } else {
                _uiState.update { it.copy(isLoading = false, error = result.exceptionOrNull()?.message) }
            }
        }
    }
}
