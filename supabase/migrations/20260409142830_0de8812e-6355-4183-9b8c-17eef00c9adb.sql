-- Remove duplicate trigger that causes profile insert conflict
DROP TRIGGER IF EXISTS on_auth_user_created_profile ON auth.users;