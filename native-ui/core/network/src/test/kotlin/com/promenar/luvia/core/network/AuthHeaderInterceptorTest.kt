package com.promenar.luvia.core.network

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
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
    fun `空或缺失 token 时移除所有旧认证头`() {
        val server = MockWebServer()
        server.start()
        try {
            server.enqueue(MockResponse().setResponseCode(204))
            val client = OkHttpClient.Builder()
                .addInterceptor(AuthHeaderInterceptor { null })
                .build()
            val request = Request.Builder()
                .url(server.url("/library"))
                .addHeader("Authorization", "Legacy one")
                .addHeader("Authorization", "Legacy two")
                .build()

            client.newCall(request).execute().use { }

            assertNull(server.takeRequest().getHeader("Authorization"))
        } finally {
            server.close()
        }
    }
}
