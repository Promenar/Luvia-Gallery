package com.promenar.luvia.core.network

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ServerUrlTest {
    @Test
    fun `缺少协议时自动补全 https`() {
        val result = ServerUrl.parse("gallery.example.com")

        assertTrue(result.isSuccess)
        assertEquals("https://gallery.example.com/", result.getOrThrow().toString())
    }

    @Test
    fun `保留显式端口并统一尾部斜杠`() {
        val result = ServerUrl.parse("http://gallery.example.com:8443")

        assertEquals("http://gallery.example.com:8443/", result.getOrThrow().toString())
    }

    @Test
    fun `保留合法 IPv6 与显式端口`() {
        val result = ServerUrl.parse("https://[2001:db8::1]:8443")

        assertEquals("https://[2001:db8::1]:8443/", result.getOrThrow().toString())
    }

    @Test
    fun `拒绝 query fragment 与用户信息`() {
        listOf(
            "https://gallery.example.com/?page=1",
            "https://gallery.example.com/#section",
            "https://@gallery.example.com/",
            "https://alice@gallery.example.com/",
            "https://:secret@gallery.example.com/",
            "https://%61lice%3Asecret@gallery.example.com/",
            "https://%40gallery.example.com/",
            "https://gallery.example.com/?",
            "https://gallery.example.com/#",
        ).forEach { raw ->
            val result = ServerUrl.parse(raw)

            assertTrue("应拒绝不安全服务器地址", result.isFailure)
            assertTrue(result.exceptionOrNull() is IllegalArgumentException)
        }
    }

    @Test
    fun `非法端口与凭证均不进入错误消息`() {
        listOf(
            "https://gallery.example.com:0",
            "https://gallery.example.com:65536",
            "https://alice:secret@gallery.example.com/",
        ).forEach { raw ->
            val result = ServerUrl.parse(raw)

            assertTrue(result.isFailure)
            assertFalse(result.exceptionOrNull()?.message.orEmpty().contains("secret"))
        }
    }

    @Test
    fun `拒绝非 HTTP 协议`() {
        val result = ServerUrl.parse("ftp://gallery.example.com")

        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull() is IllegalArgumentException)
    }
}
