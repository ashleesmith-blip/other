const { useState, useEffect, useMemo, useCallback, useRef } = React;

const store = (typeof window !== 'undefined' && window.storage) ? window.storage : localStorage;

const STORE_KEYS = ['ath_houses', 'ath_events', 'ath_students', 'ath_results',
  'ath_prefs', 'ath_settings', 'ath_sheetmeta', 'ath_scoring', 'ath_dteam'];

/*
 * Persisted state.
 *
 * Two rules here exist because a whole class list can otherwise disappear:
 *
 * 1. Never write on mount. The old code saved every key on first render, so if a
 *    read ever came back empty the empty value was immediately written over the
 *    good one — a transient failure became permanent deletion.
 * 2. If stored text won't parse, keep it under `<key>__unreadable` instead of
 *    discarding it, so it can be recovered by hand rather than being lost.
 */
function usePersistentState(key, fallback) {
  const [value, setValue] = useState(() => {
    let raw = null;
    try { raw = store.getItem(key); } catch (e) { return fallback; }
    if (raw === null || raw === undefined) return fallback;
    try {
      const parsed = JSON.parse(raw);
      return (parsed === null || parsed === undefined) ? fallback : parsed;
    } catch (e) {
      try { store.setItem(key + '__unreadable', raw); } catch (e2) { /* nothing more to do */ }
      return fallback;
    }
  });

  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) { mounted.current = true; return; }
    try {
      store.setItem(key, JSON.stringify(value));
    } catch (e) {
      alert('Could not save — the browser refused to write to storage.\n\n' +
        'Download a backup from the Import tab before closing this page.');
    }
  }, [key, value]);

  return [value, setValue];
}

const YEARS = ['Prep', '1', '2', '3', '4', '5', '6'];

const ordinal = (n) => ['1st', '2nd', '3rd', '4th'][n - 1] || (n + 'th');

/*
 * House blocks run in the order the houses are listed on the Houses tab — the
 * same order as the participation boxes on the Results tab, left to right. It
 * used to be alphabetical, which put Flinders first on the paper and second-last
 * in the boxes, so counting off a sheet meant crossing the row every time.
 *
 * The recording sheet and the Results list share this, so a sheet can be typed
 * straight down the page without hunting for names.
 */
const byHouseThenName = (houses) => {
  const rank = {};
  (houses || []).forEach((h, i) => { rank[h.id] = i; });
  const at = (s) => (rank[s.house] === undefined ? 999 : rank[s.house]);
  return (a, b) => at(a) - at(b) || a.name.localeCompare(b.name);
};

const DEFAULT_HOUSES = [
  { id: 'h1', name: 'Freeman',   colour: '#e11d48' },
  { id: 'h2', name: 'Goldstein', colour: '#0891b2' },
  { id: 'h3', name: 'Flinders',  colour: '#ca8a04' },
  { id: 'h4', name: 'Mabo',      colour: '#15803d' },
];

// Standard primary athletics program. scoring: 'lower' = fastest wins, 'higher' = furthest/highest wins.
const DEFAULT_EVENTS = [
  { id: 'e1',  name: '100m',          type: 'track', scoring: 'lower',  unit: 'sec', years: ['Prep','1','2','3','4','5','6'] },
  { id: 'e2',  name: '200m',          type: 'track', scoring: 'lower',  unit: 'sec', years: ['3','4','5','6'] },
  { id: 'e3',  name: '800m',          type: 'track', scoring: 'lower',  unit: 'sec', years: ['3','4','5','6'] },
  { id: 'e4',  name: '1500m',         type: 'track', scoring: 'lower',  unit: 'sec', years: ['5','6'] },
  { id: 'e5',  name: '80m Hurdles',   type: 'track', scoring: 'lower',  unit: 'sec', years: ['5','6'] },
  { id: 'e6',  name: 'Long Jump',     type: 'field', scoring: 'higher', unit: 'm',   years: ['Prep','1','2','3','4','5','6'] },
  { id: 'e7',  name: 'Triple Jump',   type: 'field', scoring: 'higher', unit: 'm',   years: ['5','6'] },
  { id: 'e8',  name: 'High Jump',     type: 'field', scoring: 'higher', unit: 'm',   years: ['5','6'] },
  { id: 'e9',  name: 'Shot Put',      type: 'field', scoring: 'higher', unit: 'm',   years: ['3','4','5','6'] },
  { id: 'e10', name: 'Discus',        type: 'field', scoring: 'higher', unit: 'm',   years: ['3','4','5','6'] },
  { id: 'e11', name: '4x100m Relay',  type: 'relay', scoring: 'lower',  unit: 'sec', years: ['3','4','5','6'] },
];

// The most table rows that clear the text area of an A4 page at the print
// sizes in styles.css. Measured, not guessed — see the print block there.
const MAX_ROWS_PER_A4 = 34;

// How many student rows the editable table renders at once. See the note in
// StudentsTab: rendering a whole school made typing lag.
const ROW_LIMIT = 100;

const uid = (p) => p + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

// "1:23.4" -> 83.4 ; "12.55" -> 12.55 ; "3.20" -> 3.2
function parseResult(str) {
  if (str === null || str === undefined) return NaN;
  const s = String(str).trim();
  if (!s) return NaN;
  if (s.includes(':')) {
    const [m, sec] = s.split(':');
    const mm = parseFloat(m), ss = parseFloat(sec);
    if (isNaN(mm) || isNaN(ss)) return NaN;
    return mm * 60 + ss;
  }
  const n = parseFloat(s);
  return isNaN(n) ? NaN : n;
}

const divisionOf = (student) => (student.yearLevel || '?') + ' ' + (student.gender || 'Mixed');
const divKey = (eventId, division) => eventId + '::' + division;

const GENDERS = ['Female', 'Male', 'Mixed'];

/*
 * Every event-and-division that will actually be run gets a sheet number,
 * printed big on its recording sheet, so whoever types the results up can jump
 * straight to the right list.
 *
 * A division only counts if the event runs at that year level *and* there are
 * students in that year and gender — numbering the empty combinations would
 * push the numbers into the hundreds and hand out sheet numbers that resolve to
 * nobody. The consequence is that numbers shift if a division goes from empty
 * to populated, so load the class list before printing.
 */
function buildSheetIndex(events, students) {
  const populated = new Set();
  (students || []).forEach(s => {
    if (s.yearLevel) populated.add(s.yearLevel + ' ' + (s.gender || 'Mixed'));
  });

  const byKey = {};
  const byNumber = {};
  let n = 0;
  events.forEach(ev => {
    YEARS.forEach(y => {
      if (!ev.years.includes(y)) return;
      GENDERS.forEach(g => {
        if (!populated.has(y + ' ' + g)) return;
        n += 1;
        byKey[divKey(ev.id, y + ' ' + g)] = n;
        byNumber[n] = { eventId: ev.id, year: y, gender: g, event: ev };
      });
    });
  });
  return { byKey, byNumber, total: n };
}

/*
 * House scoring: a point for every competitor, plus 4/3/2/1 for the first four
 * places. Both halves are editable on the Houses tab.
 *
 * Participation is a count typed in per house rather than a headcount off the
 * class list — the recording sheet lists the whole division, but absences and
 * non-starters mean only the marshal knows who actually competed. Placings are
 * not typed twice: they come from the results already entered for the division.
 */
const DEFAULT_SCORING = { participation: 1, places: [4, 3, 2, 1] };

/*
 * Who placed 1st..4th in one event and division.
 *
 * The scorer normally names them straight off the sheet, which is all the paper
 * carries. Where nobody has been named, fall back to ranking whatever results
 * have been typed — so either way of working scores the same.
 */
function placingsFor(sheetMeta, results, event, division, byId, count) {
  const meta = (sheetMeta || {})[divKey(event.id, division)];
  const named = meta && (meta.places || [])
    .map((sid, i) => (sid && byId[sid]) ? { studentId: sid, place: i + 1 } : null)
    .filter(Boolean);
  if (named && named.length) return named.slice(0, count);
  return rankFor(results, event.id, division, event.scoring, byId).slice(0, count);
}

// Divisions of this event that anyone has scored, by either route.
function divisionsScored(sheetMeta, results, event, byId) {
  const divisions = new Set();
  results.filter(r => r.eventId === event.id).forEach(r => {
    const st = byId[r.studentId];
    if (st) divisions.add(divisionOf(st));
  });
  Object.keys(sheetMeta || {}).forEach(k => {
    const cut = k.indexOf('::');
    if (k.slice(0, cut) === event.id && ((sheetMeta[k] || {}).places || []).some(Boolean)) {
      divisions.add(k.slice(cut + 2));
    }
  });
  return divisions;
}

function tallyHousePoints(houses, students, sheetMeta, results, events, scoring) {
  const byId = {};
  students.forEach(s => { byId[s.id] = s; });

  const tally = {};
  houses.forEach(h => { tally[h.id] = { participants: 0, participation: 0, placing: 0, total: 0 }; });

  Object.keys(sheetMeta || {}).forEach(key => {
    const counts = (sheetMeta[key] || {}).counts || {};
    Object.keys(counts).forEach(hid => {
      const n = parseInt(counts[hid], 10) || 0;
      if (!tally[hid] || n <= 0) return;
      tally[hid].participants += n;
      tally[hid].participation += n * scoring.participation;
    });
  });

  events.forEach(ev => {
    divisionsScored(sheetMeta, results, ev, byId).forEach(division => {
      placingsFor(sheetMeta, results, ev, division, byId, scoring.places.length).forEach(r => {
        const st = byId[r.studentId];
        if (st && tally[st.house]) tally[st.house].placing += scoring.places[r.place - 1] || 0;
      });
    });
  });

  Object.keys(tally).forEach(hid => {
    tally[hid].total = tally[hid].participation + tally[hid].placing;
  });
  return tally;
}

/* ------------------------------------------------- what is attached to what
 *
 * Nothing in the carnival data stands on its own. A student carries results,
 * placings marked on sheets, a district spot and their event preferences; an
 * event carries all of that across every division it was run in. Deleting
 * either used to ask a bare "are you sure?", which is no help at all — the real
 * question is what goes with it, and the answer that matters most is the house
 * points, because a placing whose student has gone stops scoring and the house
 * quietly drops four points with nothing on screen to say why.
 *
 * So both delete paths count the attachments first and say them out loud. The
 * same counts drive the flag shown against a row before anything is clicked.
 */
function attachmentsOfStudent(id, { results, sheetMeta, dteam, prefs, events, scoring }) {
  const eventNameOf = (eid) => ((events || []).find(e => e.id === eid) || {}).name || 'an event';
  const resultCount = (results || []).filter(r => r.studentId === id).length;

  const placings = [];
  Object.keys(sheetMeta || {}).forEach(k => {
    const at = ((sheetMeta[k] || {}).places || []).indexOf(id);
    if (at < 0) return;
    const cut = k.indexOf('::');
    placings.push({
      place: at + 1,
      event: eventNameOf(k.slice(0, cut)),
      points: ((scoring || DEFAULT_SCORING).places || [])[at] || 0,
    });
  });

  let spots = 0;
  Object.keys(dteam || {}).forEach(k => {
    const raw = dteam[k];
    const ids = Array.isArray(raw) ? raw : (raw && raw.ids) || [];
    if (ids.indexOf(id) >= 0) spots++;
  });

  const pref = (prefs || {})[id];
  const hasPrefs = !!(pref && (((pref.chosen || []).length) || pref.note));

  return {
    results: resultCount,
    placings,
    spots,
    hasPrefs,
    points: placings.reduce((n, p) => n + p.points, 0),
    any: resultCount > 0 || placings.length > 0 || spots > 0 || hasPrefs,
  };
}

// The same question for an event, counted across every division it was run in.
function attachmentsOfEvent(id, { results, sheetMeta, dteam }) {
  const resultCount = (results || []).filter(r => r.eventId === id).length;
  const prefix = id + '::';
  const sheets = Object.keys(sheetMeta || {}).filter(k => k.slice(0, prefix.length) === prefix);
  const marked = sheets.filter(k => ((sheetMeta[k] || {}).places || []).some(Boolean));
  const counted = sheets.filter(k => {
    const c = (sheetMeta[k] || {}).counts || {};
    return Object.keys(c).some(h => (parseInt(c[h], 10) || 0) > 0);
  });
  const spots = Object.keys(dteam || {}).filter(k => {
    if (k.slice(0, prefix.length) !== prefix) return false;
    const raw = dteam[k];
    const ids = Array.isArray(raw) ? raw : (raw && raw.ids) || [];
    return ids.some(Boolean);
  }).length;
  return { results: resultCount, sheets: sheets.length, marked: marked.length, counted: counted.length, spots };
}

// A bulleted list for a confirm box. Only the lines that apply.
const listLines = (lines) => lines.filter(Boolean).map(l => '  • ' + l).join('\n');

/* Rank the results for one event+division. Returns [{studentId, raw, value, place}] best first. */
function rankFor(results, eventId, division, scoring, studentsById) {
  const rows = results
    .filter(r => r.eventId === eventId && studentsById[r.studentId] && divisionOf(studentsById[r.studentId]) === division)
    .map(r => ({ ...r, value: parseResult(r.result) }))
    .filter(r => !isNaN(r.value));
  rows.sort((a, b) => scoring === 'lower' ? a.value - b.value : b.value - a.value);
  return rows.map((r, i) => ({ ...r, place: i + 1 }));
}

/*
 * District team allocation.
 *
 * Every event+division sends its top `spotsPerEvent` finishers, but no student may
 * hold more than `maxPerStudent` individual events (relays are free — they sit
 * outside the cap). When a student is over the cap they keep the events they chose
 * in `prefs`; every spot they let go is offered to the next finisher, who may then
 * be over the cap themselves. We loop until nothing changes, recording each pass so
 * you can see how the spots cascaded.
 */
