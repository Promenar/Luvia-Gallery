#!/bin/bash
#
#  package_release.sh
#  LuviaGalleryWidget 悬浮窗 Release 打包脚本
#
#  流程：archive → 导出 .app 到临时目录 → codesign 校验 →
#        ditto 打包 zip 到 dist/ → 删除临时 .app 副本。
#  注意：dist/ 里只保留 zip，不放 .app 本体，
#        避免 macOS 启动台把 dist 里的副本索引成多个图标。
#
#  用法：bash macos-widget/scripts/package_release.sh
#

set -euo pipefail

# --- 路径配置（脚本位置无关，统一从仓库根推导） ---
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WIDGET_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"                 # macos-widget/
PROJECT="${WIDGET_DIR}/LuviaGalleryWidget/LuviaGalleryWidget.xcodeproj"
SCHEME="LuviaGalleryWidget"
DIST_DIR="${WIDGET_DIR}/dist"
APP_NAME="LuviaGalleryWidget.app"

# 临时产物（不留在仓库内）
ARCHIVE_PATH="$(mktemp -d)/LuviaGalleryWidget.xcarchive"
TMP_APP_DIR="$(mktemp -d)"

# 退出时清理临时目录（archive 与临时 .app 副本）
cleanup() {
    rm -rf "$(dirname "${ARCHIVE_PATH}")" "${TMP_APP_DIR}"
}
trap cleanup EXIT

echo "==> [1/4] Release 归档（archive）"
xcodebuild \
    -project "${PROJECT}" \
    -scheme "${SCHEME}" \
    -configuration Release \
    -archivePath "${ARCHIVE_PATH}" \
    archive

echo "==> [2/4] 导出 .app 并校验签名"
cp -R "${ARCHIVE_PATH}/Products/Applications/${APP_NAME}" "${TMP_APP_DIR}/"
codesign --verify --deep --strict "${TMP_APP_DIR}/${APP_NAME}"
echo "    codesign 校验通过：$(codesign -dv --verbose=2 "${TMP_APP_DIR}/${APP_NAME}" 2>&1 | grep '^Authority=' | head -1)"

echo "==> [3/4] 打包 zip 到 dist/（dist 不保留 .app 本体，避免启动台多图标）"
mkdir -p "${DIST_DIR}"
rm -f "${DIST_DIR}/${APP_NAME}.zip"
rm -rf "${DIST_DIR}/${APP_NAME}"
ditto -c -k --sequesterRsrc --keepParent \
    "${TMP_APP_DIR}/${APP_NAME}" \
    "${DIST_DIR}/${APP_NAME}.zip"
# 临时 .app 副本随 trap 自动删除

echo "==> [4/4] 产物信息"
du -sh "${DIST_DIR}/${APP_NAME}.zip"

# 提示：DerivedData 里的 Debug 构建保留（日常调试还要用），此处仅提示不删除
DEBUG_APP_GLOB=~/Library/Developer/Xcode/DerivedData/LuviaGalleryWidget-*/Build/Products/Debug/LuviaGalleryWidget.app
# shellcheck disable=SC2086
if ls ${DEBUG_APP_GLOB} >/dev/null 2>&1; then
    echo "提示：检测到 DerivedData 中的 Debug 构建，已保留（调试用），如需清理可手动删除 DerivedData。"
fi

echo "完成：${DIST_DIR}/${APP_NAME}.zip"
