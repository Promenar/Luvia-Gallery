#!/usr/bin/env python3
"""校验第一阶段 Android 工程的静态构建约束。"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from xml.etree import ElementTree


ANDROID_NAMESPACE = "http://schemas.android.com/apk/res/android"
ANDROID_ATTRIBUTE = f"{{{ANDROID_NAMESPACE}}}"
EXPECTED_PERMISSIONS = {
    "android.permission.INTERNET",
    "android.permission.ACCESS_NETWORK_STATE",
}


def strip_comments(source: str) -> str:
    """剥离代码注释，同时保留字符串和换行的位置。"""

    output: list[str] = []
    index = 0
    state = "code"
    quote = ""

    while index < len(source):
        character = source[index]
        following = source[index + 1] if index + 1 < len(source) else ""

        if state == "string":
            output.append(character)
            if character == "\\" and index + 1 < len(source):
                output.append(source[index + 1])
                index += 2
                continue
            if character == quote:
                state = "code"
                quote = ""
            index += 1
            continue

        if character in {"'", '"'}:
            output.append(character)
            state = "string"
            quote = character
            index += 1
            continue

        if character == "/" and following == "*":
            index += 2
            while index < len(source):
                if source[index] == "*" and index + 1 < len(source) and source[index + 1] == "/":
                    index += 2
                    break
                if source[index] == "\n":
                    output.append("\n")
                index += 1
            continue

        if character == "/" and following == "/" and (index == 0 or source[index - 1] != ":"):
            index += 2
            while index < len(source) and source[index] != "\n":
                index += 1
            continue

        if character == "#":
            while index < len(source) and source[index] != "\n":
                index += 1
            continue

        output.append(character)
        index += 1

    return "".join(output)


class Verifier:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.failures: list[str] = []

    def read_source(self, relative_path: str) -> str:
        path = self.root / relative_path
        try:
            return path.read_text(encoding="utf-8")
        except FileNotFoundError:
            self.failures.append(f"缺少文件：{relative_path}")
            return ""

    def require_pattern(self, relative_path: str, pattern: str, description: str) -> None:
        source = strip_comments(self.read_source(relative_path))
        if not re.search(pattern, source, flags=re.MULTILINE):
            self.failures.append(f"缺少或不匹配 {description}")

    def verify_static_constraints(self) -> None:
        self.require_pattern(
            "gradle/libs.versions.toml",
            r'^\s*agp\s*=\s*"9\.0\.1"\s*$',
            "AGP 9.0.1",
        )
        self.require_pattern(
            "gradle/libs.versions.toml",
            r'^\s*kotlin\s*=\s*"2\.4\.10"\s*$',
            "Kotlin 2.4.10",
        )
        self.require_pattern(
            "gradle/libs.versions.toml",
            r'^\s*composeBom\s*=\s*"2026\.06\.00"\s*$',
            "Compose BOM 2026.06.00",
        )
        self.require_pattern(
            "gradle/wrapper/gradle-wrapper.properties",
            r"^distributionUrl=.*gradle-9\.1\.0-bin\.zip$",
            "Gradle 9.1.0 Wrapper",
        )
        self.require_pattern(
            "gradle/wrapper/gradle-wrapper.properties",
            r"^distributionSha256Sum=a17ddd85a26b6a7f5ddb71ff8b05fc5104c0202c6e64782429790c933686c806$",
            "Gradle Wrapper 校验和",
        )

        self.require_pattern(
            "app/build.gradle.kts",
            r'^\s*applicationId\s*=\s*"com\.promenar\.luvia"\s*$',
            "应用 ID",
        )
        for module in (":app", ":core:model", ":core:network", ":core:designsystem", ":feature:auth"):
            escaped_module = re.escape(module)
            self.require_pattern(
                "settings.gradle.kts",
                rf'^\s*include\("{escaped_module}"\)\s*$',
                f"{module.removeprefix(':')} 模块",
            )

        self.require_pattern("app/build.gradle.kts", r"^\s*compileSdk\s*=\s*36\s*$", "编译 SDK 36")
        self.require_pattern("app/build.gradle.kts", r"^\s*targetSdk\s*=\s*36\s*$", "目标 SDK 36")
        self.require_pattern("app/build.gradle.kts", r"^\s*minSdk\s*=\s*26\s*$", "最低 SDK 26")

        namespaces = {
            "core/model/build.gradle.kts": "com.promenar.luvia.core.model",
            "core/network/build.gradle.kts": "com.promenar.luvia.core.network",
            "core/designsystem/build.gradle.kts": "com.promenar.luvia.core.designsystem",
            "feature/auth/build.gradle.kts": "com.promenar.luvia.feature.auth",
        }
        for relative_path, namespace in namespaces.items():
            self.require_pattern(
                relative_path,
                rf'^\s*namespace\s*=\s*"{re.escape(namespace)}"\s*$',
                f"{namespace} namespace",
            )

    def verify_manifest(self) -> None:
        manifest_path = self.root / "app/src/main/AndroidManifest.xml"
        try:
            root = ElementTree.parse(manifest_path).getroot()
        except FileNotFoundError:
            self.failures.append("缺少文件：app/src/main/AndroidManifest.xml")
            return
        except ElementTree.ParseError as error:
            self.failures.append(f"Manifest XML 无法解析：{error}")
            return

        permissions = [
            element.get(f"{ANDROID_ATTRIBUTE}name")
            for element in root
            if element.tag == "uses-permission"
        ]
        if len(permissions) != len(EXPECTED_PERMISSIONS) or set(permissions) != EXPECTED_PERMISSIONS:
            self.failures.append("Manifest 权限必须且只能为 INTERNET 与 ACCESS_NETWORK_STATE")

        application = root.find("application")
        if application is None:
            self.failures.append("Manifest 缺少 application 节点")
            return

        cleartext_value = application.get(f"{ANDROID_ATTRIBUTE}usesCleartextTraffic")
        if cleartext_value not in {None, "false"}:
            self.failures.append("Manifest 只允许缺省或字面量 false 的 usesCleartextTraffic")

    def run(self) -> int:
        self.verify_static_constraints()
        self.verify_manifest()
        if self.failures:
            for failure in self.failures:
                print(failure, file=sys.stderr)
            return 1
        print("Android 工程约束检查通过。")
        return 0


def main() -> int:
    if len(sys.argv) > 2:
        print("用法：verify_project.py [项目根目录]", file=sys.stderr)
        return 2
    root = Path(sys.argv[1]).resolve() if len(sys.argv) == 2 else Path(__file__).resolve().parent.parent
    return Verifier(root).run()


if __name__ == "__main__":
    raise SystemExit(main())
