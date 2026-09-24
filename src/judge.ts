// 判定层：领域类型 + 纯业务规则（不依赖 React / 存储）

export const SHAPES = ["圆形", "椭圆", "梨形", "祖母绿切", "心形", "马眼形"] as const;
export type Shape = (typeof SHAPES)[number];

export const CLARITIES = ["", "FL", "IF", "VVS1", "VVS2", "VS1", "VS2", "SI1", "SI2", "I1"] as const;
export const CLARITY_LABEL: Record<string, string> = { "": "未检" };

export const CUTS = ["", "EX", "VG", "G", "F", "P"] as const;

/** 围石位上限 */
export const MAX_ACCENTS = 8;
/** 镶嵌位置：主石位或围石位编号 1..8 */
export type Slot = "main" | number;

export interface Gem {
  code: string; // 编号
  species: string; // 种类
  shape: Shape; // 形状
  carat: number; // 克拉重量
  lengthMm: number; // 尺寸 长 mm
  widthMm: number; // 尺寸 宽 mm
  clarity: string; // 净度
  color: string; // 颜色
  cut: string; // 切工
  defectNote: string; // 缺陷说明
  defectHandled: boolean; // 缺陷是否已处理
  batchId: string; // 所属分拣批次
  orderId?: string; // 已分配订单
  slot?: Slot; // 主石位 / 围石位编号
  createdAt: number;
}

export interface Batch {
  id: string;
  name: string;
  sealed: boolean; // 封存后记录停止修改
  createdAt: number;
  sealedAt?: number;
}

export interface Order {
  id: string;
  name: string;
  createdAt: number;
}

export interface SortingState {
  batches: Batch[];
  orders: Order[];
  gems: Gem[];
  activeBatchId: string;
  activeOrderId: string;
}

export interface GemForm {
  code: string;
  species: string;
  shape: string;
  carat: string;
  lengthMm: string;
  widthMm: string;
  clarity: string;
  color: string;
  cut: string;
  defectNote: string;
}

export const EMPTY_GEM_FORM: GemForm = {
  code: "",
  species: "",
  shape: "",
  carat: "",
  lengthMm: "",
  widthMm: "",
  clarity: "",
  color: "",
  cut: "",
  defectNote: "",
};

export type GemInput = Omit<Gem, "defectHandled" | "batchId" | "orderId" | "slot" | "createdAt">;

export interface Result {
  ok: boolean;
  error?: string;
}

export type ConflictKind = "defect" | "overflow";
export interface Conflict {
  kind: ConflictKind;
  code?: string;
  message: string;
}

export interface GemFilter {
  shape: string; // "" = 全部
  keyword: string;
  minSize: string;
  maxSize: string;
  unassignedOnly: boolean;
}

// ---------- 基础查询 ----------

export const findGem = (s: SortingState, code: string) =>
  s.gems.find((g) => g.code === code);

export const findBatch = (s: SortingState, id: string) =>
  s.batches.find((b) => b.id === id);

export const findOrder = (s: SortingState, id: string) =>
  s.orders.find((o) => o.id === id);

export const gemsOfBatch = (s: SortingState, batchId: string) =>
  s.gems.filter((g) => g.batchId === batchId);

export const isAssigned = (g: Gem) => g.orderId !== undefined;

export const isBatchSealed = (s: SortingState, batchId: string) =>
  findBatch(s, batchId)?.sealed ?? false;

/** 尺寸取长边，供尺寸筛选 */
export const longEdge = (g: Pick<Gem, "lengthMm" | "widthMm">) =>
  Math.max(g.lengthMm, g.widthMm);

export const slotLabel = (slot: Slot): string =>
  slot === "main" ? "主石位" : `围石${slot}位`;

/** 订单各位置当前占用：主石一颗 + 围石八颗 */
export function orderLanes(s: SortingState, orderId: string) {
  const main = s.gems.find((g) => g.orderId === orderId && g.slot === "main") ?? null;
  const accents: (Gem | null)[] = Array.from({ length: MAX_ACCENTS }, (_, i) =>
    s.gems.find((g) => g.orderId === orderId && g.slot === i + 1) ?? null,
  );
  return { main, accents };
}

export const firstFreeAccent = (s: SortingState, orderId: string): number | null => {
  const idx = orderLanes(s, orderId).accents.findIndex((g) => g === null);
  return idx === -1 ? null : idx + 1;
};

// ---------- 登记校验 ----------

