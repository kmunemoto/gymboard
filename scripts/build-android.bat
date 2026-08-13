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

echo [5/5] patch android/ (Gradle + Manifest + google-services.json)
node scripts/patch-android.mjs || goto :err

echo.
echo ============================================================
echo  Current version in android\app\build.gradle:
REM 版数は Android Studio で手で設定する（2026-08-13 にそう決めた）。
REM リポジトリには持たないので、ここは**表示するだけ**。書き換えない。
REM
REM なぜ表示するか: android\ は .gitignore 済みで、この値はこの PC にしか無い。
REM 上げ忘れても Play にアップロードするまで気づけないので、
REM せめてビルド直後に現在値が目に入るようにしておく。
REM
REM ⚠️ npx cap add android で android\ を作り直すと Capacitor 既定値
REM    （versionCode 1 / versionName "1.0"）に戻る。そのときは Play Console の
REM    最新 versionCode を見て、それより大きい値を手で入れ直すこと。
REM /C: を2つ並べると「どちらかを含む行」。エラーでも止めない（参考表示なので）。
findstr /C:"versionCode" /C:"versionName" android\app\build.gradle
echo ============================================================
echo  DONE. Next manual steps:
echo   - Check Play Console for the last released versionCode
echo   - Android Studio: bump versionCode (+1) and versionName in app/build.gradle
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
