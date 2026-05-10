package com.luvia.gallery.nativeui.ui.navigation

import kotlinx.serialization.Serializable

sealed interface Screen {
    @Serializable
    data object Splash : Screen

    @Serializable
    data object Login : Screen

    @Serializable
    data object Main : Screen

    @Serializable
    data class MediaViewer(val mediaId: String) : Screen
}
