// 预置三座剧场与灯具清单（初始样例，随时可「恢复预置」）
import type { AppState, CueVersion, Fixture, Venue } from "./types";

let seq = 0;
const fid = (v: string, idx: number) => `${v}-F${String(idx).padStart(2, "0")}`;

function makeFixtures(
  venueId: string,
  rows: Array<[string, string, number, string, string, Fixture["role"]?]>,
): Fixture[] {
  return rows.map(([no, pos, ch, gel, focus, role], i) => ({
    id: fid(venueId, i + 1),
    no,
    pos,
    ch,
    gel,
    focus,
    role: role ?? "常规",
    status: "在用" as const,
    replacedBy: null,
  }));
}

export const VENUE_A = "venue-jingyan";
export const VENUE_B = "venue-pujing";
export const VENUE_C = "venue-zhujiang";

function seedVenues(): Venue[] {
  return [
    {
      id: VENUE_A,
      name: "京演大剧院",
      city: "北京",
      fixtures: makeFixtures(VENUE_A, [
        ["A-FOH-01", "面光", 101, "暖橙 R21", "台口左"],
        ["A-FOH-02", "面光", 102, "暖橙 R21", "台口右"],
        ["A-FOH-03", "面光", 103, "冷蓝 L201", "中区"],
        ["A-FOH-04", "面光", 104, "白光 白光", "中区"],
        ["A-FOH-05", "面光", 105, "冷蓝 L201", "后区"],
        ["A-SR-01", "耳光", 211, "暖橙 R21", "台口左"],
        ["A-SR-02", "耳光", 212, "白光 白光", "台口右"],
        ["A-SL-01", "侧光", 301, "冷蓝 L201", "中区"],
        ["A-SL-02", "侧光", 302, "品红 R49", "中区"],
        ["A-BK-01", "逆光", 401, "暖橙 R21", "后区"],
        ["A-BK-02", "逆光", 402, "冷蓝 L201", "后区"],
        ["A-CYC-1", "天排", 501, "品红 R49", "天幕"],
        ["A-FLR-1", "地排", 511, "冷蓝 L201", "天幕"],
        // 备用灯
        ["A-SP-F1", "面光", 109, "暖橙 R21", "台口左", "备用"],
        ["A-SP-F2", "面光", 110, "冷蓝 L201", "中区", "备用"],
        ["A-SP-S1", "侧光", 309, "冷蓝 L201", "中区", "备用"],
      ]),
    },
    {
      id: VENUE_B,
      name: "浦京剧场",
      city: "上海",
      fixtures: makeFixtures(VENUE_B, [
        ["B-FOH-1", "面光", 11, "暖橙 R21", "台口左"],
        ["B-FOH-2", "面光", 11, "暖橙 R21", "台口右"], // 与 B-FOH-1 同通道：争用隐患
        ["B-FOH-3", "面光", 13, "紫外 UV33", "中区"], // 色片与巡演标准不同
        ["B-FOH-4", "面光", 14, "白光 白光", "中区"],
        ["B-SR-1", "耳光", 21, "暖橙 R21", "台口左"],
        ["B-SR-2", "耳光", 22, "白光 白光", "台口右"],
        ["B-SL-1", "侧光", 31, "冷蓝 L201", "中区"],
        ["B-BK-1", "逆光", 41, "冷蓝 L201", "后区"],
        ["B-CYC1", "天排", 51, "品红 R49", "天幕"],
        ["B-FLR1", "地排", 52, "冷蓝 L201", "天幕"],
        ["B-MV-1", "流动", 61, "暖橙 R21", "上场门"],
        // 备用灯
        ["B-SP-F1", "面光", 19, "暖橙 R21", "台口左", "备用"],
        ["B-SP-M1", "流动", 69, "暖橙 R21", "上场门", "备用"],
      ]),
    },
    {
      id: VENUE_C,
      name: "珠江舞台",
      city: "广州",
      fixtures: makeFixtures(VENUE_C, [
        ["C-FOH-1", "面光", 1, "暖橙 R21", "台口左"],
        ["C-FOH-2", "面光", 2, "暖橙 R21", "台口右"],
        ["C-FOH-3", "面光", 3, "冷蓝 L201", "中区"],
        ["C-FOH-4", "面光", 4, "暖橙 R21", "中区"], // 色片不符隐患
        ["C-SR-1", "耳光", 21, "暖橙 R21", "台口左"],
        ["C-SR-2", "耳光", 22, "白光 白光", "台口右"],
        ["C-SL-1", "侧光", 31, "冷蓝 L201", "中区"],
        ["C-SL-2", "侧光", 32, "品红 R49", "中区"],
        ["C-BK-1", "逆光", 41, "暖橙 R21", "后区"],
        ["C-BK-2", "逆光", 42, "冷蓝 L201", "后区"],
        ["C-CYC1", "天排", 51, "品红 R49", "天幕"],
        ["C-FLR1", "地排", 52, "冷蓝 L201", "天幕"],
        // 无「流动」位灯具与备用
        // 备用灯：面光备用为冷蓝，换 C-FOH-1（暖橙）时会色片不符
        ["C-SP-F1", "面光", 9, "冷蓝 L201", "台口左", "备用"],
        ["C-SP-S1", "侧光", 39, "冷蓝 L201", "中区", "备用"],
      ]),
    },
  ];
}

