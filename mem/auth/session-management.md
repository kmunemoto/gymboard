---
name: Session management
description: Session restoration, email confirmation required, PKCE fallback
type: feature
---
- Supabase auth: **Confirm email is required** (self-service open signup model). Users must click the confirmation email link before signing in. After signUp, no session is returned — show "確認メールを送信しました…" and switch to login mode.
- AuthContext restores session on mount via getSession, listens to onAuthStateChange without awaiting inside.
- TOKEN_REFRESHED / USER_UPDATED on the same user must NOT toggle loading or refetch role (prevents view remount when returning from another app).
- Trainer self-promotion: signup-trainer Edge Function is invoked from AuthContext.fetchRole when user_metadata.role === "trainer" AND email_confirmed_at is set AND no trainer role row exists yet. The function requires a valid JWT and a confirmed email — no invite code.
- PKCE fallback in AuthCallback: polls getSession up to 5x with 250ms gaps after exchangeCodeForSession.
