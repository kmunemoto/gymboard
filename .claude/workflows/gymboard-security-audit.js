export const meta = {
  name: 'gymboard-security-audit',
  description: 'GymBoard 全体（Edge Function・画面・DB）を7つに分けて点検し、指摘ごとに別のエージェントが反証する（定期点検）',
  whenToUse: 'GymBoard の定期セキュリティ点検（月1回）。args に { since: "YYYY-MM-DD" }（前回の点検日）を渡すと、その後に変わった所を優先して読む。手順と記録は mem/ops/security-audit.md',
  phases: [
    { title: 'Find', detail: '7つの範囲を分担して点検（読むだけ）' },
    { title: 'Verify', detail: '指摘ごとに反証（high 以上は観点を変えて2体）' },
  ],
}

// 2026-11-01 の点検（45体・33件・反証で1件落ち）の台本を、定期点検用に直したもの。
// - 「直したもの・既知のもの」は台本に書かず、mem/ops/tenant-boundary.md と security/README.md を読ませる（台本が古くならない）
// - 直したはずの守りが外れている（回帰）なら挙げさせる
// - 7つの範囲で、supabase/functions/ の全部・画面・DB を覆う
// 🔴 このリポジトリは公開。秘密の値・ジムの ID・お客様の情報をここに書かないこと。

const SINCE = (args && typeof args.since === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(args.since)) ? args.since : null

const CONTEXT = `あなたは GymBoard（マルチテナントのジム管理アプリ）のセキュリティ点検の一員です。リポジトリは今の作業ディレクトリ（GitHub で公開されているリポジトリ）。
構成: React + TypeScript（src/）、Capacitor（iOS/Android にも同じ画面を同梱。古い版の端末も残る）、Supabase（Postgres + RLS。supabase/migrations/）、Edge Functions（Deno。supabase/functions/<名前>/index.ts、共通部品は supabase/functions/_shared/）。
運営者の心配:「個人情報が抜かれるのが怖い」。いちばん大事なのは、お客様・スタッフの個人情報（氏名・メール・電話・体の記録・予約・チャット・写真）が、見てはいけない人に見えること／書き換えられること。

## 攻撃者の想定
- 未ログイン: anon キーは公開（.env に入っている）。supabase/config.toml で verify_jwt=true の関数も anon キーで呼べる（JWT の署名を見るだけ）。関数の中で auth.getUser / getClaims / _shared/auth.ts の verifyCaller で本人を確かめていなければ「誰でも呼べる」とみなす。
- 任意の新規ジムのオーナー: ジムの登録は誰でもできる（仕様。変えない）。自分で作ったジムでは owner。2つ目のアカウントを作って、自分のジムのお客様にすることもできる。
- あるジムのお客様: 招待コードで入る。同じジムの他のお客様の個人情報は見えてはいけない。インストラクターは role='trainer' かつ staff_access='limited' の制限付きスタッフ。
- 他のジムのオーナー・先生・お客様の user_id や tenant_id は、公開の情報（公開ページ・画像のファイル名など）から取れる前提で考える。
- 守るもの: 個人情報の読み取り、他人・他のジムのデータの書き換え、アカウントの乗っ取り、なりすましの通知・メール・LINE（正規のドメイン・公式アカウントから届く）、運営や他のジムに成りすました操作、課金・契約の上限のすり抜け。

## 認可の道具（これ以外で認可していたら疑う）
- DB: has_tenant_role(tenant_id, uid, ARRAY['owner','trainer'])、is_staff_of_user(user_id)、shares_tenant_with_me(user_id)、get_my_tenant_id()、tenant_members（role・status・staff_access）。
- 🔴 has_role(uid, 'trainer') / Edge Function の hasRole（グローバルな「印」）は誰でも付けられるので、認可の根拠にならない。
- 🔴 auth.uid() を <> / != で比べると、未ログイン（NULL）で素通りする。IS DISTINCT FROM と auth.uid() IS NULL の確かめが要る。
- 🔴 列単位の REVOKE は、テーブル単位の権限が残っていると何もしない。守る列は SECURITY INVOKER の門番トリガー（current_user が authenticated / anon のときだけ見る）で守っている。SECURITY DEFINER の門番は素通りする。
- Edge Function: _shared/auth.ts の verifyCaller（isServiceRole / userId）。service_role のクライアントで DB を読み書きする関数は RLS が効かないので、関数の中で「呼んだ人」と「対象のテナント・ユーザー」の関係を確かめているかが全て。

## 既に直したもの・既知のもの
- まず mem/ops/tenant-boundary.md（穴1〜とその「残り」）と security/README.md を読むこと。そこに「直した」「既知の残り」と書いてあるものは**報告しない**。
- ただし、直したはずの守りが外れている・効いていない・後のマイグレーションで上書きされている（回帰）なら、**必ず挙げる**（どの穴の直しが、どこで外れたか）。
- security/check.sql（読み取り専用の検査）と src/test/（走査型のテストが多数ある）も、守りの場所を知るのに使える。

## 読み方のコツ
- migrations の関数・ポリシーは、ファイル名の日時が一番新しい定義が正。grep で \`FUNCTION public.<名前>(\` を探し、最後のものを読む。
- 本番の実物を見たいときは、mcp__Lovable__query_database（project_id は CLAUDE.md にあるジムボードの Lovable のID。ToolSearch で "select:mcp__Lovable__query_database" を読み込んでから使う）で、**カタログだけ** SELECT してよい: pg_proc / pg_get_functiondef / has_function_privilege / has_table_privilege / has_column_privilege / pg_policies / pg_class / pg_views / pg_trigger / pg_constraint / information_schema / storage.buckets / pg_publication_tables / cron.job（jobname・schedule・command）。使えなければ、リポジトリだけで判断してよい（その旨を notes に書く）。
- 🔴 お客様のデータが入ったテーブル（profiles・bookings・messages・tenant_members の中身・auth.users など）と vault は読まない。INSERT / UPDATE / DELETE / DDL / 関数の実行・SET ROLE は禁止。${SINCE ? `
- 前回の点検は ${SINCE}。\`git log --since=${SINCE} --name-only --format=\` でその後に変わったファイルを出し、**変わった所から先に**読む（新しい関数・ポリシー・画面は特に）。時間が余れば、変わっていない所も見る。` : ''}

