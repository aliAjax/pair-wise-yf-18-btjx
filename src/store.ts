// 存档层：localStorage 持久化、状态读写与业务动作
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  canAssign,
  EMPTY_GEM_FORM,
  firstFreeAccent,
  Gem,
  GemForm,
  GemInput,
  gemsOfBatch,
  isAssigned,
  isBatchSealed,
  MAX_ACCENTS,
  Result,
  sealingConflicts,
  Slot,
  SortingState,
  validateGem,
} from "./judge";

const STORAGE_KEY = "gem-sorting-studio-v1";

// ---------- 种子数据（首次打开写入，关闭浏览器后仍在） ----------

function seed(): SortingState {
  const now = Date.now();
  const batchA = "B-2401";
  const orderA = "O-1001";
  const orderB = "O-1002";

  const gem = (p: Partial<Gem> & Pick<Gem, "code" | "species" | "shape" | "carat" | "lengthMm" | "widthMm">): Gem => ({
    clarity: "VS1",
    color: "",
    cut: "VG",
    defectNote: "",
    defectHandled: false,
    batchId: batchA,
    createdAt: now,
    ...p,
  });

  return {
    batches: [
      { id: batchA, name: "2024-09 分拣批次", sealed: false, createdAt: now },
      { id: "B-2398", name: "2024-08 已封存批次", sealed: true, createdAt: now - 86400000 * 12, sealedAt: now - 86400000 * 5 },
    ],
    orders: [
      { id: orderA, name: "客户定制 · 椭圆主石戒指", createdAt: now },
      { id: orderB, name: "围钻排镶吊坠", createdAt: now },
    ],
    activeBatchId: batchA,
    activeOrderId: orderA,
    gems: [
      gem({ code: "ST-2048", species: "蓝宝石", shape: "椭圆", carat: 1.82, lengthMm: 8.1, widthMm: 6.0, clarity: "VS2", color: "皇家蓝", cut: "EX", orderId: orderA, slot: "main" }),
      gem({ code: "ST-2061", species: "钻石", shape: "圆形", carat: 0.08, lengthMm: 2.6, widthMm: 2.6, clarity: "VVS1", color: "D", cut: "EX", orderId: orderA, slot: 1 }),
      gem({ code: "ST-2062", species: "钻石", shape: "圆形", carat: 0.07, lengthMm: 2.5, widthMm: 2.5, clarity: "VVS2", color: "E", cut: "EX", orderId: orderA, slot: 2 }),
      gem({ code: "ST-2063", species: "钻石", shape: "圆形", carat: 0.08, lengthMm: 2.6, widthMm: 2.6, clarity: "VS1", color: "F", cut: "VG", orderId: orderB, slot: 1 }),
      gem({ code: "ST-2077", species: "红宝石", shape: "梨形", carat: 0.95, lengthMm: 6.4, widthMm: 4.2, clarity: "SI1", color: "鸽血红", cut: "VG", defectNote: "亭部小缺口，待确认能否镶" }),
      gem({ code: "ST-2099", species: "祖母绿", shape: "祖母绿切", carat: 0.62, lengthMm: 5.2, widthMm: 4.0, clarity: "", color: "木佐绿", cut: "", defectNote: "内含物明显，需客户确认" }),
      gem({ code: "ST-2103", species: "钻石", shape: "圆形", carat: 0.08, lengthMm: 2.6, widthMm: 2.6, clarity: "VVS1", color: "D", cut: "EX" }),
      gem({ code: "ST-2104", species: "蓝宝石", shape: "圆形", carat: 0.31, lengthMm: 4.1, widthMm: 4.1, clarity: "VS1", color: "矢车菊", cut: "VG" }),
      // 已封存批次的历史记录
      gem({ code: "ST-1990", species: "钻石", shape: "圆形", carat: 0.5, lengthMm: 5.0, widthMm: 5.0, clarity: "VS2", color: "G", cut: "EX", batchId: "B-2398", orderId: orderB, slot: 2, createdAt: now - 86400000 * 10 }),
    ],
  };
}

function load(): SortingState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as SortingState;
      if (parsed && Array.isArray(parsed.batches) && Array.isArray(parsed.gems) && Array.isArray(parsed.orders))
        return parsed;
    }
  } catch {
    // 存档损坏时回退到种子
  }
  return seed();
}

