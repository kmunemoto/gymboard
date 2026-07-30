---
name: Session management
description: Session restoration, email confirmation required, PKCE fallback
type: feature
---
- Supabase auth: **Confirm email is required** (self-service open signup model). Users must click the confirmation email link before signing in. After signUp, no session is returned.
- **Do NOT switch to login mode after signUp.** The old code fired a toast and called `setMode("login")`.
  That produced a screen ("email filled in, password blank, アカウントにログイン") indistinguishable from
  a failed registration, and the only feedback was an 8-second toast pinned to the bottom of the viewport —
  the owner reported it as unnoticeable. `Auth.tsx` now keeps a `signupSent` state and swaps the card body
  for a panel (same pattern as `forgotSent`), which stays until the user dismisses it.
  While the panel is up, the customer/owner tab row, the social buttons, the mode-switch link and the
  agreement line are all hidden, so the panel is a terminal state with a single exit. Hiding the tab row is
  load-bearing: it calls `setMode("login")` only, so leaving it visible let one tap silently restore the
  broken screen. (An earlier version of this note claimed re-registering under the other tab would
  overwrite `user_metadata.role` — that's wrong. gotrue does NOT update the user row on a repeat `signUp`
  for an unconfirmed existing user, on purpose, since it can't verify the caller's identity yet. The real
  failure mode is the opposite: the role stays stuck on whatever was picked first. See the roleMismatch
  entry below.)
- **Login failing with `email_not_confirmed` shows the same panel** (reason `"unconfirmed"`, distinct title —
  "we haven't just sent anything" is not the same claim as "we sent it"), not a toast. Otherwise someone who
  missed the first notice hits the identical invisible wall twice.
- New hooks in `Auth.tsx` must go above the `authLoading` / `user` early returns, or React throws
  "Rendered more hooks than expected" when `authLoading` flips.
- **`signupSent` has 4 reasons**, one shared panel skeleton (`Auth.tsx`'s `panelContent` map):
  - `sent` — fresh unconfirmed signUp. 60s resend cooldown starts immediately (matches gotrue's own
    `confirmation_sent_at` frequency limit, so the first click won't just 429).
  - `unconfirmed` — login failed with `email_not_confirmed`. No cooldown guess (we don't know the last
    send time client-side); the resend endpoint's own 429 is the real enforcement, handled via error code.
  - `alreadyRegistered` — `signUp` on an existing **confirmed** user. Two different shapes from gotrue:
    `identities: []` (fake success response, only when both Confirm email AND Confirm phone are enabled)
    or a thrown `user_already_exists` error (either disabled). No resend button here — `resend()` returns
    200 without sending anything for an already-confirmed address, so offering it would be misleading.
  - `roleMismatch` — see below.
- **Error matching is `error.code`-first, `message.includes` as fallback** (`errCodeOf()` in `Auth.tsx`).
  `msg.includes("Email rate limit exceeded")` alone is fragile — gotrue lowercased that string between
  v2.158.0 and v2.165.0, so the old check may already be dead on newer projects. Known codes in use:
  `email_not_confirmed`, `user_already_exists`, `over_email_send_rate_limit`, `invalid_credentials`,
  `weak_password`, `email_address_invalid`, `otp_expired` (via `AuthCallback`'s `?error=` param).
  `over_email_send_rate_limit` covers two different 429s with the same code: a per-user 60s cooldown
  ("For security purposes, you can only request this after N seconds.") and a project-wide hourly cap
  (no seconds in the message) — `parseRetrySeconds()` handles both, falling back to the generic
  `errRateLimit` string when no number is present.
- **Role-stuck detection (`src/lib/pendingSignupRole.ts`)**: since gotrue won't update metadata on a
  repeat unconfirmed `signUp`, and its response is indistinguishable from a fresh signup, `Auth.tsx`
  keeps its own `localStorage` record of `{email, role}` after every successful `sent`. Before calling
  `signUp` again, it checks for a conflicting record (same email, different role) and — if found — skips
  the network call entirely and shows the `roleMismatch` panel instead. This does NOT fix the stuck role
  (that needs either a support conversation or an admin-side fix); it only stops the UI from lying about
  what just happened. Cross-device re-registration isn't caught (this is `localStorage`, per browser).
  Cleared on successful login (`clearPendingSignup()`), 24h TTL otherwise.
- **Open redirect**: `AuthCallback`'s `next` query param is attacker-controlled (it's copied verbatim from
  the confirmation link). `sanitizeAuthNext()` in `nativeBridge.ts` allows only same-origin absolute URLs,
  `/`-prefixed relative paths (not `//`, which browsers treat as protocol-relative to another host), and
  the native app's own custom URL scheme (`app.gymboard.mobile:`) — that last one is load-bearing, not
  decorative: `auth-email-hook` puts the native `emailRedirectTo` into `next` so confirming on mobile hands
  the user back to the app. A same-origin-only allowlist would silently break that handoff.
- AuthContext restores session on mount via getSession, listens to onAuthStateChange without awaiting inside.
- TOKEN_REFRESHED / USER_UPDATED on the same user must NOT toggle loading or refetch role (prevents view remount when returning from another app).
- Trainer self-promotion: signup-trainer Edge Function is invoked from AuthContext.fetchRole when user_metadata.role === "trainer" AND email_confirmed_at is set AND no trainer role row exists yet. The function requires a valid JWT and a confirmed email — no invite code.
- PKCE fallback in AuthCallback: polls getSession up to 5x with 250ms gaps after exchangeCodeForSession.
