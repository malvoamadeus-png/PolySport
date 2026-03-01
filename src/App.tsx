import React, { useEffect, useMemo, useRef, useState } from "react";
import { supabase, supabaseConfig } from "./supabaseClient";
import { useAuth } from "./useAuth";
import { useTags, type TagValue } from "./useTags";

type MasterResult = {
  id: number;
  timestamp: string | null;
  sport: string | null;
  limit_count: number | null;
  total_holders: number | null;
  successful_metrics: number | null;
  failed_metrics: number | null;
  metrics_summary_json: any;
  created_at: string | null;
};

type AddressMetric = {
  address: string;
  total_pnl: number | null;
  realized_pnl: number | null;
  unrealized_pnl: number | null;
  roi: number | null;
  profit_factor: number | null;
  max_drawdown: number | null;
  sharpe: number | null;
  current_position_value_usd: number | null;
  total_trades: number | null;
  win_rate: number | null;
  avg_trade_price: number | null;
  confidence: string | null;
  updated_at: string | null;
};

type NumericKey = keyof Pick<
  AddressMetric,
  | "total_pnl"
  | "realized_pnl"
  | "unrealized_pnl"
  | "roi"
  | "profit_factor"
  | "max_drawdown"
  | "sharpe"
  | "current_position_value_usd"
  | "total_trades"
  | "win_rate"
  | "avg_trade_price"
>;

type FilterOp = "gte" | "lte";

type ActiveFilter = { id: number; key: NumericKey; op: FilterOp; abs: boolean; value: string };

type FilterDef = { key: NumericKey; label: string; format: "num" | "pct"; allowAbs?: boolean };

const FILTERS: FilterDef[] = [
  { key: "total_pnl", label: "Total PnL", format: "num", allowAbs: true },
  { key: "realized_pnl", label: "Realized PnL", format: "num", allowAbs: true },
  { key: "unrealized_pnl", label: "Unrealized PnL", format: "num", allowAbs: true },
  { key: "current_position_value_usd", label: "Current Value", format: "num" },
  { key: "total_trades", label: "Total Trades", format: "num" },
  { key: "win_rate", label: "Win Rate", format: "pct" },
  { key: "avg_trade_price", label: "Avg Trade Price", format: "num" },
  { key: "roi", label: "ROI", format: "pct" },
  { key: "profit_factor", label: "Profit Factor", format: "num" },
  { key: "max_drawdown", label: "Max Drawdown", format: "pct" },
  { key: "sharpe", label: "Sharpe", format: "num" }
];

