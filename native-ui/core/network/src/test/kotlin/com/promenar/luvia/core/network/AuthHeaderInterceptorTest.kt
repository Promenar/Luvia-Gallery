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
    fun `有 token 时只添加 Bearer Authorization 且不改变 URL`() {
        val server = MockWebServer()
        server.start()
        try {
            server.enqueue(MockResponse().setResponseCode(204))
            val client = OkHttpClient.Builder()
                .addInterceptor(AuthHeaderInterceptor { "session-token" })
                .build()
            val request = Request.Builder().url(server.url("/library?view=grid")).build()
            val originalUrl = request.url.toString()

            client.newCall(request).execute().use { }

            val received = server.takeRequest()
            assertEquals("Bearer session-token", received.getHeader("Authorization"))
            assertEquals("/library?view=grid", received.path)
            assertEquals(originalUrl, request.url.toString())
        } finally {
            server.close()
        }
    }

    @Test
    fun `空 token 时不添加认证头`() {
        val server = MockWebServer()
        server.start()
        try {
            server.enqueue(MockResponse().setResponseCode(204))
            val client = OkHttpClient.Builder()
                .addInterceptor(AuthHeaderInterceptor { "" })
                .build()

            client.newCall(Request.Builder().url(server.url("/library")).build()).execute().use { }

            assertNull(server.takeRequest().getHeader("Authorization"))
        } finally {
            server.close()
        }
    }
}
