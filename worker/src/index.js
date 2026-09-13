import { errorJson, corsHeaders } from "./utils.js";
import { handleLogin, handleLogout, requireUser, handleSetup } from "./auth.js";
import { listFiles, createFolder, uploadFile, downloadFile, deleteFile, renameFile } from "./files.js";
import { listNotes, createNote, updateNote, deleteNote } from "./notes.js";

// Origines autorisees (production Vercel + dev local)
const ALLOWED_ORIGINS = [
  "https://hyl1a-cloud.vercel.app",
  "http://127.0.0.1:5500",
  "http://localhost:5500",
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0]);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: cors });
    }

    try {
      const response = await route(request, env, url, cors);
      const headers = new Headers(response.headers);
      Object.entries(cors).forEach(([k, v]) => headers.set(k, v));
      return new Response(response.body, { status: response.status, headers });
    } catch (err) {
      console.error(err);
      // Toujours renvoyer les headers CORS même sur erreur 500
      const errResp = errorJson("Erreur serveur : " + (err.message || err), 500);
      const h = new Headers(errResp.headers);
      Object.entries(cors).forEach(([k, v]) => h.set(k, v));
      return new Response(errResp.body, { status: 500, headers: h });
    }
  },
};

async function route(request, env, url, cors) {
  const { pathname } = url;
  const method = request.method;

  // ---- Auth (public) ----
  // /api/auth/signup est DÉSACTIVÉ — seul /api/setup (one-shot) peut créer un compte
  if (pathname === "/api/setup"        && method === "POST") return handleSetup(request, env, cors);
  if (pathname === "/api/auth/login"   && method === "POST") return handleLogin(request, env, cors);
  if (pathname === "/api/auth/logout"  && method === "POST") return handleLogout(request, env, cors);

  if (pathname === "/api/auth/me" && method === "GET") {
    const user = await requireUser(request, env);
    if (!user) return errorJson("Non connecte.", 401);
    return new Response(JSON.stringify({ user }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  // ---- Tout le reste necessite d'etre connecte ----
  const user = await requireUser(request, env);
  if (!user) return errorJson("Non connecte.", 401);

  // Fichiers / dossiers
  if (pathname === "/api/files" && method === "GET") return listFiles(request, env, user);
  if (pathname === "/api/files/upload" && method === "POST") return uploadFile(request, env, user);
  if (pathname === "/api/folders" && method === "POST") return createFolder(request, env, user);

  const fileMatch = pathname.match(/^\/api\/files\/([a-zA-Z0-9-]+)$/);
  if (fileMatch && method === "DELETE") return deleteFile(request, env, user, fileMatch[1]);
  if (fileMatch && method === "PATCH") return renameFile(request, env, user, fileMatch[1]);

  const downloadMatch = pathname.match(/^\/api\/files\/([a-zA-Z0-9-]+)\/download$/);
  if (downloadMatch && method === "GET") return downloadFile(request, env, user, downloadMatch[1]);

  // Notes
  if (pathname === "/api/notes" && method === "GET") return listNotes(request, env, user);
  if (pathname === "/api/notes" && method === "POST") return createNote(request, env, user);

  const noteMatch = pathname.match(/^\/api\/notes\/([a-zA-Z0-9-]+)$/);
  if (noteMatch && method === "PATCH") return updateNote(request, env, user, noteMatch[1]);
  if (noteMatch && method === "DELETE") return deleteNote(request, env, user, noteMatch[1]);

  return errorJson("Route introuvable.", 404);
}
