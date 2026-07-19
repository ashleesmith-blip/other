import React, { useState, useEffect, useMemo, useRef } from "react";

/* ============================================================
   SOCIOGRAM — friendship + class dynamics mapper
   CPS · Groupings · standalone tool

   · Students nominate up to N classmates they'd choose to work
     with (and, optionally, anyone they'd rather work apart from)
   · The Map draws it: mutual choices as solid links, one-way
     choices as light arrows, mutual-friendship clusters coloured,
     isolates ringed red — drag nodes to tidy, re-run the layout
     any time
   · Insights reads the picture: mutual pairs, stars, isolates,
     clusters, and every "prefers apart" flag in one place
   · Export grouping data — one JSON shape shared by the whole
     grouping family (Class Creator, Camp Cabin Creator, Activity
     Group Creator), so nominations captured here feed every
     other grouping build
   · Aesthetic + patterns lifted from Chunk & Check
   ============================================================ */

/* ---------- misc helpers ---------- */
const uid = () => Math.random().toString(36).slice(2, 9);
const initials = (name) => (name || "?").trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

/* ---------- persistence — window.storage on claude.ai, localStorage elsewhere ---------- */
const store = {
  async get(k) {
    if (typeof window !== "undefined" && window.storage) {
      try { const r = await window.storage.get(k); return r?.value ?? null; } catch { return null; }
    }
    try { return localStorage.getItem(k); } catch { return null; }
  },
  async set(k, v) {
    if (typeof window !== "undefined" && window.storage) {
      try { await window.storage.set(k, v); return; } catch {}
    }
    try { localStorage.setItem(k, v); } catch {}
  },
};

/* ---------- design tokens (Chunk & Check) ---------- */
const T = {
  bg: "#F6F8FB", card: "#FFFFFF", line: "#E6EBF2", lineSoft: "#EEF2F7",
  ink: "#0F172A", sub: "#64748B", faint: "#94A3B8",
  blue: "#2563EB", blueDeep: "#1D4ED8", blueSoft: "#EFF6FF", blueLine: "#BFDBFE",
  amber: "#B45309", amberSoft: "#FFFBEB", amberLine: "#FDE68A",
  green: "#047857", greenSoft: "#ECFDF5", greenLine: "#A7F3D0",
  red: "#B91C1C", redSoft: "#FEF2F2", redLine: "#FECACA",
  shadow: "0 1px 2px rgba(15,23,42,.05), 0 4px 14px rgba(15,23,42,.05)",
};
const F = {
  display: "'Plus Jakarta Sans', system-ui, sans-serif",
  body: "'Inter', system-ui, sans-serif",
};
const S = {
  card: { background: T.card, border: `1px solid ${T.line}`, borderRadius: 18, boxShadow: T.shadow, padding: 18 },
  eyebrow: { fontFamily: F.body, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: T.faint },
  pill: {
    display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 999, padding: "6px 14px",
    background: T.card, border: `1px solid ${T.line}`, boxShadow: "0 1px 2px rgba(15,23,42,.05)",
    fontFamily: F.body, fontSize: 12.5, fontWeight: 600, color: T.ink, whiteSpace: "nowrap",
  },
  btn: {
    cursor: "pointer", border: "none", borderRadius: 999, padding: "9px 18px",
    background: T.blue, color: "#FFFFFF", fontFamily: F.body, fontSize: 13, fontWeight: 700,
    boxShadow: "0 1px 2px rgba(37,99,235,.35), 0 6px 16px rgba(37,99,235,.25)",
  },
  btnGhost: {
    cursor: "pointer", borderRadius: 999, padding: "8px 16px",
    background: T.card, color: T.ink, border: `1px solid ${T.line}`,
    fontFamily: F.body, fontSize: 12.5, fontWeight: 600, boxShadow: "0 1px 2px rgba(15,23,42,.05)",
  },
  input: {
    width: "100%", borderRadius: 12, border: `1px solid ${T.line}`, padding: "10px 12px",
    fontFamily: F.body, fontSize: 13.5, color: T.ink, background: T.card, outline: "none",
  },
  label: { fontFamily: F.body, fontSize: 12, fontWeight: 700, color: T.ink, marginBottom: 6, display: "block" },
};
const Pill = ({ children, tone = "plain", style = {} }) => {
  const tones = {
    plain: {},
    blue: { background: T.blueSoft, borderColor: T.blueLine, color: T.blueDeep },
    amber: { background: T.amberSoft, borderColor: T.amberLine, color: T.amber },
    green: { background: T.greenSoft, borderColor: T.greenLine, color: T.green },
    red: { background: T.redSoft, borderColor: T.redLine, color: T.red },
    ink: { background: T.ink, borderColor: T.ink, color: "#FFFFFF" },
  };
  return <span style={{ ...S.pill, ...tones[tone], ...style }}>{children}</span>;
};

