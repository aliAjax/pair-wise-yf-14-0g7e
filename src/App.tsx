import { useEffect, useMemo, useState } from "react";
import "./styles.css";
import { VENUES, POSITION_GROUPS, GEL_COLORS } from "./data/venues";
import { parseCueSheet, SAMPLE_V1, SAMPLE_V2 } from "./data/cueSheet";
import { activeFixtures, mapCue, mapVersion, type ActiveFixture } from "./mapping";
import { emptyState, formatTime, loadState, saveState } from "./storage";
import type {
  Cue,
  CueMapping,
  CueVersion,
  HistoryEvent,
  PersistState,
} from "./types";
import { StagePlot } from "./StagePlot";

const clone = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

function ensureVenueVersion(state: PersistState, venueId: string, versionId: string) {
  state.mappings[venueId] ??= {};
  state.history[venueId] ??= {};
  state.mappings[venueId][versionId] ??= [];
  state.history[venueId][versionId] ??= {};
}

function pushHistory(
  state: PersistState,
  venueId: string,
  versionId: string,
  cueId: string,
  event: HistoryEvent
) {
  ensureVenueVersion(state, venueId, versionId);
  state.history[venueId][versionId][cueId] ??= [];
  state.history[venueId][versionId][cueId].unshift(event);
}

