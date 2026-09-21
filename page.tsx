import WarRoomDashboard from "@/components/WarRoomDashboard";
import RunnerResearchPanel from "@/components/RunnerResearchPanel";
import DiagnosticsPanel from "@/components/DiagnosticsPanel";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function Page() {
  return <><WarRoomDashboard /><RunnerResearchPanel /><DiagnosticsPanel /></>;
}
