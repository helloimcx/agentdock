#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

ANDROID_SDK="${ANDROID_HOME:-/opt/android-sdk}"
BUILD_TOOLS="$ANDROID_SDK/build-tools/34.0.0"
PLATFORM="$ANDROID_SDK/platforms/android-34"

AAPT2="$BUILD_TOOLS/aapt2"
D8="$BUILD_TOOLS/d8"
ZIPALIGN="$BUILD_TOOLS/zipalign"
if [ ! -x "$ZIPALIGN" ] && command -v zipalign >/dev/null 2>&1; then
  ZIPALIGN="$(command -v zipalign)"
fi
APKSIGNER="$BUILD_TOOLS/apksigner"
if [ ! -x "$APKSIGNER" ] && command -v apksigner >/dev/null 2>&1; then
  APKSIGNER="$(command -v apksigner)"
fi

echo "=== [1/6] 准备构建目录 ==="
mkdir -p build/compiled build/gen build/obj build/dex keystore
rm -rf build/compiled/* build/gen/* build/obj/* build/dex/* build/base.apk build/aligned.apk

echo "=== [2/6] 编译资源 (aapt2 compile) ==="
"$AAPT2" compile --dir src/main/res -o build/compiled/res.zip

echo "=== [3/6] 链接资源生成 R.java 与 base.apk (aapt2 link) ==="
"$AAPT2" link -I "$PLATFORM/android.jar" \
  --manifest src/main/AndroidManifest.xml \
  --java build/gen \
  -o build/base.apk \
  build/compiled/res.zip

echo "=== [4/6] 编译 Java 源码 (javac) ==="
javac -encoding UTF-8 \
  -cp "$PLATFORM/android.jar" \
  -d build/obj \
  build/gen/com/agentdock/a11y/R.java \
  src/main/java/com/agentdock/a11y/*.java

echo "=== [5/6] 生成 DEX (d8) ==="
"$D8" --output build/dex/ \
  --lib "$PLATFORM/android.jar" \
  build/obj/com/agentdock/a11y/*.class

cd build
zip -j -u base.apk dex/classes.dex
cd ..

echo "=== [6/6] 对齐并签名 APK (zipalign & apksigner) ==="
"$ZIPALIGN" -f -p 4 build/base.apk build/aligned.apk

KEYSTORE="$SCRIPT_DIR/keystore/debug.keystore"
if [ ! -f "$KEYSTORE" ]; then
  keytool -genkeypair -v \
    -keystore "$KEYSTORE" \
    -storepass android \
    -alias androiddebugkey \
    -keypass android \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -dname "CN=AgentDock,O=AgentDock,C=CN"
fi

"$APKSIGNER" sign \
  --ks "$KEYSTORE" \
  --ks-pass pass:android \
  --ks-key-alias androiddebugkey \
  --key-pass pass:android \
  --out agentdock-a11y.apk \
  build/aligned.apk

echo "=== ✅ 构建完成！产物路径: $SCRIPT_DIR/agentdock-a11y.apk ==="
ls -lh agentdock-a11y.apk
