import React, { useEffect, useMemo, useState } from "react";
import { supabase, supabaseConfig } from "./supabaseClient";
import { Link } from "react-router-dom";

type LeaderSummary = {
  leader_address: string;
  total_realized_pnl: number | null;
  total_unrealized_pnl: number | null;
  total_pnl: number | null;
  winning_markets: number | null;
  losing_markets: number | null;
  total_markets: number | null;
  win_rate: number | null;
  updated_at: string | null;
};

type LeaderMarketRow = {
  leader_address: string;
  condition_id: string;
  market_slug: string | null;
  total_realized_pnl: number | null;
  total_unrealized_pnl: number | null;
  total_pnl: number | null;
  market_result: string | null;
  updated_at: string | null;
};

function fmtNum(v: number | null | undefined, digits = 2): string {
  if (typeof v !== "number" || Number.isNaN(v)) return "-";
  return v.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function fmtPct(v: number | null | undefined): string {
  if (typeof v !== "number" || Number.isNaN(v)) return "-";
  return `${(v * 100).toFixed(2)}%`;
}

async function fetchAllRows<T>(table: string, selectCols: string, orderBy: string, ascending = false): Promise<T[]> {
  if (!supabase) return [];
  const pageSize = 1000;
  const out: T[] = [];
  for (let page = 0; page < 100; page += 1) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const res = await supabase.from(table).select(selectCols).order(orderBy, { ascending }).range(from, to);
    if (res.error) {
      throw new Error(res.error.message);
    }
    const chunk = (res.data ?? []) as T[];
    out.push(...chunk);
    if (chunk.length < pageSize) break;
  }
  return out;
}

