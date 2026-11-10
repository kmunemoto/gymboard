# 定期セキュリティ点検（ワークフロー）

宗本さん（2026-11-01）「保存しておいて、点検をたまに回して」。
2026-10-31〜11-01 に回した点検（下の「点検の記録」）の台本を、定期点検用に直して保存したもの。

## 何をするか

- 台本: `.claude/workflows/gymboard-security-audit.js`（名前は `gymboard-security-audit`）
- GymBoard 全体を7つの範囲に分けて点検し、指摘ごとに別のエージェントが反証する。
  critical・high と「直したはずの守りが外れている（回帰）」は、観点を変えて2体で反証する。
  1. 未ログインでも呼べる関数（verify_jwt=false・公開ページ・Webhook・コールバック）
  2. ログインして使う関数（他の範囲に入らない Edge Function 全部。新しい関数はここに入る）
  3. LINE・プッシュ・お知らせ・定時の通知
  4. メール（送信・キュー・再送・プレビュー・配信停止・運営への要望）
  5. 画面（src/・public/・Capacitor）
  6. DB の関数（anon / authenticated が呼べる SECURITY DEFINER と、門番のトリガー）
  7. DB の関数以外（RLS・置き場・ビュー・Realtime・列の権限・制約・cron）
- 点検役は**読むだけ**。本番は Lovable の `query_database` で**カタログだけ**読む
  （お客様のデータが入った表と vault は読まない。書き込み・関数の実行・送信はしない）。
- 「直したもの・既知の残り」は台本に書かず、`mem/ops/tenant-boundary.md` と `security/README.md` を読ませて外す
  （台本が古くならない）。
  🔴 **直した穴・判断待ちの残りは、必ず tenant-boundary.md に書く。** 書かないと、次の点検で毎回挙がる。

## 回し方

```
Workflow({ name: "gymboard-security-audit", args: { since: "2026-11-01" } })
```

- `since` は下の「点検の記録」の最後の日付。それより後に変わったファイルから先に読む（省くと全体を同じ重みで読む）。
- 名前で見つからないとき（台本を置いたのがセッションの開始より後、など）は、ファイルを直接渡す:
  `Workflow({ scriptPath: ".claude/workflows/gymboard-security-audit.js", args: { since: "…" } })`
  （2026-11-01: 台本を main に入れたあと、作業セッションが再起動した時点で `gymboard-security-audit` が呼べる一覧に出た＝名前で呼べる）
- 規模: 点検の7体＋指摘ごとに1〜2体。前回（6つの範囲）は45体・約3時間半かかった。
- CLAUDE.md の「ワークフローの使い方」では、回す前に宗本さんの確認を取る。
  **定期点検は 2026-11-01 に宗本さんが頼んだので、予定から回すときは確認しない。** 手で臨時に回すときは確認を取る。

## 予定（scheduled task）

- **毎月10日 12:36（日本時間）**に、**このリポジトリの作業セッション「ジムボードアプリ」**へ届く。
  ID `trig_01GNFyXbbGYCJHbtMgAtFwTf`。届いた文面のとおりに、点検 → 確かめ直し → 直す／一覧にする → 記録 → 報告、まで進める。
- 「毎回新しいセッションで回す」形は使えない（2026-11-01 に作って確かめた）。新しいセッションには
  **リポジトリも、Lovable・GitHub の接続も付かない**（予定の設定が `sources: []`・コネクタ無し）ので、
  台本も本番のカタログも読めない。だから、接続を持っている作業セッションに届ける形にした。
- ⚠️ そのセッションをアーカイブすると、予定は届かなくなる（`list_triggers` の last_run が失敗になる）。
  そのときは、使っているセッションで同じ文面の予定を作り直す（`create_trigger` を `persistent_session_id` 無し＝そのセッション宛てで）。
- 変える・止める: 「定期点検を止めて」「毎月○日に変えて」と頼めば `update_trigger`（ID は上）で変える。

## 結果の扱い

- 返り値: `survivors`（残った指摘）・`refuted`（反証で落ちたもの。理由つき）・`coverage`（範囲ごとに読んだもの・見きれなかったもの）。
  survivors の status は confirmed／plausible／contested（2体で割れた）／unverified（反証役が返らなかった）。
- 直す前に、**自分でもコードと本番のカタログで確かめ直す**（反証役も間違える）。
- critical・high: CLAUDE.md の手順どおりに直して本番まで出す（本番の DB は3段構え、PR→CI→squash-merge、
  Edge Function のデプロイと確かめ、Web の Publish）。
- medium・low: 一覧にして宗本さんの判断を待つ。
- 直したら tenant-boundary.md に「穴N」として書く。兄弟アプリにも同じ穴がありそうなら security/（check.sql・README）にも足す。
- `coverage` に「結果が返らなかった範囲」や見きれなかった所があれば、報告に書く（黙って「異常なし」にしない）。

## 台本を直すとき

- 台本は JavaScript（TypeScript ではない）。最上位に `return` があるので `node --check` は通らない。
  構文・名前・phase の対応・ID が無いことは `src/test/securityAuditWorkflow.test.ts` が見る。
- `Date.now()`・`Math.random()`・引数なしの `new Date()` は台本の中で使えない（途中からの再開が壊れるため）。
- 🔴 リポジトリは公開。ジムの ID・お客様の情報・秘密の値を台本に書かない。
- 範囲（SLICES）が今の構成を覆っているかを、ときどき見直す。

## 点検の記録

「日付」を次の点検の `since` に使う。

| 日付 | 範囲 | 体数 | 指摘 | 反証で落ちた | 直したもの |
|---|---|---|---|---|---|
| 2026-10-31 | 未ログインで呼べる Edge Function 13本（3組に分けた） | 6 | 21（critical 3・high 2・medium 12・low 4） | 0 | 穴11〜14・「Edge Function の直し」（#469〜#473・#475） |
| 2026-11-01 | 残りの Edge Function・画面・DB（6つの範囲） | 45 | 33（critical 1・high 5・medium 18・low 9） | 1 | 穴15〜31（#476〜#493）。最初の点検の残りも穴32・33（#494・#495）。残りは tenant-boundary.md の「点検の残り」 |
| 2026-11-10 | 定期点検（予定から・7つの範囲すべて結果あり） | 34 | 19（medium 6・low 13） | 0 | なし（critical・high が無かったので、全部宗本さんの判断待ち。tenant-boundary.md の「2026-11-10 の定期点検の残り」）。約3時間 |
