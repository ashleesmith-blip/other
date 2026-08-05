/* ================================================================ Supabase sync
 *
 * Talks to PostgREST directly with fetch rather than bundling supabase-js, so
 * index.html stays a single self-contained file and the only host it ever calls
 * is the project's own.
 *
 * localStorage stays the working copy: everything renders from it, so the tool
 * keeps working on an oval with no signal. Supabase is the shared copy that
 * survives a cleared browser and lets a second scorer see the first one's
 * sheets. Changes are pushed row by row — a scorer entering sheet 12 never
 * writes over a scorer entering sheet 30.
 */

const SYNC_KEY = 'ath_sync';
const PULL_EVERY_MS = 10000;
const PUSH_DEBOUNCE_MS = 1200;

const restHeaders = (cfg, extra) => Object.assign({
  'apikey': cfg.key,
  'Authorization': 'Bearer ' + cfg.key,
  'Content-Type': 'application/json',
}, extra || {});

const restUrl = (cfg, path) => cfg.url.replace(/\/+$/, '') + '/rest/v1/' + path;

async function rest(cfg, path, options) {
  const res = await fetch(restUrl(cfg, path), options);
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).message || ''; } catch (e) { /* body may be empty */ }
    throw new Error('Supabase ' + res.status + (detail ? ': ' + detail : ''));
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

const selectAll = (cfg, table) => rest(cfg, table + '?select=*', { headers: restHeaders(cfg) });

