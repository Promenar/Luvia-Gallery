package com.promenar.luvia

import android.app.Application
import com.promenar.luvia.core.network.auth.AuthRepository

class LuviaApplication : Application() {
    val authRepository: AuthRepository by lazy(::AuthRepository)
}
