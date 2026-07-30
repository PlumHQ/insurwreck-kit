import "server-only";
import { createClient } from "@supabase/supabase-js";

// Only set up when both vars are present, so Supabase stays fully optional.
export const supabase =
  process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
    ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)
    : null;
