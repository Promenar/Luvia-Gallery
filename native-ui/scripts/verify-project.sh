#!/usr/bin/env bash

set -u

project_root="$(cd "$(dirname "$0")/.." && pwd)"
status=0

require_line() {
    local file="$1"
    local pattern="$2"
    local description="$3"

    if ! grep -Eq "$pattern" "$project_root/$file"; then
        printf '缺少或不匹配 %s\n' "$description" >&2
        status=1
    fi
}

require_line "gradle/libs.versions.toml" '^[[:space:]]*agp[[:space:]]*=[[:space:]]*"9\.0\.1"[[:space:]]*$' "AGP 9.0.1"
require_line "gradle/libs.versions.toml" '^[[:space:]]*kotlin[[:space:]]*=[[:space:]]*"2\.4\.10"[[:space:]]*$' "Kotlin 2.4.10"
require_line "gradle/libs.versions.toml" '^[[:space:]]*composeBom[[:space:]]*=[[:space:]]*"2026\.06\.00"[[:space:]]*$' "Compose BOM 2026.06.00"
require_line "gradle/wrapper/gradle-wrapper.properties" '^distributionUrl=.*gradle-9\.1\.0-bin\.zip$' "Gradle 9.1.0 Wrapper"
require_line "gradle/wrapper/gradle-wrapper.properties" '^distributionSha256Sum=a17ddd85a26b6a7f5ddb71ff8b05fc5104c0202c6e64782429790c933686c806$' "Gradle Wrapper 校验和"

require_line "app/build.gradle.kts" '^[[:space:]]*applicationId[[:space:]]*=[[:space:]]*"com\.promenar\.luvia"[[:space:]]*$' "应用 ID"
require_line "settings.gradle.kts" '^[[:space:]]*include\(":app"\)[[:space:]]*$' "app 模块"
require_line "settings.gradle.kts" '^[[:space:]]*include\(":core:model"\)[[:space:]]*$' "core:model 模块"
require_line "settings.gradle.kts" '^[[:space:]]*include\(":core:network"\)[[:space:]]*$' "core:network 模块"
require_line "settings.gradle.kts" '^[[:space:]]*include\(":core:designsystem"\)[[:space:]]*$' "core:designsystem 模块"
require_line "settings.gradle.kts" '^[[:space:]]*include\(":feature:auth"\)[[:space:]]*$' "feature:auth 模块"

require_line "app/build.gradle.kts" '^[[:space:]]*compileSdk[[:space:]]*=[[:space:]]*36[[:space:]]*$' "编译 SDK 36"
require_line "app/build.gradle.kts" '^[[:space:]]*targetSdk[[:space:]]*=[[:space:]]*36[[:space:]]*$' "目标 SDK 36"
require_line "app/build.gradle.kts" '^[[:space:]]*minSdk[[:space:]]*=[[:space:]]*26[[:space:]]*$' "最低 SDK 26"

require_line "core/model/build.gradle.kts" '^[[:space:]]*namespace[[:space:]]*=[[:space:]]*"com\.promenar\.luvia\.core\.model"[[:space:]]*$' "core:model namespace"
require_line "core/network/build.gradle.kts" '^[[:space:]]*namespace[[:space:]]*=[[:space:]]*"com\.promenar\.luvia\.core\.network"[[:space:]]*$' "core:network namespace"
require_line "core/designsystem/build.gradle.kts" '^[[:space:]]*namespace[[:space:]]*=[[:space:]]*"com\.promenar\.luvia\.core\.designsystem"[[:space:]]*$' "core:designsystem namespace"
require_line "feature/auth/build.gradle.kts" '^[[:space:]]*namespace[[:space:]]*=[[:space:]]*"com\.promenar\.luvia\.feature\.auth"[[:space:]]*$' "feature:auth namespace"

manifest_without_comments="$(awk '
    {
        line = $0
        output = ""
        while (length(line) > 0) {
            if (inside_comment) {
                end = index(line, "-->")
                if (end == 0) {
                    line = ""
                } else {
                    line = substr(line, end + 3)
                    inside_comment = 0
                }
            } else {
                start = index(line, "<!--")
                if (start == 0) {
                    output = output line
                    line = ""
                } else {
                    output = output substr(line, 1, start - 1)
                    line = substr(line, start + 4)
                    inside_comment = 1
                }
            }
        }
        if (output != "") print output
    }
' "$project_root/app/src/main/AndroidManifest.xml")"

actual_permissions="$(printf '%s\n' "$manifest_without_comments" | awk '
    /<uses-permission[[:space:]]/ {
        if (match($0, /android:name="[^"]+"/)) {
            permission = substr($0, RSTART, RLENGTH)
            sub(/^android:name="/, "", permission)
            sub(/"$/, "", permission)
            print permission
        } else {
            print "__INVALID_PERMISSION_DECLARATION__"
        }
    }
' | LC_ALL=C sort)"
expected_permissions="$(printf '%s\n' \
    'android.permission.ACCESS_NETWORK_STATE' \
    'android.permission.INTERNET' | LC_ALL=C sort)"

if [ "$actual_permissions" != "$expected_permissions" ]; then
    printf 'Manifest 权限必须且只能为 INTERNET 与 ACCESS_NETWORK_STATE\n' >&2
    status=1
fi

if printf '%s\n' "$manifest_without_comments" | grep -Eq 'android:usesCleartextTraffic[[:space:]]*=[[:space:]]*"true"'; then
    printf 'Manifest 不得开启全局明文流量\n' >&2
    status=1
fi

if [ "$status" -eq 0 ]; then
    printf 'Android 工程约束检查通过。\n'
fi

exit "$status"
