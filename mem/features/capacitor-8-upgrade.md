# Capacitor 7 → 8 アップグレード（Google Play 対象APIレベル要件対応）

## 背景
Google Playは2026/8/31までに、新規アプリ・アップデートの対象APIレベルを
Android 16（API level 36）以上にすることを義務付けている（延長申請で2026/11/1まで猶予可）。
Capacitor 7の標準はAPI 35までのため、API 36対応にはCapacitor 8への移行が必要。

参照:
- https://support.google.com/googleplay/android-developer/answer/11926878
- https://developer.android.com/google/play/requirements/target-sdk
- https://capacitorjs.com/docs/updating/8-0

## このリポジトリ（Web/JS側）で完了した対応
- `package.json`: `@capacitor/*` 系（core/cli/android/app/browser/haptics/keyboard/
  push-notifications/splash-screen/status-bar）を `^7` → `^8`（実際にnpm installされたのは
  8.4.2 / 8.1.1 / 8.0.4 / 8.0.2 / 8.0.5 / 8.1.2 / 8.0.2 / 8.0.3 等、当時のstable最新）
- `@capacitor-firebase/messaging`: `^7.5.0` → `^8.3.0`
- `@capawesome/capacitor-badge`: `^7.0.1` → `^8.0.2`
- `firebase`（JSパッケージ本体）: `^11.2.0` → `^12.6.0`
  （`@capacitor-firebase/messaging@8` の peer dependency 要件。src/ 内でこのパッケージを
  直接importしている箇所は無い＝ネイティブプラグインのビルド要件としてのみ必要。実アプリ
  コードへの影響なし）
- `.github/workflows/ios-build.yml`: `node-version` を `20` → `22`（Capacitor 8 は
  Node.js 22+ 必須）。`@capacitor/ios` のインストールも `^8` に固定。
  `IPHONEOS_DEPLOYMENT_TARGET` / Podfile の `platform :ios` は既に `16.0` で、
  新しい最低要件（iOS 15.0）を満たしているため変更不要。
- 検証済み: `npx tsc --noEmit` / `npx vitest run`（150件）/ `npm run build` すべて通過。
  このリポジトリで実際に使っているプラグインAPI（Capacitor.isNativePlatform/getPlatform、
  Browser.open、StatusBar.setStyle/setBackgroundColor、Keyboard.setResizeMode、
  App.addListener/exitApp、PushNotifications.checkPermissions/requestPermissions/
  register/addListener/removeAllListeners/removeAllDeliveredNotifications、
  FirebaseMessaging.checkPermissions/requestPermissions/getToken/addListener/
  removeAllListeners、Badge.clear）はすべて型エラー無く動く＝v8でも破壊的変更を受けていない。

## ここではできないこと（クラウドセッションの制約）
CLAUDE.mdの前提どおり、ネイティブビルド（Android Studio / Xcode実機ビルド）はこの
クラウドセッションでは実行・検証できない。iOSは `.github/workflows/ios-build.yml`
（workflow_dispatch）経由でCI上のmacOSランナーでのみ実ビルド検証が可能。
Androidは完全にWindows + Android Studio側の手作業が必要。

## android/ の Gradle 設定は `scripts/patch-android.mjs` が自動で直す（2026-07-26 追加）

**`npx cap sync android` は `variables.gradle` / `build.gradle` /
`gradle-wrapper.properties` を上書きしない。** 設定を壊さないための仕様だが、その結果
package.json の `@capacitor/*` だけ 8 に上げても android/ は 7 のまま取り残される。
実際にこれで 2026-07-26 に Play 用の AAB ビルドが失敗した:

```
2 issues were found when checking AAR metadata:
  2. Dependency 'androidx.browser:browser:1.9.0' requires
     Android Gradle plugin 8.9.1 or higher.
     This build currently uses Android Gradle plugin 8.7.2.
```

`androidx.browser:1.9.0`（`@capacitor/browser@8` の既定値）は compileSdk 36 と
AGP 8.9.1 以上を要求する。Capacitor 8 が引く `androidx.core 1.17.0` なども同様。

