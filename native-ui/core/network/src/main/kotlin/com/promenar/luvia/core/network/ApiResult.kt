package com.promenar.luvia.core.network

sealed interface ApiResult<out T> {
    data class Success<T>(val value: T) : ApiResult<T>

    data object Unauthorized : ApiResult<Nothing>

    data class HttpError(val code: Int) : ApiResult<Nothing>

    data object NetworkError : ApiResult<Nothing>

    data object InvalidResponse : ApiResult<Nothing>
}
