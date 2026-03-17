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
const FUNDER_ADDRESS = "0x5f39d698C8B1f2efadB1042a3C6085E82ae3d603";

async function fetchPnlCurve(): Promise<PnlCurvePoint[]> {
  const res = await fetch(`${PNL_CURVE_URL}?user_address=${FUNDER_ADDRESS}&interval=all&fidelity=12h`);
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
function DailyLeaderPnlTable({ data }: { data: DailyLeaderPnl[] }) {
  if (!data.length) return <div style={{ color: "#888", fontSize: 12, padding: 8 }}>暂无 Leader 每日盈亏数据</div>;
  const dates = Array.from(new Set(data.map((r) => r.date_key))).sort();
  const cumMap = new Map<string, Map<string, number>>();
  for (const r of data) {
    const addr = r.leader_address;
    if (!cumMap.has(addr)) cumMap.set(addr, new Map());
    cumMap.get(addr)!.set(r.date_key, r.total_pnl ?? 0);
  }
  const deltaMap = new Map<string, Map<string, number>>();
  const grandTotal = new Map<string, number>();
  for (const [addr, dayMap] of cumMap) {
    const dm = new Map<string, number>();
    deltaMap.set(addr, dm);
    let sumDelta = 0;
    for (let i = 0; i < dates.length; i++) {
      const cum = dayMap.get(dates[i]) ?? 0;
      const prev = i > 0 ? (dayMap.get(dates[i - 1]) ?? 0) : 0;
      const delta = cum - prev;
      dm.set(dates[i], delta);
      sumDelta += delta;
    }
    grandTotal.set(addr, sumDelta);
  }
  const leaders = Array.from(deltaMap.keys()).sort((a, b) => (grandTotal.get(b) ?? 0) - (grandTotal.get(a) ?? 0));
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
      <thead>
        <tr style={{ background: "#fafafa" }}>
          <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "1px solid #eee", position: "sticky", left: 0, background: "#fafafa", zIndex: 1 }}>Leader</th>
          {dates.map((d) => (
            <th key={d} style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #eee", whiteSpace: "nowrap" }}>{d.slice(5)}</th>
          ))}
          <th style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #eee", fontWeight: 700 }}>总计</th>
        </tr>
      </thead>
      <tbody>
        {leaders.map((addr) => {
          const row = deltaMap.get(addr)!;
          const total = grandTotal.get(addr) ?? 0;
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
      </tbody>
    </table>
  );
}
function DailyPnlTable({ data }: { data: PnlCurvePoint[] }) {
  if (!data.length) return <div style={{ color: "#888", fontSize: 12, padding: 8 }}>暂无净值数据</div>;
  const byDay = new Map<string, number>();
  for (const pt of data) {
    const d = new Date(pt.t * 1000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    byDay.set(key, pt.p);
  }
  const allDays = Array.from(byDay.keys()).sort();
  const rows = allDays.map((day, i) => {
    const cum = byDay.get(day)!;
    const prev = i > 0 ? byDay.get(allDays[i - 1])! : 0;
    return { day, delta: cum - prev, cumulative: cum };
  });
  const recent = rows.slice(-7);
  const totalDelta = recent.reduce((s, r) => s + r.delta, 0);
  const lastCum = recent.length ? recent[recent.length - 1].cumulative : 0;
  return (
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
      <thead>
        <tr style={{ background: "#fafafa" }}>
          <th style={{ textAlign: "left", padding: "6px 8px", borderBottom: "1px solid #eee" }}></th>
          {recent.map((r) => (
            <th key={r.day} style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #eee", whiteSpace: "nowrap" }}>{r.day.slice(5)}</th>
          ))}
          <th style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #eee", fontWeight: 700 }}>7日合计</th>
          <th style={{ textAlign: "right", padding: "6px 8px", borderBottom: "1px solid #eee", fontWeight: 700 }}>累计PnL</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td style={{ padding: "6px 8px", borderBottom: "1px solid #f5f5f5", fontWeight: 600 }}>当日收益</td>
          {recent.map((r) => (
            <td key={r.day} style={{ ...cellR, color: pnlColor(r.delta) }}>{r.delta >= 0 ? "+" : ""}{fmtNum(r.delta, 2)}</td>
          ))}
          <td style={{ ...cellR, fontWeight: 700, color: pnlColor(totalDelta) }}>{totalDelta >= 0 ? "+" : ""}{fmtNum(totalDelta, 2)}</td>
          <td style={{ ...cellR, fontWeight: 700, color: pnlColor(lastCum) }}>{fmtNum(lastCum, 2)}</td>
        </tr>
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
  const [pnlCurve, setPnlCurve] = useState<PnlCurvePoint[]>([]);
  const [activeAccount, setActiveAccount] = useState<string>("");
  const [addressFilter, setAddressFilter] = useState("");
  const [minTotalPnl, setMinTotalPnl] = useState("");
  const [minWinRate, setMinWinRate] = useState("");

  const refresh = async () => {
    if (!supabase) return;
    setLoading(true);
    setError(null);
    try {
      const [summary, curve, leaderDaily] = await Promise.all([
        fetchAllRows<LeaderSummary>(
          "copytrade_leader_summary",
          "leader_address,account_name,total_realized_pnl,total_unrealized_pnl,total_pnl,winning_markets,losing_markets,total_markets,win_rate,updated_at",
          "total_pnl", false
        ),
        fetchPnlCurve(),
        fetchAllRows<DailyLeaderPnl>(
          "copytrade_daily_leader_pnl",
          "date_key,leader_address,account_name,realized_pnl,unrealized_pnl,total_pnl,market_count",
          "date_key", false
        ),
      ]);
      setPnlCurve(curve);
      setDailyLeaderPnl(leaderDaily);
      setSummaryRows(summary);
      const addrs = Array.from(new Set(summary.map((r) => (r.leader_address || "").toLowerCase().trim()).filter(Boolean)));
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
      setSummaryRows([]); setMetricsByAddress({}); setPnlCurve([]); setDailyLeaderPnl([]);
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
          <Link to="/gap-analysis" style={{ fontSize: 12, color: "#2d6cdf", textDecoration: "none" }}>差距归因分析</Link>
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
        <DailyPnlTable data={pnlCurve} />
      </div>

      {/* 2. Leader 每日盈亏 */}
      <div style={{ marginTop: 12, border: "1px solid #eee", borderRadius: 8, background: "#fff", padding: 12, overflow: "auto" }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Leader 每日盈亏（近 7 天）— {currentAccount}</div>
        <DailyLeaderPnlTable data={acctDailyLeader} />
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