/* ---------- cluster colours — same wheel as Chunk & Check levels ---------- */
const COLORS = [
  { main: "#3B82F6", text: "#1D4ED8", soft: "#EFF6FF", line: "#BFDBFE", on: "#FFFFFF" }, // blue
  { main: "#22C55E", text: "#15803D", soft: "#F0FDF4", line: "#BBF7D0", on: "#FFFFFF" }, // green
  { main: "#EC4899", text: "#BE185D", soft: "#FDF2F8", line: "#FBCFE8", on: "#FFFFFF" }, // pink
  { main: "#F97316", text: "#C2410C", soft: "#FFF7ED", line: "#FED7AA", on: "#FFFFFF" }, // orange
  { main: "#6366F1", text: "#4338CA", soft: "#EEF2FF", line: "#C7D2FE", on: "#FFFFFF" }, // indigo
  { main: "#14B8A6", text: "#0F766E", soft: "#F0FDFA", line: "#99F6E4", on: "#FFFFFF" }, // teal
  { main: "#EAB308", text: "#A16207", soft: "#FEFCE8", line: "#FDE68A", on: "#422006" }, // yellow
  { main: "#EF4444", text: "#B91C1C", soft: "#FEF2F2", line: "#FECACA", on: "#FFFFFF" }, // red
];
const colorFor = (i) => COLORS[((i % COLORS.length) + COLORS.length) % COLORS.length];

/* ---------- force-directed layout (Fruchterman–Reingold-ish) ---------- */
function runLayout(ids, edges, W, H, iters = 260) {
  const N = ids.length;
  if (!N) return {};
  const pos = {};
  ids.forEach((id, i) => {
    const a = (i / N) * Math.PI * 2;
    pos[id] = { x: W / 2 + Math.cos(a) * (W / 3), y: H / 2 + Math.sin(a) * (H / 3.1) };
  });
  const k = Math.sqrt((W * H) / N) * 0.85;
  for (let it = 0; it < iters; it++) {
    const disp = {};
    ids.forEach((id) => { disp[id] = { x: 0, y: 0 }; });
    for (let i = 0; i < N; i++) {
      for (let j = i + 1; j < N; j++) {
        const a = ids[i], b = ids[j];
        const dx = pos[a].x - pos[b].x, dy = pos[a].y - pos[b].y;
        const d = Math.hypot(dx, dy) || 0.01;
        const f = (k * k) / (d * d);
        disp[a].x += (dx / d) * f;
        disp[a].y += (dy / d) * f;
        disp[b].x -= (dx / d) * f;
        disp[b].y -= (dy / d) * f;
      }
    }
    edges.forEach(([a, b, w]) => {
      if (!pos[a] || !pos[b]) return;
      const dx = pos[a].x - pos[b].x, dy = pos[a].y - pos[b].y;
      const d = Math.hypot(dx, dy) || 0.01;
      const f = (d * d) / k * 0.06 * (w || 1);
      disp[a].x -= (dx / d) * f;
      disp[a].y -= (dy / d) * f;
      disp[b].x += (dx / d) * f;
      disp[b].y += (dy / d) * f;
    });
    const t = Math.max(2, (1 - it / iters) * 24);
    ids.forEach((id) => {
      disp[id].x += (W / 2 - pos[id].x) * 0.025;
      disp[id].y += (H / 2 - pos[id].y) * 0.025;
      const d = Math.hypot(disp[id].x, disp[id].y) || 0.01;
      pos[id].x = Math.min(W - 44, Math.max(44, pos[id].x + (disp[id].x / d) * Math.min(d, t)));
      pos[id].y = Math.min(H - 44, Math.max(44, pos[id].y + (disp[id].y / d) * Math.min(d, t)));
    });
  }
  return pos;
}

/* ---------- sample data ---------- */
const SAMPLE = () => {
  const names = [
    ["Ava R", "5A", "F"], ["Ben T", "5A", "M"], ["Chloe M", "5A", "F"], ["Dev P", "5A", "M"],
    ["Eli S", "5A", "M"], ["Freya K", "5A", "F"], ["Gus W", "5A", "M"], ["Harper L", "5A", "F"],
    ["Ivy C", "5A", "F"], ["Jack D", "5A", "M"], ["Kai N", "5A", "M"], ["Lily B", "5A", "F"],
    ["Marcus O", "5B", "M"], ["Nora F", "5B", "F"], ["Oscar H", "5B", "M"], ["Priya S", "5B", "F"],
    ["Quinn A", "5B", "F"], ["Ruby J", "5B", "F"], ["Sam E", "5B", "M"], ["Tara V", "5B", "F"],
    ["Umar M", "5B", "M"], ["Violet G", "5B", "F"], ["Will P", "5B", "M"], ["Zoe T", "5B", "F"],
  ];
  const students = names.map(([name, cls, gender]) => ({ id: uid(), name, cls, gender, notes: "" }));
  const id = (n) => students.find((s) => s.name.startsWith(n)).id;
  const socio = {};
  const pick = (from, friends, avoid = []) => { socio[id(from)] = { friends: friends.map(id), avoid: avoid.map(id) }; };
  pick("Ava", ["Chloe", "Freya", "Harper"]);
  pick("Chloe", ["Ava", "Freya", "Lily"]);
  pick("Freya", ["Ava", "Chloe", "Ivy"]);
  pick("Harper", ["Ava", "Ivy", "Zoe"]);
  pick("Ivy", ["Freya", "Harper", "Lily"]);
  pick("Lily", ["Chloe", "Ivy", "Ruby"]);
  pick("Ben", ["Jack", "Gus", "Dev"], ["Marcus"]);
  pick("Jack", ["Ben", "Gus", "Kai"]);
  pick("Gus", ["Ben", "Jack", "Eli"]);
  pick("Dev", ["Ben", "Kai", "Sam"]);
  pick("Kai", ["Jack", "Dev", "Eli"]);
  pick("Eli", ["Gus", "Kai", "Will"]);
  pick("Marcus", ["Oscar", "Sam", "Will"], ["Ben"]);
  pick("Oscar", ["Marcus", "Sam", "Umar"]);
  pick("Sam", ["Marcus", "Oscar", "Dev"]);
  pick("Umar", ["Oscar", "Will", "Sam"]);
  pick("Will", ["Marcus", "Umar", "Eli"]);
  pick("Nora", ["Priya", "Ruby", "Quinn"]);
  pick("Priya", ["Nora", "Quinn", "Tara"]);
  pick("Quinn", ["Priya", "Nora", "Violet"]);
  pick("Ruby", ["Nora", "Lily", "Tara"]);
  pick("Tara", ["Priya", "Ruby", "Zoe"]);
  pick("Violet", ["Quinn", "Zoe", "Tara"]);
  pick("Zoe", ["Harper", "Violet", "Tara"]);
  return { students, socio };
};

