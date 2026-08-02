const { useState, useEffect, useMemo } = React;

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

function StudentsTab({ students, setStudents, houses }) {
  const [draft, setDraft] = useState({ name: '', yearLevel: '5', gender: 'Female', house: '', homegroup: '', beepTest: '' });
  const [filterYear, setFilterYear] = useState('');
  const [filterHouse, setFilterHouse] = useState('');
  const [search, setSearch] = useState('');

  const add = () => {
    if (!draft.name.trim() || !draft.house) return alert('A student needs at least a name and a house.');
    setStudents(students.concat([{ ...draft, id: uid('s'), name: draft.name.trim() }]));
    setDraft({ ...draft, name: '', homegroup: '', beepTest: '' });
  };

  const shown = students.filter(s =>
    (!filterYear || s.yearLevel === filterYear) &&
    (!filterHouse || s.house === filterHouse) &&
    (!search || s.name.toLowerCase().includes(search.toLowerCase()))
  );

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
            <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="name…" />
          </label>
          <label className="fld">Year
            <select value={filterYear} onChange={e => setFilterYear(e.target.value)}>
              <option value="">All years</option>
              {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <label className="fld">House
            <select value={filterHouse} onChange={e => setFilterHouse(e.target.value)}>
              <option value="">All houses</option>
              {houses.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
            </select>
          </label>
        </div>
        <div className="scroll">
          <table>
            <thead>
              <tr><th>Name</th><th>Year</th><th>Gender</th><th>House</th><th>Homegroup</th><th>Beep test</th><th></th></tr>
            </thead>
            <tbody>
              {shown.map(s => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td>{s.yearLevel}</td>
                  <td>{s.gender}</td>
                  <td>{houseName(s.house)}</td>
                  <td className="muted">{s.homegroup}</td>
                  <td>
                    <input type="text" value={s.beepTest || ''} style={{ width: 90, marginTop: 0 }}
                      onChange={e => setStudents(students.map(x => x.id === s.id ? { ...x, beepTest: e.target.value } : x))} />
                  </td>
                  <td>
                    <button className="btn-ghost btn-sm" onClick={() => {
                      if (confirm('Remove ' + s.name + '?')) setStudents(students.filter(x => x.id !== s.id));
                    }}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {shown.length === 0 && <p className="muted" style={{ marginTop: 12 }}>No students match. Use the Import tab to load a class list.</p>}
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

  const event = events.find(e => e.id === eventId);
  const division = year + ' ' + gender;
  const studentsById = useMemo(() => {
    const m = {}; students.forEach(s => { m[s.id] = s; }); return m;
  }, [students]);

  const inDivision = students.filter(s => s.yearLevel === year && s.gender === gender);
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
  const houseName = (id) => (houses.find(h => h.id === id) || {}).name || '';

  return (
    <div>
      <h2>Results</h2>
      <div className="card noprint">
        <div className="row">
          <label className="fld">Event
            <select value={eventId} onChange={e => setEventId(e.target.value)}>
              {events.map(ev => <option key={ev.id} value={ev.id}>{ev.name}</option>)}
            </select>
          </label>
          <label className="fld">Year
            <select value={year} onChange={e => setYear(e.target.value)}>
              {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <label className="fld">Gender
            <select value={gender} onChange={e => setGender(e.target.value)}>
              <option>Female</option><option>Male</option><option>Mixed</option>
            </select>
          </label>
        </div>
        {event && !event.years.includes(year) && (
          <div className="warn">{event.name} is not normally run at Year {year}. You can still record it.</div>
        )}
      </div>

      {!event ? <p className="muted">Add an event first.</p> : (
        <div className="card">
          <h3>{event.name} — Year {year} {gender}
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
    ['import', 'Import'], ['results', 'Results'], ['district', 'District'],
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
      {tab === 'district' && <DistrictTab events={events} students={students} results={results} prefs={prefs} setPrefs={setPrefs} settings={settings} setSettings={setSettings} />}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
