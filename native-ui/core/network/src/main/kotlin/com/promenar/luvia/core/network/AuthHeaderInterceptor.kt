package com.promenar.luvia.core.network

import okhttp3.Interceptor
import okhttp3.Response

class AuthHeaderInterceptor(
    private val tokenProvider: () -> String?,
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val token = tokenProvider()?.takeIf { it.isNotBlank() } ?: return chain.proceed(chain.request())
        val request = chain.request().newBuilder()
            .header("Authorization", "Bearer $token")
            .build()
        return chain.proceed(request)
    }
}