/** 导入（或首启预置）一个不可变 Cue 版本，并在三座剧场各自整版配灯 */
function importVersion(
  state: PersistState,
  base: Omit<CueVersion, "id" | "importedAt">
): PersistState {
  const next = clone(state);
  const now = Date.now();
  const version: CueVersion = {
    ...(base as Omit<CueVersion, "id" | "importedAt">),
    id: `ver-${now.toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    importedAt: now,
  };
  next.versions.push(version);
  next.selectedVersionId = version.id;

  for (const venue of VENUES) {
    ensureVenueVersion(next, venue.id, version.id);
    const fixtures = activeFixtures(venue, next.overrides[venue.id] ?? {});
    const mappings = mapVersion(version.cues, fixtures, now);
    next.mappings[venue.id][version.id] = mappings;
    for (const m of mappings) {
      pushHistory(next, venue.id, version.id, m.cueId, {
        at: now,
        kind: "import",
        text: `随「${version.label}」导入整版配灯：${m.status === "mapped" ? "全部需求已配好" : `${m.reasons.length} 项留待映射`}`,
        status: m.status,
      });
    }
  }
  return next;
}

function App() {
  const [state, setState] = useState<PersistState>(() => {
    const loaded = loadState();
    // 首启：预置 v1 巡演 Cue 表并在三场完成首轮配灯
    if (loaded.versions.length === 0) {
      const parsed = parseCueSheet(SAMPLE_V1);
      if (parsed.version) return importVersion(emptyState(), parsed.version);
    }
    return loaded;
  });
  const [venueId, setVenueId] = useState(VENUES[0].id);
  const [groupFilter, setGroupFilter] = useState<string>("全部");
  const [selectedCueId, setSelectedCueId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState(SAMPLE_V2);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [swapFor, setSwapFor] = useState<string | null>(null);
  const [swapTo, setSwapTo] = useState<string>("");
  const [openHistory, setOpenHistory] = useState<Record<string, boolean>>({});

  // 持久化：重开页面仍能看到逐场配灯结果与临时状态
  useEffect(() => {
    saveState(state);
  }, [state]);

  const venue = VENUES.find((v) => v.id === venueId)!;
  const version =
    state.versions.find((v) => v.id === state.selectedVersionId) ??
    state.versions[state.versions.length - 1] ??
    null;

  const fixtures = useMemo<ActiveFixture[]>(
    () => activeFixtures(venue, state.overrides[venue.id] ?? {}),
    [venue, state.overrides]
  );
  const fixtureById = useMemo(() => {
    const m = new Map<string, ActiveFixture>();
    fixtures.forEach((f) => m.set(f.id, f));
    return m;
  }, [fixtures]);

  const mappings: CueMapping[] = useMemo(() => {
    if (!version) return [];
    return state.mappings[venue.id]?.[version.id] ?? [];
  }, [state.mappings, venue, version]);
  const mappingByCue = useMemo(() => {
    const m = new Map<string, CueMapping>();
    mappings.forEach((x) => m.set(x.cueId, x));
    return m;
  }, [mappings]);

  const selectedMapping = selectedCueId ? mappingByCue.get(selectedCueId) : undefined;
  const selectedCue = version?.cues.find((c) => c.id === selectedCueId) ?? null;
  const highlightPosition = selectedCue?.reqs[0]?.position ?? null;

  // 顶部指标
  const metrics = useMemo(() => {
    if (!version) return { cues: 0, allGood: 0, pending: 0 };
    let pending = 0;
    let allGood = 0;
    for (const cue of version.cues) {
      let goodEverywhere = true;
      for (const v of VENUES) {
        const mm = state.mappings[v.id]?.[version.id]?.find((x) => x.cueId === cue.id);
        if (!mm || mm.status !== "mapped") goodEverywhere = false;
        if (mm?.status === "pending") pending += 1;
      }
      if (goodEverywhere) allGood += 1;
    }
    return { cues: version.cues.length, allGood, pending };
  }, [state.mappings, version]);

  function pendingCountFor(vId: string) {
    if (!version) return 0;
    return (state.mappings[vId]?.[version.id] ?? []).filter((m) => m.status === "pending").length;
  }

  function doImport() {
    const parsed = parseCueSheet(importText);
    if (parsed.errors.length > 0 || !parsed.version) {
      setImportErrors(parsed.errors);
      return;
    }
    setImportErrors([]);
    setState((prev) => importVersion(prev, parsed.version!));
    setImportOpen(false);
    setSelectedCueId(null);
  }

  /** 临时换灯：只重算引用这盏灯（主灯或备灯）的 Cue，其他 Cue / 剧场结果原样保留 */
  function applySwap(fromId: string, toId: string) {
    if (!toId || fromId === toId) return;
    setState((prev) => {
      const next = clone(prev);
      const now = Date.now();
      next.overrides[venueId] ??= {};
      // 顶替灯自身若处于停用状态，先恢复（它得能上场）
      if (next.overrides[venueId][toId]) delete next.overrides[venueId][toId];
      next.overrides[venueId][fromId] = { broken: true, replacedBy: toId };
      const fresh = activeFixtures(venue, next.overrides[venueId]);

      for (const ver of next.versions) {
        const list = next.mappings[venueId]?.[ver.id];
        if (!list) continue;
        const affected = list
          .filter((m) => m.results.some((r) => r.fixtureId === fromId || r.backupId === fromId))
          .map((m) => m.cueId);
        if (affected.length === 0) continue;

        for (const cueId of affected) {
          const cue = ver.cues.find((c) => c.id === cueId);
          const idx = list.findIndex((m) => m.cueId === cueId);
          if (!cue || idx < 0) continue;
          const remap: CueMapping = { ...mapCue(cue, fresh, now), trigger: "swap" };
          list[idx] = remap;
          pushHistory(next, venueId, ver.id, cueId, {
            at: now,
            kind: "swap",
            text: `临时换灯：${fromId} 停用，由 ${toId} 顶替 → 仅重算本 Cue：${remap.status === "mapped" ? "已配好" : `${remap.reasons.length} 项留待映射`}`,
            status: remap.status,
            payload: { from: fromId, to: toId, cueIds: affected },
          });
        }
      }
      return next;
    });
    setSwapFor(null);
    setSwapTo("");
  }

  /** 撤回换灯：同样只重算当时受影响的 Cue */
  function restoreSwap(fromId: string) {
    setState((prev) => {
      const next = clone(prev);
      const now = Date.now();
      const ov = next.overrides[venueId]?.[fromId];
      if (!ov) return prev;
      const toId = ov.replacedBy ?? "";
      delete next.overrides[venueId][fromId];
      const fresh = activeFixtures(venue, next.overrides[venueId] ?? {});

      for (const ver of next.versions) {
        const list = next.mappings[venueId]?.[ver.id];
        const histRoot = next.history[venueId]?.[ver.id];
        if (!list || !histRoot) continue;
        const affected = new Set<string>();
        Object.values(histRoot).forEach((events) =>
          events.forEach((e) => {
            if (e.kind === "swap" && e.payload?.from === fromId) e.payload.cueIds.forEach((id) => affected.add(id));
          })
        );
        for (const cueId of affected) {
          const cue = ver.cues.find((c) => c.id === cueId);
          const idx = list.findIndex((m) => m.cueId === cueId);
          if (!cue || idx < 0) continue;
          const remap: CueMapping = { ...mapCue(cue, fresh, now), trigger: "restore" };
          list[idx] = remap;
          pushHistory(next, venueId, ver.id, cueId, {
            at: now,
            kind: "restore",
            text: `撤回临时换灯：${fromId} 恢复（顶替 ${toId || "—"} 下线）→ 仅重算本 Cue：${remap.status === "mapped" ? "已配好" : `${remap.reasons.length} 项留待映射`}`,
            status: remap.status,
          });
        }
      }
      return next;
    });
  }

  const filteredFixtures = fixtures.filter((f) => {
    if (groupFilter === "全部") return true;
    return POSITION_GROUPS.find((g) => g.name === groupFilter)?.positions.includes(f.position);
  });

  const swappedCount = Object.values(state.overrides[venueId] ?? {}).filter((o) => o.broken).length;

  return (
    <main className="app">
      <section className="hero">
        <p>巡演灯位映射台 · TOURING RIG MAP</p>
        <h1>同一套 Cue，三座剧场各自配灯</h1>
        <span>
          导入 Cue 后按「灯位 → 色片 → 焦点」自动匹配本场灯具，并校验通道争用与备用灯；
          配不上的 Cue 原样留待映射，Cue 顺序与历史版本永不覆盖。临时换灯只重算引用该灯的 Cue，结果保存在本机，重开页面仍在。
        </span>
      </section>

      <section className="metrics">
        <article>
          <small>巡演剧场</small>
          <strong>{VENUES.length}</strong>
        </article>
        <article>
          <small>当前版本 Cue</small>
          <strong>{metrics.cues}</strong>
        </article>
        <article>
          <small>三场均已配好</small>
          <strong className="num-ok">{metrics.allGood}</strong>
        </article>
        <article>
          <small>留待映射（三场合计）</small>
          <strong className={metrics.pending > 0 ? "num-warn" : "num-ok"}>{metrics.pending}</strong>
        </article>
      </section>

      {/* 版本条：每次导入都是不可变版本 */}
      <section className="panel version-bar">
        <div className="version-head">
          <h2>Cue 版本（只读保留，导入不改旧版）</h2>
          <button className="primary" onClick={() => { setImportOpen((v) => !v); setImportErrors([]); }}>
            {importOpen ? "收起导入" : "导入 Cue 表"}
          </button>
        </div>
        <div className="version-chips">
          {state.versions.map((v) => (
            <button
              key={v.id}
              className={["version-chip", v.id === version?.id ? "active" : ""].join(" ")}
              onClick={() => { setState((p) => ({ ...p, selectedVersionId: v.id })); setSelectedCueId(null); }}
              title={`${v.sheet} · ${formatTime(v.importedAt)}`}
            >
              <b>{v.label}</b>
              <span>
                {v.cues.length} Cue · {formatTime(v.importedAt)}
              </span>
            </button>
          ))}
        </div>

        {importOpen && (
          <div className="import-box">
            <p className="import-hint">
              粘贴 Cue 表 JSON（字段：no / name / note / reqs[].position,gel,focus,level）。导入会生成新版本并在三座剧场自动配灯，
              <b>不会改动或删除任何旧版本，Cue 顺序按数组原样保留。</b>
            </p>
            <textarea value={importText} onChange={(e) => setImportText(e.target.value)} rows={10} spellCheck={false} />
            <div className="import-actions">
              <div className="chips">
                <button onClick={() => setImportText(SAMPLE_V2)}>填入示例 v2（谢幕加灯）</button>
                <button onClick={() => setImportText(SAMPLE_V1)}>填入示例 v1</button>
              </div>
              <button className="primary" onClick={doImport}>生成新版本并三场配灯</button>
            </div>
            {importErrors.length > 0 && (
              <ul className="error-list">
                {importErrors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* 剧场切换 */}
      <nav className="venue-tabs">
        {VENUES.map((v) => {
          const pending = pendingCountFor(v.id);
          return (
            <button key={v.id} className={v.id === venueId ? "active" : ""} onClick={() => { setVenueId(v.id); setSelectedCueId(null); setSwapFor(null); }}>
              <b>{v.name}</b>
              <span>
                {v.fixtures.length} 灯
                {pending > 0 ? <em className="badge-warn">{pending} 待映射</em> : <em className="badge-ok">全部配好</em>}
              </span>
            </button>
          );
        })}
      </nav>

      <section className="mapper-grid">
        {/* 左：本场灯位图 + 灯具清单 */}
        <div className="panel venue-panel">
          <div className="heading">
            <div>
              <p>{venue.city} · 本场登记</p>
              <h2>{venue.name}</h2>
            </div>
            {swappedCount > 0 && <span className="swap-tag">{swappedCount} 盏临时换灯</span>}
          </div>
          <p className="venue-note">{venue.note}</p>

          <StagePlot fixtures={fixtures} activeMapping={selectedMapping} highlightPosition={selectedMapping ? highlightPosition : null} />

          <div className="chips filter-chips">
            {["全部", ...POSITION_GROUPS.map((g) => g.name)].map((g) => (
              <button key={g} className={groupFilter === g ? "chip-on" : ""} onClick={() => setGroupFilter(g)}>
                {g}
              </button>
            ))}
          </div>

          <div className="fixture-table-wrap">
            <table className="fixture-table">
              <thead>
                <tr>
                  <th>灯具编号</th>
                  <th>灯位 / 灯型</th>
                  <th>通道</th>
                  <th>色片</th>
                  <th>可达焦点</th>
                  <th>状态 / 操作</th>
                </tr>
              </thead>
              <tbody>
                {filteredFixtures.map((f) => {
                  const broken = f.status === "broken";
                  const used = selectedMapping?.results.some((r) => r.fixtureId === f.id || r.backupId === f.id);
                  return (
                    <tr key={f.id} className={[broken ? "row-broken" : "", used ? "row-used" : ""].join(" ")}>
                      <td><b>{f.id}</b></td>
                      <td>{f.position}<small>{f.kind}</small></td>
                      <td className="mono">{f.channel}</td>
                      <td>
                        <span className="gel-dot" style={{ background: GEL_COLORS[f.gel] ?? "#94a3b8" }} />
                        {f.gel}
                      </td>
                      <td className="focus-cell">{f.focus.join("、")}</td>
                      <td>
                        {broken ? (
                          <span className="swap-state">
                            <em className="badge-warn">停用→{f.replacedBy}</em>
                            <button className="link-btn" onClick={() => restoreSwap(f.id)}>撤回</button>
                          </span>
                        ) : (
                          <button className="link-btn" onClick={() => { setSwapFor(f.id); setSwapTo(""); }}>临时换灯</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* 右：本场逐 Cue 配灯结果 */}
        <div className="panel cue-panel">
          <div className="heading">
            <div>
              <p>{version?.label ?? "尚未导入"} · 本场配灯</p>
              <h2>Cue 映射结果</h2>
            </div>
            <div className="summary-pills">
              <em className="badge-ok">{mappings.filter((m) => m.status === "mapped").length} 已配好</em>
              <em className={mappings.some((m) => m.status === "pending") ? "badge-warn" : "badge-ok"}>
                {mappings.filter((m) => m.status === "pending").length} 留待映射
              </em>
            </div>
          </div>

          {!version && <p className="empty-hint">请先导入 Cue 表。</p>}

          <div className="cue-list">
            {mappings.map((m) => {
              const cue = version!.cues.find((c) => c.id === m.cueId)!;
              const events = state.history[venueId]?.[version!.id]?.[m.cueId] ?? [];
              const open = !!openHistory[m.cueId];
              return (
                <article key={m.cueId} className={["cue-card", m.status === "pending" ? "cue-pending" : "cue-mapped", selectedCueId === m.cueId ? "cue-selected" : ""].join(" ")}>
                  <button className="cue-head" onClick={() => setSelectedCueId(selectedCueId === m.cueId ? null : m.cueId)}>
                    <span className="cue-order">{String(cue.order + 1).padStart(2, "0")}</span>
                    <span className="cue-title">
                      <b>{cue.no} {cue.name}</b>
                      {cue.note && <small>{cue.note}</small>}
                    </span>
                    <span className={m.status === "pending" ? "badge-warn" : "badge-ok"}>
                      {m.status === "mapped" ? "已配好" : "留待映射"}
                    </span>
                  </button>

                  <div className="req-list">
                    {m.results.map((r) => {
                      const req = cue.reqs[r.reqIndex];
                      const fx = r.fixtureId ? fixtureById.get(r.fixtureId) : null;
                      const bk = r.backupId ? fixtureById.get(r.backupId) : null;
                      return (
                        <div key={r.reqIndex} className={["req-row", r.reasons.length ? "req-bad" : "req-ok"].join(" ")}>
                          <div className="req-want">
                            <span className="req-idx">需求{r.reqIndex + 1}</span>
                            {req.position} · {req.gel} · 焦点{req.focus}
                            {typeof req.level === "number" && <i> @{req.level}%</i>}
                          </div>
                          {r.reasons.length === 0 ? (
                            <div className="req-got">
                              <span className="lamp-chip main">
                                {fx!.id} <em>{fx!.channel}</em>
                              </span>
                              <span className="arrow">备</span>
                              <span className="lamp-chip backup">
                                {bk!.id} <em>{bk!.channel}</em>
                              </span>
                            </div>
                          ) : (
                            <ul className="reason-list">
                              {r.reasons.map((reason, i) => (
                                <li key={i}>{reason}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="cue-foot">
                    <span className="compute-time">
                      {m.trigger === "import" && "导入配灯"}
                      {m.trigger === "swap" && "换灯重算"}
                      {m.trigger === "restore" && "撤换重算"} · {formatTime(m.computedAt)}
                    </span>
                    <button
                      className="link-btn"
                      onClick={() => setOpenHistory((p) => ({ ...p, [m.cueId]: !open }))}
                    >
                      配灯履历 ({events.length}) {open ? "▴" : "▾"}
                    </button>
                  </div>
                  {open && (
                    <ul className="history-list">
                      {events.map((e, i) => (
                        <li key={i}>
                          <span className={e.status === "pending" ? "dot-warn" : "dot-ok"} />
                          <b>{formatTime(e.at)}</b>
                          <span>{e.text}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* 临时换灯弹层 */}
      {swapFor && (
        <div className="modal-mask" onClick={() => setSwapFor(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>临时换灯：{swapFor} 停用</h3>
            {(() => {
              const from = fixtureById.get(swapFor);
              const samePosition = fixtures.filter((f) => f.id !== swapFor && f.status !== "broken" && f.position === from?.position);
              const rest = fixtures.filter((f) => f.id !== swapFor && f.status !== "broken" && f.position !== from?.position);
              return (
                <>
                  <p className="modal-note">
                    原灯 {swapFor}（{from?.position} · {from?.channel} · {from?.gel}）。选择顶替灯后，
                    <b>系统只重算引用 {swapFor} 的 Cue</b>，本场其他 Cue 与另外两座剧场的结果保持不变。
                  </p>
                  <select value={swapTo} onChange={(e) => setSwapTo(e.target.value)}>
                    <option value="">— 选择顶替灯具 —</option>
                    {samePosition.length > 0 && (
                      <optgroup label={`同灯位（${from?.position}，优先）`}>
                        {samePosition.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.id} · {f.channel} · {f.gel} · 焦点{f.focus.join("/")}
                          </option>
                        ))}
                      </optgroup>
                    )}
                    {rest.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.id} · {f.position} · {f.channel} · {f.gel}
                      </option>
                    ))}
                  </select>
                  <div className="modal-actions">
                    <button onClick={() => setSwapFor(null)}>取消</button>
                    <button className="primary" disabled={!swapTo} onClick={() => applySwap(swapFor, swapTo)}>
                      确认换灯并重算相关 Cue
                    </button>
                  </div>
                </>
              );
            })()}
          </div>
        </div>
      )}

      <footer className="foot-note">
        数据仅保存在本浏览器（localStorage）。配灯规则：位置 → 色片 → 焦点 全部满足，主灯通道在 Cue 内不重复，且存在不同编号、不同通道的备用灯。
      </footer>
    </main>
  );
}

export default App;
