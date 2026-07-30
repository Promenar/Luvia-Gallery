package com.promenar.luvia

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import com.promenar.luvia.core.designsystem.theme.LuviaTheme
import com.promenar.luvia.feature.auth.LoginScreen
import com.promenar.luvia.feature.auth.LoginTestTags
import com.promenar.luvia.feature.auth.LoginUiState
import org.junit.Rule
import org.junit.Test

class LoginScreenTest {
    @get:Rule
    val composeTestRule = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun 登录页提供三个字段语义且空输入不能提交() {
        composeTestRule.setContent {
            LuviaTheme {
                LoginScreen(uiState = LoginUiState(), onAction = {})
            }
        }

        composeTestRule.onNodeWithTag(LoginTestTags.SERVER_URL).assertExists()
        composeTestRule.onNodeWithTag(LoginTestTags.USERNAME).assertExists()
        composeTestRule.onNodeWithTag(LoginTestTags.PASSWORD).assertExists()
        composeTestRule.onNodeWithTag(LoginTestTags.SUBMIT).assertIsNotEnabled()
    }

    @Test
    fun 密码可见性切换具有内容描述() {
        composeTestRule.setContent {
            LuviaTheme {
                LoginScreen(uiState = LoginUiState(), onAction = {})
            }
        }

        composeTestRule.onNodeWithContentDescription("显示密码").assertExists()
    }
}
