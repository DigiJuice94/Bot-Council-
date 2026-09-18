"use client";

import { useState } from "react";
import WarRoomDashboard from "@/components/WarRoomDashboard";
import RunnerResearchPanel from "@/components/RunnerResearchPanel";
import DiagnosticsPanel from "@/components/DiagnosticsPanel";

export default function Page() {
  const [researchTabActive, setResearchTabActive] = useState(false);
  return <>
    <WarRoomDashboard
      researchTabActive={researchTabActive}
      onOpenResearch={() => { setResearchTabActive(true); window.scrollTo({ top: 0, behavior: "smooth" }); }}
      onOpenWarRoom={() => setResearchTabActive(false)}
    />
    {researchTabActive && <main className="research-tab-view" aria-label="Research and Filing Cabinet">
      <RunnerResearchPanel />
      <DiagnosticsPanel />
    </main>}
  </>;
}
