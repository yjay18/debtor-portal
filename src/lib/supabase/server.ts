import { createClient } from "@supabase/supabase-js";

export function createServerSupabaseClient() {
  if (typeof window !== "undefined") {
    throw new Error("The Supabase secret client can only run on the server.");
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY.",
    );
  }
// since there are no logins 
  return createClient(url, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
