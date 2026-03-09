import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL!;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY!;

// Server-side client (uses anon key, relies on RLS + user token)
export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Create a client authenticated as a specific user (for RLS)
export const createUserClient = (accessToken: string) => {
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });
};
