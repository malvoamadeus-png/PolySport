import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import { CopytradeLeaderPnlApp } from "./copytradeLeaderPnlApp";
import { GapAnalysisApp } from "./copytradeGapAnalysis";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./useAuth";
import { Analytics } from "@vercel/analytics/react";

function AdminOnlyRoute(props: { children: React.ReactNode }) {
  const { user, isAdmin, loading, signInWithGoogle } = useAuth();

  if (loading) {
    return <div style={{ padding: 16, fontFamily: "system-ui" }}>加载中...</div>;
  }
  if (!user) {
    return (
      <div style={{ padding: 16, fontFamily: "system-ui" }}>
        <h3 style={{ marginTop: 0 }}>需要登录</h3>
        <div style={{ marginBottom: 10, color: "#666", fontSize: 14 }}>请先使用 Google 登录后访问该页面。</div>
        <button onClick={signInWithGoogle} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #ddd", background: "#fff" }}>
          Google 登录
        </button>
      </div>
    );
  }
  if (!isAdmin) {
    return (
      <div style={{ padding: 16, fontFamily: "system-ui" }}>
        <h3 style={{ marginTop: 0 }}>无访问权限</h3>
        <div style={{ color: "#666", fontSize: 14 }}>该页面仅管理员邮箱可访问。</div>
      </div>
    );
  }
  return <>{props.children}</>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />
        <Route
          path="/leader-attribution"
          element={
            <AdminOnlyRoute>
              <CopytradeLeaderPnlApp />
            </AdminOnlyRoute>
          }
        />
        <Route
          path="/gap-analysis"
          element={
            <AdminOnlyRoute>
              <GapAnalysisApp />
            </AdminOnlyRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      <Analytics />
    </BrowserRouter>
  </React.StrictMode>
);
