// Supabase-backed data layer for the VIT Inquiry Hub.
//
// All Supabase logic lives here (not in VIT_Inquiry_Platform.jsx) so the
// component stays a plain, paste-into-an-artifact React file. main.jsx builds
// this backend when the VITE_SUPABASE_* env vars are present and passes it to
// <App backend={...} />; without env vars the app falls back to local mode.
import { createClient } from "@supabase/supabase-js";

const URL = import.meta.env.VITE_SUPABASE_URL;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const hasSupabase = !!(URL && ANON);

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
const uid = () => Math.random().toString(36).slice(2, 9);
const seedMilestones = () => DEFAULT_MILESTONES.map((m) => ({ ...m, id: uid(), due: "" }));

// row (snake_case) <-> app object (camelCase)
const rowToUser = (r) => ({ id: r.id, name: r.name || "", role: r.role || "graduate", vitRegNo: r.vit_reg_no || "", mentorId: r.mentor_id || "", color: r.color || "" });
const userToRow = (u) => ({ id: u.id, name: u.name, role: u.role, vit_reg_no: u.vitRegNo || null, mentor_id: u.mentorId || null, color: u.color || null });
const changed = (a, b) => JSON.stringify(a) !== JSON.stringify(b);

export function makeBackend() {
  const sb = createClient(URL, ANON);
  return {
    kind: "cloud",

    async getSession() {
      const { data } = await sb.auth.getSession();
      return data.session?.user || null;
    },
    onAuthChange(cb) {
      const { data } = sb.auth.onAuthStateChange((_e, session) => cb(session?.user || null));
      return () => data.subscription.unsubscribe();
    },
    async signUp({ email, password, name }) {
      return sb.auth.signUp({ email, password, options: { data: { name } } });
    },
    async signIn({ email, password }) {
      return sb.auth.signInWithPassword({ email, password });
    },
    async signOut() {
      return sb.auth.signOut();
    },

    // Load everything the current user is allowed to see into the app's state shape.
    async load() {
      const [{ data: profiles, error: pe }, { data: projects, error: pje }, { data: program, error: pre }] = await Promise.all([
        sb.from("profiles").select("*"),
        sb.from("projects").select("*"),
        sb.from("program").select("*").eq("id", "program").maybeSingle(),
      ]);
      if (pe) throw pe;
      if (pje) throw pje;
      if (pre) throw pre;
      return {
        users: (profiles || []).map(rowToUser),
        projects: (projects || []).map((r) => ({ ...(r.data || {}), id: r.id, ownerId: r.owner_id })),
        milestones: program?.milestones?.length ? program.milestones : seedMilestones(),
        program: { startDate: program?.start_date || "" },
      };
    },

    // Diff prev vs next and write only the rows that changed. RLS decides what
    // the current user may actually write; rejected writes are logged, not fatal.
    async sync(prev, next) {
      const run = async (label, p) => { try { const { error } = await p; if (error) console.warn(`sync ${label}:`, error.message); } catch (e) { console.warn(`sync ${label}:`, e.message); } };

      // profiles
      for (const u of next.users) {
        const before = prev?.users.find((x) => x.id === u.id);
        if (!before || changed(before, u)) await run("profile", sb.from("profiles").upsert(userToRow(u)));
      }
      for (const u of prev?.users || []) {
        if (!next.users.find((x) => x.id === u.id)) await run("profile-del", sb.from("profiles").delete().eq("id", u.id));
      }
      // projects (the whole project object is stored as JSONB in `data`)
      for (const pr of next.projects) {
        const before = prev?.projects.find((x) => x.id === pr.id);
        if (!before || changed(before, pr)) await run("project", sb.from("projects").upsert({ id: pr.id, owner_id: pr.ownerId, data: pr, updated_at: new Date().toISOString() }));
      }
      for (const pr of prev?.projects || []) {
        if (!next.projects.find((x) => x.id === pr.id)) await run("project-del", sb.from("projects").delete().eq("id", pr.id));
      }
      // program (shared single row)
      if (!prev || changed(prev.milestones, next.milestones) || changed(prev.program, next.program)) {
        await run("program", sb.from("program").upsert({ id: "program", milestones: next.milestones, start_date: next.program?.startDate || "" }));
      }
    },
  };
}
