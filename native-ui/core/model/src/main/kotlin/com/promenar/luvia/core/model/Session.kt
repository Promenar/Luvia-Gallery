package com.promenar.luvia.core.model

data class Session(
    val token: String,
    val username: String,
    val isAdmin: Boolean,
)
