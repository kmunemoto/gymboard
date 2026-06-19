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
