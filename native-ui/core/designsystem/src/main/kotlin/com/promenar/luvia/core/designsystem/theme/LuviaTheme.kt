package com.promenar.luvia.core.designsystem.theme

import android.os.Build
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext

private val LightColorScheme = lightColorScheme(
    primary = Color(0xFF605BCE),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFE4E0FF),
    onPrimaryContainer = Color(0xFF1C1A65),
    secondary = Color(0xFF5D5D72),
    background = Color(0xFFFCF8FF),
    surface = Color(0xFFFCF8FF),
)

private val DarkColorScheme = darkColorScheme(
    primary = Color(0xFFC5C1FF),
    onPrimary = Color(0xFF302D7E),
    primaryContainer = Color(0xFF474496),
    onPrimaryContainer = Color(0xFFE4E0FF),
    secondary = Color(0xFFC6C4DC),
    background = Color(0xFF131318),
    surface = Color(0xFF131318),
)

@Composable
fun LuviaTheme(
    darkTheme: Boolean = androidx.compose.foundation.isSystemInDarkTheme(),
    dynamicColor: Boolean = true,
    content: @Composable () -> Unit,
) {
    val context = LocalContext.current
    val colorScheme = when {
        dynamicColor && Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> {
            if (darkTheme) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
        }
        darkTheme -> DarkColorScheme
        else -> LightColorScheme
    }

    MaterialTheme(
        colorScheme = colorScheme,
        typography = LuviaTypography,
        content = content,
    )
}
