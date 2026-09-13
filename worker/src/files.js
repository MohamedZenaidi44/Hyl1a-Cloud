import { json, errorJson, newId, now } from "./utils.js";

const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200 Mo par fichier (ajuste selon ton plan R2)

export async function listFiles(request, env, user) {
  const url = new URL(request.url);
  const parentId = url.searchParams.get("parent_id") || null;
  const type = url.searchParams.get("type"); // ex: "image" -> vue Photos, a plat, tous dossiers confondus

  // Filtres par type MIME — toujours à plat (tous dossiers confondus)
  const mimeFilters = {
    image: "mime LIKE 'image/%'",
    video: "mime LIKE 'video/%'",
    audio: "mime LIKE 'audio/%'",
    doc:   "(mime LIKE 'application/pdf' OR mime LIKE 'text/%' OR mime LIKE 'application/msword' OR mime LIKE 'application/vnd.%' OR mime LIKE 'application/zip' OR mime LIKE 'application/x-zip%')",
  };

  if (type && mimeFilters[type]) {
    const rows = await env.DB.prepare(
      `SELECT id, name, size, mime, is_folder, parent_id, created_at
       FROM files WHERE user_id = ? AND is_folder = 0 AND ${mimeFilters[type]}
       ORDER BY created_at DESC`
    )
      .bind(user.id)
      .all();
    return json({ files: rows.results });
  }

  const rows = await env.DB.prepare(
    `SELECT id, name, size, mime, is_folder, parent_id, created_at
     FROM files WHERE user_id = ? AND parent_id IS ? ORDER BY is_folder DESC, name COLLATE NOCASE ASC`
  )
    .bind(user.id, parentId)
    .all();

  return json({ files: rows.results });
}

export async function createFolder(request, env, user) {
  const body = await request.json().catch(() => null);
  if (!body || !body.name || !body.name.trim()) return errorJson("Nom de dossier requis.", 400);

  const id = newId();
  await env.DB.prepare(
    `INSERT INTO files (id, user_id, name, r2_key, size, mime, is_folder, parent_id, created_at)
     VALUES (?, ?, ?, NULL, 0, 'folder', 1, ?, ?)`
  )
    .bind(id, user.id, body.name.trim(), body.parent_id || null, now())
    .run();

  return json({ id }, 201);
}

export async function uploadFile(request, env, user) {
  const form = await request.formData().catch(() => null);
  if (!form) return errorJson("Formulaire invalide.", 400);

  const file = form.get("file");
  const parentId = form.get("parent_id") || null;
  if (!file || typeof file === "string") return errorJson("Aucun fichier fourni.", 400);
  if (file.size > MAX_FILE_SIZE) return errorJson("Fichier trop volumineux (max 200 Mo).", 413);

  const id = newId();
  const r2Key = `${user.id}/${id}`;

  await env.BUCKET.put(r2Key, file.stream(), {
    httpMetadata: { contentType: file.type || "application/octet-stream" },
  });

  await env.DB.prepare(
    `INSERT INTO files (id, user_id, name, r2_key, size, mime, is_folder, parent_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`
  )
    .bind(id, user.id, file.name, r2Key, file.size, file.type || "application/octet-stream", parentId, now())
    .run();

  return json({ id, name: file.name, size: file.size, mime: file.type }, 201);
}

export async function downloadFile(request, env, user, fileId) {
  const row = await env.DB.prepare("SELECT * FROM files WHERE id = ? AND user_id = ?")
    .bind(fileId, user.id)
    .first();
  if (!row || row.is_folder) return errorJson("Fichier introuvable.", 404);

  const object = await env.BUCKET.get(row.r2_key);
  if (!object) return errorJson("Fichier introuvable dans le stockage.", 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Content-Disposition", `inline; filename="${encodeURIComponent(row.name)}"`);
  headers.set("Cache-Control", "private, max-age=3600");

  return new Response(object.body, { headers });
}

export async function deleteFile(request, env, user, fileId) {
  const row = await env.DB.prepare("SELECT * FROM files WHERE id = ? AND user_id = ?")
    .bind(fileId, user.id)
    .first();
  if (!row) return errorJson("Introuvable.", 404);

  if (row.is_folder) {
    // Suppression recursive du contenu du dossier
    await deleteFolderRecursive(env, user.id, fileId);
  } else {
    if (row.r2_key) await env.BUCKET.delete(row.r2_key);
    await env.DB.prepare("DELETE FROM files WHERE id = ?").bind(fileId).run();
  }

  return json({ ok: true });
}

async function deleteFolderRecursive(env, userId, folderId) {
  const children = await env.DB.prepare("SELECT * FROM files WHERE user_id = ? AND parent_id = ?")
    .bind(userId, folderId)
    .all();

  for (const child of children.results) {
    if (child.is_folder) {
      await deleteFolderRecursive(env, userId, child.id);
    } else {
      if (child.r2_key) await env.BUCKET.delete(child.r2_key);
      await env.DB.prepare("DELETE FROM files WHERE id = ?").bind(child.id).run();
    }
  }
  await env.DB.prepare("DELETE FROM files WHERE id = ?").bind(folderId).run();
}

export async function renameFile(request, env, user, fileId) {
  const body = await request.json().catch(() => null);
  if (!body || !body.name || !body.name.trim()) return errorJson("Nom requis.", 400);

  const result = await env.DB.prepare("UPDATE files SET name = ? WHERE id = ? AND user_id = ?")
    .bind(body.name.trim(), fileId, user.id)
    .run();
  if (result.meta.changes === 0) return errorJson("Introuvable.", 404);

  return json({ ok: true });
}
