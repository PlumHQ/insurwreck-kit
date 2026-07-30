import { getClaims } from "@/lib/claims";
import { ClaimsDashboard } from "@/components/ClaimsDashboard";

export default async function DashboardPage() {
  const claims = await getClaims();
  return <ClaimsDashboard claims={claims} />;
}