## ルール
- 読むだけ。ファイルを変更しない、git の状態を変えない、PR・コメント・メッセージを送らない、Edge Function やURLを呼ばない、Lovable にメッセージを送らない。
- 実在して悪用できるものだけを挙げる。コードの好み・一般論の強化案（「レート制限があるとよい」等）は不要。悪用の手順（誰が・何を呼んで・何が得られるか）を具体的に書けないものは挙げない。
- 書くのは日本語。`

const SLICES = [
  {
    key: 'functions-public',
    title: '未ログインでも呼べる関数（verify_jwt=false・公開ページの入口・Webhook・コールバック）',
    prompt: `対象: supabase/config.toml で verify_jwt=false の関数すべてと、未ログインのお客様が使う公開ページ（体験予約・ドロップイン・体験の取り消し・ジムの公開ページ）が呼ぶ関数。Stripe の Webhook、Google・LINE の連携のコールバック、認証メールのフック（auth-email-hook）、cron やトリガーから呼ばれる通知の関数（x-cron-secret の確かめ）を含む。
確かめること: (1) 未ログインで呼んだときに何ができるか（他人の予約・情報の取得、なりすましのメール・通知、他のジムの枠の操作）、(2) Webhook・コールバックの署名や state の確かめ、(3) 入力（tenant_id・メール・URL・トークン）をそのまま信じていないか、(4) 返事やエラーに他人の情報が混ざらないか、(5) 大量に呼ばれたときに、他のお客様の予約を妨げられないか（枠の占有など、具体的な害があるものだけ）。`,
  },
  {
    key: 'functions-user',
    title: 'ログインして使う関数（アカウント・会員・取り込み・招待・決済・連携・AI・MCP）',
    prompt: `対象: supabase/functions/ のうち、他の担当（functions-public・functions-notify・functions-email）に入らないもの全部。signup-trainer, invite-customer, import-customers, analyze-meal, generate-share-image, calendar-feed, diag-ios-push, gymboard-customer-portal, gymboard-create-checkout, google-calendar-auth-url, google-calendar-sync, mcp（生成元は src/lib/mcp/。supabase/functions/mcp/index.ts は npm run build で作り直される成果物なので、生成元と成果物の両方を見る）など。新しく増えた関数があれば必ず入れる。
