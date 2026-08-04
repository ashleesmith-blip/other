const { useState, useEffect, useMemo, useCallback } = React;

const store = (typeof window !== 'undefined' && window.storage) ? window.storage : localStorage;
const load = (k, fallback) => {
  try { const v = JSON.parse(store.getItem(k)); return (v === null || v === undefined) ? fallback : v; }
  catch (e) { return fallback; }
};

const YEARS = ['Prep', '1', '2', '3', '4', '5', '6'];

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

// Rank the results for one event+division. Returns [{studentId, raw, value, place}] best first.
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
function allocateDistrict(events, results, students, prefs, opts) {
  const maxPerStudent = opts.maxPerStudent;
  const spotsPerEvent = opts.spotsPerEvent;
  const studentsById = {};
  students.forEach(s => { studentsById[s.id] = s; });

  // Every event+division that actually has results.
  const contests = [];
  events.forEach(ev => {
    const divisions = new Set();
    results.filter(r => r.eventId === ev.id).forEach(r => {
      const st = studentsById[r.studentId];
      if (st) divisions.add(divisionOf(st));
    });
    divisions.forEach(division => {
      contests.push({
        event: ev,
        division,
        ranked: rankFor(results, ev.id, division, ev.scoring, studentsById),
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

function EventsTab({ events, setEvents }) {
  const blank = { name: '', type: 'track', scoring: 'lower', unit: 'sec', years: ['3','4','5','6'] };
  const [draft, setDraft] = useState(blank);

  const add = () => {
    if (!draft.name.trim()) return alert('Give the event a name.');
    setEvents(events.concat([{ ...draft, id: uid('e'), name: draft.name.trim() }]));
    setDraft(blank);
  };
  const remove = (id) => {
    if (confirm('Remove this event? Results recorded against it stay in the data but will not be shown.')) {
      setEvents(events.filter(e => e.id !== id));
    }
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
        <table>
          <thead>
            <tr><th>Event</th><th>Type</th><th>Winner</th><th>Year levels</th><th></th></tr>
          </thead>
          <tbody>
            {events.map(ev => (
              <tr key={ev.id}>
                <td><strong>{ev.name}</strong></td>
                <td style={{ textTransform: 'capitalize' }}>{ev.type}</td>
                <td className="muted">{ev.scoring === 'lower' ? 'fastest' : 'furthest / highest'} ({ev.unit})</td>
                <td className="muted">{ev.years.join(', ')}</td>
                <td><button className="btn-ghost btn-sm" onClick={() => remove(ev.id)}>Remove</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function HousesTab({ houses, setHouses, students, events, results }) {
  const [draft, setDraft] = useState({ name: '', colour: '#7c3aed' });

  const add = () => {
    if (!draft.name.trim()) return;
    setHouses(houses.concat([{ ...draft, id: uid('h'), name: draft.name.trim() }]));
    setDraft({ name: '', colour: '#7c3aed' });
  };

  // 1st = 3pts, 2nd = 2, 3rd = 1, in every event+division.
  const points = useMemo(() => {
    const studentsById = {};
    students.forEach(s => { studentsById[s.id] = s; });
    const tally = {};
    houses.forEach(h => { tally[h.id] = 0; });
    events.forEach(ev => {
      const divisions = new Set();
      results.filter(r => r.eventId === ev.id).forEach(r => {
        const st = studentsById[r.studentId];
        if (st) divisions.add(divisionOf(st));
      });
      divisions.forEach(division => {
        rankFor(results, ev.id, division, ev.scoring, studentsById).slice(0, 3).forEach(r => {
          const st = studentsById[r.studentId];
          const pts = [3, 2, 1][r.place - 1];
          if (st && tally[st.house] !== undefined) tally[st.house] += pts;
        });
      });
    });
    return tally;
  }, [houses, students, events, results]);

  const leader = Math.max(1, ...houses.map(h => points[h.id] || 0));

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
            <div style={{ fontSize: 26, fontWeight: 800, marginTop: 8 }}>{points[h.id] || 0}</div>
            <div style={{ fontSize: 11, opacity: .9, textTransform: 'uppercase', letterSpacing: '.06em' }}>points</div>
          </div>
        ))}
      </div>

      <div className="card">
        <h3>House points (3 / 2 / 1 for first three places in every event and division)</h3>
        {houses.slice().sort((a, b) => (points[b.id] || 0) - (points[a.id] || 0)).map(h => (
          <div key={h.id} style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 3 }}>
              <strong>{h.name}</strong><span>{points[h.id] || 0}</span>
            </div>
            <div style={{ background: '#eef1f4', borderRadius: 999, height: 10 }}>
              <div style={{ background: h.colour, width: ((points[h.id] || 0) / leader * 100) + '%', height: 10, borderRadius: 999 }} />
            </div>
          </div>
        ))}
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
const StudentRow = React.memo(function StudentRow({ s, houses, onPatch, onRemove, onFocus }) {
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
      <td>
        <button className="btn-ghost btn-sm" onClick={() => onRemove(s)}>Remove</button>
      </td>
    </tr>
  );
});

function StudentsTab({ students, setStudents, houses }) {
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

  // Stable identities, so StudentRow's memo actually holds. The functional form
  // of setStudents means these never need to close over the current list.
  const patch = useCallback((id, changes) => {
    setStudents(prev => prev.map(s => s.id === id ? { ...s, ...changes } : s));
  }, [setStudents]);

  const removeStudent = useCallback((s) => {
    if (confirm('Remove ' + s.name + '?')) setStudents(prev => prev.filter(x => x.id !== s.id));
  }, [setStudents]);

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
    const count = students.filter(match).length;
    if (!count) return alert('That matches nobody.');
    if (!confirm('Move ' + count + ' student' + (count === 1 ? '' : 's') + ' to Year ' + bulkYear + '?')) return;
    setStudents(students.map(s => match(s) ? { ...s, yearLevel: bulkYear } : s));
    setBulkTarget('');
  };

  const houseName = (id) => (houses.find(h => h.id === id) || {}).name || '—';

  return (
    <div>
      <h2>Students ({students.length})</h2>

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
                <StudentRow key={s.id} s={s} houses={houses}
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

function ImportTab({ students, setStudents, houses, setHouses }) {
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
        <h3>Back up your data</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Everything lives in this browser only. Download a copy before clearing your browsing data or moving to another device.
        </p>
        <button className="btn-ghost" onClick={() => {
          const blob = new Blob([JSON.stringify(students, null, 2)], { type: 'application/json' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'athletics-students.json';
          a.click();
        }}>Download student list</button>
      </div>
    </div>
  );
}

function ResultsTab({ events, students, results, setResults, houses }) {
  const [eventId, setEventId] = useState(events.length ? events[0].id : '');
  const [year, setYear] = useState('5');
  const [gender, setGender] = useState('Female');

  const [sheetNo, setSheetNo] = useState('');

  const event = events.find(e => e.id === eventId);
  const division = year + ' ' + gender;
  const studentsById = useMemo(() => {
    const m = {}; students.forEach(s => { m[s.id] = s; }); return m;
  }, [students]);
  const sheetIndex = useMemo(() => buildSheetIndex(events, students), [events, students]);
  const currentSheetNo = sheetIndex.byKey[divKey(eventId, division)];

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

  // Same order as the printed recording sheet — by house, then name — so results
  // can be typed straight down the page without hunting for each name.
  const houseName = (id) => (houses.find(h => h.id === id) || {}).name || '';

  // Same order as the printed recording sheet — by house, then name — so results
  // can be typed straight down the page without hunting for each name.
  const inDivision = students
    .filter(s => s.yearLevel === year && s.gender === gender)
    .sort((a, b) => (houseName(a.house) + a.name).localeCompare(houseName(b.house) + b.name));
  const ranked = event ? rankFor(results, event.id, division, event.scoring, studentsById) : [];
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
          {inDivision.length === 0 ? (
            <p className="muted">No students in Year {year} {gender}. Check the Students tab.</p>
          ) : (
            <div className="scroll">
              <table>
                <thead><tr><th style={{ width: 60 }}>Place</th><th>Student</th><th>House</th><th style={{ width: 140 }}>Result</th></tr></thead>
                <tbody>
                  {inDivision.map(s => {
                    const r = ranked.find(x => x.studentId === s.id);
                    const cls = r && r.place <= 3 ? 'medal' + r.place : '';
                    return (
                      <tr key={s.id} className={cls}>
                        <td><strong>{r ? r.place : ''}</strong></td>
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

function DistrictTab({ events, students, results, prefs, setPrefs, settings, setSettings }) {
  const [expanded, setExpanded] = useState(null);
  const studentsById = useMemo(() => {
    const m = {}; students.forEach(s => { m[s.id] = s; }); return m;
  }, [students]);

  const alloc = useMemo(
    () => allocateDistrict(events, results, students, prefs, settings),
    [events, results, students, prefs, settings]
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

      {alloc.needsChoice.length > 0 && (
        <div className="card">
          <div className="warn">
            <strong>{alloc.needsChoice.length} student{alloc.needsChoice.length === 1 ? '' : 's'} won more than {settings.maxPerStudent} events.</strong>{' '}
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
                      {' '}{eventName(w.eventId)} <span className="muted">({w.place === 1 ? '1st' : w.place === 2 ? '2nd' : w.place + 'th'})</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {withResults && (
        <div className="card">
          <h3>Team sheet</h3>
          <table>
            <thead><tr><th>Event</th><th>Division</th><th>Going to district</th></tr></thead>
            <tbody>
              {alloc.contests.map(c => {
                const key = divKey(c.event.id, c.division);
                const picked = alloc.filled[key] || [];
                const short = picked.length < settings.spotsPerEvent;
                return (
                  <tr key={key}>
                    <td><strong>{c.event.name}</strong></td>
                    <td className="muted">Yr {c.division}</td>
                    <td>
                      {picked.length === 0
                        ? <span className="muted">nobody available</span>
                        : picked.map(p => nameOf(p.studentId)).join(', ')}
                      {short && picked.length > 0 && <span className="muted"> · {settings.spotsPerEvent - picked.length} spot free</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {withResults && (
        <div className="card">
          <h3>Per student</h3>
          <table>
            <thead><tr><th>Student</th><th>Events</th></tr></thead>
            <tbody>
              {Object.keys(alloc.held).sort((a, b) => nameOf(a).localeCompare(nameOf(b))).map(sid => (
                <tr key={sid}>
                  <td>{nameOf(sid)} <span className="muted">Yr {(studentsById[sid] || {}).yearLevel}</span></td>
                  <td>{alloc.held[sid].map(h => eventName(h.eventId)).join(', ')}</td>
                </tr>
              ))}
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
            : roll.slice().sort((a, b) => (houseName(a.house) + a.name).localeCompare(houseName(b.house) + b.name));

          const entries = order.concat(Array.from({ length: blankRows }, () => null));
          const pageCount = Math.max(1, Math.ceil(entries.length / rowsPerPage));
          for (let p = 0; p < pageCount; p++) {
            out.push({
              event: ev, year: y, gender: g, ranked,
              rows: entries.slice(p * rowsPerPage, (p + 1) * rowsPerPage),
              offset: p * rowsPerPage,
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
    sheets.forEach(sh => sh.rows.forEach(s => {
      if (!s) return; // write-in blanks have no data to export
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
                <th style={{ width: 60 }}>Place</th>
              </tr>
            </thead>
            <tbody>
              {sh.rows.map((s, idx) => {
                if (!s) {
                  return (
                    <tr className="blank" key={'blank' + idx}>
                      <td className="muted">{sh.offset + idx + 1}</td>
                      <td></td><td></td><td></td><td></td>
                    </tr>
                  );
                }
                const hit = sh.ranked.find(r => r.studentId === s.id);
                return (
                  <tr key={s.id}>
                    <td className="muted">{sh.offset + idx + 1}</td>
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
  const [houses, setHouses] = useState(() => load('ath_houses', DEFAULT_HOUSES));
  const [events, setEvents] = useState(() => load('ath_events', DEFAULT_EVENTS));
  const [students, setStudents] = useState(() => load('ath_students', []));
  const [results, setResults] = useState(() => load('ath_results', []));
  const [prefs, setPrefs] = useState(() => load('ath_prefs', {}));
  const [settings, setSettings] = useState(() => load('ath_settings', { maxPerStudent: 2, spotsPerEvent: 1 }));

  useEffect(() => { store.setItem('ath_houses', JSON.stringify(houses)); }, [houses]);
  useEffect(() => { store.setItem('ath_events', JSON.stringify(events)); }, [events]);
  useEffect(() => { store.setItem('ath_students', JSON.stringify(students)); }, [students]);
  useEffect(() => { store.setItem('ath_results', JSON.stringify(results)); }, [results]);
  useEffect(() => { store.setItem('ath_prefs', JSON.stringify(prefs)); }, [prefs]);
  useEffect(() => { store.setItem('ath_settings', JSON.stringify(settings)); }, [settings]);

  const TABS = [
    ['events', 'Events'], ['houses', 'Houses'], ['students', 'Students'],
    ['import', 'Import'], ['results', 'Results'], ['sheets', 'Event sheets'], ['district', 'District'],
  ];

  return (
    <div className="wrap">
      <div className="topbar">
        <div>
          <h1>Athletics Manager</h1>
          <div className="muted">House athletics, records and the district team · P–6</div>
        </div>
        <button className="btn-ghost noprint" onClick={() => {
          if (confirm('Erase every event, student and result stored in this browser?')) {
            ['ath_houses','ath_events','ath_students','ath_results','ath_prefs','ath_settings'].forEach(k => store.removeItem(k));
            location.reload();
          }
        }}>Erase all data</button>
      </div>

      <div className="tabs noprint">
        {TABS.map(([key, label]) => (
          <button key={key} className={'tab' + (tab === key ? ' on' : '')} onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>

      {tab === 'events'   && <EventsTab   events={events} setEvents={setEvents} />}
      {tab === 'houses'   && <HousesTab   houses={houses} setHouses={setHouses} students={students} events={events} results={results} />}
      {tab === 'students' && <StudentsTab students={students} setStudents={setStudents} houses={houses} />}
      {tab === 'import'   && <ImportTab   students={students} setStudents={setStudents} houses={houses} setHouses={setHouses} />}
      {tab === 'results'  && <ResultsTab  events={events} students={students} results={results} setResults={setResults} houses={houses} />}
      {tab === 'sheets'   && <SheetsTab   events={events} students={students} results={results} houses={houses} />}
      {tab === 'district' && <DistrictTab events={events} students={students} results={results} prefs={prefs} setPrefs={setPrefs} settings={settings} setSettings={setSettings} />}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
