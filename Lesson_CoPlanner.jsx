import React, { useState, useEffect, useRef } from "react";

/* ============================================================
   LESSON CO-PLANNER — AI-assisted lesson planning
   CPS · explicit teaching model · standalone tool

   · The planner IS the template: a sheet of rows matching the
     CPS lesson-plan doc (Hook/PK CFU → LI → SOLO SC → Unpack →
     Chunk Examples (Show One / Try One) → CFU #1 → Purposeful
     Task → Reflective Prompt → CFU #2 → Adjustments)
   · Teacher provides the Learning Intention, the Core SC
     (one SOLO verb per chunk, microskills allowed) and Core+,
     plus the context/lens and prior knowledge
   · Claude co-plans the rest field by field: every Show One /
     Try One is grounded in the context, every Try One / CFU
     can be reframed for a chosen check method (mini
     whiteboards, Turn & Talk, cold call, gestures, tickets…)
   · Generate more than one option per field and pick
   · Adjustment groups are saved per subject and reused across
     lessons; scaffolds + task-complexity ideas generated per
     group. Core− works towards the first 1–2 SC w. scaffolds,
     Core+ is a task add-on (never modelled)
   · Output view mirrors the doc; one click copies the table
     for pasting into Google Docs
   · Aesthetic + patterns lifted from Chunk & Check
   ============================================================ */

/* ---------- misc helpers ---------- */
const uid = () => Math.random().toString(36).slice(2, 9);
const ROMAN = ["i", "ii", "iii", "iv", "v", "vi"];

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

/* ---------- Anthropic API helper ----------
   Keyless works inside claude.ai (proxied). Everywhere else (GitHub Pages
   etc.) an API key from Settings is sent browser-direct. */
let API_KEY = "";
async function askClaude(prompt, maxTokens = 2000) {
  const headers = { "Content-Type": "application/json" };
  if (API_KEY) {
    headers["x-api-key"] = API_KEY;
    headers["anthropic-version"] = "2023-06-01";
    headers["anthropic-dangerous-direct-browser-access"] = "true";
  }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers,
    body: JSON.stringify({ model: "claude-sonnet-5", max_tokens: maxTokens, messages: [{ role: "user", content: prompt }] }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || "API error");
  return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
}
const parseJSON = (text) => {
  const cleaned = text.replace(/```json|```/g, "").trim();
  const start = cleaned.search(/[{[]/);
  return JSON.parse(start > 0 ? cleaned.slice(start) : cleaned);
};

/* ---------- vocabulary ---------- */
const CHECK_METHODS = [
  "Mini whiteboards", "Turn & Talk", "Cold call", "Warm call", "Choral response",
  "Gestures / signals", "Entry ticket", "Exit ticket", "Post-it", "Roam & listen",
];
const LESSON_TYPES = [
  "Writing 1", "Writing 2", "Writing 3", "Reading 1", "Reading 2", "CARS",
  "Grammar & Punctuation", "Spelling 1", "Spelling 2", "Spelling 3", "Spelling 4",
  "Applied Maths 1", "Applied Maths 2", "Zoned Maths", "SURF 1", "SURF 2",
  "Science 1", "Science 2", "Health", "Makerspace",
];
const YEARS = ["Prep", "Year 1", "Year 2", "Year 3", "Year 3/4", "Year 4", "Year 4/5", "Year 5", "Year 5/6", "Year 6"];

/* ---------- data shapes ---------- */
const newField = () => ({ options: [], sel: null });
const newOpt = (text = "", method = "") => ({ id: uid(), text, method });
const newChunk = () => ({ id: uid(), sc: "", micro: [], showOne: newField(), tryOne: newField() });
const newPlan = () => ({
  id: uid(), updatedAt: Date.now(),
  lessonType: "", title: "", year: "Year 3", subjectId: null,
  li: "", context: "", priorKnowledge: "", resources: "",
  chunks: [newChunk()], corePlus: "",
  hook: newField(),
  unpack: { purpose: "", concept: "" },
  cfu1: newField(),
  task: newField(), taskCorePlus: "",
  reflect: newField(),
  cfu2: newField(),
  adjustments: {}, // groupId (or "extension") -> { complexity, scaffolds }
});
const seedSubjects = () => [
  { id: uid(), name: "Writing", groups: [
    { id: uid(), name: "Writing ‘Support’", needs: "Core− — work towards the first 1–2 Core SC with scaffolds embedded; fewer items than Core." },
    { id: uid(), name: "Students w. Dyslexia", needs: "Reduce decoding load: chunked instructions, syllable markers, minimal copying." },
    { id: uid(), name: "EAL Students", needs: "Vocabulary support: word banks, sentence frames, visuals." },
  ]},
  { id: uid(), name: "Reading", groups: [
    { id: uid(), name: "Reading ‘Support’", needs: "Core− — first 1–2 Core SC with scaffolds; shorter or levelled text." },
    { id: uid(), name: "EAL Students", needs: "Pre-taught vocabulary, visuals, peer pairing." },
  ]},
  { id: uid(), name: "Maths", groups: [
    { id: uid(), name: "Maths ‘Support’", needs: "Core− — first 1–2 Core SC; concrete materials and worked-example references." },
    { id: uid(), name: "EAL Students", needs: "Worded-problem vocabulary support; visuals over text." },
  ]},
];

/* ---------- prompt layer ---------- */
const PEDAGOGY = `You are an expert lesson co-planner for a Victorian primary school that uses an explicit-teaching instructional model.
Lesson shape: Hook (prior-knowledge retrieval with a quick check) → Unpack the Learning Intention (purpose + concept) → chunked mini lesson — for each chunk a Show One (I Do worked example) then a Try One (We Do attempt checked with a whole-class CFU method) → CFU #1 hinge question (ready for the task?) → Purposeful Task → Reflective Prompt → CFU #2.
Rules:
- Success criteria are SOLO-aligned, one SOLO verb per chunk; a chunk may hold microskills labelled i), ii).
- Core SC = the main group (~80% of the class). Core− students work towards the first one or two Core SC with scaffolds embedded. Core+ is a deeper-SOLO-verb extension: a task add-on only, never modelled in the mini lesson.
- Every Show One and Try One must use concrete content drawn from the lesson's context/lens — real sentences, numbers or examples a teacher could display verbatim. Never generic advice like "model an example".
- A Try One mirrors its Show One: same skill, fresh example, checked with the named CFU method; say what the teacher tracks and how to respond.
- Anticipate the most likely student misconception for this content and let it shape the Hook and CFU questions.
- Pitch language and complexity to the stated year level.
- Style: terse teacher-planner dot points, Australian English, sentence fragments fine. Match this register: "- Display two sentences on the screen: 'The narrow laneways are covered in street art.' vs 'The thin laneways are covered in street art.' Turn & Talk: what's different, and does the fact still mean the same thing?"
Respond ONLY with the requested JSON object. No markdown fences, no commentary.`;

const selText = (f) => { const o = f.options.find((x) => x.id === f.sel); return o ? o.text : ""; };
const selMethod = (f) => { const o = f.options.find((x) => x.id === f.sel); return o ? o.method || "" : ""; };

function briefText(p) {
  const chunkLines = p.chunks.map((c, i) => {
    const ms = (c.micro || []).filter((m) => m.trim());
    return `Chunk ${i + 1} SC: ${c.sc || "(not written yet)"}${ms.length ? "\n" + ms.map((m, j) => `    ${ROMAN[j]}) ${m}`).join("\n") : ""}`;
  }).join("\n");
  return `LESSON BRIEF
Lesson type: ${p.lessonType || "—"} · Year level: ${p.year}
Lesson focus/title: ${p.title || "—"}
Learning intention: ${p.li || "—"}
Context / lens (the unit, project or angle this lesson lives inside — ground all examples and the task in this): ${p.context || "—"}
Prior knowledge (what students already know / recently learnt — the hook retrieves this): ${p.priorKnowledge || "—"}
Core success criteria, one per chunk ("I can…"):
${chunkLines}
Core+ (additional extension) SC: ${p.corePlus || "—"}`;
}

const OPT_HINT = (n, withMethod) => `Return JSON: {"options":[{"text":"…"${withMethod ? `,"method":"…"` : ""}}]} with exactly ${n} option${n > 1 ? "s" : ""}, each a genuinely different approach (not a rewording). "text" uses "- " dot points and \\n between lines.${withMethod ? ` "method" is chosen from: ${CHECK_METHODS.join(", ")} (combine with " + " only if it truly helps).` : ""}`;

async function genHook(p, n) {
  const out = parseJSON(await askClaude(`${PEDAGOGY}

${briefText(p)}

TASK: Write ${n} alternative Hooks (PK CFU / content retrieval) for the start of this lesson.
Each hook: retrieves or activates the stated prior knowledge in under ~4 minutes, uses a concrete displayable example drawn from the context/lens, surfaces the likely misconception where natural, and names how every student responds (its check method) plus how the teacher samples thinking (e.g. roam & listen then warm call).
${OPT_HINT(n, true)}`));
  return out.options.map((o) => newOpt(o.text, o.method));
}

async function genUnpack(p) {
  return parseJSON(await askClaude(`${PEDAGOGY}

${briefText(p)}

TASK: Write the Unpack / Initial Explanation for this lesson, in two parts.
"purpose": 1–2 lines the teacher says to connect today's learning to the context/lens — why it matters, in the pattern "When we ___, we will need to ___. What we are doing today will help us with this."
"concept": 1–3 terse lines naming the concept: definition + attributes + where examples live (e.g. "Definition, attributes, examples in slides."). Include a kid-friendly definition of the key term.
Return JSON: {"purpose":"…","concept":"…"}`));
}

async function genShowOne(p, ci, n) {
  const c = p.chunks[ci];
  const out = parseJSON(await askClaude(`${PEDAGOGY}

${briefText(p)}

TASK: Write ${n} alternative Show One (I Do) worked examples for Chunk ${ci + 1} only — SC: "${c.sc}".
${(c.micro || []).filter((m) => m.trim()).length ? `This chunk has microskills — the Show One must model each in order, labelled ${ROMAN.slice(0, c.micro.filter((m) => m.trim()).length).join("), ")}).` : ""}
Each option: the exact example content the teacher displays (a real sentence / number / item from the context, written out in full), the modelled steps, and one think-aloud line that makes the invisible decision visible. Keep it tight — this is one chunk of a mini lesson.
${OPT_HINT(n, false)}`));
  return out.options.map((o) => newOpt(o.text));
}

