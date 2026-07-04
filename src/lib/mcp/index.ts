import { auth, defineMcp } from "@lovable.dev/mcp-js";
import listUpcomingBookings from "./tools/list-upcoming-bookings";
import getProfile from "./tools/get-profile";
import listRecentMeasurements from "./tools/list-recent-measurements";

// The OAuth issuer must be the direct supabase.co host, built from the project ref
// (Vite inlines VITE_SUPABASE_PROJECT_ID at build time — keeps this file import-safe).
const projectRef = import.meta.env.VITE_SUPABASE_PROJECT_ID ?? "project-ref-unset";

export default defineMcp({
  name: "salute-gosho-minami-mcp",
  title: "パーソナルジムSalute御所南 MCP",
  version: "0.1.0",
  instructions:
    "Tools for the Salute御所南 personal-gym app. Use `get_profile` to read the signed-in customer's profile, `list_upcoming_bookings` for upcoming reservations, and `list_recent_measurements` for recent body measurements.",
  auth: auth.oauth.issuer({
    issuer: `https://${projectRef}.supabase.co/auth/v1`,
    acceptedAudiences: "authenticated",
  }),
  tools: [getProfile, listUpcomingBookings, listRecentMeasurements],
});
