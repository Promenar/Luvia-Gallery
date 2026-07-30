package com.promenar.luvia.core.network

import okhttp3.Interceptor
import okhttp3.Response

class AuthHeaderInterceptor(
    private val tokenProvider: () -> String?,
) : Interceptor {
    override fun intercept(chain: Interceptor.Chain): Response {
        val requestBuilder = chain.request().newBuilder().removeHeader("Authorization")
        val token = tokenProvider()?.takeIf { it.isNotBlank() }
        if (token != null) requestBuilder.header("Authorization", "Bearer $token")
        val request = requestBuilder.build()
        return chain.proceed(request)
    }
}
