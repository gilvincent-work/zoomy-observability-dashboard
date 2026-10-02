-- coop_chat_digest.sql
-- Owner: zoomy-observability-dashboard (Talk to Data / Ask Coop F10: get_digest).
-- Applied BY HAND in the archive project's SQL editor, AFTER supabase/coop_chat_readonly.sql (it needs the coop_chat_ro role).
-- Idempotent: safe to re-run. Rule: knowledge/best-practices/chat-read-only.md and pii-and-secrets.md.
--
-- The role coop_chat_ro must never read digest_archive itself: its `bundle` column holds verbatim customer quotes. This
-- DEFINER view (no security_invoker) exposes the rendered `digest` plus its window and timestamp, and nothing else.
-- Ask Coop in ro_role mode reads coop_chat_digest; in guarded_service mode the code reads digest_archive with the same
-- four columns and the guard refuses `bundle` and `*`. No write is granted.

create or replace view public.coop_chat_digest as
  select window_from, window_to, digest, created_at
  from public.digest_archive;

revoke all on public.coop_chat_digest from public, anon, authenticated;
grant select on public.coop_chat_digest to coop_chat_ro;

notify pgrst, 'reload schema';
