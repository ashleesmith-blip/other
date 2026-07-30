import React, { useState, useEffect, useMemo, useRef, useCallback, createContext, useContext } from "react";

/* ============================================================
   VIT INQUIRY HUB — a platform for the graduate-registration
   inquiry project.  CPS · provisional → full VIT registration

   PLATFORM SHAPE (roles, oversight, timeline, feedback):
   · Three roles — Admin, Mentor, Graduate — with their own
     home screens. Admin sees every graduate's project and
     progress; mentors see the graduates assigned to them;
     graduates see their own workspace.
   · Mentors + admin leave feedback on any write-up section
     and any tab; graduates read and reply.
   · A shared program TIMELINE with due dates — every
     milestone shows done / due-soon / overdue per graduate.
   · Upload → auto-file: drop in a report, work sample, rubric
     or plan and Claude reads it, proposes where it belongs
     (a write-up part, an appendix + annotations, a checkpoint,
     or the evidence log) and files it on confirm.
   · Connects every piece of evidence to the AITSL / APST
     standards — all 37 Proficient descriptors, live coverage.

   The write-up itself mirrors a real completed VIT project:
   Sections 1–6, colleague observations (2bii), professional
   conversations (2biii), mentor visits (4a), PD (3c),
   reflections (3j), baseline→formative→summative data.

   ── PROTOTYPE NOTE ──────────────────────────────────────
   This is a single-browser demo. Logins are simulated and
   ALL accounts share this one browser's storage — it shows
   the full platform experience but does NOT sync across
   devices or truly separate users. A real staff rollout
   needs a school-approved, Australian-hosted backend with
   real authentication (this UI is built to drop onto one).
   Use Student A/B/C — no real student data.
   ============================================================ */

/* ---------- misc helpers ---------- */
const uid = () => Math.random().toString(36).slice(2, 9);
const todayISO = () => new Date().toISOString().slice(0, 10);
const addDays = (iso, n) => { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
const fmtDate = (iso) => {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  if (isNaN(d)) return iso;
  return d.toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" });
};
const fmtShort = (iso) => { if (!iso) return ""; const d = new Date(iso + "T00:00:00"); return isNaN(d) ? iso : d.toLocaleDateString("en-AU", { day: "numeric", month: "short" }); };
const words = (t) => ((t || "").trim() ? t.trim().split(/\s+/).length : 0);
const initials = (name) => (name || "?").trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();

/* ---------- persistence — window.storage on claude.ai, localStorage elsewhere ---------- */
const KEY = "vit-inquiry-hub-v2";
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
   Inside claude.ai the request is proxied keyless. On a real deployment
   (Netlify etc.) it goes through the /.netlify/functions/claude serverless
   proxy so the API key stays server-side and is never shipped to the browser. */
async function askClaude(messages, maxTokens = 1500) {
  const inClaudeAi = typeof window !== "undefined" && !!window.storage;
  if (!inClaudeAi) {
    const res = await fetch("/.netlify/functions/claude", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ messages, max_tokens: maxTokens }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(data.error?.message || `AI request failed (${res.status}). Is ANTHROPIC_API_KEY set in the Netlify site settings?`);
    return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
  }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: "claude-sonnet-5", max_tokens: maxTokens, messages }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message || "API error");
  return (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
}
const parseJSON = (text) => JSON.parse(text.replace(/```json|```/g, "").trim());

/* ---------- context-file extraction (txt/docx/xlsx direct · pdf/images via Claude) ---------- */
const fileToBase64 = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1]); r.onerror = () => rej(new Error("Read failed")); r.readAsDataURL(file); });
const fileToText = (file) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result || "")); r.onerror = () => rej(new Error("Read failed")); r.readAsText(file); });
async function extractSourceText(file) {
  const name = (file.name || "").toLowerCase();
  const ext = name.split(".").pop();
  if (["txt", "md", "csv", "tsv"].includes(ext) || file.type.startsWith("text/")) return await fileToText(file);
  if (ext === "docx") { const mammoth = await import("mammoth"); const buf = await file.arrayBuffer(); return (await mammoth.extractRawText({ arrayBuffer: buf })).value || ""; }
  if (["xlsx", "xls"].includes(ext)) { const XLSX = await import("xlsx"); const buf = await file.arrayBuffer(); const wb = XLSX.read(buf, { type: "array" }); return wb.SheetNames.map((sn) => `--- Sheet: ${sn} ---\n${XLSX.utils.sheet_to_csv(wb.Sheets[sn])}`).join("\n\n"); }
  if (ext === "pdf" || file.type === "application/pdf") { const b64 = await fileToBase64(file); return await askClaude([{ role: "user", content: [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }, { type: "text", text: "Extract ALL text from this document verbatim, preserving structure. Output ONLY the extracted text." }] }], 4000); }
  if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext) || file.type.startsWith("image/")) {
    const media = file.type?.startsWith("image/") ? file.type : ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" }[ext] || "image/png");
    const b64 = await fileToBase64(file);
    return await askClaude([{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: media, data: b64 } }, { type: "text", text: "Transcribe ALL text and tables visible in this image verbatim, preserving row/column structure. Output ONLY the transcription." }] }], 4000);
  }
  throw new Error(`Can't read .${ext} — use .docx, .xlsx, .pdf, an image, or paste the text.`);
}