async function genTryOne(p, ci, n, methods) {
  const c = p.chunks[ci];
  const show = selText(c.showOne);
  const out = parseJSON(await askClaude(`${PEDAGOGY}

${briefText(p)}
${show ? `\nThe Show One (I Do) already planned for this chunk:\n${show}\n` : ""}
TASK: Write ${n} alternative Try One (We Do) prompts for Chunk ${ci + 1} only — SC: "${c.sc}".
Each: a fresh example mirroring the Show One (same skill, new content from the context/lens), phrased as the exact prompt/question put to students${methods && methods.length ? `, framed for this check method: ${methods.join(" + ")} (write the prompt so it genuinely fits how that method works)` : ", with the best-fitting check method chosen"}. Add one "track:" line — what the teacher looks for in responses and the key move if it's shaky (reteach, re-model, harvest an exemplar).
${OPT_HINT(n, true)}`));
  return out.options.map((o) => newOpt(o.text, methods && methods.length ? methods.join(" + ") : o.method));
}

async function genCFU1(p, n) {
  const out = parseJSON(await askClaude(`${PEDAGOGY}

${briefText(p)}

TASK: Write ${n} alternative CFU #1 hinge questions — the "ready for the task?" check after the mini lesson, before independent work.
Each: one quick, whole-class-visible item built to catch the most likely misconception, using a concrete example from the context/lens, answerable in under a minute with the named check method.
${OPT_HINT(n, true)}`));
  return out.options.map((o) => newOpt(o.text, o.method));
}

async function genTask(p, n) {
  const out = parseJSON(await askClaude(`${PEDAGOGY}

${briefText(p)}
${selText(p.hook) ? `\nPlanned hook:\n${selText(p.hook)}\n` : ""}${p.chunks.some((c) => selText(c.showOne)) ? `Planned Show Ones:\n${p.chunks.map((c, i) => selText(c.showOne) ? `Chunk ${i + 1}: ${selText(c.showOne)}` : "").filter(Boolean).join("\n")}\n` : ""}
TASK: Design ${n} alternative Purposeful Task/s for independent work time.
Each option: gives every student the chance to show ALL the Core SC (name the steps in SC order), is genuinely engaging and rooted in the context/lens (an authentic product, audience or purpose — not a worksheet for its own sake), and is structured in parts (Part One, Part Two) where a gradient from supported to independent helps. Also write "corePlus": one line describing the Core+ add-on — the extension SC applied inside the same task (not a separate activity), e.g. "Core+ …".
Return JSON: {"options":[{"text":"…","corePlus":"…"}]} with exactly ${n} options. "text" uses "- " or "Part One:"/"Part Two:" lines with \\n between lines.`));
  return out.options.map((o) => ({ ...newOpt(o.text), corePlus: o.corePlus || "" }));
}

async function genReflect(p, n) {
  const out = parseJSON(await askClaude(`${PEDAGOGY}

${briefText(p)}

TASK: Write ${n} alternative Reflective Prompts to close the task time.
Each: one metacognitive question that makes students compare, contrast or justify a decision they made against the SC (e.g. "Which noun group was hardest to change — the ones with an adjective already, or the ones without? Why?"). No new content.
${OPT_HINT(n, false)}`));
  return out.options.map((o) => newOpt(o.text));
}

