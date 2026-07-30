package com.promenar.luvia.core.network.auth

import com.promenar.luvia.core.model.Session
import com.promenar.luvia.core.network.ApiResult
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Before
import org.junit.Test
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory

class AuthRepositoryTest {
    private lateinit var server: MockWebServer

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
    }

    @After
    fun tearDown() {
        server.close()
    }

    @Test
    fun `登录成功时发送 JSON 并映射 Session`() {
        server.enqueue(jsonResponse(200, """{"token":"session-token","user":{"username":"alice","isAdmin":true}}"""))

        val result = repository().login(server.url("/"), "alice", "correct-horse")

        assertEquals(ApiResult.Success(Session("session-token", "alice", true)), result)
        val request = server.takeRequest()
        assertEquals("POST", request.method)
        assertEquals("/api/auth/login", request.path)
        assertEquals("application/json; charset=utf-8", request.getHeader("Content-Type"))
        assertEquals("{\"username\":\"alice\",\"password\":\"correct-horse\"}", request.body.readUtf8())
    }

    @Test
    fun `401 映射为 Unauthorized`() {
        server.enqueue(jsonResponse(401, """{"error":"invalid credentials"}"""))

        val result = repository().login(server.url("/"), "alice", "not-to-leak")

        assertEquals(ApiResult.Unauthorized, result)
        assertFalse(result.toString().contains("not-to-leak"))
    }

    @Test
    fun `服务端 5xx 映射为 HttpError 且不暴露响应体`() {
        server.enqueue(jsonResponse(503, """{"error":"internal details: not-to-leak"}"""))

        val result = repository().login(server.url("/"), "alice", "not-to-leak")

        assertEquals(ApiResult.HttpError(503), result)
        assertFalse(result.toString().contains("not-to-leak"))
    }

    @Test
    fun `传输异常映射为 NetworkError 且不泄漏密码`() {
        server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AT_START))

        val result = repository().login(server.url("/"), "alice", "not-to-leak")

        assertEquals(ApiResult.NetworkError, result)
        assertFalse(result.toString().contains("not-to-leak"))
    }

    @Test
    fun `缺少会话字段映射为 InvalidResponse 且不泄漏密码`() {
        server.enqueue(jsonResponse(200, """{"token":"not-to-leak","user":{"username":"alice"}}"""))

        val result = repository().login(server.url("/"), "alice", "not-to-leak")

        assertEquals(ApiResult.InvalidResponse, result)
        assertFalse(result.toString().contains("not-to-leak"))
    }

    private fun repository(): AuthRepository = AuthRepository { baseUrl ->
        Retrofit.Builder()
            .baseUrl(baseUrl)
            .client(OkHttpClient())
            .addConverterFactory(networkJson.asConverterFactory("application/json".toMediaType()))
            .build()
    }

    private fun jsonResponse(code: Int, body: String): MockResponse = MockResponse()
        .setResponseCode(code)
        .setHeader("Content-Type", "application/json")
        .setBody(body)

    private companion object {
        val networkJson = Json { ignoreUnknownKeys = true }
    }
}
