package com.luvia.gallery.nativeui.ui.screens.splash

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.luvia.gallery.nativeui.util.DataStoreManager
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import javax.inject.Inject

sealed interface SplashEvent {
    data object NavigateToLogin : SplashEvent
    data object NavigateToMain : SplashEvent
}

@HiltViewModel
class SplashViewModel @Inject constructor(
    private val dataStoreManager: DataStoreManager
) : ViewModel() {

    private val _events = MutableSharedFlow<SplashEvent>()
    val events = _events.asSharedFlow()

    init {
        checkAuth()
    }

    private fun checkAuth() {
        viewModelScope.launch {
            val token = dataStoreManager.authToken.first()
            if (token != null) {
                _events.emit(SplashEvent.NavigateToMain)
            } else {
                _events.emit(SplashEvent.NavigateToLogin)
            }
        }
    }
}
