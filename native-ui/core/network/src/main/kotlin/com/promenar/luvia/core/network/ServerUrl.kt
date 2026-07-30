package com.promenar.luvia.core.network

import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull

object ServerUrl {
    fun parse(raw: String): Result<HttpUrl> = runCatching {
        val normalized = if (raw.contains("://")) raw else "https://$raw"
        require(!authorityContainsAt(normalized)) { "服务器地址无效" }
        val url = normalized.toHttpUrlOrNull() ?: invalidUrl()

        require(url.scheme == "http" || url.scheme == "https") { "服务器地址无效" }
        require(url.encodedQuery == null && url.fragment == null) { "服务器地址无效" }

        val path = url.encodedPath.let { if (it.endsWith('/')) it else "$it/" }
        url.newBuilder().encodedPath(path).build()
    }.recoverCatching { invalidUrl() }

    private fun invalidUrl(): Nothing = throw IllegalArgumentException("服务器地址无效")

    private fun authorityContainsAt(url: String): Boolean {
        val authorityStart = url.indexOf("://") + 3
        if (authorityStart < 3) return false
        val authorityEnd = url.indexOfAny(charArrayOf('/', '?', '#'), authorityStart)
            .let { if (it == -1) url.length else it }
        val authority = url.substring(authorityStart, authorityEnd)
        return authority.contains('@') || authority.contains("%40", ignoreCase = true)
    }
}
