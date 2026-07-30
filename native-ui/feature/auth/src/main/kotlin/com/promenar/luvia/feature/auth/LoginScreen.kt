package com.promenar.luvia.feature.auth

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.platform.testTag

object LoginTestTags {
    const val SERVER_URL = "login_server_url"
    const val USERNAME = "login_username"
    const val PASSWORD = "login_password"
    const val SUBMIT = "login_submit"
}

@Composable
fun LoginScreen(
    uiState: LoginUiState,
    onAction: (LoginAction) -> Unit,
    modifier: Modifier = Modifier,
) {
    val snackbarHostState = remember { SnackbarHostState() }
    val message = uiState.message
    val messageText = message?.toText()
    LaunchedEffect(message) {
        messageText?.let {
            snackbarHostState.showSnackbar(it)
            onAction(LoginAction.DismissMessage)
        }
    }

    Scaffold(
        modifier = modifier,
        snackbarHost = { SnackbarHost(hostState = snackbarHostState) },
    ) { contentPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(contentPadding)
                .padding(horizontal = 24.dp, vertical = 32.dp),
            verticalArrangement = Arrangement.Center,
        ) {
            Text(
                text = stringResource(R.string.login_title),
                style = MaterialTheme.typography.headlineMedium,
            )
            Spacer(Modifier.height(8.dp))
            Text(
                text = stringResource(R.string.login_subtitle),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.height(32.dp))
            OutlinedTextField(
                value = uiState.serverUrl,
                onValueChange = { onAction(LoginAction.ServerUrlChanged(it)) },
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 56.dp)
                    .testTag(LoginTestTags.SERVER_URL),
                label = { Text(stringResource(R.string.login_server_url_label)) },
                placeholder = { Text(stringResource(R.string.login_server_url_placeholder)) },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
                singleLine = true,
                enabled = !uiState.isSubmitting,
            )
            Spacer(Modifier.height(16.dp))
            OutlinedTextField(
                value = uiState.username,
                onValueChange = { onAction(LoginAction.UsernameChanged(it)) },
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 56.dp)
                    .testTag(LoginTestTags.USERNAME),
                label = { Text(stringResource(R.string.login_username_label)) },
                singleLine = true,
                enabled = !uiState.isSubmitting,
            )
            Spacer(Modifier.height(16.dp))
            OutlinedTextField(
                value = uiState.password,
                onValueChange = { onAction(LoginAction.PasswordChanged(it)) },
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 56.dp)
                    .testTag(LoginTestTags.PASSWORD),
                label = { Text(stringResource(R.string.login_password_label)) },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
                visualTransformation = if (uiState.isPasswordVisible) {
                    VisualTransformation.None
                } else {
                    PasswordVisualTransformation()
                },
                trailingIcon = {
                    PasswordVisibilityButton(
                        isPasswordVisible = uiState.isPasswordVisible,
                        onClick = { onAction(LoginAction.TogglePasswordVisibility) },
                    )
                },
                singleLine = true,
                enabled = !uiState.isSubmitting,
            )
            Spacer(Modifier.height(24.dp))
            Button(
                onClick = { onAction(LoginAction.Submit) },
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(min = 48.dp)
                    .testTag(LoginTestTags.SUBMIT),
                enabled = uiState.isLoginEnabled,
            ) {
                if (uiState.isSubmitting) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(20.dp),
                        strokeWidth = 2.dp,
                        color = MaterialTheme.colorScheme.onPrimary,
                    )
                    Spacer(Modifier.size(8.dp))
                    Text(stringResource(R.string.login_loading))
                } else {
                    Text(stringResource(R.string.login_action))
                }
            }
        }
    }
}

@Composable
private fun PasswordVisibilityButton(
    isPasswordVisible: Boolean,
    onClick: () -> Unit,
) {
    val description = stringResource(
        if (isPasswordVisible) R.string.login_hide_password else R.string.login_show_password,
    )
    val image: ImageVector = if (isPasswordVisible) Icons.Filled.VisibilityOff else Icons.Filled.Visibility
    IconButton(
        onClick = onClick,
        modifier = Modifier
            .size(48.dp)
            .semantics { contentDescription = description },
    ) {
        Icon(imageVector = image, contentDescription = null)
    }
}

@Composable
private fun LoginMessageKey.toText(): String = stringResource(toStringRes())

@StringRes
private fun LoginMessageKey.toStringRes(): Int = when (this) {
    LoginMessageKey.INVALID_SERVER_URL -> R.string.login_error_invalid_server
    LoginMessageKey.UNAUTHORIZED -> R.string.login_error_unauthorized
    LoginMessageKey.NETWORK_ERROR -> R.string.login_error_network
    LoginMessageKey.UNKNOWN_ERROR -> R.string.login_error_unknown
}