function allocateDistrict(events, results, students, prefs, opts, sheetMeta) {
  const maxPerStudent = opts.maxPerStudent;
  const spotsPerEvent = opts.spotsPerEvent;
  const studentsById = {};
  students.forEach(s => { studentsById[s.id] = s; });

  // Every event+division anyone has scored, by named placings or typed results.
  const contests = [];
  events.forEach(ev => {
    divisionsScored(sheetMeta, results, ev, studentsById).forEach(division => {
      const named = (sheetMeta || {})[divKey(ev.id, division)];
      const explicit = named && (named.places || [])
        .map((sid, i) => (sid && studentsById[sid]) ? { studentId: sid, place: i + 1 } : null)
        .filter(Boolean);
      contests.push({
        event: ev,
        division,
        ranked: (explicit && explicit.length)
          ? explicit
          : rankFor(results, ev.id, division, ev.scoring, studentsById),
      });
    });
  });

  const held = {};       // studentId -> [ {eventId, division, place} ] individual events only
  const filled = {};     // contestKey -> [ {studentId, place} ]
  const passedOver = []; // audit trail of who released what
  const countFor = (sid) => (held[sid] || []).length;

  let changed = true, pass = 0;
  while (changed && pass < 40) {
    changed = false;
    pass++;
    contests.forEach(c => {
      const key = divKey(c.event.id, c.division);
      const isRelay = c.event.type === 'relay';
      const current = filled[key] || [];
      if (current.length >= spotsPerEvent) return;

      for (const cand of c.ranked) {
        if (current.some(x => x.studentId === cand.studentId)) continue;

        // Relay spots never count against the cap and are never declined.
        if (!isRelay) {
          const pref = prefs[cand.studentId];
          // A student who has locked in their picks declines everything not on the list.
          if (pref && pref.chosen && pref.chosen.length && !pref.chosen.includes(c.event.id)) {
            passedOver.push({ studentId: cand.studentId, eventId: c.event.id, division: c.division, reason: 'chose other events' });
            continue;
          }
          if (countFor(cand.studentId) >= maxPerStudent) {
            passedOver.push({ studentId: cand.studentId, eventId: c.event.id, division: c.division, reason: 'already on ' + maxPerStudent + ' events' });
            continue;
          }
          held[cand.studentId] = (held[cand.studentId] || []).concat([{ eventId: c.event.id, division: c.division, place: cand.place }]);
        }

        filled[key] = current.concat([{ studentId: cand.studentId, place: cand.place }]);
        changed = true;
        break;
      }
    });
  }

  // Anyone whose wins exceed the cap and who hasn't chosen yet.
  const overCap = [];
  contests.forEach(c => {
    if (c.event.type === 'relay') return;
    c.ranked.slice(0, spotsPerEvent).forEach(r => {
      let entry = overCap.find(o => o.studentId === r.studentId);
      if (!entry) { entry = { studentId: r.studentId, won: [] }; overCap.push(entry); }
      entry.won.push({ eventId: c.event.id, division: c.division, place: r.place });
    });
  });

  return {
    contests,
    filled,
    held,
    passes: pass,
    passedOver,
    needsChoice: overCap.filter(o => o.won.length > maxPerStudent),
  };
}

/* ---------------------------------------------------------------- tabs */

