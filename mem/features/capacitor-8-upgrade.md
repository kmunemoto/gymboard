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

## Windows側（Android）でやる必要がある作業
`android/` フォルダはgitignore対象でこのリポジトリに含まれない（ユーザーのPC上に
既存プロジェクトとして存在する前提）。以下を手動で行う:

1. **このブランチ/mainをpull → `npm install`**（package.jsonの更新を反映）
2. **`android/variables.gradle`** を編集:
   ```gradle
   minSdkVersion = 24        // 旧: 23
   compileSdkVersion = 36    // 旧: 35
   targetSdkVersion = 36     // 旧: 35
   ```
3. **Gradle wrapper を 8.14.3 に更新**（`android/gradle/wrapper/gradle-wrapper.properties`）
4. **Android Gradle Plugin (AGP) を 8.13.0 に更新**（`android/build.gradle`）。
   Android StudioのAGP Upgrade Assistantを使うのが安全。
5. **Android Studio を Otter (2025.2.1+) に更新**（未更新なら）
6. **Java 17以上（21推奨）** がAndroid Studioの設定で使われていることを確認。
   Kotlin 2.0+の場合、`kotlinOptions` ではなく新しい `compilerOptions` API を使う
   （プラグイン側の話。プロジェクト自体のbuild.gradleでKotlin DSLを直接書いていなければ
   通常は影響なし）
7. **`android/app/src/main/AndroidManifest.xml`** の `<activity>` の `android:configChanges`
   に `density` を追加（無いと画面密度変更時にActivityが再生成されずクラッシュ/表示崩れの
   リスク）。例: `android:configChanges="...|density"`
8. `npx cap sync android`
9. Android Studioでクリーンビルド → 実機/エミュレータで一通り確認
   （特にプッシュ通知・アプリバッジ・スプラッシュ・ステータスバー）
10. 新しい署名付きAAB/APKを生成し、Play Consoleへアップロード（versionCode/versionNameを
    上げること）

## 既知の挙動変化（ビルドは通るが視覚的に変わりうる）
Android 16 (API 36) をターゲットにすると、Android自体のedge-to-edge強制の影響で
`capacitor.config.ts` の `StatusBar.backgroundColor`（現在 `#FFFFFF`）が**効かなくなる**
（`overlaysWebView` / `backgroundColor` オプションはAPI 36+では無視される）。
実機で見た目（ステータスバー背景色）を確認し、必要ならCapacitorの新しい
System Bars core plugin か CSS env variables（safe-area系）での対応を別途検討する。
今回はコンプライアンス対応を優先し、この見た目の調整は別タスクとする。

## ⚠️ iOS CI (ios-build.yml) の未対応事項（要フォローアップ）
Capacitor 8 は **iOS のビルド方式を CocoaPods → Swift Package Manager (SPM) に変更**した。
`npx cap add ios` は `Podfile` を生成せず `Package.swift` を書き出す。
そのため現行の `.github/workflows/ios-build.yml` は run #102 で失敗した:
```
[info] Writing Package.swift                       ← SPM化の証拠
...
sed: ios/App/Podfile: No such file or directory    ← 「Fix Podfile for CI signing」で落ちる
```
CIワークフローの以下の手順が CocoaPods 前提で、SPM対応に書き換えが必要:
- 「Fix Podfile for CI signing」（`ios/App/Podfile` を sed で編集）→ Podfile が無いので削除。
  iOS deployment target は project.pbxproj 側（`IPHONEOS_DEPLOYMENT_TARGET`）で設定する。
  Pod の `CODE_SIGNING_ALLOWED=NO` 相当も Pods が無いので不要。
- 「Install CocoaPods」（`pod install`）→ 不要（削除）。
- 「Build archive」→ `-workspace App.xcworkspace` ではなく `-project App.xcodeproj` でビルドする
  （SPMではCocoaPodsの.xcworkspaceが生成されない。Xcodeが Package.swift の依存を解決する）。
- SPMの依存解決に時間がかかる/ネットワークが要る点、および `-scheme App` の指定は要確認。
成功するとApp Store Connectへ実アップロードされる（副作用あり）ため、修正の検証時は
バージョン/ビルド番号の扱いに注意し、むやみに連続実行しない。

## ピラボード（別アプリ）について
このリポジトリの対象外。同じ手順（Capacitor 7→8、Gradle/AGP更新、Play Console再申請）を
別途そちらのプロジェクトで行う必要がある。
