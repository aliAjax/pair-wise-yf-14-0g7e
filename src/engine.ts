// 配灯引擎：生效灯具、自动配灯、人工配灯、临时换灯重算
import type {
  Cue,
  CueMapEntry,
  CueVersion,
  Fixture,
  MappingSheet,
  NeedResult,
  ReasonCode,
  Venue,
} from "./types";
import { sheetKey } from "./seed";

/** 换灯后实际生效的灯位：停用灯由备用灯顶替（占用原通道，色片/焦点以备用灯为准） */
export interface EffectiveFixture {
  /** 配灯结果按通道位身份记录：被顶替时沿用原灯具 id */
  id: string;
  no: string;
  pos: string;
  ch: number;
  gel: string;
  focus: string;
  role: Fixture["role"];
  /** 顶替中原灯的编号（仅换灯时存在） */
  replacedNo?: string;
  /** 实际亮灯的备用灯 id */
  spareId?: string;
  isSpare?: boolean;
}

export function effectiveFixtures(venue: Venue): EffectiveFixture[] {
  const byId = new Map(venue.fixtures.map((f) => [f.id, f]));
  const committedSpares = new Set<string>();
  venue.fixtures.forEach((f) => {
    if (f.status === "停用" && f.replacedBy) committedSpares.add(f.replacedBy);
  });

  const out: EffectiveFixture[] = [];
  for (const f of venue.fixtures) {
    if (f.status === "停用") {
      const spare = f.replacedBy ? byId.get(f.replacedBy) : undefined;
      if (spare) {
        out.push({
          id: f.id,
          no: spare.no,
          pos: f.pos,
          ch: f.ch, // 备用灯顶上原通道
          gel: spare.gel, // 色片来不及换，以备用灯实际色片判定
          focus: spare.focus,
          role: "备用",
          replacedNo: f.no,
          spareId: spare.id,
          isSpare: true,
        });
      }
      continue; // 停用灯本身不再可用
    }
    if (committedSpares.has(f.id)) continue; // 已被调去顶替的备用灯不能再被别处点用
    out.push({
      id: f.id,
      no: f.no,
      pos: f.pos,
      ch: f.ch,
      gel: f.gel,
      focus: f.focus,
      role: f.role,
      isSpare: f.role === "备用",
    });
  }
  return out;
}

function failureReason(
  cue: Cue,
  need: Cue["needs"][number],
  pool: EffectiveFixture[],
  usedChannels: Set<number>,
): { reason: ReasonCode; detail: string } {
  const samePos = pool.filter((f) => f.pos === need.pos);
  if (samePos.length === 0) {
    return { reason: "无备用灯", detail: `本场没有「${need.pos}」灯具或备用灯` };
  }
  const sameGel = samePos.filter((f) => f.gel === need.gel);
  const sameFocus = samePos.filter((f) => f.focus === need.focus);
  // 焦点位上有灯，但该位的灯色片都不对（典型：换上来的备用灯没换色片）
  if (sameFocus.length > 0 && sameFocus.every((f) => f.gel !== need.gel)) {
    const have = Array.from(new Set(sameFocus.map((f) => f.gel))).join("、");
    return {
      reason: "色片不符",
      detail: `「${need.pos}·焦点${need.focus}」需 ${need.gel}，该灯位在场色片为：${have}`,
    };
  }
  if (sameGel.length === 0) {
    const have = Array.from(new Set(samePos.map((f) => f.gel))).join("、");
    return { reason: "色片不符", detail: `「${need.pos}」需 ${need.gel}，本场仅有：${have}` };
  }
  if (sameGel.every((f) => f.focus !== need.focus)) {
    const haveFocus = Array.from(new Set(sameGel.map((f) => f.focus))).join("、");
    return {
      reason: "无备用灯",
      detail: `「${need.pos}·${need.gel}」无焦点「${need.focus}」的可用灯（含备用），现有焦点：${haveFocus}`,
    };
  }
  const free = sameFocus.filter((f) => !usedChannels.has(f.ch));
  if (free.length === 0) {
    return {
      reason: "通道争用",
      detail: `「${need.pos}·${need.focus}」匹配灯具的通道已被本 Cue 前序需求占用（CH${sameFocus[0].ch}）`,
    };
  }
  return { reason: "无备用灯", detail: "无可用灯具" };
}

/** 常规灯优先、备用灯兜底，同优先级按通道号排序 */
function pickFixture(
  need: Cue["needs"][number],
  pool: EffectiveFixture[],
  usedChannels: Set<number>,
): EffectiveFixture | undefined {
  const exact = pool
    .filter(
      (f) => f.pos === need.pos && f.gel === need.gel && f.focus === need.focus && !usedChannels.has(f.ch),
    )
    .sort((a, b) => Number(a.isSpare) - Number(b.isSpare) || a.ch - b.ch);
  return exact[0];
}

export function autoMapCue(cue: Cue, pool: EffectiveFixture[]): CueMapEntry {
  const usedChannels = new Set<number>();
  const results: NeedResult[] = cue.needs.map((need, needIndex) => {
    const picked = pickFixture(need, pool, usedChannels);
    if (!picked) {
      const fail = failureReason(cue, need, pool, usedChannels);
      return { needIndex, ...fail };
    }
    usedChannels.add(picked.ch);
    return {
      needIndex,
      fixtureId: picked.id,
      ...(picked.isSpare ? { detail: `备用灯 ${picked.no}${picked.replacedNo ? ` 顶替 ${picked.replacedNo}` : ""} 兜底` } : {}),
    };
  });
  return {
    cueId: cue.id,
    status: results.every((r) => r.fixtureId) ? "已映射" : "待映射",
    results,
  };
}

