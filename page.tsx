import WarRoomDashboard from "@/components/WarRoomDashboard";
import RunnerResearchPanel from "@/components/RunnerResearchPanel";
import DiagnosticsPanel from "@/components/DiagnosticsPanel";
import TournamentPanel from "@/components/TournamentPanel";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function Page() {
  return <><WarRoomDashboard /><TournamentPanel /><RunnerResearchPanel /><DiagnosticsPanel /></>;
}
