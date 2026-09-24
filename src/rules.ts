// 判定：宝石分拣业务规则 —— 记录校验、位置分配、冲突检测、批次封存判定

export interface Assignment {
  orderId: string;
  slot: "main" | "side";
  slotIndex: number; // 主石位恒为 0，围石位 0..7
}

export interface Gem {
  id: string;
  code: string; // 宝石编号
  species: string; // 种类
  shape: string; // 形状
  carat: number; // 克拉重量
  lengthMm: number; // 尺寸-长
  widthMm: number; // 尺寸-宽
  clarity: string; // 净度
  color: string; // 颜色
  cut: string; // 切工
  defect: string; // 缺陷说明
  defectHandled: boolean; // 缺陷是否已处理
  batchId: string; // 所属分拣批次
  assignment: Assignment | null; // 镶嵌位置
}

export interface Batch {
  id: string;
  name: string;
  sealed: boolean; // 封存后记录停止修改
  createdAt: string;
}

export interface Order {
  id: string;
  name: string;
}

export interface State {
  gems: Gem[];
  batches: Batch[];
  orders: Order[];
}

export const SIDE_SLOT_LIMIT = 8; // 围石位最多八颗

export const SHAPES = ["圆形", "椭圆", "梨形", "祖母绿切", "公主方", "马眼", "心形", "垫形"];
export const CLARITIES = ["FL", "IF", "VVS", "VS", "SI", "I"];
export const CUTS = ["EX 优", "VG 很好", "G 好", "F 一般"];

export type GemDraft = Omit<Gem, "id" | "batchId" | "assignment" | "defectHandled">;