そのため `scripts/patch-android.mjs` が次を自動で行うようにした（冪等、`cap sync` の後に走る）:

| ファイル | 内容 |
|---|---|
| `android/variables.gradle` | minSdk 24 / compileSdk 36 / targetSdk 36 と AndroidX 各バージョン |
| `android/gradle/wrapper/gradle-wrapper.properties` | Gradle 8.14.3 |
| `android/build.gradle` | AGP 8.13.0 / google-services 4.4.4 |
| `android/app/src/main/AndroidManifest.xml` | `configChanges` に `navigation|density` |

値は Capacitor 8 の android-template と同一（8.0.0〜8.4.2 の全タグで一致を確認）。
知らないキー（`firebaseMessagingVersion` 等）と **`versionCode` / `versionName` は触らない**。

最後に検証を行い、直せなかった項目があれば**何が残ったかを表示して exit 1 する**
（`build-android.bat` は `|| goto :err` なのでそこで止まる）。
黙って成功扱いにすると、10分後に Gradle のエラーで気づくことになるため。

`src/test/patchAndroid.test.ts` がモックの Capacitor 7 環境を組んで、この挙動を見張る。

## Windows側（Android）でやる作業
`android/` フォルダはgitignore対象でこのリポジトリに含まれない（ユーザーのPC上に
既存プロジェクトとして存在する前提）。

1. **`scripts\build-android.bat`** を実行（git pull → npm install → npm run build →
   `npx cap sync android` → `patch-android.mjs`）。Gradle 設定の更新はここで自動的に入る。
2. **Android Studio を Otter (2025.2.1+) に更新**（未更新なら）。古いと
   `The project is using an incompatible version (AGP 8.13.0)` で開けない。
   AGP 8.13 を扱える下限は Narwhal 3 Feature Drop (2025.1.3)。
3. **Gradle JDK を 21 に**（Settings > Build, Execution, Deployment > Build Tools > Gradle）。
   Capacitor 8 のネイティブモジュールは Java 21 でコンパイルされるため、17 のままだと
   `error: invalid source release: 21` で落ちる。AGP 自体の下限は 17 なので
   AGP は文句を言わず、コンパイル段階で初めて落ちる＝原因が分かりにくい。
4. **SDK Manager で Android 16 (API 36) の SDK Platform** を入れる
   （`Failed to find target with hash string 'android-36'` が出たら）。
5. `versionCode` を +1、`versionName` を更新（`android/app/build.gradle`）。
6. Android Studioでクリーンビルド → 実機/エミュレータで一通り確認
   （特にプッシュ通知・アプリバッジ・スプラッシュ・ステータスバー）
7. 新しい署名付きAAB/APKを生成し、Play Consoleへアップロード

> **⚠️ 2026-08-02 以降、5〜7 は公式リリースの経路ではない。**
> Android も GitHub Actions（`.github/workflows/android-build.yml`）でビルド・署名・
> Play Console へのアップロードまで行う（`mem/features/android-ci.md`）。
> バージョンは `android-build.yml` の `ANDROID_VERSION_NAME` を書き換える
> （手作業時代の実績は versionCode 81 / versionName 9.0）。
> 1〜4・6 は実機での動作確認用途としては引き続き有効。

### やってはいけないこと
- **`android/` を消して `npx cap add android` で作り直す。** `versionCode` が 1 に戻り
  Play Console が `Version code 1 has already been used` で弾く。署名設定・アイコン・
  `google-services.json` も失われる。
- **AGP を 9.x に上げる。** Upgrade Assistant が勧めてくるが、
  `getDefaultProguardFile('proguard-android.txt')` が廃止されて別のエラーになる。
  Capacitor 8 との組み合わせも未検証。**8.13.0 で止める。**
- **`androidxCoreVersion` を 1.18.0 以降にする。** 1.18.0 から compileSdk 36.1 を要求するため、
  compileSdk 36 のままだと再び AAR metadata エラーになる。
- **`npx cap migrate` を Windows で使う。** 内部で `./gradlew wrapper` を叩くため失敗しうる。
  `patch-android.mjs` で同じことをやる。

