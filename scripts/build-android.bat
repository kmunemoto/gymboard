@echo off
REM ============================================================
REM  GymBoard Android build helper (run from project root)
REM  Prepares the Capacitor android/ project for FCM build.
REM ============================================================
setlocal

echo [1/5] git pull
git pull || goto :err

echo [2/5] npm install
call npm install || goto :err

echo [3/5] npm run build (web)
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