// ---------- 编号 ----------

const nextId = (prefix: string, used: string[]) => {
  let n = 1000;
  used.forEach((id) => {
    const m = id.match(/\d+$/);
    if (m) n = Math.max(n, Number(m[0]));
  });
  return `${prefix}-${n + 1}`;
};

// ---------- Store Hook ----------

export interface Store {
  state: SortingState;
  addBatch: (name: string) => Result & { id?: string };
  addOrder: (name: string) => Result & { id?: string };
  setActiveBatch: (id: string) => void;
  setActiveOrder: (id: string) => void;
  registerGem: (form: GemForm) => Result;
  updateGem: (code: string, form: GemForm) => Result;
  removeGem: (code: string) => Result;
  setDefectHandled: (code: string, handled: boolean) => Result;
  assignGem: (code: string, orderId: string, slot: Slot) => Result;
  autoAccent: (code: string, orderId: string) => Result;
  unassignGem: (code: string) => Result;
  sealBatch: (batchId: string) => { ok: boolean; conflicts: ReturnType<typeof sealingConflicts> };
  resetAll: () => void;
}

export function useSortingStore(): Store {
  const [state, setState] = useState<SortingState>(load);

  // 任意变更立即落盘，关掉浏览器再打开待办仍在
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // 存储不可用时仅本次会话有效
    }
  }, [state]);

  const addBatch = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return { ok: false, error: "批次名称不能为空" };
      const id = nextId("B", state.batches.map((b) => b.id));
      setState((s) => ({
        ...s,
        batches: [...s.batches, { id, name: trimmed, sealed: false, createdAt: Date.now() }],
        activeBatchId: id,
      }));
      return { ok: true, id };
    },
    [state.batches],
  );

  const addOrder = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return { ok: false, error: "订单名称不能为空" };
      if (state.orders.some((o) => o.name === trimmed))
        return { ok: false, error: "已存在同名订单" };
      const id = nextId("O", state.orders.map((o) => o.id));
      setState((s) => ({
        ...s,
        orders: [...s.orders, { id, name: trimmed, createdAt: Date.now() }],
        activeOrderId: id,
      }));
      return { ok: true, id };
    },
    [state.orders],
  );

  const setActiveBatch = useCallback((id: string) => {
    setState((s) => (s.activeBatchId === id ? s : { ...s, activeBatchId: id }));
  }, []);

  const setActiveOrder = useCallback((id: string) => {
    setState((s) => (s.activeOrderId === id ? s : { ...s, activeOrderId: id }));
  }, []);

  const registerGem = useCallback(
    (form: GemForm) => {
      const check = validateGem(state, state.activeBatchId, form);
      if (!check.ok) return { ok: false, error: check.errors.join("；") };
      const input: GemInput = check.input;
      setState((s) => ({
        ...s,
        gems: [
          ...s.gems,
          {
            ...input,
            batchId: s.activeBatchId,
            defectHandled: false,
            createdAt: Date.now(),
          },
        ],
      }));
      return { ok: true };
    },
    [state],
  );

  const updateGem = useCallback(
    (code: string, form: GemForm) => {
      const target = state.gems.find((g) => g.code === code);
      if (!target) return { ok: false, error: "宝石不存在" };
      if (isBatchSealed(state, target.batchId))
        return { ok: false, error: "批次已封存，记录停止修改" };
      const check = validateGem(state, target.batchId, form, code);
      if (!check.ok) return { ok: false, error: check.errors.join("；") };
      const input: GemInput = check.input;
      setState((s) => ({
        ...s,
        gems: s.gems.map((g) =>
          g.code === code
            ? {
                ...g,
                ...input,
                code: input.code,
                // 修改字段不改变已封存状态之外的归属
                defectHandled: g.defectHandled || (input.defectNote === "" ? true : g.defectHandled),
              }
            : g,
        ),
      }));
      return { ok: true };
    },
    [state],
  );

  const removeGem = useCallback(
    (code: string) => {
      const target = state.gems.find((g) => g.code === code);
      if (!target) return { ok: false, error: "宝石不存在" };
      if (isBatchSealed(state, target.batchId))
        return { ok: false, error: "批次已封存，记录停止修改" };
      setState((s) => ({ ...s, gems: s.gems.filter((g) => g.code !== code) }));
      return { ok: true };
    },
    [state],
  );

  const setDefectHandled = useCallback(
    (code: string, handled: boolean) => {
      const target = state.gems.find((g) => g.code === code);
      if (!target) return { ok: false, error: "宝石不存在" };
      if (isBatchSealed(state, target.batchId))
        return { ok: false, error: "批次已封存，记录停止修改" };
      setState((s) => ({
        ...s,
        gems: s.gems.map((g) => (g.code === code ? { ...g, defectHandled: handled } : g)),
      }));
      return { ok: true };
    },
    [state],
  );

  const assignGem = useCallback(
    (code: string, orderId: string, slot: Slot) => {
      const guard = canAssign(state, code, orderId, slot);
      if (!guard.ok) return { ok: false, error: guard.error };
      setState((s) => ({
        ...s,
        gems: s.gems.map((g) =>
          g.code === code ? { ...g, orderId, slot } : g,
        ),
      }));
      return { ok: true };
    },
    [state],
  );

  const autoAccent = useCallback(
    (code: string, orderId: string) => {
      const g = state.gems.find((x) => x.code === code);
      if (!g) return { ok: false, error: "宝石记录不存在" };
      if (isBatchSealed(state, g.batchId))
        return { ok: false, error: "批次已封存，不能分配" };
      if (g.orderId && g.orderId !== orderId) {
        const other = state.orders.find((o) => o.id === g.orderId)?.name ?? g.orderId;
        return { ok: false, error: `${code} 已属订单「${other}」，不能再次分配` };
      }
      const free = firstFreeAccent(state, orderId);
      if (free === null)
        return { ok: false, error: `围石位已满（最多 ${MAX_ACCENTS} 颗）` };
      setState((s) => ({
        ...s,
        gems: s.gems.map((x) =>
          x.code === code ? { ...x, orderId, slot: free } : x,
        ),
      }));
      return { ok: true };
    },
    [state],
  );

  const unassignGem = useCallback(
    (code: string) => {
      const target = state.gems.find((g) => g.code === code);
      if (!target) return { ok: false, error: "宝石不存在" };
      if (isBatchSealed(state, target.batchId))
        return { ok: false, error: "批次已封存，记录停止修改" };
      setState((s) => ({
        ...s,
        gems: s.gems.map((g) =>
          g.code === code ? { ...g, orderId: undefined, slot: undefined } : g,
        ),
      }));
      return { ok: true };
    },
    [state],
  );

  const sealBatch = useCallback(
    (batchId: string) => {
      // 封存前检查：有冲突就列出冲突并保留原分配（不修改任何数据）
      const conflicts = sealingConflicts(state, batchId);
      if (conflicts.length) return { ok: false, conflicts };
      let existed = false;
      setState((s) => {
        if (!s.batches.some((b) => b.id === batchId && !b.sealed)) return s;
        existed = true;
        return {
          ...s,
          batches: s.batches.map((b) =>
            b.id === batchId ? { ...b, sealed: true, sealedAt: Date.now() } : b,
          ),
        };
      });
      if (!existed) return { ok: false, conflicts: [] };
      return { ok: true, conflicts: [] };
    },
    [state],
  );

  const resetAll = useCallback(() => setState(seed()), []);

  return useMemo(
    () => ({
      state,
      addBatch,
      addOrder,
      setActiveBatch,
      setActiveOrder,
      registerGem,
      updateGem,
      removeGem,
      setDefectHandled,
      assignGem,
      autoAccent,
      unassignGem,
      sealBatch,
      resetAll,
    }),
    [
      state,
      addBatch,
      addOrder,
      setActiveBatch,
      setActiveOrder,
      registerGem,
      updateGem,
      removeGem,
      setDefectHandled,
      assignGem,
      autoAccent,
      unassignGem,
      sealBatch,
      resetAll,
    ],
  );
}

// 便捷选择器
export const batchGemCount = (s: SortingState, batchId: string) =>
  gemsOfBatch(s, batchId).length;
export const unassignedInBatch = (s: SortingState, batchId: string) =>
  gemsOfBatch(s, batchId).filter((g) => !isAssigned(g)).length;
export { EMPTY_GEM_FORM };
