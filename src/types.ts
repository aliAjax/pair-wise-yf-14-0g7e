// 巡演灯位映射台：领域模型

/** 剧场灯具（每座剧场编号、通道、备灯都不同） */
export interface Fixture {
  id: string; // 灯具编号，如 BJ-FOH-01
  kind: string; // 灯型
  position: string; // 逻辑灯位（巡演统一口径，如 面光1 / 左耳光）
  channel: string; // 调光通道，如 CH 011
  gel: string; // 色片，如 L201冷蓝
  focus: string[]; // 可打到的焦点
}

export interface Venue {
  id: string;
  name: string;
  city: string;
  note: string; // 本场硬件备注
  fixtures: Fixture[];
}

/** Cue 中的一条用灯需求 */
export interface CueReq {
  position: string;
  gel: string;
  focus: string;
  level?: number; // 亮度预设 %
}

export interface Cue {
  id: string;
  no: string; // Cue 12
  order: number; // 原始顺序，导入后永不改变
  name: string;
  note?: string;
  reqs: CueReq[];
}

/** 一次导入 = 一个不可变 Cue 版本 */
export interface CueVersion {
  id: string;
  label: string;
  sheet: string;
  importedAt: number;
  cues: Cue[];
}

export type MappingStatus = "mapped" | "pending";
export type MappingTrigger = "import" | "swap" | "restore";

export interface ReqResult {
  reqIndex: number;
  fixtureId: string | null; // 主灯
  backupId: string | null; // 备用灯
  channel: string | null;
  reasons: string[]; // 该需求未配好的原因
}

export interface CueMapping {
  cueId: string;
  status: MappingStatus;
  reasons: string[];
  results: ReqResult[];
  computedAt: number;
  trigger: MappingTrigger;
}

export interface HistoryEvent {
  at: number;
  kind: "import" | "swap" | "restore";
  text: string;
  status: MappingStatus;
  payload?: { from: string; to: string; cueIds: string[] };
}

/** 灯具临时状态：停用 + 顶替灯 */
export interface FixtureOverride {
  broken: boolean;
  replacedBy?: string;
}

export interface PersistState {
  versions: CueVersion[];
  selectedVersionId: string | null;
  // venueId -> fixtureId -> override
  overrides: Record<string, Record<string, FixtureOverride>>;
  // venueId -> versionId -> mappings（按 cue.order 排序）
  mappings: Record<string, Record<string, CueMapping[]>>;
  // venueId -> versionId -> cueId -> events
  history: Record<string, Record<string, Record<string, HistoryEvent[]>>>;
}
