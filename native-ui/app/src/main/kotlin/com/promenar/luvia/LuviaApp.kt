package com.promenar.luvia

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.lifecycle.viewmodel.initializer
import androidx.lifecycle.viewmodel.viewModelFactory
import com.promenar.luvia.core.designsystem.theme.LuviaTheme
import com.promenar.luvia.feature.auth.LoginAction
import com.promenar.luvia.feature.auth.LoginAuthenticator
import com.promenar.luvia.feature.auth.LoginScreen
import com.promenar.luvia.feature.auth.LoginViewModel

@Composable
fun LuviaApp() {
    val application = LocalContext.current.applicationContext as LuviaApplication
    LuviaApp(authenticator = LoginAuthenticator(application.authRepository::login))
}

@Composable
fun LuviaApp(authenticator: LoginAuthenticator) {
    val viewModel: LoginViewModel = viewModel(
        factory = viewModelFactory {
            initializer { LoginViewModel(authenticator) }
        },
    )
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()

    LuviaTheme {
        Surface(modifier = Modifier.fillMaxSize()) {
            if (uiState.isAuthenticated) {
                RewriteInProgressShell(
                    onLogout = { viewModel.onAction(LoginAction.Logout) },
                )
            } else {
                LoginScreen(
                    uiState = uiState,
                    onAction = viewModel::onAction,
                )
            }
        }
    }
}

object RewriteShellTestTags {
    const val SHELL = "rewrite_in_progress_shell"
    const val LOGOUT = "rewrite_in_progress_logout"
}

@Composable
fun RewriteInProgressShell(
    onLogout: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Scaffold(
        modifier = modifier.testTag(RewriteShellTestTags.SHELL),
        contentWindowInsets = WindowInsets.safeDrawing,
    ) { contentPadding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(contentPadding)
                .padding(horizontal = 24.dp, vertical = 24.dp),
            verticalArrangement = Arrangement.Center,
        ) {
            Text(
                text = stringResource(R.string.native_rewrite_in_progress),
                style = MaterialTheme.typography.headlineMedium,
            )
            Text(
                text = stringResource(R.string.native_rewrite_in_progress_detail),
                modifier = Modifier.padding(top = 12.dp),
                style = MaterialTheme.typography.bodyLarge,
            )
            Button(
                onClick = onLogout,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 24.dp)
                    .heightIn(min = 48.dp)
                    .testTag(RewriteShellTestTags.LOGOUT),
            ) {
                Text(stringResource(R.string.logout_action))
            }
        }
    }
}
