import { createClient } from '@supabase/supabase-js';

// Service-role client for backend use only.
// The service role key bypasses Row Level Security — never expose it to the browser.
const supabase = (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY)
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  : null;

export default supabase;
