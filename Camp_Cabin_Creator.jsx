import React, { useState, useEffect, useMemo, useRef } from "react";

/* ============================================================
   CAMP CABIN CREATOR — cabin lists everyone can live with
   CPS · Groupings · standalone tool

   · Campers carry gender, class, friendship nominations and the
     medical / needs notes that matter at 2am on camp
   · Cabins carry a capacity and a type (Girls / Boys / Mixed) —
     or auto-generate the right number from the roster
   · ✦ Suggest cabins fills every bed so that everyone gets at
     least one chosen friend wherever possible, separations are
     enforced, capacities and cabin types respected, and fill is
     balanced — with a swap pass that rescues friendless campers
   · Manual override with re-balance: move or lock any camper,
     then re-suggest around the locks
   · Review is the constraint-transparency layer: friend coverage
     per camper, every separation checked, capacity and medical
     flags per cabin — printable for the camp folder
   · Imports the Sociogram's grouping-data JSON (name-matched),
     so nominations are captured once and reused here
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

/* ---------- cabin colours — same wheel as Chunk & Check levels ---------- */
const COLORS = [
  { main: "#3B82F6", text: "#1D4ED8", soft: "#EFF6FF", line: "#BFDBFE" },
  { main: "#22C55E", text: "#15803D", soft: "#F0FDF4", line: "#BBF7D0" },
  { main: "#EC4899", text: "#BE185D", soft: "#FDF2F8", line: "#FBCFE8" },
  { main: "#F97316", text: "#C2410C", soft: "#FFF7ED", line: "#FED7AA" },
  { main: "#6366F1", text: "#4338CA", soft: "#EEF2FF", line: "#C7D2FE" },
  { main: "#14B8A6", text: "#0F766E", soft: "#F0FDFA", line: "#99F6E4" },
  { main: "#EAB308", text: "#A16207", soft: "#FEFCE8", line: "#FDE68A" },
  { main: "#EF4444", text: "#B91C1C", soft: "#FEF2F2", line: "#FECACA" },
];
const colorFor = (i) => COLORS[((i % COLORS.length) + COLORS.length) % COLORS.length];
const CABIN_TYPES = ["Girls", "Boys", "Mixed"];
const typeAllows = (type, gender) => type === "Mixed" || !gender || (type === "Girls" && gender === "F") || (type === "Boys" && gender === "M");

/* ---------- sample data ---------- */
const SAMPLE = () => {
  const rows = [
    ["Ava R", "5A", "F"], ["Ben T", "5A", "M"], ["Chloe M", "5A", "F"], ["Dev P", "5A", "M"],
    ["Eli S", "5A", "M", "Asthma — puffer in bag"], ["Freya K", "5A", "F"], ["Gus W", "5A", "M"], ["Harper L", "5A", "F"],
    ["Ivy C", "5A", "F", "Homesick last camp — near staff cabin"], ["Jack D", "5A", "M"], ["Kai N", "5A", "M"], ["Lily B", "5A", "F"],
    ["Marcus O", "5B", "M"], ["Nora F", "5B", "F"], ["Oscar H", "5B", "M", "Nut allergy — EpiPen"], ["Priya S", "5B", "F"],
    ["Quinn A", "5B", "F"], ["Ruby J", "5B", "F"], ["Sam E", "5B", "M"], ["Tara V", "5B", "F", "Night medication"],
    ["Umar M", "5B", "M"], ["Violet G", "5B", "F"], ["Will P", "5B", "M"], ["Zoe T", "5B", "F"],
  ];
  const students = rows.map(([name, cls, gender, medical]) => ({ id: uid(), name, cls, gender, medical: medical || "", notes: "" }));
  const id = (n) => students.find((s) => s.name.startsWith(n)).id;
  const socio = {};
  const pick = (from, friends, avoidL = []) => { socio[id(from)] = { friends: friends.map(id), avoid: avoidL.map(id) }; };
  pick("Ava", ["Chloe", "Freya", "Harper"]); pick("Chloe", ["Ava", "Freya", "Lily"]);
  pick("Freya", ["Ava", "Chloe", "Ivy"]); pick("Harper", ["Ava", "Ivy", "Zoe"]);
  pick("Ivy", ["Freya", "Harper", "Lily"]); pick("Lily", ["Chloe", "Ivy", "Ruby"]);
  pick("Ben", ["Jack", "Gus", "Dev"], ["Marcus"]); pick("Jack", ["Ben", "Gus", "Kai"]);
  pick("Gus", ["Ben", "Jack", "Eli"]); pick("Dev", ["Ben", "Kai", "Sam"]);
  pick("Kai", ["Jack", "Dev", "Eli"]); pick("Eli", ["Gus", "Kai", "Will"]);
  pick("Marcus", ["Oscar", "Sam", "Will"], ["Ben"]); pick("Oscar", ["Marcus", "Sam", "Umar"]);
  pick("Sam", ["Marcus", "Oscar", "Dev"]); pick("Umar", ["Oscar", "Will", "Sam"]);
  pick("Will", ["Marcus", "Umar", "Eli"]); pick("Nora", ["Priya", "Ruby", "Quinn"]);
  pick("Priya", ["Nora", "Quinn", "Tara"]); pick("Quinn", ["Priya", "Nora", "Violet"]);
  pick("Ruby", ["Nora", "Lily", "Tara"]); pick("Tara", ["Priya", "Ruby", "Zoe"]);
  pick("Violet", ["Quinn", "Zoe", "Tara"]); pick("Zoe", ["Harper", "Violet", "Tara"]);
  const cabins = [
    { id: uid(), name: "Wombat", type: "Girls", capacity: 6 },
    { id: uid(), name: "Echidna", type: "Girls", capacity: 6 },
    { id: uid(), name: "Kookaburra", type: "Boys", capacity: 6 },
    { id: uid(), name: "Possum", type: "Boys", capacity: 6 },
  ];
  const seps = [[id("Ben"), id("Marcus")]];
  return { students, socio, cabins, seps };
};

