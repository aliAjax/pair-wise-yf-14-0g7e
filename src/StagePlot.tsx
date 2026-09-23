import { useMemo } from "react";
import type { ActiveFixture } from "./mapping";
import { GEL_COLORS, POSITION_COORDS, POSITION_GROUPS } from "./data/venues";
import type { CueMapping } from "./types";

interface Props {
  fixtures: ActiveFixture[];
  activeMapping?: CueMapping;
  highlightPosition?: string | null;
}

/** 舞台平面灯位图：上方观众席、下方后台；同位置多灯自动错开 */
export function StagePlot({ fixtures, activeMapping, highlightPosition }: Props) {
  // 每个逻辑位置内的编号，用来把同位置的灯上下错开
  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    fixtures.forEach((f) => (m[f.position] = (m[f.position] ?? 0) + 1));
    return m;
  }, [fixtures]);
  const seen: Record<string, number> = {};

  // 正在配灯结果里被引用的灯
  const litIds = new Set<string>();
  activeMapping?.results.forEach((r) => {
    if (r.fixtureId) litIds.add(r.fixtureId);
    if (r.backupId) litIds.add(r.backupId);
  });

  return (
    <div className="stageplot">
      <div className="stage-audience">观众席 / 控台方向</div>
      <div className="stage-box">
        <div className="stage-label">舞台</div>
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="stage-svg">
          <rect x="2" y="2" width="96" height="92" rx="2" className="stage-rect" />
          <line x1="20" y1="20" x2="80" y2="80" className="stage-line" />
          <line x1="80" y1="20" x2="20" y2="80" className="stage-line" />
          {fixtures.map((f) => {
            const base = POSITION_COORDS[f.position] ?? { x: 50, y: 50 };
            const idx = seen[f.position] ?? 0;
            seen[f.position] = idx + 1;
            const n = counts[f.position] ?? 1;
            const offset = (idx - (n - 1) / 2) * 4.2;
            // 面光/耳光沿水平错，其他沿竖直错
            const x = ["面光1", "面光2", "左耳光", "右耳光"].includes(f.position) ? base.x : base.x + offset;
            const y = ["面光1", "面光2", "左耳光", "右耳光"].includes(f.position) ? base.y + offset : base.y;
            const color = GEL_COLORS[f.gel] ?? "#94a3b8";
            const isLit = litIds.has(f.id);
            const dim = f.status === "broken";
            const hot = highlightPosition === f.position;
            return (
              <g key={f.id} className={["dot", dim ? "dot-broken" : "", isLit ? "dot-lit" : "", hot ? "dot-hot" : ""].join(" ")}>
                <circle
                  cx={x}
                  cy={y}
                  r={isLit ? 3.4 : 2.6}
                  fill={dim ? "#475569" : color}
                  stroke={isLit ? "#facc15" : "#0f172a"}
                  strokeWidth={isLit ? 1.1 : 0.5}
                  vectorEffect="non-scaling-stroke"
                />
                {dim && (
                  <text x={x} y={y + 1.6} textAnchor="middle" className="dot-x">
                    ×
                  </text>
                )}
                <title>
                  {f.id} · {f.kind} · {f.position} · {f.channel} · {f.gel}
                  {"\n"}可达焦点：{f.focus.join("、")}
                  {dim ? `\n临时停用 → 顶替 ${f.replacedBy ?? "?"}` : ""}
                </title>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="stage-legend">
        {Object.entries(GEL_COLORS).map(([gel, color]) => (
          <span key={gel}>
            <i style={{ background: color }} />
            {gel}
          </span>
        ))}
        <span className="legend-hint">
          黄圈=当前 Cue 选中（主灯/备灯）；× = 临时停用 · 点击右侧 Cue 查看
        </span>
      </div>
      <div className="stage-groups">
        {POSITION_GROUPS.map((g) => (
          <span key={g.name}>
            {g.name}：{g.positions.join(" / ")}
          </span>
        ))}
      </div>
    </div>
  );
}
