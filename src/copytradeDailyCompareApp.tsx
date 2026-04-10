import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, supabaseConfig } from "./supabaseClient";

type CompareSummaryRow = {
  date_key: string;
  account_name: string | null;
  leader_address: string;
  leader_total_pnl: number | null;
  our_total_pnl: number | null;
  delta_pnl: number | null;
  leader_excluded_pnl: number | null;
  our_excluded_pnl: number | null;
  visible_leader_pnl: number | null;
  visible_our_pnl: number | null;
  updated_at: string | null;
};

type CompareMarketLegRow = {
  date_key: string;
  account_name: string | null;
  leader_address: string;
  condition_id: string;
  token_id: string;
  market_slug: string | null;
  outcome: string | null;
  exclusion_reason: string | null;
  leader_buy_fill_count: number | null;
  leader_buy_usd: number | null;
  leader_buy_avg_price: number | null;
  leader_sell_fill_count: number | null;
  leader_sell_usd: number | null;
  leader_sell_avg_price: number | null;
  leader_realized_pnl: number | null;
  leader_unrealized_change: number | null;
  leader_total_pnl: number | null;
  our_buy_fill_count: number | null;
  our_buy_usd: number | null;
  our_buy_avg_price: number | null;
  our_sell_fill_count: number | null;
  our_sell_usd: number | null;
  our_sell_avg_price: number | null;
  our_realized_pnl: number | null;
  our_unrealized_change: number | null;
  our_total_pnl: number | null;
  primary_gap_reason: string | null;
  updated_at: string | null;
};