const upsert = (cfg, table, rows, onConflict) => {
  if (!rows.length) return Promise.resolve();
  const q = onConflict ? '?on_conflict=' + onConflict : '';
  return rest(cfg, table + q, {
    method: 'POST',
    headers: restHeaders(cfg, { 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
    body: JSON.stringify(rows),
  });
};

const removeByIds = (cfg, table, ids) => {
  if (!ids.length) return Promise.resolve();
  const list = ids.map(id => '"' + String(id).replace(/"/g, '""') + '"').join(',');
  return rest(cfg, table + '?id=in.(' + list + ')', {
    method: 'DELETE',
    headers: restHeaders(cfg, { 'Prefer': 'return=minimal' }),
  });
};

/* ------------------------------------------------- app shape <-> table shape */

const toRowHouse   = (h, i) => ({ id: h.id, name: h.name, colour: h.colour, position: i });
const fromRowHouse = (r) => ({ id: r.id, name: r.name, colour: r.colour });

const toRowEvent   = (e, i) => ({ id: e.id, name: e.name, type: e.type, scoring: e.scoring,
                                  unit: e.unit, years: e.years || [], position: i });
const fromRowEvent = (r) => ({ id: r.id, name: r.name, type: r.type, scoring: r.scoring,
                               unit: r.unit, years: r.years || [] });

const toRowStudent   = (s) => ({ id: s.id, name: s.name, year_level: s.yearLevel || '',
                                 gender: s.gender || 'Mixed', homegroup: s.homegroup || '',
                                 house_id: s.house || null, beep_test: s.beepTest || '' });
const fromRowStudent = (r) => ({ id: r.id, name: r.name, yearLevel: r.year_level || '',
                                 gender: r.gender || 'Mixed', homegroup: r.homegroup || '',
                                 house: r.house_id || '', beepTest: r.beep_test || '' });

const toRowResult   = (r) => ({ id: r.id, event_id: r.eventId, student_id: r.studentId,
                                result: r.result, recorded_on: r.date || null });
const fromRowResult = (r) => ({ id: r.id, eventId: r.event_id, studentId: r.student_id,
                                result: r.result, date: r.recorded_on || '' });

// sheetMeta is keyed 'eventId::division' locally and split across two columns remotely.
const sheetKeyOf = (r) => r.event_id + '::' + r.division;
const toRowSheet = (key, m) => {
  const cut = key.indexOf('::');
  return {
    event_id: key.slice(0, cut),
    division: key.slice(cut + 2),
    counts: m.counts || {},
    places: (m.places || []).map(v => v || ''),
    received: !!m.received,
  };
};

/* ------------------------------------------------------------------ transfer */

async function pullAll(cfg) {
  const [houses, events, students, results, sheets, settings] = await Promise.all([
    selectAll(cfg, 'houses'), selectAll(cfg, 'events'), selectAll(cfg, 'students'),
    selectAll(cfg, 'results'), selectAll(cfg, 'sheets'), selectAll(cfg, 'settings'),
  ]);

  const byPosition = (a, b) => (a.position || 0) - (b.position || 0);
  const sheetMeta = {};
  (sheets || []).forEach(r => {
    sheetMeta[sheetKeyOf(r)] = {
      counts: r.counts || {},
      places: (r.places || []).map(v => v || ''),
      received: !!r.received,
    };
  });
  const settingRow = (k, fallback) => {
    const hit = (settings || []).find(s => s.key === k);
    return hit ? hit.value : fallback;
  };

  return {
    houses: (houses || []).slice().sort(byPosition).map(fromRowHouse),
    events: (events || []).slice().sort(byPosition).map(fromRowEvent),
    students: (students || []).map(fromRowStudent),
    results: (results || []).map(fromRowResult),
    sheetMeta,
    scoring: settingRow('scoring', null),
    settings: settingRow('district', null),
    prefs: settingRow('prefs', null),
  };
}

const sameJson = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// Only what actually changed since the last known server state gets written.
function diffById(localRows, shadowRows) {
  const shadow = {};
  (shadowRows || []).forEach(r => { shadow[r.id] = r; });
  const changed = [];
  const seen = new Set();
  localRows.forEach(r => {
    seen.add(r.id);
    if (!shadow[r.id] || !sameJson(shadow[r.id], r)) changed.push(r);
  });
  const removed = Object.keys(shadow).filter(id => !seen.has(id));
  return { changed, removed };
}

/*
 * Push, in foreign-key order.
 *
 * These used to all fire at once, which meant a result could reach the server
 * before the student it points at and be rejected on the foreign key. Parents
 * go first and each stage is awaited: houses and events, then students, then
 * everything that references them.
 *
 * Deletes for students, houses and events are deliberately not sent.
 * supabase-protect.sql revokes that permission precisely so an emptied browser
 * cannot wipe the roll, and attempting it would only fail the whole push — so
 * they are reported back instead and removed in Supabase if genuinely wanted.
 */
const PROTECTED_FROM_DELETE = ['students', 'houses', 'events'];

async function pushChanges(cfg, local, shadow) {
  const touched = [];
  const skipped = [];
  const up = {};        // table -> rows to upsert
  const del = {};       // table -> ids to remove

  const plan = (name, toRow, localList, shadowList) => {
    const { changed, removed } = diffById((localList || []).map(toRow), (shadowList || []).map(toRow));
    if (changed.length) up[name] = changed;
    if (removed.length) {
      if (PROTECTED_FROM_DELETE.indexOf(name) >= 0) skipped.push(removed.length + ' ' + name + ' not removed on the server');
      else del[name] = removed;
    }
  };

  plan('houses',   (h, i) => toRowHouse(h, i), local.houses,   shadow.houses);
  plan('events',   (e, i) => toRowEvent(e, i), local.events,   shadow.events);
  plan('students', toRowStudent,               local.students, shadow.students);
  plan('results',  toRowResult,                local.results,  shadow.results);

  // Sheets carry a composite key, so they diff on the local map key.
  const sheetRows = [];
  Object.keys(local.sheetMeta || {}).forEach(k => {
    const before = (shadow.sheetMeta || {})[k];
    if (!before || !sameJson(before, local.sheetMeta[k])) sheetRows.push(toRowSheet(k, local.sheetMeta[k]));
  });
  const goneSheets = Object.keys(shadow.sheetMeta || {}).filter(k => !(local.sheetMeta || {})[k]);

  const settingRows = [];
  [['scoring', local.scoring, shadow.scoring],
   ['district', local.settings, shadow.settings],
   ['prefs', local.prefs, shadow.prefs]].forEach(([key, now, before]) => {
    if (!sameJson(now, before)) settingRows.push({ key, value: now });
  });

  const send = async (name, onConflict) => {
    if (!up[name] || !up[name].length) return;
    await upsert(cfg, name, up[name], onConflict);
    touched.push(name + ' +' + up[name].length);
  };

  // Children are removed before their parents; parents are written before their children.
  for (const name of ['results']) {
    if (del[name]) { await removeByIds(cfg, name, del[name]); touched.push(name + ' -' + del[name].length); }
  }
  for (const k of goneSheets) {
    const cut = k.indexOf('::');
    await rest(cfg, 'sheets?event_id=eq.' + encodeURIComponent(k.slice(0, cut)) +
      '&division=eq.' + encodeURIComponent(k.slice(cut + 2)), {
      method: 'DELETE', headers: restHeaders(cfg, { 'Prefer': 'return=minimal' }),
    });
  }
  if (goneSheets.length) touched.push('sheets -' + goneSheets.length);

  await Promise.all([send('houses'), send('events')]);
  await send('students');
  await Promise.all([
    send('results'),
    (async () => {
      if (!sheetRows.length) return;
      await upsert(cfg, 'sheets', sheetRows, 'event_id,division');
      touched.push('sheets +' + sheetRows.length);
    })(),
    (async () => {
      if (!settingRows.length) return;
      await upsert(cfg, 'settings', settingRows);
      touched.push('settings +' + settingRows.length);
    })(),
  ]);

  return touched.concat(skipped);
}

/* ---------------------------------------------------------------- the hook */

function useSupabaseSync(state, apply) {
  const [config, setConfig] = usePersistentState(SYNC_KEY, { url: '', key: '', enabled: false });
  const [status, setStatus] = useState({ phase: 'off', at: null, error: null, note: '' });

  const shadow = useRef(null);       // last state we know the server holds
  const busy = useRef(false);        // a transfer is in flight
  const stateRef = useRef(state);
  const applyRef = useRef(apply);
  stateRef.current = state;
  applyRef.current = apply;

  const live = config.enabled && config.url && config.key;

  const snapshot = (s) => ({
    houses: s.houses, events: s.events, students: s.students, results: s.results,
    sheetMeta: s.sheetMeta, scoring: s.scoring, settings: s.settings, prefs: s.prefs,
  });

  /*
   * A pull replaces local data with the server's. That is right when the server
   * is the fuller copy and catastrophic when it is not — connecting a browser
   * that holds the only class list to a project that has never been seeded
   * would empty it. Anything that would wipe a populated list has to be
   * confirmed; everything else applies silently.
   */
  const applyRemote = (remote, ask) => {
    const local = stateRef.current;
    const wipes = [
      ['students', (local.students || []).length, (remote.students || []).length],
      ['results', (local.results || []).length, (remote.results || []).length],
      ['sheets', Object.keys(local.sheetMeta || {}).length, Object.keys(remote.sheetMeta || {}).length],
    ].filter(([, mine, theirs]) => mine > 0 && theirs === 0);

    if (wipes.length) {
      const lost = wipes.map(([what, mine]) => mine + ' ' + what).join(', ');
      if (!ask) {
        setStatus({ phase: 'ok', at: new Date(), error: null,
          note: 'not pulled — Supabase is empty and this browser holds ' + lost });
        return false;
      }
      const ok = confirm(
        'Supabase has no ' + wipes.map(w => w[0]).join(' or ') + ', but this browser has ' + lost + '.\n\n' +
        'Pulling would erase them here.\n\n' +
        'Cancel, then use "Upload this browser to Supabase" instead if this is the copy with your data.');
      if (!ok) {
        setStatus({ phase: 'error', at: new Date(), error: null,
          note: 'pull cancelled — this browser still holds ' + lost });
        return false;
      }
    }
    applyRef.current(remote);
    return true;
  };

  const pull = useCallback(async (opts) => {
    const cfg = (opts && opts.config) || config;
    if (!cfg.url || !cfg.key) throw new Error('Project URL and anon key are both needed.');
    setStatus(s => ({ ...s, phase: 'working', error: null }));
    const remote = await pullAll(cfg);
    if (!applyRemote(remote, true)) return null;
    shadow.current = remote;
    setStatus({ phase: 'ok', at: new Date(), error: null,
      note: 'pulled ' + remote.students.length + ' students, ' + remote.results.length + ' results' });
    return remote;
  }, [config]);

  const pushAll = useCallback(async (opts) => {
    const cfg = (opts && opts.config) || config;
    if (!cfg.url || !cfg.key) throw new Error('Project URL and anon key are both needed.');
    setStatus(s => ({ ...s, phase: 'working', error: null }));
    // An empty shadow makes every local row count as new, which is what a first
    // upload wants.
    const touched = await pushChanges(cfg, snapshot(stateRef.current),
      { houses: [], events: [], students: [], results: [], sheetMeta: {} });
    shadow.current = snapshot(stateRef.current);
    setStatus({ phase: 'ok', at: new Date(), error: null,
      note: touched.length ? 'sent ' + touched.join(', ') : 'nothing to send' });
  }, [config]);

  // Push local edits, debounced so typing does not become one request per key.
  useEffect(() => {
    if (!live || !shadow.current) return undefined;
    const t = setTimeout(async () => {
      if (busy.current) return;
      const local = snapshot(stateRef.current);
      if (sameJson(local, shadow.current)) return;
      busy.current = true;
      try {
        const touched = await pushChanges(config, local, shadow.current);
        shadow.current = local;
        if (touched.length) {
          setStatus({ phase: 'ok', at: new Date(), error: null, note: 'sent ' + touched.join(', ') });
        }
      } catch (e) {
        setStatus(s => ({ ...s, phase: 'error', error: e.message }));
      } finally {
        busy.current = false;
      }
    }, PUSH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [live, config, state]);

  // Poll for other people's changes. Skipped whenever this browser has edits
  // still to send, so a pull can never land on top of unsaved work.
  useEffect(() => {
    if (!live) { setStatus(s => ({ ...s, phase: 'off' })); return undefined; }
    let stop = false;
    const tick = async () => {
      if (stop || busy.current) return;
      const local = snapshot(stateRef.current);
      if (shadow.current && !sameJson(local, shadow.current)) return;  // local edits pending
      busy.current = true;
      try {
        const remote = await pullAll(config);
        if (!stop && !sameJson(remote, shadow.current)) {
          if (applyRemote(remote, false)) {
            shadow.current = remote;
            setStatus({ phase: 'ok', at: new Date(), error: null, note: 'updated from the server' });
          }
        } else if (!stop) {
          setStatus(s => ({ ...s, phase: 'ok', at: new Date(), error: null }));
        }
      } catch (e) {
        if (!stop) setStatus(s => ({ ...s, phase: 'error', error: e.message }));
      } finally {
        busy.current = false;
      }
    };
    tick();
    const id = setInterval(tick, PULL_EVERY_MS);
    return () => { stop = true; clearInterval(id); };
  }, [live, config]);

  return { config, setConfig, status, pull, pushAll, live };
}

/* ----------------------------------------------------------------- the tab */

function SyncTab({ sync, students, results, sheetMeta }) {
  const { config, setConfig, status, pull, pushAll, live } = sync;
  const [draft, setDraft] = useState({ url: config.url, key: config.key });
  const [busy, setBusy] = useState('');

  const run = async (what, fn) => {
    setBusy(what);
    try { await fn(); }
    catch (e) { alert(e.message); }
    finally { setBusy(''); }
  };

  const save = (enabled) => {
    const next = { url: draft.url.trim().replace(/\/+$/, ''), key: draft.key.trim(), enabled };
    setConfig(next);
    return next;
  };

  const sheetCount = Object.keys(sheetMeta || {}).length;

  return (
    <div>
      <h2>Sync</h2>

      <div className="card">
        <h3>
          {live
            ? <span className="pill" style={{ background: status.phase === 'error' ? '#fee2e2' : '#dcfce7' }}>
                {status.phase === 'error' ? 'Error' : 'On'}
              </span>
            : <span className="pill" style={{ background: '#eef1f4' }}>Off</span>}
          {' '}Status
        </h3>
        {status.error && <div className="warn">{status.error}</div>}
        <p className="muted" style={{ marginTop: 0 }}>
          {live
            ? (status.at
                ? 'Last contact ' + status.at.toLocaleTimeString() + (status.note ? ' — ' + status.note : '')
                : 'Connecting…')
            : 'Not syncing. This browser is the only copy of your data.'}
        </p>
        <p className="muted" style={{ marginBottom: 0 }}>
          Holding locally: {students.length} students, {results.length} results, {sheetCount} sheets.
        </p>
      </div>

      <div className="card">
        <h3>Project</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          From your Supabase project: <strong>Settings → API</strong>. Use the
          <strong> anon / publishable</strong> key. Never paste the <em>service_role</em> key here —
          it appears in the page and would give anyone full access.
        </p>
        <label className="fld">Project URL
          <input type="text" placeholder="https://xxxxxxxxxxxx.supabase.co" value={draft.url}
            onChange={e => setDraft({ ...draft, url: e.target.value })} />
        </label>
        <label className="fld">Anon key
          <input type="text" placeholder="eyJhbGciOi…" value={draft.key}
            onChange={e => setDraft({ ...draft, key: e.target.value })} />
        </label>
        <div className="row">
          <button className="btn" style={{ flex: '0 0 auto' }} disabled={!!busy}
            onClick={() => run('test', async () => {
              const next = save(false);
              await pull({ config: next });
              setConfig({ ...next, enabled: true });
            })}>
            {busy === 'test' ? 'Connecting…' : 'Connect and pull'}
          </button>
          <button className="btn-ghost" style={{ flex: '0 0 auto' }} disabled={!!busy}
            onClick={() => run('push', async () => {
              const next = save(true);
              if (!confirm('Upload everything in this browser to Supabase?\n\n' +
                students.length + ' students, ' + results.length + ' results, ' + sheetCount + ' sheets.\n\n' +
                'Rows already there with the same id are overwritten.')) return;
              await pushAll({ config: next });
            })}>
            {busy === 'push' ? 'Uploading…' : 'Upload this browser to Supabase'}
          </button>
          {live && (
            <button className="btn-ghost" style={{ flex: '0 0 auto' }}
              onClick={() => setConfig({ ...config, enabled: false })}>Turn sync off</button>
          )}
        </div>
      </div>

      <div className="card">
        <h3>How it behaves</h3>
        <ul className="muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
          <li>This browser stays the working copy — the tool keeps running with no signal, and
            catches up when it returns.</li>
          <li>Edits go up about a second after you stop typing, row by row. Two people entering
            different sheets never overwrite each other.</li>
          <li>Other people's changes arrive within about ten seconds, and only when you have
            nothing unsent — a pull can't land on top of your work.</li>
          <li>Same rows, same result: whoever saved last wins for that row.</li>
        </ul>
      </div>

      <div className="card">
        <h3>Setting up a project</h3>
        <ol className="muted" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
          <li>Create a project at supabase.com, region <strong>Sydney (ap-southeast-2)</strong>.</li>
          <li>Open <strong>SQL Editor</strong>, paste in <code>supabase.sql</code> from the repo, run it.</li>
          <li>Copy <strong>Settings → API</strong> → Project URL and anon key into the boxes above.</li>
          <li><strong>Upload this browser to Supabase</strong> once, to seed it.</li>
          <li>On every other device: paste the same two values and press <strong>Connect and pull</strong>.</li>
        </ol>
      </div>
    </div>
  );
}
