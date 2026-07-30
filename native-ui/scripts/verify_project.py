#!/usr/bin/env python3
"""校验第一阶段 Android 工程的静态构建约束。"""

from __future__ import annotations

import re
import sys
import tomllib
from pathlib import Path
from xml.etree import ElementTree


ANDROID_NAMESPACE = "http://schemas.android.com/apk/res/android"
ANDROID_ATTRIBUTE = f"{{{ANDROID_NAMESPACE}}}"
EXPECTED_PERMISSIONS = {
    "android.permission.INTERNET",
    "android.permission.ACCESS_NETWORK_STATE",
}


def strip_kotlin_comments_and_raw_strings(source: str) -> str:
    """剥离 Kotlin 注释及三引号字符串，保留普通字符串和换行。"""

    output: list[str] = []
    index = 0
    state = "code"
    quote = ""

    while index < len(source):
        character = source[index]

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

        if source.startswith("/*", index):
            depth = 1
            index += 2
            while index < len(source) and depth > 0:
                if source.startswith("/*", index):
                    depth += 1
                    index += 2
                elif source.startswith("*/", index):
                    depth -= 1
                    index += 2
                else:
                    if source[index] == "\n":
                        output.append("\n")
                    index += 1
            continue

        if source.startswith("//", index):
            index += 2
            while index < len(source) and source[index] != "\n":
                index += 1
            continue

        if source.startswith('"""', index):
            index += 3
            while index < len(source) and not source.startswith('"""', index):
                if source[index] == "\n":
                    output.append("\n")
                index += 1
            if index < len(source):
                index += 3
            continue

        if character in {"'", '"'}:
            output.append(character)
            state = "string"
            quote = character
            index += 1
            continue

        output.append(character)
        index += 1

    return "".join(output)


def parse_properties(source: str) -> dict[str, str]:
    """按 Gradle Properties 的 key/value 规则读取本任务所需条目。"""

    properties: dict[str, str] = {}
    for raw_line in source.splitlines():
        line = raw_line.lstrip()
        if not line or line.startswith(("#", "!")):
            continue
        separator_positions = [position for position in (line.find("="), line.find(":")) if position >= 0]
        if not separator_positions:
            continue
        separator = min(separator_positions)
        key = line[:separator].rstrip()
        value = line[separator + 1 :].lstrip()
        properties[key] = value
    return properties


class Verifier:
    def __init__(self, root: Path) -> None:
        self.root = root
        self.failures: list[str] = []

    def read_source(self, relative_path: str) -> str | None:
        path = self.root / relative_path
        try:
            return path.read_text(encoding="utf-8")
        except FileNotFoundError:
            self.failures.append(f"缺少文件：{relative_path}")
            return None

    def require_kotlin_pattern(self, relative_path: str, pattern: str, description: str) -> None:
        source = self.read_source(relative_path)
        if source is None:
            return
        sanitized_source = strip_kotlin_comments_and_raw_strings(source)
        if not re.search(pattern, sanitized_source, flags=re.MULTILINE):
            self.failures.append(f"缺少或不匹配 {description}")

    def read_toml(self, relative_path: str) -> dict[str, object] | None:
        source = self.read_source(relative_path)
        if source is None:
            return None
        try:
            return tomllib.loads(source)
        except tomllib.TOMLDecodeError as error:
            self.failures.append(f"TOML 无法解析：{relative_path}：{error}")
            return None

    def read_properties(self, relative_path: str) -> dict[str, str] | None:
        source = self.read_source(relative_path)
        return parse_properties(source) if source is not None else None

    def require_toml_value(
        self,
        document: dict[str, object] | None,
        section: str,
        key: str,
        expected_value: str,
        description: str,
    ) -> None:
        if document is None:
            return
        actual_section = document.get(section)
        actual_value = actual_section.get(key) if isinstance(actual_section, dict) else None
        if actual_value != expected_value:
            self.failures.append(f"缺少或不匹配 {description}")

    def require_property(self, properties: dict[str, str] | None, key: str, expected_value: str, description: str) -> None:
        if properties is None:
            return
        if properties.get(key) != expected_value:
            self.failures.append(f"缺少或不匹配 {description}")

    def verify_static_constraints(self) -> None:
        versions = self.read_toml("gradle/libs.versions.toml")
        self.require_toml_value(versions, "versions", "agp", "9.0.1", "AGP 9.0.1")
        self.require_toml_value(versions, "versions", "kotlin", "2.4.10", "Kotlin 2.4.10")
        self.require_toml_value(versions, "versions", "composeBom", "2026.06.00", "Compose BOM 2026.06.00")

        wrapper = self.read_properties("gradle/wrapper/gradle-wrapper.properties")
        self.require_property(
            wrapper,
            "distributionUrl",
            "https\\://services.gradle.org/distributions/gradle-9.1.0-bin.zip",
            "Gradle 9.1.0 Wrapper",
        )
        self.require_property(
            wrapper,
            "distributionSha256Sum",
            "a17ddd85a26b6a7f5ddb71ff8b05fc5104c0202c6e64782429790c933686c806",
            "Gradle Wrapper 校验和",
        )

        self.require_kotlin_pattern(
            "app/build.gradle.kts",
            r'^\s*applicationId\s*=\s*"com\.promenar\.luvia"\s*$',
            "应用 ID",
        )
        for module in (":app", ":core:model", ":core:network", ":core:designsystem", ":feature:auth"):
            escaped_module = re.escape(module)
            self.require_kotlin_pattern(
                "settings.gradle.kts",
                rf'^\s*include\("{escaped_module}"\)\s*$',
                f"{module.removeprefix(':')} 模块",
            )

        self.require_kotlin_pattern("app/build.gradle.kts", r"^\s*compileSdk\s*=\s*36\s*$", "编译 SDK 36")
        self.require_kotlin_pattern("app/build.gradle.kts", r"^\s*targetSdk\s*=\s*36\s*$", "目标 SDK 36")
        self.require_kotlin_pattern("app/build.gradle.kts", r"^\s*minSdk\s*=\s*26\s*$", "最低 SDK 26")

        namespaces = {
            "core/model/build.gradle.kts": "com.promenar.luvia.core.model",
            "core/network/build.gradle.kts": "com.promenar.luvia.core.network",
            "core/designsystem/build.gradle.kts": "com.promenar.luvia.core.designsystem",
            "feature/auth/build.gradle.kts": "com.promenar.luvia.feature.auth",
        }
        for relative_path, namespace in namespaces.items():
            self.require_kotlin_pattern(
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