export function CopytradeLeaderPnlApp() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summaryRows, setSummaryRows] = useState<LeaderSummary[]>([]);
  const [marketRows, setMarketRows] = useState<LeaderMarketRow[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [addressFilter, setAddressFilter] = useState("");
  const [minTotalPnl, setMinTotalPnl] = useState("");
  const [minWinRate, setMinWinRate] = useState("");

  const refresh = async () => {
    if (!supabase) return;
    setLoading(true);
    setError(null);
    try {
      const [summary, markets] = await Promise.all([
        fetchAllRows<LeaderSummary>(
          "copytrade_leader_summary",
          "leader_address,total_realized_pnl,total_unrealized_pnl,total_pnl,winning_markets,losing_markets,total_markets,win_rate,updated_at",
          "total_pnl",
          false
        ),
        fetchAllRows<LeaderMarketRow>(
          "copytrade_leader_market_pnl",
          "leader_address,condition_id,market_slug,total_realized_pnl,total_unrealized_pnl,total_pnl,market_result,updated_at",
          "total_pnl",
          false
        ),
      ]);
      setSummaryRows(summary);
      setMarketRows(markets);
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setSummaryRows([]);
      setMarketRows([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const marketsByLeader = useMemo(() => {
    const m: Record<string, LeaderMarketRow[]> = {};
    for (const row of marketRows) {
      const k = (row.leader_address || "").toLowerCase();
      if (!k) continue;
      if (!m[k]) m[k] = [];
      m[k].push(row);
    }
    for (const k of Object.keys(m)) {
      m[k].sort((a, b) => (b.total_pnl ?? 0) - (a.total_pnl ?? 0));
    }
    return m;
  }, [marketRows]);

  const filteredSummary = useMemo(() => {
    const keyword = addressFilter.trim().toLowerCase();
    const minPnl = minTotalPnl.trim() ? Number(minTotalPnl) : NaN;
    const minWr = minWinRate.trim() ? Number(minWinRate) : NaN;
    return summaryRows.filter((r) => {
      if (keyword && !(r.leader_address || "").toLowerCase().includes(keyword)) return false;
      if (Number.isFinite(minPnl) && typeof r.total_pnl === "number" && r.total_pnl < minPnl) return false;
      if (Number.isFinite(minPnl) && typeof r.total_pnl !== "number") return false;
      if (Number.isFinite(minWr)) {
        if (typeof r.win_rate !== "number") return false;
        if (r.win_rate * 100 < minWr) return false;
      }
      return true;
    });
  }, [summaryRows, addressFilter, minTotalPnl, minWinRate]);

  return (
    <div style={{ fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial", padding: 16, maxWidth: 1600, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Copytrade Leader 归因看板</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Link
            to="/"
            style={{ fontSize: 12, color: "#2d6cdf", textDecoration: "none" }}
          >
            返回 Dashboard
          </Link>
          <div style={{ fontSize: 12, color: "#666" }}>{loading ? "加载中..." : `地址数 ${summaryRows.length}`}</div>
          <button
            onClick={() => refresh()}
            style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid #ddd", background: "#fff" }}
          >
            刷新
          </button>
        </div>
      </div>

      {!supabaseConfig.ok ? (
        <div style={{ marginTop: 12, padding: 12, border: "1px solid #eee", borderRadius: 8, background: "#fafafa", color: "#333" }}>
          未配置 Supabase：请在 `dashboard/.env` 设置 `VITE_SUPABASE_URL` 和 `VITE_SUPABASE_ANON_KEY`。
        </div>
      ) : null}

      {error ? (
        <div style={{ marginTop: 12, padding: 12, border: "1px solid #f3b4b4", background: "#fff2f2", color: "#7a1b1b" }}>
          {error}
        </div>
      ) : null}

      <div style={{ marginTop: 12, border: "1px solid #eee", borderRadius: 8, background: "#fff", padding: 12 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input
            value={addressFilter}
            onChange={(e) => setAddressFilter(e.target.value)}
            placeholder="筛选地址（包含）"
            style={{ width: 280, padding: "6px 8px", borderRadius: 6, border: "1px solid #ddd" }}
          />
          <input
            value={minTotalPnl}
            onChange={(e) => setMinTotalPnl(e.target.value)}
            placeholder="最小总盈亏"
            style={{ width: 140, padding: "6px 8px", borderRadius: 6, border: "1px solid #ddd" }}
          />
          <input
            value={minWinRate}
            onChange={(e) => setMinWinRate(e.target.value)}
            placeholder="最小胜率(%)"
            style={{ width: 140, padding: "6px 8px", borderRadius: 6, border: "1px solid #ddd" }}
          />
        </div>
      </div>

      <div style={{ marginTop: 12, border: "1px solid #eee", borderRadius: 8, background: "#fff", overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "#fafafa" }}>
              <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>Leader 地址</th>
              <th style={{ textAlign: "right", padding: 10, borderBottom: "1px solid #eee" }}>总盈亏</th>
              <th style={{ textAlign: "right", padding: 10, borderBottom: "1px solid #eee" }}>已实现</th>
              <th style={{ textAlign: "right", padding: 10, borderBottom: "1px solid #eee" }}>未实现</th>
              <th style={{ textAlign: "right", padding: 10, borderBottom: "1px solid #eee" }}>胜率</th>
              <th style={{ textAlign: "right", padding: 10, borderBottom: "1px solid #eee" }}>题目数</th>
            </tr>
          </thead>
          <tbody>
            {filteredSummary.map((r) => {
              const k = (r.leader_address || "").toLowerCase();
              const isOpen = Boolean(expanded[k]);
              const markets = marketsByLeader[k] ?? [];
              return (
                <React.Fragment key={k}>
                  <tr
                    style={{ borderBottom: "1px solid #f3f3f3", cursor: "pointer" }}
                    onClick={() => setExpanded((prev) => ({ ...prev, [k]: !prev[k] }))}
                  >
                    <td style={{ padding: 10 }}>
                      <span style={{ marginRight: 6 }}>{isOpen ? "▾" : "▸"}</span>
                      {r.leader_address}
                    </td>
                    <td style={{ padding: 10, textAlign: "right", color: (r.total_pnl ?? 0) >= 0 ? "#1f7a1f" : "#b02a2a" }}>
                      {fmtNum(r.total_pnl, 2)}
                    </td>
                    <td style={{ padding: 10, textAlign: "right" }}>{fmtNum(r.total_realized_pnl, 2)}</td>
                    <td style={{ padding: 10, textAlign: "right" }}>{fmtNum(r.total_unrealized_pnl, 2)}</td>
                    <td style={{ padding: 10, textAlign: "right" }}>{fmtPct(r.win_rate)}</td>
                    <td style={{ padding: 10, textAlign: "right" }}>{fmtNum(r.total_markets, 0)}</td>
                  </tr>

                  {isOpen ? (
                    <tr>
                      <td colSpan={6} style={{ padding: 0, background: "#fcfcfc", borderBottom: "1px solid #f3f3f3" }}>
                        <div style={{ padding: 10 }}>
                          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                            <thead>
                              <tr>
                                <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>题目</th>
                                <th style={{ textAlign: "left", padding: 8, borderBottom: "1px solid #eee" }}>condition_id</th>
                                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #eee" }}>总盈亏</th>
                                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #eee" }}>已实现</th>
                                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #eee" }}>未实现</th>
                                <th style={{ textAlign: "right", padding: 8, borderBottom: "1px solid #eee" }}>结果</th>
                              </tr>
                            </thead>
                            <tbody>
                              {markets.map((m) => (
                                <tr key={`${m.leader_address}-${m.condition_id}`} style={{ borderBottom: "1px solid #f5f5f5" }}>
                                  <td style={{ padding: 8 }}>{m.market_slug || "-"}</td>
                                  <td style={{ padding: 8 }}>{m.condition_id}</td>
                                  <td style={{ padding: 8, textAlign: "right", color: (m.total_pnl ?? 0) >= 0 ? "#1f7a1f" : "#b02a2a" }}>
                                    {fmtNum(m.total_pnl, 2)}
                                  </td>
                                  <td style={{ padding: 8, textAlign: "right" }}>{fmtNum(m.total_realized_pnl, 2)}</td>
                                  <td style={{ padding: 8, textAlign: "right" }}>{fmtNum(m.total_unrealized_pnl, 2)}</td>
                                  <td style={{ padding: 8, textAlign: "right" }}>{m.market_result || "-"}</td>
                                </tr>
                              ))}
                              {!markets.length ? (
                                <tr>
                                  <td colSpan={6} style={{ padding: 8, color: "#888" }}>
                                    无题目明细
                                  </td>
                                </tr>
                              ) : null}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </React.Fragment>
              );
            })}

            {!filteredSummary.length ? (
              <tr>
                <td colSpan={6} style={{ padding: 12, color: "#666" }}>
                  暂无数据
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