## 既知の挙動変化（ビルドは通るが視覚的に変わりうる）
Android 16 (API 36) をターゲットにすると、Android自体のedge-to-edge強制の影響で
`capacitor.config.ts` の `StatusBar.backgroundColor`（現在 `#FFFFFF`）が**効かなくなる**
（`overlaysWebView` / `backgroundColor` オプションはAPI 36+では無視される）。
実機で見た目（ステータスバー背景色）を確認し、必要ならCapacitorの新しい
System Bars core plugin か CSS env variables（safe-area系）での対応を別途検討する。
今回はコンプライアンス対応を優先し、この見た目の調整は別タスクとする。

## iOS CI (ios-build.yml) の SPM 対応（✅ 解決済み・run #104 で成功）
Capacitor 8 は **iOS のビルド方式を CocoaPods → Swift Package Manager (SPM) に変更**した。
`npx cap add ios` は `Podfile` / `.xcworkspace` を生成せず、`App.xcodeproj` +
`CapApp-SPM/Package.swift`（ローカルSPMパッケージ）を生成する。旧CI（CocoaPods前提）は
run #102・#103 で失敗し、以下の2段階で修正して run #104 で成功（build 104 / v1.3.9 を
App Store Connectへアップロード確認）。

**修正1: CocoaPods前提ステップの除去（run #102 の `sed: Podfile: No such file` 対応）**
- 「Fix Podfile for CI signing」ステップを削除（Podfileが無い。deployment target は
  project.pbxproj の `IPHONEOS_DEPLOYMENT_TARGET` で設定。Pods の CODE_SIGNING_ALLOWED=NO も不要）
- 「Install CocoaPods」(`pod install`)ステップを削除
- Build archive を `-workspace App.xcworkspace` → `-project App.xcodeproj` に変更
- 事前に `xcodebuild -resolvePackageDependencies -project App.xcodeproj -scheme App` を実行
- GoogleService-Info.plist配線でpbxprojを再保存する際、Capacitorの**ローカルSPM参照
  (CapApp-SPM)** が古い xcodeproj gem で消えると壊れるため、最新gemを使い保存後に
  `grep CapApp-SPM` でアサート

**修正2: SPMパッケージへの署名適用を防ぐ（run #103 の archive 失敗対応）**
run #103 は archive で `Firebase_FirebaseMessaging / GoogleUtilities_... does not support
provisioning profiles` で失敗。原因は `CODE_SIGN_IDENTITY` / `PROVISIONING_PROFILE_SPECIFIER`
を **xcodebuild のグローバル設定**で渡すと、SPMのパッケージターゲット（Firebase等の静的/
リソースターゲット＝プロファイル非対応）にも適用されるため（CocoaPods時代はPodfileの
`CODE_SIGNING_ALLOWED=NO` フックで回避していた部分）。
- 「Configure App signing」で xcodeproj gem を使い、署名設定（Manual / DEVELOPMENT_TEAM /
  CODE_SIGN_IDENTITY / PROVISIONING_PROFILE_SPECIFIER）を **App ターゲットのビルド構成にのみ**設定
- Build archive コマンドラインから署名系設定を全て除去（グローバル適用を回避）

**注意（今後の再実行時）**: このワークフローは **成功時のみ** App Store Connect へ
アップロードする（失敗時はアップロードされないので、失敗の反復は副作用なし）。
`MARKETING_VERSION` はワークフローにハードコード（この文書を書いた時点は 1.3.9。
現在値は `ios-build.yml` を見ること）、ビルド番号は `github.run_number`。
新バージョンを出すときは ios-build.yml の `Set marketing version` の値を更新すること。
**Android の `ANDROID_VERSION_NAME` は別の版数線**（iOS 1.4.x に対し Android 9.x）。
揃えようとして iOS 側に寄せると Android のバージョンが戻って見えるので注意
（`mem/features/android-ci.md`）。

## ピラボード（別アプリ）について
このリポジトリの対象外。同じ手順（Capacitor 7→8、Gradle/AGP更新、Play Console再申請）を
別途そちらのプロジェクトで行う必要がある。
