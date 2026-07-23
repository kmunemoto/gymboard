# アプリアイコン・スプラッシュのソースアセット（`assets/`）

## 目的
ネイティブ（iOS/Android）のランチャーアイコン・アダプティブアイコン・スプラッシュ画面を
`@capacitor/assets` で再生成するための**生成元ソース**を `assets/` に常設する。
これが無いと再生成しても旧デザインが復活する（過去、スプラッシュに旧アイコンが残る不具合が発生）。

## `assets/` の中身（すべて新デザイン＝盾＋GBモノグラム）
| ファイル | 用途 | サイズ/形式 |
|---|---|---|
| `icon-only.png` | iOS/レガシーAndroidのアイコン（＝ルートの `gymboard-app-icon-1024.PNG` と同一） | 1024×1024 |
| `icon-foreground.png` | Androidアダプティブアイコンの**前景**（白い盾＋GB・透明背景・安全ゾーン内に縮小配置） | 1024×1024 透過 |
| `icon-background.png` | Androidアダプティブアイコンの**背景**（ティールグラデーション、フルブリード） | 1024×1024 |
| `splash.png` | スプラッシュ（ライト）。新アイコンを白背景に中央配置。config の `backgroundColor:'#FFFFFF'` に一致 | 2732×2732 |
| `splash-dark.png` | スプラッシュ（ダーク）。同アイコンを暗背景に中央配置 | 2732×2732 |

- アイコンのマスター画像はルートの `gymboard-app-icon-1024.PNG`。`assets/icon-only.png` はその複製。
  アイコンを差し替える時は**両方**を更新する（ドリフト防止）。
- アダプティブ前景は安全ゾーン対策で確定アイコンの盾を scale 0.80 で中央に縮小配置している
  （円マスク・角丸マスクどちらでも盾が切れないことを確認済み）。

## iOS（自動・GitHub Actions）
`.github/workflows/ios-build.yml` が毎回下記を実行するため、**バージョンを上げてiOSビルドを回せば
アイコンもスプラッシュも自動で新デザインになる**（手作業不要）:
```
mkdir -p assets
cp gymboard-app-icon-1024.PNG assets/icon-only.png
npx @capacitor/assets@3 generate --ios
```
`assets/` を常設したことで、この `generate --ios` が `splash.png` / `splash-dark.png` も拾い、
iOSスプラッシュも新デザインで再生成される。

## Android（手動・Windows + Android Studio が必要）
クラウドセッションではネイティブビルド不可。ランチャーアイコン／スプラッシュは AAB に焼き込まれるため、
**新しいAABをビルドして再アップロードしない限り、実機の表示は変わらない**（サーバー側だけでは変更不可）。

Windows 側の手順:
```
# リポジトリ最新化後、プロジェクト直下で
npx @capacitor/assets@3 generate --android
npx cap sync android
# Android Studio で android/ を開いてクリーンビルド → AAB を作成
# Play Console にアップロード（内部テスト→本番）
```
`generate --android` が生成するもの:
- レガシーランチャーアイコン（`mipmap-*/ic_launcher.png` ほか）
- アダプティブアイコン（`ic_launcher_foreground` / `ic_launcher_background`）
  → Android 12+ の起動スプラッシュはこのアダプティブアイコンを使うので、これで起動画面も新デザインになる
- レガシースプラッシュ drawable（`splash.png` / `splash_dark.png`）

## 注意
- `assets/` は `.gitignore` 対象外（`android/` `ios/` のみ除外）。ソースはリポジトリで管理する。
- Play Store の**ストア掲載アイコン（512×512）**と**フィーチャーグラフィック（1024×500）**は
  AABとは別に Play Console のWeb UIから手動アップロードするストア用アセット（`public/icon-512.png` /
  `gymboard-feature-graphic-1024x500.png`）。アプリ内のアイコン/スプラッシュとは別管理。
