# Edge Function のゲートウェイ認証は、環境によって効いていないことがある

2026-08-13、ストレッチボードで **`process-email-queue` を誰でも起動できる状態**を見つけた。
原因は「`verify_jwt = true` が効いている」という前提が、その環境で成立していなかったこと。

**ジムボードは同じコード・同じ設定だが、実測したところ穴は開いていない。**
コードを読むだけでは判別できないので、判定のしかたを残す。

## 何が起きていたか

`process-email-queue` は呼び出し元をこう検査している（両アプリ共通）。

```ts
// Defense in depth: verify_jwt=true already requires a valid JWT at the
// gateway layer. This adds an explicit role check so only service-role
// callers can trigger queue processing.
const claims = parseJwtClaims(token)      // ← base64 デコードするだけ
if (claims?.role !== 'service_role') { return 403 }
```

`parseJwtClaims` は**署名を検証しない**。ペイロードを base64 デコードして `role` を読むだけ。
コメントどおり「ゲートウェイが検証済み」なら多層防御として正しい。
**その前提が崩れると、唯一の関門が自己申告になる。**

```
{"role":"service_role"} を base64 にして Bearer に載せるだけで通る
```

## 🔴 判定のしかた（コードを読んでも分からない。叩いて確かめる）

でたらめな Bearer を1回投げて、**どちらが弾くか**を見る。状態は変わらない。

```sql
SELECT net.http_post(
  url := 'https://<project-ref>.supabase.co/functions/v1/process-email-queue',
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer not-a-real-token'
  ),
  body := '{}'::jsonb
) AS req_id;

-- 少し待ってから
SELECT status_code, content FROM net._http_response WHERE id = <req_id>;
```

| 応答 | 意味 |
|---|---|
| `401 {"code":"UNAUTHORIZED_INVALID_JWT_FORMAT","message":"Invalid JWT"}` | **ゲートウェイ**が弾いた ＝ 検証が効いている（安全） |
| `403 {"error":"Forbidden"}` | **関数自身**が弾いた ＝ ゲートウェイは素通り。署名は誰も見ていない |

`{"error":"Forbidden"}` は関数のコードにあるリテラルなので、そこまで届いた証拠になる。

### 実測結果（2026-08-13）

```
ジムボード        401 UNAUTHORIZED_INVALID_JWT_FORMAT   → 効いている
ストレッチボード  403 {"error":"Forbidden"}             → 効いていない
```

## なぜ差が出るか

確認できた違いは **API キーの方式**。

```
ジムボード        VITE_SUPABASE_PUBLISHABLE_KEY = eyJ...        （旧来の JWT 形式）
ストレッチボード  VITE_SUPABASE_PUBLISHABLE_KEY = sb_publishable_...（新方式）
```

新方式のプロジェクトでは、`config.toml` に `verify_jwt = true` と書いてもゲートウェイの
JWT 検証が効かない、という挙動だった。**Lovable Cloud で後から作ったプロジェクトほど
新方式になっている可能性が高い**ので、兄弟アプリは1つずつ確かめたほうがよい。

⚠️ **`config.toml` の記述は「効いているつもり」の根拠にならない。** 上の方法で叩いて確かめる。

## ジムボードで取るべき対応

**いますぐ塞ぐ必要はない**（実測で効いている）。ただし次の2つは効く。

1. **署名を見ない `parseJwtClaims` に認可を委ねる形をやめる。** いまは前提が成立しているが、
   キー方式の移行やゲートウェイ仕様の変更で、いつでも成立しなくなる。しかも**壊れても
   何も起きない**（静かに素通りするだけ）。同じ検査を他の関数にコピーしないこと。

2. **新しいプロジェクトを作ったら、上の方法で1回叩く。** 特に Lovable Cloud で
   後から作ったものは新方式になっている。

## ストレッチボードでの直し方（参考）

`service_role` キーを Bearer で送る形に戻す手もあったが、採らなかった。
起動に必要なのは「呼び出し元が自分自身である」証明だけで、**RLS を完全に迂回できる
最上位の鍵**そのものではない。保管場所を増やさないほうがいい。

代わりに専用の共有シークレットにした（`daily-trainer-summary` の `x-cron-secret` と同じ型）。

- 値は **DB の中で生成**（`gen_random_bytes`）。ファイルにもチャットにも平文が出ない
- 照合も **DB の中で完結**。Edge Function は候補値を渡して**真偽だけ**受け取る。
  正解の値を関数側に持ってこないので、ログ・エラー・レスポンスに漏れる経路が無い
- 比較はダイジェスト同士。生の `=` だと一致した文字数と長さが所要時間に出る
- 照合関数は `anon` / `authenticated` から REVOKE、`service_role` にのみ GRANT。
  **ロールを演じて実際に拒否されることまで確認する**
- `config.toml` は **`verify_jwt = false` を明示**。関数側で認証している以上それが実態で、
  `true` のままだと再デプロイでゲートウェイが効き始めたとき、Authorization を送らない
  ディスパッチャが 401 で弾かれて**メールが静かに止まる**

## 併せて見つかったこと

ストレッチボードでは vault の `email_queue_service_role_key` が**未登録**で、
`'Bearer ' || NULL = NULL` になり 401 でキューが滞留していた。
**メールが1通も送れていなかった本当の理由がこれ。**
マイグレーションのコメントに「未登録だと 401 で滞留する」と予告が書いてあったが、
その状態のまま残っていた。**予告が書いてあっても、確かめないと残る。**