各関数で確かめること: (1) 呼んだ人を確かめているか（anon キーだけで通らないか）、(2) service_role で読み書きする前に、対象のテナント・ユーザーに対する権限（その tenant の owner/trainer か、本人か）を確かめているか。印（hasRole）だけで通していないか、(3) 入力（tenant_id・user_id・メール・URL・ファイルのパス・画像）をそのまま信じていないか、(4) 外への送信（メール・招待・外部 API・AI）でなりすまし・中継・他人の情報の持ち出しができないか、(5) 返事に他人・他のジムの情報が混ざらないか。
呼び出し元（src/ の supabase.functions.invoke('<名前>')）も読んで、正規の使い方と比べる。`,
  },
  {
    key: 'functions-notify',
    title: 'LINE・プッシュ・お知らせ・定時の通知',
    prompt: `対象: supabase/functions/ の line-auth-url, line-login-callback, line-booking-reminder, send-line-message, send-push-notification, push-announcements, push-booking-reminder, push-booking-reminder-hourly, push-period-reminder, monthly-report-notification, send-trial-reminders, notify-new-message, daily-trainer-summary（と、それらが使う _shared の部品）。
確かめること: (1) cron（定時）用の関数が x-cron-secret 等で守られているか、(2) 送り先・本文・リンクを呼び出し側が決められないか（なりすましの通知・公式 LINE からの文面）、(3) 他のジムの人・他人に送れないか（お客様同士も）、他のジムのお知らせを出せないか、(4) LINE の連携で他人の LINE を自分のアカウントに結び付けられないか、(5) 通知の登録（push_devices・push_subscriptions）で他人宛ての通知を受け取れないか、(6) 返事やログに他人の個人情報が出ないか。
呼び出し元（src/ の invoke、DB の cron.job、トリガーの net.http_post）も読んで、正規の使い方と比べる。`,
  },
  {
    key: 'functions-email',
    title: 'メール（送信・キュー・再送・プレビュー・配信停止・運営への要望）',
    prompt: `対象: supabase/functions/ の send-transactional-email, process-email-queue, resend-email, preview-transactional-email, handle-email-suppression, handle-email-unsubscribe、_shared のメール関係の部品・テンプレート、メールを積む DB の関数（enqueue_email を呼ぶもの。notify_operator_feedback など）。
確かめること: (1) ログインした任意の人（どこかのジムのオーナーになれる）が、任意の宛先・任意の本文・リンク・差出人名で、正規のドメインからメールを送れないか（なりすまし・スパムの中継・運営者を狙うフィッシング）、(2) 他のジムのお客様の氏名・メールアドレスを宛先の解決や送信履歴（email_send_log）で抜けないか、(3) 配信停止・抑止のトークンで、他人の配信停止や情報の取得ができないか、(4) resend で他人宛のメールを再送・宛先を変えられないか、(5) プレビューで他のジムの情報が見えないか、(6) キューを外から動かして中身を取れないか、(7) HTML に入る値（ジム名・表示名・本文）のエスケープ漏れ。
呼び出し元（src/ の invoke、DB のトリガー・cron）も読んで、正規の使い方と比べる。`,
  },
  {
    key: 'client',
    title: 'アプリの画面側（src/・public/・Capacitor）',
    prompt: `対象: src/（components, pages, hooks, lib, contexts, integrations）、public/（sw.js など）、index.html、capacitor.config.*、vite.config.*。
確かめること: (1) XSS: dangerouslySetInnerHTML・innerHTML・Markdown や HTML の表示、ユーザーが入れた文字列を href / src / style に入れている所（javascript: URL を含む。ジムが入れた URL・お客様が入れた名前・メモ・チャットをスタッフやお客様の画面で表示する所は特に）、(2) 外への遷移: ?redirect= / next などのリダイレクト、window.open、location.assign、OAuth（Apple/Google/LINE・AI 連携の同意画面）やパスワード再設定からの戻り、Capacitor のディープリンク（appUrlOpen）と通知のタップ、(3) 端末に残る情報: localStorage / sessionStorage / Capacitor Preferences / キャッシュ / 通知の登録に個人情報やトークンが残らないか（ログアウト後・共用端末）、(4) console に個人情報を出していないか、(5) 公開ページが、見せるべき以上の情報（他のお客様の名前・予約・連絡先）を返したり表示したりしていないか、(6) 画面でしか止めていない権限（ボタンを隠すだけ）で、サーバー側（RLS・関数）に同じ守りが無いもの。サーバー側は supabase/migrations と supabase/functions で照合する。
アプリに同梱した古い版も残るので、「画面を直せば済む」ものと「サーバーで止めないといけない」ものを分けて書く。`,
  },
  {
    key: 'db-functions',
    title: 'DB の関数（RPC・トリガー関数）',
    prompt: `対象: 本番の public スキーマで、anon または authenticated が EXECUTE できる SECURITY DEFINER 関数の全部と、守りのためのトリガー関数（guard_* / enforce_*）。
