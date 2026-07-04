# 体験予約 (初回無料体験) の公開予約フロー

2026-07 に旧 Salute プロジェクト経由の二段構え (Salute に INSERT → GymBoard へ同期) を廃止し、
**GymBoard 直結**に一本化した。

## 入口 (2つの公開ページ、どちらも同じ API を使う)

- GymBoard 内蔵: `/trial/:tenantId` (`src/pages/TrialBooking.tsx`) — tenantId は URL パスの UUID
- 外部サイト: `app.kyoto-salute.com/trial` (kyoto-salute リポジトリの `src/pages/TrialBooking.tsx`) —
  GymBoard の anon キーで直接接続 (`src/integrations/gymboard/client.ts`)、tenant は Salute御所南固定

## API

- **空き枠**: RPC `get_tenant_booked_slots(p_tenant_id, from_date, to_date)`
  (migration `20260704090000`)。テナント限定 + 日付範囲で bookings / trial_bookings /
  blocked_slots の埋まり区間を返す (個人情報なし、範囲は最大93日、anon 実行可)。
  旧 `get_booked_slots(check_date)` は全テナント横断のため公開ページでは使わない。
- **予約作成**: エッジ関数 `trial-book` (verify_jwt=false)。
  POST `{ tenant_id, guest_name, guest_contact, booking_date }`。
  - 検証: テナント実在(active/trial)、メール形式、23時間前〜32日先、10:00〜21:00開始・15分刻み
  - 連続予約ガード: 同一メール 24時間 3件まで
  - 重複: BEFORE INSERT `check_booking_overlap` トリガー (テナント内で判定)
  - status は DB デフォルト `'予約済み'` → `send-trial-reminders` の前日リマインド対象になる
  - 通知はサーバー側で完結: お客様確認メール (`trial-booking-confirmation`) /
    トレーナー宛メール (`new-booking-notification`)・LINE・push / Google カレンダー登録
  - 業務上の拒否 (満枠・回数制限・入力不備) は **HTTP 200 + `{ok:false, error, code}`**
    で返す (フロントは error をそのまま表示する)

## キャンセルと枠解放

トレーナーが GymBoard で体験予約をキャンセル (`useBookings.ts` の soft-cancel で
status='キャンセル済み') すると、空き枠計算は GymBoard 自身のデータなので即時解放される。
同期は不要になった。

## 旧 Salute 連携 (参考: 廃止経緯)

- 旧構成: /trial → Salute DB に INSERT → (Salute 側のデプロイ専用トリガー) →
  `gymboard-sync-trial-booking` → GymBoard へ複製 + メール送信。キャンセルは逆方向に
  `sync-trial-cancel-to-salute` → Salute の枠を解放。
- Salute 側の通知メールは 2026-07 に choke point (`send-transactional-email` の
  EMAILS_PAUSED) で恒久停止済み。
- `gymboard-sync-trial-booking` / `sync-trial-cancel-to-salute` / `trial_cancellation_to_salute`
  トリガーは移行期の安全のため残置 (新フローでは実質no-op)。安定後に削除してよい。

## セキュリティ / 多テナントの要点

- 公開 INSERT 経路は閉鎖済み (migration `20260704140000`): anon/authenticated の
  trial_bookings への INSERT ポリシー・GRANT を削除。予約作成は trial-book
  (service_role) のみ。これにより trial-book の検証を迂回できない。
- 宛先トレーナーは **tenant_members (trainer→owner, active, joined_at 順)** で解決。
  旧 `get_trainer_ids` はテナント横断で他ジムのスタッフに誤通知するため使わない。
- お客様確認メール (`trial-booking-confirmation`) と前日リマインド
  (`trial-booking-reminder`) は住所が Salute 固定のため **当面 Salute テナント限定**。
  他テナント対応時はテンプレートに gym_name / 住所を差し込む。
- trial-book のレート制限: 同一メール24hで3件 (キャンセル済みは除外) +
  テナント全体1hで20件 (メール差し替え回避への防御)。
- 予期しない失敗 (500) は詳細をログのみに残し、公開クライアントには汎用メッセージを返す。

## 落とし穴

- `trial_bookings` に一意制約なし。重複防止は overlap トリガーのみ。
- `gymboard-sync-trial-booking` は status='confirmed' で書くため
  `send-trial-reminders` (予約済みのみ対象) から漏れる — 旧経路のみの問題。
- kyoto-salute 側の変更はフロントのみ。Lovable の Publish が必要 (エッジ関数の変更なし)。
- GymBoard 側は migration + trial-book 関数 + config.toml が変更対象 → Lovable でデプロイ。
- **移行期の前提**: 新しい体験予約は GymBoard のみに入る。**旧 Salute アプリは
  この予約を認識しない** (Salute のトレーナー画面・空き枠・overlap 判定に出ない)。
  Salute アプリを廃止した前提で許容する。`check_booking_overlap` の
  `source='salute_sync'` バイパスは「Salute 側で整合性が取れている」前提だが、
  Salute での新規予約作成をやめた今はこの前提が成立する。もし Salute アプリでの
  会員予約を継続する場合は、この前提が崩れ二重予約が起こり得るため、Salute へ
  体験予約をミラーする必要がある。
