import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listUpcomingBookings from "./tools/list-upcoming-bookings";
import getProfile from "./tools/get-profile";
import listRecentMeasurements from "./tools/list-recent-measurements";
import { BRAND } from "../brand";

// OAuth の issuer は supabase.co の直ホスト。project ref から組み立てる。
//
// ⚠️ ここで Vite の `VITE_` 系ビルド時変数（import.meta.env 経由）を使ってはいけない。
// Vite はビルド時に値を**文字列として埋め込む**ので、コミットされる成果物
// （supabase/functions/mcp/index.ts）に ref が焼き付く。フォークが .env を
// 直しても、その成果物だけが元のプロジェクトの issuer を要求し続ける
// （型もテストもビルドも通るので、実際に MCP を使うまで気づけない）。
//
// 各ツールが `process.env.SUPABASE_URL` を使っているのと同じにする。
// これは Vite が埋め込まず、Edge Function の実行時に Supabase が注入する。
const projectRef =
  (process.env.SUPABASE_URL ?? "").replace(/^https?:\/\//, "").split(".")[0] || "project-ref-unset";

// MCPサーバーの名前・説明はビルド時に決まる静的な定義で、テナントごとには変えられない。
// 以前は特定ジム名（Salute御所南）だったが、どのお客様にもそのまま見えてしまうため
// 製品名（brand.ts の BRAND）に統一している。店名は各ツールが返すデータ側に出る。
export default defineMcp({
  name: `${BRAND.app}-mcp`,
  title: `${BRAND.ja} MCP`,
  version: "0.1.0",
  instructions:
    `Tools for the ${BRAND.en} management app. Use \`get_profile\` to read the signed-in customer's profile, \`list_upcoming_bookings\` for upcoming reservations, and \`list_recent_measurements\` for recent body measurements.`,
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [getProfile, listUpcomingBookings, listRecentMeasurements],
});
