// 页面层：分拣台 / 镶嵌位置示意图 / 订单清单 三个业务视图
import { useMemo, useState, type ChangeEvent, type ReactNode } from "react";
import type { Store } from "./store";
import { EMPTY_GEM_FORM } from "./store";
import {
  canAssign,
  CLARITIES,
  CUTS,
  Conflict,
  filterGems,
  findBatch,
  findOrder,
  Gem,
  GemFilter,
  GemForm,
  gemsOfBatch,
  isAssigned,
  longEdge,
  MAX_ACCENTS,
  orderLanes,
  sealingConflicts,
  Shape,
  SHAPES,
  Slot,
  slotLabel,
  SortingState,
} from "./judge";

type Notify = (msg: string, type?: "ok" | "err") => void;

// ---------- 共用展示 ----------

const clarityText = (c: string) => c || "未检";
const cutText = (c: string) => c || "未检";
const sizeText = (g: Gem) => `${g.lengthMm}×${g.widthMm} mm`;
const orderNameOf = (s: SortingState, id?: string) =>
  id ? findOrder(s, id)?.name ?? id : "";

function DefectTag({ gem }: { gem: Gem }) {
  if (!gem.defectNote) return null;
  return (
    <span className={`tag ${gem.defectHandled ? "ok" : "warn"}`}>
      {gem.defectHandled ? "缺陷已处理" : "缺陷待处理"}
    </span>
  );
}

function AssignTag({ gem, state }: { gem: Gem; state: SortingState }) {
  if (!isAssigned(gem) || !gem.slot) return <span className="tag muted">待镶嵌</span>;
  return (
    <span className="tag accent-tag">
      {orderNameOf(state, gem.orderId)} · {slotLabel(gem.slot)}
    </span>
  );
}

function UncheckedTag({ gem }: { gem: Gem }) {
  if (gem.clarity && gem.cut) return null;
  return <span className="tag warn">缺检：{!gem.clarity ? "净度" : ""}{!gem.cut ? "切工" : ""}</span>;
}

const EMPTY_FILTER: GemFilter = { shape: "", keyword: "", minSize: "", maxSize: "", unassignedOnly: false };

function FilterBar({ filter, onChange, extra }: { filter: GemFilter; onChange: (f: GemFilter) => void; extra?: ReactNode }) {
  return (
    <div className="filterbar">
      <div className="chips">
        <button
          className={filter.shape === "" ? "active" : ""}
          onClick={() => onChange({ ...filter, shape: "" })}
        >
          全部形状
        </button>
        {SHAPES.map((s) => (
          <button
            key={s}
            className={filter.shape === s ? "active" : ""}
            onClick={() => onChange({ ...filter, shape: s as Shape })}
          >
            {s}
          </button>
        ))}
      </div>
      <div className="filter-row">
        <input
          placeholder="编号 / 种类 / 颜色"
          value={filter.keyword}
          onChange={(e) => onChange({ ...filter, keyword: e.target.value })}
        />
        <input
          type="number"
          min="0"
          placeholder="长边 ≥ mm"
          value={filter.minSize}
          onChange={(e) => onChange({ ...filter, minSize: e.target.value })}
        />
        <input
          type="number"
          min="0"
          placeholder="长边 ≤ mm"
          value={filter.maxSize}
          onChange={(e) => onChange({ ...filter, maxSize: e.target.value })}
        />
        {extra}
      </div>
    </div>
  );
}

// ================================================================
// 视图一：分拣台（批次 + 登记 + 尺寸筛选 + 封存判定）
// ================================================================