export interface Conflict {
  kind: "defect" | "main-overflow" | "side-overflow";
  message: string;
  gemId?: string;
  orderId?: string;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export function sizeLabel(gem: Pick<Gem, "lengthMm" | "widthMm">): string {
  return `${gem.lengthMm}×${gem.widthMm}mm`;
}

export function batchOf(state: State, gem: Gem): Batch | undefined {
  return state.batches.find((b) => b.id === gem.batchId);
}

export function isLocked(state: State, gem: Gem): boolean {
  return batchOf(state, gem)?.sealed === true;
}

/** 新增宝石登记校验 */
export function validateGemDraft(state: State, draft: GemDraft, batchId: string): string[] {
  const errors: string[] = [];
  if (!draft.code.trim()) errors.push("宝石编号不能为空");
  if (state.gems.some((g) => g.code === draft.code.trim())) errors.push(`编号 ${draft.code.trim()} 已存在`);
  if (!draft.species.trim()) errors.push("种类不能为空");
  if (!draft.shape) errors.push("请选择形状");
  if (!(draft.carat > 0)) errors.push("克拉重量必须大于 0");
  if (!(draft.lengthMm > 0) || !(draft.widthMm > 0)) errors.push("尺寸长宽必须大于 0");
  if (!batchId) errors.push("每颗宝石必须先归入分拣批次");
  const batch = state.batches.find((b) => b.id === batchId);
  if (batchId && !batch) errors.push("所选批次不存在");
  if (batch?.sealed) errors.push(`批次 ${batch.name} 已封存，不能登记新宝石`);
  return errors;
}

export function addGemToBatch(state: State, draft: GemDraft, batchId: string, id: string): Result<State> {
  const errors = validateGemDraft(state, draft, batchId);
  if (errors.length > 0) return { ok: false, error: errors.join("；") };
  const gem: Gem = {
    ...draft,
    code: draft.code.trim(),
    species: draft.species.trim(),
    id,
    batchId,
    defectHandled: draft.defect.trim() === "",
    assignment: null,
  };
  return { ok: true, value: { ...state, gems: [...state.gems, gem] } };
}

/**
 * 分配宝石到订单位置。
 * 主石位只放一颗；围石位最多八颗；已属其他订单的宝石不能再次分配；
 * 同一订单内允许换位置；已封存批次的记录停止修改。
 */
export function assignGem(
  state: State,
  gemId: string,
  orderId: string,
  slot: "main" | "side",
  slotIndex: number
): Result<State> {
  const gem = state.gems.find((g) => g.id === gemId);
  if (!gem) return { ok: false, error: "宝石不存在" };
  const order = state.orders.find((o) => o.id === orderId);
  if (!order) return { ok: false, error: "订单不存在" };
  const batch = batchOf(state, gem);
  if (batch?.sealed) return { ok: false, error: `批次 ${batch.name} 已封存，记录停止修改` };
  if (gem.assignment && gem.assignment.orderId !== orderId) {
    const other = state.orders.find((o) => o.id === gem.assignment!.orderId);
    return { ok: false, error: `${gem.code} 已属订单 ${other?.name ?? gem.assignment.orderId}，不能再次分配` };
  }

  const siblings = state.gems.filter((g) => g.id !== gemId && g.assignment?.orderId === orderId);
  if (slot === "main") {
    const occupant = siblings.find((g) => g.assignment?.slot === "main");
    if (occupant) return { ok: false, error: `主石位只放一颗，已被 ${occupant.code} 占用` };
  } else {
    if (slotIndex < 0 || slotIndex >= SIDE_SLOT_LIMIT) return { ok: false, error: "围石位编号超出范围" };
    const sideCount = siblings.filter((g) => g.assignment?.slot === "side").length;
    if (sideCount >= SIDE_SLOT_LIMIT) return { ok: false, error: `围石位最多 ${SIDE_SLOT_LIMIT} 颗，已排满` };
    const occupant = siblings.find((g) => g.assignment?.slot === "side" && g.assignment.slotIndex === slotIndex);
    if (occupant) return { ok: false, error: `该围石位已被 ${occupant.code} 占用` };
  }

  const gems = state.gems.map((g) =>
    g.id === gemId ? { ...g, assignment: { orderId, slot, slotIndex: slot === "main" ? 0 : slotIndex } } : g
  );
  return { ok: true, value: { ...state, gems } };
}

export function unassignGem(state: State, gemId: string): Result<State> {
  const gem = state.gems.find((g) => g.id === gemId);
  if (!gem) return { ok: false, error: "宝石不存在" };
  const batch = batchOf(state, gem);
  if (batch?.sealed) return { ok: false, error: `批次 ${batch.name} 已封存，记录停止修改` };
  const gems = state.gems.map((g) => (g.id === gemId ? { ...g, assignment: null } : g));
  return { ok: true, value: { ...state, gems } };
}

export function setDefectHandled(state: State, gemId: string, handled: boolean): Result<State> {
  const gem = state.gems.find((g) => g.id === gemId);
  if (!gem) return { ok: false, error: "宝石不存在" };
  const batch = batchOf(state, gem);
  if (batch?.sealed) return { ok: false, error: `批次 ${batch.name} 已封存，记录停止修改` };
  const gems = state.gems.map((g) => (g.id === gemId ? { ...g, defectHandled: handled } : g));
  return { ok: true, value: { ...state, gems } };
}

/** 批次封存前的冲突检测：未处理缺陷、主石位超额、围石位超额 */
export function batchConflicts(state: State, batchId: string): Conflict[] {
  const gems = state.gems.filter((g) => g.batchId === batchId);
  const conflicts: Conflict[] = [];
  for (const gem of gems) {
    if (gem.defect.trim() !== "" && !gem.defectHandled) {
      conflicts.push({ kind: "defect", gemId: gem.id, message: `${gem.code} 缺陷未处理：${gem.defect}` });
    }
  }
  for (const order of state.orders) {
    const assigned = gems.filter((g) => g.assignment?.orderId === order.id);
    const mains = assigned.filter((g) => g.assignment?.slot === "main");
    if (mains.length > 1) {
      conflicts.push({
        kind: "main-overflow",
        orderId: order.id,
        message: `${order.name} 主石位超额：${mains.length} 颗（只放一颗）—— ${mains.map((g) => g.code).join("、")}`,
      });
    }
    const sides = assigned.filter((g) => g.assignment?.slot === "side");
    if (sides.length > SIDE_SLOT_LIMIT) {
      conflicts.push({
        kind: "side-overflow",
        orderId: order.id,
        message: `${order.name} 围石位超额：${sides.length} 颗（上限 ${SIDE_SLOT_LIMIT} 颗）`,
      });
    }
  }
  return conflicts;
}

/** 封存判定：有冲突则保留原分配、不予封存 */
export function sealBatch(state: State, batchId: string): { ok: true; value: State } | { ok: false; conflicts: Conflict[] } {
  const batch = state.batches.find((b) => b.id === batchId);
  if (!batch) return { ok: false, conflicts: [{ kind: "defect", message: "批次不存在" }] };
  if (batch.sealed) return { ok: false, conflicts: [{ kind: "defect", message: `批次 ${batch.name} 已封存` }] };
  const conflicts = batchConflicts(state, batchId);
  if (conflicts.length > 0) return { ok: false, conflicts };
  return { ok: true, value: { ...state, batches: state.batches.map((b) => (b.id === batchId ? { ...b, sealed: true } : b)) } };
}

/** 订单位置示意：主石位 + 八个围石位的占用情况 */
export function orderSlotMap(state: State, orderId: string): { main: Gem | null; side: (Gem | null)[] } {
  const assigned = state.gems.filter((g) => g.assignment?.orderId === orderId);
  const main = assigned.find((g) => g.assignment?.slot === "main") ?? null;
  const side: (Gem | null)[] = Array.from({ length: SIDE_SLOT_LIMIT }, (_, i) =>
    assigned.find((g) => g.assignment?.slot === "side" && g.assignment.slotIndex === i) ?? null
  );
  return { main, side };
}

/** 可放入某订单位置的宝石：未封存批次，且未分配或已在本订单内 */
export function eligibleGems(state: State, orderId: string): Gem[] {
  return state.gems.filter((g) => {
    if (isLocked(state, g)) return false;
    return g.assignment === null || g.assignment.orderId === orderId;
  });
}
