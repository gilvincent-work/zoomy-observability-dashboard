// The shared local-only guard for every integration test (and, through scripts/local-only.mjs, every script) that can connect to
// Supabase. See the header of scripts/local-only.mjs. A test that builds a Supabase client must call assertLocalSupabase(url)
// first: test/chat-local-only.test.ts fails the suite when one does not.
export {LOCAL_HOSTS, assertLocalSupabase, isLocalSupabaseUrl} from '../../scripts/local-only.mjs';
