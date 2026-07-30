package com.promenar.luvia.core.network.auth

import kotlinx.serialization.Serializable

@Serializable
data class LoginRequest(
    val username: String,
    val password: String,
)

@Serializable
data class LoginResponse(
    val token: String? = null,
    val user: AuthUser? = null,
)

@Serializable
data class AuthUser(
    val username: String? = null,
    val isAdmin: Boolean? = null,
)
