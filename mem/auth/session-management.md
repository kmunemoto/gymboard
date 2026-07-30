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
  broken screen — and re-registering from the other tab would overwrite `user_metadata.role`.
- **Login failing with `Email not confirmed` shows the same panel**, not a toast. Otherwise someone who
  missed the first notice hits the identical invisible wall twice.
- New hooks in `Auth.tsx` must go above the `authLoading` / `user` early returns, or React throws
  "Rendered more hooks than expected" when `authLoading` flips.
- AuthContext restores session on mount via getSession, listens to onAuthStateChange without awaiting inside.
- TOKEN_REFRESHED / USER_UPDATED on the same user must NOT toggle loading or refetch role (prevents view remount when returning from another app).
- Trainer self-promotion: signup-trainer Edge Function is invoked from AuthContext.fetchRole when user_metadata.role === "trainer" AND email_confirmed_at is set AND no trainer role row exists yet. The function requires a valid JWT and a confirmed email — no invite code.
- PKCE fallback in AuthCallback: polls getSession up to 5x with 250ms gaps after exchangeCodeForSession.
