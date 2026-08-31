# 動画ライブラリ（自宅でできるストレッチ等） — gym_videos

2026-08-31 追加。ジムが「家で1人でできるセルフストレッチ」の動画を並べ、
お客様がアプリから見る。宗本さんの依頼:
「ジムボードのアプリの私のジムに家で1人でできるセルフストレッチの動画をあげたいです。
こういう動画を載せれる欄のシステムをジムボードに作って。」

## 🔴 動画ファイルは受け取らない（URL方式）

`gym_videos.video_url` に **YouTube / Vimeo の「限定公開」URLを1つ持つだけ**。
アップロードもストレージも無い。宗本さんの選択（3案から「YouTube限定公開のURLを貼る」）。

そう決めた理由:

1. **尺が2桁違う。** チャット添付の上限は 25MB で、これは
   「フォーム確認の短い動画」向けと migration のコメントに明記してある
   （`20260811020000_message_attachments.sql:62-66`）。3分のストレッチ解説は数百MB級。
2. **直接受けると付いてくるものが多い。** 変換・サムネ生成・進捗表示・再開可能アップロード
   （`uploadToSignedUrl` / TUS はリポジトリに1件も無い）、そして **署名URLの再発行**。
   いまの `withSignedUrls`（`useMessages.ts:38-45`）は取得時に1回署名するだけで TTL は1時間
   （`messageAttachment.ts:114`）。チャットは短命な画面なので露呈していないが、
   動画のように長く留まる画面では**確実に切れる**。
