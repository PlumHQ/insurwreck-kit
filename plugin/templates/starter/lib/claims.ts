import "server-only";
import seed from "@/data/claims.seed.json";
import { supabase } from "./supabase";

export type Claim = {
  id: string;
  memberName: string;
  hospital: string;
  amount: number;
  status: "Submitted" | "Under Review" | "Approved" | "Rejected" | "Paid";
  diagnosis: string;
};

export async function getClaims(): Promise<Claim[]> {
  if (supabase) {
    // --- Supabase switch ---
    // Uncomment to read from your own Supabase project instead of the seed
    // file. Run supabase/schema.sql against it first — this only activates
    // once SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set in .env.local.
    //
    // const { data, error } = await supabase.from("claims").select("*");
    // if (error) throw error;
    // return data as Claim[];
  }

  return seed as Claim[];
}