export function SortingPage({ store, notify }: { store: Store; notify: Notify }) {
  const { state } = store;
  const batch = findBatch(state, state.activeBatchId);
  const sealed = batch?.sealed ?? false;

  const [form, setForm] = useState<GemForm>(EMPTY_GEM_FORM);
  const [editing, setEditing] = useState<string | null>(null);
  const [filter, setFilter] = useState<GemFilter>(EMPTY_FILTER);
  const [newBatchName, setNewBatchName] = useState("");
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null);

  const batchGems = useMemo(
    () => (batch ? filterGems(gemsOfBatch(state, batch.id), filter) : []),
    [state, batch, filter],
  );

  const set = (k: keyof GemForm) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = () => {
    const res = editing
      ? store.updateGem(editing, form)
      : store.registerGem(form);
    if (!res.ok) {
      notify(res.error ?? "保存失败", "err");
      return;
    }
    notify(editing ? `${form.code} 已更新` : `${form.code} 已归入 ${batch?.name}`);
    setForm(EMPTY_GEM_FORM);
    setEditing(null);
  };

  const startEdit = (g: Gem) => {
    setEditing(g.code);
    setForm({
      code: g.code,
      species: g.species,
      shape: g.shape,
      carat: String(g.carat),
      lengthMm: String(g.lengthMm),
      widthMm: String(g.widthMm),
      clarity: g.clarity,
      color: g.color,
      cut: g.cut,
      defectNote: g.defectNote,
    });
  };

  const trySeal = () => {
    if (!batch) return;
    const res = store.sealBatch(batch.id);
    if (!res.ok) {
      setConflicts(res.conflicts);
      notify(`封存未通过：${res.conflicts.length} 项冲突，原分配已保留`, "err");
      return;
    }
    setConflicts(null);
    notify(`批次「${batch.name}」已封存，记录停止修改`);
  };

  return (
    <div className="layout">
      {/* 批次侧栏 */}
      <aside className="panel">
        <h2>分拣批次</h2>
        <div className="batch-list">
          {state.batches.map((b) => {
            const total = gemsOfBatch(state, b.id).length;
            const pending = gemsOfBatch(state, b.id).filter((g) => !isAssigned(g)).length;
            return (
              <button
                key={b.id}
                className={`batch-item ${b.id === state.activeBatchId ? "active" : ""}`}
                onClick={() => {
                  store.setActiveBatch(b.id);
                  setConflicts(null);
                  setEditing(null);
                  setForm(EMPTY_GEM_FORM);
                }}
              >
                <span className="batch-name">
                  {b.name}
                  {b.sealed && <em className="sealed-badge">已封存</em>}
                </span>
                <small>{b.id} · {total} 颗 · 待分配 {pending}</small>
              </button>
            );
          })}
        </div>
        <div className="inline-add">
          <input
            placeholder="新批次名称，如 2024-10 批次"
            value={newBatchName}
            onChange={(e) => setNewBatchName(e.target.value)}
          />
          <button
            className="primary"
            onClick={() => {
              const res = store.addBatch(newBatchName);
              if (!res.ok) return notify(res.error ?? "新建失败", "err");
              setNewBatchName("");
              setConflicts(null);
              notify("分拣批次已建立");
            }}
          >
            新建批次
          </button>
        </div>

        {batch && (
          <div className="seal-box">
            {sealed ? (
              <p className="banner locked">🔒 批次已于 {batch.sealedAt ? new Date(batch.sealedAt).toLocaleString() : "此前"} 封存，记录只读</p>
            ) : (
              <>
                <button className="danger-outline" onClick={trySeal}>封存当前批次</button>
                <small>封存前自动检查未处理缺陷与位置超额</small>
              </>
            )}
            {conflicts && conflicts.length > 0 && (
              <div className="conflict-box">
                <h4>封存冲突（{conflicts.length}）— 原分配已保留</h4>
                {conflicts.map((c, i) => (
                  <p key={i} className="conflict-item">
                    <span className={`conflict-kind ${c.kind}`}>{c.kind === "defect" ? "未处理缺陷" : "位置超额"}</span>
                    {c.message}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </aside>

      {/* 主区域 */}
      <section className="main-col">
        <div className="panel">
          <div className="heading">
            <div>
              <p>当前批次 · {batch?.id}</p>
              <h2>{sealed ? "批次已封存" : editing ? `编辑 ${editing}` : "裸石登记"}</h2>
            </div>
          </div>

          {sealed ? (
            <p className="banner locked">该批次已封存，编号、种类、尺寸、缺陷与订单位置均不可再修改。</p>
          ) : (
            <>
              <div className="form-grid">
                <label>
                  <span>宝石编号 *</span>
                  <input value={form.code} onChange={set("code")} placeholder="如 ST-2110" />
                </label>
                <label>
                  <span>种类 *</span>
                  <input value={form.species} onChange={set("species")} placeholder="如 蓝宝石 / 钻石" />
                </label>
                <label>
                  <span>形状 *</span>
                  <select value={form.shape} onChange={set("shape")}>
                    <option value="">请选择</option>
                    {SHAPES.map((s) => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>克拉重量 ct *</span>
                  <input type="number" step="0.001" min="0" value={form.carat} onChange={set("carat")} />
                </label>
                <label>
                  <span>尺寸 长 mm *</span>
                  <input type="number" step="0.01" min="0" value={form.lengthMm} onChange={set("lengthMm")} />
                </label>
                <label>
                  <span>尺寸 宽 mm *</span>
                  <input type="number" step="0.01" min="0" value={form.widthMm} onChange={set("widthMm")} />
                </label>
                <label>
                  <span>净度</span>
                  <select value={form.clarity} onChange={set("clarity")}>
                    {CLARITIES.map((c) => (
                      <option key={c} value={c}>{clarityText(c)}</option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>颜色</span>
                  <input value={form.color} onChange={set("color")} placeholder="如 皇家蓝 / D" />
                </label>
                <label>
                  <span>切工</span>
                  <select value={form.cut} onChange={set("cut")}>
                    {CUTS.map((c) => (
                      <option key={c} value={c}>{c ? c : "未检"}</option>
                    ))}
                  </select>
                </label>
                <label className="full">
                  <span>缺陷说明</span>
                  <textarea
                    rows={2}
                    value={form.defectNote}
                    onChange={set("defectNote")}
                    placeholder="如 亭部小缺口、内含物明显需客户确认；无缺陷留空"
                  />
                </label>
              </div>
              <div className="form-actions">
                <button className="primary" onClick={submit}>{editing ? "保存修改" : "登记入批"}</button>
                {editing && (
                  <button
                    onClick={() => {
                      setEditing(null);
                      setForm(EMPTY_GEM_FORM);
                    }}
                  >
                    取消编辑
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        <div className="panel">
          <div className="heading">
            <div>
              <p>尺寸筛选 · 与位置示意、订单清单共用同一份记录</p>
              <h2>批次内裸石（{batchGems.length}）</h2>
            </div>
          </div>
          <FilterBar
            filter={filter}
            onChange={setFilter}
            extra={
              <label className="check-inline">
                <input
                  type="checkbox"
                  checked={filter.unassignedOnly}
                  onChange={(e) => setFilter({ ...filter, unassignedOnly: e.target.checked })}
                />
                只看待分配
              </label>
            }
          />
          <div className="gem-list">
            {batchGems.length === 0 && <p className="empty-hint">没有符合筛选条件的裸石</p>}
            {batchGems.map((g) => (
              <article key={g.code} className={`gem-card ${g.defectNote && !g.defectHandled ? "has-defect" : ""}`}>
                <div className="gem-head">
                  <h3>{g.code}</h3>
                  <div className="gem-tags">
                    <AssignTag gem={g} state={state} />
                    <UncheckedTag gem={g} />
                    <DefectTag gem={g} />
                    {sealed && <span className="tag muted">已封存</span>}
                  </div>
                </div>
                <p className="gem-attrs">
                  {g.species} · {g.shape} · {g.carat}ct · {sizeText(g)}（长边 {longEdge(g)}mm）·
                  净度 {clarityText(g.clarity)} · 颜色 {g.color || "—"} · 切工 {cutText(g.cut)}
                </p>
                {g.defectNote && <p className="defect-note">缺陷：{g.defectNote}</p>}
                {!sealed && (
                  <div className="gem-actions">
                    {g.defectNote && (
                      <label className="check-inline">
                        <input
                          type="checkbox"
                          checked={g.defectHandled}
                          onChange={(e) => {
                            const res = store.setDefectHandled(g.code, e.target.checked);
                            if (!res.ok) notify(res.error ?? "操作失败", "err");
                          }}
                        />
                        缺陷已处理
                      </label>
                    )}
                    <button onClick={() => startEdit(g)}>编辑</button>
                    {isAssigned(g) && (
                      <button
                        onClick={() => {
                          const res = store.unassignGem(g.code);
                          if (res.ok) notify(`${g.code} 已移出镶嵌位置`);
                          else notify(res.error ?? "操作失败", "err");
                        }}
                      >
                        移出订单
                      </button>
                    )}
                    <button
                      className="danger-text"
                      onClick={() => {
                        if (!window.confirm(`确认删除裸石 ${g.code}？`)) return;
                        const res = store.removeGem(g.code);
                        if (!res.ok) notify(res.error ?? "删除失败", "err");
                        else notify(`${g.code} 已删除`);
                      }}
                    >
                      删除
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}

// ================================================================
// 视图二：镶嵌位置示意图（主石 1 + 围石 8，分配规则在此执行）
// ================================================================

const RING = 128; // 围石距圆心 px
const CENTER = 170; // 示意盘中心 px

export function SettingPage({ store, notify }: { store: Store; notify: Notify }) {
  const { state } = store;
  const order = findOrder(state, state.activeOrderId);
  const lanes = useMemo(
    () => (order ? orderLanes(state, order.id) : { main: null, accents: [] }),
    [state, order],
  );

  const [filter, setFilter] = useState<GemFilter>(EMPTY_FILTER);
  const [selected, setSelected] = useState<Slot>("main");
  const [newOrderName, setNewOrderName] = useState("");

  const pool = useMemo(
    () => filterGems(
      state.gems.filter((g) => !findBatch(state, g.batchId)?.sealed),
      filter,
    ),
    [state, filter],
  );

  const accentCount = lanes.accents.filter(Boolean).length;

  const doAssign = (code: string, slot: Slot) => {
    if (!order) return;
    const res = store.assignGem(code, order.id, slot);
    if (!res.ok) return notify(res.error ?? "分配失败", "err");
    notify(`${code} 已放入${slotLabel(slot)}`);
  };

  const gemRow = (g: Gem) => {
    const mine = g.orderId === order?.id;
    const foreign = g.orderId && !mine;
    return (
      <article key={g.code} className={`gem-card tight ${foreign ? "disabled" : ""}`}>
        <div className="gem-head">
          <h3>{g.code}</h3>
          <div className="gem-tags">
            {foreign && <span className="tag warn">已属「{orderNameOf(state, g.orderId)}」不可再分</span>}
            {mine && <span className="tag ok">{g.slot !== undefined ? slotLabel(g.slot) : ""}</span>}
            <DefectTag gem={g} />
          </div>
        </div>
        <p className="gem-attrs">
          {g.species} · {g.shape} · {g.carat}ct · {sizeText(g)}（{longEdge(g)}mm）· {clarityText(g.clarity)} · {g.color || "—"}
        </p>
        {!foreign && (
          <div className="gem-actions">
            {canAssign(state, g.code, order!.id, "main").ok && (
              <button onClick={() => doAssign(g.code, "main")}>
                {lanes.main?.code === g.code ? "留在主石位" : "放入主石位"}
              </button>
            )}
            {canAssign(state, g.code, order!.id, firstFreeOrOne(state, order!.id)).ok && (
              <button
                onClick={() => {
                  const res = store.autoAccent(g.code, order!.id);
                  if (!res.ok) return notify(res.error ?? "分配失败", "err");
                  notify(`${g.code} 已放入围石空位`);
                }}
              >
                {mine && typeof g.slot === "number" ? "调到下一围石空位" : "放入围石空位"}
              </button>
            )}
            {mine && (
              <button
                onClick={() => {
                  const res = store.unassignGem(g.code);
                  if (!res.ok) return notify(res.error ?? "操作失败", "err");
                  notify(`${g.code} 已移出位置`);
                }}
              >
                移出位置
              </button>
            )}
          </div>
        )}
      </article>
    );
  };

  const selectedGem: Gem | null =
    selected === "main" ? lanes.main : lanes.accents[(selected as number) - 1] ?? null;

  return (
    <div className="setting-grid">
      <div className="panel">
        <div className="heading">
          <div>
            <p>镶嵌位置示意</p>
            <h2>{order?.name ?? "请选择订单"}</h2>
          </div>
          <div className="count-chip">主石 {lanes.main ? 1 : 0}/1 · 围石 {accentCount}/{MAX_ACCENTS}</div>
        </div>

        <div className="order-tabs">
          {state.orders.map((o) => (
            <button
              key={o.id}
              className={o.id === state.activeOrderId ? "active" : ""}
              onClick={() => {
                store.setActiveOrder(o.id);
                setSelected("main");
              }}
            >
              {o.name}
            </button>
          ))}
        </div>
        <div className="inline-add">
          <input
            placeholder="新订单名称，如 客户定制 · 钻戒"
            value={newOrderName}
            onChange={(e) => setNewOrderName(e.target.value)}
          />
          <button
            className="primary"
            onClick={() => {
              const res = store.addOrder(newOrderName);
              if (!res.ok) return notify(res.error ?? "新建失败", "err");
              setNewOrderName("");
              notify("订单已建立");
            }}
          >
            新建订单
          </button>
        </div>

        {/* 位置示意盘 */}
        <div className="ring-board" style={{ width: CENTER * 2, height: CENTER * 2 }}>
          <button
            className={`slot main ${lanes.main ? "has" : "empty"} ${selected === "main" ? "selected" : ""}`}
            style={{ left: CENTER - 52, top: CENTER - 52 }}
            onClick={() => setSelected("main")}
          >
            {lanes.main ? (
              <span className="slot-gem">
                <b>{lanes.main.code}</b>
                <small>{lanes.main.shape} {lanes.main.carat}ct</small>
              </span>
            ) : (
              <span className="slot-empty">主石位<br /><small>仅 1 颗</small></span>
            )}
          </button>
          {lanes.accents.map((g, i) => {
            const angle = (-90 + i * 45) * (Math.PI / 180);
            const x = CENTER + RING * Math.cos(angle);
            const y = CENTER + RING * Math.sin(angle);
            const n = i + 1;
            return (
              <button
                key={n}
                className={`slot accent ${g ? "has" : "empty"} ${selected === n ? "selected" : ""}`}
                style={{ left: x - 32, top: y - 32 }}
                onClick={() => setSelected(n)}
              >
                {g ? (
                  <span className="slot-gem">
                    <b>{g.code}</b>
                    <small>{g.carat}ct</small>
                  </span>
                ) : (
                  <span className="slot-empty"><small>围石{n}</small></span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="panel">
        <div className="heading">
          <div>
            <p>{slotLabel(selected)}</p>
            <h2>{selectedGem ? selectedGem.code : "空位 · 选择裸石放入"}</h2>
          </div>
          {selectedGem && (
            <button
              onClick={() => {
                const res = store.unassignGem(selectedGem.code);
                if (!res.ok) return notify(res.error ?? "操作失败", "err");
                notify(`${selectedGem.code} 已移出${slotLabel(selected)}`);
              }}
            >
              移出此位
            </button>
          )}
        </div>

        {selectedGem && (
          <div className="gem-detail">
            <p className="gem-attrs">
              {selectedGem.species} · {selectedGem.shape} · {selectedGem.carat}ct · {sizeText(selectedGem)}
            </p>
            <p className="gem-attrs">
              净度 {clarityText(selectedGem.clarity)} · 颜色 {selectedGem.color || "—"} · 切工 {cutText(selectedGem.cut)}
            </p>
            {selectedGem.defectNote && (
              <p className="defect-note">
                缺陷{selectedGem.defectHandled ? "（已处理）" : "（未处理，封存前必须处理）"}：{selectedGem.defectNote}
              </p>
            )}
            <div className="gem-actions">
              {selected !== "main" && canAssign(state, selectedGem.code, order!.id, "main").ok && (
                <button className="primary" onClick={() => doAssign(selectedGem.code, "main")}>改放主石位</button>
              )}
            </div>
          </div>
        )}

        <FilterBar filter={filter} onChange={setFilter} />
        <p className="hint-line">尺寸按长边 mm 筛选；已属其他订单的裸石不能再次分配。</p>
        <div className="gem-list">
          {pool.length === 0 && <p className="empty-hint">没有符合筛选条件的可用裸石</p>}
          {pool.map(gemRow)}
        </div>
      </div>
    </div>
  );
}

function firstFreeOrOne(s: SortingState, orderId: string): Slot {
  const { accents } = orderLanes(s, orderId);
  const idx = accents.findIndex((g) => g === null);
  return idx === -1 ? MAX_ACCENTS : idx + 1;
}

// ================================================================
// 视图三：订单清单
// ================================================================

export function OrdersPage({ store, notify }: { store: Store; notify: Notify }) {
  const { state } = store;
  const order = findOrder(state, state.activeOrderId);
  const lanes = useMemo(
    () => (order ? orderLanes(state, order.id) : { main: null, accents: [] as (Gem | null)[] }),
    [state, order],
  );
  const assigned = useMemo(
    () => (order ? state.gems.filter((g) => g.orderId === order.id) : []),
    [state, order],
  );
  const totalCarat = assigned.reduce((sum, g) => sum + g.carat, 0);
  const accentCount = lanes.accents.filter(Boolean).length;

  const renderGem = (g: Gem, slot: Slot) => {
    const sealed = findBatch(state, g.batchId)?.sealed ?? false;
    return (
      <article key={g.code} className={`gem-card tight ${g.defectNote && !g.defectHandled ? "has-defect" : ""}`}>
        <div className="gem-head">
          <h3>{g.code} <small className="slot-sub">{slotLabel(slot)}</small></h3>
          <div className="gem-tags">
            <UncheckedTag gem={g} />
            <DefectTag gem={g} />
            {sealed && <span className="tag muted">批次已封存</span>}
          </div>
        </div>
        <p className="gem-attrs">
          {g.species} · {g.shape} · {g.carat}ct · {sizeText(g)} · 净度 {clarityText(g.clarity)} ·
          颜色 {g.color || "—"} · 切工 {cutText(g.cut)}
        </p>
        {g.defectNote && <p className="defect-note">缺陷：{g.defectNote}</p>}
        {!sealed && (
          <div className="gem-actions">
            <button
              onClick={() => {
                const res = store.unassignGem(g.code);
                if (!res.ok) return notify(res.error ?? "操作失败", "err");
                notify(`${g.code} 已退回待分配`);
              }}
            >
              退回待分配
            </button>
          </div>
        )}
      </article>
    );
  };

  return (
    <div className="panel">
      <div className="heading">
        <div>
          <p>按订单查看 · 与分拣台、位置示意共用记录</p>
          <h2>订单镶嵌清单</h2>
        </div>
      </div>

      <div className="order-tabs big">
        {state.orders.map((o) => {
          const n = state.gems.filter((g) => g.orderId === o.id).length;
          const carat = state.gems.filter((g) => g.orderId === o.id).reduce((s, g) => s + g.carat, 0);
          return (
            <button
              key={o.id}
              className={o.id === state.activeOrderId ? "active" : ""}
              onClick={() => store.setActiveOrder(o.id)}
            >
              {o.name}
              <small>{n} 颗 · {carat.toFixed(2)}ct</small>
            </button>
          );
        })}
      </div>

      {!order ? (
        <p className="empty-hint">还没有订单，请先在「镶嵌位置」页新建订单。</p>
      ) : (
        <>
          <div className="order-summary">
            <span className="metric-chip">主石 {lanes.main ? 1 : 0}/1</span>
            <span className={`metric-chip ${accentCount >= MAX_ACCENTS ? "full" : ""}`}>
              围石 {accentCount}/{MAX_ACCENTS}{accentCount >= MAX_ACCENTS ? " · 已满" : ""}
            </span>
            <span className="metric-chip">合计 {assigned.length} 颗 · {totalCarat.toFixed(2)}ct</span>
            {!lanes.main && <span className="metric-chip warn">主石位空缺</span>}
          </div>

          <h3 className="lane-title">主石位（仅一颗）</h3>
          <div className="lane-single">
            {lanes.main ? renderGem(lanes.main, "main") : (
              <p className="empty-hint">主石位尚未放入裸石，请到「镶嵌位置」页分配。</p>
            )}
          </div>

          <h3 className="lane-title">围石位（最多 {MAX_ACCENTS} 颗，按位编号）</h3>
          <div className="accent-grid">
            {lanes.accents.map((g, i) => (
              <div key={i + 1} className={`accent-cell ${g ? "filled" : ""}`}>
                <span className="accent-no">围石{i + 1}位</span>
                {g ? (
                  <>
                    <b>{g.code}</b>
                    <small>{g.species} · {g.shape} · {g.carat}ct</small>
                    <small>{sizeText(g)}</small>
                  </>
                ) : (
                  <small className="muted">空位</small>
                )}
              </div>
            ))}
          </div>

          <h3 className="lane-title">完整资料</h3>
          <div className="gem-list">
            {assigned.length === 0 && <p className="empty-hint">该订单还没有分配任何裸石。</p>}
            {assigned.map((g) => renderGem(g, g.slot ?? "main"))}
          </div>
        </>
      )}
    </div>
  );
}

// 供其它模块复用的只读检查入口（封存冲突预览）
export { sealingConflicts };
