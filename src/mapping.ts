import type {
  Cue,
  CueMapping,
  CueReq,
  Fixture,
  FixtureOverride,
  ReqResult,
  Venue,
} from "./types";

export interface ActiveFixture extends Fixture {
  status: "ok" | "broken";
  replacedBy?: string;
}

/** 叠加临时换灯状态，得到本场当前实际可用的灯具 */
export function activeFixtures(
  venue: Venue,
  overrides: Record<string, FixtureOverride>
): ActiveFixture[] {
  return venue.fixtures.map((f) => {
    const ov = overrides[f.id];
    if (!ov) return { ...f, status: "ok" as const };
    return { ...f, status: ov.broken ? ("broken" as const) : ("ok" as const), replacedBy: ov.replacedBy };
  });
}

function describe(req: CueReq) {
  return `${req.position} / ${req.gel} / 焦点${req.focus}`;
}

/**
 * 为一个 Cue 按 位置 → 色片 → 焦点 配灯。
 * 主灯选定后还要校验：Cue 内通道争用、备用灯（不同编号、不同通道、同条件）。
 */
export function mapCue(cue: Cue, fixtures: ActiveFixture[], at: number): CueMapping {
  const usable = fixtures.filter((f) => f.status !== "broken");
  const results: ReqResult[] = [];
  const usedChannels = new Set<string>();
  const cueReasons: string[] = [];

  cue.reqs.forEach((req, reqIndex) => {
    const reasons: string[] = [];
    const atPos = usable.filter((f) => f.position === req.position);

    if (atPos.length === 0) {
      const msg = `需求${reqIndex + 1}（${describe(req)}）：${req.position} 无可用灯具`;
      reasons.push(msg);
      cueReasons.push(msg);
      results.push({ reqIndex, fixtureId: null, backupId: null, channel: null, reasons });
      return;
    }

    const gelOk = atPos.filter((f) => f.gel === req.gel);
    const gelBad = atPos.filter((f) => f.gel !== req.gel);
    if (gelOk.length === 0) {
      const got = Array.from(new Set(gelBad.map((f) => f.gel))).join("、") || "无";
      const msg = `需求${reqIndex + 1}（${describe(req)}）：色片不符，本场只有 ${got}`;
      reasons.push(msg);
      cueReasons.push(msg);
      results.push({ reqIndex, fixtureId: null, backupId: null, channel: null, reasons });
      return;
    }

    const focusOk = gelOk.filter((f) => f.focus.includes(req.focus));
    if (focusOk.length === 0) {
      const msg = `需求${reqIndex + 1}（${describe(req)}）：色片匹配的灯都打不到焦点${req.focus}`;
      reasons.push(msg);
      cueReasons.push(msg);
      results.push({ reqIndex, fixtureId: null, backupId: null, channel: null, reasons });
      return;
    }

    // 主灯：优先挑一个"带备灯"的；通道号小的优先，保证结果稳定可复算
    const withBackup = focusOk
      .map((primary) => ({
        primary,
        backup: focusOk.find(
          (b) =>
            b.id !== primary.id &&
            b.channel !== primary.channel
        ),
      }))
      .sort((a, b) => a.primary.channel.localeCompare(b.primary.channel));

    const best = withBackup.find((x) => x.backup) ?? withBackup[0];
    const primary = best.primary;

    // 同一 Cue 内通道争用
    if (usedChannels.has(primary.channel)) {
      const msg = `需求${reqIndex + 1}（${describe(req)}）：通道 ${primary.channel} 已被本 Cue 另一盏灯争用`;
      reasons.push(msg);
      cueReasons.push(msg);
      results.push({ reqIndex, fixtureId: null, backupId: null, channel: primary.channel, reasons });
      return;
    }
    usedChannels.add(primary.channel);

    if (!best.backup) {
      const msg = `需求${reqIndex + 1}（${describe(req)}）：主灯 ${primary.id}（${primary.channel}）无备用灯`;
      reasons.push(msg);
      cueReasons.push(msg);
      results.push({ reqIndex, fixtureId: primary.id, backupId: null, channel: primary.channel, reasons });
      return;
    }

    results.push({
      reqIndex,
      fixtureId: primary.id,
      backupId: best.backup.id,
      channel: primary.channel,
      reasons: [],
    });
  });

  const status = cueReasons.length === 0 ? "mapped" : "pending";
  return {
    cueId: cue.id,
    status,
    reasons: cueReasons,
    results,
    computedAt: at,
    trigger: "import",
  };
}

/** 导入后整版配灯；按 Cue 原始顺序输出，顺序永不重排 */
export function mapVersion(cues: Cue[], fixtures: ActiveFixture[], at: number): CueMapping[] {
  return [...cues]
    .sort((a, b) => a.order - b.order)
    .map((cue) => mapCue(cue, fixtures, at));
}
