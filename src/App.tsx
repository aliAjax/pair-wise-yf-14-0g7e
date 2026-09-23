import { useMemo, useState } from "react";
import "./styles.css";
import type { AppState, Cue, Fixture, MappingSheet, Venue } from "./types";
import {
  FOCUSES,
  GELS,
  POSITIONS,
  SAMPLE_CUES,
  sheetKey,
  type ImportedCue,
} from "./seed";
import {
  effectiveFixtures,
  ensureMappings,
  manualAssign,
  recomputeAffected,
  retryPending,
  sheetStats,
  type EffectiveFixture,
} from "./engine";
import { loadState, resetState, saveState } from "./storage";

function nowText() {
  return new Date().toLocaleString("zh-CN", { hour12: false });
}

function uid(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function usePersistentState() {
  const [state, setState] = useState<AppState>(() => {
    const loaded = loadState();
    // 为所有「剧场 × 版本」确保存在配灯单；已保存的逐场结果原样保留
    let sheets = loaded.sheets;
    for (const v of loaded.versions) sheets = ensureMappings(loaded.venues, v, sheets);
    const ready = { ...loaded, sheets };
    saveState(ready); // 首次打开（含补齐的配灯单）即落盘，重开页面逐场结果仍在
    return ready;
  });

  const update = (updater: (s: AppState) => AppState, log?: string) => {
    setState((s) => {
      const next = updater(s);
      if (log) next.log = [{ t: new Date().toISOString(), text: log }, ...next.log].slice(0, 60);
      saveState(next);
      return next;
    });
  };

  return { state, update };
}

export default function App() {
  const { state, update } = usePersistentState();
  const [venueId, setVenueId] = useState(state.venues[0].id);
  const [versionId, setVersionId] = useState(state.versions[state.versions.length - 1].id);
  const [posFilter, setPosFilter] = useState<string>("全部");
  const [swapFor, setSwapFor] = useState<Fixture | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const venue = state.venues.find((v) => v.id === venueId) as Venue;
  const version = state.versions.find((v) => v.id === versionId) ?? state.versions[state.versions.length - 1];
  const sheet = state.sheets[sheetKey(venue.id, version.id)] as MappingSheet;
  const pool = useMemo(() => effectiveFixtures(venue), [venue]);
  const stats = useMemo(() => sheetStats(sheet.entries), [sheet]);
  const totals = useMemo(() => {
    const all = state.venues.map((v) => sheetStats(state.sheets[sheetKey(v.id, version.id)].entries));
    return {
      mapped: all.reduce((a, b) => a + b.mapped, 0),
      pending: all.reduce((a, b) => a + b.pending, 0),
      total: all.reduce((a, b) => a + b.total, 0),
    };
  }, [state.sheets, state.venues, version.id]);

  const fixtureById = useMemo(() => new Map(pool.map((f) => [f.id, f])), [pool]);

  // —— 导入新版本（只追加，旧版本与原顺序不覆盖）——
  const importVersion = (label: string, imported: ImportedCue[]) => {
    const v = {
      id: uid("ver"),
      label: label.trim() || `导入于 ${nowText()}`,
      importedAt: new Date().toISOString(),
      cues: imported.map((c, i) => ({
        id: uid("cue"),
        no: String(c.no ?? `Q${i + 1}`),
        name: String(c.name ?? "未命名 Cue"),
        needs: c.needs.map((n) => ({ pos: n.pos, gel: n.gel, focus: n.focus, level: n.level, note: n.note })),
      })),
    };
    update(
      (s) => ({
        ...s,
        versions: [...s.versions, v],
        sheets: ensureMappings(s.venues, v, s.sheets),
      }),
      `导入新版本「${v.label}」：${v.cues.length} 条 Cue，已为三座剧场配灯（旧版本保留）`,
    );
    setVersionId(v.id);
  };

  // —— 临时换灯：只重算引用该灯的 Cue ——
  const applySwap = (fixture: Fixture, spareId: string | null) => {
    const affectedIds: string[] = [fixture.id];
    update(
      (s) => ({
        ...s,
        venues: s.venues.map((v) =>
          v.id !== venue.id
            ? v
            : {
                ...v,
                fixtures: v.fixtures.map((f) =>
                  f.id === fixture.id ? { ...f, status: "停用", replacedBy: spareId } : f,
                ),
              },
        ),
      }),
      spareId
        ? `${venue.name}：${fixture.no} 停用，备用灯 ${venue.fixtures.find((f) => f.id === spareId)?.no} 顶上 CH${fixture.ch}`
        : `${venue.name}：${fixture.no} 标记停用（未指派备用灯）`,
    );
    setSwapFor(null);
    // 等待状态落库后，按引用范围局部重算
    queueMicrotask(() => {
      update((s) => {
        const v2 = s.venues.find((x) => x.id === venue.id) as Venue;
        const pool2 = effectiveFixtures(v2);
        const key = sheetKey(venue.id, version.id);
        const oldSheet = s.sheets[key];
        const newSheet = recomputeAffected(oldSheet, version, pool2, affectedIds);
        const affectedNames = version.cues
          .filter((c) => oldSheet.entries[c.id] !== newSheet.entries[c.id])
          .map((c) => c.no);
        return {
          ...s,
          sheets: { ...s.sheets, [key]: newSheet },
          log: [
            {
              t: new Date().toISOString(),
              text: `${venue.name}：仅重算引用 ${fixture.no} 的 Cue（${affectedNames.length ? affectedNames.join("、") : "无结果变化"}），其他剧场未改动`,
            },
            ...s.log,
          ].slice(0, 60),
        };
      });
    });
  };

  // —— 换回：恢复原灯并只重算受影响 Cue ——
  const restoreFixture = (fixture: Fixture) => {
    update(
      (s) => ({
        ...s,
        venues: s.venues.map((v) =>
          v.id !== venue.id
            ? v
            : {
                ...v,
                fixtures: v.fixtures.map((f) =>
                  f.id === fixture.id ? { ...f, status: "在用", replacedBy: null } : f,
                ),
              },
        ),
      }),
      `${venue.name}：${fixture.no} 换回恢复`,
    );
    queueMicrotask(() => {
      update((s) => {
        const v2 = s.venues.find((x) => x.id === venue.id) as Venue;
        const key = sheetKey(venue.id, version.id);
        const newSheet = recomputeAffected(s.sheets[key], version, effectiveFixtures(v2), [fixture.id]);
        return { ...s, sheets: { ...s.sheets, [key]: newSheet } };
      });
    });
  };

  const assignManual = (cue: Cue, needIndex: number, fixtureId: string) => {
    const res = manualAssign(cue, sheet.entries[cue.id], needIndex, fixtureId, pool);
    if (res.error) {
      alert(res.error);
      return;
    }
    update(
      (s) => ({
        ...s,
        sheets: {
          ...s.sheets,
          [sheetKey(venue.id, version.id)]: { ...sheet, entries: { ...sheet.entries, [cue.id]: res.entry } },
        },
      }),
      `${venue.name} ${cue.no}：人工点用灯具（自动结果不再覆盖）`,
    );
  };

  const retryCue = (cue: Cue) => {
    update(
      (s) => {
        const key = sheetKey(venue.id, version.id);
        const sh = s.sheets[key];
        return {
          ...s,
          sheets: { ...s.sheets, [key]: { ...sh, entries: { ...sh.entries, [cue.id]: retryPending(sh.entries[cue.id], cue, pool) } } },
        };
      },
      `${venue.name} ${cue.no}：重新试配待映射需求`,
    );
  };

  const addFixture = (f: Omit<Fixture, "id" | "status" | "replacedBy">) => {
    update(
      (s) => ({
        ...s,
        venues: s.venues.map((v) =>
          v.id === venue.id
            ? { ...v, fixtures: [...v.fixtures, { ...f, id: uid("f"), status: "在用" as const, replacedBy: null, custom: true }] }
            : v,
        ),
      }),
      `${venue.name}：登记灯具 ${f.no}（CH${f.ch}）`,
    );
    setAddOpen(false);
  };

  const deleteFixture = (fixture: Fixture) => {
    update(
      (s) => ({
        ...s,
        venues: s.venues.map((v) =>
          v.id === venue.id ? { ...v, fixtures: v.fixtures.filter((f) => f.id !== fixture.id) } : v,
        ),
      }),
      `${venue.name}：删除自定义灯具 ${fixture.no}`,
    );
    queueMicrotask(() => {
      update((s) => {
        const v2 = s.venues.find((x) => x.id === venue.id) as Venue;
        const pool2 = effectiveFixtures(v2);
        const sheets = { ...s.sheets };
        for (const ver of s.versions) {
          const key = sheetKey(venue.id, ver.id);
          sheets[key] = recomputeAffected(sheets[key], ver, pool2, [fixture.id]);
        }
        return { ...s, sheets };
      });
    });
  };

  const recheckPendingAll = () => {
    update(
      (s) => {
        const key = sheetKey(venue.id, version.id);
        const sh = s.sheets[key];
        const entries = { ...sh.entries };
        for (const cue of version.cues) {
          if (entries[cue.id].status === "待映射") entries[cue.id] = retryPending(entries[cue.id], cue, pool);
        }
        return { ...s, sheets: { ...s.sheets, [key]: { ...sh, entries } } };
      },
      `${venue.name}：按当前灯具清单重新试配全部待映射 Cue（人工点用保留）`,
    );
  };

  const filteredFixtures = venue.fixtures.filter((f) => posFilter === "全部" || f.pos === posFilter);

  return (
    <main className="app dark">
      <header className="topbar">
        <div>
          <p className="eyebrow">TOUR LIGHTING DESK · 巡演灯位映射台</p>
          <h1>
            <input
              className="tour-name"
              value={state.tourName}
              onChange={(e) => update((s) => ({ ...s, tourName: e.target.value }))}
              aria-label="巡演名称"
            />
          </h1>
        </div>
        <div className="top-actions">
          <div className="totals">
            <span><b className="ok">{totals.mapped}</b> 已映射</span>
            <span><b className="warn">{totals.pending}</b> 待映射</span>
            <span className="muted">共 {totals.total} Cue × {state.venues.length} 场</span>
          </div>
          <button
            className="ghost"
            onClick={() => {
              if (confirm("恢复为三座预置剧场与预置 Cue？当前本地修改将被清除。")) {
                const fresh = resetState();
                location.reload();
                void fresh;
              }
            }}
          >
            恢复预置
          </button>
        </div>
      </header>

      {/* 剧场切换 */}
      <nav className="venue-tabs">
        {state.venues.map((v) => {
          const st = sheetStats(state.sheets[sheetKey(v.id, version.id)].entries);
          return (
            <button
              key={v.id}
              className={`venue-tab ${v.id === venue.id ? "active" : ""}`}
              onClick={() => setVenueId(v.id)}
            >
              <span className="vt-city">{v.city}</span>
              <span className="vt-name">{v.name}</span>
              <span className={`vt-badge ${st.pending ? "has-pending" : ""}`}>
                {st.mapped}/{st.total}{st.pending ? ` · 待${st.pending}` : ""}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="layout">
        {/* 左：灯具清单 */}
        <section className="panel fixtures-panel">
          <div className="panel-head">
            <div>
              <h2>{venue.name} · 灯具清单</h2>
              <p className="muted">{venue.fixtures.filter((f) => f.status === "在用").length} 在用 / {venue.fixtures.filter((f) => f.role === "备用").length} 备用 / {venue.fixtures.filter((f) => f.status === "停用").length} 停用</p>
            </div>
            <button className="small" onClick={() => setAddOpen((o) => !o)}>＋登记灯具</button>
          </div>

          {addOpen && <AddFixtureForm onAdd={addFixture} />}

          <div className="chips">
            {["全部", ...POSITIONS].map((p) => (
              <button key={p} className={`chip ${posFilter === p ? "on" : ""}`} onClick={() => setPosFilter(p)}>
                {p}
              </button>
            ))}
          </div>

          <div className="resource-tags">
            <ResourceTag title="可用通道" items={Array.from(new Set(pool.filter((f) => !f.isSpare).map((f) => f.ch))).sort((a, b) => a - b).map((ch) => `CH${ch}`)} />
            <ResourceTag title="色片" items={Array.from(new Set(pool.map((f) => f.gel)))} accent="gel" />
            <ResourceTag title="焦点" items={Array.from(new Set(pool.map((f) => f.focus)))} accent="focus" />
          </div>

          <table className="fx-table">
            <thead>
              <tr><th>编号</th><th>灯位</th><th>通道</th><th>色片</th><th>焦点</th><th>角色/状态</th><th>操作</th></tr>
            </thead>
            <tbody>
              {filteredFixtures.map((f) => {
                const spare = f.replacedBy ? venue.fixtures.find((x) => x.id === f.replacedBy) : undefined;
                return (
                  <tr key={f.id} className={f.status === "停用" ? "down" : ""}>
                    <td className="nowrap">
                      {f.no}
                      {f.custom && <em className="custom-tag">自</em>}
                    </td>
                    <td>{f.pos}</td>
                    <td>CH{f.ch}</td>
                    <td>{f.gel}</td>
                    <td>{f.focus}</td>
                    <td>
                      <span className={`tag ${f.role === "备用" ? "spare" : ""}`}>{f.role}</span>
                      {f.status === "停用" && (
                        <span className="tag down-tag">停用{spare ? ` → ${spare.no}` : "·无备用"}</span>
                      )}
                    </td>
                    <td className="nowrap">
                      {f.status === "在用" ? (
                        <button className="link" onClick={() => setSwapFor(f)}>临时换灯</button>
                      ) : (
                        <button className="link" onClick={() => restoreFixture(f)}>换回</button>
                      )}
                      {f.custom && <button className="link danger" onClick={() => deleteFixture(f)}>删除</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        {/* 右：Cue 映射 */}
        <section className="panel cues-panel">
          <div className="panel-head">
            <div>
              <h2>逐场配灯 · Cue 映射</h2>
              <p className="muted">
                {version.label}（{version.importedAt ? new Date(version.importedAt).toLocaleString("zh-CN", { hour12: false }) : ""}）
              </p>
            </div>
            <div className="cue-stats">
              <span className="pill ok">{stats.mapped} 已映射</span>
              <span className={`pill ${stats.pending ? "warn" : "muted-pill"}`}>{stats.pending} 待映射</span>
              {stats.pending > 0 && <button className="small" onClick={recheckPendingAll}>重配待映射</button>}
            </div>
          </div>

          <div className="cue-list">
            {version.cues.map((cue, cueIdx) => {
              const entry = sheet.entries[cue.id];
              return (
                <article key={cue.id} className={`cue-card ${entry.status === "待映射" ? "pending" : ""}`}>
                  <div className="cue-head">
                    <span className="cue-order">{String(cueIdx + 1).padStart(2, "0")}</span>
                    <div className="cue-title">
                      <h3>{cue.no} · {cue.name}</h3>
                      <span className="muted">原顺序 #{cueIdx + 1}，导入后锁定</span>
                    </div>
                    <span className={`status-badge ${entry.status === "待映射" ? "warn" : "ok"}`}>
                      {entry.status === "待映射" ? "留待映射" : "已映射"}
                    </span>
                    {entry.manual && <span className="tag manual-tag">含人工点用</span>}
                    {entry.status === "待映射" && (
                      <button className="small" onClick={() => retryCue(cue)}>重试本 Cue</button>
                    )}
                  </div>
                  <div className="needs">
                    {cue.needs.map((need, ni) => {
                      const r = entry.results.find((x) => x.needIndex === ni)!;
                      const fx = r.fixtureId ? fixtureById.get(r.fixtureId) : undefined;
                      return (
                        <div key={ni} className={`need ${r.fixtureId ? "" : "unmet"}`}>
                          <div className="need-req">
                            <span className="need-pos">{need.pos}</span>
                            <span className="need-gel">{need.gel}</span>
                            <span className="need-focus">焦点·{need.focus}</span>
                            {need.level != null && <span className="need-level">{need.level}%</span>}
                            {need.note && <span className="muted small-note">{need.note}</span>}
                          </div>
                          <div className="need-arrow">→</div>
                          <div className="need-res">
                            {fx ? (
                              <>
                                <b>{fx.no}</b>
                                <span className="muted">CH{fx.ch} · {fx.gel} · {fx.focus}</span>
                                {fx.isSpare && <span className="tag spare">备用顶替</span>}
                                {r.manual && <span className="tag manual-tag">人工</span>}
                              </>
                            ) : (
                              <span className={`reason tag ${reasonClass(r.reason)}`}>
                                {r.reason}：{r.detail}
                              </span>
                            )}
                          </div>
                          {entry.status === "待映射" && (
                            <ManualPicker cue={cue} needIndex={ni} pool={pool} current={r.fixtureId} onPick={(id) => assignManual(cue, ni, id)} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </div>

      {/* 版本管理与导入 */}
      <section className="panel versions-panel">
        <div className="panel-head">
          <div>
            <h2>Cue 版本（导入只追加，旧版本永不覆盖）</h2>
            <p className="muted">各版本保持导入时的原始 Cue 顺序，逐场配灯结果按「剧场 × 版本」分别保存</p>
          </div>
        </div>
        <div className="version-list">
          {state.versions.map((v) => (
            <button
              key={v.id}
              className={`version-item ${v.id === version.id ? "active" : ""}`}
              onClick={() => setVersionId(v.id)}
            >
              <b>{v.label}</b>
              <span className="muted">{new Date(v.importedAt).toLocaleString("zh-CN", { hour12: false })} · {v.cues.length} Cue</span>
            </button>
          ))}
        </div>
        <ImportBox onImport={importVersion} />
      </section>

      <section className="panel log-panel">
        <h2>操作流水</h2>
        <ul>
          {state.log.map((l, i) => (
            <li key={i}><span className="muted">{new Date(l.t).toLocaleTimeString("zh-CN", { hour12: false })}</span> {l.text}</li>
          ))}
        </ul>
      </section>

      {swapFor && (
        <SwapDialog
          venue={venue}
          fixture={swapFor}
          onCancel={() => setSwapFor(null)}
          onConfirm={(spareId) => applySwap(swapFor, spareId)}
        />
      )}
    </main>
  );
}

function reasonClass(reason?: string) {
  if (reason === "通道争用") return "r-channel";
  if (reason === "色片不符") return "r-gel";
  return "r-spare";
}

function ResourceTag({ title, items, accent }: { title: string; items: string[]; accent?: string }) {
  return (
    <div className="res-group">
      <small>{title}</small>
      <div className="res-items">
        {items.length === 0 && <span className="muted">无</span>}
        {items.map((it) => (
          <span key={it} className={`res-tag ${accent ?? ""}`}>{it}</span>
        ))}
      </div>
    </div>
  );
}

function ManualPicker({
  cue,
  needIndex,
  pool,
  current,
  onPick,
}: {
  cue: Cue;
  needIndex: number;
  pool: EffectiveFixture[];
  current?: string;
  onPick: (id: string) => void;
}) {
  const [value, setValue] = useState("");
  void cue;
  return (
    <div className="manual-pick">
      <select value={value} onChange={(e) => setValue(e.target.value)}>
        <option value="">人工选灯…</option>
        {pool.map((f) => (
          <option key={f.id} value={f.id} disabled={f.id === current}>
            {f.no}｜{f.pos}｜CH{f.ch}｜{f.gel}｜{f.focus}{f.isSpare ? "｜备用" : ""}
          </option>
        ))}
      </select>
      <button className="small primary" disabled={!value} onClick={() => value && onPick(value)}>点用</button>
    </div>
  );
}

function SwapDialog({
  venue,
  fixture,
  onCancel,
  onConfirm,
}: {
  venue: Venue;
  fixture: Fixture;
  onCancel: () => void;
  onConfirm: (spareId: string | null) => void;
}) {
  const committed = new Set(
    venue.fixtures.filter((f) => f.status === "停用" && f.replacedBy).map((f) => f.replacedBy),
  );
  const spares = venue.fixtures.filter((f) => f.role === "备用" && f.status === "在用" && !committed.has(f.id));
  const samePos = spares.filter((f) => f.pos === fixture.pos);
  const [chosen, setChosen] = useState<string>("__none__");

  return (
    <div className="modal-mask" onClick={onCancel}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h2>临时换灯 · {fixture.no}</h2>
        <p className="muted">
          {fixture.pos} · CH{fixture.ch} · {fixture.gel} · 焦点{fixture.focus}
          <br />换灯后只重算引用这盏灯的 Cue，其他剧场照常保留；备用灯顶上 CH{fixture.ch}，色片以备用灯实际色片为准。
        </p>
        <div className="spare-options">
          <label className={`spare-opt ${chosen === "__none__" ? "on" : ""}`}>
            <input type="radio" name="spare" value="__none__" checked={chosen === "__none__"} onChange={() => setChosen("__none__")} />
            <span>无备用灯（标记停用，引用 Cue 将留待映射）</span>
          </label>
          {samePos.length === 0 && <p className="warn-text">本场没有同灯位「{fixture.pos}」的空闲备用灯。</p>}
          {spares.map((s) => (
            <label key={s.id} className={`spare-opt ${chosen === s.id ? "on" : ""} ${s.pos !== fixture.pos ? "cross-pos" : ""}`}>
              <input type="radio" name="spare" value={s.id} checked={chosen === s.id} onChange={() => setChosen(s.id)} />
              <span>
                <b>{s.no}</b>（{s.pos}·CH{s.ch}）{s.gel} · 焦点{s.focus}
                {s.pos !== fixture.pos && <em className="warn-text"> 跨灯位</em>}
                {s.gel !== fixture.gel && <em className="warn-text"> 色片与原灯不同</em>}
              </span>
            </label>
          ))}
        </div>
        <div className="modal-actions">
          <button onClick={onCancel}>取消</button>
          <button className="primary" onClick={() => onConfirm(chosen === "__none__" ? null : chosen)}>确认换灯并重算</button>
        </div>
      </div>
    </div>
  );
}

function AddFixtureForm({ onAdd }: { onAdd: (f: Omit<Fixture, "id" | "status" | "replacedBy">) => void }) {
  const [no, setNo] = useState("");
  const [pos, setPos] = useState(POSITIONS[0]);
  const [ch, setCh] = useState(1);
  const [gel, setGel] = useState(GELS[0]);
  const [focus, setFocus] = useState(FOCUSES[0]);
  const [role, setRole] = useState<Fixture["role"]>("常规");
  return (
    <div className="add-form">
      <input placeholder="灯具编号，如 A-FOH-06" value={no} onChange={(e) => setNo(e.target.value)} />
      <select value={pos} onChange={(e) => setPos(e.target.value)}>{POSITIONS.map((p) => <option key={p}>{p}</option>)}</select>
      <input type="number" min={1} value={ch} onChange={(e) => setCh(Number(e.target.value))} aria-label="通道号" />
      <select value={gel} onChange={(e) => setGel(e.target.value)}>{GELS.map((g) => <option key={g}>{g}</option>)}</select>
      <select value={focus} onChange={(e) => setFocus(e.target.value)}>{FOCUSES.map((f) => <option key={f}>{f}</option>)}</select>
      <select value={role} onChange={(e) => setRole(e.target.value as Fixture["role"])}>
        <option>常规</option>
        <option>备用</option>
      </select>
      <button
        className="primary small"
        disabled={!no.trim()}
        onClick={() => onAdd({ no: no.trim(), pos, ch, gel, focus, role })}
      >
        保存
      </button>
    </div>
  );
}

function ImportBox({ onImport }: { onImport: (label: string, cues: ImportedCue[]) => void }) {
  const [text, setText] = useState("");
  const [label, setLabel] = useState("");
  const [err, setErr] = useState("");

  const doImport = () => {
    try {
      const data = JSON.parse(text);
      const list: ImportedCue[] = Array.isArray(data) ? data : data.cues;
      if (!Array.isArray(list) || list.length === 0) throw new Error("需为 Cue 数组或 { cues: [...] }");
      for (const c of list) {
        if (!c.no || !c.name || !Array.isArray(c.needs)) throw new Error(`Cue ${c.no ?? "?"} 字段不完整`);
        for (const n of c.needs) {
          if (!n.pos || !n.gel || !n.focus) throw new Error(`Cue ${c.no} 存在缺少位置/色片/焦点的需求`);
        }
      }
      onImport(label, list);
      setText("");
      setLabel("");
      setErr("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "JSON 解析失败");
    }
  };

  return (
    <div className="import-box">
      <div className="import-head">
        <h3>导入 Cue（新版本）</h3>
        <button
          className="small ghost"
          onClick={() => {
            setText(JSON.stringify(SAMPLE_CUES, null, 2));
            setLabel("v2 试导入副本");
            setErr("");
          }}
        >
          填入示例
        </button>
      </div>
      <input
        placeholder="版本备注，如：v2 联排修订 0923"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
      />
      <textarea
        rows={7}
        placeholder='[{"no":"Q1","name":"开场","needs":[{"pos":"面光","gel":"冷蓝 L201","focus":"中区","level":60}]}]'
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {err && <p className="warn-text">{err}</p>}
      <button className="primary" disabled={!text.trim()} onClick={doImport}>导入为新版本（不覆盖旧版）</button>
    </div>
  );
}
