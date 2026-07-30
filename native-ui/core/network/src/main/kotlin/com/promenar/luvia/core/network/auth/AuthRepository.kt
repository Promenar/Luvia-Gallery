package com.promenar.luvia.core.network.auth

import com.promenar.luvia.core.model.Session
import com.promenar.luvia.core.network.ApiResult
import java.io.IOException
import java.util.concurrent.CancellationException
import kotlinx.serialization.json.Json
import okhttp3.HttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import retrofit2.Retrofit
import retrofit2.converter.kotlinx.serialization.asConverterFactory

class AuthRepository(
    private val retrofitFactory: (HttpUrl) -> Retrofit = ::createRetrofit,
) {
    suspend fun login(serverUrl: HttpUrl, username: String, password: String): ApiResult<Session> = try {
        val response = retrofitFactory(serverUrl)
            .create(AuthApi::class.java)
            .login(LoginRequest(username, password))

        when {
            response.code() == 401 -> ApiResult.Unauthorized
            !response.isSuccessful -> ApiResult.HttpError(response.code())
            else -> response.body()?.toSession()?.let { session ->
                ApiResult.Success(session)
            } ?: ApiResult.InvalidResponse
        }
    } catch (_: IOException) {
        ApiResult.NetworkError
    } catch (exception: CancellationException) {
        throw exception
    } catch (_: Exception) {
        ApiResult.InvalidResponse
    }

    private fun LoginResponse.toSession(): Session? {
        val responseUser = user ?: return null
        val responseToken = token?.takeIf { it.isNotBlank() } ?: return null
        val responseUsername = responseUser.username?.takeIf { it.isNotBlank() } ?: return null
        val responseIsAdmin = responseUser.isAdmin ?: return null
        return Session(responseToken, responseUsername, responseIsAdmin)
    }

    private companion object {
        fun createRetrofit(serverUrl: HttpUrl): Retrofit = Retrofit.Builder()
            .baseUrl(serverUrl)
            .client(OkHttpClient())
            .addConverterFactory(
                networkJson.asConverterFactory("application/json".toMediaType()),
            )
            .build()

        val networkJson = Json { ignoreUnknownKeys = true }
    }
}
