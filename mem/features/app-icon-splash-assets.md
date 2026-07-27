# アプリアイコン・スプラッシュのソースアセット（`assets/`）

## 目的
ネイティブ（iOS/Android）のランチャーアイコン・アダプティブアイコン・スプラッシュ画面を
`@capacitor/assets` で再生成するための**生成元ソース**を `assets/` に常設する。
これが無いと再生成しても旧デザインが復活する（過去、スプラッシュに旧アイコンが残る不具合が発生）。

## 現在のデザイン（2026-07 更新）
盾＋GBモノグラムはそのまま、**背景を冬の雪山に変更**した（オーナーの希望）。
それ以前はティールのグラデーション。

## `assets/` の中身
| ファイル | 用途 | サイズ/形式 |
|---|---|---|
| `icon-emblem-src.png` | **盾とGBの抽出元**（旧ティール版アイコン）。生成物ではなくソース | 1024×1024 |
| `feature-text-src.png` | **「ジムボード」の白文字の抽出元**（透過）。生成物ではなくソース | 1024×500 透過 |
| `icon-only.png` | iOS/レガシーAndroidのアイコン（＝ルートの `gymboard-app-icon-1024.PNG` と同一） | 1024×1024 |
| `icon-foreground.png` | Androidアダプティブアイコンの**前景**（白い盾＋GB・透明背景・安全ゾーン内に縮小配置） | 1024×1024 透過 |
| `icon-background.png` | Androidアダプティブアイコンの**背景**（雪山、フルブリード） | 1024×1024 |
| `splash.png` | スプラッシュ（ライト）。アイコンを白背景に中央配置。config の `backgroundColor:'#FFFFFF'` に一致 | 2732×2732 |
| `splash-dark.png` | スプラッシュ（ダーク）。同アイコンを暗背景に中央配置 | 2732×2732 |

- アイコンのマスター画像はルートの `gymboard-app-icon-1024.PNG`。`assets/icon-only.png` はその複製。
  下記スクリプトは**両方を同時に書き出す**ので、手で片方だけ差し替えないこと（ドリフト防止）。
- アダプティブ前景は安全ゾーン対策で確定アイコンの盾を scale 0.80 で中央に縮小配置している
  （円マスク・角丸マスクどちらでも盾が切れないことを確認済み）。

## 生成: `scripts/generate-app-icon.py`
```
python3 scripts/generate-app-icon.py     # 要 numpy + Pillow、プロジェクト直下で実行
```
背景（雪山・空・粉雪）をコードで描き、盾とGBを載せて次を一括で書き出す。
固定シードなので、流し直しても同じ絵になる。

- 上表の `assets/` 5点
- Web/PWA: `public/icon-192.png` `icon-512.png` `apple-touch-icon.png` `favicon.png` `favicon.ico`
- **`src/assets/gymboard-loader.png`** — アプリ内のローディング表示（角丸・透過）
- **`gymboard-feature-graphic-1024x500.png`** — Play Console のフィーチャーグラフィック

**季節ごとにデザインを変えたい場合はこのファイルの定数を編集して流し直す。**
`Canvas` は任意のアスペクト比を扱えるので、正方形のアイコンと横長のフィーチャー
グラフィックを同じ描画コードから出している（空の濃さと稜線だけ別定数）。

注意点:
- **抽出元は `assets/icon-emblem-src.png` と `assets/feature-text-src.png`。
  出力先（`assets/icon-only.png` など）を指定してはいけない**
  （自分の出力を読み直すことになり、流すたびに絵柄が劣化する）。
- 盾の輪郭は「各行の白の左右端」から復元している。文字は白い面の内側にしか無いので
  行ごとの端は必ず盾の輪郭になる、という前提に乗っている。
- 字形は自前で描き起こさない。コンテナのフォントに元デザインと同じ字形が無く、
  描き直すとブランドの見た目が変わるため。「ジムボード」の書体も同じ理由で抽出している。

`src/test/appIconAssets.test.ts` が次を見張る: ローディングがアプリアイコンを使っていること、
各アセットの寸法、ルートのマスターと `assets/icon-only.png` の一致、抽出元と出力先が
別ファイルであること。

## アプリ内のローディング表示
`src/components/ui/dumbbell-loader.tsx`（`DumbbellLoader`）。40箇所以上から呼ばれている。
以前は**FIFAワールドカップのトロフィー画像**を出していた。商用アプリに他社の商標を
出すのは事故なので、アプリアイコンに差し替えて画像ごと削除した。

アイコンをそのまま貼ると「青い四角」に見えるので角を丸めてある。背景を持つ画像なので、
明るい画面でも暗い画面でも沈まない（白い盾だけだと明るい背景で消える）。

コンポーネント名は歴史的なもの（ダンベル → トロフィー → アプリアイコン）。
改名は40箇所以上に及ぶため見送っている。

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
