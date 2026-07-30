#!/usr/bin/env bash

set -u

script_dir="$(cd "$(dirname "$0")" && pwd)"
project_root="$(cd "$script_dir/.." && pwd)"
verifier="$script_dir/verify-project.sh"
temporary_root="$(mktemp -d)"

cleanup() {
    rm -rf "$temporary_root"
}
trap cleanup EXIT HUP INT TERM

failures=0

create_fixture() {
    local fixture_name="$1"
    local fixture_root="$temporary_root/$fixture_name"

    mkdir -p "$fixture_root/app/src/main" "$fixture_root/core" "$fixture_root/feature"
    cp "$project_root/settings.gradle.kts" "$fixture_root/settings.gradle.kts"
    cp -R "$project_root/gradle" "$fixture_root/gradle"
    cp "$project_root/app/build.gradle.kts" "$fixture_root/app/build.gradle.kts"
    cp "$project_root/app/src/main/AndroidManifest.xml" "$fixture_root/app/src/main/AndroidManifest.xml"
    cp -R "$project_root/core/model" "$fixture_root/core/model"
    cp -R "$project_root/core/network" "$fixture_root/core/network"
    cp -R "$project_root/core/designsystem" "$fixture_root/core/designsystem"
    cp -R "$project_root/feature/auth" "$fixture_root/feature/auth"
    printf '%s\n' "$fixture_root"
}

replace_once() {
    local file="$1"
    local before="$2"
    local after="$3"

    python3 - "$file" "$before" "$after" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
before, after = sys.argv[2:]
content = path.read_text(encoding="utf-8")
if before not in content:
    raise SystemExit(f"替换目标不存在：{before}")
path.write_text(content.replace(before, after, 1), encoding="utf-8")
PY
}

expect_result() {
    local case_name="$1"
    local expected_status="$2"
    local fixture_root="$3"

    if bash "$verifier" "$fixture_root" >/dev/null 2>&1; then
        actual_status=0
    else
        actual_status=1
    fi

    if [ "$actual_status" -ne "$expected_status" ]; then
        printf '失败：%s（期望 %s，实际 %s）\n' "$case_name" "$expected_status" "$actual_status" >&2
        failures=$((failures + 1))
    else
        printf '通过：%s\n' "$case_name"
    fi
}

fixture_root="$(create_fixture block-comment-version)"
replace_once "$fixture_root/gradle/libs.versions.toml" \
    'agp = "9.0.1"' \
    $'/*\nagp = "9.0.1"\n*/\nagp = "9.0.0"'
expect_result "块注释中的伪装版本必须失败" 1 "$fixture_root"

fixture_root="$(create_fixture same-line-permissions)"
replace_once "$fixture_root/app/src/main/AndroidManifest.xml" \
    $'    <uses-permission android:name="android.permission.INTERNET" />\n    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />' \
    '    <uses-permission android:name="android.permission.INTERNET" /><uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />'
expect_result "同一行两项合法权限必须通过" 0 "$fixture_root"

fixture_root="$(create_fixture multiline-single-quote-permissions)"
replace_once "$fixture_root/app/src/main/AndroidManifest.xml" \
    $'    <uses-permission android:name="android.permission.INTERNET" />\n    <uses-permission android:name="android.permission.ACCESS_NETWORK_STATE" />' \
    $'    <uses-permission\n        android:name=\'android.permission.INTERNET\' />\n    <uses-permission\n        android:name=\'android.permission.ACCESS_NETWORK_STATE\' />'
expect_result "跨行单引号的合法 XML 必须通过" 0 "$fixture_root"

fixture_root="$(create_fixture cleartext-true)"
replace_once "$fixture_root/app/src/main/AndroidManifest.xml" \
    '        android:allowBackup="true"' \
    '        android:allowBackup="true" android:usesCleartextTraffic="true"'
expect_result "字面量 true 明文流量必须失败" 1 "$fixture_root"

fixture_root="$(create_fixture cleartext-resource)"
replace_once "$fixture_root/app/src/main/AndroidManifest.xml" \
    '        android:allowBackup="true"' \
    '        android:allowBackup="true" android:usesCleartextTraffic="@bool/cleartext"'
expect_result "资源引用明文流量必须失败" 1 "$fixture_root"

if [ "$failures" -ne 0 ]; then
    printf '验证脚本回归失败：%s 项。\n' "$failures" >&2
    exit 1
fi

printf '验证脚本回归通过。\n'
