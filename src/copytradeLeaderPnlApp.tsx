import { useEffect, useMemo, useState } from "react";
import { supabase, supabaseConfig } from "./supabaseClient";
import { Link } from "react-router-dom";

type LeaderSummary = {
  leader_address: string;
  account_name: string | null;
  total_realized_pnl: number | null;
  total_unrealized_pnl: number | null;
  total_pnl: number | null;
  winning_markets: number | null;
  losing_markets: number | null;
  total_markets: number | null;
  win_rate: number | null;
  updated_at: string | null;
};

type PnlCurvePoint = { t: number; p: number };

type DailyLeaderPnl = {
  date_key: string;
  leader_address: string;
  account_name: string | null;
  realized_pnl: number | null;
  unrealized_pnl: number | null;
  total_pnl: number | null;
  market_count: number | null;
};

type AddressMetricLite = {
  address: string;
  total_pnl: number | null;
  roi: number | null;
  profit_factor: number | null;
  max_drawdown: number | null;
  sharpe: number | null;
  win_rate: number | null;
  avg_trade_price: number | null;
  winning_trades: number | null;
  losing_trades: number | null;
  confidence: string | null;
  source_tags: string | null;
  updated_at: string | null;
};

type AddressCurveRow = {
  address: string;
  daily: Map<string, number>;
  latestCum: number;
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
    if (res.error) throw new Error(res.error.message);
    const chunk = (res.data ?? []) as T[];
    out.push(...chunk);
    if (chunk.length < pageSize) break;
  }
  return out;
}

const PNL_CURVE_URL = "https://user-pnl-api.polymarket.com/user-pnl";

async function fetchPnlCurve(address: string): Promise<PnlCurvePoint[]> {
  const res = await fetch(`${PNL_CURVE_URL}?user_address=${address}&interval=all&fidelity=12h`);
  if (!res.ok) return [];
  const data: unknown = await res.json();
  if (!Array.isArray(data)) return [];
  return data
    .filter((r: any) => typeof r?.t === "number" && typeof r?.p === "number")
    .map((r: any) => ({ t: r.t as number, p: r.p as number }));
}

