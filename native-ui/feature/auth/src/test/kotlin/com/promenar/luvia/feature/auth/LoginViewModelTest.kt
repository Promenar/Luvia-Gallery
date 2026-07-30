package com.promenar.luvia.feature.auth

import com.promenar.luvia.core.model.Session
import com.promenar.luvia.core.network.ApiResult
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class LoginViewModelTest {
    private val dispatcher = StandardTestDispatcher()

    @Before
    fun setUp() {
        Dispatchers.setMain(dispatcher)
    }

    @After
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `初始状态为空且不可提交`() {
        val viewModel = LoginViewModel { _, _, _ -> ApiResult.NetworkError }

        assertEquals("", viewModel.uiState.value.serverUrl)
        assertEquals("", viewModel.uiState.value.username)
        assertEquals("", viewModel.uiState.value.password)
        assertFalse(viewModel.uiState.value.isLoginEnabled)
        assertFalse(viewModel.uiState.value.isSubmitting)
        assertFalse(viewModel.uiState.value.isAuthenticated)
    }

    @Test
    fun `字段更新后有效登录信息可以提交`() {
        val viewModel = LoginViewModel { _, _, _ -> ApiResult.NetworkError }

        viewModel.onAction(LoginAction.ServerUrlChanged("https://gallery.example.com"))
        viewModel.onAction(LoginAction.UsernameChanged("luvia"))
        viewModel.onAction(LoginAction.PasswordChanged("secret"))
        viewModel.onAction(LoginAction.TogglePasswordVisibility)

        assertEquals("https://gallery.example.com", viewModel.uiState.value.serverUrl)
        assertEquals("luvia", viewModel.uiState.value.username)
        assertEquals("secret", viewModel.uiState.value.password)
        assertTrue(viewModel.uiState.value.isPasswordVisible)
        assertTrue(viewModel.uiState.value.isLoginEnabled)
    }

    @Test
    fun `无效地址不会调用认证并显示稳定错误键`() = runTest {
        var loginAttempts = 0
        val viewModel = LoginViewModel { _, _, _ ->
            loginAttempts += 1
            ApiResult.NetworkError
        }

        viewModel.onAction(LoginAction.ServerUrlChanged("ftp://gallery.example.com"))
        viewModel.onAction(LoginAction.UsernameChanged("luvia"))
        viewModel.onAction(LoginAction.PasswordChanged("secret"))
        viewModel.onAction(LoginAction.Submit)
        dispatcher.scheduler.advanceUntilIdle()

        assertEquals(0, loginAttempts)
        assertEquals(LoginMessageKey.INVALID_SERVER_URL, viewModel.uiState.value.message)
        assertFalse(viewModel.uiState.value.isSubmitting)
    }

    @Test
    fun `重复提交只发起一次认证并在请求完成后认证`() = runTest {
        val result = CompletableDeferred<ApiResult<Session>>()
        var loginAttempts = 0
        val viewModel = LoginViewModel { _, _, _ ->
            loginAttempts += 1
            result.await()
        }
        fillValidCredentials(viewModel)

        viewModel.onAction(LoginAction.Submit)
        dispatcher.scheduler.runCurrent()
        viewModel.onAction(LoginAction.Submit)
        dispatcher.scheduler.runCurrent()

        assertEquals(1, loginAttempts)
        assertTrue(viewModel.uiState.value.isSubmitting)
        assertFalse(viewModel.uiState.value.isLoginEnabled)

        result.complete(ApiResult.Success(Session(token = "token", username = "luvia", isAdmin = true)))
        dispatcher.scheduler.advanceUntilIdle()

        assertFalse(viewModel.uiState.value.isSubmitting)
        assertTrue(viewModel.uiState.value.isAuthenticated)
    }

    @Test
    fun `认证成功会进入已认证状态`() = runTest {
        val session = Session(token = "token", username = "luvia", isAdmin = true)
        val viewModel = LoginViewModel { _, _, _ -> ApiResult.Success(session) }
        fillValidCredentials(viewModel)
        viewModel.onAction(LoginAction.TogglePasswordVisibility)

        viewModel.onAction(LoginAction.Submit)
        dispatcher.scheduler.advanceUntilIdle()

        assertTrue(viewModel.uiState.value.isAuthenticated)
        assertFalse(viewModel.uiState.value.isSubmitting)
        assertEquals("", viewModel.uiState.value.password)
        assertFalse(viewModel.uiState.value.isPasswordVisible)
        assertEquals(null, viewModel.uiState.value.message)
    }

    @Test
    fun `认证失败映射为稳定资源键`() = runTest {
        val cases: List<Pair<ApiResult<Session>, LoginMessageKey>> = listOf(
            ApiResult.Unauthorized to LoginMessageKey.UNAUTHORIZED,
            ApiResult.NetworkError to LoginMessageKey.NETWORK_ERROR,
        )

        cases.forEach { (result, expectedMessage) ->
            val viewModel = LoginViewModel { _, _, _ -> result }
            fillValidCredentials(viewModel)

            viewModel.onAction(LoginAction.Submit)
            dispatcher.scheduler.advanceUntilIdle()

            assertEquals(expectedMessage, viewModel.uiState.value.message)
            assertFalse(viewModel.uiState.value.isSubmitting)
            assertFalse(viewModel.uiState.value.isAuthenticated)
        }
    }

    private fun fillValidCredentials(viewModel: LoginViewModel) {
        viewModel.onAction(LoginAction.ServerUrlChanged("https://gallery.example.com"))
        viewModel.onAction(LoginAction.UsernameChanged("luvia"))
        viewModel.onAction(LoginAction.PasswordChanged("secret"))
    }
}
