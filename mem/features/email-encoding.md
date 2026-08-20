# メール本文のエンコード

最終更新: 2026-08-18

## いまの方針: 本文に文字を挿入しない

**表示テキストを数値文字参照（`&#12515;`）にすれば本文は純 ASCII になる。**
quoted-printable は ASCII をそのまま通し、必要ならソフト改行 `=\n` を入れるが、
**これは受信側で完全に元へ戻る**（`&#125=\n15;` → `&#12515;`）。
つまり ASCII 化した時点で、こちらが行を折る必要は無い。

唯一やるのは「**元からある空白を改行に置き換える**」ことだけ。
HTML では空白も改行も同じ空白に畳まれるので、見た目は変わらない。

| 場所 | 役割 |
|---|---|
| `_shared/email-encoding.ts` の `makeEmailHtmlAsciiSafe` | HTML のテキストノードだけを ASCII 化（タグ・属性は不変・冪等） |
| `_shared/email-templates/auth-plain.ts` の `enc()` | auth メールの表示テキストを ASCII 化 |
| `_shared/email-templates/recovery-plain.ts` の `encodeHtmlTextSafely` | 同上（パスワード再設定） |

送信経路は2つとも最後に `makeEmailHtmlAsciiSafe(rawHtml)` を通す。

## 第1章（2026-07）: 文字化け

パスワード再設定メールの「パスワード」が「パスワ???ード」と化けた。
本文の長い1行が QP の76桁折り返しの途中でマルチバイト文字を割っていた。

## 🔴 第2章（2026-08-18）: その対策自体が不具合になった

対策として入れた「長い行を HTML コメント `<!--\n-->` で折る」方式が、
**一部のメールクライアントでコメントを可視化した。**

```
予約確認メール: 「アプリからキ??ンセル・変更が可能です。」
（「ャ」の両側に <!--\n--> が挿入されていた）
```

当時から「Gmail iOS ダークモード等で豆腐化して見えることがあった」と分かっていて、
折り返し幅を 20→24 バイトに広げて**頻度を下げただけ**だった。根治していなかった。

**同じ実装が4箇所にあった。** 1つでも残ると症状が戻る:

- `email-encoding.ts` の `wrapEmailHtml`（**関数ごと削除**）
- `email-encoding.ts` の `appendAsciiHtmlToken`
- `auth-plain.ts` の `enc()`
- `recovery-plain.ts` の `encodeHtmlTextSafely`

`src/test/emailEncoding.test.ts` が4箇所すべてを検査する（変異9種で確認済み）。

## 描画側（第1層）も要る

`@react-email/render` の **`renderAsync` は使わない**。Deno が引く browser ビルドは
`decoder.decode(chunk)` を `{ stream: true }` 無しで呼ぶので、チャンク境界をまたいだ
多バイト文字が U+FFFD になる。同期の `render` を使うこと。

⚠️ **Node では再現しない。入力の長さ次第で化けたり化けなかったりする。**
「手元で1通試して無事だった」は根拠にならない。

## デプロイ

これは Edge Function なので、**マージしただけでは本番に出ない**。
Lovable のエージェントに依頼すること（`mem/ops/edge-function-deploy.md`）。
