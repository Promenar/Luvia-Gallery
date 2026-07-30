package com.promenar.luvia.feature.auth

/** 登录页面的稳定状态契约，界面通过资源映射展示消息。 */
data class LoginUiState(
    val serverUrl: String = "",
    val username: String = "",
    val password: String = "",
    val isPasswordVisible: Boolean = false,
    val isSubmitting: Boolean = false,
    val isAuthenticated: Boolean = false,
    val message: LoginMessageKey? = null,
) {
    val isLoginEnabled: Boolean
        get() = !isSubmitting &&
            serverUrl.isNotBlank() &&
            username.isNotBlank() &&
            password.isNotBlank() &&
            isValidServerUrl(serverUrl)
}

sealed interface LoginAction {
    data class ServerUrlChanged(val value: String) : LoginAction
    data class UsernameChanged(val value: String) : LoginAction
    data class PasswordChanged(val value: String) : LoginAction
    data object TogglePasswordVisibility : LoginAction
    data object Submit : LoginAction
    data object DismissMessage : LoginAction
    data object Logout : LoginAction
}

enum class LoginMessageKey {
    INVALID_SERVER_URL,
    UNAUTHORIZED,
    NETWORK_ERROR,
    UNKNOWN_ERROR,
}

internal fun isValidServerUrl(value: String): Boolean =
    com.promenar.luvia.core.network.ServerUrl.parse(value).isSuccess
