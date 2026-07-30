package com.promenar.luvia.core.network

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Test

class AuthHeaderInterceptorTest {
    @Test
    fun `有 token 时覆盖所有旧认证头为唯一 Bearer 且不改变 URL`() {
        val server = MockWebServer()
        server.start()
        try {
            server.enqueue(MockResponse().setResponseCode(204))
            val client = OkHttpClient.Builder()
                .addInterceptor(AuthHeaderInterceptor { "session-token" })
                .build()
            val request = Request.Builder()
                .url(server.url("/library?view=grid"))
                .addHeader("Authorization", "Legacy one")
                .addHeader("Authorization", "Legacy two")
                .build()
            val originalUrl = request.url.toString()

            client.newCall(request).execute().use { }

            val received = server.takeRequest()
            assertEquals(listOf("Bearer session-token"), received.headers.values("Authorization"))
            assertEquals("/library?view=grid", received.path)
            assertEquals(originalUrl, request.url.toString())
        } finally {
            server.close()
        }
    }

    @Test
    fun `null token 会移除旧认证头且保持 URL`() {
        assertMissingTokenRemovesAuthorization(null)
    }

    @Test
    fun `空字符串 token 会移除旧认证头且保持 URL`() {
        assertMissingTokenRemovesAuthorization("")
    }

    @Test
    fun `纯空白 token 会移除旧认证头且保持 URL`() {
        assertMissingTokenRemovesAuthorization(" \t\n ")
    }

    private fun assertMissingTokenRemovesAuthorization(token: String?) {
        val server = MockWebServer()
        server.start()
        try {
            server.enqueue(MockResponse().setResponseCode(204))
            val client = OkHttpClient.Builder()
                .addInterceptor(AuthHeaderInterceptor { token })
                .build()
            val request = Request.Builder()
                .url(server.url("/library?view=grid"))
                .addHeader("Authorization", "Legacy one")
                .addHeader("Authorization", "Legacy two")
                .build()
            val originalUrl = request.url.toString()

            client.newCall(request).execute().use { }

            val received = server.takeRequest()
            assertEquals(emptyList<String>(), received.headers.values("Authorization"))
            assertEquals(originalUrl, received.requestUrl.toString())
            assertEquals(originalUrl, request.url.toString())
        } finally {
            server.close()
        }
    }
}