/** 为某版本在所有剧场建/补配灯单（新版本：全量自动；已存在的人工配灯保留） */
export function ensureMappings(
  venues: Venue[],
  version: CueVersion,
  existing: Record<string, MappingSheet>,
): Record<string, MappingSheet> {
  const next = { ...existing };
  for (const venue of venues) {
    const key = sheetKey(venue.id, version.id);
    const pool = effectiveFixtures(venue);
    const old = next[key];
    const entries: Record<string, CueMapEntry> = {};
    for (const cue of version.cues) {
      const oldEntry = old?.entries[cue.id];
      // 已有结果一律保留（页面重开看到的就是上次逐场配灯结果），仅为新 Cue 自动配灯
      entries[cue.id] = oldEntry ?? autoMapCue(cue, pool);
    }
    next[key] = { venueId: venue.id, versionId: version.id, entries };
  }
  return next;
}

/** 重算时保留仍然有效的人工点用 */
function mergeManual(cue: Cue, old: CueMapEntry, pool: EffectiveFixture[]): CueMapEntry {
  const byId = new Map(pool.map((f) => [f.id, f]));
  const usedChannels = new Set<number>();
  const results: NeedResult[] = cue.needs.map((need, i) => {
    const prev = old.results.find((r) => r.needIndex === i);
    if (prev?.manual && prev.fixtureId) {
      const fx = byId.get(prev.fixtureId);
      if (fx && !usedChannels.has(fx.ch)) {
        usedChannels.add(fx.ch);
        return { ...prev };
      }
    }
    return null as unknown as NeedResult;
  });

  // 非人工需求按顺序自动配（已被人工占用的通道会避开）
  cue.needs.forEach((need, i) => {
    if (results[i]) return;
    const picked = pickFixture(need, pool, usedChannels);
    if (!picked) {
      const fail = failureReason(cue, need, pool, usedChannels);
      results[i] = { needIndex: i, ...fail };
    } else {
      usedChannels.add(picked.ch);
      results[i] = {
        needIndex: i,
        fixtureId: picked.id,
        ...(picked.isSpare ? { detail: `备用灯 ${picked.no} 兜底` } : {}),
      };
    }
  });

  const manual = results.some((r) => r.manual);
  return {
    cueId: cue.id,
    status: results.every((r) => r.fixtureId) ? "已映射" : "待映射",
    ...(manual ? { manual: true } : {}),
    results,
  };
}

/** 人工指定灯具（同一 Cue 内通道不可重复点用） */
export function manualAssign(
  cue: Cue,
  entry: CueMapEntry,
  needIndex: number,
  fixtureId: string,
  pool: EffectiveFixture[],
): { entry: CueMapEntry; error?: string } {
  const fx = pool.find((f) => f.id === fixtureId);
  if (!fx) return { entry, error: "灯具已不可用" };
  const clash = entry.results.find(
    (r) => r.needIndex !== needIndex && r.fixtureId && pool.find((p) => p.id === r.fixtureId)?.ch === fx.ch,
  );
  if (clash) {
    return { entry, error: `CH${fx.ch} 已被本 Cue 第 ${clash.needIndex + 1} 个需求点用` };
  }
  const results = entry.results.map((r) =>
    r.needIndex === needIndex
      ? {
          needIndex,
          fixtureId,
          manual: true,
          ...(fx.isSpare ? { detail: `人工点用备用灯 ${fx.no}` } : {}),
        }
      : r,
  );
  return {
    entry: {
      cueId: cue.id,
      status: results.every((r) => r.fixtureId) ? "已映射" : "待映射",
      manual: true,
      results,
    },
  };
}

/** 仅重算某剧场中引用指定灯具（或换灯影响通道）的 Cue；其他 Cue、其他剧场不动 */
export function recomputeAffected(
  sheet: MappingSheet,
  version: CueVersion,
  pool: EffectiveFixture[],
  affectedFixtureIds: string[],
): MappingSheet {
  const affected = new Set(affectedFixtureIds);
  const entries = { ...sheet.entries };
  for (const cue of version.cues) {
    const old = entries[cue.id];
    if (!old) continue;
    const touches = old.results.some((r) => r.fixtureId && affected.has(r.fixtureId));
    if (!touches) continue; // 未引用这盏灯的 Cue 原结果保留
    entries[cue.id] = mergeManual(cue, old, pool);
  }
  return { ...sheet, entries };
}

/** 只重新自动配仍然待映射的需求（人工结果一律保留） */
export function retryPending(entry: CueMapEntry, cue: Cue, pool: EffectiveFixture[]): CueMapEntry {
  return mergeManual(cue, entry, pool);
}

export function sheetStats(entries: Record<string, CueMapEntry>) {
  const list = Object.values(entries);
  return {
    total: list.length,
    mapped: list.filter((e) => e.status === "已映射").length,
    pending: list.filter((e) => e.status === "待映射").length,
  };
}
