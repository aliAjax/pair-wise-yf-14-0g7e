import type { Cue, CueReq, CueVersion } from "../types";
import { FOCI, GEL_COLORS, POSITIONS } from "./venues";

export interface ParsedSheet {
  version?: Omit<CueVersion, "id" | "importedAt">;
  errors: string[];
}

const posSet = new Set(POSITIONS);
const focusSet = new Set(FOCI);

/** 解析导入的 Cue 表 JSON；原顺序由数组下标决定，不做任何重排 */
export function parseCueSheet(text: string): ParsedSheet {
  const errors: string[] = [];
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { errors: ["JSON 解析失败：" + (e as Error).message] };
  }

  const root = data as {
    label?: unknown;
    sheet?: unknown;
    cues?: unknown;
  };
  if (!data || typeof data !== "object" || !Array.isArray(root.cues)) {
    return { errors: ["文件结构需为 { \"label\"?, \"sheet\"?, \"cues\": [...] }"] };
  }

  const cues: Cue[] = [];
  root.cues.forEach((raw, i) => {
    const row = raw as {
      no?: unknown;
      name?: unknown;
      note?: unknown;
      reqs?: unknown;
    };
    const line = `第 ${i + 1} 个 Cue`;
    if (!raw || typeof raw !== "object") {
      errors.push(`${line}：不是对象`);
      return;
    }
    const no = typeof row.no === "string" ? row.no : `Cue ${String(i + 1).padStart(2, "0")}`;
    const name = typeof row.name === "string" ? row.name : "未命名";
    if (!Array.isArray(row.reqs) || row.reqs.length === 0) {
      errors.push(`${line}（${no} ${name}）：至少需要一条用灯需求 reqs`);
      return;
    }

    const reqs: CueReq[] = [];
    row.reqs.forEach((rRaw, j) => {
      const r = rRaw as { position?: unknown; gel?: unknown; focus?: unknown; level?: unknown };
      const tag = `${line} 需求${j + 1}`;
      if (!r || typeof r !== "object") {
        errors.push(`${tag}：不是对象`);
        return;
      }
      const position = String(r.position ?? "");
      const gel = String(r.gel ?? "");
      const focus = String(r.focus ?? "");
      if (!posSet.has(position)) errors.push(`${tag}：未知灯位「${position}」，可选 ${POSITIONS.join("、")}`);
      if (!(gel in GEL_COLORS)) errors.push(`${tag}：未知色片「${gel}」，可选 ${Object.keys(GEL_COLORS).join("、")}`);
      if (!focusSet.has(focus)) errors.push(`${tag}：未知焦点「${focus}」，可选 ${FOCI.join("、")}`);
      reqs.push({
        position,
        gel,
        focus,
        ...(typeof r.level === "number" ? { level: r.level } : {}),
      });
    });

    if (reqs.length > 0) {
      cues.push({
        id: `cue-${Date.now().toString(36)}-${i}-${Math.random().toString(36).slice(2, 7)}`,
        no,
        order: i,
        name,
        ...(typeof row.note === "string" && row.note ? { note: row.note } : {}),
        reqs,
      });
    }
  });

  if (cues.length === 0) errors.push("没有可导入的有效 Cue");
  if (errors.length > 0) return { errors };

  return {
    version: {
      label: typeof root.label === "string" && root.label ? root.label : `导表 ${new Date().toLocaleString("zh-CN")}`,
      sheet: typeof root.sheet === "string" && root.sheet ? root.sheet : "手工导入",
      cues,
    },
    errors: [],
  };
}