進め方: (1) 本番のカタログで一覧を作る（例: SELECT p.oid::regprocedure, p.prosecdef, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_exec, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_exec, p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.prosecdef）、(2) 1つずつ本文（pg_get_functiondef、または migrations の最新の定義）を読み、「呼んだ人（auth.uid()）」と「引数の tenant_id / user_id / 行」の関係を確かめているかを見る。典型: 引数の tenant_id・user_id を信じて他のジム・他人の行を読む／書く、auth.uid() が NULL のとき素通り（三値論理）、has_role（印）で認可、件数や存在の有無で他のジムの情報が分かる、search_path が固定されていない、format() / EXECUTE の動的 SQL、(3) 守りのトリガーが SECURITY DEFINER なのに current_user を見ている（素通り）、守る列の漏れ、(4) migrations の最新の定義と本番の定義が食い違っていれば挙げる（本番に入っていないマイグレーションも）。
anon が呼べる関数は「誰でも呼べる」。authenticated が呼べる関数は「どこかのジムのオーナーになれる任意の人が呼べる」。`,
  },
  {
    key: 'db-other',
    title: 'DB の関数以外（RLS・置き場・ビュー・リアルタイム・列の権限・制約・定時の処理）',
    prompt: `(1) RLS: 本番の pg_policies と migrations の最新を突き合わせる。新しいテーブル・ポリシー（前回の点検の後に増えたもの）は特に、お客様・他のジムのオーナー・未ログインのそれぞれで、読める・書ける行を考える。RESTRICTIVE のテナントの絞り（tenant_isolation など）が付いていないテーブル、USING と WITH CHECK の食い違い、
(2) storage: storage.buckets の public 設定と、storage.objects のポリシー（パスの1段目がテナント／ユーザーになっているか、他のジムの写真・書類を読める・上書きできる・消せる・一覧できるか。アップロードする画面のパスの作り方も src/ で確かめる）、
(3) ビュー: security_invoker の無いビュー（作った人の権限で動くので RLS を素通りする）を anon / authenticated が SELECT できるか、
(4) Realtime: supabase_realtime の publication に入っているテーブルと、画面の購読（src/ の .channel / postgres_changes / broadcast）。他人・他のジムの変更が流れてこないか、
(5) テーブル・列の権限と制約: anon に GRANT されているもの、authenticated が書ける列のうち守るべき列（tenants の課金・上限・持ち主・連絡先の URL、profiles の契約・取り込み・LINE の列、tenant_members の role / status / staff_access、予約の枠を決める列・状態）を、自分の行だから・自分のジムだからという理由で書き換えて、権限や他人に影響を及ぼせないか。トリガー・CHECK で守られているかを確かめる、
(6) cron.job: 呼び先の URL と認証の付け方（秘密の値がコマンドに直書きされていないか）。`,
  },
]

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: '<関数名や領域>-<番号>（例: invite-customer-1）' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          title: { type: 'string', description: '日本語で短く（何が起きるか）' },
          location: { type: 'string', description: 'ファイル:行（本番だけの問題ならカタログの名前）' },
          attacker: { type: 'string', description: '誰が（未ログイン／任意のジムのオーナー／同じジムのお客様 など）' },
          scenario: { type: 'string', description: '悪用の手順（何を呼んで、何が得られるか）' },
          evidence: { type: 'string', description: 'そう判断したコードの抜粋と理由。守りが他に無いことをどう確かめたか' },
          fix: { type: 'string', description: '直し方の案（古いアプリを壊さないか含む）' },
          regression: { type: 'string', description: '以前に直した穴の回帰なら、どの穴（mem/ops/tenant-boundary.md の番号）か。新しい穴なら空' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['id', 'severity', 'title', 'location', 'attacker', 'scenario', 'evidence', 'fix', 'confidence'],
      },
    },
    reviewed: { type: 'array', items: { type: 'string' }, description: '実際に読んで確かめた関数・ファイル・カタログ' },
    notes: { type: 'string', description: '見きれなかった所・気になったが確かめられなかった所' },
  },
  required: ['findings', 'reviewed', 'notes'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['confirmed', 'plausible', 'refuted'] },
    severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'], description: '確かめた結果の重さ' },
    reasoning: { type: 'string', description: '判断の根拠（どのコード・カタログを見たか）' },
    blocking_guard: { type: 'string', description: 'refuted のとき: 何が止めているか（ファイル:行）' },
    corrected_scenario: { type: 'string', description: '手順や影響が指摘と違うときの、正しい手順・影響' },
  },
  required: ['verdict', 'severity', 'reasoning'],
}

const LENS_CODE = `コードの経路と守りの観点: 指摘のコードが本当にそうなっているか（最新の定義・行番号）、そこへ届く前・後に別の守り（verify_jwt と本人確認、RLS、トリガー、列や関数の GRANT、呼び出し前のチェック、DB の制約）が無いかを、実際にファイルと本番のカタログで確かめる。mem/ops/tenant-boundary.md に「直した」「既知の残り」とあるもので、直しがまだ効いているなら refuted。`
const LENS_ATTACKER = `攻撃者の観点: 攻撃者になったつもりで、最初から最後まで手順を通してみる。必要な値（ID・トークン・招待コード・権限）を実際にどこから手に入れるか、呼んだときに何が返り、何が書き換わり、誰に何が届くか。前提が現実に揃わないなら refuted、揃うなら影響の大きさを見積もる。`

const findPrompt = (s) => `${CONTEXT}

