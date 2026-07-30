package com.promenar.luvia.core.network.auth

import com.promenar.luvia.core.model.Session
import com.promenar.luvia.core.network.ApiResult
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
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
        runTest {
            server.enqueue(jsonResponse(200, """{"token":"response-token","user":{"username":"alice","isAdmin":true}}"""))

            val result = repository().login(server.url("/"), "alice", "request-password")

            assertEquals(ApiResult.Success(Session("response-token", "alice", true)), result)
            val request = server.takeRequest()
            assertEquals("POST", request.method)
            assertEquals("/api/auth/login", request.path)
            assertEquals("application/json; charset=utf-8", request.getHeader("Content-Type"))
            assertEquals("{\"username\":\"alice\",\"password\":\"request-password\"}", request.body.readUtf8())
            assertFalse(request.requestUrl.toString().contains("request-password"))
            assertFalse(request.headers.toString().contains("request-password"))
            assertFalse(request.headers.toString().contains("response-token"))
        }
    }

    @Test
    fun `401 映射为 Unauthorized`() {
        runTest {
            server.enqueue(jsonResponse(401, """{"error":"invalid credentials response-token"}"""))

            val result = repository().login(server.url("/"), "alice", "request-password")

            assertEquals(ApiResult.Unauthorized, result)
            assertNoSensitiveData(result)
        }
    }

    @Test
    fun `服务端 5xx 映射为 HttpError 且不暴露响应体`() {
        runTest {
            server.enqueue(jsonResponse(503, """{"error":"internal details: response-token"}"""))

            val result = repository().login(server.url("/"), "alice", "request-password")

            assertEquals(ApiResult.HttpError(503), result)
            assertNoSensitiveData(result)
        }
    }

    @Test
    fun `传输异常映射为 NetworkError 且不泄漏密码`() {
        runTest {
            server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.DISCONNECT_AT_START))

            val result = repository().login(server.url("/"), "alice", "request-password")

            assertEquals(ApiResult.NetworkError, result)
            assertNoSensitiveData(result)
        }
    }

    @Test
    fun `缺少会话字段映射为 InvalidResponse 且不泄漏密码`() {
        runTest {
            server.enqueue(jsonResponse(200, """{"token":"response-token","user":{"username":"alice"}}"""))

            val result = repository().login(server.url("/"), "alice", "request-password")

            assertEquals(ApiResult.InvalidResponse, result)
            assertNoSensitiveData(result)
        }
    }

    @Test
    fun `格式错误 JSON 映射为 InvalidResponse 且异常不泄漏敏感值`() {
        runTest {
            server.enqueue(jsonResponse(200, """{"token":"response-token","user":malformed}"""))

            val result = repository().login(server.url("/"), "alice", "request-password")

            assertEquals(ApiResult.InvalidResponse, result)
            assertNoSensitiveData(result)
        }
    }

    @Test
    fun `取消协程不会被转换为 ApiResult`() {
        runTest {
            server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
            val job = async(start = CoroutineStart.UNDISPATCHED) {
                repository().login(server.url("/"), "alice", "request-password")
            }

            assertNotNull(server.takeRequest(5, TimeUnit.SECONDS))
            job.cancelAndJoin()

            assertTrue(job.isCancelled)
        }
    }

    private fun assertNoSensitiveData(result: ApiResult<*>) {
        assertFalse(result.toString().contains("request-password"))
        assertFalse(result.toString().contains("response-token"))
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
