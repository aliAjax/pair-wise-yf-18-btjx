// 页面：分拣台界面 —— 登记、尺寸筛选、位置示意、订单清单、批次封存
import { useMemo, useState } from "react";
import "./styles.css";
import {
  CLARITIES,
  CUTS,
  SHAPES,
  SIDE_SLOT_LIMIT,
  batchOf,
  eligibleGems,
  isLocked,
  orderSlotMap,
  sizeLabel,
  type Conflict,
  type Gem,
  type GemDraft,
} from "./rules";
import { useArchive } from "./archive";

const emptyDraft: GemDraft = {
  code: "",
  species: "",
  shape: "圆形",
  carat: 0,
  lengthMm: 0,
  widthMm: 0,
  clarity: "VS",
  color: "",
  cut: "VG 很好",
  defect: "",
};

// 位置示意 3×3 布局：中心为主石位，四周为围石位 1-8
const DIAGRAM_LAYOUT: ("side" | "main")[][] = [
  ["side", "side", "side"],
  ["side", "main", "side"],
  ["side", "side", "side"],
];
const DIAGRAM_SIDE_INDEX = [0, 1, 2, 7, -1, 3, 6, 5, 4]; // 按行展开时各格对应的围石位编号

function App() {
  const { state, addGem, addBatch, addOrder, assign, unassign, markDefect, seal } = useArchive();

  // 筛选
  const [shapeFilter, setShapeFilter] = useState<string>("全部");
  const [minMm, setMinMm] = useState<string>("");
  const [maxMm, setMaxMm] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<string>("全部");

  // 登记表单
  const [draft, setDraft] = useState<GemDraft>(emptyDraft);
  const [draftBatchId, setDraftBatchId] = useState<string>(state.batches[0]?.id ?? "");
  const [formErrors, setFormErrors] = useState<string[]>([]);

  // 批次 / 订单
  const [newBatchName, setNewBatchName] = useState("");
  const [newOrderName, setNewOrderName] = useState("");
  const [batchMsg, setBatchMsg] = useState<string>("");
  const [sealConflicts, setSealConflicts] = useState<{ batchId: string; list: Conflict[] } | null>(null);

  // 位置示意
  const [activeOrderId, setActiveOrderId] = useState<string>(state.orders[0]?.id ?? "");
  const [assignError, setAssignError] = useState<string>("");

  const openBatches = state.batches.filter((b) => !b.sealed);
  const effectiveDraftBatchId = state.batches.some((b) => b.id === draftBatchId) ? draftBatchId : openBatches[0]?.id ?? "";
  const effectiveOrderId = state.orders.some((o) => o.id === activeOrderId) ? activeOrderId : state.orders[0]?.id ?? "";

  const filteredGems = useMemo(() => {
    const min = parseFloat(minMm);
    const max = parseFloat(maxMm);
    return state.gems.filter((g) => {
      if (shapeFilter !== "全部" && g.shape !== shapeFilter) return false;
      if (!Number.isNaN(min) && minMm !== "" && (g.lengthMm < min || g.widthMm < min)) return false;
      if (!Number.isNaN(max) && maxMm !== "" && (g.lengthMm > max || g.widthMm > max)) return false;
      if (statusFilter === "待镶嵌" && g.assignment !== null) return false;
      if (statusFilter === "已分配" && g.assignment === null) return false;
      if (statusFilter === "缺陷未处理" && !(g.defect.trim() !== "" && !g.defectHandled)) return false;
      return true;
    });
  }, [state.gems, shapeFilter, minMm, maxMm, statusFilter]);

  const metrics = useMemo(() => {
    const pending = state.gems.filter((g) => g.assignment === null && !isLocked(state, g)).length;
    const defects = state.gems.filter((g) => g.defect.trim() !== "" && !g.defectHandled).length;
    const carat = state.gems.reduce((sum, g) => sum + g.carat, 0);
    return { batches: state.batches.length, pending, defects, carat: carat.toFixed(2) };
  }, [state]);

  function submitGem() {
    const errors = addGem(draft, effectiveDraftBatchId);
    setFormErrors(errors);
    if (errors.length === 0) setDraft(emptyDraft);
  }

  function submitSeal(batchId: string) {
    const conflicts = seal(batchId);
    setSealConflicts(conflicts ? { batchId, list: conflicts } : null);
  }

  function handleSlotSelect(orderId: string, slot: "main" | "side", slotIndex: number, gemId: string) {
    const slots = orderSlotMap(state, orderId);
    const occupant = slot === "main" ? slots.main : slots.side[slotIndex];
    if (gemId === "") {
      setAssignError(occupant ? unassign(occupant.id) ?? "" : "");
      return;
    }
    setAssignError(assign(gemId, orderId, slot, slotIndex) ?? "");
  }

  function orderName(id: string): string {
    return state.orders.find((o) => o.id === id)?.name ?? id;
  }

  function positionLabel(gem: Gem): string {
    if (!gem.assignment) return "待镶嵌";
    const name = orderName(gem.assignment.orderId);
    return gem.assignment.slot === "main" ? `${name} · 主石位` : `${name} · 围石${gem.assignment.slotIndex + 1}号位`;
  }

  const slots = effectiveOrderId ? orderSlotMap(state, effectiveOrderId) : null;
  const candidates = effectiveOrderId ? eligibleGems(state, effectiveOrderId) : [];

  return (
    <main className="app">
      <section className="hero">
        <p>hxyfront-62006 · 珠宝镶嵌 · 本地存档</p>
        <h1>宝石分拣台</h1>
        <span>
          登记裸石编号、种类、形状、克拉、尺寸、净度、颜色、切工与缺陷说明；每颗宝石先归入分拣批次，
          再分配到订单主石位（一颗）或围石位（最多八颗）。批次封存前列出未处理缺陷与位置超额冲突，
          封存后记录停止修改。数据保存在本机浏览器，关掉再打开待办仍在。
        </span>
      </section>

      <section className="metrics">
        <article><small>分拣批次</small><strong>{metrics.batches}</strong></article>
        <article><small>待镶嵌</small><strong>{metrics.pending}</strong></article>
        <article><small>缺陷备注</small><strong>{metrics.defects}</strong></article>
        <article><small>总克拉</small><strong>{metrics.carat}</strong></article>
      </section>

      <section className="workspace">
        <aside className="panel">
          <h2>尺寸筛选</h2>
          <div className="chips">
            {["全部", ...SHAPES].map((shape) => (
              <button
                key={shape}
                className={shapeFilter === shape ? "chip-active" : ""}
                onClick={() => setShapeFilter(shape)}
              >
                {shape}
              </button>
            ))}
          </div>
          <div className="filter-block">
            <label>
              <span>尺寸下限（mm，长宽均需满足）</span>
              <input type="number" min="0" step="0.1" value={minMm} onChange={(e) => setMinMm(e.target.value)} placeholder="如 2" />
            </label>
            <label>
              <span>尺寸上限（mm）</span>
              <input type="number" min="0" step="0.1" value={maxMm} onChange={(e) => setMaxMm(e.target.value)} placeholder="如 7" />
            </label>
            <label>
              <span>状态</span>
              <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
                {["全部", "待镶嵌", "已分配", "缺陷未处理"].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </label>
          </div>
          <p className="hint">筛选结果与下方宝石记录、位置示意、订单清单共用同一份存档。</p>
        </aside>

        <section className="panel form-panel">
          <div className="heading">
            <div>
              <p>裸石登记</p>
              <h2>新增宝石记录</h2>
            </div>
            <button className="primary" onClick={submitGem}>登记入批次</button>
          </div>
          <div className="field-grid">
            <label><span>宝石编号 *</span><input value={draft.code} onChange={(e) => setDraft({ ...draft, code: e.target.value })} placeholder="如 ST-2100" /></label>
            <label><span>种类 *</span><input value={draft.species} onChange={(e) => setDraft({ ...draft, species: e.target.value })} placeholder="如 蓝宝石 / 钻石" /></label>
            <label><span>形状 *</span>
              <select value={draft.shape} onChange={(e) => setDraft({ ...draft, shape: e.target.value })}>
                {SHAPES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </label>
            <label><span>克拉重量 *</span><input type="number" min="0" step="0.01" value={draft.carat || ""} onChange={(e) => setDraft({ ...draft, carat: parseFloat(e.target.value) || 0 })} placeholder="如 0.85" /></label>
            <label><span>尺寸-长（mm）*</span><input type="number" min="0" step="0.1" value={draft.lengthMm || ""} onChange={(e) => setDraft({ ...draft, lengthMm: parseFloat(e.target.value) || 0 })} placeholder="如 6" /></label>
            <label><span>尺寸-宽（mm）*</span><input type="number" min="0" step="0.1" value={draft.widthMm || ""} onChange={(e) => setDraft({ ...draft, widthMm: parseFloat(e.target.value) || 0 })} placeholder="如 4" /></label>
            <label><span>净度</span>
              <select value={draft.clarity} onChange={(e) => setDraft({ ...draft, clarity: e.target.value })}>
                {CLARITIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label><span>颜色</span><input value={draft.color} onChange={(e) => setDraft({ ...draft, color: e.target.value })} placeholder="如 皇家蓝 / D-E" /></label>
            <label><span>切工</span>
              <select value={draft.cut} onChange={(e) => setDraft({ ...draft, cut: e.target.value })}>
                {CUTS.map((c) => <option key={c}>{c}</option>)}
              </select>
            </label>
            <label><span>归入分拣批次 *</span>
              <select value={effectiveDraftBatchId} onChange={(e) => setDraftBatchId(e.target.value)}>
                {openBatches.length === 0 && <option value="">无未封存批次</option>}
                {openBatches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </label>
            <label className="field-wide"><span>缺陷说明</span><input value={draft.defect} onChange={(e) => setDraft({ ...draft, defect: e.target.value })} placeholder="无缺陷可留空；填写后需在记录中标记已处理才能封存批次" /></label>
          </div>
          {formErrors.length > 0 && (
            <ul className="error-list">
              {formErrors.map((err) => <li key={err}>{err}</li>)}
            </ul>
          )}
        </section>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>批次管理</p>
            <h2>分拣批次</h2>
          </div>
          <div className="inline-form">
            <input value={newBatchName} onChange={(e) => setNewBatchName(e.target.value)} placeholder="新批次名称，如 批次 P-0924-A" />
            <button onClick={() => { setBatchMsg(addBatch(newBatchName) ?? ""); setNewBatchName(""); }}>新建批次</button>
          </div>
        </div>
        {batchMsg && <p className="error-text">{batchMsg}</p>}
        <div className="batch-list">
          {state.batches.map((batch) => {
            const gems = state.gems.filter((g) => g.batchId === batch.id);
            const conflictsHere = sealConflicts?.batchId === batch.id ? sealConflicts.list : null;
            return (
              <article key={batch.id} className={batch.sealed ? "batch sealed" : "batch"}>
                <div>
                  <h3>
                    {batch.name}
                    <em className={batch.sealed ? "badge badge-sealed" : "badge badge-open"}>{batch.sealed ? "已封存" : "分拣中"}</em>
                  </h3>
                  <p>{gems.length} 颗宝石 · {gems.filter((g) => g.assignment).length} 颗已分配 · {gems.filter((g) => g.defect.trim() && !g.defectHandled).length} 条缺陷未处理</p>
                  {conflictsHere && (
                    <ul className="error-list">
                      {conflictsHere.map((c) => <li key={c.message}>{c.message}</li>)}
                    </ul>
                  )}
                </div>
                {!batch.sealed && (
                  <button className="primary" onClick={() => submitSeal(batch.id)}>封存批次</button>
                )}
                {batch.sealed && <span className="hint">记录已停止修改</span>}
              </article>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>镶嵌位置示意</p>
            <h2>位置示意图</h2>
          </div>
          <div className="inline-form">
            <input value={newOrderName} onChange={(e) => setNewOrderName(e.target.value)} placeholder="新订单名称，如 订单 ORD-003 耳坠" />
            <button onClick={() => { setAssignError(addOrder(newOrderName) ?? ""); setNewOrderName(""); }}>新建订单</button>
          </div>
        </div>
        <div className="chips order-tabs">
          {state.orders.map((order) => (
            <button key={order.id} className={effectiveOrderId === order.id ? "chip-active" : ""} onClick={() => { setActiveOrderId(order.id); setAssignError(""); }}>
              {order.name}
            </button>
          ))}
        </div>
        {slots && (
          <>
            <div className="diagram">
              {DIAGRAM_LAYOUT.flat().map((cell, cellIdx) => {
                const isMain = cell === "main";
                const sideIndex = isMain ? -1 : DIAGRAM_SIDE_INDEX[cellIdx];
                const occupant = isMain ? slots.main : slots.side[sideIndex];
                const label = isMain ? "主石位" : `围石${sideIndex + 1}号位`;
                return (
                  <div key={cellIdx} className={isMain ? "slot slot-main" : "slot"}>
                    <b>{label}</b>
                    <span className={occupant ? "slot-gem" : "slot-empty"}>{occupant ? occupant.code : "空位"}</span>
                    <select
                      value={occupant?.id ?? ""}
                      onChange={(e) => handleSlotSelect(effectiveOrderId, isMain ? "main" : "side", isMain ? 0 : sideIndex, e.target.value)}
                    >
                      <option value="">— 空出 —</option>
                      {candidates.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.code} · {g.species} · {sizeLabel(g)}
                        </option>
                      ))}
                    </select>
                  </div>
                );
              })}
            </div>
            <p className="hint">主石位只放一颗，围石位最多 {SIDE_SLOT_LIMIT} 颗；已属其他订单或已封存批次的宝石不会出现在候选中。</p>
            {assignError && <p className="error-text">{assignError}</p>}
          </>
        )}
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>按订单查看</p>
            <h2>订单宝石清单</h2>
          </div>
        </div>
        <div className="order-list">
          {state.orders.map((order) => {
            const map = orderSlotMap(state, order.id);
            const gems = [map.main, ...map.side].filter((g): g is Gem => g !== null);
            const carat = gems.reduce((sum, g) => sum + g.carat, 0).toFixed(2);
            return (
              <article key={order.id}>
                <h3>{order.name}</h3>
                <p>
                  主石位：{map.main ? `${map.main.code}（${map.main.species} ${sizeLabel(map.main)}）` : "空缺"} ·
                  围石 {map.side.filter(Boolean).length}/{SIDE_SLOT_LIMIT} · 合计 {carat} ct
                </p>
                {gems.length > 0 && (
                  <p className="hint">{gems.map((g) => `${g.assignment?.slot === "main" ? "主" : `围${g.assignment!.slotIndex + 1}`}:${g.code}`).join("　")}</p>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>宝石记录</p>
            <h2>分拣台记录（{filteredGems.length}/{state.gems.length}）</h2>
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>编号</th><th>种类</th><th>形状</th><th>克拉</th><th>尺寸</th>
                <th>净度</th><th>颜色</th><th>切工</th><th>缺陷说明</th><th>批次</th><th>镶嵌位置</th>
              </tr>
            </thead>
            <tbody>
              {filteredGems.map((gem) => {
                const batch = batchOf(state, gem);
                const locked = isLocked(state, gem);
                return (
                  <tr key={gem.id} className={locked ? "row-locked" : ""}>
                    <td><b>{gem.code}</b></td>
                    <td>{gem.species}</td>
                    <td>{gem.shape}</td>
                    <td>{gem.carat.toFixed(2)}</td>
                    <td>{sizeLabel(gem)}</td>
                    <td>{gem.clarity}</td>
                    <td>{gem.color || "—"}</td>
                    <td>{gem.cut}</td>
                    <td>
                      {gem.defect.trim() === "" ? "无" : (
                        <label className="defect-cell">
                          <span>{gem.defect}</span>
                          <span className="defect-check">
                            <input
                              type="checkbox"
                              checked={gem.defectHandled}
                              disabled={locked}
                              onChange={(e) => markDefect(gem.id, e.target.checked)}
                            />
                            已处理
                          </span>
                        </label>
                      )}
                    </td>
                    <td>{batch?.name ?? "—"}{locked && <em className="badge badge-sealed">封存</em>}</td>
                    <td>{positionLabel(gem)}</td>
                  </tr>
                );
              })}
              {filteredGems.length === 0 && (
                <tr><td colSpan={11} className="hint">当前筛选条件下没有宝石记录</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}

export default App;