/* ---------- design tokens (Chunk & Check family) ---------- */
const T = {
  bg: "#F6F8FB", card: "#FFFFFF", line: "#E6EBF2", lineSoft: "#EEF2F7",
  ink: "#0F172A", sub: "#64748B", faint: "#94A3B8",
  blue: "#2563EB", blueDeep: "#1D4ED8", blueSoft: "#EFF6FF", blueLine: "#BFDBFE",
  amber: "#B45309", amberSoft: "#FFFBEB", amberLine: "#FDE68A",
  green: "#047857", greenSoft: "#ECFDF5", greenLine: "#A7F3D0",
  red: "#B91C1C", redSoft: "#FEF2F2", redLine: "#FECACA",
  purple: "#7C3AED", purpleSoft: "#F5F3FF", purpleLine: "#DDD6FE",
  shadow: "0 1px 2px rgba(15,23,42,.05), 0 4px 14px rgba(15,23,42,.05)",
  shadowLift: "0 2px 4px rgba(15,23,42,.06), 0 10px 30px rgba(15,23,42,.09)",
};
const F = { display: "'Plus Jakarta Sans', system-ui, sans-serif", body: "'Inter', system-ui, sans-serif" };
const S = {
  card: { background: T.card, border: `1px solid ${T.line}`, borderRadius: 18, boxShadow: T.shadow, padding: 18 },
  eyebrow: { fontFamily: F.body, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: T.faint },
  pill: { display: "inline-flex", alignItems: "center", gap: 6, borderRadius: 999, padding: "6px 14px", background: T.card, border: `1px solid ${T.line}`, boxShadow: "0 1px 2px rgba(15,23,42,.05)", fontFamily: F.body, fontSize: 12.5, fontWeight: 600, color: T.ink, whiteSpace: "nowrap" },
  btn: { cursor: "pointer", border: "none", borderRadius: 999, padding: "9px 18px", background: T.blue, color: "#FFFFFF", fontFamily: F.body, fontSize: 13, fontWeight: 700, boxShadow: "0 1px 2px rgba(37,99,235,.35), 0 6px 16px rgba(37,99,235,.25)" },
  btnGhost: { cursor: "pointer", borderRadius: 999, padding: "8px 16px", background: T.card, color: T.ink, border: `1px solid ${T.line}`, fontFamily: F.body, fontSize: 12.5, fontWeight: 600, boxShadow: "0 1px 2px rgba(15,23,42,.05)" },
  input: { width: "100%", borderRadius: 12, border: `1px solid ${T.line}`, padding: "10px 12px", fontFamily: F.body, fontSize: 13.5, color: T.ink, background: T.card, outline: "none" },
  label: { fontFamily: F.body, fontSize: 12, fontWeight: 700, color: T.ink, marginBottom: 6, display: "block" },
};
const AREA = { ...S.input, minHeight: 110, lineHeight: 1.55, resize: "vertical" };
const TONES = {
  plain: {}, blue: { background: T.blueSoft, borderColor: T.blueLine, color: T.blueDeep },
  amber: { background: T.amberSoft, borderColor: T.amberLine, color: T.amber },
  green: { background: T.greenSoft, borderColor: T.greenLine, color: T.green },
  red: { background: T.redSoft, borderColor: T.redLine, color: T.red },
  purple: { background: T.purpleSoft, borderColor: T.purpleLine, color: T.purple },
  ink: { background: T.ink, borderColor: T.ink, color: "#FFFFFF" },
};
const Pill = ({ children, tone = "plain", style = {} }) => <span style={{ ...S.pill, ...TONES[tone], ...style }}>{children}</span>;
const ROLE_COLORS = { admin: T.purple, mentor: T.amber, graduate: T.blue };
const AVATAR_WHEEL = ["#3B82F6", "#22C55E", "#F59E0B", "#8B5CF6", "#EC4899", "#14B8A6", "#EF4444", "#0EA5E9"];
const Avatar = ({ user, size = 34 }) => {
  const bg = user?.color || ROLE_COLORS[user?.role] || T.faint;
  return <span style={{ width: size, height: size, borderRadius: 999, flex: "0 0 auto", display: "grid", placeItems: "center", background: bg, color: "#FFF", fontFamily: F.display, fontWeight: 800, fontSize: size * 0.36 }}>{initials(user?.name)}</span>;
};
const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap');
  * { box-sizing: border-box; }
  button:hover { filter: brightness(0.97); }
  button:focus-visible, select:focus-visible, input:focus-visible, textarea:focus-visible { outline: 2px solid ${T.blue}; outline-offset: 2px; }
  input::placeholder, textarea::placeholder { color: ${T.faint}; }
  fieldset { min-inline-size: 0; }
  fieldset:disabled input, fieldset:disabled textarea, fieldset:disabled select { background: ${T.lineSoft}; cursor: default; }
  fieldset:disabled button { opacity: .5; pointer-events: none; }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
  @media print { .no-print { display: none !important; } .print-doc { box-shadow: none !important; border: none !important; padding: 0 !important; } body { background: #FFF; } }
`;

/* ---------- APST — the 37 Proficient descriptors (VIT needs every one evidenced) ---------- */
const APST = [
  { n: 1, name: "Know learners and how they learn", ds: [
    ["1.1", "Use teaching strategies based on knowledge of learners’ physical, social and intellectual development and characteristics to improve their learning."],
    ["1.2", "Structure teaching programs using research and collegial advice about learning."],
    ["1.3", "Design and implement teaching strategies responsive to learning strengths of learners from diverse linguistic, cultural, religious and socioeconomic backgrounds."],
    ["1.4", "Design and implement effective teaching strategies that are responsive to the local community and cultural setting, linguistic background and histories of Aboriginal and Torres Strait Islander learners."],
    ["1.5", "Develop teaching activities that incorporate differentiated strategies to meet the specific learning needs of learners across the full range of abilities."],
    ["1.6", "Design and implement teaching activities that support the learning and participation of learners with disability and address relevant policy and legislative requirements."],
  ] },
  { n: 2, name: "Know the content and how to teach it", ds: [
    ["2.1", "Apply knowledge of content and teaching strategies of the teaching area(s) to develop engaging teaching activities."],
    ["2.2", "Organise content into coherent, well-sequenced learning and teaching programs."],
    ["2.3", "Design and implement learning and teaching programs using knowledge of curriculum, assessment and reporting requirements."],
    ["2.4", "Provide opportunities for learners to develop understanding of, and respect for, Aboriginal and Torres Strait Islander histories, cultures and languages."],
    ["2.5", "Apply knowledge and understanding of effective teaching strategies to support learners’ literacy and numeracy achievement."],
    ["2.6", "Use effective teaching strategies to integrate ICT into learning and teaching programs to make selected content relevant and meaningful."],
  ] },
  { n: 3, name: "Plan for and implement effective teaching and learning", ds: [
    ["3.1", "Set explicit, challenging and achievable learning goals for all learners."],
    ["3.2", "Plan and implement well-structured learning and teaching programs or lesson sequences that engage learners and promote learning."],
    ["3.3", "Select and use relevant teaching strategies to develop knowledge, skills, problem solving, and critical and creative thinking."],
    ["3.4", "Select and / or create and use a range of resources, including ICT, to engage learners in their learning."],
    ["3.5", "Use effective verbal and non-verbal communication strategies to support understanding, participation, engagement and achievement of learners."],
    ["3.6", "Evaluate personal teaching and learning programs using evidence, including feedback and assessment data from learners, to inform planning."],
    ["3.7", "Plan for appropriate and contextually relevant opportunities for parents / carers to be involved in their children’s learning."],
  ] },
  { n: 4, name: "Create and maintain supportive and safe learning environments", ds: [
    ["4.1", "Establish and implement inclusive and positive interactions to engage and support all learners in learning activities."],
    ["4.2", "Establish and maintain orderly and workable routines to create an environment where time is spent on learning tasks."],
    ["4.3", "Manage challenging behaviour by establishing and negotiating clear expectations with learners and address issues promptly, fairly and respectfully."],
    ["4.4", "Ensure the wellbeing and safety of learners within the learning environment by implementing curriculum and legislative requirements."],
    ["4.5", "Incorporate strategies to promote the safe, responsible and ethical use of ICT in learning and teaching."],
  ] },
  { n: 5, name: "Assess, provide feedback and report on learning", ds: [
    ["5.1", "Develop, select and use informal, formal, diagnostic, formative and summative assessment strategies to assess learning."],
    ["5.2", "Provide timely, effective and appropriate feedback to learners about their achievements relative to their learning goals."],
    ["5.3", "Understand and participate in assessment moderation activities to support consistent and comparable judgements of learning."],
    ["5.4", "Use assessment data from learners to analyse and evaluate understanding of content, identifying interventions and modifying teaching practice."],
    ["5.5", "Report clearly, accurately and respectfully to learners and parents / carers about achievement, making use of accurate and reliable records."],
  ] },
  { n: 6, name: "Engage in professional learning", ds: [
    ["6.1", "Use the Australian Professional Standards for Teachers and advice from colleagues to identify and plan for professional learning needs."],
    ["6.2", "Participate in learning to update knowledge and practice, targeted to professional needs and priorities of the education setting or system."],
    ["6.3", "Contribute to collegial discussions and apply constructive feedback from colleagues to improve knowledge and practice."],
    ["6.4", "Undertake professional learning programs designed to address identified needs of learners."],
  ] },
  { n: 7, name: "Engage professionally with colleagues, parents / carers and the community", ds: [
    ["7.1", "Meet codes of ethics and conduct established by regulatory authorities, systems and education settings."],
    ["7.2", "Understand implications of, and comply with, relevant legislative, administrative, organisational and professional requirements, policies and processes."],
    ["7.3", "Establish and maintain respectful collaborative relationships with parents / carers regarding their children’s learning and wellbeing."],
    ["7.4", "Participate in professional and community networks and forums to broaden knowledge and improve practice."],
  ] },
];
const ALL_CODES = APST.flatMap((s) => s.ds.map((d) => d[0]));
const DESC_TEXT = Object.fromEntries(APST.flatMap((s) => s.ds));

/* ---------- write-up structure — every prose part, with guidance from a finished project ---------- */
const WRITEUP = [
  { id: "s1", num: "1", title: "Content and Context for Learning", parts: [
    { id: "1a", title: "The education setting context", guide: "Describe your school: type, location, enrolment and cohort size, the community it serves, how learning is organised, school values, vision and wellbeing approach.", eg: "e.g. “…a vibrant government primary school in Melbourne’s eastern suburbs… 634 children… guided by four key values…”" },
    { id: "1b", title: "The learner cohort", guide: "Your class: size and composition, EAL backgrounds and supports, diagnoses (ASD, ADHD…) and adjustments that work, ability spread backed by data, and the social picture. De-identified.", eg: "e.g. “This Year 4 class has 24 students… ten working above level in Mathematics… timers, whiteboards and brain breaks…”" },
    { id: "1c", title: "The focus learners", guide: "Pick 3–4 focus students across levels. Add them in Learners & Data with a paragraph each; they compile into the export automatically. Use this box for any extra framing.", eg: "e.g. “Student A is a Year Four student with an autism diagnosis… benefits from sentence starters, visual guides, tasks broken into smaller steps…”" },
    { id: "1d", title: "Program of learning (brief overview)", guide: "The unit your inquiry lives inside: subject focus, frameworks (e.g. TEEL), key learning focuses as dot points, and the Victorian Curriculum content descriptors (quote the codes).", eg: "e.g. “…informative writing within Australian History… VC2E4LY10: Create narrative, informative and persuasive texts…”" },
    { id: "1e", title: "Targeted learning outcomes", guide: "What students will achieve by the end — as dot points — plus a paragraph on expected progress for the focus learners, differentiated to each one's standard.", eg: "e.g. “Write structured, coherent informative paragraphs using TEEL… differentiated based on the standard each is working at…”" },
  ] },
  { id: "s2", num: "2", title: "Inquiry Question, Professional Learning & Responsibilities", parts: [
    { id: "2a", title: "The Inquiry Question", guide: "State the question and why you chose it: the gap in student data it addresses and the part of your practice you want to build. Keep it experimental and measurable.", eg: "e.g. “Will experimenting with different elements of ‘Scaffolded Practice’ (VTLM 2.0) support student growth in Writing?”" },
    { id: "2bi", title: "Professional Learning — research notes", guide: "Notes from readings aligned to your question — name the source and author, then dot-point the ideas you'll use. Observations (2bii) and conversations (2biii) are in the Evidence Log.", eg: "e.g. “Teaching One-Pagers by Jamie Clark — scaffolding should challenge rather than simplify… Support → Adapt → Release…”" },
    { id: "2c", title: "Professional Responsibilities report", guide: "How you meet the Victorian Teaching Profession's Code of Conduct and Child Safe Standards: mandatory reporting, safe inclusive environments, professional boundaries, privacy and objectivity.", eg: "e.g. “…legal and ethical obligation to protect the safety and wellbeing of all students by following the Child Safe Standards and mandatory reporting…”" },
  ] },
  { id: "s3", num: "3", title: "Action Plan", parts: [
    { id: "3b", title: "Informing data", guide: "The data that justifies your focus: cohort results (% at/above/below), focus-student progression points, and observations from previous units. Baseline checkpoints compile in automatically.", eg: "e.g. “52% of the Year 4 cohort at standard, 19% six months below… Group writing didn’t extend students working above…”" },
    { id: "3c", title: "Professional learning plan", guide: "The PD sessions, observations and conversations you plan. Log actual PD in the Evidence Log — it compiles in. Use this for the plan and key content.", eg: "e.g. “Session 3 — Implementing Planned Scaffolds: gradual release model… Session 4 — Checking For Understanding strategies…”" },
    { id: "3d", title: "Purpose of the inquiry", guide: "One solid paragraph: what you're trying to change, what students will be able to do, and the intended outcome by the end of the action plan.", eg: "e.g. “…explore strategies within explicit teaching that build student confidence and independence in writing…”" },
    { id: "3e", title: "Inclusive practice", guide: "How the plan includes everyone: Aboriginal and Torres Strait Islander perspectives, extension, adjustments for disability (ADHD, ASD…), whole-class scaffolds that avoid singling anyone out, and EAL supports.", eg: "e.g. “Extension students… an additional fourth paragraph… Students with ASD benefit from predictable routines… EAL learners: vocabulary banks…”" },
    { id: "3f", title: "Success criteria", guide: "What success looks like by the end, as dot points — differentiated (support: points 1–4; at-level: 1–7; extension: the full checklist plus extras).", eg: "e.g. “Apply paragraph structure using TEEL… Support: points 1–4. Extension: full checklist plus a researched paragraph.”" },
    { id: "3g", title: "Strategies", guide: "How you'll teach: your instructional framework, the gradual release model, and specific scaffolds at each stage (I do / we do / you do) plus checking-for-understanding moves.", eg: "e.g. “In the ‘I do’ stage: think-alouds, anchor charts, worked exemplars… CFU ongoing and responsive…”" },
    { id: "3h", title: "Activities", guide: "The actual sequence of lessons and tasks: what the unit starts with, what students produce, how drafting/editing/publishing is structured, how mini-lessons feed independent work.", eg: "e.g. “…create four informative paragraphs about Australian History… each lesson a short mini-lesson then a related task…”" },
    { id: "3i", title: "Assessment plan", guide: "Formative checkpoints week by week and the summative pieces. Record actual checkpoints in Learners & Data — they compile into the export.", eg: "e.g. “Week 5: vocabulary banks, topic sentences on whiteboards, paragraphs 1–2 with feedback… Summative: end-of-term piece + website.”" },
    { id: "3j", title: "Reflective prompts", guide: "The questions you'll return to after lessons. Load a proven set below, then tweak. Log actual reflections in the Evidence Log.", eg: "e.g. “How did the scaffolds support student confidence and growth?… Did I notice changes in willingness to take risks?”", seedPrompts: true },
  ] },
  { id: "s5", num: "5", title: "Evaluate Effectiveness of Practice", parts: [
    { id: "5a", title: "Did assessments demonstrate progress towards learning goals?", guide: "Walk through the evidence: what work samples show against the success criteria, where growth was strong, where inconsistent, and what it means. Cite appendices.", eg: "e.g. “…clear understanding of informative paragraph structure… progress in sentence variety and editing was less consistent…”" },
    { id: "5b", title: "Did changes to my practice improve learning? How do I know?", guide: "Connect practice changes to outcomes with evidence: work samples, student quotes, per-focus-student progress. Be specific about which strategy produced which change.", eg: "e.g. “Scaffolds reduced anxiety… ‘I feel confident writing an informative text because we have had lots of practice’ (Student A).”" },
    { id: "5c", title: "What impact did my inquiry have on my teaching practice?", guide: "What changed in you: confidence, planning, responsiveness. Include the honest challenges (routines, time) and what learner feedback told you to adjust.", eg: "e.g. “…confidence to use planned and in-the-moment scaffolds… time was a difficulty, some students rushed editing…”" },
    { id: "5d", title: "How will I develop my learning further?", guide: "Concrete next steps: feedback practices, strategies to trial, knowledge to build, and how colleagues/mentors stay involved.", eg: "e.g. “…a mix of self, peer, class, and teacher feedback… continue professional learning with my team teaching partner…”" },
    { id: "5e", title: "What learning can I share with others?", guide: "The transferable insight: what you'd tell another teacher, what worked, what didn't, and anything that surprised you.", eg: "e.g. “…the value of scaffolding for anxious writers… student energy mirrored my own.”" },
  ] },
];
const ALL_PARTS = WRITEUP.flatMap((s) => s.parts);
const PART_TITLE = Object.fromEntries(ALL_PARTS.map((p) => [p.id, p.title]));

const DEFAULT_PROMPTS = [
  "How did the scaffolds I used today (templates, sentence stems, vocabulary banks, exemplars) support student confidence and growth?",
  "Did my strategies for checking for understanding give me clear insight into student progress and guide next steps?",
  "Were students able to apply the explicitly taught skill to their own work with greater independence?",
  "Did I notice changes in student confidence, engagement or willingness to take risks?",
  "What evidence of growth towards the success criteria did I see in student work?",
  "How can I refine my scaffolding or CFU strategies to better support all learners (support, at-level, extension) next lesson?",
];

/* ---------- evidence log types ---------- */
const LOG_TYPES = {
  observation: { label: "Colleague observation", section: "2bii", tone: "blue", icon: "👀", who: "Who I observed", hasReg: true, fields: [["saw", "What I saw / heard / experienced", "Dot-point everything notable: learning intentions, tune-in, I do / we do / you do, CFU strategies, transitions…"], ["general", "What I learned (general)", "Takeaways for your teaching overall."], ["inquiry", "What I learned (inquiry-question focus)", "Takeaways specifically for your inquiry question."]] },
  conversation: { label: "Professional conversation", section: "2biii", tone: "green", icon: "💬", who: "Who I talked with", hasReg: true, fields: [["discussed", "What we discussed and what I learned", "The content of the conversation and what it gave you."], ["helps", "How this helps me address my inquiry", "Connect it back to the question explicitly."]] },
  visit: { label: "Mentor visit — observation of my practice", section: "4a", tone: "amber", icon: "🧭", who: "Who observed me", hasReg: true, hasVisitNo: true, fields: [["feedback", "Summary of the feedback I received", "Strengths first, then opportunities for growth — as your observer framed them."], ["reflection", "Self-reflection notes", "What you learned and what you'll do differently next time."]] },
  pd: { label: "PD session", section: "3c", tone: "purple", icon: "🎓", who: "Facilitator / focus", hasReg: false, fields: [["notes", "Key takeaways", "The strategies and ideas you'll actually use."]] },
  reflection: { label: "Lesson reflection", section: "3j", tone: "plain", icon: "🪞", who: "Lesson / focus", hasReg: false, hasPrompt: true, fields: [["response", "Reflection", "Answer honestly — these feed your Section 5 evaluation."]] },
};
const CATEGORIES = [
  { id: "below", label: "Below", tone: "red" }, { id: "at", label: "At", tone: "blue" },
  { id: "above", label: "Above", tone: "green" }, { id: "eal", label: "EAL", tone: "purple" }, { id: "other", label: "Other", tone: "plain" },
];
const CP_TYPES = [
  { id: "baseline", label: "Baseline (pre)", tone: "amber" }, { id: "formative", label: "Formative", tone: "blue" }, { id: "summative", label: "Summative (post)", tone: "green" },
];

/* ---------- default program timeline (milestones map to requirement ids) ---------- */
const DEFAULT_MILESTONES = [
  { reqId: "question", label: "Inquiry question finalised", week: 1 },
  { reqId: "s1", label: "Section 1 — context for learning written", week: 2 },
  { reqId: "students", label: "Focus learners profiled", week: 2 },
  { reqId: "baseline", label: "Baseline (pre) data collected", week: 3 },
  { reqId: "research", label: "Research notes recorded (2bi)", week: 3 },
  { reqId: "conduct", label: "Professional responsibilities report (2c)", week: 3 },
  { reqId: "obs", label: "2+ colleague observations complete", week: 4 },
  { reqId: "s3", label: "Section 3 — action plan written", week: 4 },
  { reqId: "conv", label: "3+ professional conversations complete", week: 6 },
  { reqId: "formative", label: "Formative checkpoints under way", week: 7 },
  { reqId: "visits", label: "3 mentor visits complete", week: 9 },
  { reqId: "summative", label: "Summative (post) data collected", week: 10 },
  { reqId: "s5", label: "Section 5 — evaluation written", week: 11 },
  { reqId: "appendices", label: "Appendices annotated", week: 11 },
  { reqId: "standards", label: "All 37 APST descriptors evidenced", week: 12 },
];

/* ---------- project ---------- */
const emptyProject = (ownerId, name = "VIT Inquiry") => ({
  id: uid(), ownerId, name, school: "", yearLevel: "", question: "", createdAt: Date.now(),
  writeup: {}, students: [], checkpoints: [], logs: [], standards: {}, appendices: [], feedback: {},
});

/* ---------- derived ---------- */
const appendixCodes = (p) => { const map = {}; p.appendices.forEach((a, i) => a.annotations.forEach((an) => { if (!an.code) return; (map[an.code] = map[an.code] || []).push(i + 1); })); return map; };
const coveredCodes = (p) => { const apx = appendixCodes(p); return ALL_CODES.filter((c) => (p.standards[c]?.ref || "").trim() || apx[c]); };
const partFilled = (p, id) => { const w = p.writeup[id]; return !!(w && ((w.text || "").trim().length > 40 || w.done)); };
function requirements(p) {
  const logs = (t) => p.logs.filter((l) => l.type === t);
  const cps = (t) => p.checkpoints.filter((c) => c.type === t);
  const sectionDone = (sid) => WRITEUP.find((s) => s.id === sid).parts.every((pt) => partFilled(p, pt.id));
  const cov = coveredCodes(p).length;
  return [
    { id: "question", label: "Inquiry question finalised", done: !!p.question.trim(), tab: "overview", hint: "Set it in the header card." },
    { id: "s1", label: "Section 1 — context for learning (1a–1e)", done: sectionDone("s1"), tab: "writeup", hint: "Setting, cohort, focus learners, program, outcomes." },
    { id: "students", label: "3–4 focus learners profiled", done: p.students.filter((s) => (s.profile || "").trim()).length >= 3, tab: "students", hint: "Across below / at / above (+ EAL)." },
    { id: "research", label: "Research notes recorded (2bi)", done: partFilled(p, "2bi"), tab: "writeup", hint: "Readings aligned to your question." },
    { id: "obs", label: "2+ colleague observations (2bii)", done: logs("observation").length >= 2, tab: "log", hint: `${logs("observation").length} logged.` },
    { id: "conv", label: "3+ professional conversations (2biii)", done: logs("conversation").length >= 3, tab: "log", hint: `${logs("conversation").length} logged.` },
    { id: "conduct", label: "Professional responsibilities report (2c)", done: partFilled(p, "2c"), tab: "writeup", hint: "Code of Conduct + child safety." },
    { id: "baseline", label: "Baseline (pre) data collected", done: cps("baseline").length >= 1, tab: "students", hint: "Record a baseline checkpoint." },
    { id: "s3", label: "Section 3 — action plan (3b–3j)", done: sectionDone("s3"), tab: "writeup", hint: "Data, PL, purpose, inclusion, criteria, strategies, activities, assessment, prompts." },
    { id: "formative", label: "Formative checkpoints under way", done: cps("formative").length >= 2, tab: "students", hint: `${cps("formative").length} recorded — aim for one most weeks.` },
    { id: "visits", label: "3 mentor visits (4a)", done: logs("visit").length >= 3, tab: "log", hint: `${logs("visit").length} of 3 logged.` },
    { id: "summative", label: "Summative (post) data collected", done: cps("summative").length >= 1, tab: "students", hint: "End-of-unit assessment." },
    { id: "s5", label: "Section 5 — evaluation (5a–5e)", done: sectionDone("s5"), tab: "writeup", hint: "Written after summative data is in." },
    { id: "appendices", label: "Appendices annotated against descriptors", done: p.appendices.length >= 3 && p.appendices.every((a) => a.annotations.length > 0), tab: "appendices", hint: `${p.appendices.length} appendices.` },
    { id: "standards", label: "All 37 APST descriptors evidenced", done: cov === 37, tab: "standards", hint: `${cov} of 37 covered.` },
  ];
}
const progressOf = (p) => { const r = requirements(p); return r.filter((x) => x.done).length / r.length; };

/* milestone status for a project against the program timeline */
function milestoneStatus(project, milestones) {
  const reqs = requirements(project);
  const today = todayISO();
  return milestones.map((m) => {
    const req = reqs.find((r) => r.id === m.reqId);
    const done = !!req?.done;
    const due = m.due || "";
    let state = "pending";
    if (done) state = "done";
    else if (due && due < today) state = "overdue";
    else if (due && daysBetween(today, due) <= 7) state = "soon";
    return { ...m, done, state, label: m.label, tab: req?.tab };
  });
}

/* ---------- export compile (unchanged structure) ---------- */
function compileDoc(p) {
  const L = []; const push = (...x) => L.push(...x);
  const wp = (id) => (p.writeup[id]?.text || "").trim();
  const hr = "─".repeat(60);
  const logsOf = (t) => p.logs.filter((l) => l.type === t).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const apx = appendixCodes(p);
  push(p.question || "(Inquiry question not set)", "");
  if (p.ownerName) push(`${p.ownerName}${p.yearLevel ? " · " + p.yearLevel : ""}${p.school ? " · " + p.school : ""}`, "");
  push(hr, "EVIDENCE OF STANDARDS — CONTENTS PAGE", hr, "");
  APST.forEach((s) => { push(`Standard ${s.n}: ${s.name}`); s.ds.forEach(([code, text]) => { const refs = [(p.standards[code]?.ref || "").trim(), apx[code] ? "Appendix " + apx[code].join(", ") : ""].filter(Boolean).join(" · "); push(`  ${code}  ${text}`); push(`        → ${refs || "NOT YET EVIDENCED"}`); }); push(""); });
  WRITEUP.forEach((sec) => {
    push(hr, `SECTION ${sec.num}. ${sec.title.toUpperCase()}`, hr, "");
    sec.parts.forEach((pt) => {
      push(`${pt.id}. ${pt.title}`); const t = wp(pt.id); if (t) push(t);
      if (pt.id === "1c" && p.students.length) p.students.forEach((st) => { const cat = CATEGORIES.find((c) => c.id === st.category); push("", `${st.label}${cat ? ` (${cat.label})` : ""}:`, (st.profile || "").trim() || "(profile not written)"); });
      if (pt.id === "3b") p.checkpoints.filter((c) => c.type === "baseline").forEach((c) => { push("", `Baseline — ${c.title || "checkpoint"}${c.date ? ` (${c.date})` : ""}${c.notes ? `: ${c.notes}` : ""}`); p.students.forEach((st) => { const r = c.results?.[st.id]; if (r && (r.score || r.note)) push(`  ${st.label}: ${[r.score, r.note].filter(Boolean).join(" — ")}`); }); });
      if (pt.id === "3c") logsOf("pd").forEach((l) => push("", `PD — ${l.name || "session"}${l.date ? ` (${fmtDate(l.date)})` : ""}`, (l.notes || "").trim()));
      if (pt.id === "3i" && p.checkpoints.length) { push("", "Recorded checkpoints:"); p.checkpoints.forEach((c) => push(`  ${CP_TYPES.find((x) => x.id === c.type)?.label || c.type} — ${c.title || "checkpoint"}${c.date ? ` (${c.date})` : ""}`)); }
      push("");
    });
    if (sec.id === "s2") {
      const obs = logsOf("observation"); push("2bii. Professional Learning — Observations", "");
      obs.forEach((l, i) => { push(`Observation ${i + 1} — ${fmtDate(l.date)} — ${l.name || "colleague"}${l.regNo ? ` (VIT reg. ${l.regNo})` : ""}${l.signed ? " — signature obtained" : " — SIGNATURE NEEDED"}`); push(`What I saw/heard/experienced:`, (l.saw || "").trim(), "", `What I learned (general):`, (l.general || "").trim(), "", `What I learned (inquiry-question focus):`, (l.inquiry || "").trim(), ""); });
      if (!obs.length) push("(none logged yet)", "");
      const conv = logsOf("conversation"); push("2biii. Professional Learning — Professional Conversations", "");
      conv.forEach((l, i) => { push(`Discussion ${i + 1} — ${fmtDate(l.date)} — ${l.name || "colleague"}${l.regNo ? ` (VIT reg. ${l.regNo})` : ""}${l.signed ? " — signature obtained" : " — SIGNATURE NEEDED"}`); push(`What we discussed and what I learned:`, (l.discussed || "").trim(), "", `How this helps me address my inquiry:`, (l.helps || "").trim(), ""); });
      if (!conv.length) push("(none logged yet)", "");
    }
  });
  push(hr, "SECTION 4. IMPLEMENT YOUR ACTION PLAN", hr, "");
  const visits = logsOf("visit");
  visits.forEach((l, i) => { push(`Visit ${l.visitNo || i + 1} — ${fmtDate(l.date)} — ${l.name || "observer"}${l.regNo ? ` (VIT reg. ${l.regNo})` : ""}${l.signed ? " — signature obtained" : " — SIGNATURE NEEDED"}`); push(`Summary of the feedback I received:`, (l.feedback || "").trim(), "", `Self-reflection notes:`, (l.reflection || "").trim(), ""); });
  if (!visits.length) push("(no mentor visits logged yet)", "");
  const refl = logsOf("reflection");
  if (refl.length) { push("Lesson reflections (3j):", ""); refl.forEach((l) => push(`${fmtDate(l.date)}${l.name ? ` — ${l.name}` : ""}${l.prompt ? `\nPrompt: ${l.prompt}` : ""}`, (l.response || "").trim(), "")); }
  push(hr, "SECTION 6. ATTACHED APPENDICES AND ANNOTATIONS", hr, "");
  p.appendices.forEach((a, i) => { push(`Appendix ${i + 1}: ${a.title || "(untitled)"}`); if ((a.desc || "").trim()) push(a.desc.trim()); a.annotations.forEach((an) => { if (!an.code) return; push("", `${an.code} — ${DESC_TEXT[an.code] || ""}`); if ((an.because || "").trim()) push(`This evidence demonstrates ${an.code} because ${an.because.trim()}`); if ((an.annotation || "").trim()) push(`${an.code} Annotation: ${an.annotation.trim()}`); }); push(""); });
  if (!p.appendices.length) push("(no appendices yet)", "");
  return L.join("\n");
}

/* ============================================================
   CONTEXT — threads the current viewer, project, edit mode
   ============================================================ */
const Ctx = createContext(null);
const useApp = () => useContext(Ctx);

/* ---------- shared bits ---------- */
const Bar = ({ value, tone = T.blue, height = 8 }) => (
  <div style={{ height, borderRadius: 999, background: T.lineSoft, overflow: "hidden" }}>
    <div style={{ width: `${Math.round(Math.min(1, value) * 100)}%`, height: "100%", borderRadius: 999, background: tone, transition: "width .3s" }} />
  </div>
);
const Field = ({ label, children }) => (<div style={{ marginBottom: 12 }}><label style={S.label}>{label}</label>{children}</div>);
const SectionTitle = ({ eyebrow, title, right }) => (
  <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 12, marginBottom: 14, flexWrap: "wrap" }}>
    <div><div style={S.eyebrow}>{eyebrow}</div><div style={{ fontFamily: F.display, fontSize: 20, fontWeight: 800, color: T.ink }}>{title}</div></div>
    {right}
  </div>
);
const Empty = ({ children }) => (<div style={{ ...S.card, borderStyle: "dashed", boxShadow: "none", color: T.sub, fontFamily: F.body, fontSize: 13, textAlign: "center", padding: 26 }}>{children}</div>);
const RO = ({ children }) => { const { ro } = useApp(); return <fieldset disabled={ro} style={{ border: 0, margin: 0, padding: 0 }}>{children}</fieldset>; };

/* ---------- feedback thread — mentors/admin + graduate ---------- */
function FeedbackThread({ threadId, compact }) {
  const { project, me, postFeedback } = useApp();
  const [text, setText] = useState("");
  const thread = project.feedback?.[threadId] || [];
  const send = () => { if (!text.trim()) return; postFeedback(threadId, text.trim()); setText(""); };
  return (
    <div style={{ marginTop: compact ? 8 : 12, background: T.blueSoft, border: `1px solid ${T.blueLine}`, borderRadius: 14, padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: thread.length ? 10 : 8 }}>
        <span style={{ fontSize: 14 }}>💬</span>
        <span style={{ fontFamily: F.body, fontSize: 11.5, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: T.blueDeep }}>Mentor feedback</span>
        {thread.length > 0 && <Pill tone="blue" style={{ fontSize: 10.5, padding: "2px 8px" }}>{thread.length}</Pill>}
      </div>
      <div style={{ display: "grid", gap: 8, marginBottom: 10 }}>
        {thread.map((m) => {
          const mine = m.authorId === me.id;
          return (
            <div key={m.id} style={{ display: "flex", gap: 8, flexDirection: mine ? "row-reverse" : "row" }}>
              <span style={{ width: 26, height: 26, borderRadius: 999, flex: "0 0 auto", display: "grid", placeItems: "center", background: m.authorColor || ROLE_COLORS[m.authorRole] || T.faint, color: "#FFF", fontFamily: F.display, fontWeight: 800, fontSize: 10 }}>{initials(m.authorName)}</span>
              <div style={{ maxWidth: "80%", background: T.card, border: `1px solid ${T.line}`, borderRadius: 12, padding: "8px 11px" }}>
                <div style={{ fontFamily: F.body, fontSize: 11, color: T.sub, marginBottom: 2 }}>{m.authorName} · {m.authorRole} · {new Date(m.at).toLocaleDateString("en-AU", { day: "numeric", month: "short" })}</div>
                <div style={{ fontFamily: F.body, fontSize: 13, color: T.ink, lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{m.text}</div>
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input style={{ ...S.input, flex: 1 }} value={text} placeholder={me.role === "graduate" ? "Reply to your mentor…" : "Leave feedback…"} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} />
        <button style={S.btn} onClick={send}>Post</button>
      </div>
    </div>
  );
}
const ThreadFor = ({ threadId }) => { const { ro, project } = useApp(); const has = (project.feedback?.[threadId] || []).length > 0; return (ro || has) ? <FeedbackThread threadId={threadId} /> : null; };

/* ============================================================
   TAB: OVERVIEW
   ============================================================ */
function Overview() {
  const { project: p, update, setTab, ro, milestones, cloud } = useApp();
  const reqs = requirements(p);
  const done = reqs.filter((r) => r.done).length;
  const next = reqs.find((r) => !r.done);
  const secProgress = WRITEUP.map((s) => ({ s, v: s.parts.filter((pt) => partFilled(p, pt.id)).length / s.parts.length }));
  const ms = milestoneStatus(p, milestones);
  const overdue = ms.filter((m) => m.state === "overdue");
  const soon = ms.filter((m) => m.state === "soon");
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <RO>
        <div style={{ ...S.card, padding: 22 }}>
          <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
            <Field label="School"><input style={S.input} value={p.school} onChange={(e) => update({ school: e.target.value })} placeholder="e.g. Canterbury Primary School" /></Field>
            <Field label="Year level / class"><input style={S.input} value={p.yearLevel} onChange={(e) => update({ yearLevel: e.target.value })} placeholder="e.g. Year 4" /></Field>
          </div>
          <Field label="Inquiry question">
            <textarea style={{ ...AREA, minHeight: 56, fontFamily: F.display, fontSize: 16, fontWeight: 700 }} value={p.question} onChange={(e) => update({ question: e.target.value })} placeholder="e.g. Will experimenting with different elements of ‘Scaffolded Practice’ (VTLM 2.0) support student growth in Writing?" />
          </Field>
          <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
            <div style={{ flex: "1 1 220px" }}><Bar value={done / reqs.length} height={10} tone={done === reqs.length ? T.green : T.blue} /></div>
            <Pill tone={done === reqs.length ? "green" : "blue"}>{done} / {reqs.length} requirements met</Pill>
          </div>
        </div>
      </RO>

      {(overdue.length > 0 || soon.length > 0) && (
        <div style={{ ...S.card, background: overdue.length ? T.redSoft : T.amberSoft, borderColor: overdue.length ? T.redLine : T.amberLine, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 20 }}>{overdue.length ? "⏰" : "🗓"}</span>
          <div style={{ flex: 1, minWidth: 200, fontFamily: F.body, fontSize: 13, color: overdue.length ? T.red : T.amber }}>
            {overdue.length > 0 && <div><b>{overdue.length} milestone{overdue.length > 1 ? "s" : ""} overdue:</b> {overdue.map((m) => m.label).join("; ")}</div>}
            {soon.length > 0 && <div style={{ color: T.amber }}><b>Due within 7 days:</b> {soon.map((m) => `${m.label} (${fmtShort(m.due)})`).join("; ")}</div>}
          </div>
          <button style={S.btnGhost} onClick={() => setTab("timeline")}>View timeline</button>
        </div>
      )}

      {next && !ro && (
        <div style={{ ...S.card, background: T.blueSoft, borderColor: T.blueLine, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 20 }}>👉</span>
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontFamily: F.body, fontSize: 11, fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase", color: T.blueDeep }}>Suggested next step</div>
            <div style={{ fontFamily: F.display, fontSize: 15, fontWeight: 700, color: T.ink }}>{next.label}</div>
            <div style={{ fontFamily: F.body, fontSize: 12.5, color: T.sub }}>{next.hint}</div>
          </div>
          <button style={S.btn} onClick={() => setTab(next.tab)}>Go</button>
        </div>
      )}

      <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
        <div style={S.card}>
          <SectionTitle eyebrow="The full journey" title="VIT requirements" />
          <div style={{ display: "grid", gap: 8 }}>
            {reqs.map((r) => (
              <button key={r.id} onClick={() => setTab(r.tab)} style={{ display: "flex", alignItems: "center", gap: 10, textAlign: "left", cursor: "pointer", background: r.done ? T.greenSoft : T.card, border: `1px solid ${r.done ? T.greenLine : T.line}`, borderRadius: 12, padding: "9px 12px", fontFamily: F.body }}>
                <span style={{ width: 20, height: 20, borderRadius: 999, flex: "0 0 auto", display: "grid", placeItems: "center", background: r.done ? T.green : T.lineSoft, color: r.done ? "#FFF" : T.faint, fontSize: 12, fontWeight: 800 }}>{r.done ? "✓" : ""}</span>
                <span style={{ flex: 1 }}><span style={{ display: "block", fontSize: 13, fontWeight: 600, color: T.ink }}>{r.label}</span><span style={{ display: "block", fontSize: 11.5, color: T.sub }}>{r.hint}</span></span>
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: "grid", gap: 16, alignContent: "start" }}>
          <div style={S.card}>
            <SectionTitle eyebrow="Write-up" title="Section progress" />
            <div style={{ display: "grid", gap: 12 }}>
              {secProgress.map(({ s, v }) => (
                <div key={s.id}>
                  <div style={{ display: "flex", justifyContent: "space-between", fontFamily: F.body, fontSize: 12.5, marginBottom: 4 }}><span style={{ fontWeight: 700, color: T.ink }}>Section {s.num} · {s.title}</span><span style={{ color: T.sub }}>{Math.round(v * 100)}%</span></div>
                  <Bar value={v} tone={v === 1 ? T.green : T.blue} />
                </div>
              ))}
              <div style={{ fontFamily: F.body, fontSize: 12, color: T.sub }}>Sections 4 & 6 build themselves from the Evidence Log and Appendices tabs.</div>
            </div>
          </div>
          <div style={{ ...S.card, background: T.amberSoft, borderColor: T.amberLine }}>
            <div style={{ fontFamily: F.body, fontSize: 12.5, color: T.amber, lineHeight: 1.6 }}><b>Privacy:</b> refer to students as Student A, B, C… — never real names.{cloud ? " Your work is saved to the school's Supabase project and synced across devices." : " Prototype: single browser, no cross-device sync yet — export regularly."}</div>
          </div>
        </div>
      </div>
      <ThreadFor threadId="overview" />
    </div>
  );
}

/* ============================================================
   TAB: WRITE-UP
   ============================================================ */
function WriteUp() {
  const { project: p, update } = useApp();
  const [sel, setSel] = useState("s1");
  const sec = WRITEUP.find((s) => s.id === sel);
  const setPart = (id, patch) => update((pr) => ({ writeup: { ...pr.writeup, [id]: { text: "", done: false, ...pr.writeup[id], ...patch } } }));
  return (
    <div style={{ display: "grid", gap: 16, gridTemplateColumns: "minmax(220px, 260px) 1fr", alignItems: "start" }} className="writeup-grid">
      <div style={{ display: "grid", gap: 8, position: "sticky", top: 12 }} className="no-print">
        {WRITEUP.map((s) => {
          const doneN = s.parts.filter((pt) => partFilled(p, pt.id)).length; const active = s.id === sel;
          return (
            <button key={s.id} onClick={() => setSel(s.id)} style={{ ...S.card, padding: "12px 14px", cursor: "pointer", textAlign: "left", borderColor: active ? T.blueLine : T.line, background: active ? T.blueSoft : T.card, boxShadow: active ? T.shadowLift : T.shadow }}>
              <div style={{ fontFamily: F.body, fontSize: 10.5, fontWeight: 700, letterSpacing: ".12em", color: active ? T.blueDeep : T.faint }}>SECTION {s.num}</div>
              <div style={{ fontFamily: F.display, fontSize: 13.5, fontWeight: 700, color: T.ink, margin: "2px 0 8px" }}>{s.title}</div>
              <Bar value={doneN / s.parts.length} tone={doneN === s.parts.length ? T.green : T.blue} height={5} />
            </button>
          );
        })}
        <div style={{ fontFamily: F.body, fontSize: 11.5, color: T.sub, padding: "0 4px", lineHeight: 1.5 }}>Sections 4 & 6 compile automatically from the Evidence Log and Appendices.</div>
      </div>
      <div style={{ display: "grid", gap: 14 }}>
        {sec.parts.map((pt) => <PartEditor key={pt.id} part={pt} value={p.writeup[pt.id]} onChange={(patch) => setPart(pt.id, patch)} p={p} />)}
      </div>
    </div>
  );
}
function PartEditor({ part, value, onChange, p }) {
  const [guide, setGuide] = useState(false);
  const text = value?.text || ""; const done = !!value?.done; const wc = words(text);
  const linked = part.id === "1c" ? `${p.students.length} focus learner${p.students.length === 1 ? "" : "s"} compile in from Learners & Data`
    : part.id === "3c" ? `${p.logs.filter((l) => l.type === "pd").length} PD sessions compile in from the Evidence Log`
    : part.id === "3i" ? `${p.checkpoints.length} recorded checkpoints compile in from Learners & Data`
    : part.id === "3b" ? `${p.checkpoints.filter((c) => c.type === "baseline").length} baseline checkpoints compile in from Learners & Data` : null;
  return (
    <div style={{ ...S.card, borderColor: done ? T.greenLine : T.line }}>
      <RO>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10, flexWrap: "wrap" }}>
          <Pill tone={done ? "green" : "blue"} style={{ fontWeight: 800 }}>{part.id}</Pill>
          <div style={{ fontFamily: F.display, fontSize: 15.5, fontWeight: 800, color: T.ink, flex: 1, minWidth: 160 }}>{part.title}</div>
          <span style={{ fontFamily: F.body, fontSize: 11.5, color: T.faint }}>{wc} words</span>
          <button style={{ ...S.btnGhost, padding: "5px 12px", fontSize: 11.5 }} onClick={() => setGuide(!guide)}>{guide ? "Hide guide" : "💡 Guide"}</button>
          <button style={{ ...S.btnGhost, padding: "5px 12px", fontSize: 11.5, ...(done ? TONES.green : {}) }} onClick={() => onChange({ done: !done })}>{done ? "✓ Done" : "Mark done"}</button>
        </div>
        {guide && (<div style={{ background: T.amberSoft, border: `1px solid ${T.amberLine}`, borderRadius: 12, padding: "10px 14px", marginBottom: 10, fontFamily: F.body, fontSize: 12.5, color: T.ink, lineHeight: 1.6 }}><div style={{ marginBottom: 6 }}>{part.guide}</div><div style={{ color: T.amber, fontStyle: "italic" }}>{part.eg}</div></div>)}
        {linked && <div style={{ fontFamily: F.body, fontSize: 11.5, color: T.blueDeep, background: T.blueSoft, border: `1px solid ${T.blueLine}`, borderRadius: 10, padding: "6px 10px", marginBottom: 10, display: "inline-block" }}>🔗 {linked}</div>}
        {part.seedPrompts && !text.trim() && <button style={{ ...S.btnGhost, marginBottom: 10, fontSize: 12 }} onClick={() => onChange({ text: DEFAULT_PROMPTS.map((x) => "• " + x).join("\n") })}>✦ Load a proven prompt set</button>}
        <textarea style={AREA} value={text} placeholder={part.guide} onChange={(e) => onChange({ text: e.target.value })} />
      </RO>
      <ThreadFor threadId={`part:${part.id}`} />
    </div>
  );
}

/* ============================================================
   TAB: EVIDENCE LOG
   ============================================================ */
function EvidenceLog() {
  const { project: p, update, ro } = useApp();
  const [filter, setFilter] = useState("all"); const [openId, setOpenId] = useState(null);
  const add = (type) => {
    const entry = { id: uid(), type, date: todayISO(), name: "", regNo: "", signed: false, visitNo: type === "visit" ? String(p.logs.filter((l) => l.type === "visit").length + 1) : "", prompt: "" };
    LOG_TYPES[type].fields.forEach(([k]) => (entry[k] = ""));
    update((pr) => ({ logs: [entry, ...pr.logs] })); setOpenId(entry.id); setFilter("all");
  };
  const setLog = (id, patch) => update((pr) => ({ logs: pr.logs.map((l) => (l.id === id ? { ...l, ...patch } : l)) }));
  const del = (id) => update((pr) => ({ logs: pr.logs.filter((l) => l.id !== id) }));
  const shown = p.logs.filter((l) => filter === "all" || l.type === filter);
  const counts = Object.fromEntries(Object.keys(LOG_TYPES).map((t) => [t, p.logs.filter((l) => l.type === t).length]));
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={S.card}>
        <SectionTitle eyebrow="Capture it while it's fresh" title="Evidence Log" />
        {ro && <div style={{ fontFamily: F.body, fontSize: 12, color: T.amber, background: T.amberSoft, border: `1px solid ${T.amberLine}`, borderRadius: 10, padding: "6px 10px", marginBottom: 12 }}>Review mode — open any entry to read it. Use the feedback box below to comment; the graduate records and signs their own log entries.</div>}
        {!ro && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
            {Object.entries(LOG_TYPES).map(([t, cfg]) => <button key={t} style={{ ...S.btnGhost, fontSize: 12 }} onClick={() => add(t)}>{cfg.icon} + {cfg.label} <span style={{ color: T.faint }}>· {cfg.section}</span></button>)}
          </div>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button style={{ ...S.pill, cursor: "pointer", ...(filter === "all" ? TONES.ink : {}) }} onClick={() => setFilter("all")}>All · {p.logs.length}</button>
          {Object.entries(LOG_TYPES).map(([t, cfg]) => <button key={t} style={{ ...S.pill, cursor: "pointer", ...(filter === t ? TONES.ink : {}) }} onClick={() => setFilter(t)}>{cfg.icon} {counts[t]}</button>)}
        </div>
      </div>
      {!shown.length && <Empty>Nothing here yet. Observed a colleague, had a mentor chat, sat a PD session? Log it above — every entry lands in the right section of the export.</Empty>}
      {shown.map((l) => {
        const cfg = LOG_TYPES[l.type]; const open = openId === l.id;
        return (
          <div key={l.id} style={{ ...S.card, padding: 0, overflow: "hidden" }}>
            <button onClick={() => setOpenId(open ? null : l.id)} style={{ display: "flex", width: "100%", alignItems: "center", gap: 10, padding: "14px 18px", background: "transparent", border: "none", cursor: "pointer", textAlign: "left" }}>
              <span style={{ fontSize: 18 }}>{cfg.icon}</span>
              <span style={{ flex: 1, minWidth: 0 }}><span style={{ display: "block", fontFamily: F.display, fontSize: 14, fontWeight: 700, color: T.ink }}>{cfg.label}{l.type === "visit" && l.visitNo ? ` ${l.visitNo}` : ""}{l.name ? ` — ${l.name}` : ""}</span><span style={{ display: "block", fontFamily: F.body, fontSize: 12, color: T.sub }}>{fmtDate(l.date)} · lands in {cfg.section}</span></span>
              {cfg.hasReg && <Pill tone={l.signed ? "green" : "amber"} style={{ fontSize: 11 }}>{l.signed ? "✓ signed" : "needs signature"}</Pill>}
              <span style={{ color: T.faint }}>{open ? "▾" : "▸"}</span>
            </button>
            {open && (
              <div style={{ padding: "0 18px 18px", borderTop: `1px solid ${T.lineSoft}` }}>
                <RO>
                  <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", paddingTop: 14 }}>
                    <Field label="Date"><input type="date" style={S.input} value={l.date} onChange={(e) => setLog(l.id, { date: e.target.value })} /></Field>
                    <Field label={cfg.who}><input style={S.input} value={l.name} onChange={(e) => setLog(l.id, { name: e.target.value })} placeholder={cfg.hasReg ? "Colleague's name" : ""} /></Field>
                    {cfg.hasReg && <Field label="VIT registration no."><input style={S.input} value={l.regNo} onChange={(e) => setLog(l.id, { regNo: e.target.value })} placeholder="6 digits" /></Field>}
                    {cfg.hasVisitNo && <Field label="Visit number"><input style={S.input} value={l.visitNo} onChange={(e) => setLog(l.id, { visitNo: e.target.value })} placeholder="1, 2 or 3" /></Field>}
                  </div>
                  {cfg.hasReg && <div style={{ marginBottom: 12 }}><ToggleRow on={l.signed} onClick={() => setLog(l.id, { signed: !l.signed })}>Signature obtained on the paper / Doc copy</ToggleRow></div>}
                  {cfg.hasPrompt && <Field label="Reflective prompt"><select style={S.input} value={l.prompt} onChange={(e) => setLog(l.id, { prompt: e.target.value })}><option value="">— pick a prompt (or leave free-form) —</option>{DEFAULT_PROMPTS.map((pr) => <option key={pr} value={pr}>{pr}</option>)}</select></Field>}
                  {cfg.fields.map(([k, label, ph]) => <Field key={k} label={label}><textarea style={AREA} value={l[k] || ""} placeholder={ph} onChange={(e) => setLog(l.id, { [k]: e.target.value })} /></Field>)}
                  {!ro && <button style={{ ...S.btnGhost, color: T.red, borderColor: T.redLine }} onClick={() => del(l.id)}>Delete entry</button>}
                </RO>
              </div>
            )}
          </div>
        );
      })}
      <ThreadFor threadId="log" />
    </div>
  );
}
const ToggleRow = ({ on, onClick, children }) => (
  <button onClick={onClick} style={{ ...S.btnGhost, display: "inline-flex", alignItems: "center", gap: 8, ...(on ? TONES.green : { color: T.sub }) }}>
    <span style={{ width: 24, height: 14, borderRadius: 999, position: "relative", background: on ? T.green : "#CBD5E1", flex: "0 0 auto" }}><span style={{ position: "absolute", top: 2, left: on ? 12 : 2, width: 10, height: 10, borderRadius: 999, background: "#FFF", transition: "left .15s" }} /></span>
    {children}
  </button>
);

/* ============================================================
   TAB: LEARNERS & DATA
   ============================================================ */
function Students() {
  const { project: p, update } = useApp();
  const addStudent = () => { const label = "Student " + String.fromCharCode(65 + p.students.length); update((pr) => ({ students: [...pr.students, { id: uid(), label, category: "at", profile: "" }] })); };
  const setStudent = (id, patch) => update((pr) => ({ students: pr.students.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
  const delStudent = (id) => update((pr) => ({ students: pr.students.filter((s) => s.id !== id), checkpoints: pr.checkpoints.map((c) => { const r = { ...c.results }; delete r[id]; return { ...c, results: r }; }) }));
  const addCp = (type) => update((pr) => ({ checkpoints: [...pr.checkpoints, { id: uid(), type, date: todayISO(), title: "", notes: "", results: {} }] }));
  const setCp = (id, patch) => update((pr) => ({ checkpoints: pr.checkpoints.map((c) => (c.id === id ? { ...c, ...patch } : c)) }));
  const setResult = (cid, sid, patch) => update((pr) => ({ checkpoints: pr.checkpoints.map((c) => c.id === cid ? { ...c, results: { ...c.results, [sid]: { score: "", note: "", ...c.results[sid], ...patch } } } : c) }));
  const delCp = (id) => update((pr) => ({ checkpoints: pr.checkpoints.filter((c) => c.id !== id) }));
  const sorted = [...p.checkpoints].sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const growth = (sid) => { const of = (t) => sorted.filter((c) => c.type === t && c.results?.[sid]?.score); return [of("baseline")[0]?.results[sid]?.score, of("formative").slice(-1)[0]?.results[sid]?.score, of("summative").slice(-1)[0]?.results[sid]?.score]; };
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <RO>
      <div style={S.card}>
        <SectionTitle eyebrow="Section 1c — de-identified, always" title="Focus learners" right={<button style={S.btn} onClick={addStudent}>+ Add focus learner</button>} />
        {!p.students.length && <Empty>Add 3–4 focus students across levels. Use Student A/B/C, never real names.</Empty>}
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
          {p.students.map((s) => {
            const cat = CATEGORIES.find((c) => c.id === s.category);
            return (
              <div key={s.id} style={{ border: `1px solid ${T.line}`, borderRadius: 14, padding: 14 }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
                  <input style={{ ...S.input, width: 110, fontWeight: 700 }} value={s.label} onChange={(e) => setStudent(s.id, { label: e.target.value })} />
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>{CATEGORIES.map((c) => <button key={c.id} onClick={() => setStudent(s.id, { category: c.id })} style={{ ...S.pill, cursor: "pointer", padding: "4px 10px", fontSize: 11, ...(s.category === c.id ? TONES.ink : {}) }}>{c.label}</button>)}</div>
                </div>
                <textarea style={{ ...AREA, minHeight: 120 }} value={s.profile} placeholder={`One paragraph: current level, needs and diagnoses, the scaffolds that work, social/confidence notes.${cat ? ` (${cat.label} level)` : ""}`} onChange={(e) => setStudent(s.id, { profile: e.target.value })} />
                <button style={{ ...S.btnGhost, marginTop: 8, fontSize: 11.5, color: T.red, borderColor: T.redLine }} onClick={() => delStudent(s.id)}>Remove</button>
              </div>
            );
          })}
        </div>
      </div>
      <div style={S.card}>
        <SectionTitle eyebrow="Sections 3b & 3i — baseline → formative → summative" title="Assessment checkpoints" right={<div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{CP_TYPES.map((t) => <button key={t.id} style={{ ...S.btnGhost, fontSize: 12 }} onClick={() => addCp(t.id)}>+ {t.label}</button>)}</div>} />
        {!sorted.length && <Empty>Start with a <b>baseline</b> checkpoint (your pre-data), add a <b>formative</b> one most weeks, and finish with a <b>summative</b>. Score can be a progression point (3.5), a rubric level, or a short judgement.</Empty>}
        <div style={{ display: "grid", gap: 12 }}>
          {sorted.map((c) => {
            const t = CP_TYPES.find((x) => x.id === c.type);
            return (
              <div key={c.id} style={{ border: `1px solid ${T.line}`, borderRadius: 14, padding: 14 }}>
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
                  <Pill tone={t.tone}>{t.label}</Pill>
                  <input type="date" style={{ ...S.input, width: 150 }} value={c.date} onChange={(e) => setCp(c.id, { date: e.target.value })} />
                  <input style={{ ...S.input, flex: 1, minWidth: 180 }} value={c.title} placeholder="What was assessed — e.g. Topic sentences on mini whiteboards (Week 5)" onChange={(e) => setCp(c.id, { title: e.target.value })} />
                  <button style={{ ...S.btnGhost, fontSize: 11.5, color: T.red, borderColor: T.redLine }} onClick={() => delCp(c.id)}>Delete</button>
                </div>
                {p.students.length ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    {p.students.map((s) => { const r = c.results?.[s.id] || {}; return (
                      <div key={s.id} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        <span style={{ fontFamily: F.body, fontSize: 12.5, fontWeight: 700, color: T.ink, width: 90 }}>{s.label}</span>
                        <input style={{ ...S.input, width: 110 }} value={r.score || ""} placeholder="Score / level" onChange={(e) => setResult(c.id, s.id, { score: e.target.value })} />
                        <input style={{ ...S.input, flex: 1, minWidth: 160 }} value={r.note || ""} placeholder="Observation note" onChange={(e) => setResult(c.id, s.id, { note: e.target.value })} />
                      </div>
                    ); })}
                  </div>
                ) : <div style={{ fontFamily: F.body, fontSize: 12.5, color: T.sub }}>Add focus learners above to record per-student results.</div>}
                <div style={{ marginTop: 8 }}><input style={S.input} value={c.notes} placeholder="Whole-class note (optional) — cohort trend, what this told you" onChange={(e) => setCp(c.id, { notes: e.target.value })} /></div>
              </div>
            );
          })}
        </div>
      </div>
      {p.students.length > 0 && sorted.length > 0 && (
        <div style={S.card}>
          <SectionTitle eyebrow="At a glance" title="Growth summary" />
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", fontFamily: F.body, fontSize: 13 }}>
              <thead><tr>{["Learner", "Baseline", "Latest formative", "Summative"].map((h) => <th key={h} style={{ textAlign: "left", padding: "8px 12px", borderBottom: `2px solid ${T.line}`, color: T.sub, fontSize: 11.5, textTransform: "uppercase", letterSpacing: ".08em" }}>{h}</th>)}</tr></thead>
              <tbody>{p.students.map((s) => { const [b, f, m] = growth(s.id); const cat = CATEGORIES.find((c) => c.id === s.category); return (
                <tr key={s.id}><td style={{ padding: "8px 12px", borderBottom: `1px solid ${T.lineSoft}`, fontWeight: 700 }}>{s.label} <span style={{ color: T.faint, fontWeight: 500 }}>· {cat?.label}</span></td>{[b, f, m].map((v, i) => <td key={i} style={{ padding: "8px 12px", borderBottom: `1px solid ${T.lineSoft}`, color: v ? T.ink : T.faint }}>{v || "—"}</td>)}</tr>
              ); })}</tbody>
            </table>
          </div>
        </div>
      )}
      </RO>
      <ThreadFor threadId="students" />
    </div>
  );
}

/* ============================================================
   TAB: STANDARDS
   ============================================================ */
function Standards() {
  const { project: p, update } = useApp();
  const apx = appendixCodes(p); const covered = coveredCodes(p);
  const setRef = (code, ref) => update((pr) => ({ standards: { ...pr.standards, [code]: { ...pr.standards[code], ref } } }));
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <RO>
      <div style={S.card}>
        <SectionTitle eyebrow="AITSL / APST — the evidence contents page" title="Descriptor coverage" right={<Pill tone={covered.length === 37 ? "green" : covered.length > 20 ? "blue" : "amber"}>{covered.length} / 37 evidenced</Pill>} />
        <Bar value={covered.length / 37} tone={covered.length === 37 ? T.green : T.blue} height={10} />
        <div style={{ fontFamily: F.body, fontSize: 12.5, color: T.sub, marginTop: 10, lineHeight: 1.6 }}>VIT needs <b>every one of the 37 Proficient descriptors</b> evidenced somewhere. Type where each is referenced (e.g. “Write-Up Annotations: Stage 1a–c”). Descriptors annotated in the Appendices tab tick themselves automatically.</div>
      </div>
      {APST.map((s) => {
        const doneN = s.ds.filter(([c]) => covered.includes(c)).length;
        return (
          <div key={s.n} style={S.card}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
              <Pill tone={doneN === s.ds.length ? "green" : "blue"} style={{ fontWeight: 800 }}>Standard {s.n}</Pill>
              <div style={{ fontFamily: F.display, fontSize: 15, fontWeight: 800, color: T.ink, flex: 1, minWidth: 200 }}>{s.name}</div>
              <span style={{ fontFamily: F.body, fontSize: 12, color: T.sub }}>{doneN}/{s.ds.length}</span>
            </div>
            <div style={{ display: "grid", gap: 10 }}>
              {s.ds.map(([code, text]) => {
                const isCov = covered.includes(code);
                return (
                  <div key={code} style={{ display: "grid", gap: 6, border: `1px solid ${isCov ? T.greenLine : T.line}`, background: isCov ? T.greenSoft : T.card, borderRadius: 12, padding: "10px 12px" }}>
                    <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}><span style={{ fontFamily: F.body, fontWeight: 800, fontSize: 12.5, color: isCov ? T.green : T.ink }}>{code}</span><span style={{ fontFamily: F.body, fontSize: 12.5, color: T.ink, lineHeight: 1.5 }}>{text}</span></div>
                    <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                      <input style={{ ...S.input, flex: 1, minWidth: 200, padding: "7px 10px", fontSize: 12.5 }} value={p.standards[code]?.ref || ""} placeholder="Referenced in… e.g. Write-Up Annotations: Stage 3" onChange={(e) => setRef(code, e.target.value)} />
                      {apx[code] && <Pill tone="green" style={{ fontSize: 11 }}>Appendix {apx[code].join(", ")}</Pill>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      </RO>
      <ThreadFor threadId="standards" />
    </div>
  );
}

/* ============================================================
   TAB: APPENDICES
   ============================================================ */
function Appendices() {
  const { project: p, update } = useApp();
  const add = () => update((pr) => ({ appendices: [...pr.appendices, { id: uid(), title: "", desc: "", annotations: [] }] }));
  const setA = (id, patch) => update((pr) => ({ appendices: pr.appendices.map((a) => (a.id === id ? { ...a, ...patch } : a)) }));
  const del = (id) => update((pr) => ({ appendices: pr.appendices.filter((a) => a.id !== id) }));
  const setAnList = (aid, fn) => update((pr) => ({ appendices: pr.appendices.map((a) => (a.id === aid ? { ...a, annotations: fn(a.annotations) } : a)) }));
  const addAn = (aid) => setAnList(aid, (list) => [...list, { id: uid(), code: "", because: "", annotation: "" }]);
  const suggestions = ["Baseline student data (pre-data)", "Assessment rubrics / annotated achievement standards", "Lesson plans / annotated teaching sequences", "Student work samples with feedback", "Post-data and growth evidence", "Reports to parents / carers", "Professional learning certificates & notes", "Aboriginal and Torres Strait Islander perspectives evidence", "Differentiated planning documents", "Moderation records", "Literacy / numeracy strategy evidence", "ICT integration evidence", "Parent / carer communication", "Professional networks & forums"];
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <RO>
      <div style={S.card}>
        <SectionTitle eyebrow="Section 6 — evidence + annotations" title="Appendices" right={<button style={S.btn} onClick={add}>+ Add appendix</button>} />
        <div style={{ fontFamily: F.body, fontSize: 12.5, color: T.sub, lineHeight: 1.6 }}>Each appendix is an evidence item annotated against descriptors: <i>“This evidence demonstrates <b>X</b> because…”</i> plus a first-person annotation. Annotated descriptors count as covered on the Standards tab. Use <b>Import</b> to auto-draft an appendix from an uploaded file.</div>
      </div>
      {!p.appendices.length && <Empty>No appendices yet. Start with your baseline data, rubrics and lesson plans — then keep adding as evidence accumulates.</Empty>}
      {p.appendices.map((a, i) => (
        <div key={a.id} style={S.card}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
            <Pill tone="purple" style={{ fontWeight: 800 }}>Appendix {i + 1}</Pill>
            <input style={{ ...S.input, flex: 1, minWidth: 200, fontWeight: 700 }} value={a.title} placeholder="Title — e.g. Baseline student data (pre-data)" list={`apx-${a.id}`} onChange={(e) => setA(a.id, { title: e.target.value })} />
            <datalist id={`apx-${a.id}`}>{suggestions.map((s) => <option key={s} value={s} />)}</datalist>
            <button style={{ ...S.btnGhost, fontSize: 11.5, color: T.red, borderColor: T.redLine }} onClick={() => del(a.id)}>Delete</button>
          </div>
          <textarea style={{ ...AREA, minHeight: 60 }} value={a.desc} placeholder="What this evidence is and where the artefact lives (e.g. 'Pre-assessment writing samples for Students A–D, saved in the VIT Drive folder')." onChange={(e) => setA(a.id, { desc: e.target.value })} />
          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            {a.annotations.map((an) => (
              <div key={an.id} style={{ border: `1px solid ${T.lineSoft}`, borderRadius: 12, padding: 12, background: T.bg }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }}>
                  <select style={{ ...S.input, width: 340, maxWidth: "100%" }} value={an.code} onChange={(e) => setAnList(a.id, (list) => list.map((x) => (x.id === an.id ? { ...x, code: e.target.value } : x)))}>
                    <option value="">— pick a descriptor —</option>
                    {APST.map((s) => <optgroup key={s.n} label={`Standard ${s.n}: ${s.name}`}>{s.ds.map(([c, txt]) => <option key={c} value={c}>{c} — {txt.slice(0, 70)}…</option>)}</optgroup>)}
                  </select>
                  <button style={{ ...S.btnGhost, fontSize: 11.5, color: T.red, borderColor: T.redLine }} onClick={() => setAnList(a.id, (list) => list.filter((x) => x.id !== an.id))}>Remove</button>
                </div>
                {an.code && <div style={{ fontFamily: F.body, fontSize: 11.5, color: T.sub, marginBottom: 8, lineHeight: 1.5 }}>{DESC_TEXT[an.code]}</div>}
                <Field label={`This evidence demonstrates ${an.code || "the descriptor"} because…`}><input style={S.input} value={an.because} placeholder="…I assessed baseline writing samples against curriculum standards." onChange={(e) => setAnList(a.id, (list) => list.map((x) => (x.id === an.id ? { ...x, because: e.target.value } : x)))} /></Field>
                <Field label="Annotation (first person — what you did)"><textarea style={{ ...AREA, minHeight: 56 }} value={an.annotation} placeholder="I collected and assessed baseline writing data against the achievement standards to identify starting points…" onChange={(e) => setAnList(a.id, (list) => list.map((x) => (x.id === an.id ? { ...x, annotation: e.target.value } : x)))} /></Field>
              </div>
            ))}
            <button style={{ ...S.btnGhost, fontSize: 12, justifySelf: "start" }} onClick={() => addAn(a.id)}>+ Annotate a descriptor</button>
          </div>
        </div>
      ))}
      </RO>
      <ThreadFor threadId="appendices" />
    </div>
  );
}

/* ============================================================
   TAB: IMPORT — upload → Claude classifies → auto-file
   ============================================================ */
const IMPORT_TARGETS = [
  ...ALL_PARTS.map((p) => ({ value: `part:${p.id}`, label: `Write-up ${p.id} — ${p.title}` })),
  { value: "appendix", label: "New appendix (with descriptor annotations)" },
  { value: "checkpoint", label: "Assessment checkpoint (student data)" },
  { value: "log:observation", label: "Evidence log — colleague observation" },
  { value: "log:conversation", label: "Evidence log — professional conversation" },
  { value: "log:pd", label: "Evidence log — PD session" },
];
function ImportTab() {
  const { project: p, update, setTab } = useApp();
  const [text, setText] = useState(""); const [busy, setBusy] = useState(false); const [err, setErr] = useState("");
  const [result, setResult] = useState(null); const [target, setTarget] = useState(""); const fileRef = useRef(null);

  const onFile = async (e) => {
    const file = e.target.files?.[0]; if (!file) return; setErr(""); setBusy(true);
    try { const t = await extractSourceText(file); setText(t); }
    catch (ex) { setErr(ex.message || "Couldn't read that file."); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  };
  const classify = async () => {
    if (!text.trim()) { setErr("Paste or upload something first."); return; }
    setErr(""); setBusy(true); setResult(null);
    try {
      const codes = ALL_CODES.join(", ");
      const parts = ALL_PARTS.map((p) => `${p.id}=${p.title}`).join("; ");
      const out = await askClaude([{ role: "user", content: [{ type: "text", text:
`You help a graduate teacher file evidence into their VIT inquiry write-up. Read the SOURCE and return STRICT JSON only (no prose, no code fences).

Choose ONE best "kind":
- "writeup": prose belonging to a write-up part. Provide "part" (one of: ${parts}) and "draft" (a cleaned, first-person paragraph ready to paste).
- "appendix": an evidence artefact (data, rubric, lesson plan, work sample). Provide "title", "desc", and "annotations": array of {code, because, annotation} using APST codes from: ${codes}.
- "checkpoint": student assessment results. Provide "cpType" ("baseline"|"formative"|"summative"), "title", and "results": array of {student, score, note}.
- "log": a colleague observation, professional conversation or PD session. Provide "logType" ("observation"|"conversation"|"pd"), "name", and "notes".

Always include a short "summary" saying where this will be filed and why.
SOURCE:
${text.slice(0, 12000)}` }] }], 1600);
      let parsed; try { parsed = parseJSON(out); } catch { parsed = { kind: "writeup", part: "1a", draft: text.trim(), summary: "Couldn't auto-classify — filed as raw text; pick a destination below." }; }
      setResult(parsed);
      setTarget(parsed.kind === "writeup" ? `part:${parsed.part}` : parsed.kind === "appendix" ? "appendix" : parsed.kind === "checkpoint" ? "checkpoint" : `log:${parsed.logType || "observation"}`);
    } catch (ex) { setErr(ex.message || "Classification failed. You can still file it manually below."); setResult({ kind: "writeup", draft: text.trim(), summary: "Manual filing." }); setTarget("part:1a"); }
    finally { setBusy(false); }
  };
  const apply = () => {
    const r = result || {};
    if (target.startsWith("part:")) {
      const id = target.slice(5); const draft = r.draft || text.trim();
      update((pr) => { const prev = pr.writeup[id]?.text || ""; return { writeup: { ...pr.writeup, [id]: { text: prev ? prev + "\n\n" + draft : draft, done: pr.writeup[id]?.done || false } } }; });
      setTab("writeup");
    } else if (target === "appendix") {
      const anns = (r.annotations || []).filter((a) => ALL_CODES.includes(a.code)).map((a) => ({ id: uid(), code: a.code, because: a.because || "", annotation: a.annotation || "" }));
      update((pr) => ({ appendices: [...pr.appendices, { id: uid(), title: r.title || "Imported evidence", desc: r.desc || text.slice(0, 400), annotations: anns }] }));
      setTab("appendices");
    } else if (target === "checkpoint") {
      const results = {}; const byLabel = Object.fromEntries(p.students.map((s) => [s.label.toLowerCase(), s.id]));
      (r.results || []).forEach((row) => { const sid = byLabel[(row.student || "").toLowerCase()]; if (sid) results[sid] = { score: String(row.score ?? ""), note: row.note || "" }; });
      update((pr) => ({ checkpoints: [...pr.checkpoints, { id: uid(), type: r.cpType || "formative", date: todayISO(), title: r.title || "Imported checkpoint", notes: "", results }] }));
      setTab("students");
    } else if (target.startsWith("log:")) {
      const lt = target.slice(4); const entry = { id: uid(), type: lt, date: todayISO(), name: r.name || "", regNo: "", signed: false, visitNo: "", prompt: "" };
      const primary = LOG_TYPES[lt].fields[0][0]; const val = r.notes || text.trim();
      LOG_TYPES[lt].fields.forEach(([k]) => (entry[k] = k === primary ? val : ""));
      update((pr) => ({ logs: [entry, ...pr.logs] }));
      setTab("log");
    }
    setResult(null); setText(""); setTarget("");
  };
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <RO>
      <div style={S.card}>
        <SectionTitle eyebrow="Upload → auto-file" title="Import evidence" />
        <div style={{ fontFamily: F.body, fontSize: 12.5, color: T.sub, lineHeight: 1.6, marginBottom: 12 }}>Drop in a report, work sample, rubric, lesson plan or observation notes (<b>.docx · .xlsx · .pdf · image · text</b>). Claude reads it, proposes where it belongs and drafts the content. You confirm before anything is filed. De-identify student names first.</div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <button style={S.btn} onClick={() => fileRef.current?.click()} disabled={busy}>📎 Choose file</button>
          <input ref={fileRef} type="file" accept=".txt,.md,.csv,.tsv,.docx,.xlsx,.xls,.pdf,.png,.jpg,.jpeg,.webp,.gif" style={{ display: "none" }} onChange={onFile} />
          <button style={S.btnGhost} onClick={classify} disabled={busy || !text.trim()}>{busy ? "Working…" : "✦ Read & suggest where it goes"}</button>
        </div>
        <textarea style={{ ...AREA, minHeight: 140 }} value={text} placeholder="…or paste the text here" onChange={(e) => setText(e.target.value)} />
        {err && <div style={{ marginTop: 10, fontFamily: F.body, fontSize: 12.5, color: T.red, background: T.redSoft, border: `1px solid ${T.redLine}`, borderRadius: 10, padding: "8px 12px" }}>{err}</div>}
      </div>
      {result && (
        <div style={{ ...S.card, borderColor: T.blueLine }}>
          <SectionTitle eyebrow="Preview — nothing filed yet" title="Suggested destination" />
          {result.summary && <div style={{ fontFamily: F.body, fontSize: 13, color: T.ink, background: T.blueSoft, border: `1px solid ${T.blueLine}`, borderRadius: 12, padding: "10px 14px", marginBottom: 12 }}>💡 {result.summary}</div>}
          <Field label="File this as"><select style={S.input} value={target} onChange={(e) => setTarget(e.target.value)}>{IMPORT_TARGETS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}</select></Field>
          {target.startsWith("part:") && <Field label="Drafted paragraph"><textarea style={AREA} value={result.draft || ""} onChange={(e) => setResult({ ...result, draft: e.target.value })} /></Field>}
          {target === "appendix" && (
            <div style={{ fontFamily: F.body, fontSize: 12.5, color: T.sub }}>
              <div><b>{result.title || "Imported evidence"}</b> — {(result.annotations || []).length} descriptor annotation(s): {(result.annotations || []).map((a) => a.code).join(", ") || "none detected"}. You can refine them on the Appendices tab.</div>
            </div>
          )}
          {target === "checkpoint" && <div style={{ fontFamily: F.body, fontSize: 12.5, color: T.sub }}>{(result.results || []).length} student result(s) detected. Only rows whose name matches an existing focus learner (Student A/B/C) will attach.</div>}
          {target.startsWith("log:") && <Field label="Notes"><textarea style={AREA} value={result.notes || ""} onChange={(e) => setResult({ ...result, notes: e.target.value })} /></Field>}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}><button style={S.btn} onClick={apply}>✓ File it here</button><button style={S.btnGhost} onClick={() => setResult(null)}>Discard</button></div>
        </div>
      )}
      </RO>
    </div>
  );
}

/* ============================================================
   TAB: TIMELINE
   ============================================================ */
function Timeline() {
  const { project: p, me, milestones, setMilestones, program, setProgram, setTab } = useApp();
  const isAdmin = me.role === "admin";
  const ms = milestoneStatus(p, milestones);
  const setDue = (id, due) => setMilestones((list) => list.map((m) => (m.id === id ? { ...m, due } : m)));
  const reflow = () => { if (!program.startDate) return; setMilestones((list) => list.map((m) => ({ ...m, due: addDays(program.startDate, (m.week || 1) * 7) }))); };
  const stateLabel = { done: "Done", overdue: "Overdue", soon: "Due soon", pending: "Upcoming" };
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={S.card}>
        <SectionTitle eyebrow="Program schedule" title="Timeline & due dates" right={isAdmin ? <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}><span style={{ fontFamily: F.body, fontSize: 12, color: T.sub }}>Program start</span><input type="date" style={{ ...S.input, width: 150 }} value={program.startDate || ""} onChange={(e) => setProgram({ ...program, startDate: e.target.value })} /><button style={S.btnGhost} onClick={reflow} disabled={!program.startDate}>↻ Reflow dates</button></div> : null} />
        <div style={{ fontFamily: F.body, fontSize: 12.5, color: T.sub, lineHeight: 1.6 }}>{isAdmin ? "Set the program start date and reflow, or edit any due date individually. These dates apply to every graduate; each sees their own status against them." : "Shared due dates set by your coordinator. Your status against each is shown below."}</div>
      </div>
      <div style={S.card}>
        <div style={{ display: "grid", gap: 8 }}>
          {ms.map((m) => (
            <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 12px", borderRadius: 12, border: `1px solid ${m.state === "overdue" ? T.redLine : m.state === "done" ? T.greenLine : T.line}`, background: m.state === "overdue" ? T.redSoft : m.state === "done" ? T.greenSoft : T.card }}>
              <span style={{ width: 22, height: 22, borderRadius: 999, flex: "0 0 auto", display: "grid", placeItems: "center", background: m.done ? T.green : m.state === "overdue" ? T.red : T.lineSoft, color: m.done || m.state === "overdue" ? "#FFF" : T.faint, fontSize: 12, fontWeight: 800 }}>{m.done ? "✓" : m.state === "overdue" ? "!" : ""}</span>
              <button onClick={() => m.tab && setTab(m.tab)} style={{ flex: 1, minWidth: 0, textAlign: "left", background: "transparent", border: "none", cursor: m.tab ? "pointer" : "default", fontFamily: F.body, fontSize: 13.5, fontWeight: 600, color: T.ink }}>{m.label}</button>
              <Pill tone={m.state === "done" ? "green" : m.state === "overdue" ? "red" : m.state === "soon" ? "amber" : "plain"} style={{ fontSize: 11 }}>{stateLabel[m.state]}</Pill>
              {isAdmin ? <input type="date" style={{ ...S.input, width: 145 }} value={m.due || ""} onChange={(e) => setDue(m.id, e.target.value)} /> : <span style={{ fontFamily: F.body, fontSize: 12.5, color: m.state === "overdue" ? T.red : T.sub, width: 90, textAlign: "right" }}>{m.due ? fmtShort(m.due) : "—"}</span>}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ============================================================
   TAB: EXPORT
   ============================================================ */
function ExportTab() {
  const { project: p } = useApp(); const [copied, setCopied] = useState(false);
  const doc = useMemo(() => compileDoc(p), [p]);
  const copy = async () => { try { await navigator.clipboard.writeText(doc); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { const ta = document.createElement("textarea"); ta.value = doc; document.body.appendChild(ta); ta.select(); document.execCommand("copy"); document.body.removeChild(ta); setCopied(true); setTimeout(() => setCopied(false), 1800); } };
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={{ ...S.card }} className="no-print">
        <SectionTitle eyebrow="Everything, assembled" title="Export the write-up" right={<div style={{ display: "flex", gap: 8 }}><button style={S.btnGhost} onClick={() => window.print()}>🖨 Print / PDF</button><button style={S.btn} onClick={copy}>{copied ? "✓ Copied" : "Copy as text"}</button></div>} />
        <div style={{ fontFamily: F.body, fontSize: 12.5, color: T.sub, lineHeight: 1.6 }}>The full project — contents page with descriptor references, Sections 1–6, every logged observation, conversation, mentor visit and checkpoint — compiled in official write-up order. Copy into your Google Doc, or print to PDF. Anything flagged <b>NOT YET EVIDENCED</b> or <b>SIGNATURE NEEDED</b> still needs attention.</div>
      </div>
      <div className="print-doc" style={{ ...S.card, padding: 26 }}><pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: F.body, fontSize: 12.5, lineHeight: 1.65, color: T.ink }}>{doc}</pre></div>
    </div>
  );
}

/* ============================================================
   DASHBOARDS — admin (everyone) / mentor (assigned)
   ============================================================ */
function Dashboard({ state, me, openProject }) {
  const { users, projects, milestones } = state;
  const isAdmin = me.role === "admin";
  const grads = users.filter((u) => u.role === "graduate" && (isAdmin || u.mentorId === me.id));
  const mentorName = (id) => users.find((u) => u.id === id)?.name || "—";
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div style={S.card}>
        <SectionTitle eyebrow={isAdmin ? "Coordinator view — all graduates" : "Mentor view — my graduates"} title={isAdmin ? "Program dashboard" : "My graduates"} />
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
          <Stat label="Graduates" value={grads.length} />
          <Stat label="Avg. completion" value={grads.length ? Math.round(grads.reduce((a, u) => a + progressOf(projects.find((p) => p.ownerId === u.id) || emptyProject(u.id)), 0) / grads.length * 100) + "%" : "—"} />
          <Stat label="Overdue milestones" value={grads.reduce((a, u) => { const p = projects.find((x) => x.ownerId === u.id); return a + (p ? milestoneStatus(p, milestones).filter((m) => m.state === "overdue").length : 0); }, 0)} tone="red" />
        </div>
      </div>
      {!grads.length && <Empty>{isAdmin ? "No graduates yet. Add staff on the Users tab." : "No graduates are assigned to you yet. Ask your coordinator to assign you as a mentor."}</Empty>}
      <div style={{ display: "grid", gap: 12 }}>
        {grads.map((u) => {
          const p = projects.find((x) => x.ownerId === u.id); if (!p) return null;
          const prog = progressOf(p); const ms = milestoneStatus(p, milestones);
          const overdue = ms.filter((m) => m.state === "overdue").length; const soon = ms.filter((m) => m.state === "soon").length;
          const cov = coveredCodes(p).length; const visits = p.logs.filter((l) => l.type === "visit").length;
          return (
            <button key={u.id} onClick={() => openProject(p.id)} style={{ ...S.card, textAlign: "left", cursor: "pointer", display: "grid", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <Avatar user={u} size={40} />
                <div style={{ flex: 1, minWidth: 160 }}>
                  <div style={{ fontFamily: F.display, fontSize: 15.5, fontWeight: 800, color: T.ink }}>{u.name}</div>
                  <div style={{ fontFamily: F.body, fontSize: 12, color: T.sub }}>{p.question ? p.question.slice(0, 80) + (p.question.length > 80 ? "…" : "") : "Inquiry question not set"}</div>
                </div>
                {isAdmin && <Pill style={{ fontSize: 11 }}>Mentor: {mentorName(u.mentorId)}</Pill>}
                {overdue > 0 && <Pill tone="red" style={{ fontSize: 11 }}>{overdue} overdue</Pill>}
                {overdue === 0 && soon > 0 && <Pill tone="amber" style={{ fontSize: 11 }}>{soon} due soon</Pill>}
              </div>
              <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ flex: "1 1 220px" }}><Bar value={prog} tone={prog === 1 ? T.green : T.blue} height={9} /></div>
                <span style={{ fontFamily: F.body, fontSize: 12, color: T.sub }}>{Math.round(prog * 100)}% · {cov}/37 standards · {visits}/3 visits</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
const Stat = ({ label, value, tone }) => (
  <div style={{ border: `1px solid ${T.line}`, borderRadius: 14, padding: 14, background: tone === "red" && value > 0 ? T.redSoft : T.card }}>
    <div style={{ fontFamily: F.display, fontSize: 26, fontWeight: 800, color: tone === "red" && value > 0 ? T.red : T.ink }}>{value}</div>
    <div style={S.eyebrow}>{label}</div>
  </div>
);

/* ============================================================
   USERS — admin manages staff & mentor assignments
   ============================================================ */
function Users({ state, setState, cloud }) {
  const { users, projects } = state;
  const [name, setName] = useState(""); const [role, setRole] = useState("graduate"); const [reg, setReg] = useState("");
  const mentors = users.filter((u) => u.role === "mentor" || u.role === "admin");
  const add = () => {
    if (!name.trim()) return;
    const u = { id: uid(), name: name.trim(), role, vitRegNo: reg.trim(), mentorId: "", color: AVATAR_WHEEL[users.length % AVATAR_WHEEL.length] };
    setState((s) => { const projs = role === "graduate" ? [...s.projects, { ...emptyProject(u.id), name: u.name }] : s.projects; return { ...s, users: [...s.users, u], projects: projs }; });
    setName(""); setReg("");
  };
  const setU = (id, patch) => setState((s) => ({ ...s, users: s.users.map((u) => (u.id === id ? { ...u, ...patch } : u)) }));
  const del = (id) => { if (!window.confirm("Remove this user and their project data?")) return; setState((s) => ({ ...s, users: s.users.filter((u) => u.id !== id), projects: s.projects.filter((p) => p.ownerId !== id) })); };
  const restoreRef = useRef(null);
  const backup = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = `vit-inquiry-hub-backup-${todayISO()}.json`;
    a.click(); URL.revokeObjectURL(a.href);
  };
  const restore = async (e) => {
    const file = e.target.files?.[0]; if (restoreRef.current) restoreRef.current.value = "";
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed?.users || !Array.isArray(parsed.projects)) throw new Error("bad file");
      if (!window.confirm("Replace ALL current data in this browser with the backup? This can't be undone.")) return;
      setState({ viewProjectId: null, program: { startDate: "" }, milestones: [], active: null, ...parsed });
    } catch { window.alert("That doesn't look like a VIT Inquiry Hub backup file."); }
  };
  return (
    <div style={{ display: "grid", gap: 16 }}>
      {cloud ? (
        <div style={S.card}>
          <SectionTitle eyebrow="Admin" title="Staff & roles" />
          <div style={{ fontFamily: F.body, fontSize: 12.5, color: T.sub, lineHeight: 1.6 }}>Staff create their own account at the sign-in screen. Set each person's <b>role</b> and (for graduates) their <b>mentor</b> below. The very first account to sign up becomes admin automatically.</div>
        </div>
      ) : (
        <div style={S.card}>
          <SectionTitle eyebrow="Admin" title="Staff & mentors" />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={{ flex: "1 1 180px" }}><label style={S.label}>Name</label><input style={S.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" onKeyDown={(e) => e.key === "Enter" && add()} /></div>
            <div><label style={S.label}>Role</label><select style={{ ...S.input, width: 150 }} value={role} onChange={(e) => setRole(e.target.value)}><option value="graduate">Graduate</option><option value="mentor">Mentor</option><option value="admin">Admin</option></select></div>
            <div><label style={S.label}>VIT reg. no.</label><input style={{ ...S.input, width: 130 }} value={reg} onChange={(e) => setReg(e.target.value)} placeholder="optional" /></div>
            <button style={S.btn} onClick={add}>+ Add</button>
          </div>
        </div>
      )}
      <div style={S.card}>
        <div style={{ display: "grid", gap: 10 }}>
          {users.map((u) => (
            <div key={u.id} style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", padding: "10px 12px", border: `1px solid ${T.line}`, borderRadius: 12 }}>
              <Avatar user={u} />
              <div style={{ flex: 1, minWidth: 140 }}>
                <div style={{ fontFamily: F.display, fontSize: 14, fontWeight: 700, color: T.ink }}>{u.name}</div>
                <div style={{ fontFamily: F.body, fontSize: 12, color: T.sub }}>{u.vitRegNo ? `VIT ${u.vitRegNo}` : "no reg no."}{u.role === "graduate" && (() => { const p = projects.find((x) => x.ownerId === u.id); return p ? ` · ${Math.round(progressOf(p) * 100)}% complete` : ""; })()}</div>
              </div>
              <select style={{ ...S.input, width: 120 }} value={u.role} onChange={(e) => setU(u.id, { role: e.target.value })} title="Role">
                <option value="graduate">graduate</option>
                <option value="mentor">mentor</option>
                <option value="admin">admin</option>
              </select>
              {u.role === "graduate" && (
                <select style={{ ...S.input, width: 180 }} value={u.mentorId || ""} onChange={(e) => setU(u.id, { mentorId: e.target.value })}>
                  <option value="">— assign mentor —</option>
                  {mentors.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.role})</option>)}
                </select>
              )}
              <button style={{ ...S.btnGhost, fontSize: 11.5, color: T.red, borderColor: T.redLine }} onClick={() => del(u.id)}>Remove</button>
            </div>
          ))}
        </div>
      </div>
      {!cloud && (
        <div style={{ ...S.card, background: T.amberSoft, borderColor: T.amberLine }}>
          <SectionTitle eyebrow="Prototype safeguard" title="Back up & restore"
            right={<div style={{ display: "flex", gap: 8 }}>
              <button style={S.btnGhost} onClick={() => restoreRef.current?.click()}>↥ Restore</button>
              <input ref={restoreRef} type="file" accept=".json,application/json" style={{ display: "none" }} onChange={restore} />
              <button style={S.btn} onClick={backup}>↧ Download backup</button>
            </div>} />
          <div style={{ fontFamily: F.body, fontSize: 12.5, color: T.amber, lineHeight: 1.6 }}>
            All data lives in <b>this browser only</b>. Download a backup regularly — clearing the browser, or switching device, otherwise loses every project. Restoring replaces everything currently in this browser with the file.
          </div>
        </div>
      )}
    </div>
  );
}

/* ============================================================
   LOGIN — simulated (prototype)
   ============================================================ */
function Login({ users, onPick, onSeed }) {
  return (
    <div style={{ minHeight: "100vh", background: T.bg, display: "grid", placeItems: "center", padding: 20 }}>
      <style>{GLOBAL_CSS}</style>
      <div style={{ ...S.card, maxWidth: 460, width: "100%", padding: 28 }}>
        <div style={S.eyebrow}>CPS · provisional → full VIT registration</div>
        <h1 style={{ fontFamily: F.display, fontSize: 26, fontWeight: 800, color: T.ink, margin: "4px 0 6px" }}>VIT Inquiry Hub</h1>
        <div style={{ fontFamily: F.body, fontSize: 13, color: T.sub, marginBottom: 18, lineHeight: 1.6 }}>Choose your account to continue. <b>Prototype:</b> logins are simulated and everyone shares this browser — it demonstrates the platform without a real backend.</div>
        {!users.length ? (
          <div style={{ display: "grid", gap: 12 }}>
            <Empty>No accounts yet.</Empty>
            <button style={S.btn} onClick={onSeed}>✦ Load a sample program (admin, 2 mentors, 3 graduates)</button>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            {users.map((u) => (
              <button key={u.id} onClick={() => onPick(u.id)} style={{ ...S.btnGhost, display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", textAlign: "left" }}>
                <Avatar user={u} />
                <span style={{ flex: 1 }}><span style={{ display: "block", fontFamily: F.display, fontSize: 14, fontWeight: 700, color: T.ink }}>{u.name}</span><span style={{ display: "block", fontFamily: F.body, fontSize: 12, color: T.sub }}>{u.role}{u.vitRegNo ? ` · VIT ${u.vitRegNo}` : ""}</span></span>
                <span style={{ fontSize: 16, color: T.faint }}>›</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ---------- sample program seed ---------- */
function seedProgram() {
  const start = todayISO();
  const mk = (name, role, reg) => ({ id: uid(), name, role, vitRegNo: reg, mentorId: "", color: "" });
  const admin = mk("Ashlee Smith", "admin", "396246");
  const m1 = mk("Rosie McComb", "mentor", "418739"); const m2 = mk("Ellen Myers", "mentor", "608929");
  const g1 = mk("Katherine Muller", "graduate", ""); const g2 = mk("Sam Nguyen", "graduate", ""); const g3 = mk("Priya Patel", "graduate", "");
  g1.mentorId = m1.id; g2.mentorId = m1.id; g3.mentorId = m2.id;
  const users = [admin, m1, m2, g1, g2, g3].map((u, i) => ({ ...u, color: AVATAR_WHEEL[i % AVATAR_WHEEL.length] }));
  const projects = [g1, g2, g3].map((g) => { const p = emptyProject(g.id, g.name); p.school = "Canterbury Primary School"; p.yearLevel = "Year 4"; return p; });
  projects[0].question = "Will experimenting with different elements of ‘Scaffolded Practice’ (VTLM 2.0) support student growth in Writing?";
  projects[0].writeup["1a"] = { text: "Canterbury Primary School is a vibrant government primary school in Melbourne’s eastern suburbs…", done: true };
  const milestones = DEFAULT_MILESTONES.map((m) => ({ ...m, id: uid(), due: addDays(start, m.week * 7) }));
  return { users, active: admin.id, projects, milestones, program: { startDate: start }, viewProjectId: null };
}

/* ============================================================
   APP
   ============================================================ */
const GRAD_TABS = [
  { id: "overview", label: "Overview", icon: "🧭" }, { id: "writeup", label: "Write-Up", icon: "✍️" },
  { id: "log", label: "Evidence Log", icon: "📔" }, { id: "students", label: "Learners & Data", icon: "📊" },
  { id: "standards", label: "AITSL Standards", icon: "🎯" }, { id: "appendices", label: "Appendices", icon: "📎" },
  { id: "import", label: "Import", icon: "📥" }, { id: "timeline", label: "Timeline", icon: "🗓" },
  { id: "export", label: "Export", icon: "📤" },
];
const REVIEW_TABS = GRAD_TABS.filter((t) => t.id !== "import"); // reviewers don't import into someone else's evidence

/* ---------- inner shell — header, nav, routing, context (shared by local + cloud) ---------- */
function Shell({ state, setState, me, onExit, exitLabel, cloud }) {
  const [tab, setTab] = useState("overview");
  const isReviewer = me.role === "admin" || me.role === "mentor";
  const ownProject = state.projects.find((p) => p.ownerId === me.id);
  const viewProject = isReviewer ? state.projects.find((p) => p.id === state.viewProjectId) : ownProject;
  const ro = isReviewer && !!viewProject; // reviewers can't edit graduate content, only feedback
  const owner = viewProject ? state.users.find((u) => u.id === viewProject.ownerId) : null;

  const updateProject = (patch) => setState((s) => ({ ...s, projects: s.projects.map((p) => (p.id === viewProject.id ? { ...p, ...(typeof patch === "function" ? patch(p) : patch) } : p)) }));
  const postFeedback = (threadId, text) => updateProject((p) => ({ feedback: { ...p.feedback, [threadId]: [...(p.feedback?.[threadId] || []), { id: uid(), authorId: me.id, authorName: me.name, authorRole: me.role, authorColor: me.color, text, at: Date.now() }] } }));
  const setMilestones = (fn) => setState((s) => ({ ...s, milestones: typeof fn === "function" ? fn(s.milestones) : fn }));
  const setProgram = (program) => setState((s) => ({ ...s, program }));

  const ctx = { me, users: state.users, project: viewProject ? { ...viewProject, ownerName: owner?.name } : null, update: updateProject, postFeedback, ro, setTab, milestones: state.milestones, setMilestones, program: state.program, setProgram, cloud };

  const showWorkspace = !!viewProject;
  const tabs = isReviewer ? REVIEW_TABS : GRAD_TABS;
  const navItems = isReviewer && !showWorkspace ? (me.role === "admin" ? [{ id: "dashboard", label: "Dashboard", icon: "📋" }, { id: "users", label: "Users", icon: "👥" }, { id: "timeline", label: "Timeline", icon: "🗓" }] : [{ id: "dashboard", label: "My graduates", icon: "📋" }, { id: "timeline", label: "Timeline", icon: "🗓" }]) : tabs;
  const effTab = isReviewer && !showWorkspace ? (["dashboard", "users", "timeline"].includes(tab) ? tab : "dashboard") : tab;

  return (
    <Ctx.Provider value={ctx}>
    <div style={{ minHeight: "100vh", background: T.bg, padding: "18px 16px 60px" }}>
      <style>{GLOBAL_CSS}</style>
      <style>{`@media (max-width: 860px){ .writeup-grid{ grid-template-columns:1fr !important; } .writeup-grid > .no-print{ position:static !important; } }`}</style>
      <div style={{ maxWidth: 1180, margin: "0 auto" }}>
        <header className="no-print" style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16, flexWrap: "wrap" }}>
          <div style={{ flex: "1 1 260px" }}>
            <div style={S.eyebrow}>CPS · VIT Inquiry Hub{isReviewer ? ` · ${me.role}` : ""}</div>
            <h1 style={{ fontFamily: F.display, fontSize: 24, fontWeight: 800, color: T.ink, margin: "2px 0 4px" }}>
              {showWorkspace ? (isReviewer ? `${owner?.name || "Graduate"}` : "My VIT Inquiry") : (me.role === "admin" ? "Program dashboard" : "My graduates")}
            </h1>
            <div style={{ fontFamily: F.body, fontSize: 13, color: T.sub, maxWidth: 640 }}>
              {showWorkspace ? (ctx.project.question || "Track, collect and write every part of the VIT inquiry.") : (me.role === "admin" ? "Oversight of every graduate's inquiry, standards coverage and due dates." : "The graduates you mentor, their progress and where they need feedback.")}
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            {showWorkspace && isReviewer && <button style={S.btnGhost} onClick={() => setState((s) => ({ ...s, viewProjectId: null }))}>← All graduates</button>}
            {ro && <Pill tone="amber" style={{ fontSize: 11 }}>👁 Review mode · feedback only</Pill>}
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}><Avatar user={me} size={30} /><span style={{ fontFamily: F.body, fontSize: 12.5, fontWeight: 600, color: T.sub }}>{me.name}</span></span>
            <button style={S.btnGhost} onClick={onExit}>{exitLabel}</button>
          </div>
        </header>

        <nav className="no-print" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
          {navItems.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{ ...S.pill, cursor: "pointer", padding: "8px 16px", ...(effTab === t.id ? TONES.ink : {}) }}><span>{t.icon}</span> {t.label}</button>
          ))}
        </nav>

        {/* reviewer home */}
        {isReviewer && !showWorkspace && effTab === "dashboard" && <Dashboard state={state} me={me} openProject={(id) => { setState((s) => ({ ...s, viewProjectId: id })); setTab("overview"); }} />}
        {isReviewer && !showWorkspace && effTab === "users" && me.role === "admin" && <Users state={state} setState={setState} cloud={cloud} />}
        {isReviewer && !showWorkspace && effTab === "timeline" && <Timeline />}

        {/* workspace (graduate own, or reviewer viewing a graduate) */}
        {showWorkspace && effTab === "overview" && <Overview />}
        {showWorkspace && effTab === "writeup" && <WriteUp />}
        {showWorkspace && effTab === "log" && <EvidenceLog />}
        {showWorkspace && effTab === "students" && <Students />}
        {showWorkspace && effTab === "standards" && <Standards />}
        {showWorkspace && effTab === "appendices" && <Appendices />}
        {showWorkspace && effTab === "import" && !isReviewer && <ImportTab />}
        {showWorkspace && effTab === "timeline" && <Timeline />}
        {showWorkspace && effTab === "export" && <ExportTab />}
      </div>
    </div>
    </Ctx.Provider>
  );
}

/* ---------- LOCAL driver — simulated logins, localStorage (artifact / no-backend) ---------- */
function LocalApp() {
  const [state, setState] = useState(null);
  useEffect(() => { (async () => {
    const raw = await store.get(KEY);
    if (raw) { try { const s = JSON.parse(raw); if (s?.users) { setState({ viewProjectId: null, program: { startDate: "" }, milestones: [], ...s }); return; } } catch {} }
    setState({ users: [], active: null, projects: [], milestones: DEFAULT_MILESTONES.map((m) => ({ ...m, id: uid(), due: "" })), program: { startDate: "" }, viewProjectId: null });
  })(); }, []);
  useEffect(() => { if (!state) return; const t = setTimeout(() => store.set(KEY, JSON.stringify(state)), 400); return () => clearTimeout(t); }, [state]);
  useEffect(() => {
    if (!state) return;
    const missing = state.users.filter((u) => u.role === "graduate" && !state.projects.some((p) => p.ownerId === u.id));
    if (missing.length) setState((s) => ({ ...s, projects: [...s.projects, ...missing.map((u) => ({ ...emptyProject(u.id), name: u.name }))] }));
  }, [state?.users.length]);
  if (!state) return null;
  const me = state.users.find((u) => u.id === state.active) || null;
  if (!me) return <Login users={state.users} onPick={(id) => setState((s) => ({ ...s, active: id, viewProjectId: null }))} onSeed={() => setState(seedProgram())} />;
  return <Shell key={me.id} state={state} setState={setState} me={me} exitLabel="Switch user" cloud={false}
    onExit={() => setState((s) => ({ ...s, active: null, viewProjectId: null }))} />;
}

/* ---------- CLOUD driver — real auth + Supabase (cross-device, multi-user) ---------- */
function CloudAuth({ backend }) {
  const [mode, setMode] = useState("in"); const [email, setEmail] = useState(""); const [pw, setPw] = useState(""); const [name, setName] = useState("");
  const [err, setErr] = useState(""); const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  const submit = async () => {
    setErr(""); setMsg(""); setBusy(true);
    try {
      if (mode === "up") {
        if (!name.trim()) throw new Error("Please enter your name.");
        const { error } = await backend.signUp({ email: email.trim(), password: pw, name: name.trim() });
        if (error) throw error;
        setMsg("Account created. If email confirmation is on, confirm via the email first, then sign in."); setMode("in"); setPw("");
      } else {
        const { error } = await backend.signIn({ email: email.trim(), password: pw });
        if (error) throw error;
      }
    } catch (e) { setErr(e.message || "Something went wrong."); } finally { setBusy(false); }
  };
  return (
    <div style={{ minHeight: "100vh", background: T.bg, display: "grid", placeItems: "center", padding: 20 }}>
      <style>{GLOBAL_CSS}</style>
      <div style={{ ...S.card, maxWidth: 420, width: "100%", padding: 28 }}>
        <div style={S.eyebrow}>CPS · provisional → full VIT registration</div>
        <h1 style={{ fontFamily: F.display, fontSize: 26, fontWeight: 800, color: T.ink, margin: "4px 0 6px" }}>VIT Inquiry Hub</h1>
        <div style={{ fontFamily: F.body, fontSize: 13, color: T.sub, marginBottom: 18, lineHeight: 1.6 }}>{mode === "in" ? "Sign in with your school email." : "Create your account with your school email. The first account becomes the program admin."}</div>
        <div style={{ display: "grid", gap: 10 }}>
          {mode === "up" && <div><label style={S.label}>Full name</label><input style={S.input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" /></div>}
          <div><label style={S.label}>Email</label><input style={S.input} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@education.vic.gov.au" onKeyDown={(e) => e.key === "Enter" && submit()} /></div>
          <div><label style={S.label}>Password</label><input style={S.input} type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="••••••••" onKeyDown={(e) => e.key === "Enter" && submit()} /></div>
          {err && <div style={{ fontFamily: F.body, fontSize: 12.5, color: T.red, background: T.redSoft, border: `1px solid ${T.redLine}`, borderRadius: 10, padding: "8px 12px" }}>{err}</div>}
          {msg && <div style={{ fontFamily: F.body, fontSize: 12.5, color: T.green, background: T.greenSoft, border: `1px solid ${T.greenLine}`, borderRadius: 10, padding: "8px 12px" }}>{msg}</div>}
          <button style={{ ...S.btn, marginTop: 4 }} onClick={submit} disabled={busy || !email.trim() || !pw}>{busy ? "…" : mode === "in" ? "Sign in" : "Create account"}</button>
          <button style={{ ...S.btnGhost, fontSize: 12.5 }} onClick={() => { setMode(mode === "in" ? "up" : "in"); setErr(""); setMsg(""); }}>{mode === "in" ? "New here? Create an account" : "Already have an account? Sign in"}</button>
        </div>
        <div style={{ fontFamily: F.body, fontSize: 11.5, color: T.faint, marginTop: 16, lineHeight: 1.5 }}>Refer to students as Student A/B/C — never real names.</div>
      </div>
    </div>
  );
}
function CloudApp({ backend }) {
  const [phase, setPhase] = useState("loading"); // loading | auth | ready
  const [userId, setUserId] = useState(null);
  const [state, setState] = useState(null);
  const lastSync = useRef(null);

  useEffect(() => {
    let unsub;
    (async () => {
      const u = await backend.getSession();
      setUserId(u?.id || null); setPhase(u ? "ready" : "auth");
      unsub = backend.onAuthChange((u2) => { setUserId(u2?.id || null); setPhase(u2 ? "ready" : "auth"); if (!u2) { setState(null); lastSync.current = null; } });
    })();
    return () => { if (unsub) unsub(); };
  }, [backend]);

  const reload = useCallback(async () => {
    if (!userId) return;
    let data;
    try { data = await backend.load(); } catch (e) { console.error("load failed", e); return; }
    setState((prev) => {
      let next = { ...data, active: userId, viewProjectId: prev?.viewProjectId ?? null };
      const meNow = next.users.find((u) => u.id === userId);
      if (meNow?.role === "graduate" && !next.projects.some((p) => p.ownerId === userId)) {
        next = { ...next, projects: [...next.projects, { ...emptyProject(userId), name: meNow.name }] };
      }
      lastSync.current = { users: next.users, projects: next.projects, milestones: next.milestones, program: next.program };
      return next;
    });
  }, [userId, backend]);

  useEffect(() => { if (phase === "ready") reload(); }, [phase, reload]);
  // pull latest when the tab regains focus (cheap cross-device refresh)
  useEffect(() => {
    if (phase !== "ready") return;
    const h = () => reload();
    window.addEventListener("focus", h);
    return () => window.removeEventListener("focus", h);
  }, [phase, reload]);
  // push local edits to Supabase (debounced, per-row diff)
  useEffect(() => {
    if (phase !== "ready" || !state) return;
    const t = setTimeout(async () => {
      const prev = lastSync.current;
      try { await backend.sync(prev, state); } catch (e) { console.error("sync failed", e); }
      lastSync.current = { users: state.users, projects: state.projects, milestones: state.milestones, program: state.program };
    }, 700);
    return () => clearTimeout(t);
  }, [state, phase, backend]);

  if (phase === "loading") return null;
  if (phase === "auth" || !userId) return <CloudAuth backend={backend} />;
  if (!state) return null;
  const me = state.users.find((u) => u.id === userId);
  if (!me) return (
    <div style={{ minHeight: "100vh", background: T.bg, display: "grid", placeItems: "center", fontFamily: F.body, color: T.sub }}>
      <style>{GLOBAL_CSS}</style>
      <div style={{ textAlign: "center" }}><div style={{ fontSize: 22, marginBottom: 8 }}>⏳</div>Setting up your profile…<br /><button style={{ ...S.btnGhost, marginTop: 14 }} onClick={() => backend.signOut()}>Sign out</button></div>
    </div>
  );
  return <Shell key={me.id} state={state} setState={setState} me={me} exitLabel="Sign out" cloud={true}
    onExit={async () => { try { await backend.signOut(); } catch {} }} />;
}

/* ---------- entry — cloud if a Supabase backend was injected (build), else local ---------- */
export default function App({ backend } = {}) {
  return backend && backend.kind === "cloud" ? <CloudApp backend={backend} /> : <LocalApp />;
}
