#!/usr/bin/env bash

set -u

project_root="$(cd "$(dirname "$0")/.." && pwd)"
status=0

require_text() {
    local file="$1"
    local expected="$2"
    local description="$3"

    if ! grep -Fq "$expected" "$project_root/$file"; then
        printf '缺少 %s：%s\n' "$description" "$expected" >&2
        status=1
    fi
}

require_text "app/build.gradle.kts" 'applicationId = "com.promenar.luvia"' "应用 ID"
require_text "settings.gradle.kts" 'include(":app")' "app 模块"
require_text "settings.gradle.kts" 'include(":core:model")' "core:model 模块"
require_text "settings.gradle.kts" 'include(":core:network")' "core:network 模块"
require_text "settings.gradle.kts" 'include(":core:designsystem")' "core:designsystem 模块"
require_text "settings.gradle.kts" 'include(":feature:auth")' "feature:auth 模块"
require_text "app/build.gradle.kts" 'compileSdk = 36' "编译 SDK"
require_text "app/build.gradle.kts" 'targetSdk = 36' "目标 SDK"
require_text "app/build.gradle.kts" 'minSdk = 26' "最低 SDK"

if [ "$status" -eq 0 ]; then
    printf 'Android 工程约束检查通过。\n'
fi

exit "$status"
