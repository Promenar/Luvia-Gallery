package com.promenar.luvia.feature.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.promenar.luvia.core.model.Session
import com.promenar.luvia.core.network.ApiResult
import com.promenar.luvia.core.network.ServerUrl
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import okhttp3.HttpUrl

fun interface LoginAuthenticator {
    suspend fun login(serverUrl: HttpUrl, username: String, password: String): ApiResult<Session>
}

class LoginViewModel(
    private val authenticator: LoginAuthenticator,
) : ViewModel() {
    private val mutableUiState = MutableStateFlow(LoginUiState())
    val uiState: StateFlow<LoginUiState> = mutableUiState.asStateFlow()

    fun onAction(action: LoginAction) {
        when (action) {
            is LoginAction.ServerUrlChanged -> updateCredentials { copy(serverUrl = action.value) }
            is LoginAction.UsernameChanged -> updateCredentials { copy(username = action.value) }
            is LoginAction.PasswordChanged -> updateCredentials { copy(password = action.value) }
            LoginAction.TogglePasswordVisibility -> mutableUiState.update {
                it.copy(isPasswordVisible = !it.isPasswordVisible)
            }
            LoginAction.DismissMessage -> mutableUiState.update { it.copy(message = null) }
            LoginAction.Logout -> mutableUiState.update {
                it.copy(password = "", isAuthenticated = false, message = null)
            }
            LoginAction.Submit -> submit()
        }
    }

    private fun updateCredentials(transform: LoginUiState.() -> LoginUiState) {
        mutableUiState.update { current -> transform(current).copy(message = null) }
    }

    private fun submit() {
        val current = mutableUiState.value
        if (current.isSubmitting) return

        val serverUrl = ServerUrl.parse(current.serverUrl).getOrElse {
            mutableUiState.update { it.copy(message = LoginMessageKey.INVALID_SERVER_URL) }
            return
        }
        if (current.username.isBlank() || current.password.isBlank()) return

        mutableUiState.update { it.copy(isSubmitting = true, message = null) }
        viewModelScope.launch {
            val message = when (authenticator.login(serverUrl, current.username, current.password)) {
                is ApiResult.Success -> null
                ApiResult.Unauthorized -> LoginMessageKey.UNAUTHORIZED
                ApiResult.NetworkError -> LoginMessageKey.NETWORK_ERROR
                is ApiResult.HttpError, ApiResult.InvalidResponse -> LoginMessageKey.UNKNOWN_ERROR
            }
            mutableUiState.update {
                it.copy(
                    isSubmitting = false,
                    isAuthenticated = message == null,
                    message = message,
                )
            }
        }
    }
}
