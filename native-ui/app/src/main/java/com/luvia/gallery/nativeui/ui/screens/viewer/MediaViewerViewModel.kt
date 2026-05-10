package com.luvia.gallery.nativeui.ui.screens.viewer

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.luvia.gallery.nativeui.data.api.OperationApi
import com.luvia.gallery.nativeui.data.model.ExifData
import com.luvia.gallery.nativeui.data.model.MediaItem
import com.luvia.gallery.nativeui.data.repository.MediaRepository
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import javax.inject.Inject

data class ViewerUiState(
    val mediaId: String = "",
    val mediaItem: MediaItem? = null,
    val exifData: ExifData? = null,
    val isLoading: Boolean = false,
    val error: String? = null
)

@HiltViewModel
class MediaViewerViewModel @Inject constructor(
    private val mediaRepository: MediaRepository,
    private val operationApi: OperationApi
) : ViewModel() {

    private val _uiState = MutableStateFlow(ViewerUiState())
    val uiState = _uiState.asStateFlow()

    fun init(mediaId: String) {
        _uiState.update { it.copy(mediaId = mediaId) }
        loadDetails(mediaId)
    }

    private fun loadDetails(id: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }
            // In a real app, we'd fetch a single media item. 
            // For now, let's assume we fetch EXIF at least.
            val exifResult = mediaRepository.getExif(id)
            _uiState.update { it.copy(
                isLoading = false,
                exifData = exifResult.getOrNull()
            ) }
        }
    }

    fun toggleFavorite() {
        viewModelScope.launch {
            try {
                operationApi.toggleFavorite(mapOf("id" to _uiState.value.mediaId))
                // Update local state if we had it
            } catch (e: Exception) {
                // handle error
            }
        }
    }
}
