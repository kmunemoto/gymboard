@echo off
REM ============================================================
REM  GymBoard Android build helper (run from project root)
REM  Prepares the Capacitor android/ project for FCM build.
REM ============================================================
setlocal

echo [1/5] git pull
REM 「ビルドが作り直す成果物」のローカル変更で pull が中断するのを防ぐ。
REM どちらも下の手順で再生成されるため、ここで捨てて問題ない。
REM
REM  - package-lock.json          … [2/5] の npm install が書き換える
REM  - supabase/functions/mcp/index.ts … [3/5] の npm run build が書き換える
REM    （vite.config.ts の mcpPlugin() が生成する。手で直しても build で巻き戻るので、
REM      直したいときは生成元の src/lib/mcp/ を触ること）
REM
REM mcp/index.ts を入れ忘れていて、2回目以降のビルドが必ず
REM   error: Your local changes to the following files would be overwritten by merge:
REM           supabase/functions/mcp/index.ts
REM で止まっていた（2026-08-04 に発覚）。
git checkout -- package-lock.json 2>nul
git checkout -- supabase/functions/mcp/index.ts 2>nul
git pull || goto :err

echo [2/5] npm install (iOS ビルドと同じ依存。--legacy-peer-deps 必須)
call npm install --legacy-peer-deps || goto :err
REM 一部の依存は package.json に含まれない optional peer のため明示インストール。
REM これが無いと npm run build が @mediapipe/pose 等で失敗し、dist が更新されない。
REM --no-save: package.json / package-lock.json を汚さない（次回の git pull が中断しないように）。
call npm install @mediapipe/pose @tensorflow/tfjs-backend-webgpu @tensorflow/tfjs-backend-webgl @tensorflow/tfjs-core @tensorflow/tfjs-converter --no-save --legacy-peer-deps || goto :err

echo [3/5] npm run build (web) ... dist/ を最新化（失敗したらここで停止）
call npm run build || goto :err

echo [4/5] npx cap sync android
call npx cap sync android || goto :err

echo [5/6] patch android/ (Gradle + Manifest + google-services.json)
node scripts/patch-android.mjs || goto :err

echo [6/6] set version from android-version.json
REM versionCode / versionName は android-version.json（リポジトリ管理）が唯一の記録。
REM android\ は .gitignore 済みなので、ここに持たないと現在値がどこからも読めない。
REM 上げるときは android-version.json を編集してコミットすること。
node scripts/set-android-version.mjs || goto :err

echo.
echo ============================================================
echo  DONE. Next manual steps:
echo   - Verify versionCode in Play Console (must be higher than the last release)
echo   - npx cap open android
echo   - Android Studio: Build ^> Generate Signed App Bundle
echo   - Upload AAB to Google Play Console
echo   - Record the release in mem/features/android-ci.md
echo ============================================================
exit /b 0

:err
echo.
echo [build-android] FAILED. See errors above.
exit /b 1