export function validateGem(
  s: SortingState,
  batchId: string,
  form: GemForm,
  editingCode?: string,
): { ok: true; input: GemInput } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const batch = findBatch(s, batchId);
  if (!batch) errors.push("请先选择分拣批次");
  else if (batch.sealed) errors.push("批次已封存，不能再登记宝石");

  const code = form.code.trim();
  if (!code) errors.push("编号不能为空");
  else if (s.gems.some((g) => g.code === code && g.code !== editingCode))
    errors.push(`编号 ${code} 已存在`);

  if (!form.species.trim()) errors.push("种类不能为空");
  if (!form.shape || !(SHAPES as readonly string[]).includes(form.shape))
    errors.push("请选择形状");

  const carat = Number(form.carat);
  const lengthMm = Number(form.lengthMm);
  const widthMm = Number(form.widthMm);
  if (!(carat > 0)) errors.push("克拉重量需为大于 0 的数字");
  if (!(lengthMm > 0)) errors.push("尺寸（长）需为大于 0 的数字");
  if (!(widthMm > 0)) errors.push("尺寸（宽）需为大于 0 的数字");

  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    input: {
      code,
      species: form.species.trim(),
      shape: form.shape as Shape,
      carat: Number(carat.toFixed(3)),
      lengthMm: Number(lengthMm.toFixed(2)),
      widthMm: Number(widthMm.toFixed(2)),
      clarity: form.clarity,
      color: form.color.trim(),
      cut: form.cut,
      defectNote: form.defectNote.trim(),
    },
  };
}

// ---------- 分配判定 ----------

export type AssignResult = { ok: true } | { ok: false; error: string };

/**
 * 分配规则：
 * - 封存批次的宝石停止修改
 * - 已属其他订单的宝石不能再次分配
 * - 主石位只放一颗
 * - 围石位最多八颗，逐位占用
 */
export function canAssign(
  s: SortingState,
  code: string,
  orderId: string,
  slot: Slot,
): AssignResult {
  const g = findGem(s, code);
  if (!g) return { ok: false, error: "宝石记录不存在" };
  if (!findOrder(s, orderId)) return { ok: false, error: "订单不存在" };
  if (isBatchSealed(s, g.batchId))
    return { ok: false, error: "宝石所在批次已封存，不能调整位置" };
  if (g.orderId && g.orderId !== orderId) {
    const other = findOrder(s, g.orderId)?.name ?? g.orderId;
    return { ok: false, error: `${code} 已属订单「${other}」，不能再次分配` };
  }

  const lanes = orderLanes(s, orderId);
  if (slot === "main") {
    if (lanes.main && lanes.main.code !== code)
      return { ok: false, error: "主石位只能放一颗，当前已被占用" };
    return { ok: true };
  }

  if (!Number.isInteger(slot) || slot < 1 || slot > MAX_ACCENTS)
    return { ok: false, error: "围石位编号无效" };
  const occupant = lanes.accents[slot - 1];
  if (occupant && occupant.code !== code)
    return { ok: false, error: `围石${slot}位已被 ${occupant.code} 占用` };
  return { ok: true };
}

// ---------- 封存冲突判定 ----------

/**
 * 封存前置检查：只要还有未处理缺陷或位置超额，就逐条列出冲突。
 * 存在冲突时调用方必须保留原分配、不得封存。
 */
export function sealingConflicts(s: SortingState, batchId: string): Conflict[] {
  const conflicts: Conflict[] = [];
  const gems = gemsOfBatch(s, batchId);

  // 未处理缺陷
  for (const g of gems) {
    if (g.defectNote.trim() !== "" && !g.defectHandled) {
      conflicts.push({
        kind: "defect",
        code: g.code,
        message: `${g.code} 缺陷未处理：${g.defectNote}`,
      });
    }
  }

  // 位置超额：主石多于一颗 / 围石超过八颗（正常分配不会触发，封存前兜底校验）
  const byOrder = new Map<string, Gem[]>();
  for (const g of gems) {
    if (!g.orderId) continue;
    const list = byOrder.get(g.orderId) ?? [];
    list.push(g);
    byOrder.set(g.orderId, list);
  }
  for (const [orderId, list] of byOrder) {
    const mainCount = list.filter((g) => g.slot === "main").length;
    const accentCount = list.filter((g) => typeof g.slot === "number").length;
    const orderName = findOrder(s, orderId)?.name ?? orderId;
    if (mainCount > 1)
      conflicts.push({
        kind: "overflow",
        message: `订单「${orderName}」主石位有 ${mainCount} 颗，超出上限 1 颗`,
      });
    if (accentCount > MAX_ACCENTS)
      conflicts.push({
        kind: "overflow",
        message: `订单「${orderName}」围石位有 ${accentCount} 颗，超出上限 ${MAX_ACCENTS} 颗`,
      });
  }

  return conflicts;
}

// ---------- 尺寸筛选 ----------

export function filterGems(gems: Gem[], f: GemFilter): Gem[] {
  const kw = f.keyword.trim().toLowerCase();
  const min = f.minSize === "" ? -Infinity : Number(f.minSize);
  const max = f.maxSize === "" ? Infinity : Number(f.maxSize);
  return gems.filter((g) => {
    if (f.shape && g.shape !== f.shape) return false;
    if (f.unassignedOnly && isAssigned(g)) return false;
    const edge = longEdge(g);
    if (!(edge >= min && edge <= max)) return false;
    if (kw) {
      const hay = `${g.code} ${g.species} ${g.color}`.toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    return true;
  });
}
