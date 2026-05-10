package com.luvia.gallery.nativeui.ui.screens.auth

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.hilt.navigation.compose.hiltViewModel
import com.luvia.gallery.nativeui.ui.components.LuviaButton
import com.luvia.gallery.nativeui.ui.components.LuviaTextField

@Composable
fun LoginScreen(
    onLoginSuccess: () -> Unit,
    viewModel: LoginViewModel = hiltViewModel()
) {
    val state by viewModel.uiState.collectAsState()

    LaunchedEffect(state.isSuccess) {
        if (state.isSuccess) {
            onLoginSuccess()
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text(
            text = "Luvia Gallery",
            style = MaterialTheme.typography.headlineLarge,
            fontWeight = FontWeight.Bold
        )
        Text(
            text = "Private Media Hub",
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        
        Spacer(modifier = Modifier.height(48.dp))

        LuviaTextField(
            value = state.serverUrl,
            onValueChange = viewModel::onUrlChange,
            label = "Server URL (e.g. 192.168.1.100:3000)"
        )
        
        Spacer(modifier = Modifier.height(16.dp))

        LuviaTextField(
            value = state.username,
            onValueChange = viewModel::onUsernameChange,
            label = "Username"
        )
        
        Spacer(modifier = Modifier.height(16.dp))

        LuviaTextField(
            value = state.password,
            onValueChange = viewModel::onPasswordChange,
            label = "Password",
            visualTransformation = PasswordVisualTransformation()
        )
        
        Spacer(modifier = Modifier.height(32.dp))

        if (state.error != null) {
            Text(
                text = state.error!!,
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall
            )
            Spacer(modifier = Modifier.height(8.dp))
        }

        LuviaButton(
            text = if (state.isLoading) "Logging in..." else "Login",
            onClick = viewModel::login,
            enabled = !state.isLoading
        )
    }
}