/* ============================================================ */
export default function App() {
  const [students, setStudents] = useState([]);
  const [socio, setSocio] = useState({});          // { studentId: { friends:[], avoid:[] } }
  const [cabins, setCabins] = useState([]);        // [{ id, name, type, capacity }]
  const [seps, setSeps] = useState([]);            // [[idA, idB]] — never same cabin
  const [placement, setPlacement] = useState({});  // { studentId: cabinId }
  const [locks, setLocks] = useState({});

  const [view, setView] = useState("campers");     // campers | cabins | build | review
  const [editStudent, setEditStudent] = useState(null);
  const [chipMenu, setChipMenu] = useState(null);
  const [sepFirst, setSepFirst] = useState(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [savedMsg, setSavedMsg] = useState("");
  const loadRef = useRef(null);
  const groupRef = useRef(null);

  /* ---------- persistence ---------- */
  const storeLoaded = useRef(false);
  useEffect(() => {
    (async () => {
      try {
        const raw = await store.get("cabin-creator-doc");
        if (raw) {
          const d = JSON.parse(raw);
          if (d.students) setStudents(d.students);
          if (d.socio) setSocio(d.socio);
          if (d.cabins) setCabins(d.cabins);
          if (d.seps) setSeps(d.seps);
          if (d.placement) setPlacement(d.placement);
          if (d.locks) setLocks(d.locks);
        }
      } catch {}
      storeLoaded.current = true;
    })();
  }, []);
  useEffect(() => {
    if (!storeLoaded.current) return;
    store.set("cabin-creator-doc", JSON.stringify({ students, socio, cabins, seps, placement, locks }));
    setSavedMsg("Saved");
    const t = setTimeout(() => setSavedMsg(""), 1200);
    return () => clearTimeout(t);
  }, [students, socio, cabins, seps, placement, locks]);

  /* ---------- lookups ---------- */
  const byId = (id) => students.find((s) => s.id === id);
  const cabinById = (id) => cabins.find((c) => c.id === id);
  const friendsOf = (id) => (socio[id]?.friends || []).filter((f) => byId(f));
  const inCabin = (cabinId) => students.filter((s) => placement[s.id] === cabinId);

  /* ---------- roster ops ---------- */
  const addStudent = () => { const s = { id: uid(), name: "", cls: "", gender: "", medical: "", notes: "" }; setStudents((p) => [...p, s]); setEditStudent(s.id); };
  const patchStudent = (id, patch) => setStudents((p) => p.map((s) => (s.id === id ? { ...s, ...patch } : s)));
  const removeStudent = (id) => {
    setStudents((p) => p.filter((s) => s.id !== id));
    setSeps((p) => p.filter(([a, b]) => a !== id && b !== id));
    setPlacement((p) => { const n = { ...p }; delete n[id]; return n; });
    setLocks((p) => { const n = { ...p }; delete n[id]; return n; });
    setSocio((p) => {
      const n = {};
      Object.entries(p).forEach(([k, v]) => {
        if (k === id) return;
        n[k] = { friends: (v.friends || []).filter((f) => f !== id), avoid: (v.avoid || []).filter((f) => f !== id) };
      });
      return n;
    });
  };
  const applyPaste = () => {
    const added = pasteText.split(/\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
      const [name, cls, gender] = l.split(/[,\t]/).map((x) => (x || "").trim());
      return { id: uid(), name, cls: cls || "", gender: (gender || "").toUpperCase().slice(0, 1), medical: "", notes: "" };
    }).filter((s) => s.name);
    if (added.length) setStudents((p) => [...p, ...added]);
    setPasteText(""); setPasteOpen(false);
  };
  const toggleFriend = (id, target) => setSocio((p) => {
    const cur = p[id] || { friends: [], avoid: [] };
    const has = cur.friends.includes(target);
    return { ...p, [id]: { ...cur, friends: has ? cur.friends.filter((f) => f !== target) : [...cur.friends, target] } };
  });

  /* ---------- cabins ---------- */
  const addCabin = () => setCabins((p) => [...p, { id: uid(), name: `Cabin ${p.length + 1}`, type: "Mixed", capacity: 6 }]);
  const patchCabin = (id, patch) => setCabins((p) => p.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  const removeCabin = (id) => {
    setCabins((p) => p.filter((c) => c.id !== id));
    setPlacement((p) => { const n = {}; Object.entries(p).forEach(([k, v]) => { if (v !== id) n[k] = v; }); return n; });
  };
  const autoCabins = () => {
    const cap = Number(window.prompt("Beds per cabin?", "6"));
    if (!cap || cap < 1) return;
    const f = students.filter((s) => s.gender === "F").length;
    const m = students.filter((s) => s.gender === "M").length;
    const other = students.length - f - m;
    const made = [];
    const girlNames = ["Wombat", "Echidna", "Platypus", "Bilby", "Quokka", "Numbat"];
    const boyNames = ["Kookaburra", "Possum", "Goanna", "Dingo", "Wallaby", "Emu"];
    for (let i = 0; i < Math.ceil(f / cap); i++) made.push({ id: uid(), name: girlNames[i] || `Girls ${i + 1}`, type: "Girls", capacity: cap });
    for (let i = 0; i < Math.ceil(m / cap); i++) made.push({ id: uid(), name: boyNames[i] || `Boys ${i + 1}`, type: "Boys", capacity: cap });
    if (other > 0) made.push({ id: uid(), name: "Mixed", type: "Mixed", capacity: cap });
    setCabins(made);
    setPlacement({}); setLocks({});
  };

  /* ---------- separations ---------- */
  const tapSep = (id) => {
    if (!sepFirst) { setSepFirst(id); return; }
    if (sepFirst === id) { setSepFirst(null); return; }
    if (!seps.some(([x, y]) => (x === sepFirst && y === id) || (x === id && y === sepFirst))) setSeps((p) => [...p, [sepFirst, id]]);
    setSepFirst(null);
  };

  /* ---------- suggestion engine ---------- */
  const violatesSep = (studentId, cabinId, place) =>
    seps.some(([a, b]) => (a === studentId && place[b] === cabinId) || (b === studentId && place[a] === cabinId));
  const feasible = (s, cabin, place) =>
    typeAllows(cabin.type, s.gender) &&
    students.filter((x) => place[x.id] === cabin.id).length < (cabin.capacity || 6) &&
    !violatesSep(s.id, cabin.id, place);

  const suggestCabins = () => {
    if (!cabins.length) { window.alert("Add cabins first (Cabins tab) — or use ✦ Auto-generate."); return; }
    if (Object.keys(placement).length && !window.confirm("Re-suggest cabins? Locked campers stay put; everyone else may move.")) return;

    const place = {};
    students.forEach((s) => { if (locks[s.id] && placement[s.id] && cabinById(placement[s.id])) place[s.id] = placement[s.id]; });

    const chose = (a, b) => (socio[a]?.friends || []).includes(b);
    /* mutual clusters first so friendship groups seed cabins together */
    const parent = {};
    students.forEach((s) => { parent[s.id] = s.id; });
    const find = (x) => (parent[x] === x ? x : (parent[x] = find(parent[x])));
    students.forEach((s) => friendsOf(s.id).forEach((f) => { if (chose(f, s.id)) parent[find(s.id)] = find(f); }));
    const compMap = {};
    students.forEach((s) => { const rt = find(s.id); (compMap[rt] = compMap[rt] || []).push(s); });
    const ordered = Object.values(compMap).sort((a, b) => b.length - a.length).flat().filter((s) => !place[s.id]);

    const score = (s, cabin) => {
      const members = students.filter((x) => place[x.id] === cabin.id);
      let sc = 0;
      sc += friendsOf(s.id).filter((f) => members.some((m) => m.id === f)).length * 4;
      sc += members.filter((m) => chose(m.id, s.id)).length * 1.5;
      sc -= members.length * 0.6; // spread the fill
      return sc;
    };
    ordered.forEach((s) => {
      let best = null, bestSc = -Infinity;
      cabins.forEach((c) => {
        if (!feasible(s, c, place)) return;
        const sc = score(s, c);
        if (sc > bestSc) { bestSc = sc; best = c.id; }
      });
      if (best === null) {
        /* no feasible cabin (capacity/type/sep) — least-bad: ignore capacity, keep type + sep */
        const fallback = cabins.find((c) => typeAllows(c.type, s.gender) && !violatesSep(s.id, c.id, place)) || cabins[0];
        best = fallback.id;
      }
      place[s.id] = best;
    });

    /* rescue pass — friendless campers try a move, then a swap */
    const friendless = () => students.filter((s) => {
      if (locks[s.id]) return false;
      const fs = friendsOf(s.id);
      return fs.length && place[s.id] && !fs.some((f) => place[f] === place[s.id]);
    });
    friendless().forEach((s) => {
      for (const f of friendsOf(s.id)) {
        const dest = cabinById(place[f]);
        if (!dest || dest.id === place[s.id]) continue;
        if (feasible(s, dest, { ...place, [s.id]: undefined })) { place[s.id] = dest.id; return; }
      }
      /* swap: someone in the friend's cabin who wouldn't be made friendless */
      for (const f of friendsOf(s.id)) {
        const destId = place[f];
        if (!destId || destId === place[s.id]) continue;
        const dest = cabinById(destId);
        const home = cabinById(place[s.id]);
        if (!dest || !home) continue;
        const candidate = students.find((t) => {
          if (place[t.id] !== destId || locks[t.id] || t.id === f) return false;
          if (!typeAllows(home.type, t.gender) || !typeAllows(dest.type, s.gender)) return false;
          if (violatesSep(t.id, home.id, { ...place, [s.id]: undefined }) || violatesSep(s.id, destId, { ...place, [t.id]: undefined })) return false;
          const tFriends = friendsOf(t.id);
          const tStillOk = !tFriends.length || tFriends.some((x) => x !== s.id && place[x] === home.id);
          const tHadFriendHere = tFriends.some((x) => x !== s.id && place[x] === destId);
          return tStillOk || !tHadFriendHere;
        });
        if (candidate) { const a = place[s.id]; place[s.id] = destId; place[candidate.id] = a; return; }
      }
    });

    setPlacement(place);
    setView("build");
  };

  /* ---------- review data ---------- */
  const report = useMemo(() => {
    const placedAll = students.filter((s) => placement[s.id] && cabinById(placement[s.id]));
    const sepsR = seps.map(([a, b]) => ({ a, b, ok: !placement[a] || !placement[b] || placement[a] !== placement[b] }));
    const friendless = placedAll.filter((s) => {
      const fs = friendsOf(s.id);
      return fs.length && !fs.some((f) => placement[f] === placement[s.id]);
    });
    const noData = placedAll.filter((s) => !friendsOf(s.id).length);
    const over = cabins.filter((c) => inCabin(c.id).length > (c.capacity || 6));
    const typeErr = placedAll.filter((s) => !typeAllows(cabinById(placement[s.id]).type, s.gender));
    const unplaced = students.filter((s) => !placement[s.id] || !cabinById(placement[s.id]));
    return { placedAll, sepsR, friendless, noData, over, typeErr, unplaced };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students, placement, seps, socio, cabins]);

  /* ---------- backup / grouping data ---------- */
  const download = (obj, filename) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" }));
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const exportBackup = () => download({ students, socio, cabins, seps, placement, locks }, "cabin-creator-backup.json");
  const loadBackup = async (file) => {
    if (!file) return;
    try {
      const d = JSON.parse(await file.text());
      if (!window.confirm("Replace everything with this backup?")) return;
      setStudents(d.students || []); setSocio(d.socio || {}); setCabins(d.cabins || []);
      setSeps(d.seps || []); setPlacement(d.placement || {}); setLocks(d.locks || {});
    } catch { window.alert("That file isn't a valid backup."); }
  };
  const importGrouping = async (file) => {
    if (!file) return;
    try {
      const d = JSON.parse(await file.text());
      if (!Array.isArray(d.students)) throw new Error();
      const idMap = {};
      const additions = [];
      d.students.forEach((imp) => {
        const match = students.find((s) => s.name.trim().toLowerCase() === (imp.name || "").trim().toLowerCase());
        if (match) idMap[imp.id] = match.id;
        else {
          const ns = { id: uid(), name: imp.name || "", cls: imp.cls || "", gender: imp.gender || "", medical: "", notes: imp.notes || "" };
          idMap[imp.id] = ns.id;
          additions.push(ns);
        }
      });
      const socioNew = {};
      Object.entries(d.socio || {}).forEach(([k, v]) => {
        if (!idMap[k]) return;
        socioNew[idMap[k]] = {
          friends: (v.friends || []).map((f) => idMap[f]).filter(Boolean),
          avoid: (v.avoid || []).map((f) => idMap[f]).filter(Boolean),
        };
      });
      if (!window.confirm(`Import grouping data: ${additions.length} new campers, nominations for ${Object.keys(socioNew).length}. Prefers-apart pairs are offered as separations.`)) return;
      if (additions.length) setStudents((p) => [...p, ...additions]);
      setSocio((p) => ({ ...p, ...socioNew }));
      /* prefers-apart → separations (deduped) */
      const newSeps = [];
      Object.entries(socioNew).forEach(([k, v]) => (v.avoid || []).forEach((b) => {
        if (!seps.some(([x, y]) => (x === k && y === b) || (x === b && y === k)) && !newSeps.some(([x, y]) => (x === k && y === b) || (x === b && y === k))) newSeps.push([k, b]);
      }));
      if (newSeps.length && window.confirm(`Add ${newSeps.length} prefers-apart pairs as cabin separations?`)) setSeps((p) => [...p, ...newSeps]);
    } catch { window.alert("That file isn't grouping data (expects { students:[...], socio:{...} })."); }
  };

  const beds = cabins.reduce((n, c) => n + (Number(c.capacity) || 0), 0);

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
          <Pill tone="blue" style={{ fontSize: 11 }}>CPS · Groupings · Camp</Pill>
          <h1 style={{ fontFamily: F.display, fontWeight: 800, fontSize: 34, letterSpacing: "-0.02em", margin: "12px 0 6px" }}>
            Cabin <span style={{ color: T.blue }}>Creator</span>
          </h1>
          <div style={{ fontSize: 14, color: T.sub, maxWidth: 620, margin: "0 auto", lineHeight: 1.55 }}>
            Cabin lists everyone can live with — every camper gets a chosen friend where possible,
            separations hold, capacities hold, and the medical flags travel with the list.
          </div>
          <div className="no-print" style={{ display: "flex", gap: 8, justifyContent: "center", marginTop: 16, flexWrap: "wrap" }}>
            {[["campers", "Campers"], ["cabins", "Cabins"], ["build", "Build"], ["review", "Review"]].map(([k, lab]) => (
              <button key={k} onClick={() => setView(k)}
                style={{ ...S.btnGhost, ...(view === k ? { background: T.ink, color: "#FFF", borderColor: T.ink } : {}) }}>
                {lab}
              </button>
            ))}
            <button style={{ ...S.btnGhost, padding: "5px 12px", fontSize: 11, color: T.sub }} onClick={() => groupRef.current?.click()} title="Import the Sociogram's grouping-data JSON">Import grouping data</button>
            <input ref={groupRef} type="file" hidden accept=".json,application/json" onChange={(e) => { importGrouping(e.target.files?.[0]); e.target.value = ""; }} />
            <button style={{ ...S.btnGhost, padding: "5px 12px", fontSize: 11, color: T.sub }} onClick={exportBackup} title="Download everything as a JSON backup">Backup</button>
            <button style={{ ...S.btnGhost, padding: "5px 12px", fontSize: 11, color: T.sub }} onClick={() => loadRef.current?.click()} title="Restore from a JSON backup">Restore</button>
            <input ref={loadRef} type="file" hidden accept=".json,application/json" onChange={(e) => { loadBackup(e.target.files?.[0]); e.target.value = ""; }} />
            {savedMsg && <Pill tone="green" style={{ fontSize: 10.5 }}>{savedMsg}</Pill>}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1180, margin: "0 auto", padding: "26px 22px 80px" }}>

        {/* ================= CAMPERS ================= */}
        {view === "campers" && (
          <div style={S.card}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              <span style={S.eyebrow}>Campers</span>
              <Pill style={{ fontSize: 10.5 }}>{students.length} campers</Pill>
              <Pill tone={students.length > beds && beds > 0 ? "red" : "plain"} style={{ fontSize: 10.5 }}>{beds} beds</Pill>
              <span style={{ flex: 1 }} />
              <button style={{ ...S.btnGhost, padding: "6px 14px", fontSize: 12 }} onClick={() => setPasteOpen(!pasteOpen)}>Paste list</button>
              <button style={{ ...S.btn, padding: "6px 14px", fontSize: 12 }} onClick={addStudent}>+ Camper</button>
            </div>
            {pasteOpen && (
              <div style={{ marginBottom: 14, padding: 12, borderRadius: 12, background: T.blueSoft, border: `1px solid ${T.blueLine}` }}>
                <label style={S.label}>One camper per line — <span style={{ fontWeight: 400, color: T.sub }}>Name, class, gender</span></label>
                <textarea style={{ ...S.input, minHeight: 90, resize: "vertical" }} value={pasteText} onChange={(e) => setPasteText(e.target.value)} placeholder={"Ava R, 5A, F\nBen T, 5A, M"} />
                <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                  <button style={{ ...S.btn, padding: "6px 14px", fontSize: 12 }} onClick={applyPaste}>Add campers</button>
                  <button style={{ ...S.btnGhost, padding: "6px 14px", fontSize: 12 }} onClick={() => setPasteOpen(false)}>Cancel</button>
                </div>
              </div>
            )}
            {!students.length && !pasteOpen && (
              <div style={{ fontSize: 13, color: T.sub, lineHeight: 1.6 }}>
                No campers yet. Add them, paste a list, import grouping data from the Sociogram (header), or{" "}
                <button onClick={() => { const s = SAMPLE(); setStudents(s.students); setSocio(s.socio); setCabins(s.cabins); setSeps(s.seps); }}
                  style={{ border: "none", background: "none", cursor: "pointer", color: T.blueDeep, fontWeight: 700, fontSize: 13, padding: 0 }}>
                  load sample data
                </button>{" "}
                to see the tool working.
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {students.map((s) => {
                const open = editStudent === s.id;
                const fs = friendsOf(s.id);
                return (
                  <div key={s.id} style={{ border: `1px solid ${open ? T.blueLine : T.lineSoft}`, borderRadius: 12, padding: "10px 12px", background: open ? T.blueSoft : "#FCFDFE" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ width: 26, height: 26, borderRadius: 999, background: T.blue, color: "#FFF", fontSize: 10.5, fontWeight: 800, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{initials(s.name)}</span>
                      <div style={{ minWidth: 130 }}>
                        <div style={{ fontFamily: F.display, fontWeight: 700, fontSize: 13.5 }}>{s.name || "Unnamed"}</div>
                        <div style={{ fontSize: 11, color: T.sub }}>{[s.cls, s.gender].filter(Boolean).join(" · ") || "—"}</div>
                      </div>
                      {s.medical && <Pill tone="red" style={{ fontSize: 10.5, padding: "3px 10px" }}>⚕ {s.medical}</Pill>}
                      {fs.length > 0 && <span style={{ fontSize: 11, color: T.faint }}>friends: {fs.map((f) => byId(f)?.name.split(" ")[0]).join(", ")}</span>}
                      <span style={{ flex: 1 }} />
                      <button style={{ ...S.btnGhost, padding: "3px 10px", fontSize: 11 }} onClick={() => setEditStudent(open ? null : s.id)}>{open ? "Done" : "Edit"}</button>
                      <button style={{ ...S.btnGhost, padding: "3px 8px", fontSize: 11, color: T.red, borderColor: T.redLine }} onClick={() => removeStudent(s.id)}>✕</button>
                    </div>
                    {open && (
                      <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 12 }}>
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                          <div>
                            <label style={S.label}>Name</label>
                            <input style={S.input} value={s.name} onChange={(e) => patchStudent(s.id, { name: e.target.value })} placeholder="e.g. Ava R" />
                          </div>
                          <div>
                            <label style={S.label}>Class</label>
                            <input style={S.input} value={s.cls} onChange={(e) => patchStudent(s.id, { cls: e.target.value })} placeholder="e.g. 5A" />
                          </div>
                          <div>
                            <label style={S.label}>Gender</label>
                            <div style={{ display: "flex", gap: 6 }}>
                              {["F", "M"].map((g) => (
                                <button key={g} onClick={() => patchStudent(s.id, { gender: s.gender === g ? "" : g })}
                                  style={{ ...S.btnGhost, padding: "8px 16px", ...(s.gender === g ? { background: T.ink, color: "#FFF", borderColor: T.ink } : { color: T.faint }) }}>
                                  {g}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div>
                            <label style={S.label}>Medical / needs <span style={{ fontWeight: 400, color: T.sub }}>(travels with the cabin list)</span></label>
                            <input style={S.input} value={s.medical || ""} onChange={(e) => patchStudent(s.id, { medical: e.target.value })} placeholder="e.g. asthma, night meds, near staff" />
                          </div>
                        </div>
                        <div>
                          <label style={S.label}>Wants to share with</label>
                          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                            {students.filter((o) => o.id !== s.id).map((o) => {
                              const on = fs.includes(o.id);
                              return (
                                <button key={o.id} onClick={() => toggleFriend(s.id, o.id)}
                                  style={{ ...S.btnGhost, padding: "5px 12px", fontSize: 11.5, ...(on ? { background: T.blueSoft, borderColor: T.blue, color: T.blueDeep } : { color: T.faint }) }}>
                                  {o.name}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {students.length > 0 && (
              <div style={{ marginTop: 18, paddingTop: 16, borderTop: `1px solid ${T.lineSoft}` }}>
                <span style={S.eyebrow}>Separations — never the same cabin</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, margin: "10px 0" }}>
                  {seps.map(([a, b], i) => (
                    <Pill key={i} tone="red" style={{ fontSize: 11.5 }}>
                      {byId(a)?.name} × {byId(b)?.name}
                      <button style={{ border: "none", background: "none", cursor: "pointer", color: "inherit", fontWeight: 800, padding: 0 }} onClick={() => setSeps((p) => p.filter((_, j) => j !== i))}>✕</button>
                    </Pill>
                  ))}
                  {!seps.length && <span style={{ fontSize: 12.5, color: T.faint }}>None yet.</span>}
                </div>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: sepFirst ? T.red : T.faint, marginBottom: 8 }}>
                  {sepFirst ? `${byId(sepFirst)?.name} — now tap the second camper` : "Tap two campers to add a separation:"}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                  {students.map((s) => (
                    <button key={s.id} onClick={() => tapSep(s.id)}
                      style={{ ...S.btnGhost, padding: "4px 10px", fontSize: 11.5, ...(sepFirst === s.id ? { background: T.ink, color: "#FFF", borderColor: T.ink } : {}) }}>
                      {s.name}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ================= CABINS ================= */}
        {view === "cabins" && (
          <div style={S.card}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
              <span style={S.eyebrow}>Cabins</span>
              <Pill style={{ fontSize: 10.5 }}>{cabins.length} cabins · {beds} beds · {students.length} campers</Pill>
              <span style={{ flex: 1 }} />
              <button style={{ ...S.btnGhost, padding: "6px 14px", fontSize: 12 }} onClick={autoCabins}>✦ Auto-generate from roster</button>
              <button style={{ ...S.btn, padding: "6px 14px", fontSize: 12 }} onClick={addCabin}>+ Cabin</button>
            </div>
            {!cabins.length && <div style={{ fontSize: 13, color: T.sub }}>No cabins yet — add them, or auto-generate the right number of Girls/Boys cabins from the roster.</div>}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 12 }}>
              {cabins.map((c, ci) => {
                const col = colorFor(ci);
                return (
                  <div key={c.id} style={{ border: `1px solid ${T.lineSoft}`, borderTop: `4px solid ${col.main}`, borderRadius: 12, padding: 12, background: "#FCFDFE" }}>
                    <input style={{ ...S.input, padding: "6px 10px", fontSize: 13.5, fontWeight: 700, marginBottom: 8 }} value={c.name} onChange={(e) => patchCabin(c.id, { name: e.target.value })} placeholder="Cabin name" />
                    <div style={{ display: "flex", gap: 5, marginBottom: 8 }}>
                      {CABIN_TYPES.map((tp) => (
                        <button key={tp} onClick={() => patchCabin(c.id, { type: tp })}
                          style={{ ...S.btnGhost, padding: "4px 10px", fontSize: 11, ...(c.type === tp ? { background: col.soft, borderColor: col.main, color: col.text } : { color: T.faint }) }}>
                          {tp}
                        </button>
                      ))}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <label style={{ ...S.label, marginBottom: 0 }}>Beds</label>
                      <input style={{ ...S.input, width: 70, padding: "6px 10px" }} type="number" min="1" max="20" value={c.capacity} onChange={(e) => patchCabin(c.id, { capacity: Number(e.target.value) || 1 })} />
                      <span style={{ flex: 1 }} />
                      <button style={{ ...S.btnGhost, padding: "3px 8px", fontSize: 11, color: T.red, borderColor: T.redLine }} onClick={() => removeCabin(c.id)}>✕</button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ================= BUILD ================= */}
        {view === "build" && (
          <div>
            <div className="no-print" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
              <button style={S.btn} onClick={suggestCabins}>✦ Suggest cabins</button>
              <span style={{ fontSize: 12, color: T.sub }}>Tap a camper to move or lock them; re-suggest re-balances around the locks.</span>
              <span style={{ flex: 1 }} />
              {report.unplaced.length > 0 && <Pill tone="amber" style={{ fontSize: 11 }}>{report.unplaced.length} unplaced</Pill>}
              <button style={{ ...S.btnGhost, fontSize: 12 }} onClick={() => window.print()}>Print</button>
              <button style={{ ...S.btnGhost, fontSize: 12, color: T.red, borderColor: T.redLine }} onClick={() => { if (window.confirm("Clear all placements?")) { setPlacement({}); setLocks({}); } }}>Clear</button>
            </div>
            {!cabins.length ? (
              <div style={{ ...S.card, fontSize: 13.5, color: T.sub, textAlign: "center", padding: 30 }}>Add cabins first — the Cabins tab can auto-generate them from the roster.</div>
            ) : (
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 16, alignItems: "start" }}>
                {cabins.map((c, ci) => {
                  const col = colorFor(ci);
                  const members = inCabin(c.id);
                  const cap = c.capacity || 6;
                  return (
                    <div key={c.id} style={{ ...S.card, padding: 14, borderTop: `4px solid ${col.main}` }}>
                      <div style={{ marginBottom: 8 }}>
                        <div style={{ fontFamily: F.display, fontWeight: 800, fontSize: 15 }}>{c.name}</div>
                        <div style={{ fontSize: 11, color: T.sub }}>{c.type} · {members.length}/{cap} beds</div>
                        <div style={{ height: 5, borderRadius: 999, background: T.lineSoft, marginTop: 6, overflow: "hidden" }}>
                          <div style={{ width: `${Math.min(100, (members.length / cap) * 100)}%`, height: "100%", background: members.length > cap ? T.red : col.main, borderRadius: 999 }} />
                        </div>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
                        {members.sort((a, b) => (a.name || "").localeCompare(b.name || "")).map((s) => {
                          const menuOpen = chipMenu === s.id;
                          const fs = friendsOf(s.id);
                          const friendless = fs.length > 0 && !fs.some((f) => placement[f] === c.id);
                          return (
                            <div key={s.id} style={{ position: "relative" }}>
                              <button onClick={() => setChipMenu(menuOpen ? null : s.id)}
                                style={{ ...S.btnGhost, width: "100%", display: "flex", alignItems: "center", gap: 6, borderRadius: 10, padding: "6px 10px", textAlign: "left",
                                  ...(locks[s.id] ? { borderColor: T.ink } : {}), ...(friendless ? { borderColor: T.amberLine, background: T.amberSoft } : {}) }}>
                                <span style={{ fontSize: 12.5, fontWeight: 600, flex: 1 }}>{s.name}</span>
                                {s.medical && <span title={s.medical} style={{ fontSize: 10, color: T.red }}>⚕</span>}
                                {friendless && <span title="No chosen friend in this cabin" style={{ fontSize: 10 }}>⚠</span>}
                                {locks[s.id] && <span style={{ fontSize: 10 }}>🔒</span>}
                              </button>
                              {menuOpen && (
                                <div className="no-print" style={{ position: "absolute", zIndex: 20, top: "100%", left: 0, right: 0, background: T.card, border: `1px solid ${T.line}`, borderRadius: 12, boxShadow: T.shadow, padding: 8, display: "flex", flexDirection: "column", gap: 4 }}>
                                  <div style={{ fontSize: 10.5, color: T.sub, padding: "2px 6px" }}>
                                    {fs.length ? `wants: ${fs.map((f) => byId(f)?.name.split(" ")[0]).join(", ")}` : "no nominations"}{s.medical && ` · ⚕ ${s.medical}`}
                                  </div>
                                  <button style={{ ...S.btnGhost, fontSize: 11.5, padding: "5px 10px" }} onClick={() => { setLocks((p) => ({ ...p, [s.id]: !p[s.id] })); setChipMenu(null); }}>
                                    {locks[s.id] ? "Unlock" : "🔒 Lock here"}
                                  </button>
                                  {cabins.filter((o) => o.id !== c.id).map((o) => {
                                    const warn = !typeAllows(o.type, s.gender) ? " ⚠ " + o.type : seps.some(([a, b]) => (a === s.id && placement[b] === o.id) || (b === s.id && placement[a] === o.id)) ? " ⚠ separation" : inCabin(o.id).length >= (o.capacity || 6) ? " ⚠ full" : "";
                                    return (
                                      <button key={o.id} style={{ ...S.btnGhost, fontSize: 11.5, padding: "5px 10px" }}
                                        onClick={() => { setPlacement((p) => ({ ...p, [s.id]: o.id })); setChipMenu(null); }}>
                                        → {o.name}{warn}
                                      </button>
                                    );
                                  })}
                                  <button style={{ ...S.btnGhost, fontSize: 11.5, padding: "5px 10px", color: T.red, borderColor: T.redLine }}
                                    onClick={() => { setPlacement((p) => { const n = { ...p }; delete n[s.id]; return n; }); setChipMenu(null); }}>
                                    Unplace
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {!members.length && <div style={{ fontSize: 12, color: T.faint, padding: 6 }}>Empty.</div>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {report.unplaced.length > 0 && cabins.length > 0 && (
              <div style={{ ...S.card, marginTop: 16 }}>
                <span style={S.eyebrow}>Unplaced</span>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                  {report.unplaced.map((s) => <Pill key={s.id} style={{ fontSize: 12 }}>{s.name}</Pill>)}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ================= REVIEW ================= */}
        {view === "review" && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22, alignItems: "start" }}>
            <div style={S.card}>
              <span style={S.eyebrow}>Constraint transparency</span>
              <div style={{ fontSize: 12, color: T.sub, margin: "8px 0 14px" }}>What the current build satisfies, and what it traded off.</div>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>Separations</div>
                {report.sepsR.map((k, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, marginBottom: 3 }}>
                    <span style={{ fontWeight: 800, color: k.ok ? T.green : T.red }}>{k.ok ? "✓" : "✗"}</span>
                    <span style={{ color: k.ok ? T.ink : T.red }}>{byId(k.a)?.name} × {byId(k.b)?.name}{!k.ok && " — in the same cabin!"}</span>
                  </div>
                ))}
                {!report.sepsR.length && <span style={{ fontSize: 12, color: T.faint }}>None set.</span>}
              </div>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>Friend coverage</div>
                {report.placedAll.length ? (
                  <div style={{ fontSize: 12.5, color: T.sub, lineHeight: 1.6 }}>
                    <b style={{ color: T.green }}>{report.placedAll.length - report.friendless.length - report.noData.length}</b> campers have at least one chosen friend in their cabin
                    {report.noData.length > 0 && <> · <b>{report.noData.length}</b> with no nomination data</>}.
                    {report.friendless.length > 0 && (
                      <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 5 }}>
                        {report.friendless.map((s) => <Pill key={s.id} tone="amber" style={{ fontSize: 11 }}>{s.name} — no friend in cabin</Pill>)}
                      </div>
                    )}
                  </div>
                ) : <span style={{ fontSize: 12, color: T.faint }}>Nothing placed yet.</span>}
              </div>
              <div style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>Capacity & cabin types</div>
                <div style={{ fontSize: 12.5, color: T.sub, lineHeight: 1.6 }}>
                  {report.over.length ? report.over.map((c) => <div key={c.id} style={{ color: T.red }}>✗ {c.name} over capacity ({inCabin(c.id).length}/{c.capacity})</div>) : <div style={{ color: T.green }}>✓ No cabin over capacity</div>}
                  {report.typeErr.length ? report.typeErr.map((s) => <div key={s.id} style={{ color: T.red }}>✗ {s.name} in a {cabinById(placement[s.id])?.type} cabin</div>) : <div style={{ color: T.green }}>✓ Everyone matches their cabin type</div>}
                </div>
              </div>
            </div>
            <div style={S.card}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
                <span style={S.eyebrow}>Cabin lists — for the camp folder</span>
                <span style={{ flex: 1 }} />
                <button className="no-print" style={{ ...S.btnGhost, fontSize: 12 }} onClick={() => window.print()}>Print</button>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
                {cabins.map((c, ci) => (
                  <div key={c.id} style={{ border: `1px solid ${T.lineSoft}`, borderTop: `3px solid ${colorFor(ci).main}`, borderRadius: 12, padding: "10px 12px" }}>
                    <div style={{ fontFamily: F.display, fontWeight: 800, fontSize: 14 }}>{c.name} <span style={{ fontWeight: 600, color: T.sub, fontSize: 11.5 }}>· {c.type} · {inCabin(c.id).length}/{c.capacity}</span></div>
                    <div style={{ fontSize: 12.5, lineHeight: 1.7, marginTop: 4 }}>
                      {inCabin(c.id).sort((a, b) => (a.name || "").localeCompare(b.name || "")).map((s) => (
                        <div key={s.id}>{s.name}{s.medical && <span style={{ color: T.red, fontSize: 11 }}> · ⚕ {s.medical}</span>}</div>
                      ))}
                      {!inCabin(c.id).length && <span style={{ color: T.faint }}>Empty</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {chipMenu && <div style={{ position: "fixed", inset: 0, zIndex: 10 }} onClick={() => setChipMenu(null)} />}
    </div>
  );
}