/** 首启预置：v1 巡演 Cue 表 */
export const SAMPLE_V1 = JSON.stringify(
  {
    label: "v1 巡演首版（排练厅定稿）",
    sheet: "tour-cues-v1",
    cues: [
      {
        no: "Cue 12",
        name: "冷蓝开场",
        note: "开幕前 30 秒起",
        reqs: [
          { position: "面光1", gel: "L201冷蓝", focus: "全台", level: 55 },
          { position: "面光2", gel: "L201冷蓝", focus: "全台", level: 55 },
        ],
      },
      {
        no: "Cue 15",
        name: "二幕冷蓝侧光",
        note: "侧光后区铺底 65%",
        reqs: [
          { position: "左吊笼", gel: "L201冷蓝", focus: "后区", level: 65 },
          { position: "右吊笼", gel: "L201冷蓝", focus: "后区", level: 65 },
        ],
      },
      {
        no: "Cue 16",
        name: "侧光交织",
        note: "左吊笼冷蓝与天蓝同时起，注意回路",
        reqs: [
          { position: "左吊笼", gel: "L201冷蓝", focus: "后区", level: 60 },
          { position: "左吊笼", gel: "L019天蓝", focus: "后区", level: 60 },
        ],
      },
      {
        no: "Cue 18",
        name: "独白追光",
        note: "追光跟到门口，需演员走位确认",
        reqs: [
          { position: "追光位", gel: "无", focus: "门口", level: 90 },
          { position: "面光1", gel: "R341暖橙", focus: "表演区A", level: 40 },
        ],
      },
      {
        no: "Cue 21",
        name: "粉场对峙",
        reqs: [
          { position: "左耳光", gel: "L117暖粉", focus: "表演区A", level: 70 },
          { position: "右耳光", gel: "L117暖粉", focus: "门口", level: 70 },
          { position: "追光位", gel: "无", focus: "表演区C", level: 80 },
        ],
      },
      {
        no: "Cue 24",
        name: "暖色谢幕",
        note: "全台面光 80%，版本B",
        reqs: [
          { position: "逆光", gel: "R022深红", focus: "后区", level: 50 },
          { position: "面光2", gel: "R341暖橙", focus: "全台", level: 80 },
          { position: "一顶", gel: "L201冷蓝", focus: "全台", level: 30 },
        ],
      },
    ],
  },
  null,
  2
);

/** 导入框里的示例：v2 修订表（Cue 顺序保持，内容微调） */
export const SAMPLE_V2 = JSON.stringify(
  {
    label: "v2 修订（谢幕加灯）",
    sheet: "tour-cues-v2",
    cues: [
      {
        no: "Cue 12",
        name: "冷蓝开场",
        reqs: [
          { position: "面光1", gel: "L201冷蓝", focus: "全台", level: 60 },
          { position: "面光2", gel: "L201冷蓝", focus: "全台", level: 60 },
        ],
      },
      {
        no: "Cue 15",
        name: "二幕冷蓝侧光",
        reqs: [
          { position: "左吊笼", gel: "L201冷蓝", focus: "后区", level: 65 },
          { position: "右吊笼", gel: "L201冷蓝", focus: "后区", level: 65 },
        ],
      },
      {
        no: "Cue 16",
        name: "侧光交织",
        note: "左吊笼冷蓝与天蓝同时起，注意回路",
        reqs: [
          { position: "左吊笼", gel: "L201冷蓝", focus: "后区", level: 60 },
          { position: "左吊笼", gel: "L019天蓝", focus: "后区", level: 60 },
        ],
      },
      {
        no: "Cue 18",
        name: "独白追光",
        reqs: [
          { position: "追光位", gel: "无", focus: "门口", level: 90 },
          { position: "面光1", gel: "R341暖橙", focus: "表演区A", level: 40 },
        ],
      },
      {
        no: "Cue 21",
        name: "粉场对峙",
        reqs: [
          { position: "左耳光", gel: "L117暖粉", focus: "表演区A", level: 70 },
          { position: "右耳光", gel: "L117暖粉", focus: "门口", level: 70 },
          { position: "追光位", gel: "无", focus: "表演区C", level: 80 },
        ],
      },
      {
        no: "Cue 24",
        name: "暖色谢幕（加二顶）",
        reqs: [
          { position: "逆光", gel: "R022深红", focus: "后区", level: 50 },
          { position: "面光2", gel: "R341暖橙", focus: "全台", level: 80 },
          { position: "一顶", gel: "L201冷蓝", focus: "全台", level: 30 },
          { position: "二顶", gel: "L201冷蓝", focus: "全台", level: 30 },
        ],
      },
    ],
  },
  null,
  2
);
