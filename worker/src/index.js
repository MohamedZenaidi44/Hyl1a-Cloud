import { errorJson, corsHeaders } from "./utils.js";
import { handleSignup, handleLogin, handleLogout, requireUser } from "./auth.js";
import { listFiles, createFolder, uploadFile, downloadFile, deleteFile, renameFile } from "./files.js";
import { listNotes, createNote, updateNote, deleteNote } from "./notes.js";

// IMPORTANT : remplace par l'URL de ton frontend une fois deploye (ex: "https://hylia-cloud.vercel.app")
// Utiliser "*" fonctionne pour tester en local mais desactive l'envoi de cookies cross-site.
const ALLOWED_ORIGIN = "http://127.0.0.1:5500";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    const cors = corsHeaders(origin, ALLOWED_ORIGIN);

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
      return errorJson("Erreur serveur.", 500);
    }
  },
};

async function route(request, env, url, cors) {
  const { pathname } = url;
  const method = request.method;

  // ---- Auth (public) ----
  if (pathname === "/api/auth/signup" && method === "POST") return handleSignup(request, env, cors);
  if (pathname === "/api/auth/login" && method === "POST") return handleLogin(request, env, cors);
  if (pathname === "/api/auth/logout" && method === "POST") return handleLogout(request, env, cors);

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