const pnlColor = (v: number) => (v >= 0 ? "#1f7a1f" : "#b02a2a");
const shortAddr = (a: string) => a.length > 12 ? `${a.slice(0, 6)}...${a.slice(-4)}` : a;
const cellR = { padding: "6px 8px", textAlign: "right" as const, borderBottom: "1px solid #f5f5f5", fontSize: 11 };
function DailyLeaderPnlTable({ data, totalByLeader }: { data: DailyLeaderPnl[]; totalByLeader: Record<string, number> }) {
  if (!data.length) return <div style={{ color: "#888", fontSize: 12, padding: 8 }}>暂无 Leader 每日盈亏数据</div>;
  const dates = Array.from(new Set(data.map((r) => r.date_key))).sort().slice(-14);
  const dateSet = new Set(dates);
  const dailyMap = new Map<string, Map<string, number>>();
  for (const r of data) {
    if (!dateSet.has(r.date_key)) continue;
    const addr = r.leader_address;
    if (!dailyMap.has(addr)) dailyMap.set(addr, new Map());
    dailyMap.get(addr)!.set(r.date_key, r.total_pnl ?? 0);
  }
  const leaders = Array.from(dailyMap.keys()).sort((a, b) => {
    const ta = dates.reduce((s, d) => s + (dailyMap.get(a)?.get(d) ?? 0), 0);
    const tb = dates.reduce((s, d) => s + (dailyMap.get(b)?.get(d) ?? 0), 0);
    return tb - ta;
  });

  const columnTotals = dates.map((d) => leaders.reduce((s, addr) => s + (dailyMap.get(addr)?.get(d) ?? 0), 0));
  const summaryTotal = leaders.reduce((s, addr) => s + (totalByLeader[addr.toLowerCase()] ?? 0), 0);

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
      <thead>
        <tr style={{ background: "#fafafa" }}>
          <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "1px solid #eee", position: "sticky", left: 0, background: "#fafafa", zIndex: 1 }}>Leader</th>
          {dates.map((d) => (
            <th key={d} style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #eee", whiteSpace: "nowrap" }}>{d.slice(5)}</th>
          ))}
          <th style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #eee", fontWeight: 700 }}>累计总盈亏</th>
        </tr>
      </thead>
      <tbody>
        {leaders.map((addr) => {
          const row = dailyMap.get(addr)!;
          const rangeTotal = dates.reduce((s, d) => s + (row.get(d) ?? 0), 0);
          const total = totalByLeader[addr.toLowerCase()] ?? rangeTotal;
          return (
            <tr key={addr}>
              <td style={{ padding: "6px 8px", borderBottom: "1px solid #f5f5f5", position: "sticky", left: 0, background: "#fff", zIndex: 1 }} title={addr}>
                <a href={`https://polymarket.com/profile/${addr}`} target="_blank" rel="noreferrer" style={{ color: "#1a4fff", textDecoration: "none", fontSize: 11 }}>{shortAddr(addr)}</a>
              </td>
              {dates.map((d) => {
                const v = row.get(d) ?? 0;
                return <td key={d} style={{ ...cellR, color: pnlColor(v) }}>{v === 0 ? "-" : fmtNum(v, 2)}</td>;
              })}
              <td style={{ ...cellR, fontWeight: 700, color: pnlColor(total) }}>{fmtNum(total, 2)}</td>
            </tr>
          );
        })}
        <tr style={{ background: "#fafafa" }}>
          <td style={{ padding: "6px 8px", borderTop: "1px solid #eee", fontWeight: 700, position: "sticky", left: 0, zIndex: 1 }}>区间合计</td>
          {columnTotals.map((v, idx) => (
            <td key={idx} style={{ ...cellR, borderTop: "1px solid #eee", fontWeight: 700, color: pnlColor(v) }}>{v === 0 ? "-" : fmtNum(v, 2)}</td>
          ))}
          <td style={{ ...cellR, borderTop: "1px solid #eee", fontWeight: 700, color: pnlColor(summaryTotal) }}>{fmtNum(summaryTotal, 2)}</td>
        </tr>
      </tbody>
    </table>
  );
}
function toDailyDeltaMap(points: PnlCurvePoint[]): { daily: Map<string, number>; latestCum: number } {
  const byDay = new Map<string, number>();
  for (const pt of points) {
    const d = new Date(pt.t * 1000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    byDay.set(key, pt.p);
  }
  const allDays = Array.from(byDay.keys()).sort();
  const daily = new Map<string, number>();
  let prev = 0;
  for (const day of allDays) {
    const cum = byDay.get(day) ?? 0;
    daily.set(day, cum - prev);
    prev = cum;
  }
  return { daily, latestCum: allDays.length ? (byDay.get(allDays[allDays.length - 1]) ?? 0) : 0 };
}

function DailyPnlTable({ rows, showDetails }: { rows: AddressCurveRow[]; showDetails: boolean }) {
  if (!rows.length) return <div style={{ color: "#888", fontSize: 12, padding: 8 }}>暂无净值数据</div>;

  const allDays = Array.from(new Set(rows.flatMap((r) => Array.from(r.daily.keys())))).sort();
  const recentDays = allDays.slice(-14);
  if (!recentDays.length) return <div style={{ color: "#888", fontSize: 12, padding: 8 }}>暂无净值数据</div>;

  const sumRow: AddressCurveRow = {
    address: "__total__",
    daily: new Map<string, number>(
      recentDays.map((d) => [d, rows.reduce((s, r) => s + (r.daily.get(d) ?? 0), 0)])
    ),
    latestCum: rows.reduce((s, r) => s + r.latestCum, 0),
  };

  const sortedRows = [...rows].sort((a, b) => b.latestCum - a.latestCum);
  const viewRows = showDetails ? [sumRow, ...sortedRows] : [sumRow];

  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
      <thead>
        <tr style={{ background: "#fafafa" }}>
          <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "1px solid #eee" }}>地址</th>
          {recentDays.map((d) => (
            <th key={d} style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #eee", whiteSpace: "nowrap" }}>{d.slice(5)}</th>
          ))}
          <th style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #eee", fontWeight: 700 }}>14日合计</th>
          <th style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #eee", fontWeight: 700 }}>累计PnL</th>
        </tr>
      </thead>
      <tbody>
        {viewRows.map((r, idx) => {
          const totalDelta = recentDays.reduce((s, d) => s + (r.daily.get(d) ?? 0), 0);
          const isTotal = idx === 0;
          return (
            <tr key={r.address} style={isTotal ? { background: "#fafafa" } : undefined}>
              <td style={{ padding: "6px 8px", borderBottom: "1px solid #f5f5f5", fontWeight: isTotal ? 700 : 500 }}>
                {isTotal ? "合计收益" : shortAddr(r.address)}
              </td>
              {recentDays.map((d) => {
                const v = r.daily.get(d) ?? 0;
                return (
                  <td key={d} style={{ ...cellR, color: pnlColor(v), fontWeight: isTotal ? 700 : 400 }}>
                    {v >= 0 ? "+" : ""}{fmtNum(v, 2)}
                  </td>
                );
              })}
              <td style={{ ...cellR, fontWeight: 700, color: pnlColor(totalDelta) }}>{totalDelta >= 0 ? "+" : ""}{fmtNum(totalDelta, 2)}</td>
              <td style={{ ...cellR, fontWeight: 700, color: pnlColor(r.latestCum) }}>{fmtNum(r.latestCum, 2)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
function LeaderTable({ rows, metrics }: { rows: LeaderSummary[]; metrics: Record<string, AddressMetricLite> }) {
  if (!rows.length) return <div style={{ padding: 12, color: "#666", fontSize: 12 }}>暂无数据</div>;
  const thStyle = { textAlign: "right" as const, padding: 10, borderBottom: "1px solid #eee" };
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
      <thead>
        <tr style={{ background: "#fafafa" }}>
          <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>Leader 地址</th>
          <th style={thStyle}>总盈亏</th>
          <th style={thStyle}>地址总PnL</th>
          <th style={thStyle}>已实现</th>
          <th style={thStyle}>未实现</th>
          <th style={thStyle}>胜率</th>
          <th style={thStyle}>题目数</th>
          <th style={thStyle}>ROI</th>
          <th style={thStyle}>PF</th>
          <th style={thStyle}>MDD</th>
          <th style={thStyle}>Sharpe</th>
          <th style={thStyle}>AvgPx</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const k = (r.leader_address || "").toLowerCase();
          const m = metrics[k];
          return (
            <tr key={k} style={{ borderBottom: "1px solid #f3f3f3" }}>
              <td style={{ padding: 10 }}>
                <a href={`https://polymarket.com/profile/${r.leader_address}`} target="_blank" rel="noreferrer"
                  style={{ color: "#1a4fff", textDecoration: "none" }}>{r.leader_address}</a>
              </td>
              <td style={{ padding: 10, textAlign: "right", color: pnlColor(r.total_pnl ?? 0) }}>{fmtNum(r.total_pnl, 2)}</td>
              <td style={{ padding: 10, textAlign: "right", color: pnlColor(m?.total_pnl ?? 0) }}>{fmtNum(m?.total_pnl, 2)}</td>
              <td style={{ padding: 10, textAlign: "right" }}>{fmtNum(r.total_realized_pnl, 2)}</td>
              <td style={{ padding: 10, textAlign: "right" }}>{fmtNum(r.total_unrealized_pnl, 2)}</td>
              <td style={{ padding: 10, textAlign: "right" }}>{fmtPct(r.win_rate)}</td>
              <td style={{ padding: 10, textAlign: "right" }}>{fmtNum(r.total_markets, 0)}</td>
              <td style={{ padding: 10, textAlign: "right" }}>{fmtPct(m?.roi)}</td>
              <td style={{ padding: 10, textAlign: "right" }}>{fmtNum(m?.profit_factor, 2)}</td>
              <td style={{ padding: 10, textAlign: "right" }}>{fmtPct(m?.max_drawdown)}</td>
              <td style={{ padding: 10, textAlign: "right" }}>{fmtNum(m?.sharpe, 2)}</td>
              <td style={{ padding: 10, textAlign: "right" }}>{fmtNum(m?.avg_trade_price, 4)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
export function CopytradeLeaderPnlApp() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summaryRows, setSummaryRows] = useState<LeaderSummary[]>([]);
  const [metricsByAddress, setMetricsByAddress] = useState<Record<string, AddressMetricLite>>({});
  const [dailyLeaderPnl, setDailyLeaderPnl] = useState<DailyLeaderPnl[]>([]);
  const [curveByAddress, setCurveByAddress] = useState<Record<string, PnlCurvePoint[]>>({});
  const [activeAccount, setActiveAccount] = useState<string>("");
  const [addressFilter, setAddressFilter] = useState("");
  const [minTotalPnl, setMinTotalPnl] = useState("");
  const [minWinRate, setMinWinRate] = useState("");
  const [showPnlAddressDetails, setShowPnlAddressDetails] = useState(false);

  const refresh = async () => {
    if (!supabase) return;
    setLoading(true);
    setError(null);
    try {
      const [summary, leaderDaily] = await Promise.all([
        fetchAllRows<LeaderSummary>(
          "copytrade_leader_summary",
          "leader_address,account_name,total_realized_pnl,total_unrealized_pnl,total_pnl,winning_markets,losing_markets,total_markets,win_rate,updated_at",
          "total_pnl", false
        ),
        fetchAllRows<DailyLeaderPnl>(
          "copytrade_daily_leader_pnl",
          "date_key,leader_address,account_name,realized_pnl,unrealized_pnl,total_pnl,market_count",
          "date_key", false
        ),
      ]);
      setDailyLeaderPnl(leaderDaily);
      setSummaryRows(summary);
      const addrs = Array.from(
        new Set(
          [
            ...summary.map((r) => (r.leader_address || "").toLowerCase().trim()),
            ...leaderDaily.map((r) => (r.leader_address || "").toLowerCase().trim()),
          ].filter(Boolean)
        )
      );

      const curveEntries = await Promise.all(
        addrs.map(async (addr) => {
          try {
            return [addr, await fetchPnlCurve(addr)] as const;
          } catch {
            return [addr, [] as PnlCurvePoint[]] as const;
          }
        })
      );
      const curves: Record<string, PnlCurvePoint[]> = {};
      for (const [addr, points] of curveEntries) curves[addr] = points;
      setCurveByAddress(curves);
      if (addrs.length > 0) {
        const mres = await supabase.from("address_metrics")
          .select("address,total_pnl,roi,profit_factor,max_drawdown,sharpe,win_rate,avg_trade_price,winning_trades,losing_trades,confidence,source_tags,updated_at")
          .in("address", addrs);
        if (mres.error) throw new Error(mres.error.message);
        const mm: Record<string, AddressMetricLite> = {};
        for (const row of (mres.data ?? []) as AddressMetricLite[]) {
          const k = (row.address || "").toLowerCase().trim();
          if (k) mm[k] = row;
        }
        setMetricsByAddress(mm);
      } else {
        setMetricsByAddress({});
      }
    } catch (e: any) {
      setError(String(e?.message ?? e));
      setSummaryRows([]); setMetricsByAddress({}); setCurveByAddress({}); setDailyLeaderPnl([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);
  const accountNames = useMemo(() => {
    const names = new Set<string>();
    for (const r of summaryRows) names.add(r.account_name || "default");
    for (const r of dailyLeaderPnl) names.add(r.account_name || "default");
    return Array.from(names).sort();
  }, [summaryRows, dailyLeaderPnl]);

  // 默认选中第一个账号
  const currentAccount = activeAccount || accountNames[0] || "";

  const acctSummary = useMemo(() => {
    const keyword = addressFilter.trim().toLowerCase();
    const minPnl = minTotalPnl.trim() ? Number(minTotalPnl) : NaN;
    const minWr = minWinRate.trim() ? Number(minWinRate) : NaN;
    return summaryRows.filter((r) => {
      if ((r.account_name || "default") !== currentAccount) return false;
      if (keyword && !(r.leader_address || "").toLowerCase().includes(keyword)) return false;
      if (Number.isFinite(minPnl) && (typeof r.total_pnl !== "number" || r.total_pnl < minPnl)) return false;
      if (Number.isFinite(minWr) && (typeof r.win_rate !== "number" || r.win_rate * 100 < minWr)) return false;
      return true;
    });
  }, [summaryRows, currentAccount, addressFilter, minTotalPnl, minWinRate]);

  const acctDailyLeader = useMemo(() =>
    dailyLeaderPnl.filter((r) => (r.account_name || "default") === currentAccount),
    [dailyLeaderPnl, currentAccount]
  );

  const acctLeaderAddresses = useMemo(() => {
    const addrs = new Set<string>();
    for (const r of summaryRows) {
      if ((r.account_name || "default") !== currentAccount) continue;
      const a = (r.leader_address || "").toLowerCase().trim();
      if (a) addrs.add(a);
    }
    for (const r of dailyLeaderPnl) {
      if ((r.account_name || "default") !== currentAccount) continue;
      const a = (r.leader_address || "").toLowerCase().trim();
      if (a) addrs.add(a);
    }
    return Array.from(addrs).sort();
  }, [summaryRows, dailyLeaderPnl, currentAccount]);

  const acctCurveRows = useMemo<AddressCurveRow[]>(() =>
    acctLeaderAddresses.map((addr) => {
      const points = curveByAddress[addr] ?? [];
      const delta = toDailyDeltaMap(points);
      return { address: addr, daily: delta.daily, latestCum: delta.latestCum };
    }),
    [acctLeaderAddresses, curveByAddress]
  );

  const leaderTotalByAddr = useMemo<Record<string, number>>(() => {
    const m: Record<string, number> = {};
    for (const r of summaryRows) {
      if ((r.account_name || "default") !== currentAccount) continue;
      const a = (r.leader_address || "").toLowerCase();
      if (!a) continue;
      m[a] = r.total_pnl ?? 0;
    }
    return m;
  }, [summaryRows, currentAccount]);

  const acctTotalPnl = useMemo(() =>
    summaryRows.filter((r) => (r.account_name || "default") === currentAccount)
      .reduce((s, r) => s + (r.total_pnl ?? 0), 0),
    [summaryRows, currentAccount]
  );

  const acctLeaderCount = useMemo(() =>
    summaryRows.filter((r) => (r.account_name || "default") === currentAccount).length,
    [summaryRows, currentAccount]
  );

  const tabStyle = (name: string) => ({
    padding: "8px 16px",
    fontSize: 13,
    fontWeight: name === currentAccount ? 700 : 400,
    color: name === currentAccount ? "#1a4fff" : "#555",
    background: name === currentAccount ? "#eef3ff" : "transparent",
    border: name === currentAccount ? "1px solid #c5d5f7" : "1px solid transparent",
    borderBottom: name === currentAccount ? "2px solid #1a4fff" : "2px solid transparent",
    borderRadius: "6px 6px 0 0",
    cursor: "pointer" as const,
  });
  return (
    <div style={{ fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial", padding: 16, maxWidth: 1600, margin: "0 auto" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
        <h2 style={{ margin: 0 }}>Copytrade Leader 归因看板</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <Link to="/" style={{ fontSize: 12, color: "#2d6cdf", textDecoration: "none" }}>返回 Dashboard</Link>
          <Link to="/gap-analysis" style={{ fontSize: 12, color: "#2d6cdf", textDecoration: "none" }}>跟单分析</Link>
          <div style={{ fontSize: 12, color: "#666" }}>{loading ? "加载中..." : `共 ${summaryRows.length} 条`}</div>
          <button onClick={() => refresh()} style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid #ddd", background: "#fff" }}>刷新</button>
        </div>
      </div>

      {!supabaseConfig.ok && (
        <div style={{ marginTop: 12, padding: 12, border: "1px solid #eee", borderRadius: 8, background: "#fafafa", color: "#333" }}>
          未配置 Supabase：请在 dashboard/.env 设置 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY。
        </div>
      )}
      {error && (
        <div style={{ marginTop: 12, padding: 12, border: "1px solid #f3b4b4", background: "#fff2f2", color: "#7a1b1b" }}>{error}</div>
      )}

      {/* 账号 Tab 栏 */}
      <div style={{ marginTop: 16, display: "flex", gap: 4, borderBottom: "1px solid #eee" }}>
        {accountNames.map((name) => (
          <div key={name} style={tabStyle(name)} onClick={() => setActiveAccount(name)}>{name}</div>
        ))}
      </div>

      {/* 账号汇总信息 */}
      <div style={{ marginTop: 12, display: "flex", gap: 16, fontSize: 13 }}>
        <span>账号: <b>{currentAccount}</b></span>
        <span>Leader 数: <b>{acctLeaderCount}</b></span>
        <span>总盈亏: <b style={{ color: pnlColor(acctTotalPnl) }}>{fmtNum(acctTotalPnl, 2)}</b></span>
      </div>

      {/* 1. 账户每日收益 */}
      <div style={{ marginTop: 12, border: "1px solid #eee", borderRadius: 8, background: "#fff", padding: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>账户每日收益（官方 PnL API）</div>
        <div style={{ marginBottom: 8 }}>
          <button
            onClick={() => setShowPnlAddressDetails((v) => !v)}
            style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid #ddd", background: "#fff", cursor: "pointer" }}
          >
            {showPnlAddressDetails ? "展开地址明细" : "仅看合计"}
          </button>
        </div>
        <DailyPnlTable rows={acctCurveRows} showDetails={showPnlAddressDetails} />
      </div>

      {/* 2. Leader 每日盈亏 */}
      <div style={{ marginTop: 12, border: "1px solid #eee", borderRadius: 8, background: "#fff", padding: 12, overflow: "auto" }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Leader 每日盈亏（近 14 天）— {currentAccount}</div>
        <DailyLeaderPnlTable data={acctDailyLeader} totalByLeader={leaderTotalByAddr} />
      </div>
      {/* 3. Leader 归因表 */}
      <div style={{ marginTop: 12, border: "1px solid #eee", borderRadius: 8, background: "#fff", padding: 12 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>Leader 归因 — {currentAccount}</div>
          <input value={addressFilter} onChange={(e) => setAddressFilter(e.target.value)} placeholder="筛选地址" style={{ width: 240, padding: "4px 8px", borderRadius: 6, border: "1px solid #ddd", fontSize: 12 }} />
          <input value={minTotalPnl} onChange={(e) => setMinTotalPnl(e.target.value)} placeholder="最小总盈亏" style={{ width: 120, padding: "4px 8px", borderRadius: 6, border: "1px solid #ddd", fontSize: 12 }} />
          <input value={minWinRate} onChange={(e) => setMinWinRate(e.target.value)} placeholder="最小胜率(%)" style={{ width: 120, padding: "4px 8px", borderRadius: 6, border: "1px solid #ddd", fontSize: 12 }} />
        </div>
        <div style={{ overflow: "auto" }}>
          <LeaderTable rows={acctSummary} metrics={metricsByAddress} />
        </div>
      </div>
    </div>
  );
}
