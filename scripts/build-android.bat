@echo off
REM ============================================================
REM  GymBoard Android build helper (run from project root)
REM  Prepares the Capacitor android/ project for FCM build.
REM ============================================================
setlocal

echo [1/5] git pull
REM npm install が書き換える package-lock.json のローカル変更で pull が中断するのを防ぐ。
REM （このファイルは npm install で再生成されるため破棄して問題ない）
git checkout -- package-lock.json 2>nul
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

echo [5/5] patch android/ (Gradle + Manifest + google-services.json)
node scripts/patch-android.mjs || goto :err

echo.
echo ============================================================
echo  DONE. Next manual steps:
echo   - Bump versionCode / versionName in android\app\build.gradle
echo   - npx cap open android
echo   - Android Studio: Build ^> Generate Signed App Bundle
echo   - Upload AAB to Google Play Console
echo ============================================================
exit /b 0

:err
echo.
echo [build-android] FAILED. See errors above.
exit /b 1
