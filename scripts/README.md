# scripts/

| スクリプト | 用途 |
|---|---|
| `translate-locales.mjs` | `ja.json` を正として `en` / `ko` などの欠けを機械翻訳で補完（下記） |
| `extract-vertical-overlay.mjs` | 兄弟アプリが直接書き換えた `ja.json` から業種オーバーレイを抜き出す（下記） |
| `generate-app-icon.py` / `patch-android.mjs` / `build-android.bat` | ネイティブビルド補助 |
| `convert-sticker.py` | チャットのスタンプの絵を配布用の透過PNGにする（下記） |

---

# スタンプの書き出し（convert-sticker.py）

チャットのスタンプ（`mem/features/chat-stickers.md`）の絵を、生成したままの
JPG から配布用の透過 PNG（512×512・余白8%）にする。

```bash
python3 scripts/convert-sticker.py ~/Downloads/nice.jpg src/assets/stickers/nice.png
```

🔴 **白を「色で」消していない。** 外周から繋がっている白だけを塗りつぶしで消す。
単純に「白なら透明」にすると、**文字の白い縁取り・目のハイライト・切り抜き風の
白フチまで消える**。特に縁取りが消えると、濃い面の上で文字が読めなくなる。

書き出したら `src/lib/stickers.ts` に1行足すだけ（マイグレーションは不要）。
透過・寸法・重さ・一覧との対応は `src/test/chatStickers.test.ts` が見ている。

---

# 業種オーバーレイの抽出（extract-vertical-overlay.mjs）

兄弟アプリ（業種特化フォーク）が `src/locales/ja.json` を直接書き換えてしまっている場合に、
上流と値が違う葉だけを抜き出して `src/locales/vertical.ja.json` を作る移行ツール。

書き換えたまま上流を取り込むと、業種語彙が全部消えるか全ファイル衝突になる。
先にオーバーレイへ逃がしてから `ja.json` を上流に戻す
（手順は `mem/ops/vertical-fork.md`）。

```bash
# フォークのリポジトリで、上流を fetch 済みの状態から
git show upstream/main:src/locales/ja.json > /tmp/upstream-ja.json
node scripts/extract-vertical-overlay.mjs \
  /tmp/upstream-ja.json src/locales/ja.json src/locales/vertical.ja.json
git checkout upstream/main -- src/locales/ja.json
```

**警告は必ず読むこと。** オーバーレイは「上書き」しかできないので、

- フォークが**削除した**キー … 表現できない。上流の文言がそのまま出る
- フォークが**追加した**キー … 上流に無いので i18next が黙って無視する
- **形が変わった**キー（文字列↔オブジェクト↔配列）

の3つは人間の判断が要る。握り潰さず標準エラー出力に列挙する。

回帰テストは `src/test/extractVerticalOverlay.test.ts`。

---

# 翻訳ファイル自動生成

`src/locales/ja.json` を正として、欠けているキーを機械翻訳で `en.json` / `ko.json` に補完します。

## 使う翻訳API

**Lovable AI Gateway** (`google/gemini-2.5-flash`) を使用しています。
別途 DeepL / Google Cloud の契約は不要で、Lovable ワークスペースで発行する
`LOVABLE_API_KEY` をそのまま使えます。

### APIキーの取得

Lovable ダッシュボード → Workspace Settings → AI Gateway で API キーを発行。
取得した値を環境変数 `LOVABLE_API_KEY` として渡します（コミット禁止）。

例: `.env.local`（gitignore 済みであることを確認）

```
LOVABLE_API_KEY=lvbl_xxxxxxxxxxxx
```

## 実行方法

```bash
# 差分のみ翻訳（既存の en/ko 翻訳は保護される）
LOVABLE_API_KEY=xxxx npm run translate

# 全件再翻訳（手動調整した翻訳も上書きされる）
LOVABLE_API_KEY=xxxx npm run translate:force

# 片方の言語だけ
LOVABLE_API_KEY=xxxx node scripts/translate-locales.mjs --lang ko
```

## 仕組み

- `ja.json` をフラット化（`a.b.c` キー）して各値を翻訳対象に。
- 既に `en.json` / `ko.json` に値があるキーはスキップ（`--force` で上書き）。
- `{{variable}}` などの i18n 補間構文は `__VAR_N__` に退避 → 翻訳 → 復元、
  変数名が翻訳で壊れないように保護。
- 30 キーずつバッチで送信し、JSON モードで結果を受信。
- 出力はネスト構造を維持したまま `en.json` / `ko.json` を上書き保存。

## 注意

- ビルド時・開発時に **手動で実行** するスクリプトです。アプリ実行時には動きません。
- 機械翻訳のため、重要画面は人間が見直してください。
- 手動調整した翻訳は `--force` を付けない限り保持されます。