function n(v: number | null | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function fmtUsd(v: number | null | undefined): string {
  if (typeof v !== "number" || Number.isNaN(v)) return "-";
  return v.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function fmtPrice(v: number | null | undefined): string {
  if (typeof v !== "number" || Number.isNaN(v)) return "-";
  return v.toFixed(4);
}

function shortAddr(v: string): string {
  return v.length > 12 ? `${v.slice(0, 6)}...${v.slice(-4)}` : v;
}

function gapReasonLabel(v: string | null | undefined): string {
  if (v === "count_gap") return "次数差异";
  if (v === "sizing_gap") return "金额差异";
  if (v === "price_gap") return "均价差异";
  if (v === "excluded") return "已排除";
  return "无明显主因";
}

async function fetchAllRows<T>(table: string, selectCols: string): Promise<T[]> {
  if (!supabase) return [];
  const out: T[] = [];
  const pageSize = 1000;
  for (let page = 0; page < 100; page += 1) {
    const from = page * pageSize;
    const to = from + pageSize - 1;
    const res = await supabase
      .from(table)
      .select(selectCols)
      .order("date_key", { ascending: false })
      .range(from, to);
    if (res.error) throw new Error(res.error.message);
    const chunk = (res.data ?? []) as T[];
    out.push(...chunk);
    if (chunk.length < pageSize) break;
  }
  return out;
}

export function CopytradeDailyCompareApp() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [summaryRows, setSummaryRows] = useState<CompareSummaryRow[]>([]);
  const [marketRows, setMarketRows] = useState<CompareMarketLegRow[]>([]);
  const [selectedAccount, setSelectedAccount] = useState<string>("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showExcluded, setShowExcluded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!supabase) {
        setError("Supabase 未配置");
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const [summary, legs] = await Promise.all([
          fetchAllRows<CompareSummaryRow>(
            "copytrade_compare_daily_summary",
            "date_key,account_name,leader_address,leader_total_pnl,our_total_pnl,delta_pnl,leader_excluded_pnl,our_excluded_pnl,visible_leader_pnl,visible_our_pnl,updated_at"
          ),
          fetchAllRows<CompareMarketLegRow>(
            "copytrade_compare_daily_market_leg",
            "date_key,account_name,leader_address,condition_id,token_id,market_slug,outcome,exclusion_reason,leader_buy_fill_count,leader_buy_usd,leader_buy_avg_price,leader_sell_fill_count,leader_sell_usd,leader_sell_avg_price,leader_realized_pnl,leader_unrealized_change,leader_total_pnl,our_buy_fill_count,our_buy_usd,our_buy_avg_price,our_sell_fill_count,our_sell_usd,our_sell_avg_price,our_realized_pnl,our_unrealized_change,our_total_pnl,primary_gap_reason,updated_at"
          ),
        ]);
        if (cancelled) return;
        setSummaryRows(summary);
        setMarketRows(legs);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "加载失败");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
  }, []);

  const availableAccounts = useMemo(() => {
    return Array.from(
      new Set(summaryRows.map((row) => String(row.account_name || "").trim()).filter(Boolean))
    ).sort();
  }, [summaryRows]);

  useEffect(() => {
    if (!selectedAccount && availableAccounts.length) {
      setSelectedAccount(availableAccounts[0]);
    }
  }, [availableAccounts, selectedAccount]);

  const latestDateByAccount = useMemo(() => {
    const out = new Map<string, string>();
    for (const row of summaryRows) {
      const accountName = String(row.account_name || "").trim();
      if (!accountName) continue;
      const current = out.get(accountName);
      if (!current || row.date_key > current) out.set(accountName, row.date_key);
    }
    return out;
  }, [summaryRows]);

  const selectedDate = latestDateByAccount.get(selectedAccount) ?? "";

  const currentSummaryRows = useMemo(() => {
    return summaryRows
      .filter((row) => row.account_name === selectedAccount && row.date_key === selectedDate)
      .sort((a, b) => Math.abs(n(b.delta_pnl)) - Math.abs(n(a.delta_pnl)));
  }, [selectedAccount, selectedDate, summaryRows]);

  const currentMarketRows = useMemo(() => {
    return marketRows.filter((row) => row.account_name === selectedAccount && row.date_key === selectedDate);
  }, [selectedAccount, selectedDate, marketRows]);

  const marketRowsByLeader = useMemo(() => {
    const out = new Map<string, CompareMarketLegRow[]>();
    for (const row of currentMarketRows) {
      const leaderRows = out.get(row.leader_address) ?? [];
      leaderRows.push(row);
      out.set(row.leader_address, leaderRows);
    }
    return out;
  }, [currentMarketRows]);

  return (
    <div style={{ fontFamily: "system-ui, -apple-system, Segoe UI, sans-serif", padding: 16, maxWidth: 1600, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12, marginBottom: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>跟单日盈亏对照</h2>
          <div style={{ fontSize: 12, color: "#666", marginTop: 4 }}>
            {selectedDate ? `日期 ${selectedDate}（UTC+8）` : "等待数据"}
          </div>
        </div>
        <div style={{ display: "flex", gap: 10, fontSize: 12 }}>
          <Link to="/" style={{ color: "#2d6cdf", textDecoration: "none" }}>首页</Link>
          <Link to="/leader-attribution" style={{ color: "#2d6cdf", textDecoration: "none" }}>Leader 归因页</Link>
          <Link to="/gap-analysis" style={{ color: "#2d6cdf", textDecoration: "none" }}>跟单分析</Link>
        </div>
      </div>

      {!supabaseConfig.ok ? (
        <div style={{ color: "#b02a2a" }}>Supabase 未配置，页面不可用。</div>
      ) : null}
      {loading ? <div>加载中...</div> : null}
      {error ? <div style={{ color: "#b02a2a" }}>{error}</div> : null}

      {!loading && !error ? (
        <>
          <div style={{ display: "flex", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
            {availableAccounts.map((accountName) => (
              <button
                key={accountName}
                onClick={() => setSelectedAccount(accountName)}
                style={{
                  padding: "6px 10px",
                  borderRadius: 999,
                  border: accountName === selectedAccount ? "1px solid #1f4e9e" : "1px solid #ddd",
                  background: accountName === selectedAccount ? "#e8f0ff" : "#fff",
                  cursor: "pointer",
                  fontSize: 12,
                }}
              >
                {accountName}
              </button>
            ))}
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, marginLeft: "auto" }}>
              <input type="checkbox" checked={showExcluded} onChange={(e) => setShowExcluded(e.target.checked)} />
              显示已排除市场
            </label>
          </div>

          <div style={{ overflowX: "auto", border: "1px solid #eee", borderRadius: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
              <thead>
                <tr style={{ background: "#fafafa" }}>
                  {["Leader", "Leader 总盈亏", "我的总盈亏", "差值", "已排除盈亏", "更新时间"].map((label) => (
                    <th key={label} style={{ textAlign: "left", padding: "10px 12px", fontSize: 12, borderBottom: "1px solid #eee" }}>{label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {currentSummaryRows.map((row) => {
                  const leaderKey = `${row.account_name}::${row.leader_address}`;
                  const isOpen = Boolean(expanded[leaderKey]);
                  const leaderLegs = marketRowsByLeader.get(row.leader_address) ?? [];
                  const visibleLegs = showExcluded ? leaderLegs : leaderLegs.filter((leg) => !leg.exclusion_reason);
                  const grouped = new Map<string, CompareMarketLegRow[]>();
                  for (const leg of visibleLegs) {
                    const key = String(leg.market_slug || leg.condition_id);
                    const list = grouped.get(key) ?? [];
                    list.push(leg);
                    grouped.set(key, list);
                  }
                  return (
                    <FragmentRow
                      key={leaderKey}
                      header={
                        <tr
                          onClick={() => setExpanded((prev) => ({ ...prev, [leaderKey]: !prev[leaderKey] }))}
                          style={{ cursor: "pointer", background: isOpen ? "#fcfdff" : "#fff" }}
                        >
                          <td style={cellStyleLeft}>
                            <div style={{ fontWeight: 600 }}>{shortAddr(row.leader_address)}</div>
                            <div style={{ fontSize: 11, color: "#888" }}>{isOpen ? "收起明细" : "展开明细"}</div>
                          </td>
                          <td style={cellStyle}><span style={{ color: n(row.leader_total_pnl) >= 0 ? "#1f7a1f" : "#b02a2a" }}>{fmtUsd(row.leader_total_pnl)}</span></td>
                          <td style={cellStyle}><span style={{ color: n(row.our_total_pnl) >= 0 ? "#1f7a1f" : "#b02a2a" }}>{fmtUsd(row.our_total_pnl)}</span></td>
                          <td style={cellStyle}><span style={{ color: n(row.delta_pnl) >= 0 ? "#1f7a1f" : "#b02a2a" }}>{fmtUsd(row.delta_pnl)}</span></td>
                          <td style={cellStyle}>
                            L {fmtUsd(row.leader_excluded_pnl)} / 我 {fmtUsd(row.our_excluded_pnl)}
                          </td>
                          <td style={cellStyleLeft}>{row.updated_at ? row.updated_at.replace("T", " ").slice(0, 19) : "-"}</td>
                        </tr>
                      }
                      details={
                        isOpen ? (
                          <tr>
                            <td colSpan={6} style={{ padding: 12, borderBottom: "1px solid #eee", background: "#fcfdff" }}>
                              <div style={{ fontSize: 12, color: "#666", marginBottom: 10 }}>
                                主明细: Leader {fmtUsd(row.visible_leader_pnl)} / 我 {fmtUsd(row.visible_our_pnl)}，
                                已排除: Leader {fmtUsd(row.leader_excluded_pnl)} / 我 {fmtUsd(row.our_excluded_pnl)}
                              </div>
                              {grouped.size === 0 ? (
                                <div style={{ fontSize: 12, color: "#888" }}>没有可显示的市场明细。</div>
                              ) : (
                                Array.from(grouped.entries())
                                  .sort((a, b) => a[0].localeCompare(b[0]))
                                  .map(([marketKey, rows]) => (
                                    <div key={marketKey} style={{ marginBottom: 14 }}>
                                      <div style={{ fontWeight: 600, marginBottom: 6 }}>{marketKey}</div>
                                      <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                        <thead>
                                          <tr style={{ background: "#fff" }}>
                                            {["方向", "Leader 买次", "Leader 买额", "Leader 买均价", "Leader 卖次", "Leader 卖额", "Leader 卖均价", "Leader 盈亏", "我买次", "我买额", "我买均价", "我卖次", "我卖额", "我卖均价", "我的盈亏", "主因"].map((label) => (
                                              <th key={label} style={{ ...smallCell, textAlign: "left", background: "#fffdf5" }}>{label}</th>
                                            ))}
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {rows
                                            .sort((a, b) => String(a.outcome || "").localeCompare(String(b.outcome || "")))
                                            .map((leg) => (
                                              <tr key={`${leg.condition_id}::${leg.token_id}`}>
                                                <td style={smallCell}>{leg.outcome || "-"}</td>
                                                <td style={smallCell}>{n(leg.leader_buy_fill_count)}</td>
                                                <td style={smallCell}>{fmtUsd(leg.leader_buy_usd)}</td>
                                                <td style={smallCell}>{fmtPrice(leg.leader_buy_avg_price)}</td>
                                                <td style={smallCell}>{n(leg.leader_sell_fill_count)}</td>
                                                <td style={smallCell}>{fmtUsd(leg.leader_sell_usd)}</td>
                                                <td style={smallCell}>{fmtPrice(leg.leader_sell_avg_price)}</td>
                                                <td style={{ ...smallCell, color: n(leg.leader_total_pnl) >= 0 ? "#1f7a1f" : "#b02a2a" }}>{fmtUsd(leg.leader_total_pnl)}</td>
                                                <td style={smallCell}>{n(leg.our_buy_fill_count)}</td>
                                                <td style={smallCell}>{fmtUsd(leg.our_buy_usd)}</td>
                                                <td style={smallCell}>{fmtPrice(leg.our_buy_avg_price)}</td>
                                                <td style={smallCell}>{n(leg.our_sell_fill_count)}</td>
                                                <td style={smallCell}>{fmtUsd(leg.our_sell_usd)}</td>
                                                <td style={smallCell}>{fmtPrice(leg.our_sell_avg_price)}</td>
                                                <td style={{ ...smallCell, color: n(leg.our_total_pnl) >= 0 ? "#1f7a1f" : "#b02a2a" }}>{fmtUsd(leg.our_total_pnl)}</td>
                                                <td style={smallCell}>
                                                  {gapReasonLabel(leg.exclusion_reason ? "excluded" : leg.primary_gap_reason)}
                                                </td>
                                              </tr>
                                            ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  ))
                              )}
                            </td>
                          </tr>
                        ) : null
                      }
                    />
                  );
                })}
              </tbody>
            </table>
          </div>

          {!currentSummaryRows.length ? <div style={{ marginTop: 12, color: "#888" }}>当前账号暂无 compare 数据。</div> : null}
        </>
      ) : null}
    </div>
  );
}

function FragmentRow(props: { header: JSX.Element; details: JSX.Element | null }) {
  return (
    <>
      {props.header}
      {props.details}
    </>
  );
}

const cellStyle = {
  padding: "10px 12px",
  borderBottom: "1px solid #eee",
  fontSize: 12,
};

const cellStyleLeft = {
  ...cellStyle,
  textAlign: "left" as const,
};

const smallCell = {
  padding: "6px 8px",
  borderBottom: "1px solid #f1f1f1",
  fontSize: 11,
  textAlign: "left" as const,
};