/* ============================================================ */
export default function App() {
  const [students, setStudents] = useState([]);
  const [socio, setSocio] = useState({});          // { studentId: { friends:[ids], avoid:[ids] } }
  const [maxPicks, setMaxPicks] = useState(3);

  const [view, setView] = useState("students");    // students | nominate | map | insights
  const [focus, setFocus] = useState(null);        // student id being nominated for
  const [showAvoid, setShowAvoid] = useState(false);
  const [showOneWay, setShowOneWay] = useState(true);
  const [layoutSeed, setLayoutSeed] = useState(0);
  const [posOv, setPosOv] = useState({});          // dragged node positions
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [savedMsg, setSavedMsg] = useState("");
  const loadRef = useRef(null);
  const importRef = useRef(null);

  /* ---------- persistence ---------- */
  const storeLoaded = useRef(false);
  useEffect(() => {
    (async () => {
      try {
        const raw = await store.get("sociogram-doc");
        if (raw) {
          const d = JSON.parse(raw);
          if (d.students) setStudents(d.students);
          if (d.socio) setSocio(d.socio);
          if (d.maxPicks) setMaxPicks(d.maxPicks);
        }
      } catch {}
      storeLoaded.current = true;
    })();
  }, []);
  useEffect(() => {
    if (!storeLoaded.current) return;
    store.set("sociogram-doc", JSON.stringify({ students, socio, maxPicks }));
    setSavedMsg("Saved");
    const t = setTimeout(() => setSavedMsg(""), 1200);
    return () => clearTimeout(t);
  }, [students, socio, maxPicks]);

  /* ---------- roster ops ---------- */
  const byId = (id) => students.find((s) => s.id === id);
  const addStudent = () => setStudents((p) => [...p, { id: uid(), name: "", cls: "", gender: "", notes: "" }]);
  const patchStudent = (id, patch) => setStudents((p) => p.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const removeStudent = (id) => {
    setStudents((p) => p.filter((s) => s.id !== id));
    setSocio((p) => {
      const n = {};
      Object.entries(p).forEach(([k, v]) => {
        if (k === id) return;
        n[k] = { friends: (v.friends || []).filter((f) => f !== id), avoid: (v.avoid || []).filter((f) => f !== id) };
      });
      return n;
    });
    if (focus === id) setFocus(null);
  };
  const applyPaste = () => {
    const rows = pasteText.split(/\n/).map((l) => l.trim()).filter(Boolean);
    const added = rows.map((l) => {
      const [name, cls, gender] = l.split(/[,\t]/).map((x) => (x || "").trim());
      return { id: uid(), name, cls: cls || "", gender: (gender || "").toUpperCase().slice(0, 1), notes: "" };
    }).filter((s) => s.name);
    if (added.length) setStudents((p) => [...p, ...added]);
    setPasteText(""); setPasteOpen(false);
  };

  /* ---------- nominations ---------- */
  const picksOf = (id) => socio[id] || { friends: [], avoid: [] };
  const toggleFriend = (id, target) => setSocio((p) => {
    const cur = p[id] || { friends: [], avoid: [] };
    const has = cur.friends.includes(target);
    if (!has && cur.friends.length >= maxPicks) return p;
    return { ...p, [id]: { ...cur, friends: has ? cur.friends.filter((f) => f !== target) : [...cur.friends, target] } };
  });
  const toggleAvoid = (id, target) => setSocio((p) => {
    const cur = p[id] || { friends: [], avoid: [] };
    const has = cur.avoid.includes(target);
    return { ...p, [id]: { ...cur, avoid: has ? cur.avoid.filter((f) => f !== target) : [...cur.avoid, target] } };
  });

  /* ---------- graph analysis ---------- */
  const analysis = useMemo(() => {
    const ids = students.map((s) => s.id);
    const chose = (a, b) => (socio[a]?.friends || []).includes(b);
    const mutual = [];
    const oneWay = [];
    ids.forEach((a) => (socio[a]?.friends || []).forEach((b) => {
      if (!ids.includes(b)) return;
      if (chose(b, a)) { if (a < b) mutual.push([a, b]); }
      else oneWay.push([a, b]);
    }));
    const received = {};
    ids.forEach((id) => { received[id] = 0; });
    ids.forEach((a) => (socio[a]?.friends || []).forEach((b) => { if (received[b] !== undefined) received[b] += 1; }));
    /* clusters = connected components over mutual links, size ≥ 2 */
    const parent = {};
    ids.forEach((id) => { parent[id] = id; });
    const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
    mutual.forEach(([a, b]) => { parent[find(a)] = find(b); });
    const compMembers = {};
    ids.forEach((id) => { const r = find(id); (compMembers[r] = compMembers[r] || []).push(id); });
    const clusters = Object.values(compMembers).filter((m) => m.length >= 2).sort((a, b) => b.length - a.length);
    const clusterOf = {};
    clusters.forEach((m, i) => m.forEach((id) => { clusterOf[id] = i; }));
    const isolates = ids.filter((id) => received[id] === 0);
    const noPicks = ids.filter((id) => !(socio[id]?.friends || []).length);
    const avoids = [];
    ids.forEach((a) => (socio[a]?.avoid || []).forEach((b) => { if (ids.includes(b)) avoids.push([a, b]); }));
    return { mutual, oneWay, received, clusters, clusterOf, isolates, noPicks, avoids };
  }, [students, socio]);

  /* ---------- map layout ---------- */
  const W = 920, H = 640;
  const layoutPos = useMemo(() => {
    const ids = students.map((s) => s.id);
    const edges = [
      ...analysis.mutual.map(([a, b]) => [a, b, 2.2]),
      ...analysis.oneWay.map(([a, b]) => [a, b, 0.7]),
    ];
    return runLayout(ids, edges, W, H);
    // layoutSeed is a manual re-run trigger
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students, analysis.mutual.length, analysis.oneWay.length, layoutSeed]);
  const posFor = (id) => posOv[id] || layoutPos[id] || { x: W / 2, y: H / 2 };

  const svgRef = useRef(null);
  const dragRef = useRef(null);
  const toView = (e) => {
    const r = svgRef.current.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  };
  const onMove = (e) => {
    if (!dragRef.current) return;
    const p = toView(e);
    setPosOv((prev) => ({ ...prev, [dragRef.current]: { x: Math.min(W - 30, Math.max(30, p.x)), y: Math.min(H - 30, Math.max(30, p.y)) } }));
  };

  const nodeR = (id) => Math.min(26, 13 + (analysis.received[id] || 0) * 2);

  /* ---------- backup / grouping-data exchange ---------- */
  const download = (obj, filename) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" }));
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const exportGrouping = () => download({ kind: "cps-grouping-data", students, socio }, "grouping-data.json");
  const exportBackup = () => download({ students, socio, maxPicks }, "sociogram-backup.json");
  const loadBackup = async (file) => {
    if (!file) return;
    try {
      const d = JSON.parse(await file.text());
      if (!window.confirm("Replace everything with this backup?")) return;
      setStudents(d.students || []);
      setSocio(d.socio || {});
      if (d.maxPicks) setMaxPicks(d.maxPicks);
    } catch { window.alert("That file isn't a valid backup."); }
  };
  const importGrouping = async (file) => {
    if (!file) return;
    try {
      const d = JSON.parse(await file.text());
      if (!Array.isArray(d.students)) throw new Error();
      if (!window.confirm(`Import ${d.students.length} students${d.socio ? " + nominations" : ""}? This replaces the current roster.`)) return;
      setStudents(d.students.map((s) => ({ id: s.id || uid(), name: s.name || "", cls: s.cls || "", gender: s.gender || "", notes: s.notes || "" })));
      setSocio(d.socio || {});
    } catch { window.alert("That file isn't grouping data (expects { students:[...], socio:{...} })."); }
  };

  const doneCount = students.filter((s) => (socio[s.id]?.friends || []).length > 0).length;

  /* ============================ UI ============================ */
  return (
    <div style={{ minHeight: "100vh", background: T.bg, fontFamily: F.body, color: T.ink }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap');
        * { box-sizing: border-box; }
        button:hover { filter: brightness(0.97); }
        button:focus-visible, select:focus-visible, input:focus-visible, textarea:focus-visible { outline: 2px solid ${T.blue}; outline-offset: 2px; }
        input::placeholder, textarea::placeholder { color: ${T.faint}; }
        @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
        @media print { .no-print { display: none !important; } body { background: #FFF; } }
      `}</style>

      {/* ---------- header ---------- */}
      <div style={{ background: T.card, borderBottom: `1px solid ${T.line}` }}>
        <div style={{ maxWidth: 1180, margin: "0 auto", padding: "26px 22px 22px", textAlign: "center" }}>
          <Pill tone="blue" style={{ fontSize: 11 }}>CPS · Groupings</Pill>
          <h1 style={{ fontFamily: F.display, fontWeight: 800, fontSize: 34, letterSpacing: "-0.02em", margin: "12px 0 6px" }}>
            Socio<span style={{ color: T.blue }}>gram</span>
          </h1>
          <div style={{ fontSize: 14, color: T.sub, maxWidth: 620, margin: "0 auto", lineHeight: 1.55 }}>
            Who chooses whom. Capture nominations, see the map — mutual friendships, one-way choices,
            clusters and isolates — then export the data layer every other grouping tool builds on.
          </div>
          <div className="no-print" style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 16, flexWrap: "wrap" }}>
            {[["students", "Students"], ["nominate", "Nominations"], ["map", "Map"], ["insights", "Insights"]].map(([k, lab]) => (
              <button key={k} onClick={() => setView(k)}
                style={{ ...S.btnGhost, ...(view === k ? { background: T.ink, color: "#FFF", borderColor: T.ink } : {}) }}>
                {lab}
              </button>
            ))}
            <button style={{ ...S.btnGhost, padding: "5px 12px", fontSize: 11, color: T.sub }} onClick={exportGrouping} title="Download the shared grouping-data JSON used by Class Creator, Cabin Creator and Activity Groups">Export grouping data</button>
            <button style={{ ...S.btnGhost, padding: "5px 12px", fontSize: 11, color: T.sub }} onClick={exportBackup} title="Download everything as a JSON backup">Backup</button>
            <button style={{ ...S.btnGhost, padding: "5px 12px", fontSize: 11, color: T.sub }} onClick={() => loadRef.current?.click()} title="Restore from a JSON backup">Restore</button>
            <input ref={loadRef} type="file" hidden accept=".json,application/json" onChange={(e) => { loadBackup(e.target.files?.[0]); e.target.value = ""; }} />
            {savedMsg && <Pill tone="green" style={{ fontSize: 10.5 }}>{savedMsg}</Pill>}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "26px 22px 80px" }}>

        {/* ================= STUDENTS ================= */}
        {view === "students" && (
          <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 22, alignItems: "start" }}>
            <div style={S.card}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <span style={S.eyebrow}>Roster</span>
                <Pill style={{ fontSize: 10.5 }}>{students.length} students</Pill>
                <span style={{ flex: 1 }} />
                <button style={{ ...S.btnGhost, padding: "6px 14px", fontSize: 12 }} onClick={() => setPasteOpen(!pasteOpen)}>Paste list</button>
                <button style={{ ...S.btn, padding: "6px 14px", fontSize: 12 }} onClick={addStudent}>+ Student</button>
              </div>
              {pasteOpen && (
                <div style={{ marginBottom: 14, padding: 12, borderRadius: 12, background: T.blueSoft, border: `1px solid ${T.blueLine}` }}>
                  <label style={S.label}>One student per line — <span style={{ fontWeight: 400, color: T.sub }}>Name, class, gender (class and gender optional)</span></label>
                  <textarea style={{ ...S.input, minHeight: 90, resize: "vertical" }} value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder={"Ava R, 5A, F\nBen T, 5A, M"} />
                  <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                    <button style={{ ...S.btn, padding: "6px 14px", fontSize: 12 }} onClick={applyPaste}>Add students</button>
                    <button style={{ ...S.btnGhost, padding: "6px 14px", fontSize: 12 }} onClick={() => setPasteOpen(false)}>Cancel</button>
                  </div>
                </div>
              )}
              {!students.length && !pasteOpen && (
                <div style={{ fontSize: 13, color: T.sub, lineHeight: 1.6 }}>
                  No students yet. Add them, paste a list, or{" "}
                  <button onClick={() => { const s = SAMPLE(); setStudents(s.students); setSocio(s.socio); }}
                    style={{ border: "none", background: "none", cursor: "pointer", color: T.blueDeep, fontWeight: 700, fontSize: 13, padding: 0 }}>
                    load sample data
                  </button>{" "}
                  to see the tool working.
                </div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {students.map((s) => (
                  <div key={s.id} style={{ display: "flex", gap: 8, alignItems: "center", border: `1px solid ${T.lineSoft}`, borderRadius: 12, padding: "8px 10px", background: "#FCFDFE" }}>
                    <span style={{ width: 26, height: 26, borderRadius: 999, background: T.blueSoft, border: `1px solid ${T.blueLine}`, color: T.blueDeep, fontSize: 10.5, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center", flex: "0 0 auto" }}>{initials(s.name)}</span>
                    <input style={{ ...S.input, padding: "6px 10px", fontSize: 13 }} value={s.name} onChange={(e) => patchStudent(s.id, { name: e.target.value })} placeholder="Name" />
                    <input style={{ ...S.input, padding: "6px 10px", fontSize: 13, width: 74, flex: "0 0 auto" }} value={s.cls} onChange={(e) => patchStudent(s.id, { cls: e.target.value })} placeholder="Class" />
                    {["F", "M"].map((g) => (
                      <button key={g} onClick={() => patchStudent(s.id, { gender: s.gender === g ? "" : g })}
                        style={{ ...S.btnGhost, padding: "4px 10px", fontSize: 11, flex: "0 0 auto", ...(s.gender === g ? { background: T.ink, color: "#FFF", borderColor: T.ink } : { color: T.faint }) }}>
                        {g}
                      </button>
                    ))}
                    <button style={{ ...S.btnGhost, padding: "3px 8px", fontSize: 11, color: T.red, borderColor: T.redLine, flex: "0 0 auto" }} onClick={() => removeStudent(s.id)}>✕</button>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
              <div style={S.card}>
                <span style={S.eyebrow}>Settings</span>
                <div style={{ marginTop: 12 }}>
                  <label style={S.label}>Nominations per student</label>
                  <div style={{ display: "flex", gap: 6 }}>
                    {[2, 3, 4, 5].map((n) => (
                      <button key={n} onClick={() => setMaxPicks(n)}
                        style={{ ...S.btnGhost, padding: "6px 14px", ...(maxPicks === n ? { background: T.blue, color: "#FFF", borderColor: T.blue } : {}) }}>
                        {n}
                      </button>
                    ))}
                  </div>
                  <div style={{ fontSize: 12, color: T.sub, marginTop: 10, lineHeight: 1.55 }}>
                    The classic prompt: <i>"Name up to {maxPicks} classmates you'd choose to work with."</i>{" "}
                    An optional <b>prefers apart</b> flag records the quiet second question teachers already know the answer to.
                  </div>
                </div>
              </div>
              <div style={S.card}>
                <span style={S.eyebrow}>Shared data layer</span>
                <div style={{ fontSize: 12.5, color: T.sub, marginTop: 10, lineHeight: 1.6 }}>
                  This roster + these nominations are the data layer for the whole grouping family.
                  <b> Export grouping data</b> (in the header) and import the file into
                  <b> Class Creator</b>, <b>Camp Cabin Creator</b> or <b>Activity Group Creator</b> —
                  or import grouping data built elsewhere:
                </div>
                <button style={{ ...S.btnGhost, marginTop: 12, fontSize: 12 }} onClick={() => importRef.current?.click()}>Import grouping data</button>
                <input ref={importRef} type="file" hidden accept=".json,application/json" onChange={(e) => { importGrouping(e.target.files?.[0]); e.target.value = ""; }} />
              </div>
            </div>
          </div>
        )}

        {/* ================= NOMINATIONS ================= */}
        {view === "nominate" && (
          <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: 22, alignItems: "start" }}>
            <div style={S.card}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <span style={S.eyebrow}>Students</span>
                <Pill tone={doneCount === students.length && students.length ? "green" : "plain"} style={{ fontSize: 10.5 }}>{doneCount}/{students.length} done</Pill>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 560, overflowY: "auto" }}>
                {students.map((s) => {
                  const n = (socio[s.id]?.friends || []).length;
                  const active = focus === s.id;
                  return (
                    <button key={s.id} onClick={() => setFocus(s.id)}
                      style={{ ...S.btnGhost, display: "flex", justifyContent: "space-between", alignItems: "center", borderRadius: 10, textAlign: "left",
                        ...(active ? { background: T.blueSoft, borderColor: T.blueLine, color: T.blueDeep } : {}) }}>
                      <span>{s.name || "Unnamed"}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: n ? T.green : T.faint }}>{n ? `${n} ✓` : "—"}</span>
                    </button>
                  );
                })}
                {!students.length && <div style={{ fontSize: 13, color: T.sub }}>Add students first.</div>}
              </div>
            </div>
            <div style={S.card}>
              {!focus && <div style={{ fontSize: 13.5, color: T.sub, padding: 20, textAlign: "center" }}>Select a student on the left, then tap the classmates they nominated.</div>}
              {focus && byId(focus) && (() => {
                const s = byId(focus);
                const p = picksOf(focus);
                return (
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 4 }}>
                      <span style={{ width: 34, height: 34, borderRadius: 999, background: T.blue, color: "#FFF", fontSize: 13, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{initials(s.name)}</span>
                      <div>
                        <div style={{ fontFamily: F.display, fontWeight: 800, fontSize: 18 }}>{s.name}</div>
                        <div style={{ fontSize: 12, color: T.sub }}>{s.cls}{s.cls && " · "}chooses up to {maxPicks}</div>
                      </div>
                      <span style={{ flex: 1 }} />
                      <Pill tone={p.friends.length ? "green" : "plain"} style={{ fontSize: 11 }}>{p.friends.length}/{maxPicks} chosen</Pill>
                    </div>
                    <div style={{ marginTop: 16 }}>
                      <label style={S.label}>Chooses to work with</label>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {students.filter((o) => o.id !== focus).map((o) => {
                          const on = p.friends.includes(o.id);
                          const back = (socio[o.id]?.friends || []).includes(focus);
                          return (
                            <button key={o.id} onClick={() => toggleFriend(focus, o.id)}
                              style={{ ...S.btnGhost, padding: "6px 14px", fontSize: 12.5,
                                ...(on ? { background: T.blueSoft, borderColor: T.blue, color: T.blueDeep } : {}),
                                ...(on && back ? { background: T.blue, color: "#FFF", borderColor: T.blue } : {}) }}
                              title={on && back ? "Mutual — they chose each other" : back ? `${o.name} chose ${s.name}` : ""}>
                              {o.name}{on && back ? " ⇆" : ""}
                            </button>
                          );
                        })}
                      </div>
                      <div style={{ fontSize: 11.5, color: T.faint, marginTop: 8 }}>Solid blue = mutual (⇆). Chips grey out at {maxPicks} picks — unpick one to swap.</div>
                    </div>
                    <div style={{ marginTop: 18 }}>
                      <label style={S.label}>Prefers apart <span style={{ fontWeight: 400, color: T.sub }}>(optional — teacher knowledge welcome)</span></label>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                        {students.filter((o) => o.id !== focus).map((o) => {
                          const on = p.avoid.includes(o.id);
                          return (
                            <button key={o.id} onClick={() => toggleAvoid(focus, o.id)}
                              style={{ ...S.btnGhost, padding: "5px 12px", fontSize: 12, color: on ? "#FFF" : T.faint,
                                ...(on ? { background: T.red, borderColor: T.red } : {}) }}>
                              {o.name}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        )}

        {/* ================= MAP ================= */}
        {view === "map" && (
          <div style={S.card}>
            <div className="no-print" style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              <span style={S.eyebrow}>The map</span>
              <span style={{ flex: 1 }} />
              <button onClick={() => setShowOneWay(!showOneWay)} style={{ ...S.btnGhost, padding: "5px 12px", fontSize: 11.5, ...(showOneWay ? { background: T.blueSoft, borderColor: T.blueLine, color: T.blueDeep } : { color: T.faint }) }}>One-way arrows</button>
              <button onClick={() => setShowAvoid(!showAvoid)} style={{ ...S.btnGhost, padding: "5px 12px", fontSize: 11.5, ...(showAvoid ? { background: T.redSoft, borderColor: T.redLine, color: T.red } : { color: T.faint }) }}>Prefers-apart</button>
              <button style={{ ...S.btnGhost, padding: "5px 12px", fontSize: 11.5 }} onClick={() => { setPosOv({}); setLayoutSeed((x) => x + 1); }}>↺ Re-run layout</button>
              <button style={{ ...S.btnGhost, padding: "5px 12px", fontSize: 11.5 }} onClick={() => window.print()}>Print</button>
            </div>
            {!students.length ? (
              <div style={{ fontSize: 13.5, color: T.sub, padding: 30, textAlign: "center" }}>Add students and nominations first — or load the sample data from the Students tab.</div>
            ) : (
              <>
                <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height: "auto", borderRadius: 14, background: "#FBFCFE", border: `1px solid ${T.lineSoft}`, touchAction: "none", cursor: dragRef.current ? "grabbing" : "default" }}
                  onPointerMove={onMove} onPointerUp={() => { dragRef.current = null; }} onPointerLeave={() => { dragRef.current = null; }}>
                  <defs>
                    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                      <path d="M 0 1 L 9 5 L 0 9 z" fill="#B9C4D4" />
                    </marker>
                  </defs>
                  {showAvoid && analysis.avoids.map(([a, b], i) => {
                    const pa = posFor(a), pb = posFor(b);
                    return <line key={`av${i}`} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke={T.red} strokeWidth={1.4} strokeDasharray="4 5" opacity={0.55} />;
                  })}
                  {showOneWay && analysis.oneWay.map(([a, b], i) => {
                    const pa = posFor(a), pb = posFor(b);
                    const d = Math.hypot(pb.x - pa.x, pb.y - pa.y) || 1;
                    const rB = nodeR(b) + 5;
                    const ex = pb.x - ((pb.x - pa.x) / d) * rB, ey = pb.y - ((pb.y - pa.y) / d) * rB;
                    return <line key={`ow${i}`} x1={pa.x} y1={pa.y} x2={ex} y2={ey} stroke="#C7D0DD" strokeWidth={1.3} markerEnd="url(#arrow)" />;
                  })}
                  {analysis.mutual.map(([a, b], i) => {
                    const pa = posFor(a), pb = posFor(b);
                    const ci = analysis.clusterOf[a];
                    const col = ci !== undefined ? colorFor(ci).main : T.blue;
                    return <line key={`m${i}`} x1={pa.x} y1={pa.y} x2={pb.x} y2={pb.y} stroke={col} strokeWidth={2.6} opacity={0.75} />;
                  })}
                  {students.map((s) => {
                    const p = posFor(s.id);
                    const r = nodeR(s.id);
                    const ci = analysis.clusterOf[s.id];
                    const col = ci !== undefined ? colorFor(ci) : { main: "#94A3B8", soft: "#F1F5F9", line: "#E2E8F0", text: "#475569" };
                    const isolate = analysis.isolates.includes(s.id);
                    return (
                      <g key={s.id} style={{ cursor: "grab" }}
                        onPointerDown={(e) => { e.preventDefault(); dragRef.current = s.id; }}>
                        {isolate && <circle cx={p.x} cy={p.y} r={r + 5} fill="none" stroke={T.red} strokeWidth={2} strokeDasharray="3 4" />}
                        <circle cx={p.x} cy={p.y} r={r} fill={col.soft} stroke={col.main} strokeWidth={2.2} />
                        <text x={p.x} y={p.y + 3.5} textAnchor="middle" style={{ fontFamily: F.body, fontSize: 10, fontWeight: 800, fill: col.text, userSelect: "none", pointerEvents: "none" }}>{initials(s.name)}</text>
                        <text x={p.x} y={p.y + r + 13} textAnchor="middle" style={{ fontFamily: F.body, fontSize: 10.5, fontWeight: 600, fill: T.sub, userSelect: "none", pointerEvents: "none" }}>{(s.name || "").split(" ")[0]}</text>
                      </g>
                    );
                  })}
                </svg>
                <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginTop: 12, fontSize: 11.5, color: T.sub, alignItems: "center" }}>
                  <span><span style={{ display: "inline-block", width: 22, height: 3, background: T.blue, borderRadius: 2, verticalAlign: "middle", marginRight: 6 }} />mutual choice</span>
                  <span><span style={{ display: "inline-block", width: 22, height: 0, borderTop: "1.5px solid #C7D0DD", verticalAlign: "middle", marginRight: 6 }} />one-way →</span>
                  <span><span style={{ display: "inline-block", width: 22, height: 0, borderTop: `1.5px dashed ${T.red}`, verticalAlign: "middle", marginRight: 6 }} />prefers apart</span>
                  <span><span style={{ display: "inline-block", width: 12, height: 12, borderRadius: 999, border: `2px dashed ${T.red}`, verticalAlign: "middle", marginRight: 6 }} />isolate — chosen by no one</span>
                  <span>bigger circle = chosen more · colour = mutual-friendship cluster · drag to tidy</span>
                </div>
              </>
            )}
          </div>
        )}

        {/* ================= INSIGHTS ================= */}
        {view === "insights" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22, alignItems: "start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
              <div style={S.card}>
                <span style={S.eyebrow}>Watchlist</span>
                <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: T.red, marginBottom: 6 }}>Isolates — chosen by no one ({analysis.isolates.length})</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {analysis.isolates.map((id) => <Pill key={id} tone="red" style={{ fontSize: 11.5 }}>{byId(id)?.name}{analysis.noPicks.includes(id) ? " · chose no one either" : ""}</Pill>)}
                      {!analysis.isolates.length && <span style={{ fontSize: 12.5, color: T.sub }}>None — everyone was chosen by someone. 🎉</span>}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: T.amber, marginBottom: 6 }}>No mutual friendships yet</div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                      {students.filter((s) => analysis.clusterOf[s.id] === undefined && !analysis.isolates.includes(s.id)).map((s) => (
                        <Pill key={s.id} tone="amber" style={{ fontSize: 11.5 }}>{s.name}</Pill>
                      ))}
                      {students.every((s) => analysis.clusterOf[s.id] !== undefined || analysis.isolates.includes(s.id)) && <span style={{ fontSize: 12.5, color: T.sub }}>—</span>}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>Prefers-apart flags ({analysis.avoids.length})</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                      {analysis.avoids.map(([a, b], i) => (
                        <div key={i} style={{ fontSize: 12.5, color: T.sub }}><b style={{ color: T.ink }}>{byId(a)?.name}</b> prefers to be apart from <b style={{ color: T.ink }}>{byId(b)?.name}</b></div>
                      ))}
                      {!analysis.avoids.length && <span style={{ fontSize: 12.5, color: T.sub }}>None recorded.</span>}
                    </div>
                  </div>
                </div>
              </div>
              <div style={S.card}>
                <span style={S.eyebrow}>Stars — most chosen</span>
                <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 6 }}>
                  {students.slice().sort((a, b) => (analysis.received[b.id] || 0) - (analysis.received[a.id] || 0)).slice(0, 6).map((s) => (
                    <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span style={{ fontSize: 12.5, fontWeight: 600, width: 110, flex: "0 0 auto" }}>{s.name}</span>
                      <div style={{ flex: 1, height: 8, borderRadius: 999, background: T.lineSoft, overflow: "hidden" }}>
                        <div style={{ width: `${Math.min(100, (analysis.received[s.id] || 0) / Math.max(1, students.length - 1) * 100 * 2.5)}%`, height: "100%", background: T.blue, borderRadius: 999 }} />
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 700, color: T.blueDeep, width: 20, textAlign: "right" }}>{analysis.received[s.id] || 0}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
              <div style={S.card}>
                <span style={S.eyebrow}>Friendship clusters — mutual links only</span>
                <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                  {analysis.clusters.map((members, i) => {
                    const col = colorFor(i);
                    return (
                      <div key={i} style={{ border: `1px solid ${col.line}`, borderLeft: `4px solid ${col.main}`, borderRadius: 12, padding: "10px 12px", background: col.soft }}>
                        <div style={{ fontSize: 11, fontWeight: 800, color: col.text, marginBottom: 6, letterSpacing: "0.08em", textTransform: "uppercase" }}>Cluster {i + 1} · {members.length} students</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                          {members.map((id) => <span key={id} style={{ ...S.pill, fontSize: 11.5, padding: "4px 10px" }}>{byId(id)?.name}</span>)}
                        </div>
                      </div>
                    );
                  })}
                  {!analysis.clusters.length && <span style={{ fontSize: 12.5, color: T.sub }}>No mutual friendships recorded yet.</span>}
                </div>
              </div>
              <div style={S.card}>
                <span style={S.eyebrow}>Mutual pairs ({analysis.mutual.length})</span>
                <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {analysis.mutual.map(([a, b], i) => (
                    <Pill key={i} tone="blue" style={{ fontSize: 11.5 }}>{byId(a)?.name} ⇆ {byId(b)?.name}</Pill>
                  ))}
                  {!analysis.mutual.length && <span style={{ fontSize: 12.5, color: T.sub }}>None yet.</span>}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
