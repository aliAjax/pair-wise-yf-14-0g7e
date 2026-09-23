// 巡演灯位映射台：核心数据模型

/** 灯具角色：常规灯 / 备用灯 */
export type FixtureRole = "常规" | "备用";

/** 灯具当前状态：在用 / 停用（临时换灯时被换出） */
export type FixtureStatus = "在用" | "停用";

/** 剧场灯具清单项 */
export interface Fixture {
  id: string;
  /** 灯具编号，如 A-FOH-01 */
  no: string;
  /** 灯位：面光 / 耳光 / 侧光 / 逆光 / 天排 / 地排 / 流动 */
  pos: string;
  /** 调光台通道号 */
  ch: number;
  /** 色片 */
  gel: string;
  /** 焦点位置 */
  focus: string;
  role: FixtureRole;
  status: FixtureStatus;
  /** 停用期间由哪盏备用灯顶替（存备用灯 id） */
  replacedBy?: string | null;
  /** 用户自行登记的灯具，可删除 */
  custom?: boolean;
}

/** 剧场（巡演站点） */
export interface Venue {
  id: string;
  name: string;
  city: string;
  fixtures: Fixture[];
}

/** Cue 中的一个用灯需求 */
export interface CueNeed {
  pos: string;
  gel: string;
  focus: string;
  /** 亮度预设 % */
  level?: number;
  note?: string;
}

/** 导入的 Cue（导入后只读，顺序不可变） */
export interface Cue {
  id: string;
  no: string;
  name: string;
  needs: CueNeed[];
}

/** Cue 导入版本：只追加，旧版本永不覆盖 */
export interface CueVersion {
  id: string;
  label: string;
  importedAt: string;
  cues: Cue[];
}

/** 留待映射的原因 */
export type ReasonCode = "通道争用" | "色片不符" | "无备用灯";

/** 单个用灯需求的配灯结果 */
export interface NeedResult {
  needIndex: number;
  fixtureId?: string;
  reason?: ReasonCode;
  detail?: string;
  manual?: boolean;
}

/** 一条 Cue 的逐场配灯结果 */
export interface CueMapEntry {
  cueId: string;
  status: "已映射" | "待映射";
  manual?: boolean;
  results: NeedResult[];
}

/** 某剧场 × 某导入版本 的配灯单 */
export interface MappingSheet {
  venueId: string;
  versionId: string;
  entries: Record<string, CueMapEntry>;
}

export interface LogEntry {
  t: string;
  text: string;
}

export interface AppState {
  tourName: string;
  venues: Venue[];
  versions: CueVersion[];
  /** key: `${venueId}::${versionId}` */
  sheets: Record<string, MappingSheet>;
  log: LogEntry[];
}
