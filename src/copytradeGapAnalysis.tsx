import React, { useEffect, useMemo, useState } from "react";
import { supabase } from "./supabaseClient";
import { Link } from "react-router-dom";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type GapAnalysisRow = {
  leader_address: string;
  our_total_pnl: number | null;
  leader_pnl_on_copied: number | null;
  total_gap_usd: number | null;
  factors_json: FactorResult[] | string | null;
  per_market_json: PerMarketRow[] | string | null;
  generated_at: string | null;
};

type FactorResult = {
  name: string;
  label: string;
  gap_usd: number;
  pct_of_gap: number;
  details: Record<string, any>;
  recommendations: string[];
};

type PerMarketRow = {
  condition_id: string;
  market_slug: string;
  our_cost: number;
  our_pnl: number;
  our_trades: number;
  slippage: number;
  leader_pnl_attributed: number;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtNum(v: number | null | undefined, digits = 2): string {
  if (typeof v !== "number" || Number.isNaN(v)) return "-";
  return v.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function parseJson<T>(v: T[] | string | null): T[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try { return JSON.parse(v); } catch { return []; }
  }
  return [];
}

// ---------------------------------------------------------------------------
// Waterfall chart data builder
// ---------------------------------------------------------------------------

type WaterfallItem = {
  label: string;
  value: number;
  cumStart: number;
  cumEnd: number;
  isTotal?: boolean;
};

function buildWaterfallData(
  ourPnl: number,
  factors: FactorResult[],
): WaterfallItem[] {
  const items: WaterfallItem[] = [];
  // Start bar: our actual PnL
  items.push({
    label: "我方实际PnL",
    value: ourPnl,
    cumStart: 0,
    cumEnd: ourPnl,
    isTotal: true,
  });

  let cum = ourPnl;
  for (const f of factors) {
    if (f.gap_usd === 0) continue;
    const start = cum;
    cum += f.gap_usd;
    items.push({
      label: f.label,
      value: f.gap_usd,
      cumStart: start,
      cumEnd: cum,
    });
  }

  // End bar: theoretical max PnL
  items.push({
    label: "理论最大PnL",
    value: cum,
    cumStart: 0,
    cumEnd: cum,
    isTotal: true,
  });

  return items;
}

// ---------------------------------------------------------------------------
// Waterfall Chart Component
// ---------------------------------------------------------------------------

function WaterfallChart({ data }: { data: WaterfallItem[] }) {
  // Transform for stacked bar: invisible base + visible bar
  const chartData = data.map((d) => {
    const lo = Math.min(d.cumStart, d.cumEnd);
    const hi = Math.max(d.cumStart, d.cumEnd);
    return {
      label: d.label,
      base: lo,
      bar: hi - lo,
      value: d.value,
      isTotal: d.isTotal,
      isNeg: d.value < 0,
    };
  });

  return (
    <ResponsiveContainer width="100%" height={320}>
      <BarChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 40 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
        <XAxis
          dataKey="label"
          tick={{ fontSize: 11 }}
          angle={-25}
          textAnchor="end"
          height={60}
        />
        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `$${v.toFixed(0)}`} />
        <Tooltip
          formatter={(val: any, name: any) => {
            if (name === "base") return [null, null];
            return [`$${Number(val).toFixed(2)}`, "金额"];
          }}
        />
        <ReferenceLine y={0} stroke="#666" />
        <Bar dataKey="base" stackId="a" fill="transparent" />
        <Bar dataKey="bar" stackId="a">
          {chartData.map((entry, idx) => (
            <Cell
              key={idx}
              fill={
                entry.isTotal
                  ? (entry.value >= 0 ? "#2196F3" : "#F44336")
                  : entry.isNeg
                  ? "#F44336"
                  : "#4CAF50"
              }
            />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

// ---------------------------------------------------------------------------
// Factor Detail Card
// ---------------------------------------------------------------------------

function FactorCard({ factor }: { factor: FactorResult }) {
  const [open, setOpen] = useState(false);
  const color = factor.gap_usd < -0.01 ? "#d32f2f" : factor.gap_usd > 0.01 ? "#2e7d32" : "#666";

  return (
    <div
      style={{
        border: "1px solid #e0e0e0",
        borderRadius: 8,
        padding: "10px 14px",
        marginBottom: 8,
        background: "#fafafa",
      }}
    >
      <div
        style={{ display: "flex", justifyContent: "space-between", cursor: "pointer" }}
        onClick={() => setOpen(!open)}
      >
        <span style={{ fontWeight: 600, fontSize: 14 }}>
          {open ? "▾" : "▸"} {factor.label}
        </span>
        <span style={{ color, fontWeight: 600, fontSize: 14 }}>
          ${fmtNum(factor.gap_usd)}
          {factor.pct_of_gap !== 0 && (
            <span style={{ color: "#888", fontWeight: 400, fontSize: 12, marginLeft: 6 }}>
              ({fmtNum(factor.pct_of_gap, 1)}%)
            </span>
          )}
        </span>
      </div>
      {open && (
        <div style={{ marginTop: 8, fontSize: 12 }}>
          {factor.recommendations.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              {factor.recommendations.map((r, i) => (
                <div key={i} style={{ color: "#1565c0", marginBottom: 2 }}>💡 {r}</div>
              ))}
            </div>
          )}
          <pre style={{ background: "#f5f5f5", padding: 8, borderRadius: 4, overflow: "auto", maxHeight: 200, fontSize: 11 }}>
            {JSON.stringify(factor.details, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Per-Market Table
// ---------------------------------------------------------------------------

function PerMarketTable({ rows }: { rows: PerMarketRow[] }) {
  if (!rows.length) return <div style={{ color: "#888", fontSize: 12, padding: 8 }}>暂无市场明细</div>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
        <thead>
          <tr style={{ background: "#f5f5f5", textAlign: "left" }}>
            <th style={{ padding: "6px 8px" }}>市场</th>
            <th style={{ padding: "6px 8px", textAlign: "right" }}>我方成本</th>
            <th style={{ padding: "6px 8px", textAlign: "right" }}>我方PnL</th>
            <th style={{ padding: "6px 8px", textAlign: "right" }}>滑点</th>
            <th style={{ padding: "6px 8px", textAlign: "right" }}>Leader归因PnL</th>
            <th style={{ padding: "6px 8px", textAlign: "right" }}>笔数</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 30).map((m, i) => (
            <tr key={i} style={{ borderBottom: "1px solid #eee" }}>
              <td style={{ padding: "4px 8px", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {m.market_slug || m.condition_id.slice(0, 16)}
              </td>
              <td style={{ padding: "4px 8px", textAlign: "right" }}>${fmtNum(m.our_cost)}</td>
              <td style={{ padding: "4px 8px", textAlign: "right", color: m.our_pnl >= 0 ? "#2e7d32" : "#d32f2f" }}>
                ${fmtNum(m.our_pnl)}
              </td>
              <td style={{ padding: "4px 8px", textAlign: "right", color: m.slippage > 0 ? "#d32f2f" : "#666" }}>
                ${fmtNum(m.slippage, 4)}
              </td>
              <td style={{ padding: "4px 8px", textAlign: "right", color: m.leader_pnl_attributed >= 0 ? "#2e7d32" : "#d32f2f" }}>
                ${fmtNum(m.leader_pnl_attributed)}
              </td>
              <td style={{ padding: "4px 8px", textAlign: "right" }}>{m.our_trades}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Leader Summary Table (overview mode)
// ---------------------------------------------------------------------------

function LeaderSummaryTable({
  rows,
  onSelect,
}: {
  rows: GapAnalysisRow[];
  onSelect: (addr: string) => void;
}) {
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ background: "#f5f5f5", textAlign: "left" }}>
            <th style={{ padding: "8px 10px" }}>Leader</th>
            <th style={{ padding: "8px 10px", textAlign: "right" }}>我方PnL</th>
            <th style={{ padding: "8px 10px", textAlign: "right" }}>优化空间</th>
            <th style={{ padding: "8px 10px", textAlign: "right" }}>生成时间</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const factors = parseJson<FactorResult>(r.factors_json);
            const extra = factors.reduce((s, f) => s + f.gap_usd, 0);
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
                <td style={{ padding: "6px 10px", textAlign: "right", color: (r.our_total_pnl ?? 0) >= 0 ? "#2e7d32" : "#d32f2f" }}>
                  ${fmtNum(r.our_total_pnl)}
                </td>
                <td style={{ padding: "6px 10px", textAlign: "right", fontWeight: 600, color: extra > 0 ? "#2e7d32" : extra < 0 ? "#d32f2f" : "#666" }}>
                  {extra >= 0 ? `+$${fmtNum(extra)}` : `-$${fmtNum(Math.abs(extra))}`}
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
  const [rows, setRows] = useState<GapAnalysisRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLeader, setSelectedLeader] = useState<string | null>(null);
  const [showMarkets, setShowMarkets] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    setLoading(true);
    supabase
      .from("copytrade_gap_analysis")
      .select("*")
      .order("total_gap_usd", { ascending: true })
      .then(({ data, error }) => {
        if (error) console.error(error);
        setRows((data ?? []) as GapAnalysisRow[]);
        setLoading(false);
      });
  }, []);

  const aggregateStats = useMemo(() => {
    if (!rows.length) return null;
    const totalOurPnl = rows.reduce((s, r) => s + (r.our_total_pnl ?? 0), 0);
    let totalExtra = 0;
    for (const r of rows) {
      const fs = parseJson<FactorResult>(r.factors_json);
      totalExtra += fs.reduce((s, f) => s + f.gap_usd, 0);
    }
    return { totalOurPnl, totalExtra, count: rows.length };
  }, [rows]);

  const current = useMemo(
    () => rows.find((r) => r.leader_address === selectedLeader),
    [rows, selectedLeader]
  );

  const factors = useMemo(() => parseJson<FactorResult>(current?.factors_json ?? null), [current]);
  const perMarket = useMemo(() => parseJson<PerMarketRow>(current?.per_market_json ?? null), [current]);

  const waterfallData = useMemo(() => {
    if (!current) return [];
    return buildWaterfallData(
      current.our_total_pnl ?? 0,
      factors,
    );
  }, [current, factors]);

  if (loading) return <div style={{ padding: 16, fontFamily: "system-ui" }}>加载中...</div>;
  if (!rows.length) return (
    <div style={{ padding: 16, fontFamily: "system-ui" }}>
      <Link to="/leader-attribution" style={{ fontSize: 13, color: "#1976d2" }}>← 归因面板</Link>
      <p style={{ marginTop: 12, color: "#888" }}>暂无差距分析数据。请先运行: python -m copytrade.analyze_gap --all --sync</p>
    </div>
  );

  return (
    <div style={{ padding: "12px 16px", fontFamily: "system-ui", maxWidth: 960, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
        <Link to="/leader-attribution" style={{ fontSize: 13, color: "#1976d2", textDecoration: "none" }}>← 归因面板</Link>
        <h2 style={{ margin: 0, fontSize: 18 }}>跟单差距归因分析</h2>
      </div>

      {selectedLeader === null ? (
        <>
          {/* Aggregate stat cards */}
          {aggregateStats && (
            <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
              {[
                { label: "Leader 数", value: aggregateStats.count, fmt: (v: number) => String(v), color: "#333" },
                { label: "我方总PnL", value: aggregateStats.totalOurPnl, fmt: (v: number) => `$${fmtNum(v)}`, color: aggregateStats.totalOurPnl >= 0 ? "#2e7d32" : "#d32f2f" },
                { label: "优化空间", value: aggregateStats.totalExtra, fmt: (v: number) => v >= 0 ? `+$${fmtNum(v)}` : `-$${fmtNum(Math.abs(v))}`, color: aggregateStats.totalExtra >= 0 ? "#2e7d32" : "#d32f2f" },
              ].map((c, i) => (
                <div key={i} style={{ background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: 8, padding: "8px 16px", minWidth: 120 }}>
                  <div style={{ fontSize: 11, color: "#888" }}>{c.label}</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: c.color }}>{c.fmt(c.value)}</div>
                </div>
              ))}
            </div>
          )}

          {/* Leader summary table */}
          <LeaderSummaryTable rows={rows} onSelect={setSelectedLeader} />
        </>
      ) : current ? (
        <>
          {/* Back button + leader address */}
          <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 12 }}>
            <span
              onClick={() => { setSelectedLeader(null); setShowMarkets(false); }}
              style={{ fontSize: 13, color: "#1976d2", cursor: "pointer" }}
            >
              ← 返回总览
            </span>
            <span style={{ fontFamily: "monospace", fontSize: 13 }}>
              {current.leader_address.slice(0, 10)}...{current.leader_address.slice(-6)}
            </span>
            {current.generated_at && (
              <span style={{ fontSize: 11, color: "#888" }}>
                生成于: {new Date(current.generated_at).toLocaleString()}
              </span>
            )}
          </div>

          {/* Summary cards */}
          <div style={{ display: "flex", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
            {(() => {
              const extra = factors.reduce((s, f) => s + f.gap_usd, 0);
              return [
                { label: "我方实际PnL", value: current.our_total_pnl, fmt: (v: number) => `$${fmtNum(v)}`, color: (current.our_total_pnl ?? 0) >= 0 ? "#2e7d32" : "#d32f2f" },
                { label: "优化空间", value: extra, fmt: (v: number) => v >= 0 ? `+$${fmtNum(v)}` : `-$${fmtNum(Math.abs(v))}`, color: extra >= 0 ? "#2e7d32" : "#d32f2f" },
                { label: "理论最大PnL", value: (current.our_total_pnl ?? 0) + extra, fmt: (v: number) => `$${fmtNum(v)}`, color: ((current.our_total_pnl ?? 0) + extra) >= 0 ? "#2e7d32" : "#d32f2f" },
              ].map((c, i) => (
                <div key={i} style={{ background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: 8, padding: "8px 16px", minWidth: 140 }}>
                  <div style={{ fontSize: 11, color: "#888" }}>{c.label}</div>
                  <div style={{ fontSize: 20, fontWeight: 700, color: c.color }}>{c.fmt(c.value)}</div>
                </div>
              ));
            })()}
          </div>

          {/* Waterfall chart */}
          {waterfallData.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>优化空间瀑布图</h3>
              <WaterfallChart data={waterfallData} />
            </div>
          )}

          {/* Factor cards */}
          <div style={{ marginBottom: 16 }}>
            <h3 style={{ fontSize: 14, margin: "0 0 8px" }}>因子明细</h3>
            {factors.map((f, i) => (
              <FactorCard key={i} factor={f} />
            ))}
          </div>

          {/* Per-market table */}
          <div>
            <h3
              style={{ fontSize: 14, margin: "0 0 8px", cursor: "pointer" }}
              onClick={() => setShowMarkets(!showMarkets)}
            >
              {showMarkets ? "▾" : "▸"} 市场明细 ({perMarket.length})
            </h3>
            {showMarkets && <PerMarketTable rows={perMarket} />}
          </div>
        </>
      ) : null}
    </div>
  );
}
