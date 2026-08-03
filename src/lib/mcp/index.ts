import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listUpcomingBookings from "./tools/list-upcoming-bookings";
import getProfile from "./tools/get-profile";
import listRecentMeasurements from "./tools/list-recent-measurements";
import { BRAND } from "../brand";

// The OAuth issuer must be the direct supabase.co host, built from the project ref
// (Vite inlines VITE_SUPABASE_PROJECT_ID at build time — keeps this file import-safe).
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

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
