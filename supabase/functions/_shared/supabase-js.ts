// The one supabase-js specifier the Edge Functions use. Its version must equal
// the root package.json devDependency (scripts/guards/edge-function-npm-pins.test.ts);
// bump both together.
export {
  createClient,
  type SupabaseClient,
} from 'npm:@supabase/supabase-js@2.118.0';