export interface ImportedCue {
  no: string;
  name: string;
  needs: Array<{ pos: string; gel: string; focus: string; level?: number; note?: string }>;
}

export const SAMPLE_CUES: ImportedCue[] = [
  {
    no: "Q1",
    name: "开场·暖场",
    needs: [
      { pos: "面光", gel: "暖橙 R21", focus: "台口左", level: 80 },
      { pos: "面光", gel: "暖橙 R21", focus: "台口右", level: 80 },
      { pos: "流动", gel: "暖橙 R21", focus: "上场门", level: 60, note: "演员候场区" },
    ],
  },
  {
    no: "Q2",
    name: "冷蓝独白",
    needs: [
      { pos: "面光", gel: "冷蓝 L201", focus: "中区", level: 55 },
      { pos: "侧光", gel: "冷蓝 L201", focus: "中区", level: 40 },
    ],
  },
  {
    no: "Q3",
    name: "双人对望",
    needs: [
      { pos: "面光", gel: "冷蓝 L201", focus: "中区", level: 65 },
      { pos: "面光", gel: "冷蓝 L201", focus: "后区", level: 45 },
      { pos: "逆光", gel: "冷蓝 L201", focus: "后区", level: 50 },
    ],
  },
  {
    no: "Q4",
    name: "谢幕·暖光",
    needs: [
      { pos: "面光", gel: "暖橙 R21", focus: "台口左", level: 90 },
      { pos: "耳光", gel: "暖橙 R21", focus: "台口左", level: 70 },
      { pos: "逆光", gel: "暖橙 R21", focus: "后区", level: 60 },
    ],
  },
];

export const POSITIONS = ["面光", "耳光", "侧光", "逆光", "天排", "地排", "流动"];
export const GELS = ["暖橙 R21", "冷蓝 L201", "品红 R49", "白光 白光", "紫外 UV33"];
export const FOCUSES = ["台口左", "台口右", "中区", "后区", "上场门", "天幕"];

export function sheetKey(venueId: string, versionId: string) {
  return `${venueId}::${versionId}`;
}

export function createInitialState(): AppState {
  const venues = seedVenues();
  const version: CueVersion = {
    id: `ver-${Date.now()}-${(seq += 1)}`,
    label: "v1 巡演首版（预置）",
    importedAt: new Date().toISOString(),
    cues: SAMPLE_CUES.map((c, i) => ({
      id: `cue-${i + 1}`,
      no: c.no,
      name: c.name,
      needs: c.needs.map((n) => ({ ...n })),
    })),
  };
  return {
    tourName: "《夜航船》巡演",
    venues,
    versions: [version],
    sheets: {},
    log: [{ t: new Date().toISOString(), text: "已载入预置剧场与 v1 Cue 版本" }],
  };
}
