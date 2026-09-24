// 存档：localStorage 持久化与状态操作 —— 关掉浏览器再打开，待办仍在

import { useEffect, useState } from "react";
import {
  addGemToBatch,
  assignGem,
  sealBatch,
  setDefectHandled,
  unassignGem,
  validateGemDraft,
  type Conflict,
  type GemDraft,
  type State,
} from "./rules";

const STORAGE_KEY = "hxyfront-62006-gem-sorting-v1";

export function uid(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function seedState(): State {
  const batchId = uid();
  const orderRing = uid();
  const orderPendant = uid();
  const gem = (partial: Omit<import("./rules").Gem, "id" | "batchId" | "defectHandled"> & { defectHandled?: boolean }) => ({
    defectHandled: partial.defect.trim() === "",
    ...partial,
    id: uid(),
    batchId,
  });
  return {
    batches: [{ id: batchId, name: "批次 P-0923-A", sealed: false, createdAt: new Date().toISOString() }],
    orders: [
      { id: orderRing, name: "订单 ORD-001 钻戒" },
      { id: orderPendant, name: "订单 ORD-002 吊坠" },
    ],
    gems: [
      gem({
        code: "ST-2048", species: "蓝宝石", shape: "椭圆", carat: 1.24, lengthMm: 6, widthMm: 4,
        clarity: "VS", color: "皇家蓝", cut: "VG 很好", defect: "",
        assignment: { orderId: orderRing, slot: "main", slotIndex: 0 },
      }),
      gem({
        code: "ST-2061", species: "钻石", shape: "圆形", carat: 0.08, lengthMm: 2.6, widthMm: 2.6,
        clarity: "VVS", color: "D-E", cut: "EX 优", defect: "",
        assignment: { orderId: orderRing, slot: "side", slotIndex: 0 },
      }),
      gem({
        code: "ST-2099", species: "祖母绿", shape: "祖母绿切", carat: 0.92, lengthMm: 6.5, widthMm: 4.5,
        clarity: "I", color: "浓绿", cut: "G 好", defect: "内含物明显，需客户确认",
        assignment: null,
      }),
    ],
  };
}

function loadState(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return seedState();
    const parsed = JSON.parse(raw) as State;
    if (!Array.isArray(parsed.gems) || !Array.isArray(parsed.batches) || !Array.isArray(parsed.orders)) {
      return seedState();
    }
    return parsed;
  } catch {
    return seedState();
  }
}

export function useArchive() {
  const [state, setState] = useState<State>(loadState);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  /** 返回错误信息数组；空数组表示成功 */
  function addGem(draft: GemDraft, batchId: string): string[] {
    const errors = validateGemDraft(state, draft, batchId);
    if (errors.length > 0) return errors;
    const result = addGemToBatch(state, draft, batchId, uid());
    if (result.ok) setState(result.value);
    return [];
  }

  function addBatch(name: string): string | null {
    const trimmed = name.trim();
    if (!trimmed) return "批次名称不能为空";
    if (state.batches.some((b) => b.name === trimmed)) return `批次 ${trimmed} 已存在`;
    setState({ ...state, batches: [...state.batches, { id: uid(), name: trimmed, sealed: false, createdAt: new Date().toISOString() }] });
    return null;
  }

  function addOrder(name: string): string | null {
    const trimmed = name.trim();
    if (!trimmed) return "订单名称不能为空";
    if (state.orders.some((o) => o.name === trimmed)) return `订单 ${trimmed} 已存在`;
    setState({ ...state, orders: [...state.orders, { id: uid(), name: trimmed }] });
    return null;
  }

  /** 返回错误信息；null 表示成功 */
  function assign(gemId: string, orderId: string, slot: "main" | "side", slotIndex: number): string | null {
    const result = assignGem(state, gemId, orderId, slot, slotIndex);
    if (!result.ok) return result.error;
    setState(result.value);
    return null;
  }

  function unassign(gemId: string): string | null {
    const result = unassignGem(state, gemId);
    if (!result.ok) return result.error;
    setState(result.value);
    return null;
  }

  function markDefect(gemId: string, handled: boolean): string | null {
    const result = setDefectHandled(state, gemId, handled);
    if (!result.ok) return result.error;
    setState(result.value);
    return null;
  }

  /** 返回冲突列表；null 表示封存成功。有冲突时保留原分配、不予封存 */
  function seal(batchId: string): Conflict[] | null {
    const result = sealBatch(state, batchId);
    if (!result.ok) return result.conflicts;
    setState(result.value);
    return null;
  }

  return { state, addGem, addBatch, addOrder, assign, unassign, markDefect, seal };
}