async function genCFU2(p, n) {
  const out = parseJSON(await askClaude(`${PEDAGOGY}

${briefText(p)}
${selText(p.cfu1) ? `\nCFU #1 already planned (don't repeat it):\n${selText(p.cfu1)}\n` : ""}
TASK: Write ${n} alternative CFU #2 items — the end-of-lesson check that the Core SC landed (and the misconception is resolved).
Each: a single quick item with a concrete example from the context/lens, collected via the named check method (exit ticket, post-it, mini whiteboards on the floor…), producing evidence the teacher can sort into "got it / nearly / not yet" for tomorrow.
${OPT_HINT(n, true)}`));
  return out.options.map((o) => newOpt(o.text, o.method));
}

async function reframeForMethod(p, kind, text, methods) {
  const out = parseJSON(await askClaude(`${PEDAGOGY}

${briefText(p)}

TASK: Rework this ${kind} so it is checked via: ${methods.join(" + ")}.
Keep the same content, example and intent — change only how students respond and how the teacher samples/sees the responses, so it genuinely fits the method (e.g. mini whiteboards → short writable answer held up; Turn & Talk → a discussable question + warm call; gestures → an A/B or agree/disagree signal; exit ticket → done independently on paper at the end).
Current version:
${text}

Return JSON: {"text":"…"} — same dot-point style.`));
  return out.text;
}

async function genAdjustments(p, groups) {
  const rows = groups.map((g) => `- ${g.name}: ${g.needs || "no notes"}`).join("\n");
  const out = parseJSON(await askClaude(`${PEDAGOGY}

${briefText(p)}
${selText(p.task) ? `\nThe planned Purposeful Task:\n${selText(p.task)}\n` : ""}${p.taskCorePlus ? `Core+ add-on: ${p.taskCorePlus}\n` : ""}
TASK: Fill the Lesson-Specific Adjustments grid for these saved groups:
${rows}
- Extension: students working beyond Core — their adjustment is the Core+ SC add-on.

For each group return "complexity" (task-complexity ideas: which SC they focus on — Core− groups may focus on the first 1–2 — fewer/more items, altered demand; "" if the Core task already fits) and "scaffolds" ('Toolkit' scaffolds: the concrete supports to prepare for THIS task — sentence frames with the actual frame sketched, word banks naming 3–4 of the words, reference cards, syllable-marked instructions, manipulatives; "N/A" if none needed). Everything specific to this lesson's content, never generic.
Return JSON: {"rows":[{"group":"…","complexity":"…","scaffolds":"…"}]} — one row per group above IN ORDER, then one final row for Extension.`));
  return out.rows;
}

/* ---------- design tokens (Chunk & Check) ---------- */
const T = {
  bg: "#F6F8FB", card: "#FFFFFF", line: "#E6EBF2", lineSoft: "#EEF2F7",
  ink: "#0F172A", sub: "#64748B", faint: "#94A3B8",
  blue: "#2563EB", blueDeep: "#1D4ED8", blueSoft: "#EFF6FF", blueLine: "#BFDBFE",
  amber: "#B45309", amberSoft: "#FFFBEB", amberLine: "#FDE68A",
  green: "#047857", greenSoft: "#ECFDF5", greenLine: "#A7F3D0",
  red: "#B91C1C", redSoft: "#FEF2F2", redLine: "#FECACA",
  violet: "#6D28D9", violetSoft: "#F5F3FF", violetLine: "#DDD6FE",
  shadow: "0 1px 2px rgba(15,23,42,.05), 0 4px 14px rgba(15,23,42,.05)",
  shadowLift: "0 2px 4px rgba(15,23,42,.06), 0 10px 30px rgba(15,23,42,.09)",
};
const F = {
  display: "'Plus Jakarta Sans', system-ui, sans-serif",
  body: "'Inter', system-ui, sans-serif",
};
/* pastel fills for the template label column — echoes the printed doc */
const ROW_TINTS = {
  resources: "#FFFFFF", hook: "#FCE7EE", li: "#FFFFFF", sc: "#EDE9FA",
  unpack: "#E3EFFC", chunks: "#E4F5EA", cfu1: "#FDF3D7", task: "#E4F5EA",
  reflect: "#FFFFFF", cfu2: "#FDF3D7", adjust: "#EDF1F5",
};

/* ---------- UI atoms ---------- */
const Eyebrow = ({ children, style }) => (
  <div style={{ fontFamily: F.body, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: T.faint, ...style }}>{children}</div>
);
function Btn({ children, onClick, tone = "ghost", small, disabled, style, title }) {
  const tones = {
    primary: { background: T.ink, color: "#fff", border: `1px solid ${T.ink}` },
    blue: { background: T.blue, color: "#fff", border: `1px solid ${T.blue}` },
    ghost: { background: "#fff", color: T.ink, border: `1px solid ${T.line}` },
    soft: { background: T.blueSoft, color: T.blueDeep, border: `1px solid ${T.blueLine}` },
    danger: { background: "#fff", color: T.red, border: `1px solid ${T.redLine}` },
  };
  return (
    <button title={title} disabled={disabled} onClick={onClick} style={{
      fontFamily: F.body, fontWeight: 600, fontSize: small ? 11.5 : 13, cursor: disabled ? "default" : "pointer",
      opacity: disabled ? 0.45 : 1, borderRadius: 10, padding: small ? "5px 10px" : "8px 14px",
      display: "inline-flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", ...tones[tone], ...style,
    }}>{children}</button>
  );
}
function Chip({ children, on, onClick, small }) {
  return (
    <button onClick={onClick} style={{
      fontFamily: F.body, fontSize: small ? 10.5 : 11.5, fontWeight: 600, cursor: "pointer",
      borderRadius: 999, padding: small ? "3px 9px" : "4px 11px",
      background: on ? T.ink : "#fff", color: on ? "#fff" : T.sub,
      border: `1px solid ${on ? T.ink : T.line}`,
    }}>{children}</button>
  );
}
function Input({ value, onChange, placeholder, list, style }) {
  return <input list={list} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} style={{
    fontFamily: F.body, fontSize: 13, color: T.ink, background: "#fff", border: `1px solid ${T.line}`,
    borderRadius: 10, padding: "8px 11px", outline: "none", width: "100%", boxSizing: "border-box", ...style,
  }} />;
}
function TA({ value, onChange, placeholder, minRows = 2, style }) {
  const ref = useRef(null);
  const fit = () => { const el = ref.current; if (!el) return; el.style.height = "auto"; el.style.height = Math.max(el.scrollHeight, minRows * 19 + 16) + "px"; };
  useEffect(fit, [value]);
  return <textarea ref={ref} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} rows={minRows} style={{
    fontFamily: F.body, fontSize: 13, lineHeight: "19px", color: T.ink, background: "transparent",
    border: "none", outline: "none", width: "100%", resize: "none", padding: 0, boxSizing: "border-box", overflow: "hidden", ...style,
  }} />;
}
const Spin = () => (
  <span style={{ display: "inline-block", width: 12, height: 12, border: `2px solid ${T.blueLine}`, borderTopColor: T.blue, borderRadius: "50%", animation: "cpspin .7s linear infinite", verticalAlign: -2 }} />
);

/* ---------- GenField — an AI-fillable template cell ---------- */
/* field: {options:[{id,text,method}], sel} · gen(n) appends options ·
   reframe(text, methods) rewrites the selected option for a check method */
function GenField({ field, onField, gen, reframe, withMethod, placeholder, genLabel = "Draft with AI", canGen, onError }) {
  const [busy, setBusy] = useState(false);
  const [showMethods, setShowMethods] = useState(false);
  const sel = field.options.find((o) => o.id === field.sel) || null;
  const methods = sel && sel.method ? sel.method.split(" + ") : [];

  const run = async (fn) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); } catch (e) { onError(e.message || String(e)); }
    setBusy(false);
  };
  const generate = (n) => run(async () => {
    const opts = await gen(n);
    onField((f) => ({ ...f, options: [...f.options, ...opts], sel: f.sel && f.options.some((o) => o.id === f.sel && o.text.trim()) ? f.sel : opts[0]?.id ?? f.sel }));
  });
  const edit = (text) => {
    if (sel) onField((f) => ({ ...f, options: f.options.map((o) => (o.id === sel.id ? { ...o, text } : o)) }));
    else { const o = newOpt(text); onField((f) => ({ ...f, options: [...f.options, o], sel: o.id })); }
  };
  const toggleMethod = (m) => {
    if (!sel) return;
    const next = methods.includes(m) ? methods.filter((x) => x !== m) : [...methods, m];
    onField((f) => ({ ...f, options: f.options.map((o) => (o.id === sel.id ? { ...o, method: next.join(" + ") } : o)) }));
  };
  const doReframe = () => run(async () => {
    const text = await reframe(sel.text, methods);
    onField((f) => ({ ...f, options: f.options.map((o) => (o.id === sel.id ? { ...o, text } : o)) }));
  });

  return (
    <div>
      <TA value={sel ? sel.text : ""} onChange={edit} placeholder={placeholder} />
      {withMethod && sel && sel.method && !showMethods && (
        <div style={{ marginTop: 6, fontFamily: F.body, fontSize: 11.5, color: T.blueDeep, fontWeight: 600 }}>
          Check: {sel.method}
        </div>
      )}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginTop: 8 }}>
        {field.options.length > 1 && field.options.map((o, i) => (
          <Chip key={o.id} small on={o.id === field.sel} onClick={() => onField((f) => ({ ...f, sel: o.id }))}>{i + 1}</Chip>
        ))}
        <Btn small tone="soft" disabled={!canGen || busy} onClick={() => generate(field.options.filter((o) => o.text.trim()).length ? 1 : 2)}>
          {busy ? <Spin /> : "✦"} {field.options.some((o) => o.text.trim()) ? "Another option" : genLabel}
        </Btn>
        {withMethod && sel && (
          <Btn small tone="ghost" onClick={() => setShowMethods(!showMethods)}>{showMethods ? "Hide check methods" : "Check method…"}</Btn>
        )}
        {field.options.length > 1 && sel && (
          <Btn small tone="ghost" title="Remove this option" onClick={() => onField((f) => {
            const rest = f.options.filter((o) => o.id !== sel.id);
            return { ...f, options: rest, sel: rest[0]?.id ?? null };
          })}>✕</Btn>
        )}
      </div>
      {withMethod && sel && showMethods && (
        <div style={{ marginTop: 8, padding: 10, background: T.bg, borderRadius: 10, border: `1px solid ${T.lineSoft}` }}>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {CHECK_METHODS.map((m) => <Chip key={m} small on={methods.includes(m)} onClick={() => toggleMethod(m)}>{m}</Chip>)}
          </div>
          <div style={{ marginTop: 8 }}>
            <Btn small tone="blue" disabled={!canGen || busy || !methods.length || !sel.text.trim()} onClick={doReframe}>
              {busy ? <Spin /> : "↻"} Reframe for {methods.length ? methods.join(" + ") : "method"}
            </Btn>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- template sheet row ---------- */
function Row({ tint, label, subLabel, children, last }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(120px, 158px) 1fr", borderBottom: last ? "none" : `1px solid ${T.line}` }}>
      <div style={{ background: tint, borderRight: `1px solid ${T.line}`, padding: "12px 12px" }}>
        <div style={{ fontFamily: F.display, fontSize: 12.5, fontWeight: 700, color: T.ink }}>{label}</div>
        {subLabel && <div style={{ fontFamily: F.body, fontSize: 10.5, color: T.sub, marginTop: 3, fontStyle: "italic" }}>{subLabel}</div>}
      </div>
      <div style={{ padding: "12px 14px", minWidth: 0 }}>{children}</div>
    </div>
  );
}

/* ---------- brief card — what the teacher provides ---------- */
function BriefCard({ plan, up, subjects }) {
  const [open, setOpen] = useState(true);
  const lbl = { fontFamily: F.body, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: T.faint, marginBottom: 4 };
  return (
    <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 16, boxShadow: T.shadow, marginBottom: 14, overflow: "hidden" }}>
      <div onClick={() => setOpen(!open)} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", cursor: "pointer" }}>
        <Eyebrow style={{ color: T.blueDeep }}>Lesson brief — you provide this, AI plans from it</Eyebrow>
        <span style={{ color: T.faint, fontSize: 12 }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <div style={{ padding: "0 16px 16px", display: "grid", gap: 12 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
            <div>
              <div style={lbl}>Lesson type</div>
              <Input list="cp-lessontypes" value={plan.lessonType} onChange={(v) => up((p) => { p.lessonType = v; })} placeholder="Writing 1" />
              <datalist id="cp-lessontypes">{LESSON_TYPES.map((t) => <option key={t} value={t} />)}</datalist>
            </div>
            <div>
              <div style={lbl}>Year level</div>
              <Input list="cp-years" value={plan.year} onChange={(v) => up((p) => { p.year = v; })} placeholder="Year 3" />
              <datalist id="cp-years">{YEARS.map((t) => <option key={t} value={t} />)}</datalist>
            </div>
            <div>
              <div style={lbl}>Groups subject</div>
              <select value={plan.subjectId || ""} onChange={(e) => up((p) => { p.subjectId = e.target.value || null; })} style={{
                fontFamily: F.body, fontSize: 13, color: T.ink, background: "#fff", border: `1px solid ${T.line}`,
                borderRadius: 10, padding: "8px 8px", width: "100%", boxSizing: "border-box",
              }}>
                <option value="">— none —</option>
                {subjects.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>
          <div>
            <div style={lbl}>Lesson focus (the doc's title line)</div>
            <Input value={plan.title} onChange={(v) => up((p) => { p.title = v; })} placeholder="Replacing noun groups in main clauses" />
          </div>
          <div>
            <div style={lbl}>Context / lens — the unit, project or angle to explore the content through</div>
            <div style={{ border: `1px solid ${T.line}`, borderRadius: 10, padding: "8px 11px" }}>
              <TA minRows={1} value={plan.context} onChange={(v) => up((p) => { p.context = v; })} placeholder="Visit Melbourne brochures — students are collecting facts and will paraphrase them into their own brochure sentences" />
            </div>
          </div>
          <div>
            <div style={lbl}>Prior knowledge — what students already know / recently learnt (the hook retrieves this)</div>
            <div style={{ border: `1px solid ${T.line}`, borderRadius: 10, padding: "8px 11px" }}>
              <TA minRows={1} value={plan.priorKnowledge} onChange={(v) => up((p) => { p.priorKnowledge = v; })} placeholder="Nouns and adjectives from Sentence Science; last week: finding facts in brochure texts" />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- SC row — chunks + microskills + Core+ ---------- */
function SCEditor({ plan, up }) {
  const line = { display: "flex", gap: 8, alignItems: "flex-start" };
  return (
    <div style={{ display: "grid", gap: 10 }}>
      <div>
        <div style={{ fontFamily: F.body, fontSize: 12, fontWeight: 700, color: T.ink, marginBottom: 6 }}>Core — I can…</div>
        <div style={{ display: "grid", gap: 8 }}>
          {plan.chunks.map((c, i) => (
            <div key={c.id} style={{ border: `1px solid ${T.lineSoft}`, borderRadius: 10, padding: "8px 10px", background: "#FCFDFE" }}>
              <div style={line}>
                <span style={{ fontFamily: F.body, fontSize: 11, fontWeight: 700, color: T.violet, marginTop: 3, whiteSpace: "nowrap" }}>Chunk {i + 1}</span>
                <TA minRows={1} value={c.sc} onChange={(v) => up((p) => { p.chunks[i].sc = v; })} placeholder={i === 0 ? "identify noun groups (a noun by itself, or a noun with an adjective)" : "one SOLO verb per chunk…"} />
                {plan.chunks.length > 1 && (
                  <button title="Remove chunk" onClick={() => up((p) => { p.chunks.splice(i, 1); })} style={{ border: "none", background: "none", color: T.faint, cursor: "pointer", fontSize: 13, marginTop: 2 }}>✕</button>
                )}
              </div>
              {(c.micro || []).map((m, j) => (
                <div key={j} style={{ ...line, marginTop: 5, marginLeft: 54 }}>
                  <span style={{ fontFamily: F.body, fontSize: 11.5, color: T.sub, marginTop: 3 }}>{ROMAN[j]})</span>
                  <TA minRows={1} value={m} onChange={(v) => up((p) => { p.chunks[i].micro[j] = v; })} placeholder="microskill within this chunk" style={{ fontSize: 12.5 }} />
                  <button title="Remove microskill" onClick={() => up((p) => { p.chunks[i].micro.splice(j, 1); })} style={{ border: "none", background: "none", color: T.faint, cursor: "pointer", fontSize: 12, marginTop: 2 }}>✕</button>
                </div>
              ))}
              <button onClick={() => up((p) => { p.chunks[i].micro = [...(p.chunks[i].micro || []), ""]; })} style={{
                border: "none", background: "none", color: T.faint, cursor: "pointer", fontFamily: F.body, fontSize: 11, fontWeight: 600, padding: 0, marginTop: 6, marginLeft: 54,
              }}>+ microskill</button>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 8 }}>
          <Btn small tone="ghost" onClick={() => up((p) => { p.chunks.push(newChunk()); })}>+ Chunk</Btn>
        </div>
      </div>
      <div>
        <div style={{ fontFamily: F.body, fontSize: 12, fontWeight: 700, color: T.ink, marginBottom: 6 }}>Core+ (Additional Extension) — I can…</div>
        <div style={{ border: `1px solid ${T.lineSoft}`, borderRadius: 10, padding: "8px 10px", background: "#FCFDFE" }}>
          <TA minRows={1} value={plan.corePlus} onChange={(v) => up((p) => { p.corePlus = v; })} placeholder="replace both noun groups (subject and object) in a sentence — deeper SOLO verb, task add-on only" />
        </div>
      </div>
    </div>
  );
}

/* ---------- adjustments grid ---------- */
function AdjustGrid({ plan, up, groups, onGenerate, busy, canGen }) {
  const rows = [...groups.map((g) => ({ key: g.id, name: g.name, needs: g.needs })), { key: "extension", name: "Extension (Core+)", needs: "" }];
  const cell = { padding: "8px 10px", borderLeft: `1px solid ${T.lineSoft}`, minWidth: 0 };
  const get = (k) => plan.adjustments[k] || { complexity: "", scaffolds: "" };
  const set = (k, patch) => up((p) => { p.adjustments[k] = { ...get(k), ...patch }; });
  return (
    <div>
      {!groups.length && (
        <div style={{ fontFamily: F.body, fontSize: 12.5, color: T.sub, marginBottom: 8 }}>
          No saved groups for this lesson's subject yet — pick a <b>Groups subject</b> in the lesson brief, or add groups in the <b>Groups</b> tab. The Extension row is always here.
        </div>
      )}
      <div style={{ border: `1px solid ${T.lineSoft}`, borderRadius: 10, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "minmax(110px, 150px) 1fr 1fr", background: T.bg }}>
          <div style={{ ...cell, borderLeft: "none", fontFamily: F.body, fontSize: 11, fontWeight: 700, color: T.sub }}>Groups</div>
          <div style={{ ...cell, fontFamily: F.body, fontSize: 11, fontWeight: 700, color: T.sub }}>Task Complexity <span style={{ color: T.amber }}>Ideas ✦</span></div>
          <div style={{ ...cell, fontFamily: F.body, fontSize: 11, fontWeight: 700, color: T.sub }}>‘Toolkit’ Scaffolds <span style={{ color: T.amber }}>Ideas ✦</span></div>
        </div>
        {rows.map((r) => (
          <div key={r.key} style={{ display: "grid", gridTemplateColumns: "minmax(110px, 150px) 1fr 1fr", borderTop: `1px solid ${T.lineSoft}` }}>
            <div style={{ ...cell, borderLeft: "none" }}>
              <div style={{ fontFamily: F.body, fontSize: 12, fontWeight: 700, color: T.ink, fontStyle: "italic" }}>{r.name}</div>
              {r.needs && <div style={{ fontFamily: F.body, fontSize: 10.5, color: T.faint, marginTop: 3 }}>{r.needs}</div>}
            </div>
            <div style={cell}><TA minRows={1} value={get(r.key).complexity} onChange={(v) => set(r.key, { complexity: v })} placeholder="—" style={{ fontSize: 12.5 }} /></div>
            <div style={cell}><TA minRows={1} value={get(r.key).scaffolds} onChange={(v) => set(r.key, { scaffolds: v })} placeholder="—" style={{ fontSize: 12.5 }} /></div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 8 }}>
        <Btn small tone="soft" disabled={!canGen || busy} onClick={onGenerate}>{busy ? <Spin /> : "✦"} Generate ideas for all groups</Btn>
      </div>
    </div>
  );
}

/* ---------- plan editor — the sheet ---------- */
function PlanEditor({ plan, up, subjects, canGen, onBack, onPreview }) {
  const [err, setErr] = useState("");
  const [flow, setFlow] = useState("");        // co-plan-all progress label
  const [busyUnpack, setBusyUnpack] = useState(false);
  const [busyAdjust, setBusyAdjust] = useState(false);
  const subject = subjects.find((s) => s.id === plan.subjectId) || null;
  const groups = subject ? subject.groups : [];
  const onError = (m) => setErr(m);
  const briefReady = plan.li.trim() && plan.chunks.some((c) => c.sc.trim());

  /* field plumbing */
  const mkField = (get, set) => ({
    field: get(plan),
    onField: (updater) => up((p) => set(p, updater(get(p)))),
  });
  const hookF = mkField((p) => p.hook, (p, f) => { p.hook = f; });
  const cfu1F = mkField((p) => p.cfu1, (p, f) => { p.cfu1 = f; });
  const reflectF = mkField((p) => p.reflect, (p, f) => { p.reflect = f; });
  const cfu2F = mkField((p) => p.cfu2, (p, f) => { p.cfu2 = f; });
  const taskF = {
    field: plan.task,
    onField: (updater) => up((p) => {
      p.task = updater(p.task);
      const sel = p.task.options.find((o) => o.id === p.task.sel);
      if (sel && sel.corePlus && !p.taskCorePlus.trim()) p.taskCorePlus = sel.corePlus;
    }),
  };

  const runUnpack = async () => {
    if (busyUnpack) return;
    setBusyUnpack(true);
    try { const u = await genUnpack(plan); up((p) => { p.unpack = u; }); } catch (e) { onError(e.message); }
    setBusyUnpack(false);
  };
  const runAdjust = async () => {
    if (busyAdjust) return;
    setBusyAdjust(true);
    try {
      const rows = await genAdjustments(plan, groups);
      up((p) => {
        [...groups.map((g) => g.id), "extension"].forEach((key, i) => {
          const r = rows[i];
          if (r) p.adjustments[key] = { complexity: r.complexity || "", scaffolds: r.scaffolds || "" };
        });
      });
    } catch (e) { onError(e.message); }
    setBusyAdjust(false);
  };

  /* co-plan everything that's still empty, in lesson order */
  const coPlanAll = async () => {
    if (flow) return;
    setErr("");
    const cur = structuredClone(plan);
    const apply = (mut) => { mut(cur); up((p) => mut(p)); };
    const hasText = (f) => f.options.some((o) => o.text.trim());
    try {
      if (!hasText(cur.hook)) {
        setFlow("Drafting hook…");
        const opts = await genHook(cur, 2);
        apply((p) => { p.hook.options.push(...structuredClone(opts)); p.hook.sel = p.hook.options[0].id; });
      }
      if (!cur.unpack.purpose.trim() && !cur.unpack.concept.trim()) {
        setFlow("Writing unpack…");
        const u = await genUnpack(cur);
        apply((p) => { p.unpack = { ...u }; });
      }
      for (let i = 0; i < cur.chunks.length; i++) {
        if (!cur.chunks[i].sc.trim()) continue;
        if (!hasText(cur.chunks[i].showOne)) {
          setFlow(`Chunk ${i + 1}: Show One…`);
          const opts = await genShowOne(cur, i, 2);
          apply((p) => { p.chunks[i].showOne.options.push(...structuredClone(opts)); p.chunks[i].showOne.sel = p.chunks[i].showOne.options[0].id; });
        }
        if (!hasText(cur.chunks[i].tryOne)) {
          setFlow(`Chunk ${i + 1}: Try One…`);
          const opts = await genTryOne(cur, i, 2, null);
          apply((p) => { p.chunks[i].tryOne.options.push(...structuredClone(opts)); p.chunks[i].tryOne.sel = p.chunks[i].tryOne.options[0].id; });
        }
      }
      if (!hasText(cur.cfu1)) {
        setFlow("CFU #1 hinge question…");
        const opts = await genCFU1(cur, 2);
        apply((p) => { p.cfu1.options.push(...structuredClone(opts)); p.cfu1.sel = p.cfu1.options[0].id; });
      }
      if (!hasText(cur.task)) {
        setFlow("Designing purposeful task…");
        const opts = await genTask(cur, 2);
        apply((p) => {
          p.task.options.push(...structuredClone(opts));
          p.task.sel = p.task.options[0].id;
          if (!p.taskCorePlus.trim() && opts[0].corePlus) p.taskCorePlus = opts[0].corePlus;
        });
      }
      if (!hasText(cur.reflect)) {
        setFlow("Reflective prompt…");
        const opts = await genReflect(cur, 2);
        apply((p) => { p.reflect.options.push(...structuredClone(opts)); p.reflect.sel = p.reflect.options[0].id; });
      }
      if (!hasText(cur.cfu2)) {
        setFlow("CFU #2…");
        const opts = await genCFU2(cur, 2);
        apply((p) => { p.cfu2.options.push(...structuredClone(opts)); p.cfu2.sel = p.cfu2.options[0].id; });
      }
      const adjEmpty = [...groups.map((g) => g.id), "extension"].some((k) => {
        const a = cur.adjustments[k];
        return !a || (!a.complexity.trim() && !a.scaffolds.trim());
      });
      if (adjEmpty) {
        setFlow("Adjustments for groups…");
        const rows = await genAdjustments(cur, groups);
        apply((p) => {
          [...groups.map((g) => g.id), "extension"].forEach((key, i) => {
            const r = rows[i];
            const a = p.adjustments[key];
            if (r && (!a || (!a.complexity.trim() && !a.scaffolds.trim()))) p.adjustments[key] = { complexity: r.complexity || "", scaffolds: r.scaffolds || "" };
          });
        });
      }
    } catch (e) { onError(e.message || String(e)); }
    setFlow("");
  };

  const chunkNames = plan.chunks.map((c, i) => `Chunk ${i + 1}${c.sc.trim() ? " – " + c.sc.replace(/\(.*?\)/g, "").trim().split(/\s+/).slice(0, 4).join(" ") : ""}`);

  return (
    <div>
      {/* header bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <Btn tone="ghost" onClick={onBack}>‹ Plans</Btn>
        <div style={{ flex: 1, minWidth: 120 }}>
          <div style={{ fontFamily: F.display, fontSize: 17, fontWeight: 800, color: T.ink }}>
            {plan.lessonType || "Lesson"}{plan.title ? " — " + plan.title : ""}
          </div>
        </div>
        <Btn tone="blue" disabled={!canGen || !briefReady || !!flow} title={briefReady ? "Draft every empty section, in lesson order" : "Write the LI and at least one chunk SC first"} onClick={coPlanAll}>
          {flow ? <Spin /> : "✦"} {flow || "Co-plan lesson"}
        </Btn>
        <Btn tone="primary" onClick={onPreview}>Output ›</Btn>
      </div>

      {!canGen && (
        <div style={{ background: T.amberSoft, border: `1px solid ${T.amberLine}`, color: T.amber, borderRadius: 12, padding: "9px 13px", fontFamily: F.body, fontSize: 12.5, marginBottom: 12 }}>
          AI drafting is off — add your Anthropic API key in <b>Settings</b> (or run this inside claude.ai). You can still plan by hand.
        </div>
      )}
      {err && (
        <div style={{ background: T.redSoft, border: `1px solid ${T.redLine}`, color: T.red, borderRadius: 12, padding: "9px 13px", fontFamily: F.body, fontSize: 12.5, marginBottom: 12, display: "flex", justifyContent: "space-between", gap: 10 }}>
          <span>{err}</span><button onClick={() => setErr("")} style={{ border: "none", background: "none", color: T.red, cursor: "pointer", fontWeight: 700 }}>✕</button>
        </div>
      )}

      <BriefCard plan={plan} up={up} subjects={subjects} />

      {/* the sheet */}
      <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 16, boxShadow: T.shadow, overflow: "hidden" }}>
        <div style={{ textAlign: "center", padding: "12px 14px", borderBottom: `1px solid ${T.line}`, background: "#F4FAFB" }}>
          <div style={{ fontFamily: F.display, fontSize: 14.5, fontWeight: 800, color: T.ink }}>{plan.lessonType || "Lesson"}</div>
          <div style={{ fontFamily: F.body, fontSize: 12.5, fontStyle: "italic", color: T.sub, marginTop: 2 }}>{plan.title || "…"}</div>
        </div>

        <Row tint={ROW_TINTS.resources} label="Resources">
          <TA minRows={1} value={plan.resources} onChange={(v) => up((p) => { p.resources = v; })} placeholder="Slide deck / tasks / texts — links or names" />
        </Row>

        <Row tint={ROW_TINTS.hook} label="Hook/PK CFU" subLabel="Content Retrieval">
          <GenField {...hookF} withMethod canGen={canGen} onError={onError} placeholder="Retrieval of prior knowledge — ✦ drafts options from the brief"
            gen={(n) => genHook(plan, n)} reframe={(text, ms) => reframeForMethod(plan, "hook / prior-knowledge check", text, ms)} genLabel="Draft hooks" />
        </Row>

        <Row tint={ROW_TINTS.li} label="Learning Intention">
          <TA minRows={1} value={plan.li} onChange={(v) => up((p) => { p.li = v; })} placeholder="to paraphrase facts by ‘replacing’ noun groups." />
        </Row>

        <Row tint={ROW_TINTS.sc} label="Success Criteria" subLabel="SOLO verbs (1 per chunk)">
          <SCEditor plan={plan} up={up} />
        </Row>

        <Row tint={ROW_TINTS.unpack} label="Unpack / Initial Explanation">
          <div style={{ display: "grid", gap: 8 }}>
            <div>
              <span style={{ fontFamily: F.body, fontSize: 12, fontWeight: 700, color: T.ink, textDecoration: "underline" }}>Purpose:</span>
              <TA minRows={1} value={plan.unpack.purpose} onChange={(v) => up((p) => { p.unpack.purpose = v; })} placeholder="Why this matters, tied to the context — “When we write our own…, we will need to…”" />
            </div>
            <div>
              <span style={{ fontFamily: F.body, fontSize: 12, fontWeight: 700, color: T.ink, textDecoration: "underline" }}>Concept:</span>
              <TA minRows={1} value={plan.unpack.concept} onChange={(v) => up((p) => { p.unpack.concept = v; })} placeholder="Definition, attributes, examples in slides." />
            </div>
            <div><Btn small tone="soft" disabled={!canGen || busyUnpack} onClick={runUnpack}>{busyUnpack ? <Spin /> : "✦"} Draft unpack</Btn></div>
          </div>
        </Row>

        {plan.chunks.map((c, i) => (
          <Row key={c.id} tint={ROW_TINTS.chunks} label={i === 0 ? "Chunk Examples" : ""} subLabel={i === 0 ? "linked w. SOLO SC" : ""}>
            <div style={{ fontFamily: F.body, fontSize: 11.5, fontWeight: 700, color: T.green, marginBottom: 8 }}>{chunkNames[i]}</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
              <div>
                <div style={{ fontFamily: F.body, fontSize: 12, fontWeight: 700, color: T.ink, textDecoration: "underline", marginBottom: 6 }}>Show One (I Do)</div>
                <GenField {...mkField((p) => p.chunks[i].showOne, (p, f) => { p.chunks[i].showOne = f; })} canGen={canGen} onError={onError}
                  placeholder={c.sc.trim() ? "Worked example modelling this chunk" : "Write this chunk's SC first"}
                  gen={(n) => genShowOne(plan, i, n)} genLabel="Draft Show One" />
              </div>
              <div>
                <div style={{ fontFamily: F.body, fontSize: 12, fontWeight: 700, color: T.ink, textDecoration: "underline", marginBottom: 6 }}>Try One (We Do)</div>
                <GenField {...mkField((p) => p.chunks[i].tryOne, (p, f) => { p.chunks[i].tryOne = f; })} withMethod canGen={canGen} onError={onError}
                  placeholder="Matched student attempt + how you'll check it"
                  gen={(n) => genTryOne(plan, i, n, null)} reframe={(text, ms) => reframeForMethod(plan, "Try One (We Do) prompt", text, ms)} genLabel="Draft Try One" />
              </div>
            </div>
          </Row>
        ))}

        <Row tint={ROW_TINTS.cfu1} label="CFU #1" subLabel="Ready for the task?">
          <GenField {...cfu1F} withMethod canGen={canGen} onError={onError} placeholder="One hinge question before independent work — built to catch the misconception"
            gen={(n) => genCFU1(plan, n)} reframe={(text, ms) => reframeForMethod(plan, "CFU #1 hinge question", text, ms)} genLabel="Draft CFU #1" />
        </Row>

        <Row tint={ROW_TINTS.task} label="Purposeful Task/s" subLabel="linked w. SOLO SC">
          <GenField {...taskF} canGen={canGen} onError={onError} placeholder="Students showcase every Core SC, in an engaging way rooted in the context"
            gen={(n) => genTask(plan, n)} genLabel="Draft task" />
          <div style={{ marginTop: 10 }}>
            <span style={{ fontFamily: F.body, fontSize: 12, fontWeight: 700, color: T.violet }}>Core+ add-on:</span>
            <TA minRows={1} value={plan.taskCorePlus} onChange={(v) => up((p) => { p.taskCorePlus = v; })} placeholder="The extension SC applied inside the same task — never modelled in the mini lesson" />
          </div>
        </Row>

        <Row tint={ROW_TINTS.reflect} label="Reflective Prompt">
          <GenField {...reflectF} canGen={canGen} onError={onError} placeholder="A compare / contrast / justify question about the learning"
            gen={(n) => genReflect(plan, n)} genLabel="Draft prompts" />
        </Row>

        <Row tint={ROW_TINTS.cfu2} label="CFU #2">
          <GenField {...cfu2F} withMethod canGen={canGen} onError={onError} placeholder="End-of-lesson evidence the SC landed — exit ticket, post-it…"
            gen={(n) => genCFU2(plan, n)} reframe={(text, ms) => reframeForMethod(plan, "CFU #2 end-of-lesson check", text, ms)} genLabel="Draft CFU #2" />
        </Row>

        <Row tint={ROW_TINTS.adjust} label="Lesson-Specific Adjustments" last>
          <AdjustGrid plan={plan} up={up} groups={groups} onGenerate={runAdjust} busy={busyAdjust} canGen={canGen} />
        </Row>
      </div>
    </div>
  );
}

/* ---------- output — the doc-style table (preview + Google Docs copy share this) ---------- */
const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const toHTML = (s) => esc(s).replace(/\n/g, "<br>");

function buildPlanHTML(plan, subjects) {
  const subject = subjects.find((s) => s.id === plan.subjectId) || null;
  const groups = subject ? subject.groups : [];
  const BASE = "border:1px solid #9AA5B1;padding:7px 10px;font-family:Arial,sans-serif;font-size:10pt;line-height:1.35;vertical-align:top;color:#1a1a1a;";
  const lab = (tint, main, sub) =>
    `<td style="${BASE}background:${tint};width:16%;"><b>${esc(main)}</b>${sub ? `<br><span style="font-size:8.5pt;font-style:italic;color:#555;">${esc(sub)}</span>` : ""}</td>`;
  const cell = (content, span = 6, extra = "") => `<td colspan="${span}" style="${BASE}${extra}">${content}</td>`;
  const methodLine = (f) => selMethod(f) ? `<br><span style="color:#1D4ED8;"><b>Check:</b> ${esc(selMethod(f))}</span>` : "";
  const rows = [];

  rows.push(`<tr><td colspan="7" style="${BASE}background:#EAF5F7;text-align:center;"><b>${esc(plan.lessonType || "Lesson")}</b><br><i>${esc(plan.title || "")}</i></td></tr>`);
  rows.push(`<tr>${lab(ROW_TINTS.resources, "Resources")}${cell(toHTML(plan.resources) || "&nbsp;")}</tr>`);
  rows.push(`<tr>${lab(ROW_TINTS.hook, "Hook/PK CFU", "Content Retrieval")}${cell(toHTML(selText(plan.hook)) + methodLine(plan.hook) || "&nbsp;")}</tr>`);
  rows.push(`<tr>${lab(ROW_TINTS.li, "Learning Intention")}${cell(toHTML(plan.li) || "&nbsp;")}</tr>`);

  const scCore = plan.chunks.filter((c) => c.sc.trim()).map((c) => `- ${toHTML(c.sc)}`).join("<br>");
  const scHTML = `<b><u>Core</u> I can…</b><br>${scCore || "&nbsp;"}` +
    (plan.corePlus.trim() ? `<br><br><b><u>Core+ (Additional Extension)</u> I can…</b><br>- ${toHTML(plan.corePlus)}` : "");
  rows.push(`<tr>${lab(ROW_TINTS.sc, "Success Criteria", "SOLO verbs (1 per chunk)")}${cell(scHTML)}</tr>`);

  const unpackHTML = `<u><b>Purpose:</b></u><br>${toHTML(plan.unpack.purpose) || "&nbsp;"}<br><br><u><b>Concept:</b></u> ${toHTML(plan.unpack.concept)}`;
  rows.push(`<tr>${lab(ROW_TINTS.unpack, "Unpack / Initial Explanation")}${cell(unpackHTML)}</tr>`);

  const chunksWithSC = plan.chunks.map((c, i) => ({ c, i })).filter(({ c }) => c.sc.trim() || selText(c.showOne) || selText(c.tryOne));
  chunksWithSC.forEach(({ c, i }, idx) => {
    const ms = (c.micro || []).filter((m) => m.trim());
    const head = `<b>Chunk ${i + 1} – ${esc(c.sc)}</b>${ms.length ? "<br>" + ms.map((m, j) => `<i>${ROMAN[j]})</i> ${esc(m)}`).join("<br>") : ""}`;
    const showHTML = `<u><b>Show One (I Do)</b></u><br>${head}<br><br>${toHTML(selText(c.showOne)) || "&nbsp;"}`;
    const tryHTML = `<u><b>Try One (We Do)</b></u><br>${toHTML(selText(c.tryOne)) + methodLine(c.tryOne) || "&nbsp;"}`;
    rows.push(`<tr>${idx === 0 ? lab(ROW_TINTS.chunks, "Chunk Examples", "linked w. SOLO SC").replace("<td ", `<td rowspan="${chunksWithSC.length}" `) : ""}${cell(showHTML, 3)}${cell(tryHTML, 3)}</tr>`);
  });

  rows.push(`<tr>${lab(ROW_TINTS.cfu1, "CFU #1", "Ready for the task?")}${cell(toHTML(selText(plan.cfu1)) + methodLine(plan.cfu1) || "&nbsp;")}</tr>`);

  const taskHTML = (toHTML(selText(plan.task)) || "&nbsp;") + (plan.taskCorePlus.trim() ? `<br><br><b>Core+</b> ${toHTML(plan.taskCorePlus)}` : "");
  rows.push(`<tr>${lab(ROW_TINTS.task, "Purposeful Task/s", "linked w. SOLO SC")}${cell(taskHTML)}</tr>`);
  rows.push(`<tr>${lab(ROW_TINTS.reflect, "Reflective Prompt")}${cell(toHTML(selText(plan.reflect)) || "&nbsp;")}</tr>`);
  rows.push(`<tr>${lab(ROW_TINTS.cfu2, "CFU #2")}${cell(toHTML(selText(plan.cfu2)) + methodLine(plan.cfu2) || "&nbsp;")}</tr>`);

  const adjRows = [...groups.map((g) => ({ key: g.id, name: g.name })), { key: "extension", name: `${subject ? subject.name + " " : ""}‘Extension’` }];
  const HEAD = `${BASE}background:#F1F4F8;text-align:center;`;
  rows.push(`<tr>${lab(ROW_TINTS.adjust, "Lesson-Specific Adjustments").replace("<td ", `<td rowspan="${adjRows.length + 1}" `)}<td colspan="2" style="${HEAD}"><b>Groups</b></td><td colspan="2" style="${HEAD}"><b>Task Complexity</b> <i style="color:#B45309;">Ideas</i></td><td colspan="2" style="${HEAD}"><b>‘Toolkit’ Scaffolds</b> <i style="color:#B45309;">Ideas</i></td></tr>`);
  adjRows.forEach((r) => {
    const a = plan.adjustments[r.key] || { complexity: "", scaffolds: "" };
    rows.push(`<tr><td colspan="2" style="${BASE}text-align:center;"><b><i>${esc(r.name)}</i></b></td><td colspan="2" style="${BASE}">${toHTML(a.complexity) || "&nbsp;"}</td><td colspan="2" style="${BASE}">${toHTML(a.scaffolds) || "&nbsp;"}</td></tr>`);
  });

  const colW = ["16%", "14%", "14%", "14%", "14%", "14%", "14%"].map((w) => `<col style="width:${w};">`).join("");
  return `<table style="border-collapse:collapse;width:100%;max-width:760px;"><colgroup>${colW}</colgroup>${rows.join("")}</table>`;
}

async function copyHTML(html) {
  const plain = html.replace(/<br\s*\/?>/g, "\n").replace(/<\/tr>/g, "\n").replace(/<\/td>/g, "\t").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
  try {
    await navigator.clipboard.write([new ClipboardItem({
      "text/html": new Blob([html], { type: "text/html" }),
      "text/plain": new Blob([plain], { type: "text/plain" }),
    })]);
    return true;
  } catch {
    try {
      const div = document.createElement("div");
      div.contentEditable = "true";
      div.style.position = "fixed"; div.style.left = "-9999px";
      div.innerHTML = html;
      document.body.appendChild(div);
      const range = document.createRange();
      range.selectNodeContents(div);
      const sel = window.getSelection();
      sel.removeAllRanges(); sel.addRange(range);
      const ok = document.execCommand("copy");
      sel.removeAllRanges(); document.body.removeChild(div);
      return ok;
    } catch { return false; }
  }
}

function PreviewView({ plan, subjects, onBack }) {
  const [copied, setCopied] = useState("");
  const html = buildPlanHTML(plan, subjects);
  const doCopy = async () => {
    const ok = await copyHTML(html);
    setCopied(ok ? "Copied — paste straight into your Google Doc" : "Copy failed — select the table below and copy manually");
    setTimeout(() => setCopied(""), 4000);
  };
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <Btn tone="ghost" onClick={onBack}>‹ Back to planning</Btn>
        <div style={{ flex: 1 }} />
        {copied && <span style={{ fontFamily: F.body, fontSize: 12.5, color: T.green, fontWeight: 600 }}>{copied}</span>}
        <Btn tone="primary" onClick={doCopy}>⧉ Copy for Google Docs</Btn>
      </div>
      <div style={{ background: "#fff", border: `1px solid ${T.line}`, borderRadius: 16, boxShadow: T.shadow, padding: "26px 24px", overflowX: "auto" }}>
        <div dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  );
}

/* ---------- groups tab ---------- */
function GroupsTab({ subjects, setSubjects }) {
  const upSub = (id, mut) => setSubjects((ss) => ss.map((s) => { if (s.id !== id) return s; const q = structuredClone(s); mut(q); return q; }));
  return (
    <div style={{ display: "grid", gap: 14 }}>
      <div style={{ fontFamily: F.body, fontSize: 13, color: T.sub, lineHeight: 1.55 }}>
        Adjustment groups are saved <b>per subject</b> and pre-fill every lesson's Adjustments row (pick the subject in the lesson brief).
        Describe each group's needs once — the AI uses it to pitch scaffolds. No student names needed. An <b>Extension (Core+)</b> row is always added automatically.
      </div>
      {subjects.map((s) => (
        <div key={s.id} style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 16, boxShadow: T.shadow, padding: 16 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
            <Input value={s.name} onChange={(v) => upSub(s.id, (q) => { q.name = v; })} placeholder="Subject" style={{ fontWeight: 700, maxWidth: 220 }} />
            <div style={{ flex: 1 }} />
            <Btn small tone="danger" onClick={() => { if (confirm(`Delete subject “${s.name}” and its groups?`)) setSubjects((ss) => ss.filter((x) => x.id !== s.id)); }}>Delete</Btn>
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {s.groups.map((g) => (
              <div key={g.id} style={{ display: "grid", gridTemplateColumns: "minmax(140px, 220px) 1fr auto", gap: 8, alignItems: "start" }}>
                <Input value={g.name} onChange={(v) => upSub(s.id, (q) => { q.groups.find((x) => x.id === g.id).name = v; })} placeholder="Group name" />
                <div style={{ border: `1px solid ${T.line}`, borderRadius: 10, padding: "8px 11px" }}>
                  <TA minRows={1} value={g.needs} onChange={(v) => upSub(s.id, (q) => { q.groups.find((x) => x.id === g.id).needs = v; })} placeholder="What this group needs — drives the AI's scaffolds" />
                </div>
                <Btn small tone="ghost" onClick={() => upSub(s.id, (q) => { q.groups = q.groups.filter((x) => x.id !== g.id); })}>✕</Btn>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 10 }}>
            <Btn small tone="ghost" onClick={() => upSub(s.id, (q) => { q.groups.push({ id: uid(), name: "", needs: "" }); })}>+ Group</Btn>
          </div>
        </div>
      ))}
      <div><Btn tone="ghost" onClick={() => setSubjects((ss) => [...ss, { id: uid(), name: "New subject", groups: [] }])}>+ Subject</Btn></div>
    </div>
  );
}

/* ---------- settings tab ---------- */
function SettingsTab({ apiKey, setApiKey, exportAll, importAll }) {
  const fileRef = useRef(null);
  return (
    <div style={{ display: "grid", gap: 14, maxWidth: 560 }}>
      <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 16, boxShadow: T.shadow, padding: 16 }}>
        <Eyebrow>Anthropic API key</Eyebrow>
        <div style={{ fontFamily: F.body, fontSize: 12.5, color: T.sub, margin: "8px 0 10px", lineHeight: 1.5 }}>
          Needed for AI drafting when this runs outside claude.ai (e.g. the school-hosted page). The key stays in this browser only —
          use a low-spend-limit key from console.anthropic.com. Never plan with real student names.
        </div>
        <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value.trim())} placeholder="sk-ant-…" style={{
          fontFamily: F.body, fontSize: 13, color: T.ink, border: `1px solid ${T.line}`, borderRadius: 10, padding: "9px 12px", width: "100%", boxSizing: "border-box",
        }} />
        {apiKey && <div style={{ marginTop: 8, fontFamily: F.body, fontSize: 11.5, color: T.green, fontWeight: 600 }}>Key set — AI drafting active on this device</div>}
      </div>
      <div style={{ background: T.card, border: `1px solid ${T.line}`, borderRadius: 16, boxShadow: T.shadow, padding: 16 }}>
        <Eyebrow>Backup</Eyebrow>
        <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
          <Btn small tone="ghost" onClick={exportAll}>Download backup (.json)</Btn>
          <Btn small tone="ghost" onClick={() => fileRef.current?.click()}>Restore from backup…</Btn>
          <input ref={fileRef} type="file" accept=".json" style={{ display: "none" }} onChange={async (e) => {
            const f = e.target.files?.[0]; if (!f) return;
            try { importAll(JSON.parse(await f.text())); } catch { alert("Couldn't read that backup file."); }
            e.target.value = "";
          }} />
        </div>
      </div>
    </div>
  );
}

