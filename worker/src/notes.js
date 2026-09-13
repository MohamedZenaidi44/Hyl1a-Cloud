import { json, errorJson, newId, now } from "./utils.js";

export async function listNotes(request, env, user) {
  const rows = await env.DB.prepare(
    "SELECT id, title, content, updated_at FROM notes WHERE user_id = ? ORDER BY updated_at DESC"
  )
    .bind(user.id)
    .all();
  return json({ notes: rows.results });
}

export async function createNote(request, env, user) {
  const body = await request.json().catch(() => ({}));
  const id = newId();
  await env.DB.prepare(
    "INSERT INTO notes (id, user_id, title, content, updated_at) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(id, user.id, body.title || "Sans titre", body.content || "", now())
    .run();
  return json({ id }, 201);
}

export async function updateNote(request, env, user, noteId) {
  const body = await request.json().catch(() => null);
  if (!body) return errorJson("Requete invalide.", 400);

  const result = await env.DB.prepare(
    "UPDATE notes SET title = ?, content = ?, updated_at = ? WHERE id = ? AND user_id = ?"
  )
    .bind(body.title ?? "Sans titre", body.content ?? "", now(), noteId, user.id)
    .run();
  if (result.meta.changes === 0) return errorJson("Introuvable.", 404);

  return json({ ok: true });
}

export async function deleteNote(request, env, user, noteId) {
  const result = await env.DB.prepare("DELETE FROM notes WHERE id = ? AND user_id = ?")
    .bind(noteId, user.id)
    .run();
  if (result.meta.changes === 0) return errorJson("Introuvable.", 404);
  return json({ ok: true });
}
