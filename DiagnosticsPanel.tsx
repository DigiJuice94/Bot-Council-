"use client";

import { useEffect, useMemo, useState } from "react";

type Funnel = {
  candidates: number;
  riskPassed: number;
  watches: number;
  buySignals: number;
  skips: number;
  paperBuys: number;
  explorationBuys: number;
  rejections: Record<string, number>;
};

type Provider = { name: string; configured: boolean; ok: boolean; lastError?: string };
type Shadow = { id: string; symbol: string; decision: string; movePct?: number; reviewedAt?: string; missedRunner?: boolean };
type Payload = {
  scanCount: number;
  candidateCount: number;
  buyCount: number;
  explorationBuyCount?: number;
  missedRunnerCount?: number;
  funnel?: Funnel;
  providers?: Provider[];
  shadowBook?: Shadow[];
};

export default function DiagnosticsPanel() {
  const [status, setStatus] = useState<Payload | null>(null);
  useEffect(() => {
    const receive = (event: Event) => setStatus((event as CustomEvent<Payload>).detail);
    window.addEventListener("bot-war-room:status", receive);
    return () => window.removeEventListener("bot-war-room:status", receive);
  }, []);

  const funnel = status?.funnel;
  const providers = status?.providers ?? [];
  const configured = providers.filter((p) => p.configured);
  const live = configured.filter((p) => p.ok);
  const coverage = configured.length ? Math.round(live.length / configured.length * 100) : 0;
  const rejectionRows = useMemo(() => Object.entries(funnel?.rejections ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 5), [funnel]);
  const shadows = (status?.shadowBook ?? []).filter((row) => row.reviewedAt).slice(0, 5);

  return (
    <section className="v213-diagnostics page-panel" id="diagnostics">
      <div className="v213-head">
        <div><h2>Decision Funnel</h2><p>Exactly where real candidates are being filtered, probed, or executed.</p></div>
        <div className="v213-coverage"><strong>{coverage}%</strong><span>provider coverage</span></div>
      </div>

      <div className="v213-funnel-grid">
        <div><b>{status?.scanCount ?? 0}</b><span>scan ticks</span></div>
        <div><b>{funnel?.candidates ?? status?.candidateCount ?? 0}</b><span>candidates</span></div>
        <div><b>{funnel?.riskPassed ?? 0}</b><span>risk pass</span></div>
        <div><b>{funnel?.watches ?? 0}</b><span>WATCH</span></div>
        <div><b>{funnel?.buySignals ?? 0}</b><span>BUY signals</span></div>
        <div><b>{funnel?.paperBuys ?? status?.buyCount ?? 0}</b><span>paper buys</span></div>
        <div><b>{funnel?.explorationBuys ?? status?.explorationBuyCount ?? 0}</b><span>WATCH probes</span></div>
        <div><b>{status?.missedRunnerCount ?? 0}</b><span>missed runners</span></div>
      </div>

      <div className="v213-two-col">
        <div className="v213-box"><h3>Top rejection reasons</h3>{rejectionRows.length ? rejectionRows.map(([reason, count]) => <div className="v213-row" key={reason}><span>{reason}</span><b>{count}</b></div>) : <p className="v213-muted">No rejection reasons recorded yet.</p>}</div>
        <div className="v213-box"><h3>Provider waterfall</h3>{providers.map((provider) => <div className="v213-row" key={provider.name}><span>{provider.name.toUpperCase()}</span><b className={provider.ok ? "v213-ok" : provider.configured ? "v213-wait" : "v213-off"}>{provider.ok ? "LIVE" : provider.configured ? "WAIT" : "OFF"}</b></div>)}</div>
      </div>

      <div className="v213-box v213-shadow"><h3>Shadow reviews</h3>{shadows.length ? shadows.map((row) => <div className="v213-row" key={row.id}><span>${row.symbol} · {row.decision}</span><b className={(row.movePct ?? 0) >= 0 ? "v213-ok" : "v213-bad"}>{row.movePct == null ? "—" : `${row.movePct >= 0 ? "+" : ""}${row.movePct.toFixed(1)}%`}</b></div>) : <p className="v213-muted">WATCH/SKIP outcomes will be revisited automatically after the review window.</p>}</div>
    </section>
  );
}
