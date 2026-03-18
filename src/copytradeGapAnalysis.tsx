import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";
import { Link } from "react-router-dom";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AnalyticsRow = {
  leader_address: string;
  account_name: string;
  summary_json: Record<string, any>;
  report_json: Record<string, any>;
  generated_at: string | null;
};

type FillEffSummary = {
  total_attempts: number;
  filled: number;
  partial: number;
  expired: number;
  failed: number;
  fill_rate: number;
  partial_fill_rate: number;
  avg_slippage_bps: number;
  total_slippage_usd: number;
  total_missed_profit: number;
};

type SizingSummary = {
  fixed_usd_per_trade: number;
  pnl_fixed_sizing: number;
  pnl_leader_sizing: number;
  sizing_impact: number;
  market_count: number;
  sizing_has_alpha: boolean;
};

type TradeCountSummary = {
  config_limited: { count: number; est_pnl: number };
  system_issues: { count: number; est_pnl: number };
  beyond_cap: { count: number; est_pnl: number };
  not_captured: { count: number; est_pnl: number };
  total_diff: number;
  markets_with_diff: number;
};

type CoverageSummary = {
  total_leader_signals: number;
  filled: number;
  expired_or_failed: number;
  partial: number;
  skipped: number;
  not_captured: number;
  coverage_rate: number;
  response_rate: number;
  total_missed_profit: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtNum(v: number | null | undefined, digits = 2): string {
  if (typeof v !== "number" || Number.isNaN(v)) return "-";
  return v.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function fmtPct(v: number | null | undefined): string {
  if (typeof v !== "number" || Number.isNaN(v)) return "-";
  return `${(v * 100).toFixed(1)}%`;
}

function fmtUsd(v: number | null | undefined): string {
  if (typeof v !== "number" || Number.isNaN(v)) return "-";
  const prefix = v >= 0 ? "" : "-";
  return `${prefix}$${fmtNum(Math.abs(v))}`;
}

const cardStyle: React.CSSProperties = {
  background: "#f9f9f9",
  border: "1px solid #e0e0e0",
  borderRadius: 8,
  padding: "8px 16px",
  minWidth: 100,
};

const metricBoxStyle: React.CSSProperties = {
  border: "1px solid #e0e0e0",
  borderRadius: 8,
  padding: "12px 16px",
  marginBottom: 12,
  background: "#fafafa",
};

// ---------------------------------------------------------------------------
// Stat Card
// ---------------------------------------------------------------------------

function StatCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={cardStyle}>
      <div style={{ fontSize: 11, color: "#888" }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: color || "#333" }}>{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Metric Section: Fill Efficiency
// ---------------------------------------------------------------------------

function FillEfficiencySection({ summary, recs }: { summary: FillEffSummary; recs: string[] }) {
  return (
    <div style={metricBoxStyle}>
      <h3 style={{ fontSize: 14, margin: "0 0 8px", fontWeight: 600 }}>成交效率</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 8, fontSize: 13 }}>
        <div>完全成交: <b>{summary.filled}/{summary.total_attempts}</b> ({fmtPct(summary.fill_rate)})</div>
        <div>部分成交: <b>{summary.partial}</b> ({fmtPct(summary.partial_fill_rate)})</div>
        <div>未成交: <b>{summary.expired}</b>  失败: <b>{summary.failed}</b></div>
        <div>平均滑点: <b>{fmtNum(summary.avg_slippage_bps, 1)}</b> bps</div>
        <div>滑点总额: <b style={{ color: summary.total_slippage_usd > 0 ? "#d32f2f" : "#2e7d32" }}>{fmtUsd(summary.total_slippage_usd)}</b></div>
        <div>未成交错失: <b style={{ color: "#d32f2f" }}>{fmtUsd(summary.total_missed_profit)}</b></div>
      </div>
      <Recommendations recs={recs} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Metric Section: Sizing Alpha
// ---------------------------------------------------------------------------

function SizingSection({ summary, recs }: { summary: SizingSummary; recs: string[] }) {
  const impactColor = summary.sizing_impact > 0 ? "#2e7d32" : summary.sizing_impact < 0 ? "#d32f2f" : "#666";
  return (
    <div style={metricBoxStyle}>
      <h3 style={{ fontSize: 14, margin: "0 0 8px", fontWeight: 600 }}>Sizing Alpha</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8, fontSize: 13 }}>
        <div>固定金额 PnL: <b>{fmtUsd(summary.pnl_fixed_sizing)}</b> (每次 ${fmtNum(summary.fixed_usd_per_trade, 0)})</div>
        <div>Leader 金额 PnL: <b>{fmtUsd(summary.pnl_leader_sizing)}</b></div>
        <div>Sizing Impact: <b style={{ color: impactColor }}>{fmtUsd(summary.sizing_impact)}</b>
          {" "}({summary.sizing_has_alpha ? "leader sizing 有 alpha" : "固定金额更优"})
        </div>
        <div>涉及市场: <b>{summary.market_count}</b></div>
      </div>
      <Recommendations recs={recs} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Metric Section: Trade Count Diff
// ---------------------------------------------------------------------------

function TradeCountSection({ summary, recs }: { summary: TradeCountSummary; recs: string[] }) {
  const cats = [
    { label: "配置限制", ...summary.config_limited, color: "#ff9800" },
    { label: "系统问题", ...summary.system_issues, color: "#d32f2f" },
    { label: "超出上限", ...summary.beyond_cap, color: "#9e9e9e" },
    { label: "未捕获", ...summary.not_captured, color: "#f44336" },
  ];
  return (
    <div style={metricBoxStyle}>
      <h3 style={{ fontSize: 14, margin: "0 0 8px", fontWeight: 600 }}>交易次数差异</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8, fontSize: 13 }}>
        {cats.map((c, i) => (
          <div key={i}>
            <span style={{ color: c.color, fontWeight: 600 }}>{c.label}</span>: {c.count} 笔
            {c.est_pnl !== 0 && <span style={{ color: "#888", marginLeft: 4 }}>(est {fmtUsd(c.est_pnl)})</span>}
          </div>
        ))}
      </div>
      <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>
        总差异: {summary.total_diff} 笔，涉及 {summary.markets_with_diff} 个市场
      </div>
      <Recommendations recs={recs} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Metric Section: Coverage Rate
// ---------------------------------------------------------------------------

function CoverageSection({ summary, recs }: { summary: CoverageSummary; recs: string[] }) {
  return (
    <div style={metricBoxStyle}>
      <h3 style={{ fontSize: 14, margin: "0 0 8px", fontWeight: 600 }}>跟单覆盖率</h3>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8, fontSize: 13 }}>
        <div>Leader 总信号: <b>{summary.total_leader_signals}</b></div>
        <div>覆盖率: <b style={{ color: summary.coverage_rate >= 0.7 ? "#2e7d32" : "#d32f2f" }}>{fmtPct(summary.coverage_rate)}</b> ({summary.filled}/{summary.total_leader_signals})</div>
        <div>响应率: <b>{fmtPct(summary.response_rate)}</b></div>
        <div>跳过: <b>{summary.skipped}</b>  未捕获: <b>{summary.not_captured}</b></div>
        <div>未成交: <b>{summary.expired_or_failed}</b>  部分: <b>{summary.partial}</b></div>
        <div>估算错失: <b style={{ color: "#d32f2f" }}>{fmtUsd(summary.total_missed_profit)}</b></div>
      </div>
      <Recommendations recs={recs} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Recommendations
// ---------------------------------------------------------------------------

function Recommendations({ recs }: { recs: string[] }) {
  if (!recs || !recs.length) return null;
  return (
    <div style={{ marginTop: 6 }}>
      {recs.map((r, i) => (
        <div key={i} style={{ fontSize: 12, color: "#1565c0", marginBottom: 2 }}>→ {r}</div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Leader Summary Table
// ---------------------------------------------------------------------------

function LeaderSummaryTable({
  rows,
  onSelect,
}: {
  rows: AnalyticsRow[];
  onSelect: (addr: string) => void;
}) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: "#f5f5f5", textAlign: "left" }}>
            <th style={{ padding: "8px 10px" }}>Leader</th>
            <th style={{ padding: "8px 10px", textAlign: "right" }}>成交率</th>
            <th style={{ padding: "8px 10px", textAlign: "right" }}>覆盖率</th>
            <th style={{ padding: "8px 10px", textAlign: "right" }}>Sizing Impact</th>
            <th style={{ padding: "8px 10px", textAlign: "right" }}>错失利润</th>
            <th style={{ padding: "8px 10px", textAlign: "right" }}>分析时间</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const s = r.summary_json || {};
            const fe = s.fill_efficiency || {};
            const cov = s.coverage_rate || {};
            const sz = s.sizing_difference || {};
            const missedTotal = (fe.total_missed_profit || 0) + (cov.total_missed_profit || 0);
            return (
              <tr
                key={r.leader_address}
                onClick={() => onSelect(r.leader_address)}
                style={{ borderBottom: "1px solid #eee", cursor: "pointer" }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#f0f7ff")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "")}
              >
                <td style={{ padding: "6px 10px", fontFamily: "monospace", fontSize: 12 }}>
                  {r.leader_address.slice(0, 10)}...{r.leader_address.slice(-6)}
                </td>
                <td style={{ padding: "6px 10px", textAlign: "right" }}>{fmtPct(fe.fill_rate)}</td>
                <td style={{ padding: "6px 10px", textAlign: "right", color: (cov.coverage_rate || 0) >= 0.7 ? "#2e7d32" : "#d32f2f" }}>
                  {fmtPct(cov.coverage_rate)}
                </td>
                <td style={{ padding: "6px 10px", textAlign: "right", color: (sz.sizing_impact || 0) >= 0 ? "#2e7d32" : "#d32f2f" }}>
                  {fmtUsd(sz.sizing_impact)}
                </td>
                <td style={{ padding: "6px 10px", textAlign: "right", color: "#d32f2f" }}>
                  {fmtUsd(missedTotal)}
                </td>
                <td style={{ padding: "6px 10px", textAlign: "right", fontSize: 11, color: "#888" }}>
                  {r.generated_at ? new Date(r.generated_at).toLocaleDateString() : "-"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export function GapAnalysisApp() {
  const [rows, setRows] = useState<AnalyticsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLeader, setSelectedLeader] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    setLoading(true);
    // 每个 leader 取最新一条
    supabase
      .from("copytrade_analytics_reports")
      .select("leader_address, account_name, summary_json, report_json, generated_at")
      .order("generated_at", { ascending: false })
      .then(({ data, error }) => {
        if (error) console.error(error);
        // 去重：每个 leader 只保留最新
        const seen = new Set<string>();
        const unique: AnalyticsRow[] = [];
        for (const row of (data ?? []) as AnalyticsRow[]) {
          if (!seen.has(row.leader_address)) {
            seen.add(row.leader_address);
            unique.push(row);
          }
        }
        setRows(unique);
        setLoading(false);
      });
  }, []);

  const aggregateStats = useMemo(() => {
    if (!rows.length) return null;
    let totalFillRate = 0;
    let totalCoverage = 0;
    let totalSizing = 0;
    let totalMissed = 0;
    for (const r of rows) {
      const s = r.summary_json || {};
      totalFillRate += (s.fill_efficiency?.fill_rate || 0);
      totalCoverage += (s.coverage_rate?.coverage_rate || 0);
      totalSizing += (s.sizing_difference?.sizing_impact || 0);
      totalMissed += (s.fill_efficiency?.total_missed_profit || 0) + (s.coverage_rate?.total_missed_profit || 0);
    }
    const n = rows.length;
    return {
      count: n,
      avgFillRate: totalFillRate / n,
      avgCoverage: totalCoverage / n,
      totalSizing,
      totalMissed,
    };
  }, [rows]);

  const current = useMemo(
    () => rows.find((r) => r.leader_address === selectedLeader),
    [rows, selectedLeader]
  );

  // 从 report_json 提取 recommendations
  const getMetricRecs = (metricName: string): string[] => {
    if (!current?.report_json) return [];
    const metrics = (current.report_json as any)?.metrics;
    if (!Array.isArray(metrics)) return [];
    const m = metrics.find((x: any) => x.name === metricName);
    return m?.recommendations || [];
  };

  if (loading) return <div style={{ padding: 16, fontFamily: "system-ui" }}>加载中...</div>;
  if (!rows.length) return (
    <div style={{ padding: 16, fontFamily: "system-ui" }}>
      <Link to="/leader-attribution" style={{ fontSize: 13, color: "#1976d2" }}>← 归因面板</Link>
      <p style={{ marginTop: 12, color: "#888" }}>暂无分析数据。请先运行: python -m copytrade.analytics.cli --all --sync-activity --save-db</p>
    </div>
  );

  return (
    <div style={{ padding: "12px 16px", fontFamily: "system-ui", maxWidth: 960, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <Link to="/leader-attribution" style={{ fontSize: 13, color: "#1976d2", textDecoration: "none" }}>← 归因面板</Link>
        <h2 style={{ margin: 0, fontSize: 18 }}>跟单分析</h2>
      </div>

      {selectedLeader === null ? (
        <>
          {aggregateStats && (
            <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
              <StatCard label="Leader 数" value={String(aggregateStats.count)} />
              <StatCard label="平均成交率" value={fmtPct(aggregateStats.avgFillRate)} color={aggregateStats.avgFillRate >= 0.8 ? "#2e7d32" : "#d32f2f"} />
              <StatCard label="平均覆盖率" value={fmtPct(aggregateStats.avgCoverage)} color={aggregateStats.avgCoverage >= 0.7 ? "#2e7d32" : "#d32f2f"} />
              <StatCard label="Sizing 总影响" value={fmtUsd(aggregateStats.totalSizing)} color={aggregateStats.totalSizing >= 0 ? "#2e7d32" : "#d32f2f"} />
              <StatCard label="总错失利润" value={fmtUsd(aggregateStats.totalMissed)} color="#d32f2f" />
            </div>
          )}
          <LeaderSummaryTable rows={rows} onSelect={setSelectedLeader} />
        </>
      ) : current ? (
        <>
          <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 12 }}>
            <span
              onClick={() => setSelectedLeader(null)}
              style={{ fontSize: 13, color: "#1976d2", cursor: "pointer" }}
            >
              ← 返回总览
            </span>
            <span style={{ fontFamily: "monospace", fontSize: 13 }}>
              {current.leader_address.slice(0, 10)}...{current.leader_address.slice(-6)}
            </span>
            {current.generated_at && (
              <span style={{ fontSize: 11, color: "#888" }}>
                分析于: {new Date(current.generated_at).toLocaleString()}
              </span>
            )}
          </div>

          {current.summary_json?.fill_efficiency && !(current.summary_json.fill_efficiency as any).note && (
            <FillEfficiencySection
              summary={current.summary_json.fill_efficiency as FillEffSummary}
              recs={getMetricRecs("fill_efficiency")}
            />
          )}

          {current.summary_json?.sizing_difference && !(current.summary_json.sizing_difference as any).note && (
            <SizingSection
              summary={current.summary_json.sizing_difference as SizingSummary}
              recs={getMetricRecs("sizing_difference")}
            />
          )}

          {current.summary_json?.trade_count_diff && !(current.summary_json.trade_count_diff as any).note && (
            <TradeCountSection
              summary={current.summary_json.trade_count_diff as TradeCountSummary}
              recs={getMetricRecs("trade_count_diff")}
            />
          )}

          {current.summary_json?.coverage_rate && !(current.summary_json.coverage_rate as any).note && (
            <CoverageSection
              summary={current.summary_json.coverage_rate as CoverageSummary}
              recs={getMetricRecs("coverage_rate")}
            />
          )}
        </>
      ) : null}
    </div>
  );
}