## あなたの担当: ${s.title}
${s.prompt}

## 出力
- findings: 悪用できると判断したものだけ。無ければ空配列でよい（無理に作らない）。
- reviewed: 実際に読んで確かめたもの（漏れが分かるように）。
- notes: 見きれなかった所。`

const verifyPrompt = (f, s, lens) => `${CONTEXT}

## あなたの役目: 次の指摘の反証
別のエージェントが「${s.title}」を点検して出した指摘です。本物かどうか、疑ってかかって確かめてください。
コードとカタログで悪用の手順が実際に通ることを確かめられたら confirmed。通りそうだが一部を確かめきれないなら plausible。どこかで止まる・前提が揃わない・既知や修正済みと同じなら refuted（止めているものを blocking_guard に書く）。

## 観点
${lens}

## 指摘
${JSON.stringify(f, null, 2)}`

if (SINCE) log(`前回の点検（${SINCE}）より後に変わった所を優先して読みます`)

const results = await pipeline(
  SLICES,
  (s) => agent(findPrompt(s), { label: `find:${s.key}`, phase: 'Find', schema: FINDINGS_SCHEMA }),
  async (found, s) => {
    if (!found) {
      log(`${s.key}: 点検の結果が返らなかった`)
      return { slice: s.key, title: s.title, failed: true, reviewed: [], notes: '結果なし', items: [] }
    }
    log(`${s.key}: 指摘 ${found.findings.length} 件 → 反証へ`)
    const items = await parallel(found.findings.map((f) => async () => {
      const lenses = (f.severity === 'critical' || f.severity === 'high' || f.regression) ? [LENS_CODE, LENS_ATTACKER] : [LENS_CODE]
      const votes = (await parallel(lenses.map((lens, i) => () =>
        agent(verifyPrompt(f, s, lens), {
          label: `verify:${f.id}${lenses.length > 1 ? '#' + (i + 1) : ''}`,
          phase: 'Verify',
          schema: VERDICT_SCHEMA,
        })
      ))).filter(Boolean)
      return { finding: f, votes }
    }))
    return { slice: s.key, title: s.title, failed: false, reviewed: found.reviewed, notes: found.notes, items: items.filter(Boolean) }
  },
)

const all = results.filter(Boolean)
const survivors = []
const refuted = []
for (const r of all) {
  for (const it of r.items) {
    const f = it.finding
    if (it.votes.length === 0) {
      survivors.push({ slice: r.slice, ...f, votes: [], status: 'unverified' })
      continue
    }
    const ok = it.votes.filter((v) => v.verdict !== 'refuted')
    if (ok.length > 0) {
      const status = ok.length < it.votes.length ? 'contested' : (ok.some((v) => v.verdict === 'confirmed') ? 'confirmed' : 'plausible')
      survivors.push({ slice: r.slice, ...f, votes: it.votes, status })
    } else {
      refuted.push({ slice: r.slice, id: f.id, severity: f.severity, title: f.title, why: it.votes.map((v) => `${v.blocking_guard || ''} ${v.reasoning}`.trim()).join(' / ') })
    }
  }
}
const failedSlices = all.filter((r) => r.failed).map((r) => r.slice)
if (failedSlices.length) log(`結果が返らなかった範囲: ${failedSlices.join(', ')}（その範囲は点検できていない）`)
log(`残った指摘 ${survivors.length} 件・反証された指摘 ${refuted.length} 件`)
return {
  since: SINCE,
  survivors,
  refuted,
  coverage: all.map((r) => ({ slice: r.slice, title: r.title, failed: r.failed, reviewed: r.reviewed, notes: r.notes })),
}
