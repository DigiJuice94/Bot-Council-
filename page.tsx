import CouncilRoomDashboard from "@/components/CouncilRoomDashboard";
import RunnerResearchPanel from "@/components/RunnerResearchPanel";
import DiagnosticsPanel from "@/components/DiagnosticsPanel";

export const dynamic = "force-dynamic";
export const revalidate = 0;

// REVERT: replace CouncilRoomDashboard with WarRoomDashboard below to restore the old dashboard
export default function Page() {
  return <><CouncilRoomDashboard /><RunnerResearchPanel /><DiagnosticsPanel /></>;
}