3. **原価を吸収する場所が無い。** `src/lib/gymboardPlans.ts` は
   Free ¥0/5人 〜 Pro ¥9,800/**無制限** と**席数だけ**で値付けしている。
   ストレージと転送量は**視聴回数に比例して**増えるので、動画は「機能を足す」ではなく
   **原価構造を変える**変更になる。しかも Lovable Cloud の容量・転送量の実際の上限は
   **セッションからは読めない**（Supabase コネクタにジムボードの ref `rrbfwitprzuevzytykrq`
   が見えず、`docs.lovable.dev` も egress プロキシに遮断される）。
4. 既存の `enforce_tenant_plan_limit` トリガは **行数しか見ない**
   （`20260525025614...:75-91`）。動画テーブルに流用しても「本数」は縛れるが
   「バイト数」は縛れない。ストレージ量を縛る仕組みは現状どこにも無い。

将来ファイルも受けたくなったら `storage_path` 列を足し、
「`video_url` が NULL なら自前」と分ければよい。**そのときは 3 を先に決めること。**

## 🔴 貼られたURLをそのまま iframe に入れない

`video_url` は自由入力なので、`javascript:` を入れられるとそのまま実行される。

- DB: `CHECK (video_url LIKE 'https://%' AND char_length(video_url) <= 500)`
- クライアント: `src/lib/videoEmbed.ts` の `parseVideoUrl()` が
  **動画IDだけを抜き出して埋め込みURLを組み立て直す**。IDに許すのは `[A-Za-z0-9_-]` だけ。
  元URLのクエリ（`t=` / `feature=` 等）は1つも引き継がない。
- ホスト判定は**末尾一致**（`evil-youtube.com` / `youtube.com.evil.jp` を弾く）。
- 解析できなかったものは**画面に出さない**（お客様側は一覧から除外、
  トレーナー側は「URLを開けません」の赤い印を出して直してもらう）。

見張り: `src/test/gymVideos.test.ts`（iframe の `src` が `*.embedUrl` 以外になっていないかも見る）

## 公開範囲・入口

- **そのジムのお客様全員に共通**（宗本さん決定）。お客様ごとの割り当ては持たない。
- 公開制御は `published_at` 1本だけ（お知らせと同じ）。未来なら見えない＝予約公開。
  下書き・公開トグル・掲載終了は持たない。
- お客様側の入口は**ホーム画面のカードだけ**。`CustomerTab` に `"videos"` を足して
  `CustomerVideos` を出す（月次レポート・体の変化と同じ、ナビに出ないタブ）。

  🔴 **下部ナビには足していない。** お客様側には**ジムごとの表示ON/OFFの仕組みが無い**
  （`show_nav_*` は全部トレーナー画面用）。ナビに足すと19のジム全部に出る。
  代わりに **公開中の動画が0本ならカード自体を出さない**（`useGymVideoCount`）ことで、
  新しいフラグを増やさずに実質の出し分けにしている。
  `BottomNav` には幾何の不変条件（左右グループの flex 係数 == スロット数）があり
  `src/test/bottomNavCenter.test.tsx` が見張っているので、触らないほうが安い。

- トレーナー側はタブ「動画管理」。`show_nav_videos`（既定 true）で出し分ける。
  プリセットは **standard 以上でON**（お知らせと同じ扱い。simple では出さない）。

## 触ったところ

| ファイル | 何を |
|---|---|
| `supabase/migrations/20260831010000_gym_videos.sql` | 表・CHECK・索引・RLS・`tenants.show_nav_videos` |
| `supabase/migrations/20260831010500_delete_gym_videos.sql` | `delete_my_gym()` に1行追加（最新版から機械的に写す） |
| `src/lib/videoEmbed.ts` | URL解析・埋め込みURL組み立て・尺の表示/入力 |
| `src/hooks/useGymVideos.ts` | 一覧・作成・更新・削除 / `useGymVideoCount` |
| `src/components/customer/CustomerVideos.tsx` | お客様の一覧・再生 |
| `src/components/trainer/TrainerVideoManager.tsx` | ジム側の管理（貼った直後にその場で試聴できる） |
| `src/lib/trainerTabs.ts` / `gymDisplaySettings.ts` / `tenantTypes.ts` / `tenantColumns.ts` | タブと列の配線 |
| `src/locales/*.json` ×5 | `videos.*` / `gymVideo.*` / `trainerNav.videos` / `trainerNav.mVideos` |

## まだやっていないこと

- **視聴記録**（誰が何を見たか）。お知らせの `announcement_reads` 相当は作っていない。
  「この人はまだ見ていない」を確認したい運用が出たら足す。
- **新着のプッシュ通知**。`notification_settings` は `reminder_enabled` 1列だけで
  **オプトアウトが存在しない**ので、毎週上げるとアクティブ顧客全員に毎回無条件で届く。
  通知を足すなら先に切る手段を作ること。
- **実機での再生確認**。`playsinline=1` と Capacitor の既定でインライン再生になるはずだが、
  iOS / Android の実機では**まだ1度も再生していない**。ネイティブに載せる前に確認すること
  （そもそも本番の `storage.objects` を見ると、動画の経路は今まで一度も通っていない）。
- カテゴリーは自由入力（`exercises.category` と同じ）。候補は `TrainerVideoManager` の
  `CATEGORY_PRESETS`。マスタ化はしていない。

## 本番への適用と検証（2026-08-31）

マージ前に本番へ適用した（Lovable のボットがマージ2〜3分後に `types.ts` を
実DBから再生成するため、先に列を作っておかないと手で足した型が消える）。

適用後、**ロールを演じて**確かめた結果（すべて `BEGIN … ROLLBACK`、残留0件）:

| 誰として読んだか | 見えた本数 |
|---|---|
| Salute御所南のトレーナー | 2（公開済み＋予約公開） |
| 同じジムのお客様 | **1**（予約公開ぶんは見えない） |
| **別のジム**のトレーナー | **0** |
| 未ログイン（anon） | **0** |

書き込み側（否定はトランザクションの**中で**行数を数えた。ROLLBACK 後に数えると
「弾かれた」と「巻き戻った」が区別できない）:

| 試したこと | 結果 |
|---|---|
| お客様が INSERT | `42501` RLS 違反で拒否 |
| お客様が UPDATE / DELETE | **0行** |
| 別テナントのトレーナーが UPDATE / DELETE | **0行** |
| 別テナントのトレーナーが Salute の tenant_id で INSERT | `42501` `tenant_isolation` 違反 |
| 自店の行の tenant_id を他店へ付け替え | `42501` `tenant_isolation` 違反 |
| `javascript:alert(1)` を video_url に | `23514` `gym_videos_url_https` 違反 |
| **対照**: 自店のトレーナーが UPDATE | **1行**（0件ばかりで「全部効かない」を見誤らないため） |

19テナント全部で `show_nav_videos = true`、`gym_videos` は0行。