/* ---------- plans home ---------- */
function PlansHome({ plans, subjects, onOpen, onNew, onDelete, onDuplicate }) {
  const sorted = [...plans].sort((a, b) => b.updatedAt - a.updatedAt);
  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", marginBottom: 14 }}>
        <div style={{ fontFamily: F.body, fontSize: 13, color: T.sub }}>
          {plans.length ? `${plans.length} lesson plan${plans.length > 1 ? "s" : ""}` : "Start your first co-planned lesson."}
        </div>
        <div style={{ flex: 1 }} />
        <Btn tone="primary" onClick={onNew}>＋ New lesson</Btn>
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        {sorted.map((p) => {
          const done = [selText(p.hook), p.unpack.purpose, selText(p.cfu1), selText(p.task), selText(p.reflect), selText(p.cfu2), ...p.chunks.map((c) => selText(c.showOne))].filter((x) => x.trim()).length;
          const subj = subjects.find((s) => s.id === p.subjectId);
          return (
            <div key={p.id} onClick={() => onOpen(p.id)} style={{
              background: T.card, border: `1px solid ${T.line}`, borderRadius: 16, boxShadow: T.shadow, padding: "14px 16px",
              cursor: "pointer", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
            }}>
              <div style={{ flex: 1, minWidth: 180 }}>
                <div style={{ fontFamily: F.display, fontSize: 15, fontWeight: 800, color: T.ink }}>
                  {p.lessonType || "Lesson"}{p.title ? " — " + p.title : ""}
                </div>
                <div style={{ fontFamily: F.body, fontSize: 11.5, color: T.faint, marginTop: 3 }}>
                  {p.year}{subj ? ` · ${subj.name} groups` : ""} · {p.chunks.filter((c) => c.sc.trim()).length || "no"} chunk{p.chunks.filter((c) => c.sc.trim()).length === 1 ? "" : "s"} · updated {new Date(p.updatedAt).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}
                </div>
              </div>
              {done > 0 && <span style={{ fontFamily: F.body, fontSize: 11, fontWeight: 700, color: T.green, background: T.greenSoft, border: `1px solid ${T.greenLine}`, borderRadius: 999, padding: "3px 10px" }}>{done} section{done > 1 ? "s" : ""} drafted</span>}
              <Btn small tone="ghost" onClick={(e) => { e.stopPropagation(); onDuplicate(p.id); }}>Duplicate</Btn>
              <Btn small tone="danger" onClick={(e) => { e.stopPropagation(); if (confirm("Delete this lesson plan?")) onDelete(p.id); }}>Delete</Btn>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ---------- app root ---------- */
export default function App() {
  const [plans, setPlans] = useState([]);
  const [subjects, setSubjects] = useState([]);
  const [apiKey, setApiKey] = useState("");
  const [view, setView] = useState({ t: "plans" });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const raw = await store.get("cps_lesson_coplanner_v1");
        if (raw) {
          const d = JSON.parse(raw);
          if (d.plans) setPlans(d.plans);
          setSubjects(d.subjects && d.subjects.length ? d.subjects : seedSubjects());
          if (d.apiKey) setApiKey(d.apiKey);
        } else setSubjects(seedSubjects());
      } catch { setSubjects(seedSubjects()); }
      setLoaded(true);
    })();
  }, []);
  useEffect(() => {
    if (!loaded) return;
    const t = setTimeout(() => store.set("cps_lesson_coplanner_v1", JSON.stringify({ plans, subjects, apiKey })), 400);
    return () => clearTimeout(t);
  }, [plans, subjects, apiKey, loaded]);
  useEffect(() => { API_KEY = apiKey || ""; }, [apiKey]);

  /* fonts (no-op where already inlined) + spinner keyframes */
  useEffect(() => {
    if (!document.getElementById("cp-fonts")) {
      const l = document.createElement("link");
      l.id = "cp-fonts"; l.rel = "stylesheet";
      l.href = "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@600;700;800&display=swap";
      document.head.appendChild(l);
    }
    if (!document.getElementById("cp-keyframes")) {
      const s = document.createElement("style");
      s.id = "cp-keyframes";
      s.textContent = "@keyframes cpspin{to{transform:rotate(360deg)}} textarea::placeholder,input::placeholder{color:#A6B0BF}";
      document.head.appendChild(s);
    }
  }, []);

  const canGen = !!apiKey || (typeof window !== "undefined" && !!window.storage);
  const upPlan = (id) => (mut) => setPlans((ps) => ps.map((p) => {
    if (p.id !== id) return p;
    const q = structuredClone(p); mut(q); q.updatedAt = Date.now(); return q;
  }));
  const newLesson = () => { const p = newPlan(); if (subjects[0]) p.subjectId = subjects[0].id; setPlans((ps) => [...ps, p]); setView({ t: "plan", id: p.id }); };
  const duplicate = (id) => setPlans((ps) => {
    const src = ps.find((p) => p.id === id); if (!src) return ps;
    const q = structuredClone(src); q.id = uid(); q.updatedAt = Date.now(); q.title = src.title ? src.title + " (copy)" : ""; return [...ps, q];
  });
  const exportAll = () => {
    const blob = new Blob([JSON.stringify({ plans, subjects }, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `lesson-coplanner-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click(); URL.revokeObjectURL(a.href);
  };
  const importAll = (d) => {
    if (d.plans) setPlans(d.plans);
    if (d.subjects) setSubjects(d.subjects);
    alert("Backup restored.");
  };

  const openPlan = view.t === "plan" || view.t === "preview" ? plans.find((p) => p.id === view.id) : null;
  const Tab = ({ id, children }) => (
    <Chip on={view.t === id} onClick={() => setView({ t: id })}>{children}</Chip>
  );

  if (!loaded) return <div style={{ minHeight: "100vh", background: T.bg }} />;
  return (
    <div style={{ minHeight: "100vh", background: T.bg, padding: "18px 14px 60px" }}>
      <div style={{ maxWidth: 1000, margin: "0 auto" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontFamily: F.display, fontSize: 20, fontWeight: 800, color: T.ink, letterSpacing: "-0.01em" }}>Lesson Co-Planner</div>
            <div style={{ fontFamily: F.body, fontSize: 11, color: T.faint, marginTop: 1 }}>You bring the SC — AI co-plans the rest · CPS</div>
          </div>
          <div style={{ flex: 1 }} />
          {view.t !== "plan" && view.t !== "preview" && (
            <div style={{ display: "flex", gap: 6 }}>
              <Tab id="plans">Plans</Tab>
              <Tab id="groups">Groups</Tab>
              <Tab id="settings">Settings</Tab>
            </div>
          )}
        </div>

        {view.t === "plans" && <PlansHome plans={plans} subjects={subjects} onOpen={(id) => setView({ t: "plan", id })} onNew={newLesson}
          onDelete={(id) => setPlans((ps) => ps.filter((p) => p.id !== id))} onDuplicate={duplicate} />}
        {view.t === "groups" && <GroupsTab subjects={subjects} setSubjects={setSubjects} />}
        {view.t === "settings" && <SettingsTab apiKey={apiKey} setApiKey={setApiKey} exportAll={exportAll} importAll={importAll} />}
        {view.t === "plan" && openPlan && <PlanEditor plan={openPlan} up={upPlan(openPlan.id)} subjects={subjects} canGen={canGen}
          onBack={() => setView({ t: "plans" })} onPreview={() => setView({ t: "preview", id: openPlan.id })} />}
        {view.t === "preview" && openPlan && <PreviewView plan={openPlan} subjects={subjects} onBack={() => setView({ t: "plan", id: openPlan.id })} />}
        {(view.t === "plan" || view.t === "preview") && !openPlan && <PlansHome plans={plans} subjects={subjects} onOpen={(id) => setView({ t: "plan", id })} onNew={newLesson}
          onDelete={(id) => setPlans((ps) => ps.filter((p) => p.id !== id))} onDuplicate={duplicate} />}
      </div>
    </div>
  );
}
