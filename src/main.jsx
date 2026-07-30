import React from "react";
import { createRoot } from "react-dom/client";
import App from "../VIT_Inquiry_Platform.jsx";
import { hasSupabase, makeBackend } from "./backend.js";

// Cloud (real auth + Supabase) when env vars are set; otherwise the local
// single-browser mode. Both render the same UI.
const backend = hasSupabase ? makeBackend() : undefined;

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App backend={backend} />
  </React.StrictMode>
);
