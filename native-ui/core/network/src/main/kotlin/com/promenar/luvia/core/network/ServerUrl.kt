package com.promenar.luvia.core.network

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

object ServerUrl {
    fun parse(raw: String): Result<HttpUrl> = runCatching {
        val normalized = if (raw.contains("://")) raw else "https://$raw"
        val url = normalized.toHttpUrlOrNull() ?: invalidUrl()

        require(url.scheme == "http" || url.scheme == "https") { "服务器地址无效" }
        require(url.username.isEmpty() && url.password.isEmpty()) { "服务器地址无效" }
        require(url.querySize == 0 && url.fragment == null) { "服务器地址无效" }

        val path = url.encodedPath.let { if (it.endsWith('/')) it else "$it/" }
        url.newBuilder().encodedPath(path).build()
    }.recoverCatching { invalidUrl() }

    private fun invalidUrl(): Nothing = throw IllegalArgumentException("服务器地址无效")
}