function fmtNum(v: number | null | undefined, digits = 2) {
  if (typeof v !== "number" || Number.isNaN(v)) return "-";
  return v.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function fmtPct(v: number | null | undefined) {
  if (typeof v !== "number" || Number.isNaN(v)) return "-";
  return `${(v * 100).toFixed(2)}%`;
}

type MetricKey = keyof Pick<
  AddressMetric,
  | "total_pnl"
  | "roi"
  | "profit_factor"
  | "max_drawdown"
  | "sharpe"
  | "current_position_value_usd"
  | "total_trades"
  | "win_rate"
  | "avg_trade_price"
>;

type MetricDef = {
  key: MetricKey;
  label: string;
  scale: "linear" | "signedLog10";
  better: "high" | "low";
  format: "num" | "pct";
};

const METRICS: MetricDef[] = [
  { key: "total_pnl", label: "Total PnL", scale: "signedLog10", better: "high", format: "num" },
  { key: "roi", label: "ROI", scale: "linear", better: "high", format: "pct" },
  { key: "profit_factor", label: "Profit Factor", scale: "linear", better: "high", format: "num" },
  { key: "max_drawdown", label: "Max Drawdown", scale: "linear", better: "low", format: "pct" },
  { key: "sharpe", label: "Sharpe", scale: "linear", better: "high", format: "num" },
  { key: "current_position_value_usd", label: "Current Value", scale: "linear", better: "high", format: "num" },
  { key: "total_trades", label: "Total Trades", scale: "linear", better: "high", format: "num" },
  { key: "win_rate", label: "Win Rate", scale: "linear", better: "high", format: "pct" },
  { key: "avg_trade_price", label: "Avg Trade Price", scale: "linear", better: "high", format: "num" }
];

function fmtMetric(def: MetricDef, v: number | null | undefined) {
  if (def.format === "pct") return fmtPct(v);
  return fmtNum(v, 2);
}

function signedLog10(v: number) {
  if (!Number.isFinite(v)) return 0;
  const s = v < 0 ? -1 : 1;
  return s * Math.log10(1 + Math.abs(v));
}

function signedLog10Inv(t: number) {
  if (!Number.isFinite(t)) return 0;
  const s = t < 0 ? -1 : 1;
  return s * (Math.pow(10, Math.abs(t)) - 1);
}

type BarDatum = { label: string; value: number | null | undefined };

function BarChart(props: { title: string; data: BarDatum[]; metric: MetricDef; width?: number; height?: number }) {
  const width = props.width ?? 980;
  const height = props.height ?? 220;
  const padL = 46;
  const padR = 12;
  const padT = 26;
  const padB = 26;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const raw = props.data.map((d) => (typeof d.value === "number" && Number.isFinite(d.value) ? d.value : null));
  const vals = raw.map((v) => (v == null ? null : props.metric.scale === "signedLog10" ? signedLog10(v) : v));
  const finite = vals.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const minV = finite.length ? Math.min(...finite, 0) : 0;
  const maxV = finite.length ? Math.max(...finite, 0) : 0;
  const range = maxV - minV || 1;
  const y0 = padT + ((maxV - 0) / range) * plotH;
  const n = props.data.length || 1;
  const gap = Math.min(10, plotW / n / 5);
  const barW = Math.max(6, plotW / n - gap);

  const axisLabel = props.metric.scale === "signedLog10" ? "PnL（log）" : props.metric.label;

  const ticks = useMemo(() => {
    if (!finite.length) return [0];
    if (props.metric.scale === "signedLog10") {
      const maxAbs = Math.max(Math.abs(minV), Math.abs(maxV));
      const a = maxAbs || 1;
      return [-a, -a / 2, 0, a / 2, a];
    }
    const lo = minV;
    const hi = maxV;
    const step = (hi - lo) / 4 || 1;
    return [hi, hi - step, hi - step * 2, hi - step * 3, lo];
  }, [finite.length, maxV, minV, props.metric.scale]);

  function yFor(v: number) {
    return padT + ((maxV - v) / range) * plotH;
  }

  function fmtTick(def: MetricDef, tickTransformed: number) {
    if (def.scale === "signedLog10") {
      const rawV = signedLog10Inv(tickTransformed);
      return fmtNum(rawV, 0);
    }
    if (def.format === "pct") return fmtPct(tickTransformed);
    return fmtNum(tickTransformed, 2);
  }

  return (
    <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 10, background: "#fff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
        <div style={{ fontWeight: 600 }}>{props.title}</div>
        <div style={{ fontSize: 12, color: "#666" }}>{axisLabel}</div>
      </div>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={props.title}>
        <rect x={0} y={0} width={width} height={height} fill="#fff" />
        {ticks.map((t, i) => {
          const y = yFor(t);
          const label = fmtTick(props.metric, t);
          return (
            <g key={`${t}-${i}`}>
              <line x1={padL} y1={y} x2={width - padR} y2={y} stroke={i === 2 ? "#ddd" : "#f0f0f0"} strokeWidth={1} />
              <text x={padL - 8} y={y + 4} fontSize={10} fill="#666" textAnchor="end">
                {label}
              </text>
            </g>
          );
        })}
        <line x1={padL} y1={y0} x2={width - padR} y2={y0} stroke="#ccc" strokeWidth={1} />
        {props.data.map((d, i) => {
          const x = padL + i * (barW + gap);
          const rawV = raw[i];
          const v = vals[i];
          const isMissing = rawV == null || v == null || !Number.isFinite(v);
          const h = isMissing ? 0 : (Math.abs(v - 0) / range) * plotH;
          const y = isMissing ? y0 : v >= 0 ? y0 - h : y0;
          const color = isMissing ? "#eee" : v >= 0 ? "#2d6cdf" : "#d34b4b";
          const label = d.label.slice(0, 10) + (d.label.length > 10 ? "…" : "");
          return (
            <g key={d.label}>
              <rect x={x} y={y} width={barW} height={h} fill={color}>
                <title>
                  {d.label}: {fmtMetric(props.metric, rawV as any)}
                </title>
              </rect>
              <text x={x + barW / 2} y={height - 8} fontSize={10} fill="#666" textAnchor="middle">
                {label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function RadarChart(props: { title: string; metrics: MetricDef[]; rows: AddressMetric[]; width?: number; height?: number }) {
  const width = props.width ?? 980;
  const height = props.height ?? 420;
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.min(width, height) * 0.36;
  const axes = props.metrics;
  const m = axes.length || 1;

  const transformedByMetric: Record<string, number[]> = {};
  for (const def of axes) {
    transformedByMetric[def.key] = props.rows.map((r) => {
      const raw = r[def.key];
      if (typeof raw !== "number" || !Number.isFinite(raw)) return NaN;
      return def.scale === "signedLog10" ? signedLog10(raw) : raw;
    });
  }

  const minMaxByMetric: Record<string, { min: number; max: number }> = {};
  for (const def of axes) {
    const vs = transformedByMetric[def.key].filter((v) => Number.isFinite(v)) as number[];
    const min = vs.length ? Math.min(...vs) : 0;
    const max = vs.length ? Math.max(...vs) : 1;
    minMaxByMetric[def.key] = { min, max: max === min ? min + 1 : max };
  }

  function norm(def: MetricDef, r: AddressMetric) {
    const raw = r[def.key];
    if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
    const v = def.scale === "signedLog10" ? signedLog10(raw) : raw;
    const { min, max } = minMaxByMetric[def.key];
    const t = (v - min) / (max - min);
    const clamped = Math.max(0, Math.min(1, t));
    return def.better === "low" ? 1 - clamped : clamped;
  }

  function point(i: number, r: number) {
    const ang = (Math.PI * 2 * i) / m - Math.PI / 2;
    const x = cx + r * Math.cos(ang);
    const y = cy + r * Math.sin(ang);
    return { x, y, ang };
  }

  const colors = ["#2d6cdf", "#d34b4b", "#2a9d8f", "#e9c46a", "#9b5de5", "#f15bb5"];

  return (
    <div style={{ border: "1px solid #eee", borderRadius: 8, padding: 10, background: "#fff" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
        <div style={{ fontWeight: 600 }}>{props.title}</div>
        <div style={{ fontSize: 12, color: "#666" }}>
          PnL 用对数压缩显示；MDD 为”低更好”已自动反向
        </div>
      </div>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={props.title}>
        <rect x={0} y={0} width={width} height={height} fill="#fff" />
        {[0.25, 0.5, 0.75, 1].map((k) => (
          <circle key={k} cx={cx} cy={cy} r={radius * k} fill="none" stroke="#eee" />
        ))}
        {axes.map((def, i) => {
          const p = point(i, radius);
          const tx = point(i, radius + 16);
          const align = Math.abs(Math.cos(p.ang)) < 0.2 ? "middle" : Math.cos(p.ang) > 0 ? "start" : "end";
          return (
            <g key={def.key}>
              <line x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="#ddd" />
              <text x={tx.x} y={tx.y} fontSize={11} fill="#666" textAnchor={align as any}>
                {def.label}
              </text>
            </g>
          );
        })}

        {props.rows.map((r, idx) => {
          const pts = axes.map((def, i) => point(i, norm(def, r) * radius));
          const d = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(" ") + " Z";
          const color = colors[idx % colors.length];
          return (
            <g key={r.address}>
              <path d={d} fill={color} fillOpacity={0.12} stroke={color} strokeWidth={2}>
                <title>{r.address}</title>
              </path>
            </g>
          );
        })}
      </svg>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 8, fontSize: 12, color: "#333" }}>
        {props.rows.map((r, idx) => (
          <div key={r.address} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 10, height: 10, background: colors[idx % colors.length], borderRadius: 2 }} />
            <div style={{ color: "#666" }}>{r.address}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function App() {
  const { user, isAdmin, signInWithGoogle, signOut } = useAuth();
  const { tags, setTag } = useTags();
  const [lastRun, setLastRun] = useState<MasterResult | null>(null);
  const [rows, setRows] = useState<AddressMetric[]>([]);
  const [filters, setFilters] = useState<ActiveFilter[]>([
    { id: 1, key: "total_pnl", op: "gte", abs: true, value: "" }
  ]);
  const nextFilterId = useRef(2);
  const [sortKey, setSortKey] = useState<NumericKey>("total_pnl");
  const [sortDesc, setSortDesc] = useState(true);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [loadingRows, setLoadingRows] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [chartType, setChartType] = useState<"bar" | "radar">("bar");
  const [metricKeys, setMetricKeys] = useState<MetricKey[]>(["total_pnl", "roi", "profit_factor", "max_drawdown", "sharpe"]);
  const [leftWidth, setLeftWidth] = useState<number>(() => {
    const v = window.localStorage.getItem("leftWidthPx");
    const n = v ? Number(v) : NaN;
    return Number.isFinite(n) && n > 280 ? n : 640;
  });

  const addFilter = () => {
    setFilters((prev) => [...prev, { id: nextFilterId.current++, key: "total_pnl", op: "gte", abs: true, value: "" }]);
  };
  const removeFilter = (id: number) => {
    setFilters((prev) => (prev.length <= 1 ? prev : prev.filter((f) => f.id !== id)));
  };
  const updateFilter = (id: number, patch: Partial<ActiveFilter>) => {
    setFilters((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  };

  const errorHelp = useMemo(() => {
    if (!error) return null;
    const e = error.toLowerCase();
    if (e.includes("relation") || e.includes("does not exist") || e.includes("not found")) {
      return "Supabase 里还没建表/没更新到 address_metrics：请在 Supabase SQL Editor 运行 supabase/schema.sql，然后再同步一次。";
    }
    if (e.includes("jwt") || e.includes("token") || e.includes("apikey") || e.includes("permission") || e.includes("rls")) {
      return "Supabase 认证/权限错误：检查 dashboard/.env 里的 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY，且表已开启公开只读策略。";
    }
    return null;
  }, [error]);

  const refreshAll = async () => {
    if (!supabase) return;

    setError(null);

    setLoadingRuns(true);
    try {
      const res = await supabase
        .from("master_results")
        .select("id,timestamp,sport,limit_count,total_holders,successful_metrics,failed_metrics,metrics_summary_json,created_at")
        .order("id", { ascending: false })
        .limit(1);
      if (res.error) {
        setError(res.error.message);
        setLastRun(null);
      } else {
        const data = (res.data ?? []) as MasterResult[];
        setLastRun(data.length ? data[0] : null);
      }
    } finally {
      setLoadingRuns(false);
    }

    setLoadingRows(true);
    try {
      const res = await supabase
        .from("address_metrics")
        .select(
          "address,total_pnl,realized_pnl,unrealized_pnl,roi,profit_factor,max_drawdown,sharpe,confidence,updated_at,current_position_value_usd,total_trades,winning_trades,losing_trades,win_rate,avg_trade_price"
        )
        .order("updated_at", { ascending: false })
        .limit(5000);
      if (res.error) {
        setError(res.error.message);
        setRows([]);
      } else {
        const data = (res.data ?? []) as AddressMetric[];
        setRows(data);
        setSelected((prev) => {
          const next: Record<string, boolean> = {};
          for (const r of data) {
            if (prev[r.address]) next[r.address] = true;
          }
          return next;
        });
      }
    } finally {
      setLoadingRows(false);
    }
  };

  useEffect(() => {
    void refreshAll();
  }, []);

  const filtered = useMemo(() => {
    const base = rows.filter((r) => {
      if (r.confidence === "skipped_low_pnl") return false;
      return filters.every((f) => {
        const threshRaw = f.value.trim();
        const thresh = threshRaw ? Number(threshRaw) : NaN;
        if (!Number.isFinite(thresh)) return true;
        const v0 = r[f.key];
        if (typeof v0 !== "number" || !Number.isFinite(v0)) return false;
        const def = FILTERS.find((d) => d.key === f.key);
        const allowAbs = Boolean(def?.allowAbs);
        const v = allowAbs && f.abs ? Math.abs(v0) : v0;
        return f.op === "gte" ? v >= thresh : v <= thresh;
      });
    });
    const key = sortKey;
    base.sort((a, b) => {
      const av = a[key];
      const bv = b[key];
      const an = typeof av === "number" ? av : null;
      const bn = typeof bv === "number" ? bv : null;
      if (an == null && bn == null) return 0;
      if (an == null) return 1;
      if (bn == null) return -1;
      if (an === bn) return 0;
      return sortDesc ? (an > bn ? -1 : 1) : an < bn ? -1 : 1;
    });
    return base;
  }, [rows, filters, sortKey, sortDesc]);

  const selectedRows = useMemo(() => {
    return rows.filter((r) => selected[r.address]);
  }, [rows, selected]);

  const selectedRowsSorted = useMemo(() => {
    const out = [...selectedRows];
    out.sort((a, b) => (b.updated_at || "").localeCompare(a.updated_at || ""));
    return out;
  }, [selectedRows]);

  const chartMetrics = useMemo(() => {
    const s = new Set(metricKeys);
    return METRICS.filter((m) => s.has(m.key));
  }, [metricKeys]);

  return (
    <div style={{ fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial", padding: 16, maxWidth: 1600, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
        <h2 style={{ margin: 0 }}>PolySport 看板</h2>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <div style={{ fontSize: 12, color: "#666" }}>{loadingRows ? "加载数据…" : `${rows.length} 地址`}</div>
          <button
            onClick={() => refreshAll()}
            style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid #ddd", background: "#fff" }}
          >
            刷新
          </button>
          {user ? (
            <>
              <span style={{ fontSize: 12, color: "#333" }}>
                {user.email}{isAdmin ? <span style={{ marginLeft: 4, color: "#d4a017", fontWeight: 600 }}>管理员</span> : null}
              </span>
              <button
                onClick={signOut}
                style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid #ddd", background: "#fff" }}
              >
                登出
              </button>
            </>
          ) : (
            <button
              onClick={signInWithGoogle}
              style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid #ddd", background: "#fff" }}
            >
              Google 登录
            </button>
          )}
        </div>
      </div>

      {!supabaseConfig.ok ? (
        <div style={{ marginTop: 12, padding: 12, border: "1px solid #eee", borderRadius: 8, background: "#fafafa", color: "#333" }}>
          <div style={{ fontWeight: 600 }}>未配置 Supabase 连接</div>
          <div style={{ marginTop: 6, fontSize: 12, color: "#666" }}>
            在 dashboard/.env 里配置 VITE_SUPABASE_URL 和 VITE_SUPABASE_ANON_KEY，然后重启 npm dev。
          </div>
        </div>
      ) : null}

      {error ? (
        <div style={{ marginTop: 12 }}>
          <div style={{ padding: 12, border: "1px solid #f3b4b4", background: "#fff2f2", color: "#7a1b1b" }}>{error}</div>
          {errorHelp ? <div style={{ marginTop: 8, padding: 12, border: "1px solid #eee", background: "#fafafa", color: "#333" }}>{errorHelp}</div> : null}
        </div>
      ) : null}

      <details style={{ marginTop: 12, padding: 12, border: "1px solid #eee", borderRadius: 8, background: "#fafafa" }}>
        <summary style={{ fontWeight: 600, cursor: "pointer", userSelect: "none" }}>参数说明</summary>
        <div style={{ marginTop: 12, fontSize: 13, lineHeight: 1.6, color: "#333" }}>
          <div style={{ marginBottom: 8 }}><strong>Total PnL</strong> — 总盈亏：已实现盈亏 + 未实现盈亏</div>
          <div style={{ marginBottom: 8 }}><strong>Realized PnL</strong> — 已实现盈亏：已平仓交易的盈亏</div>
          <div style={{ marginBottom: 8 }}><strong>Unrealized PnL</strong> — 未实现盈亏：当前持仓的浮动盈亏</div>
          <div style={{ marginBottom: 8 }}><strong>ROI</strong> — 投资回报率：总盈亏 / 成本基础（所有买入金额之和）</div>
          <div style={{ marginBottom: 8 }}><strong>Profit Factor</strong> — 盈利因子：总盈利 / 总亏损（按市场聚合）</div>
          <div style={{ marginBottom: 8 }}><strong>Max Drawdown</strong> — 最大回撤：权益曲线从峰值到谷底的最大跌幅</div>
          <div style={{ marginBottom: 8 }}><strong>Sharpe Ratio</strong> — 夏普比率：日均盈亏 / 日盈亏标准差 × √365，衡量风险调整后收益</div>
          <div style={{ marginBottom: 8 }}><strong>Current Value</strong> — 当前持仓价值：所有未平仓头寸的市值（美元）</div>
          <div style={{ marginBottom: 8 }}><strong>Total Trades</strong> — 总交易数：买入 + 卖出交易笔数</div>
          <div style={{ marginBottom: 8 }}><strong>Win Rate</strong> — 胜率：盈利交易数 / 总交易数</div>
          <div style={{ marginBottom: 8 }}><strong>Avg Trade Price</strong> — 平均交易价格：所有交易的平均成交价</div>
        </div>
      </details>

      {supabaseConfig.ok && !loadingRows && !error && rows.length === 0 ? (
        <div style={{ marginTop: 12, padding: 12, border: "1px solid #eee", borderRadius: 8, background: "#fafafa", color: "#333" }}>
          <div style={{ fontWeight: 600 }}>address_metrics 暂无数据</div>
          <div style={{ marginTop: 6, fontSize: 12, color: "#666" }}>
            这通常表示还没把“每地址一行”的 address_metrics 同步到 Supabase（master_results 有数据不代表 address_metrics 有数据）。
          </div>
          <div style={{ marginTop: 8, fontSize: 12, color: "#666" }}>
            排查顺序：
            <div style={{ marginTop: 6 }}>
              1) Supabase SQL Editor 运行一次 supabase/schema.sql（确保存在 address_metrics 表）
            </div>
            <div style={{ marginTop: 4 }}>
              2) 本地执行 python supabase/sync_to_supabase.py（确保同步脚本是最新版本）
            </div>
            <div style={{ marginTop: 4 }}>
              3) 回到网页点“刷新”
            </div>
          </div>
        </div>
      ) : null}

      <div style={{ marginTop: 12, display: "flex", gap: 0, alignItems: "stretch" }}>
        <div style={{ width: leftWidth, border: "1px solid #eee", borderRadius: 8, background: "#fff" }}>
          <div style={{ padding: 12, borderBottom: "1px solid #f3f3f3" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
              <div style={{ fontWeight: 600 }}>地址列表（可勾选）</div>
              <div style={{ fontSize: 12, color: "#666" }}>已选 {selectedRows.length}</div>
            </div>
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
              {filters.map((f) => (
                <div key={f.id} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                  <select
                    value={f.key}
                    onChange={(e) => updateFilter(f.id, { key: e.target.value as NumericKey })}
                    style={{ padding: "4px 6px", borderRadius: 6, border: "1px solid #ddd", background: "#fff" }}
                  >
                    {FILTERS.map((fd) => (
                      <option key={fd.key} value={fd.key}>{fd.label}</option>
                    ))}
                  </select>
                  <select
                    value={f.op}
                    onChange={(e) => updateFilter(f.id, { op: e.target.value as FilterOp })}
                    style={{ padding: "4px 6px", borderRadius: 6, border: "1px solid #ddd", background: "#fff" }}
                  >
                    <option value="gte">≥</option>
                    <option value="lte">≤</option>
                  </select>
                  {FILTERS.find((fd) => fd.key === f.key)?.allowAbs ? (
                    <label style={{ fontSize: 12, color: "#666" }}>
                      <input type="checkbox" checked={f.abs} onChange={(e) => updateFilter(f.id, { abs: e.target.checked })} /> |x|
                    </label>
                  ) : null}
                  <input
                    value={f.value}
                    onChange={(e) => updateFilter(f.id, { value: e.target.value })}
                    placeholder="阈值"
                    style={{ width: 100, padding: "4px 6px", borderRadius: 6, border: "1px solid #ddd" }}
                  />
                  {filters.length > 1 ? (
                    <button
                      onClick={() => removeFilter(f.id)}
                      style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid #ddd", background: "#fff", color: "#999" }}
                    >
                      ✕
                    </button>
                  ) : null}
                </div>
              ))}
              <button
                onClick={addFilter}
                style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid #ddd", background: "#fff", alignSelf: "flex-start", color: "#2d6cdf" }}
              >
                + 添加筛选条件
              </button>
            </div>
            <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as NumericKey)}
                style={{ padding: "4px 6px", borderRadius: 6, border: "1px solid #ddd", background: "#fff" }}
              >
                {FILTERS.map((f) => (
                  <option key={f.key} value={f.key}>
                    排序：{f.label}
                  </option>
                ))}
              </select>
              <button
                onClick={() => setSortDesc((v) => !v)}
                style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid #ddd", background: "#fff" }}
              >
                {sortDesc ? "降序" : "升序"}
              </button>
              <button
                onClick={() => setSelected({})}
                style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid #ddd", background: "#fff" }}
              >
                清空勾选
              </button>
              <button
                onClick={() => {
                  const next: Record<string, boolean> = {};
                  for (const r of filtered) next[r.address] = true;
                  setSelected(next);
                }}
                style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid #ddd", background: "#fff" }}
              >
                全选当前列表
              </button>
            </div>
          </div>

          <div style={{ overflow: "auto", maxHeight: 820 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#fafafa" }}>
                  <th style={{ textAlign: "center", padding: 10, borderBottom: "1px solid #eee", width: 44 }}>选</th>
                  <th style={{ textAlign: "left", padding: 10, borderBottom: "1px solid #eee" }}>地址</th>
                  <th style={{ textAlign: "right", padding: 10, borderBottom: "1px solid #eee" }}>PnL</th>
                  <th style={{ textAlign: "right", padding: 10, borderBottom: "1px solid #eee" }}>Value</th>
                  <th style={{ textAlign: "right", padding: 10, borderBottom: "1px solid #eee" }}>Trades</th>
                  <th style={{ textAlign: "right", padding: 10, borderBottom: "1px solid #eee" }}>Win%</th>
                  <th style={{ textAlign: "right", padding: 10, borderBottom: "1px solid #eee" }}>AvgPx</th>
                  <th style={{ textAlign: "right", padding: 10, borderBottom: "1px solid #eee" }}>Realized</th>
                  <th style={{ textAlign: "right", padding: 10, borderBottom: "1px solid #eee" }}>Unrealized</th>
                  <th style={{ textAlign: "right", padding: 10, borderBottom: "1px solid #eee" }}>ROI</th>
                  <th style={{ textAlign: "right", padding: 10, borderBottom: "1px solid #eee" }}>PF</th>
                  <th style={{ textAlign: "right", padding: 10, borderBottom: "1px solid #eee" }}>MDD</th>
                  <th style={{ textAlign: "right", padding: 10, borderBottom: "1px solid #eee" }}>Sharpe</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.address} style={{ borderBottom: "1px solid #f3f3f3" }}>
                    <td style={{ padding: 10, textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={Boolean(selected[r.address])}
                        onChange={(e) => {
                          const on = e.target.checked;
                          setSelected((prev) => ({ ...prev, [r.address]: on }));
                        }}
                      />
                    </td>
                    <td style={{ padding: 10, whiteSpace: "nowrap" }}>
                      <a
                        href={`https://polymarket.com/profile/${r.address}`}
                        target="_blank"
                        rel="noreferrer"
                        style={{ color: "#1a4fff", textDecoration: "none" }}
                      >
                        {r.address}
                      </a>
                      {tags[r.address] ? (
                        <span style={{
                          marginLeft: 6,
                          fontSize: 10,
                          padding: "1px 6px",
                          borderRadius: 4,
                          color: "#fff",
                          background: tags[r.address] === "顶尖" ? "#d4a017" : tags[r.address] === "高手" ? "#2d6cdf" : "#d34b4b"
                        }}>
                          {tags[r.address]}
                        </span>
                      ) : null}
                      {isAdmin ? (
                        <select
                          value={tags[r.address] ?? ""}
                          onChange={(e) => {
                            const v = e.target.value;
                            setTag(r.address, v === "" ? null : v as TagValue, user!.email!);
                          }}
                          style={{ marginLeft: 6, fontSize: 10, padding: "1px 4px", borderRadius: 4, border: "1px solid #ddd" }}
                        >
                          <option value="">无标签</option>
                          <option value="顶尖">顶尖</option>
                          <option value="高手">高手</option>
                          <option value="排除">排除</option>
                        </select>
                      ) : null}
                    </td>
                    <td style={{ padding: 10, textAlign: "right" }}>{fmtNum(r.total_pnl, 2)}</td>
                    <td style={{ padding: 10, textAlign: "right" }}>{fmtNum(r.current_position_value_usd, 2)}</td>
                    <td style={{ padding: 10, textAlign: "right" }}>{fmtNum(r.total_trades, 0)}</td>
                    <td style={{ padding: 10, textAlign: "right" }}>{fmtPct(r.win_rate)}</td>
                    <td style={{ padding: 10, textAlign: "right" }}>{fmtNum(r.avg_trade_price, 4)}</td>
                    <td style={{ padding: 10, textAlign: "right" }}>{fmtNum(r.realized_pnl, 2)}</td>
                    <td style={{ padding: 10, textAlign: "right" }}>{fmtNum(r.unrealized_pnl, 2)}</td>
                    <td style={{ padding: 10, textAlign: "right" }}>{fmtPct(r.roi)}</td>
                    <td style={{ padding: 10, textAlign: "right" }}>{fmtNum(r.profit_factor, 2)}</td>
                    <td style={{ padding: 10, textAlign: "right" }}>{fmtPct(r.max_drawdown)}</td>
                    <td style={{ padding: 10, textAlign: "right" }}>{fmtNum(r.sharpe, 2)}</td>
                  </tr>
                ))}
                {!filtered.length ? (
                  <tr>
                    <td colSpan={13} style={{ padding: 14, color: "#666" }}>
                      暂无数据
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>

        <div
          onMouseDown={(e) => {
            e.preventDefault();
            const startX = e.clientX;
            const startW = leftWidth;
            let currentW = startW;
            const onMove = (ev: MouseEvent) => {
              const dx = ev.clientX - startX;
              const next = Math.max(360, Math.min(1200, startW + dx));
              currentW = next;
              setLeftWidth(next);
            };
            const onUp = () => {
              window.removeEventListener("mousemove", onMove);
              window.removeEventListener("mouseup", onUp);
              window.localStorage.setItem("leftWidthPx", String(currentW));
            };
            window.addEventListener("mousemove", onMove);
            window.addEventListener("mouseup", onUp);
          }}
          style={{ width: 10, cursor: "col-resize", margin: "0 8px", borderRadius: 6, background: "#f3f3f3", flex: "0 0 auto" }}
          role="separator"
          aria-label="resize"
        />

        <div style={{ flex: "1 1 auto", border: "1px solid #eee", borderRadius: 8, padding: 12, background: "#fff", minWidth: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
            <div style={{ fontWeight: 600 }}>对比图</div>
            <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
              <label style={{ fontSize: 12, color: "#666" }}>
                <input type="radio" checked={chartType === "bar"} onChange={() => setChartType("bar")} /> 柱状图
              </label>
              <label style={{ fontSize: 12, color: "#666" }}>
                <input type="radio" checked={chartType === "radar"} onChange={() => setChartType("radar")} /> 雷达图
              </label>
            </div>
          </div>

          <div style={{ marginTop: 10, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
            <div style={{ fontSize: 12, color: "#666" }}>指标：</div>
            {METRICS.map((m) => {
              const checked = metricKeys.includes(m.key);
              return (
                <label key={m.key} style={{ fontSize: 12, color: "#333" }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const on = e.target.checked;
                      setMetricKeys((prev) => {
                        const s = new Set(prev);
                        if (on) s.add(m.key);
                        else s.delete(m.key);
                        return Array.from(s);
                      });
                    }}
                  />{" "}
                  {m.label}
                </label>
              );
            })}
          </div>

          {selectedRowsSorted.length >= 2 && chartMetrics.length ? (
            <div style={{ marginTop: 12 }}>
              {chartType === "bar" ? (
                <>
                  <div style={{ display: "grid", gap: 12 }}>
                    {chartMetrics.map((m) => (
                      <BarChart
                        key={m.key}
                        title={`${m.label} 对比`}
                        metric={m}
                        data={selectedRowsSorted.map((r) => ({ label: r.address, value: r[m.key] }))}
                      />
                    ))}
                  </div>
                </>
              ) : (
                <RadarChart title="指标雷达图对比" metrics={chartMetrics} rows={selectedRowsSorted.slice(0, 12)} />
              )}
            </div>
          ) : (
            <div style={{ marginTop: 10, fontSize: 12, color: "#666" }}>
              勾选至少 2 个地址并选择至少 1 个指标后生成图表（雷达图最多显示 12 个地址）。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
