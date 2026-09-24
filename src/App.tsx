import { useCallback, useMemo, useState } from "react";
import "./styles.css";
import { useSortingStore } from "./store";
import { OrdersPage, SettingPage, SortingPage } from "./pages";
import { isAssigned } from "./judge";

type Tab = "sorting" | "setting" | "orders";

const TABS: { key: Tab; label: string; hint: string }[] = [
  { key: "sorting", label: "分拣台", hint: "裸石登记 · 批次封存" },
  { key: "setting", label: "镶嵌位置", hint: "主石 1 颗 · 围石 8 颗" },
  { key: "orders", label: "订单清单", hint: "按订单查看共用记录" },
];

interface Toast {
  id: number;
  msg: string;
  type: "ok" | "err";
}

function App() {
  const store = useSortingStore();
  const { state } = store;
  const [tab, setTab] = useState<Tab>("sorting");
  const [toasts, setToasts] = useState<Toast[]>([]);

  const notify = useCallback((msg: string, type: "ok" | "err" = "ok") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, type }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3600);
  }, []);

  const metrics = useMemo(() => {
    const activeBatches = state.batches.filter((b) => !b.sealed).length;
    const pending = state.gems.filter((g) => !isAssigned(g) && !state.batches.find((b) => b.id === g.batchId)?.sealed).length;
    const defects = state.gems.filter((g) => g.defectNote && !g.defectHandled && !state.batches.find((b) => b.id === g.batchId)?.sealed).length;
    const carat = state.gems.reduce((s, g) => s + g.carat, 0);
    return [
      { label: "分拣批次（进行中）", value: `${activeBatches}` },
      { label: "待镶嵌裸石", value: `${pending}` },
      { label: "未处理缺陷", value: `${defects}` },
      { label: "总克拉", value: `${carat.toFixed(2)}ct` },
    ];
  }, [state]);

  return (
    <main className="app">
      <header className="topbar">
        <div>
          <p className="eyebrow">珠宝镶嵌工作室 · 宝石分拣台</p>
          <h1>裸石分拣与镶嵌位置管理</h1>
          <span className="subtitle">
            先归入分拣批次，再分配到订单主石位（1 颗）或围石位（最多 8 颗）；
            尺寸筛选、位置示意与订单清单共用同一份记录，数据保存在本机浏览器。
          </span>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={tab === t.key ? "active" : ""}
              onClick={() => setTab(t.key)}
            >
              <b>{t.label}</b>
              <small>{t.hint}</small>
            </button>
          ))}
        </nav>
      </header>

      <section className="metrics">
        {metrics.map((m) => (
          <article key={m.label}>
            <small>{m.label}</small>
            <strong>{m.value}</strong>
          </article>
        ))}
      </section>

      {tab === "sorting" && <SortingPage store={store} notify={notify} />}
      {tab === "setting" && <SettingPage store={store} notify={notify} />}
      {tab === "orders" && <OrdersPage store={store} notify={notify} />}

      <footer className="foot">
        <span>数据通过 localStorage 本地存档，关闭浏览器后再打开待办仍在。</span>
        <button
          className="danger-text"
          onClick={() => {
            if (window.confirm("确认清空全部本地记录并恢复演示数据？此操作不可撤销。")) {
              store.resetAll();
              notify("已重置为演示数据");
            }
          }}
        >
          重置演示数据
        </button>
      </footer>

      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>
            {t.type === "ok" ? "✓ " : "✕ "}{t.msg}
          </div>
        ))}
      </div>
    </main>
  );
}

export default App;
