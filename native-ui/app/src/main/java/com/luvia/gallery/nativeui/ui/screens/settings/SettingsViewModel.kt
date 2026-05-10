package com.luvia.gallery.nativeui.ui.screens.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.luvia.gallery.nativeui.data.repository.AuthRepository
import com.luvia.gallery.nativeui.util.DataStoreManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.stateIn
import kotlinx.coroutines.launch
import javax.inject.Inject

@HiltViewModel
class SettingsViewModel @Inject constructor(
    private val authRepository: AuthRepository,
    dataStoreManager: DataStoreManager
) : ViewModel() {

    val serverUrl = dataStoreManager.serverUrl.stateIn(
        scope = viewModelScope,
        started = SharingStarted.WhileSubscribed(5000),
        initialValue = ""
    )

    fun logout(onLogoutSuccess: () -> Unit) {
        viewModelScope.launch {
            authRepository.logout()
            onLogoutSuccess()
        }
    }
}
