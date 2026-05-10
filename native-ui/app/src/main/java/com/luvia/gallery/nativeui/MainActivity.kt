package com.luvia.gallery.nativeui

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.toRoute
import com.luvia.gallery.nativeui.ui.navigation.Screen
import com.luvia.gallery.nativeui.ui.screens.auth.LoginScreen
import com.luvia.gallery.nativeui.ui.screens.main.MainScreen
import com.luvia.gallery.nativeui.ui.screens.splash.SplashScreen
import com.luvia.gallery.nativeui.ui.screens.viewer.MediaViewerScreen
import dagger.hilt.android.AndroidEntryPoint
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            LuviaGalleryTheme {
                val navController = rememberNavController()
                Surface(
                    modifier = Modifier.fillMaxSize(),
                    color = MaterialTheme.colorScheme.background
                ) {
                    NavHost(
                        navController = navController,
                        startDestination = Screen.Splash
                    ) {
                        composable<Screen.Splash> {
                            SplashScreen(
                                onNavigateToLogin = {
                                    navController.navigate(Screen.Login) {
                                        popUpTo(Screen.Splash) { inclusive = true }
                                    }
                                },
                                onNavigateToMain = {
                                    navController.navigate(Screen.Main) {
                                        popUpTo(Screen.Splash) { inclusive = true }
                                    }
                                }
                            )
                        }
                        composable<Screen.Login> {
                            LoginScreen(
                                onLoginSuccess = {
                                    navController.navigate(Screen.Main) {
                                        popUpTo(Screen.Login) { inclusive = true }
                                    }
                                }
                            )
                        }
                        composable<Screen.Main> {
                            MainScreen(
                                onMediaClick = { mediaId ->
                                    navController.navigate(Screen.MediaViewer(mediaId))
                                },
                                onLogout = {
                                    navController.navigate(Screen.Login) {
                                        popUpTo(Screen.Main) { inclusive = true }
                                    }
                                }
                            )
                        }
                        composable<Screen.MediaViewer> { backStackEntry ->
                            val route = backStackEntry.toRoute<Screen.MediaViewer>()
                            MediaViewerScreen(
                                mediaId = route.mediaId,
                                onBack = { navController.popBackStack() }
                            )
                        }
                    }
                }
            }
        }
    }
}