function EventsTab({ events, setEvents, results, sheetMeta, dteam, students, houses, scoring }) {
  const blank = { name: '', type: 'track', scoring: 'lower', unit: 'sec', years: ['3','4','5','6'] };
  const [draft, setDraft] = useState(blank);

  const add = () => {
    if (!draft.name.trim()) return alert('Give the event a name.');
    setEvents(events.concat([{ ...draft, id: uid('e'), name: draft.name.trim() }]));
    setDraft(blank);
  };
  const patch = (id, changes) => setEvents(events.map(e => e.id === id ? { ...e, ...changes } : e));

  const attachMap = useMemo(() => {
    const m = {};
    events.forEach(ev => { m[ev.id] = attachmentsOfEvent(ev.id, { results, sheetMeta, dteam }); });
    return m;
  }, [events, results, sheetMeta, dteam]);

  /*
   * An event is not deleted so much as hidden: its results and sheets stay in
   * the data, because an event added back gets a new id and could never be
   * reunited with them. What does change immediately is the house tally — the
   * points that came off this event stop counting the moment it goes — so that
   * figure is worked out and shown rather than left to be discovered on the
   * Houses tab.
   */
  const remove = (id) => {
    const ev = events.find(e => e.id === id);
    const a = attachMap[id] || { results: 0, sheets: 0, marked: 0, counted: 0, spots: 0 };
    const lost = tallyHousePoints(houses || [], students || [], sheetMeta || {}, results || [],
      ev ? [ev] : [], scoring || DEFAULT_SCORING);
    const lostTotal = Object.keys(lost).reduce((n, h) => n + lost[h].total, 0);
    const byHouse = (houses || [])
      .filter(h => lost[h.id] && lost[h.id].total)
      .map(h => h.name + ' ' + lost[h.id].total)
      .join(', ');

    const detail = listLines([
      a.results ? a.results + ' recorded result' + (a.results === 1 ? '' : 's') : '',
      a.marked ? a.marked + ' sheet' + (a.marked === 1 ? '' : 's') + ' with placings marked' : '',
      a.counted ? a.counted + ' sheet' + (a.counted === 1 ? '' : 's') + ' with participation counted' : '',
      a.spots ? a.spots + ' district team row' + (a.spots === 1 ? '' : 's') + ' filled in' : '',
    ]);

    if (!confirm('Remove ' + (ev ? ev.name : 'this event') + '?\n\n' +
      (detail
        ? 'It has data recorded against it:\n' + detail + '\n\n' +
          'That stays in the browser but stops being shown or counted' +
          (lostTotal
            ? ', so the house tally drops by ' + lostTotal + ' point' + (lostTotal === 1 ? '' : 's') +
              (byHouse ? ' (' + byHouse + ')' : '')
            : '') + '.\n\n'
        : 'Nothing is recorded against it yet.\n\n') +
      'Every sheet number after it shifts.')) return;
    setEvents(events.filter(e => e.id !== id));
  };
  const toggleYear = (y) => setDraft(d => ({
    ...d,
    years: d.years.includes(y) ? d.years.filter(x => x !== y) : d.years.concat([y]),
  }));

  return (
    <div>
      <h2>Events ({events.length})</h2>
      <div className="card">
        <h3>Add an event</h3>
        <div className="row">
          <label className="fld">Name
            <input type="text" value={draft.name} placeholder="e.g. 400m"
              onChange={e => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <label className="fld">Type
            <select value={draft.type} onChange={e => {
              const type = e.target.value;
              setDraft({
                ...draft, type,
                scoring: type === 'field' ? 'higher' : 'lower',
                unit: type === 'field' ? 'm' : 'sec',
              });
            }}>
              <option value="track">Track</option>
              <option value="field">Field</option>
              <option value="relay">Relay</option>
            </select>
          </label>
          <label className="fld">Winner is
            <select value={draft.scoring} onChange={e => setDraft({ ...draft, scoring: e.target.value })}>
              <option value="lower">Lowest (fastest time)</option>
              <option value="higher">Highest (furthest / highest)</option>
            </select>
          </label>
          <label className="fld">Unit
            <select value={draft.unit} onChange={e => setDraft({ ...draft, unit: e.target.value })}>
              <option value="sec">seconds</option>
              <option value="m">metres</option>
              <option value="cm">centimetres</option>
            </select>
          </label>
        </div>
        <label className="fld">Year levels</label>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
          {YEARS.map(y => (
            <label key={y} style={{ fontSize: 13 }}>
              <input type="checkbox" checked={draft.years.includes(y)} onChange={() => toggleYear(y)} /> {y}
            </label>
          ))}
        </div>
        <button className="btn" onClick={add}>Add event</button>
      </div>

      <div className="card">
        <p className="muted" style={{ marginTop: 0 }}>
          Every column is editable here — edits save as you make them. Changing which year levels an
          event runs at <strong>renumbers the sheets</strong>, so do it before printing rather than
          after, or the numbers on the paper will no longer match.
        </p>
        <table>
          <thead>
            <tr>
              <th>Event</th><th style={{ width: 110 }}>Type</th>
              <th style={{ width: 190 }}>Winner</th><th style={{ width: 100 }}>Unit</th>
              <th>Year levels</th><th style={{ width: 90 }}></th>
            </tr>
          </thead>
          <tbody>
            {events.map(ev => (
              <tr key={ev.id}>
                <td>
                  <input type="text" value={ev.name} style={{ marginTop: 0 }} aria-label="Event name"
                    onChange={e => patch(ev.id, { name: e.target.value })} />
                </td>
                <td>
                  <select value={ev.type} style={{ marginTop: 0 }} aria-label="Event type"
                    onChange={e => patch(ev.id, { type: e.target.value })}>
                    <option value="track">Track</option>
                    <option value="field">Field</option>
                    <option value="relay">Relay</option>
                  </select>
                </td>
                <td>
                  <select value={ev.scoring} style={{ marginTop: 0 }} aria-label="Winner is"
                    onChange={e => patch(ev.id, { scoring: e.target.value })}>
                    <option value="lower">Fastest (lowest)</option>
                    <option value="higher">Furthest / highest</option>
                  </select>
                </td>
                <td>
                  <select value={ev.unit} style={{ marginTop: 0 }} aria-label="Unit"
                    onChange={e => patch(ev.id, { unit: e.target.value })}>
                    <option value="sec">seconds</option>
                    <option value="m">metres</option>
                    <option value="cm">centimetres</option>
                  </select>
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {YEARS.map(y => (
                      <label key={y} style={{ fontSize: 13, whiteSpace: 'nowrap' }}>
                        <input type="checkbox" checked={ev.years.includes(y)}
                          onChange={() => patch(ev.id, {
                            years: ev.years.includes(y)
                              ? ev.years.filter(x => x !== y)
                              : YEARS.filter(x => ev.years.includes(x) || x === y),
                          })} />
                        {' '}{y}
                      </label>
                    ))}
                  </div>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {(() => {
                    const a = attachMap[ev.id];
                    if (!a || (!a.results && !a.marked && !a.counted && !a.spots)) return null;
                    return (
                      <span className="pill attached"
                        title={ev.name + ' has ' + [
                          a.results ? a.results + ' recorded result' + (a.results === 1 ? '' : 's') : '',
                          a.marked ? a.marked + ' sheet' + (a.marked === 1 ? '' : 's') + ' with placings' : '',
                          a.counted ? a.counted + ' sheet' + (a.counted === 1 ? '' : 's') + ' with participation counted' : '',
                          a.spots ? a.spots + ' district row' + (a.spots === 1 ? '' : 's') : '',
                        ].filter(Boolean).join('; ') + '.'}>
                        ⚑ {[
                          a.results ? a.results + ' result' + (a.results === 1 ? '' : 's') : '',
                          a.marked || a.counted ? Math.max(a.marked, a.counted) + ' sheet' +
                            (Math.max(a.marked, a.counted) === 1 ? '' : 's') : '',
                        ].filter(Boolean).join(' · ') || 'district'}
                      </span>
                    );
                  })()}
                  <button className="btn-ghost btn-sm" onClick={() => remove(ev.id)}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HousesTab({ houses, setHouses, students, events, results, sheetMeta, scoring, setScoring }) {
  const [draft, setDraft] = useState({ name: '', colour: '#7c3aed' });

  const add = () => {
    if (!draft.name.trim()) return;
    setHouses(houses.concat([{ ...draft, id: uid('h'), name: draft.name.trim() }]));
    setDraft({ name: '', colour: '#7c3aed' });
  };

  const points = useMemo(
    () => tallyHousePoints(houses, students, sheetMeta, results, events, scoring),
    [houses, students, sheetMeta, results, events, scoring]
  );
  const totalFor = (id) => (points[id] || {}).total || 0;

  const leader = Math.max(1, ...houses.map(h => totalFor(h.id)));

  return (
    <div>
      <h2>Houses</h2>
      <div className="grid" style={{ marginBottom: 16 }}>
        {houses.map(h => (
          <div key={h.id} className="housecard" style={{ background: h.colour }}>
            <div style={{ fontSize: 17, fontWeight: 700 }}>{h.name}</div>
            <div style={{ fontSize: 13, marginTop: 6, opacity: .95 }}>
              {students.filter(s => s.house === h.id).length} students
            </div>
            <div style={{ fontSize: 26, fontWeight: 800, marginTop: 8 }}>{totalFor(h.id)}</div>
            <div style={{ fontSize: 11, opacity: .9, textTransform: 'uppercase', letterSpacing: '.06em' }}>points</div>
          </div>
        ))}
      </div>

      <div className="card">
        <h3>Overall tally</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          {scoring.participation} point per competitor, plus {scoring.places.join(' / ')} for
          1st / 2nd / 3rd / 4th. Participation counts and placings both come off the Results tab.
        </p>
        {houses.slice().sort((a, b) => totalFor(b.id) - totalFor(a.id)).map(h => (
          <div key={h.id} style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 3 }}>
              <strong>{h.name}</strong>
              <span className="muted">
                {(points[h.id] || {}).participation || 0} participation + {(points[h.id] || {}).placing || 0} placings
                {' '}= <strong style={{ color: '#1a2027' }}>{totalFor(h.id)}</strong>
              </span>
            </div>
            <div style={{ background: '#eef1f4', borderRadius: 999, height: 10 }}>
              <div style={{ background: h.colour, width: (totalFor(h.id) / leader * 100) + '%', height: 10, borderRadius: 999 }} />
            </div>
          </div>
        ))}
        <table style={{ marginTop: 16 }}>
          <thead><tr><th>House</th><th>Competitors</th><th>Participation</th><th>Placings</th><th>Total</th></tr></thead>
          <tbody>
            {houses.slice().sort((a, b) => totalFor(b.id) - totalFor(a.id)).map(h => (
              <tr key={h.id}>
                <td><strong>{h.name}</strong></td>
                <td>{(points[h.id] || {}).participants || 0}</td>
                <td>{(points[h.id] || {}).participation || 0}</td>
                <td>{(points[h.id] || {}).placing || 0}</td>
                <td><strong>{totalFor(h.id)}</strong></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card noprint">
        <h3>Points scheme</h3>
        <div className="row">
          <label className="fld">Per competitor
            <input type="number" min="0" value={scoring.participation}
              onChange={e => setScoring({ ...scoring, participation: parseInt(e.target.value, 10) || 0 })} />
          </label>
          {['1st', '2nd', '3rd', '4th'].map((label, i) => (
            <label className="fld" key={label}>{label}
              <input type="number" min="0" value={scoring.places[i]}
                onChange={e => {
                  const places = scoring.places.slice();
                  places[i] = parseInt(e.target.value, 10) || 0;
                  setScoring({ ...scoring, places });
                }} />
            </label>
          ))}
        </div>
      </div>

      <div className="card">
        <h3>Add a house</h3>
        <div className="row">
          <label className="fld">Name
            <input type="text" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <label className="fld">Colour
            <input type="color" value={draft.colour} style={{ height: 38, padding: 3 }}
              onChange={e => setDraft({ ...draft, colour: e.target.value })} />
          </label>
          <button className="btn" onClick={add}>Add house</button>
        </div>
      </div>
    </div>
  );
}

/*
 * Memoised so that typing in one cell re-renders one row rather than all 373.
 * Every callback it receives has to keep a stable identity for that to hold —
 * see the useCallback block in StudentsTab.
 */
const StudentRow = React.memo(function StudentRow({ s, houses, attached, onPatch, onRemove, onFocus }) {
  const set = (field) => (e) => onPatch(s.id, { [field]: e.target.value });
  return (
    <tr onFocus={() => onFocus(s.id)}>
      <td>
        <input type="text" value={s.name} style={{ marginTop: 0 }} aria-label="Student name"
          onChange={set('name')} />
      </td>
      <td>
        <select value={s.yearLevel || ''} style={{ marginTop: 0 }} aria-label="Year level" onChange={set('yearLevel')}>
          <option value="">—</option>
          {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
        </select>
      </td>
      <td>
        <select value={s.gender || 'Mixed'} style={{ marginTop: 0 }} aria-label="Gender" onChange={set('gender')}>
          {GENDERS.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
      </td>
      <td>
        <select value={s.house || ''} style={{ marginTop: 0 }} aria-label="House" onChange={set('house')}>
          <option value="">—</option>
          {houses.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
        </select>
      </td>
      <td>
        <input type="text" value={s.homegroup || ''} style={{ marginTop: 0 }} aria-label="Homegroup"
          onChange={set('homegroup')} />
      </td>
      <td>
        <input type="text" value={s.beepTest || ''} style={{ marginTop: 0 }} aria-label="Beep test"
          onChange={set('beepTest')} />
      </td>
      <td style={{ whiteSpace: 'nowrap' }}>
        {/* A flag before the button, so what is at stake is visible without
            having to click it and read a dialog. */}
        {attached && attached.any && (
          <span className="pill attached" title={attachedTitle(s.name, attached)}>
            ⚑ {[
              attached.results ? attached.results + ' result' + (attached.results === 1 ? '' : 's') : '',
              attached.placings.length ? attached.placings.length + ' placing' + (attached.placings.length === 1 ? '' : 's') : '',
              attached.spots ? attached.spots + ' district' : '',
            ].filter(Boolean).join(' · ') || 'preferences'}
          </span>
        )}
        <button className="btn-ghost btn-sm" onClick={() => onRemove(s)}>Remove</button>
      </td>
    </tr>
  );
});

const attachedTitle = (name, a) => name + ' has ' + [
  a.results ? a.results + ' recorded result' + (a.results === 1 ? '' : 's') : '',
  a.placings.length ? a.placings.map(p => ordinal(p.place) + ' in ' + p.event).join(', ') : '',
  a.spots ? a.spots + ' district team spot' + (a.spots === 1 ? '' : 's') : '',
  a.hasPrefs ? 'event preferences recorded' : '',
].filter(Boolean).join('; ') + '. Removing them takes that with it' +
  (a.points ? ', and ' + a.points + ' point' + (a.points === 1 ? '' : 's') + ' off their house' : '') + '.';

function StudentsTab({ students, setStudents, houses, results, setResults, sheetMeta, setSheetMeta,
                      events, dteam, prefs, scoring, onDropFromTeam, onDropPrefs, syncLive }) {
  const [draft, setDraft] = useState({ name: '', yearLevel: '5', gender: 'Female', house: '', homegroup: '', beepTest: '' });
  const [filterYear, setFilterYear] = useState('');
  const [filterHouse, setFilterHouse] = useState('');
  const [search, setSearch] = useState('');
  const [bulkTarget, setBulkTarget] = useState('');
  const [bulkYear, setBulkYear] = useState('6');
  const [editingId, setEditingId] = useState(null);

  const add = () => {
    if (!draft.name.trim() || !draft.house) return alert('A student needs at least a name and a house.');
    setStudents(students.concat([{ ...draft, id: uid('s'), name: draft.name.trim() }]));
    setDraft({ ...draft, name: '', homegroup: '', beepTest: '' });
  };

  /*
   * Everything a delete needs to look at, in a ref rather than in the closure:
   * removeStudent has to keep one identity for the whole session or StudentRow's
   * memo stops holding and typing a name re-renders all 373 rows.
   */
  const attachContext = useRef({});
  attachContext.current = { results, sheetMeta, dteam, prefs, events, scoring, houses };

  /*
   * The flag shown against each row. Keyed on ids only, so that typing in a
   * name — which changes `students` every keystroke — does not rebuild it and
   * knock every row out of its memo.
   */
  const attachMap = useMemo(() => {
    const m = {};
    const ctx = { results, sheetMeta, dteam, prefs, events, scoring };
    const touched = new Set();
    (results || []).forEach(r => touched.add(r.studentId));
    Object.keys(sheetMeta || {}).forEach(k => ((sheetMeta[k] || {}).places || []).forEach(sid => sid && touched.add(sid)));
    Object.keys(dteam || {}).forEach(k => {
      const raw = dteam[k];
      (Array.isArray(raw) ? raw : (raw && raw.ids) || []).forEach(sid => sid && touched.add(sid));
    });
    Object.keys(prefs || {}).forEach(sid => touched.add(sid));
    touched.forEach(sid => { m[sid] = attachmentsOfStudent(sid, ctx); });
    return m;
  }, [results, sheetMeta, dteam, prefs, events, scoring]);

  /*
   * The same child imported twice appears twice on every recording sheet and is
   * counted twice everywhere.
   *
   * Two records are the same person when NAME and HOMEGROUP match. Year level
   * and gender are left out of the key on purpose: once a roll has been doubled
   * the copies get edited apart — a year corrected on one, a gender on the other
   * — and a stricter key leaves exactly those pairs behind. Name plus homegroup
   * is unique per student in a class list, and the names that legitimately
   * repeat sit in different homegroups. Where a record has no homegroup at all
   * there is nothing to disambiguate on, so year and gender are used instead.
   *
   * The survivor is whichever copy the results and placings actually reference,
   * then whichever has a year level — so a copy that lost its year is not the
   * one kept. Everything is repointed at it before the rest are deleted.
   */
  const duplicates = useMemo(() => {
    const groups = {};
    students.forEach(st => {
      const name = String(st.name || '').trim().toLowerCase();
      const hg = String(st.homegroup || '').trim().toLowerCase();
      const k = hg ? name + '|' + hg : [name, st.yearLevel || '', st.gender || ''].join('|');
      (groups[k] = groups[k] || []).push(st);
    });
    return Object.keys(groups).map(k => groups[k]).filter(g => g.length > 1);
  }, [students]);

  const dupExtra = duplicates.reduce((n, g) => n + g.length - 1, 0);

  const mergeDuplicates = () => {
    /*
     * Merging while synced achieves nothing: student deletes are revoked on the
     * server by supabase-protect.sql, so the duplicates stay there and the next
     * pull puts them straight back. The server has to be cleared first.
     */
    if (syncLive && !confirm(
      'Sync is on, and the duplicates are on Supabase too.\n\n' +
      'Deleting students from the server is blocked, so the next pull will put them back and this ' +
      'merge will look like it did nothing.\n\n' +
      'Turn sync off first, merge, then clear and re-upload the server. Carry on anyway?')) return;

    const refCount = {};
    (results || []).forEach(r => { refCount[r.studentId] = (refCount[r.studentId] || 0) + 1; });
    Object.keys(sheetMeta || {}).forEach(k => {
      ((sheetMeta[k] || {}).places || []).forEach(sid => {
        if (sid) refCount[sid] = (refCount[sid] || 0) + 1;
      });
    });

    const remap = {};                    // duplicate id -> the id being kept
    const drop = new Set();
    duplicates.forEach(group => {
      const keep = group.slice().sort((a, b) =>
        (refCount[b.id] || 0) - (refCount[a.id] || 0) ||
        (a.yearLevel ? 0 : 1) - (b.yearLevel ? 0 : 1))[0];
      group.forEach(st => {
        if (st.id === keep.id) return;
        remap[st.id] = keep.id;
        drop.add(st.id);
      });
    });

    // Repoint results, dropping any that would duplicate one already on the keeper.
    const seenResult = new Set();
    const nextResults = [];
    (results || []).forEach(r => {
      const sid = remap[r.studentId] || r.studentId;
      const key = r.eventId + '|' + sid;
      if (seenResult.has(key)) return;
      seenResult.add(key);
      nextResults.push(sid === r.studentId ? r : { ...r, studentId: sid });
    });

    const nextMeta = {};
    Object.keys(sheetMeta || {}).forEach(k => {
      const m = sheetMeta[k];
      nextMeta[k] = { ...m, places: (m.places || []).map(sid => (sid && remap[sid]) || sid) };
    });

    const removedResults = (results || []).length - nextResults.length;
    if (!confirm('Merge ' + dupExtra + ' duplicate record' + (dupExtra === 1 ? '' : 's') + ' into ' +
      duplicates.length + ' student' + (duplicates.length === 1 ? '' : 's') + '?\n\n' +
      'Results and placings recorded against a duplicate move to the copy that is kept' +
      (removedResults ? ', and ' + removedResults + ' duplicated result row' +
        (removedResults === 1 ? '' : 's') + ' will be dropped' : '') + '.')) return;

    setResults(nextResults);
    setSheetMeta(nextMeta);
    setStudents(students.filter(st => !drop.has(st.id)));
    setEditingId(null);
  };

  // Stable identities, so StudentRow's memo actually holds. The functional form
  // of setStudents means these never need to close over the current list.
  const patch = useCallback((id, changes) => {
    setStudents(prev => prev.map(s => s.id === id ? { ...s, ...changes } : s));
  }, [setStudents]);

  /*
   * Removing a student takes their results, placings, district spot and
   * preferences with them, and the confirm says so item by item before it
   * happens. Leaving them behind was worse than it looked: an orphaned placing
   * still sits in the sheet but no longer matches a student, so it stops
   * scoring and the house loses those points with nothing on screen to explain
   * it. Either way the points go — this way it is said first.
   */
  const removeStudent = useCallback((s) => {
    const a = attachmentsOfStudent(s.id, attachContext.current);
    const house = (attachContext.current.houses.find(h => h.id === s.house) || {}).name;
    if (!a.any) {
      if (!confirm('Remove ' + s.name + '?\n\nNothing is recorded against them.')) return;
    } else {
      const detail = listLines([
        a.results ? a.results + ' recorded result' + (a.results === 1 ? '' : 's') : '',
        a.placings.length
          ? a.placings.length + ' placing' + (a.placings.length === 1 ? '' : 's') + ' — ' +
            a.placings.map(p => ordinal(p.place) + ' in ' + p.event).join(', ')
          : '',
        a.spots ? a.spots + ' district team spot' + (a.spots === 1 ? '' : 's') : '',
        a.hasPrefs ? 'their event preferences' : '',
      ]);
      if (!confirm(
        'Remove ' + s.name + '?\n\n' +
        'This also removes:\n' + detail + '\n\n' +
        (a.points
          ? (house || 'Their house') + ' loses ' + a.points + ' point' + (a.points === 1 ? '' : 's') +
            ' from those placings.\n\n'
          : '') +
        'It cannot be undone. Take a backup from the Import tab first if you are not sure.')) return;
    }

    if (a.results) setResults(prev => prev.filter(r => r.studentId !== s.id));
    if (a.placings.length) {
      setSheetMeta(prev => {
        const next = {};
        Object.keys(prev).forEach(k => {
          const m = prev[k];
          next[k] = ((m.places || []).indexOf(s.id) >= 0)
            ? { ...m, places: (m.places || []).map(sid => sid === s.id ? '' : sid) }
            : m;
        });
        return next;
      });
    }
    if (a.spots) onDropFromTeam(s.id);
    if (a.hasPrefs) onDropPrefs(s.id);
    setStudents(prev => prev.filter(x => x.id !== s.id));
  }, [setStudents, setResults, setSheetMeta, onDropFromTeam, onDropPrefs]);

  const noteEditing = useCallback((id) => setEditingId(id), []);

  const matches = (s) => (
    (filterYear === '' || (filterYear === '__none' ? !s.yearLevel : s.yearLevel === filterYear)) &&
    (!filterHouse || s.house === filterHouse) &&
    (!search || s.name.toLowerCase().includes(search.toLowerCase()))
  );

  /*
   * The row being edited stays put even once it stops matching the filters —
   * otherwise correcting a name while searching for it yanks the row out from
   * under the cursor on the first keystroke. Changing a filter clears the pin.
   */
  const matching = students.filter(s => matches(s) || s.id === editingId);

  /*
   * Only ever render a slice. A whole school is ~400 rows of six controls each,
   * and re-rendering that on every keystroke made typing a name visibly lag.
   * The row being edited is always kept in the slice so it can't scroll out of
   * existence underneath the cursor.
   */
  const shown = matching.length > ROW_LIMIT
    ? (() => {
        const head = matching.slice(0, ROW_LIMIT);
        if (editingId && !head.some(s => s.id === editingId)) {
          const pinned = matching.find(s => s.id === editingId);
          if (pinned) return [pinned].concat(head.slice(0, ROW_LIMIT - 1));
        }
        return head;
      })()
    : matching;
  const hidden = matching.length - shown.length;

  const homegroups = Array.from(new Set(students.map(s => s.homegroup).filter(Boolean))).sort();

  const applyBulk = () => {
    if (!bulkTarget) return alert('Choose which students to change.');
    let match;
    if (bulkTarget === '__shown') {
      const ids = new Set(shown.map(s => s.id));
      match = (s) => ids.has(s.id);
    } else if (bulkTarget.startsWith('hg:')) {
      const hg = bulkTarget.slice(3);
      match = (s) => s.homegroup === hg;
    } else {
      const yr = bulkTarget.slice(3);
      match = (s) => (s.yearLevel || '') === yr;
    }
    const moving = students.filter(s => match(s) && (s.yearLevel || '') !== bulkYear);
    const count = students.filter(match).length;
    if (!count) return alert('That matches nobody.');

    /*
     * A year level is half of a division, so moving one moves the student to a
     * different sheet. Anything already marked against them on the old sheet
     * stays where it is and stops counting — same silent loss as deleting them,
     * so it is counted and said first.
     */
    const affected = moving.filter(s => (attachMap[s.id] || {}).any);
    const points = affected.reduce((n, s) => n + (attachMap[s.id].points || 0), 0);
    const warning = affected.length
      ? '\n\n' + affected.length + ' of them ' + (affected.length === 1 ? 'has' : 'have') +
        ' results or placings already recorded in their current year' +
        (points ? ', worth ' + points + ' point' + (points === 1 ? '' : 's') : '') +
        '. Those stay on the sheet they were recorded on, where they will no longer match' +
        ' the student — check the Results tab for those events afterwards.'
      : '';
    if (!confirm('Move ' + count + ' student' + (count === 1 ? '' : 's') + ' to Year ' + bulkYear + '?' + warning)) return;
    setStudents(students.map(s => match(s) ? { ...s, yearLevel: bulkYear } : s));
    setBulkTarget('');
  };

  const houseName = (id) => (houses.find(h => h.id === id) || {}).name || '—';

  return (
    <div>
      <h2>Students ({students.length})</h2>

      {dupExtra > 0 && (
        <div className="card">
          <div className="warn" style={{ marginBottom: 12 }}>
            <strong>{dupExtra} duplicate record{dupExtra === 1 ? '' : 's'}</strong> — {duplicates.length}
            {' '}student{duplicates.length === 1 ? ' is' : 's are'} in the list more than once, so
            {' '}{duplicates.length === 1 ? 'they appear' : 'they each appear'} twice on the recording
            sheets and are counted twice in participation.
          </div>
          <div className="scroll" style={{ maxHeight: 220, marginBottom: 12 }}>
            <table>
              <thead><tr><th>Name</th><th>Year</th><th>Gender</th><th>Homegroup</th><th>Copies</th></tr></thead>
              <tbody>
                {duplicates.slice(0, 40).map(g => (
                  <tr key={g[0].id}>
                    <td>{g[0].name}</td><td>{g[0].yearLevel}</td><td>{g[0].gender}</td>
                    <td className="muted">{g[0].homegroup}</td><td>{g.length}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {duplicates.length > 40 && <p className="muted">…and {duplicates.length - 40} more.</p>}
          <button className="btn" onClick={mergeDuplicates}>
            Merge duplicates — keeps one of each, moves their results across
          </button>
        </div>
      )}

      <div className="card">
        <h3>Add a student</h3>
        <div className="row">
          <label className="fld">Name
            <input type="text" value={draft.name} placeholder="First name + initial"
              onChange={e => setDraft({ ...draft, name: e.target.value })} />
          </label>
          <label className="fld">Year
            <select value={draft.yearLevel} onChange={e => setDraft({ ...draft, yearLevel: e.target.value })}>
              {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <label className="fld">Gender
            <select value={draft.gender} onChange={e => setDraft({ ...draft, gender: e.target.value })}>
              <option>Female</option><option>Male</option><option>Mixed</option>
            </select>
          </label>
          <label className="fld">House
            <select value={draft.house} onChange={e => setDraft({ ...draft, house: e.target.value })}>
              <option value="">Select…</option>
              {houses.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </label>
          <label className="fld">Homegroup
            <input type="text" value={draft.homegroup} onChange={e => setDraft({ ...draft, homegroup: e.target.value })} />
          </label>
          <label className="fld">Beep test
            <input type="text" value={draft.beepTest} placeholder="e.g. 7.4"
              onChange={e => setDraft({ ...draft, beepTest: e.target.value })} />
          </label>
          <button className="btn" onClick={add}>Add</button>
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ marginBottom: 12 }}>
          <label className="fld">Search
            <input type="text" value={search} placeholder="name…"
              onChange={e => { setSearch(e.target.value); setEditingId(null); }} />
          </label>
          <label className="fld">Year
            <select value={filterYear} onChange={e => { setFilterYear(e.target.value); setEditingId(null); }}>
              <option value="">All years</option>
              {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
              <option value="__none">No year level set</option>
            </select>
          </label>
          <label className="fld">House
            <select value={filterHouse} onChange={e => { setFilterHouse(e.target.value); setEditingId(null); }}>
              <option value="">All houses</option>
              {houses.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </label>
        </div>
        <p className="muted" style={{ margin: '0 0 10px' }}>
          Every column is editable straight in the table — name, year, gender, house, homegroup and
          beep test. Edits save as you make them.
        </p>
        <div className="scroll">
          <table>
            <thead>
              <tr><th>Name</th><th style={{ width: 100 }}>Year</th><th style={{ width: 115 }}>Gender</th>
                <th style={{ width: 140 }}>House</th><th style={{ width: 110 }}>Homegroup</th>
                <th style={{ width: 100 }}>Beep test</th><th style={{ width: 90 }}></th></tr>
            </thead>
            <tbody>
              {shown.map(s => (
                <StudentRow key={s.id} s={s} houses={houses} attached={attachMap[s.id]}
                  onPatch={patch} onRemove={removeStudent} onFocus={noteEditing} />
              ))}
            </tbody>
          </table>
        </div>
        {shown.length === 0 && <p className="muted" style={{ marginTop: 12 }}>No students match. Use the Import tab to load a class list.</p>}
        {hidden > 0 && (
          <p className="muted" style={{ marginTop: 10 }}>
            Showing {shown.length} of {matching.length}. Search or filter to reach the other {hidden}.
          </p>
        )}
      </div>

      <div className="card">
        <h3>Change a whole group at once</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          For year rollover, or when a homegroup code didn't give the right year level on import.
        </p>
        <div className="row">
          <label className="fld">These students
            <select value={bulkTarget} onChange={e => setBulkTarget(e.target.value)}>
              <option value="">Select…</option>
              <option value="__shown">the {shown.length} shown by the filters above</option>
              {homegroups.map(hg => (
                <option key={hg} value={'hg:' + hg}>homegroup {hg} ({students.filter(s => s.homegroup === hg).length})</option>
              ))}
              {YEARS.map(y => (
                <option key={y} value={'yr:' + y}>everyone in Year {y} ({students.filter(s => s.yearLevel === y).length})</option>
              ))}
              <option value="yr:">everyone with no year level ({students.filter(s => !s.yearLevel).length})</option>
            </select>
          </label>
          <label className="fld">become Year
            <select value={bulkYear} onChange={e => setBulkYear(e.target.value)}>
              {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <button className="btn" onClick={applyBulk}>Apply</button>
        </div>
      </div>
    </div>
  );
}

function ImportTab({ students, setStudents, houses, setHouses, onBackup, onRestore }) {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState(null);

  // Accepts our JSON export, or tab/comma separated rows: Name, Gender, Homegroup, House
  const parse = (raw) => {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    if (trimmed[0] === '[') {
      try {
        const arr = JSON.parse(trimmed);
        if (!Array.isArray(arr)) throw new Error('not an array');
        return arr.map(normalise).filter(Boolean);
      } catch (err) {
        alert('That JSON could not be read: ' + err.message);
        return [];
      }
    }
    return trimmed.split(/\r?\n/).map(line => {
      const cells = line.split(/\t|,/).map(c => c.trim());
      if (cells.length < 2) return null;
      if (/^name$/i.test(cells[0])) return null; // header row
      return normalise({ name: cells[0], gender: cells[1], homegroup: cells[2], house: cells[3] });
    }).filter(Boolean);
  };

  // Year level comes from the homegroup code where possible (I3P -> 3, L5E -> 5).
  const normalise = (raw) => {
    if (!raw || !raw.name) return null;
    const homegroup = raw.homegroup || '';
    const digit = String(homegroup).match(/\d/);
    const yearLevel = String(raw.yearLevel || raw.year || (digit ? digit[0] : '')) || '';
    const gender = raw.gender ? (String(raw.gender)[0].toUpperCase() === 'M' ? 'Male' : 'Female') : 'Mixed';
    return {
      name: String(raw.name).trim(),
      yearLevel,
      gender,
      homegroup,
      houseName: String(raw.house || '').trim(),
      beepTest: raw.beepTest || '',
    };
  };

  const start = (rows) => {
    if (!rows.length) return alert('Nothing to import.');
    setPreview(rows);
  };

  const onFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => start(parse(String(ev.target.result)));
    reader.readAsText(file);
    e.target.value = '';
  };

  // Match houses by name, creating any the file mentions that we don't have yet.
  const confirm_ = () => {
    let workingHouses = houses.slice();
    const findHouse = (name) => {
      if (!name) return null;
      const hit = workingHouses.find(h => h.name.toLowerCase() === name.toLowerCase());
      if (hit) return hit.id;
      const palette = ['#7c3aed', '#db2777', '#0d9488', '#b45309', '#4f46e5', '#be123c'];
      const created = { id: uid('h'), name: name.charAt(0) + name.slice(1).toLowerCase(), colour: palette[workingHouses.length % palette.length] };
      workingHouses = workingHouses.concat([created]);
      return created.id;
    };

    const existing = new Set(students.map(s => (s.name + '|' + s.homegroup).toLowerCase()));
    const fresh = [];
    preview.forEach(r => {
      const key = (r.name + '|' + r.homegroup).toLowerCase();
      if (existing.has(key)) return; // already loaded — don't duplicate
      existing.add(key);
      fresh.push({
        id: uid('s'),
        name: r.name,
        yearLevel: r.yearLevel,
        gender: r.gender,
        homegroup: r.homegroup,
        house: findHouse(r.houseName),
        beepTest: r.beepTest,
      });
    });

    if (workingHouses.length !== houses.length) setHouses(workingHouses);
    setStudents(students.concat(fresh));
    setPreview(null);
    setText('');
    alert('Imported ' + fresh.length + ' students. ' + (preview.length - fresh.length) + ' were already on the list and were skipped.');
  };

  if (preview) {
    const skipped = preview.filter(r => !r.yearLevel).length;
    return (
      <div>
        <h2>Check before importing</h2>
        <div className="good">
          <strong>{preview.length} students ready.</strong>{' '}
          {skipped > 0 && <span>{skipped} have no year level — set those on the Students tab afterwards.</span>}
        </div>
        <div className="card">
          <div className="scroll">
            <table>
              <thead><tr><th>Name</th><th>Year</th><th>Gender</th><th>Homegroup</th><th>House</th></tr></thead>
              <tbody>
                {preview.map((r, i) => (
                  <tr key={i}>
                    <td>{r.name}</td><td>{r.yearLevel || '—'}</td><td>{r.gender}</td>
                    <td className="muted">{r.homegroup}</td><td>{r.houseName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="row" style={{ marginTop: 14 }}>
            <button className="btn-ok" onClick={confirm_}>Import {preview.length} students</button>
            <button className="btn-ghost" onClick={() => setPreview(null)}>Cancel</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2>Import students</h2>
      <div className="card">
        <h3>Paste from a spreadsheet</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Copy the columns straight out of Excel in this order — <strong>Name, Gender, Homegroup, House</strong> —
          and paste them here. A header row is ignored. Year level is read from the homegroup code (I3P → 3).
        </p>
        <textarea rows="8" value={text} onChange={e => setText(e.target.value)}
          placeholder={'Tommy A\tMale\tI3P\tFREEMAN\nCiara A\tFemale\tI3L\tGOLDSTEIN'} />
        <div style={{ marginTop: 10 }}>
          <button className="btn" onClick={() => start(parse(text))}>Preview import</button>
        </div>
      </div>

      <div className="card">
        <h3>Or load a file</h3>
        <p className="muted" style={{ marginTop: 0 }}>A .json export from this tool, or a .csv/.txt with the same four columns.</p>
        <input type="file" accept=".json,.csv,.txt" onChange={onFile} />
      </div>

      <div className="card">
        <h3>Backup and restore</h3>
        <div className="warn">
          Everything is kept in <strong>this browser, on this address</strong> and nowhere else. It is
          lost if the browsing data is cleared, and it does not follow you to another computer — or to
          a different URL, so a re-drag onto Netlify Drop that creates a <em>new</em> site starts
          empty. Take a backup at the end of every session.
        </div>
        <div className="row">
          <button className="btn" style={{ flex: '0 0 auto' }} onClick={onBackup}>
            Download a full backup
          </button>
          <label className="fld" style={{ flex: '1 1 240px' }}>Restore from a backup
            <input type="file" accept=".json" onChange={e => {
              if (e.target.files[0]) onRestore(e.target.files[0]);
              e.target.value = '';
            }} />
          </label>
        </div>
        <p className="muted" style={{ marginBottom: 0 }}>
          The backup holds students, houses, events, results, participation counts and settings —
          everything needed to pick up where you left off.
        </p>
      </div>
    </div>
  );
}

function ResultsTab({ events, students, results, setResults, houses, sheetMeta, setSheetMeta, scoring }) {
  const [eventId, setEventId] = useState(events.length ? events[0].id : '');
  const [year, setYear] = useState('5');
  const [gender, setGender] = useState('Female');

  const [sheetNo, setSheetNo] = useState('');
  const [showOutstanding, setShowOutstanding] = useState(false);

  const event = events.find(e => e.id === eventId);
  const division = year + ' ' + gender;
  const studentsById = useMemo(() => {
    const m = {}; students.forEach(s => { m[s.id] = s; }); return m;
  }, [students]);
  const sheetIndex = useMemo(() => buildSheetIndex(events, students), [events, students]);
  const currentSheetNo = sheetIndex.byKey[divKey(eventId, division)];
  const metaKey = divKey(eventId, division);
  const meta = sheetMeta[metaKey] || { counts: {}, places: ['', '', '', ''], received: false };

  // Touching anything on a sheet means the paper is in hand.
  const writeMeta = (changes) => setSheetMeta({ ...sheetMeta, [metaKey]: { ...meta, received: true, ...changes } });
  const setCount = (houseId, v) => writeMeta({ counts: { ...meta.counts, [houseId]: v } });
  /*
   * Places are marked against the student on the sheet below rather than picked
   * from a list: the scorer reads down the paper and puts a 1 next to whoever
   * won. A student can only hold one place and a place only one student, so
   * assigning either end clears whatever it displaces — duplicates are not
   * possible to create.
   *
   * Displacing somebody is the dangerous half of that. Typing a 1 into the wrong
   * row used to take 1st off whoever held it without a word, and nothing on the
   * screen said so — the other row simply went blank further up the page. So the
   * swap is now named before it happens, and an Undo stays on screen after it in
   * case the confirm was clicked through.
   */
  const [placeUndo, setPlaceUndo] = useState(null);
  const assignPlace = (studentId, value) => {
    const places = (meta.places || ['', '', '', '']).slice();
    const n = parseInt(value, 10);
    const valid = n >= 1 && n <= places.length;
    const displaced = valid && places[n - 1] && places[n - 1] !== studentId ? places[n - 1] : '';
    const nameOf = (id) => (studentsById[id] || {}).name || 'someone else';

    if (displaced) {
      const ok = confirm(
        ordinal(n) + ' is currently ' + nameOf(displaced) + '.\n\n' +
        'Give ' + ordinal(n) + ' to ' + nameOf(studentId) + ' instead?\n' +
        nameOf(displaced) + ' will be left without a place.');
      if (!ok) return;
    }

    const before = places.slice();
    for (let i = 0; i < places.length; i++) if (places[i] === studentId) places[i] = '';
    if (valid) places[n - 1] = studentId;
    writeMeta({ places });
    setPlaceUndo(displaced
      ? { key: metaKey, places: before,
          text: nameOf(studentId) + ' took ' + ordinal(n) + ' from ' + nameOf(displaced) +
                ', who now has no place.' }
      : null);
  };
  const undoPlace = () => {
    writeMeta({ places: placeUndo.places });
    setPlaceUndo(null);
  };
  const placeOf = (studentId) => {
    const i = (meta.places || []).indexOf(studentId);
    return i < 0 ? '' : String(i + 1);
  };
  const anyNamed = (meta.places || []).some(Boolean);


  const entered = Object.keys(sheetMeta).filter(k => sheetMeta[k] && sheetMeta[k].received);
  const outstanding = [];
  for (let i = 1; i <= sheetIndex.total; i++) {
    const t = sheetIndex.byNumber[i];
    const k = divKey(t.eventId, t.year + ' ' + t.gender);
    if (!sheetMeta[k] || !sheetMeta[k].received) {
      outstanding.push({ no: i, label: t.event.name + ' — Year ' + t.year + ' ' + t.gender });
    }
  }

  // Typing the number off a returned recording sheet sets all three selects.
  const goToSheet = (value) => {
    setSheetNo(value);
    const hit = sheetIndex.byNumber[parseInt(value, 10)];
    if (!hit) return;
    setEventId(hit.eventId);
    setYear(hit.year);
    setGender(hit.gender);
  };
  const sheetLookup = sheetIndex.byNumber[parseInt(sheetNo, 10)];

  const houseName = (id) => (houses.find(h => h.id === id) || {}).name || '';

  // Same order as the printed recording sheet — see byHouseThenName.
  const inDivision = students
    .filter(s => s.yearLevel === year && s.gender === gender)
    .sort(byHouseThenName(houses));

  /*
   * Finding one child in a list of sixty. The search narrows the sheet below
   * only — the participation counts and "Fill from class list" still work off
   * the whole division, so a filter left in the box cannot quietly undercount a
   * house. If the name is not in this division but is somewhere else, say where
   * and offer to jump: on carnival day a sheet lands in the wrong pile often
   * enough that hunting for the right division by hand is the slow part.
   */
  const [find, setFind] = useState('');
  const needle = find.trim().toLowerCase();
  const shown = needle
    ? inDivision.filter(s => s.name.toLowerCase().includes(needle))
    : inDivision;
  const elsewhere = (needle && shown.length === 0)
    ? students.filter(s => s.name.toLowerCase().includes(needle)).slice(0, 6)
    : [];

  const ranked = event ? rankFor(results, event.id, division, event.scoring, studentsById) : [];

  /*
   * What this one sheet contributes, so it can be checked against the paper.
   * The results have to be narrowed to this division as well as this event —
   * filtering on the event alone pulled the other division's placings in, so
   * the girls' sheet showed the boys' points too.
   */
  const sheetPoints = useMemo(() => {
    const here = results.filter(r => {
      const st = studentsById[r.studentId];
      return r.eventId === eventId && st && divisionOf(st) === division;
    });
    return tallyHousePoints(houses, students, { [metaKey]: meta }, here, event ? [event] : [], scoring);
  }, [houses, students, studentsById, metaKey, meta, results, eventId, division, event, scoring]);
  const resultFor = (sid) => {
    const r = results.find(x => x.eventId === eventId && x.studentId === sid);
    return r ? r.result : '';
  };
  const setResult = (sid, value) => {
    const idx = results.findIndex(x => x.eventId === eventId && x.studentId === sid);
    if (idx >= 0) {
      const next = results.slice();
      if (!value.trim()) next.splice(idx, 1); else next[idx] = { ...next[idx], result: value };
      setResults(next);
    } else if (value.trim()) {
      setResults(results.concat([{ id: uid('r'), eventId, studentId: sid, result: value, date: new Date().toISOString().slice(0, 10) }]));
    }
  };

  return (
    <div>
      <h2>Results</h2>

      {sheetIndex.total > 0 && (
        <div className="card noprint">
          <div className="row" style={{ alignItems: 'center' }}>
            <div style={{ flex: '1 1 auto', fontSize: 15 }}>
              <strong>{entered.length}</strong> of {sheetIndex.total} sheets entered
              {outstanding.length > 0
                ? <span className="muted"> · {outstanding.length} still to come in</span>
                : <span style={{ color: '#15803d', fontWeight: 600 }}> · all in ✓</span>}
            </div>
            {outstanding.length > 0 && (
              <button className="btn-ghost btn-sm" style={{ flex: '0 0 auto' }}
                onClick={() => setShowOutstanding(!showOutstanding)}>
                {showOutstanding ? 'hide' : 'which ones?'}
              </button>
            )}
          </div>
          <div style={{ background: '#eef1f4', borderRadius: 999, height: 10, marginTop: 10 }}>
            <div style={{ background: '#2563eb', height: 10, borderRadius: 999,
              width: (entered.length / sheetIndex.total * 100) + '%' }} />
          </div>
          {showOutstanding && (
            <div className="scroll" style={{ marginTop: 12 }}>
              <table>
                <thead><tr><th style={{ width: 70 }}>Sheet</th><th>Event and division</th><th style={{ width: 80 }}></th></tr></thead>
                <tbody>
                  {outstanding.map(o => (
                    <tr key={o.no}>
                      <td><strong>{o.no}</strong></td>
                      <td>{o.label}</td>
                      <td><button className="btn-ghost btn-sm"
                        onClick={() => { goToSheet(String(o.no)); setShowOutstanding(false); }}>Open</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="card noprint">
        <div className="row" style={{ alignItems: 'flex-start' }}>
          <label className="fld" style={{ flex: '0 0 150px' }}>Sheet number
            <input type="number" min="1" max={sheetIndex.total} value={sheetNo} placeholder="type it in"
              onChange={e => goToSheet(e.target.value)} />
          </label>
          <div style={{ flex: '2 1 260px', paddingBottom: 10 }} className="muted">
            {sheetIndex.total === 0
              ? 'Sheet numbers appear once the class list is loaded — see the Import tab.'
              : sheetNo === '' ? 'Straight off the top of a returned recording sheet — it jumps to that list.'
                : sheetLookup
                  ? <span>→ <strong>{sheetLookup.event.name}</strong>, Year {sheetLookup.year} {sheetLookup.gender}</span>
                  : <span style={{ color: '#b45309' }}>No sheet {sheetNo}. They run 1 to {sheetIndex.total}.</span>}
          </div>
        </div>
        <div className="row">
          <label className="fld">Event
            <select value={eventId} onChange={e => { setEventId(e.target.value); setSheetNo(''); }}>
              {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
            </select>
          </label>
          <label className="fld">Year
            <select value={year} onChange={e => { setYear(e.target.value); setSheetNo(''); }}>
              {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <label className="fld">Gender
            <select value={gender} onChange={e => { setGender(e.target.value); setSheetNo(''); }}>
              {GENDERS.map(g => <option key={g} value={g}>{g}</option>)}
            </select>
          </label>
        </div>
        {event && !event.years.includes(year) && (
          <div className="warn">{event.name} is not normally run at Year {year}. You can still record it.</div>
        )}
      </div>

      {event && inDivision.length > 0 && (
        <div className="card noprint">
          <h3>House points for this sheet</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            {scoring.participation} point per competitor. Count them off the sheet — the class list
            has {inDivision.length} in this division, but only those who actually competed score.
            Placings are worth {scoring.places.join(' / ')} on top — put a 1, 2, 3 or 4 in the
            <strong> Place</strong> column against the placegetters on the sheet below.
          </p>
          <div className="row">
            {houses.map(h => (
              <label className="fld" key={h.id}>
                <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: h.colour, marginRight: 6 }} />
                {h.name}
                <input type="number" min="0" placeholder="0"
                  value={meta.counts[h.id] === undefined ? '' : meta.counts[h.id]}
                  onChange={e => setCount(h.id, e.target.value)} />
              </label>
            ))}
            <button className="btn-ghost" style={{ flex: '0 0 auto' }}
              onClick={() => {
                const counts = {};
                houses.forEach(h => { counts[h.id] = inDivision.filter(s2 => s2.house === h.id).length; });
                writeMeta({ counts });
              }}>Fill from class list</button>
          </div>

          <table style={{ marginTop: 6 }}>
            <thead><tr><th>House</th><th>Competed</th><th>Participation</th><th>Placings</th><th>Total</th></tr></thead>
            <tbody>
              {houses.map(h => (
                <tr key={h.id}>
                  <td><strong>{h.name}</strong></td>
                  <td>{sheetPoints[h.id].participants}</td>
                  <td>{sheetPoints[h.id].participation}</td>
                  <td>{sheetPoints[h.id].placing}</td>
                  <td><strong>{sheetPoints[h.id].total}</strong></td>
                </tr>
              ))}
            </tbody>
          </table>
          <label style={{ fontSize: 14, display: 'block', marginTop: 12 }}>
            <input type="checkbox" checked={!!meta.received}
              onChange={e => setSheetMeta({ ...sheetMeta, [metaKey]: { ...meta, received: e.target.checked } })} />
            {' '}Sheet handed in
          </label>
        </div>
      )}

      {!event ? <p className="muted">Add an event first.</p> : (
        <div className="card">
          <h3>
            {currentSheetNo && <span className="pill" style={{ background: '#e0e7ff', marginRight: 8 }}>Sheet {currentSheetNo}</span>}
            {event.name} — Year {year} {gender}
            <span className="muted" style={{ fontWeight: 400 }}>
              {' '}· {event.scoring === 'lower' ? 'fastest wins' : 'furthest wins'} · enter in {event.unit}
              {event.scoring === 'lower' ? ' (or m:ss.s)' : ''}
            </span>
          </h3>
          {placeUndo && placeUndo.key === metaKey && (
            <div className="warn noprint" style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <span style={{ flex: '1 1 240px' }}>{placeUndo.text}</span>
              <button className="btn-ghost btn-sm" style={{ flex: '0 0 auto' }} onClick={undoPlace}>Undo</button>
              <button className="btn-ghost btn-sm" style={{ flex: '0 0 auto' }} onClick={() => setPlaceUndo(null)}>Dismiss</button>
            </div>
          )}

          {inDivision.length > 0 && (
            <div className="row noprint" style={{ alignItems: 'flex-start' }}>
              <label className="fld" style={{ flex: '1 1 260px' }}>Find a student
                <input type="text" value={find} placeholder="type part of a name"
                  aria-label="Find a student on this sheet"
                  onChange={e => setFind(e.target.value)} />
              </label>
              <div style={{ flex: '2 1 260px', paddingBottom: 10 }} className="muted">
                {!needle
                  ? 'Narrows the list below. The house points above always count the whole division.'
                  : shown.length > 0
                    ? <span>Showing <strong>{shown.length}</strong> of {inDivision.length}.{' '}
                        <button className="linkish" onClick={() => setFind('')}>show all</button></span>
                    : <span style={{ color: '#b45309' }}>
                        Nobody in Year {year} {gender} matches “{find.trim()}”.{' '}
                        <button className="linkish" onClick={() => setFind('')}>show all</button>
                      </span>}
              </div>
            </div>
          )}

          {elsewhere.length > 0 && (
            <div className="warn noprint">
              <strong>That name is in {elsewhere.length === 1 ? 'another division' : 'other divisions'}:</strong>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 6 }}>
                {elsewhere.map(s => (
                  <button key={s.id} className="btn-ghost btn-sm"
                    onClick={() => { setYear(s.yearLevel); setGender(s.gender); setSheetNo(''); setFind(''); }}>
                    {s.name} — Year {s.yearLevel} {s.gender}
                  </button>
                ))}
              </div>
            </div>
          )}

          {inDivision.length === 0 ? (
            <p className="muted">No students in Year {year} {gender}. Check the Students tab.</p>
          ) : (
            <div className="scroll">
              <table>
                <thead><tr><th style={{ width: 76 }}>Place</th><th>Student</th><th>House</th><th style={{ width: 140 }}>Result</th></tr></thead>
                <tbody>
                  {shown.map(s => {
                    const r = ranked.find(x => x.studentId === s.id);
                    const mine = placeOf(s.id);
                    // Once anyone is named, the named set governs; until then the
                    // ranking of the typed times shows through as a suggestion.
                    const shown = anyNamed ? mine : '';
                    const hint = anyNamed ? '' : (r ? String(r.place) : '');
                    const effective = Number(shown || hint);
                    const cls = effective >= 1 && effective <= 3 ? 'medal' + effective : '';
                    return (
                      <tr key={s.id} className={cls}>
                        <td>
                          <input type="number" min="1" max="4" value={shown} placeholder={hint || '—'}
                            aria-label={'Place for ' + s.name} className="placebox"
                            style={{ marginTop: 0 }}
                            onChange={e => assignPlace(s.id, e.target.value)} />
                        </td>
                        <td>{s.name}</td>
                        <td className="muted">{houseName(s.house)}</td>
                        <td>
                          <input type="text" value={resultFor(s.id)} placeholder="—" style={{ marginTop: 0 }}
                            onChange={e => setResult(s.id, e.target.value)} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DistrictTab({ events, students, results, prefs, setPrefs, settings, setSettings, sheetMeta, dteam, setDteam, houses }) {
  const [expanded, setExpanded] = useState(null);
  const studentsById = useMemo(() => {
    const m = {}; students.forEach(s => { m[s.id] = s; }); return m;
  }, [students]);

  const alloc = useMemo(
    () => allocateDistrict(events, results, students, prefs, settings, sheetMeta),
    [events, results, students, prefs, settings, sheetMeta]
  );

  const eventName = (id) => (events.find(e => e.id === id) || {}).name || '?';
  const nameOf = (id) => (studentsById[id] || {}).name || 'Unknown';

  const setChosen = (studentId, eventId, on) => {
    const cur = (prefs[studentId] && prefs[studentId].chosen) || [];
    let next;
    if (on) {
      if (cur.length >= settings.maxPerStudent) {
        return alert('Only ' + settings.maxPerStudent + ' individual events each. Untick one first.');
      }
      next = cur.concat([eventId]);
    } else {
      next = cur.filter(x => x !== eventId);
    }
    setPrefs({ ...prefs, [studentId]: { ...(prefs[studentId] || {}), chosen: next } });
  };

  const withResults = alloc.contests.length > 0;
  const houseName = (id) => (houses.find(h => h.id === id) || {}).name || '';

  /*
   * The team sheet covers the whole district programme, not only what has been
   * run: every year level, every event that runs at it, whether or not a result
   * exists. An event still to come shows empty slots you can type into, so the
   * sheet can be filled in ahead of the day.
   *
   * Placings fill it by default. A name typed into a row is a manual override
   * and that row stops being recalculated — there is a Reset on it to hand the
   * row back to the automatic pick.
   */
  const programme = useMemo(() => {
    const populated = new Set();
    students.forEach(st => { if (st.yearLevel) populated.add(st.yearLevel + ' ' + (st.gender || 'Mixed')); });
    const byYear = {};
    YEARS.forEach(y => {
      events.forEach(ev => {
        if (!ev.years.includes(y)) return;
        GENDERS.forEach(g => {
          if (!populated.has(y + ' ' + g)) return;
          (byYear[y] = byYear[y] || []).push({ event: ev, year: y, gender: g, division: y + ' ' + g });
        });
      });
    });
    return byYear;
  }, [events, students]);

  /*
   * Year levels can be switched off — seven years of programme is a long scroll
   * when only one is being worked on, and a hidden year is left out of print
   * too, so a single year can be run off for the teacher taking it. Hiding never
   * changes the allocation: rows still exist and still hold their spots.
   */
  const [hiddenYears, setHiddenYears] = useState({});
  const toggleYear = (y) => setHiddenYears(h => ({ ...h, [y]: !h[y] }));
  const yearsInProgramme = YEARS.filter(y => programme[y]);
  const shownYears = yearsInProgramme.filter(y => !hiddenYears[y]);

  const rowKey = (r) => divKey(r.event.id, r.division);

  // Stored as { ids, marks }. Earlier versions stored a bare array of ids, so
  // that shape is still read.
  const entryOf = (r) => {
    const raw = dteam[rowKey(r)];
    if (!raw) return {};
    return Array.isArray(raw) ? { ids: raw } : raw;
  };
  const autoOf = (r) => (alloc.filled[rowKey(r)] || []).map(x => x.studentId);
  const manualOf = (r) => entryOf(r).ids;
  const teamOf = (r) => manualOf(r) || autoOf(r);

  // What they did in this event, if it has been recorded.
  const recordedMark = (r, studentId) => {
    const hit = (results || []).find(x => x.eventId === r.event.id && x.studentId === studentId);
    return hit ? hit.result : '';
  };
  const markOf = (r, i) => {
    const e = entryOf(r);
    if (e.marks && e.marks[i] !== undefined && e.marks[i] !== '') return e.marks[i];
    return recordedMark(r, teamOf(r)[i]);
  };

  const writeEntry = (r, changes) => {
    const key = rowKey(r);
    setDteam({ ...dteam, [key]: { ...entryOf(r), ...changes } });
  };
  const setSlot = (r, i, studentId) => {
    const current = (manualOf(r) || autoOf(r)).slice();
    while (current.length < settings.spotsPerEvent) current.push('');
    current[i] = studentId;
    writeEntry(r, { ids: current });
  };
  const setMark = (r, i, value) => {
    const marks = (entryOf(r).marks || []).slice();
    while (marks.length < settings.spotsPerEvent) marks.push('');
    marks[i] = value;
    writeEntry(r, { marks });
  };

  // The first four in this event and division, with what they did — shown on
  // hovering the event name, so the pick can be sanity-checked without leaving
  // the page.
  const topFour = (r) => {
    const c = alloc.contests.find(x => x.event.id === r.event.id && x.division === r.division);
    if (!c) return [];
    return c.ranked.slice(0, 4).map(x => ({
      place: x.place,
      name: (studentsById[x.studentId] || {}).name || '?',
      house: houseName((studentsById[x.studentId] || {}).house),
      mark: x.result || recordedMark(r, x.studentId) || '',
    }));
  };
  const resetRow = (r) => {
    const next = { ...dteam };
    delete next[rowKey(r)];
    setDteam(next);
  };

  // Who could fill a slot, with the evidence for choosing them.
  const candidatesFor = (r) => {
    const ranked = (alloc.contests.find(c => c.event.id === r.event.id && c.division === r.division) || {}).ranked || [];
    const placeOf = {};
    ranked.forEach(x => { placeOf[x.studentId] = x.place; });
    return students
      .filter(st => st.yearLevel === r.year && (st.gender || 'Mixed') === r.gender)
      .map(st => {
        const bits = [st.name, houseName(st.house)];
        if (placeOf[st.id]) bits.push(['1st', '2nd', '3rd', '4th'][placeOf[st.id] - 1] || (placeOf[st.id] + 'th'));
        const held = (alloc.held[st.id] || []).length;
        if (held) bits.push(held + (held === 1 ? ' event' : ' events'));
        if (st.beepTest) bits.push('beep ' + st.beepTest);
        return { id: st.id, label: bits.join(' · '), place: placeOf[st.id] || 99 };
      })
      .sort((a, b) => a.place - b.place || a.label.localeCompare(b.label));
  };

  /*
   * Preferences can be recorded for anyone who has placed in anything, not only
   * for the students the allocation has already flagged as over the cap. A
   * student who wants the 200m over the 100m should be able to say so before
   * the third result comes in and makes it urgent.
   */
  const [prefName, setPrefName] = useState('');
  const [openStudent, setOpenStudent] = useState(null);

  const placedStudents = useMemo(() => {
    const seen = {};
    alloc.contests.forEach(c => c.ranked.forEach(r => {
      const st = studentsById[r.studentId];
      if (st) seen[r.studentId] = st;
    }));
    return Object.keys(seen).map(id => seen[id])
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [alloc, studentsById]);

  const prefLabels = useMemo(() => {
    const label = {}, byLabel = {};
    placedStudents.forEach(st => {
      const l = st.name + ' · Yr ' + (st.yearLevel || '?') + ' ' + (st.gender || '');
      label[st.id] = l;
      byLabel[l.trim().toLowerCase()] = st.id;
    });
    return { label, byLabel, list: placedStudents.map(st => label[st.id]) };
  }, [placedStudents]);

  const prefStudentId = prefLabels.byLabel[prefName.trim().toLowerCase()] || '';

  // Every event this student has a placing in, best placing first, with what
  // they did — the mark comes off the placing where there is one, and off the
  // recorded result otherwise.
  const placingsOf = (sid) => alloc.contests
    .map(c => {
      const r = c.ranked.find(x => x.studentId === sid);
      if (!r) return null;
      const hit = (results || []).find(x => x.eventId === c.event.id && x.studentId === sid);
      return {
        event: c.event, division: c.division, place: r.place,
        mark: r.result || (hit ? hit.result : ''),
      };
    })
    .filter(Boolean)
    .sort((a, b) => a.place - b.place || a.event.name.localeCompare(b.event.name));

  const setNote = (sid, note) => setPrefs({ ...prefs, [sid]: { ...(prefs[sid] || {}), note } });
  const clearPrefs = (sid) => {
    const next = { ...prefs };
    delete next[sid];
    setPrefs(next);
  };
  const withPrefs = Object.keys(prefs).filter(id =>
    studentsById[id] && ((prefs[id].chosen || []).length || prefs[id].note));

  return (
    <div>
      <h2>District team</h2>

      <div className="card noprint">
        <div className="row">
          <label className="fld">Individual events per student
            <input type="number" min="1" max="6" value={settings.maxPerStudent}
              onChange={e => setSettings({ ...settings, maxPerStudent: Math.max(1, parseInt(e.target.value) || 1) })} />
          </label>
          <label className="fld">Students sent per event
            <input type="number" min="1" max="4" value={settings.spotsPerEvent}
              onChange={e => setSettings({ ...settings, spotsPerEvent: Math.max(1, parseInt(e.target.value) || 1) })} />
          </label>
          <div style={{ flex: '2 1 300px' }} className="muted">
            Relays sit outside the cap — a student can run a relay on top of their {settings.maxPerStudent} individual events.
          </div>
        </div>
      </div>

      {!withResults && <p className="muted">Record some results first — the district team is worked out from them.</p>}

      {withResults && (
        <div className="card noprint">
          <h3>Event preferences</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            Record what a student wants before it becomes urgent. Tick up to {settings.maxPerStudent},
            and the allocation gives them those and passes everything else down to the next finisher —
            whether or not they have been flagged below. Relays sit outside this.
          </p>
          <datalist id="district-roll">
            {prefLabels.list.map(l => <option key={l} value={l} />)}
          </datalist>
          <div className="row">
            <label className="fld" style={{ flex: '1 1 300px' }}>Student
              <input type="text" list="district-roll" value={prefName} placeholder="start typing a name"
                onChange={e => setPrefName(e.target.value)} />
            </label>
            {prefName && !prefStudentId && (
              <div className="muted" style={{ flex: '1 1 200px', paddingBottom: 10, color: '#b45309' }}>
                Nobody placed is called that.
              </div>
            )}
          </div>

          {prefStudentId && (() => {
            const mine = placingsOf(prefStudentId);
            const chosen = (prefs[prefStudentId] || {}).chosen || [];
            if (!mine.length) return <p className="muted">No placings recorded for them yet.</p>;
            return (
              <div>
                <p className="muted" style={{ marginBottom: 8 }}>
                  <strong>{chosen.length}</strong> of {settings.maxPerStudent} chosen ·
                  {' '}placed in {mine.length} event{mine.length === 1 ? '' : 's'}
                </p>
                <table>
                  <thead><tr><th style={{ width: 70 }}>Wants</th><th>Event</th><th>Division</th><th style={{ width: 80 }}>Placed</th></tr></thead>
                  <tbody>
                    {mine.map(m => (
                      <tr key={m.event.id + m.division}>
                        <td>
                          <input type="checkbox" checked={chosen.includes(m.event.id)}
                            aria-label={'Prefer ' + m.event.name}
                            onChange={e => setChosen(prefStudentId, m.event.id, e.target.checked)} />
                        </td>
                        <td><strong>{m.event.name}</strong></td>
                        <td className="muted">Yr {m.division}</td>
                        <td>{['1st', '2nd', '3rd', '4th'][m.place - 1] || (m.place + 'th')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <label className="fld" style={{ marginTop: 12 }}>Note (why, or anything the day needs to know)
                  <input type="text" value={(prefs[prefStudentId] || {}).note || ''}
                    placeholder="e.g. carnival clash, injury, parent request"
                    onChange={e => setNote(prefStudentId, e.target.value)} />
                </label>
                <button className="btn-ghost btn-sm" onClick={() => { clearPrefs(prefStudentId); setPrefName(prefName); }}>
                  Clear their preferences
                </button>
              </div>
            );
          })()}

          {withPrefs.length > 0 && (
            <div style={{ marginTop: 18 }}>
              <h3 style={{ marginBottom: 8 }}>Recorded so far ({withPrefs.length})</h3>
              <table>
                <thead><tr><th>Student</th><th>Wants</th><th>Note</th><th style={{ width: 70 }}></th></tr></thead>
                <tbody>
                  {withPrefs.map(id => (
                    <tr key={id}>
                      <td>{nameOf(id)} <span className="muted">Yr {(studentsById[id] || {}).yearLevel}</span></td>
                      <td>{((prefs[id].chosen || []).map(eventName).join(', ')) || <span className="muted">—</span>}</td>
                      <td className="muted">{prefs[id].note || ''}</td>
                      <td>
                        <button className="btn-ghost btn-sm" onClick={() => clearPrefs(id)}>Clear</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {alloc.needsChoice.length > 0 && (
        <div className="card">
          <div className="warn">
            {/* Not "won": the cut is the top {spotsPerEvent} of each event, so a
                second place counts here as much as a first. */}
            <strong>
              {alloc.needsChoice.length} student{alloc.needsChoice.length === 1 ? '' : 's'}{' '}
              {settings.spotsPerEvent === 1
                ? 'came 1st in'
                : 'finished in the top ' + settings.spotsPerEvent + ' of'}
              {' '}more than {settings.maxPerStudent} event{settings.maxPerStudent === 1 ? '' : 's'}.
            </strong>{' '}
            Tick the {settings.maxPerStudent} each will run. Every event they let go passes to the next finisher automatically,
            and the tables below update as you go.
          </div>
          {alloc.needsChoice.map(o => {
            const chosen = (prefs[o.studentId] && prefs[o.studentId].chosen) || [];
            return (
              <div key={o.studentId} style={{ borderTop: '1px solid #e8ecef', paddingTop: 12, marginTop: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
                  <strong>{nameOf(o.studentId)}</strong>
                  <span className="pill" style={{ background: chosen.length === settings.maxPerStudent ? '#dcfce7' : '#fef3c7' }}>
                    {chosen.length} of {settings.maxPerStudent} chosen
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 8 }}>
                  {o.won.map(w => (
                    <label key={w.eventId} style={{ fontSize: 14 }}>
                      <input type="checkbox" checked={chosen.includes(w.eventId)}
                        onChange={e => setChosen(o.studentId, w.eventId, e.target.checked)} />
                      {' '}{eventName(w.eventId)} <span className="muted">({ordinal(w.place)})</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="card">
        <h3>Team sheet</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          The whole programme, year by year — including events still to be run. Placings fill it in
          by default; type a name into any slot to set it by hand and that row stops being
          recalculated. The list offers everyone in the division, best placing first, with their
          house, placing, how many district events they already hold and their beep test.
          The box beside each name carries the <strong>time or distance</strong> they go in with —
          filled from what was recorded, and editable for a seed mark. Hover an event name marked
          <span className="hint-dot" style={{ position: 'static', marginLeft: 4 }}>i</span> to see
          who came 1st through 4th and what they did.
        </p>

        {Object.keys(programme).length === 0 && (
          <p className="muted">Load the class list on the Import tab first.</p>
        )}

        {yearsInProgramme.length > 0 && (
          <div className="noprint" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center',
            margin: '0 0 16px', paddingBottom: 14, borderBottom: '1px solid #e8ecef' }}>
            <span className="muted" style={{ fontSize: 13 }}>Show:</span>
            {yearsInProgramme.map(y => {
              const on = !hiddenYears[y];
              return (
                <button key={y} className="btn-ghost btn-sm" role="switch" aria-checked={on}
                  aria-label={'Year ' + y}
                  onClick={() => toggleYear(y)}
                  style={{
                    background: on ? '#e0e7ff' : 'transparent',
                    borderColor: on ? '#c7d2fe' : undefined,
                    color: on ? '#1e3a8a' : '#8a949e',
                    fontWeight: on ? 600 : 400,
                  }}>
                  {on ? '✓ ' : ''}Year {y}
                </button>
              );
            })}
            <span style={{ flex: '1 1 auto' }} />
            <button className="btn-ghost btn-sm" onClick={() => setHiddenYears({})}>All</button>
            <button className="btn-ghost btn-sm"
              onClick={() => {
                const h = {};
                yearsInProgramme.forEach(y => { h[y] = true; });
                setHiddenYears(h);
              }}>None</button>
          </div>
        )}

        {yearsInProgramme.length > 0 && shownYears.length === 0 && (
          <p className="muted">Every year level is hidden — press <strong>All</strong> to bring them back.</p>
        )}

        {shownYears.map(y => (
          <div key={y} style={{ marginBottom: 22 }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 16, borderBottom: '2px solid #e0e4e8', paddingBottom: 6 }}>
              Year {y}
            </h3>
            <table>
              <thead>
                <tr>
                  <th style={{ width: 150 }}>Event</th>
                  <th style={{ width: 90 }}>Division</th>
                  <th>Going to district</th>
                  <th style={{ width: 80 }}></th>
                </tr>
              </thead>
              <tbody>
                {programme[y].map(r => {
                  const key = rowKey(r);
                  const team = teamOf(r);
                  const manual = !!manualOf(r);
                  const cands = candidatesFor(r);
                  const byId = {}; cands.forEach(c => { byId[c.id] = c.label; });
                  const byLabel = {}; cands.forEach(c => { byLabel[c.label.toLowerCase()] = c.id; });
                  const listId = 'cand-' + key.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
                  const top = topFour(r);
                  return (
                    <tr key={key}>
                      <td>
                        <span className="hint">
                          <strong>{r.event.name}</strong>
                          {top.length > 0 && <span className="hint-dot">i</span>}
                          {top.length > 0 && (
                            <span className="hint-box">
                              <strong style={{ display: 'block', marginBottom: 4 }}>
                                {r.event.name} — Year {r.year} {r.gender}
                              </strong>
                              {top.map(t => (
                                <span key={t.place} style={{ display: 'block' }}>
                                  {['1st', '2nd', '3rd', '4th'][t.place - 1]} &nbsp;{t.name}
                                  {t.house ? ' · ' + t.house : ''}
                                  {t.mark ? ' — ' + t.mark + ' ' + r.event.unit : ''}
                                </span>
                              ))}
                            </span>
                          )}
                        </span>
                      </td>
                      <td className="muted">{r.gender}</td>
                      <td>
                        <datalist id={listId}>
                          {cands.map(c => <option key={c.id} value={c.label} />)}
                        </datalist>
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                          {Array.from({ length: settings.spotsPerEvent }).map((_, i) => (
                            <span key={i} style={{ display: 'flex', gap: 6, flex: '1 1 250px' }}>
                              {/* Keyed on the value shown, so Reset — or the allocation
                                  shifting underneath — remounts with the new name. */}
                              <input key={key + ':' + i + ':' + (team[i] || '')}
                                type="text" list={listId} style={{ marginTop: 0, flex: '1 1 150px' }}
                                aria-label={r.event.name + ' ' + r.division + ' spot ' + (i + 1)}
                                placeholder={'spot ' + (i + 1)}
                                defaultValue={byId[team[i]] || ''}
                                onChange={e => {
                                  const hit = byLabel[e.target.value.trim().toLowerCase()];
                                  if (hit || !e.target.value.trim()) setSlot(r, i, hit || '');
                                }} />
                              <input key={'m' + key + ':' + i + ':' + (team[i] || '')}
                                type="text" style={{ marginTop: 0, flex: '0 0 76px' }}
                                aria-label={r.event.name + ' ' + r.division + ' mark ' + (i + 1)}
                                placeholder={r.event.unit}
                                defaultValue={markOf(r, i)}
                                onChange={e => setMark(r, i, e.target.value)} />
                            </span>
                          ))}
                        </div>
                      </td>
                      <td>
                        {manual
                          ? <button className="btn-ghost btn-sm" onClick={() => resetRow(r)}>Reset</button>
                          : <span className="muted" style={{ fontSize: 12 }}>auto</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {withResults && (
        <div className="card">
          <h3>Per student</h3>
          <p className="muted" style={{ marginTop: 0 }}>
            Click a name to see everything they placed in — including events they are not going to
            district for — with the time or distance they did it in.
          </p>
          <table>
            <thead><tr><th>Student</th><th>Going to district for</th></tr></thead>
            <tbody>
              {Object.keys(alloc.held).sort((a, b) => nameOf(a).localeCompare(nameOf(b))).map(sid => {
                const open = openStudent === sid;
                const all = open ? placingsOf(sid) : [];
                const going = alloc.held[sid].map(h => h.eventId);
                return (
                  <React.Fragment key={sid}>
                    <tr>
                      <td>
                        <button className="linkish" aria-expanded={open}
                          onClick={() => setOpenStudent(open ? null : sid)}>
                          {open ? '▾' : '▸'} {nameOf(sid)}
                        </button>
                        <span className="muted"> Yr {(studentsById[sid] || {}).yearLevel}</span>
                      </td>
                      <td>{alloc.held[sid].map(h => eventName(h.eventId)).join(', ')}</td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={2} style={{ background: '#f7f9fa' }}>
                          {all.length === 0
                            ? <span className="muted">No placings recorded.</span>
                            : (
                              <table style={{ margin: 0 }}>
                                <thead>
                                  <tr>
                                    <th style={{ width: 70 }}>Place</th><th>Event</th>
                                    <th style={{ width: 110 }}>Division</th>
                                    <th style={{ width: 120 }}>Result</th>
                                    <th style={{ width: 130 }}></th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {all.map(m => (
                                    <tr key={m.event.id + m.division}>
                                      <td><strong>{['1st', '2nd', '3rd', '4th'][m.place - 1] || (m.place + 'th')}</strong></td>
                                      <td>{m.event.name}</td>
                                      <td className="muted">Yr {m.division}</td>
                                      <td>{m.mark ? m.mark + ' ' + m.event.unit : <span className="muted">—</span>}</td>
                                      <td>
                                        {going.indexOf(m.event.id) >= 0
                                          ? <span className="pill" style={{ background: '#dcfce7' }}>going</span>
                                          : <span className="muted" style={{ fontSize: 12 }}>not going</span>}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {alloc.passedOver.length > 0 && (
        <div className="card noprint">
          <h3>
            How the spots moved
            <button className="btn-ghost btn-sm" style={{ marginLeft: 10 }}
              onClick={() => setExpanded(expanded ? null : 'log')}>
              {expanded ? 'hide' : 'show'} ({alloc.passedOver.length})
            </button>
          </h3>
          {expanded && (
            <table>
              <thead><tr><th>Student</th><th>Event</th><th>Division</th><th>Why they were passed over</th></tr></thead>
              <tbody>
                {alloc.passedOver.map((p, i) => (
                  <tr key={i}>
                    <td>{nameOf(p.studentId)}</td><td>{eventName(p.eventId)}</td>
                    <td className="muted">Yr {p.division}</td><td className="muted">{p.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function download(filename, text, mime) {
  const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const csvCell = (v) => {
  const s = String(v === null || v === undefined ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const toCsv = (rows) => rows.map(r => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

function SheetsTab({ events, students, results, houses }) {
  const [eventId, setEventId] = useState('all');
  const [year, setYear] = useState('all');
  const [gender, setGender] = useState('all');
  const [blankRows, setBlankRows] = useState(4);
  const [rowsPerPage, setRowsPerPage] = useState(30);
  const [withResults, setWithResults] = useState(false);

  const houseName = (id) => (houses.find(h => h.id === id) || {}).name || '';
  const studentsById = useMemo(() => {
    const m = {}; students.forEach(s => { m[s.id] = s; }); return m;
  }, [students]);
  const sheetIndex = useMemo(() => buildSheetIndex(events, students), [events, students]);

  /*
   * One printed page per sheet. A year-level-and-gender division can run to 60
   * students, which is far more than fits on A4, so each division is split into
   * pages of `rowsPerPage` and every page gets its own heading and marshal line.
   * The write-in blanks go on the end, so they land on the final page.
   *
   * Rows are tagged rather than being bare students, because the sheet carries
   * three kinds of line: a student, a write-in blank, and a tally line closing
   * off each house. The tally is what the marshal writes the head count on, and
   * it is the number the scorer types into the participation box on the Results
   * tab — so it sits under the house it counts, while the names are still fresh
   * on the page. Only the student and blank lines are numbered, so a tally in
   * the middle doesn't put the numbering out.
   */
  const sheets = useMemo(() => {
    const out = [];
    const years = year === 'all' ? YEARS : [year];
    const genders = gender === 'all' ? ['Female', 'Male', 'Mixed'] : [gender];
    events.filter(ev => eventId === 'all' || ev.id === eventId).forEach(ev => {
      years.forEach(y => {
        if (eventId === 'all' && !ev.years.includes(y)) return; // skip year levels this event isn't run at
        genders.forEach(g => {
          const roll = students.filter(s => s.yearLevel === y && (s.gender || 'Mixed') === g);
          if (!roll.length) return;
          const ranked = rankFor(results, ev.id, y + ' ' + g, ev.scoring, studentsById);
          const order = withResults
            ? ranked.map(r => studentsById[r.studentId]).concat(roll.filter(s => !ranked.some(r => r.studentId === s.id)))
            : roll.slice().sort(byHouseThenName(houses));

          const entries = [];
          let no = 0;
          order.forEach((s, i) => {
            entries.push({ kind: 'student', student: s, no: ++no });
            // A filled-in sheet is sorted by placing, not by house, so there are
            // no house blocks to close off.
            if (withResults) return;
            const next = order[i + 1];
            if (!next || next.house !== s.house) {
              entries.push({ kind: 'tally', house: s.house, onList: order.filter(x => x.house === s.house).length });
            }
          });
          for (let i = 0; i < blankRows; i++) entries.push({ kind: 'blank', no: ++no });
          if (blankRows > 0 && !withResults) entries.push({ kind: 'tally', house: null, onList: 0 });

          const pageCount = Math.max(1, Math.ceil(entries.length / rowsPerPage));
          for (let p = 0; p < pageCount; p++) {
            out.push({
              event: ev, year: y, gender: g, ranked,
              rows: entries.slice(p * rowsPerPage, (p + 1) * rowsPerPage),
              page: p + 1,
              pageCount,
            });
          }
        });
      });
    });
    return out;
  }, [events, students, results, eventId, year, gender, withResults, houses, blankRows, rowsPerPage]);

  const divisionCount = new Set(sheets.map(s => s.event.id + s.year + s.gender)).size;

  const exportResultsCsv = () => {
    const rows = [['Sheet', 'Event', 'Year', 'Gender', 'Place', 'Student', 'House', 'Result', 'Unit']];
    events.forEach(ev => {
      const divisions = new Set();
      results.filter(r => r.eventId === ev.id).forEach(r => {
        const st = studentsById[r.studentId];
        if (st) divisions.add(divisionOf(st));
      });
      Array.from(divisions).sort().forEach(division => {
        rankFor(results, ev.id, division, ev.scoring, studentsById).forEach(r => {
          const st = studentsById[r.studentId];
          rows.push([sheetIndex.byKey[divKey(ev.id, division)] || '', ev.name, st.yearLevel, st.gender,
            r.place, st.name, houseName(st.house), r.result, ev.unit]);
        });
      });
    });
    if (rows.length === 1) return alert('No results recorded yet.');
    download('athletics-results.csv', toCsv(rows), 'text/csv;charset=utf-8');
  };

  const exportSheetsCsv = () => {
    const rows = [['Sheet', 'Event', 'Year', 'Gender', 'Student', 'House', 'Result']];
    sheets.forEach(sh => sh.rows.forEach(row => {
      if (row.kind !== 'student') return; // blanks and house tallies carry no data
      const s = row.student;
      const hit = sh.ranked.find(r => r.studentId === s.id);
      rows.push([sheetIndex.byKey[divKey(sh.event.id, sh.year + ' ' + sh.gender)] || '',
        sh.event.name, sh.year, sh.gender, s.name, houseName(s.house), hit ? hit.result : '']);
    }));
    if (rows.length === 1) return alert('Nothing to export — check the filters.');
    download('athletics-event-sheets.csv', toCsv(rows), 'text/csv;charset=utf-8');
  };

  return (
    <div>
      <h2 className="noprint">Event sheets</h2>

      <div className="card noprint">
        <p className="muted" style={{ marginTop: 0 }}>
          Recording sheets for carnival day — one page per event and division, with every student in that
          division already listed. <strong>Print</strong> opens your browser's print dialog; choose
          <em> Save as PDF</em> there if you want a file rather than paper.
        </p>
        <div className="row">
          <label className="fld">Event
            <select value={eventId} onChange={e => setEventId(e.target.value)}>
              <option value="all">All events</option>
              {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
            </select>
          </label>
          <label className="fld">Year
            <select value={year} onChange={e => setYear(e.target.value)}>
              <option value="all">All years</option>
              {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <label className="fld">Gender
            <select value={gender} onChange={e => setGender(e.target.value)}>
              <option value="all">All</option>
              <option>Female</option><option>Male</option><option>Mixed</option>
            </select>
          </label>
          <label className="fld">Write-in rows
            <input type="number" min="0" max="20" value={blankRows}
              onChange={e => setBlankRows(Math.max(0, Math.min(20, parseInt(e.target.value) || 0)))} />
          </label>
          <label className="fld">Rows per page
            <input type="number" min="10" max={MAX_ROWS_PER_A4} value={rowsPerPage}
              onChange={e => setRowsPerPage(Math.max(10, Math.min(MAX_ROWS_PER_A4, parseInt(e.target.value) || 30)))} />
          </label>
        </div>
        <p className="muted" style={{ marginTop: 0 }}>
          Each sheet is one A4 page and carries a <strong>sheet number</strong> in the top corner —
          type that into the Results tab to jump straight to the right list. Only divisions that
          have students are numbered, so load the class list before printing. A division with more
          students than fits carries on across extra pages under the same sheet number, so nothing
          runs off the bottom. Up to {MAX_ROWS_PER_A4} rows clear an A4 page. The write-in rows are
          blank lines at the end for adding anyone not on the list.
        </p>
        <p className="muted" style={{ marginTop: 0 }}>
          Each house finishes with a ruled line for the marshal to write <strong>how many
          competed</strong> — that is the number you type into the participation box on the
          Results tab, so the head count comes back on the paper rather than being guessed
          afterwards. Those lines take up room on the page, so a division with four houses fits
          four fewer names per sheet.
        </p>
        <label style={{ fontSize: 14, display: 'block', marginBottom: 12 }}>
          <input type="checkbox" checked={withResults} onChange={e => setWithResults(e.target.checked)} />
          {' '}Fill in the results already recorded, in placing order (leave off for blank sheets to write on)
        </label>
        <div className="row">
          <button className="btn" onClick={() => window.print()}>Print / save as PDF</button>
          <button className="btn-ghost" onClick={exportSheetsCsv}>Download these sheets as CSV</button>
          <button className="btn-ghost" onClick={exportResultsCsv}>Download all results as CSV</button>
        </div>
        <p className="muted" style={{ marginBottom: 0, marginTop: 12 }}>
          {sheets.length} page{sheets.length === 1 ? '' : 's'} across {divisionCount} event
          {divisionCount === 1 ? '' : 's'} and division{divisionCount === 1 ? '' : 's'}.
        </p>
      </div>

      {sheets.length === 0 && <p className="muted noprint">Nothing matches those filters.</p>}

      {sheets.map((sh, i) => (
        <div className="sheet" key={sh.event.id + sh.year + sh.gender + i}>
          <div className="sheet-head">
            <div className="sheet-no">
              <div className="sheet-no-label">Sheet</div>
              <div className="sheet-no-value">{sheetIndex.byKey[divKey(sh.event.id, sh.year + ' ' + sh.gender)]}</div>
            </div>
            <div style={{ flex: 1 }}>
              <div className="sheet-title">
                {sh.event.name} — Year {sh.year} {sh.gender}
                {sh.pageCount > 1 && <span className="muted"> · page {sh.page} of {sh.pageCount}</span>}
              </div>
              <div className="muted">
                {sh.event.scoring === 'lower' ? 'Fastest wins' : 'Furthest / highest wins'} · record in {sh.event.unit}
              </div>
            </div>
            <div className="muted" style={{ textAlign: 'right' }}>
              Marshal: ______________________<br />Date: ______________
            </div>
          </div>
          <table>
            <thead>
              <tr>
                <th style={{ width: 34 }}>#</th>
                <th>Student</th>
                <th style={{ width: 110 }}>House</th>
                <th style={{ width: 110 }}>Result</th>
                <th style={{ width: 76 }}>Place</th>
              </tr>
            </thead>
            <tbody>
              {sh.rows.map((row, idx) => {
                if (row.kind === 'tally') {
                  return (
                    <tr className="tally" key={'tally' + idx}>
                      <td></td>
                      <td colSpan={2}>
                        {row.house
                          ? <span><strong>{houseName(row.house)}</strong> — how many competed?
                              <span className="muted"> ({row.onList} on the list)</span></span>
                          : <span><strong>Added by hand above</strong> — how many, and for which house?</span>}
                      </td>
                      <td colSpan={2}><span className="tallybox" /></td>
                    </tr>
                  );
                }
                if (row.kind === 'blank') {
                  return (
                    <tr className="blank" key={'blank' + idx}>
                      <td className="muted">{row.no}</td>
                      <td></td><td></td><td></td><td></td>
                    </tr>
                  );
                }
                const s = row.student;
                const hit = sh.ranked.find(r => r.studentId === s.id);
                return (
                  <tr key={s.id}>
                    <td className="muted">{row.no}</td>
                    <td>{s.name}</td>
                    <td className="muted">{houseName(s.house)}</td>
                    <td>{withResults && hit ? hit.result : ''}</td>
                    <td>{withResults && hit ? hit.place : ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- shell */

function App() {
  const [tab, setTab] = useState('events');
  const [houses, setHouses] = usePersistentState('ath_houses', DEFAULT_HOUSES);
  const [events, setEvents] = usePersistentState('ath_events', DEFAULT_EVENTS);
  const [students, setStudents] = usePersistentState('ath_students', []);
  const [results, setResults] = usePersistentState('ath_results', []);
  const [prefs, setPrefs] = usePersistentState('ath_prefs', {});
  const [settings, setSettings] = usePersistentState('ath_settings', { maxPerStudent: 2, spotsPerEvent: 1 });
  const [sheetMeta, setSheetMeta] = usePersistentState('ath_sheetmeta', {});
  const [scoring, setScoring] = usePersistentState('ath_scoring', DEFAULT_SCORING);
  const [dteam, setDteam] = usePersistentState('ath_dteam', {});

  // Supabase, when it is switched on. Everything still renders from the local
  // state above; this only mirrors it out and brings other people's edits in.
  const sync = useSupabaseSync(
    { houses, events, students, results, sheetMeta, scoring, settings, prefs },
    useCallback((remote) => {
      if (remote.houses && remote.houses.length) setHouses(remote.houses);
      if (remote.events && remote.events.length) setEvents(remote.events);
      setStudents(remote.students || []);
      setResults(remote.results || []);
      setSheetMeta(remote.sheetMeta || {});
      if (remote.scoring) setScoring(remote.scoring);
      if (remote.settings) setSettings(remote.settings);
      if (remote.prefs) setPrefs(remote.prefs);
    }, [])
  );

  /*
   * A removed student has to come off the district sheet and out of the
   * preferences too, or they linger as an id nothing resolves — a blank slot
   * that cannot be explained. Both live up here, so the Students tab is handed
   * these rather than the state itself. Stable identities: StudentRow is
   * memoised and its callbacks have to stay put.
   */
  const dropFromTeam = useCallback((studentId) => {
    setDteam(prev => {
      const next = {};
      Object.keys(prev).forEach(k => {
        const raw = prev[k];
        const ids = Array.isArray(raw) ? raw : (raw && raw.ids) || [];
        if (ids.indexOf(studentId) < 0) { next[k] = raw; return; }
        const cleared = ids.map(id => id === studentId ? '' : id);
        next[k] = Array.isArray(raw) ? cleared : { ...raw, ids: cleared };
      });
      return next;
    });
  }, [setDteam]);

  const dropPrefs = useCallback((studentId) => {
    setPrefs(prev => {
      if (!prev[studentId]) return prev;
      const next = { ...prev };
      delete next[studentId];
      return next;
    });
  }, [setPrefs]);

  // One file with everything in it — the only defence against a browser that
  // clears its storage, or against opening the tool on a different URL.
  const downloadBackup = () => {
    const data = {};
    STORE_KEYS.forEach(k => { try { data[k] = JSON.parse(store.getItem(k)); } catch (e) { data[k] = null; } });
    download('athletics-backup-' + new Date().toISOString().slice(0, 10) + '.json',
      JSON.stringify({ format: 'athletics-manager', version: 1, savedAt: new Date().toISOString(), data }, null, 2),
      'application/json');
  };

  const restoreBackup = (file) => {
    const reader = new FileReader();
    reader.onload = (ev) => {
      let parsed;
      try { parsed = JSON.parse(String(ev.target.result)); }
      catch (err) { return alert('That file could not be read: ' + err.message); }
      if (!parsed || parsed.format !== 'athletics-manager' || !parsed.data) {
        return alert('That is not a backup from this tool.');
      }
      /*
       * A restore is the most destructive thing here — it replaces everything,
       * including work done since the backup was taken. So both sides are put
       * side by side first, and a restore that would lose results says so in
       * as many words.
       */
      const inFile = {
        students: (parsed.data.ath_students || []).length,
        results: (parsed.data.ath_results || []).length,
        sheets: Object.keys(parsed.data.ath_sheetmeta || {}).length,
      };
      const now = { students: students.length, results: results.length, sheets: Object.keys(sheetMeta || {}).length };
      const line = (what) => '  ' + what + ': ' + now[what] + ' here now → ' + inFile[what] + ' in the file';
      const losing = ['results', 'sheets'].filter(k => inFile[k] < now[k]);
      if (!confirm(
        'Restore the backup taken ' + (parsed.savedAt || 'this backup').slice(0, 10) + '?\n\n' +
        line('students') + '\n' + line('results') + '\n' + line('sheets') + '\n\n' +
        (losing.length
          ? 'The file holds FEWER ' + losing.join(' and ') + ' than this browser does. ' +
            'Restoring throws away the difference — anything typed in since the backup was ' +
            'taken. Download a backup of what is here now before going ahead.\n\n'
          : '') +
        'This replaces everything in the browser and cannot be undone.')) return;
      STORE_KEYS.forEach(k => {
        if (parsed.data[k] === null || parsed.data[k] === undefined) store.removeItem(k);
        else store.setItem(k, JSON.stringify(parsed.data[k]));
      });
      location.reload();
    };
    reader.readAsText(file);
  };

  const TABS = [
    ['events', 'Events'], ['houses', 'Houses'], ['students', 'Students'],
    ['import', 'Import'], ['results', 'Results'], ['sheets', 'Event sheets'], ['district', 'District'], ['sync', 'Sync'],
  ];

  return (
    <div className="wrap">
      <div className="topbar">
        <div>
          <h1>Athletics Manager</h1>
          <div className="muted">House athletics, records and the district team · P–6</div>
        </div>
        <button className="btn-ghost noprint" onClick={() => {
          const sheetsIn = Object.keys(sheetMeta || {}).filter(k => (sheetMeta[k] || {}).received).length;
          if (!confirm('Erase everything stored in this browser?\n\n' +
            'That is ' + students.length + ' student' + (students.length === 1 ? '' : 's') + ', ' +
            results.length + ' recorded result' + (results.length === 1 ? '' : 's') + ' and ' +
            sheetsIn + ' sheet' + (sheetsIn === 1 ? '' : 's') + ' entered.\n\n' +
            'It cannot be undone.' +
            (sync.live ? '\n\nSync is on: the server keeps its copy, so this browser will pull it ' +
              'back the next time it connects.' : ''))) return;
          if (confirm('Download a backup first? Strongly recommended — this cannot be undone.')) downloadBackup();
          STORE_KEYS.forEach(k => store.removeItem(k));
          location.reload();
        }}>Erase all data</button>
      </div>

      <div className="tabs noprint">
        {TABS.map(([key, label]) => (
          <button key={key} className={'tab' + (tab === key ? ' on' : '')} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>

      {tab === 'events'   && <EventsTab   events={events} setEvents={setEvents}
                               results={results} sheetMeta={sheetMeta} dteam={dteam}
                               students={students} houses={houses} scoring={scoring} />}
      {tab === 'houses'   && <HousesTab   houses={houses} setHouses={setHouses} students={students} events={events} results={results} sheetMeta={sheetMeta} scoring={scoring} setScoring={setScoring} />}
      {tab === 'students' && <StudentsTab students={students} setStudents={setStudents} houses={houses}
                               results={results} setResults={setResults}
                               sheetMeta={sheetMeta} setSheetMeta={setSheetMeta}
                               events={events} dteam={dteam} prefs={prefs} scoring={scoring}
                               onDropFromTeam={dropFromTeam} onDropPrefs={dropPrefs}
                               syncLive={sync.live} />}
      {tab === 'import'   && <ImportTab   students={students} setStudents={setStudents} houses={houses} setHouses={setHouses}
                               onBackup={downloadBackup} onRestore={restoreBackup} />}
      {tab === 'results'  && <ResultsTab  events={events} students={students} results={results} setResults={setResults} houses={houses}
                               sheetMeta={sheetMeta} setSheetMeta={setSheetMeta} scoring={scoring} />}
      {tab === 'sheets'   && <SheetsTab   events={events} students={students} results={results} houses={houses} />}
      {tab === 'sync'     && <SyncTab     sync={sync} students={students} results={results} sheetMeta={sheetMeta} />}
      {tab === 'district' && <DistrictTab events={events} students={students} results={results} prefs={prefs} setPrefs={setPrefs}
                               settings={settings} setSettings={setSettings} sheetMeta={sheetMeta}
                               dteam={dteam} setDteam={setDteam} houses={houses} />}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
