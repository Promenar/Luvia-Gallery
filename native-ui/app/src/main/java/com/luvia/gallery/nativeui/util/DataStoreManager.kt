package com.luvia.gallery.nativeui.util

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import javax.inject.Inject
import javax.inject.Singleton

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "settings")

@Singleton
class DataStoreManager @Inject constructor(@ApplicationContext private val context: Context) {

    companion object {
        val SERVER_URL = stringPreferencesKey("server_url")
        val AUTH_TOKEN = stringPreferencesKey("auth_token")
    }

    val serverUrl: Flow<String?> = context.dataStore.data.map { it[SERVER_URL] }
    val authToken: Flow<String?> = context.dataStore.data.map { it[AUTH_TOKEN] }

    suspend fun saveServerUrl(url: String) {
        context.dataStore.edit { it[SERVER_URL] = url }
    }

    suspend fun saveAuthToken(token: String) {
        context.dataStore.edit { it[AUTH_TOKEN] = token }
    }

    suspend fun clear() {
        context.dataStore.edit { it.clear() }
    }
}
