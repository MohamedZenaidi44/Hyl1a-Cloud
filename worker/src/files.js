import { json, errorJson, newId, now } from "./utils.js";

// Limite reelle des Workers (corps de requete : 100 Mo sur les plans Free/Pro).
const MAX_FILE_SIZE = 100 * 1024 * 1024;

// Certains navigateurs envoient un type vide pour .mkv, .flac, .m4a, .heic...
// On le deduit de l'extension pour que les vues Videos/Musique/Photos fonctionnent.
const MIME_BY_EXT = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
  avif: "image/avif", bmp: "image/bmp", svg: "image/svg+xml", heic: "image/heic", heif: "image/heif",
  mp4: "video/mp4", m4v: "video/mp4", webm: "video/webm", mov: "video/quicktime",
  mkv: "video/x-matroska", avi: "video/x-msvideo", ogv: "video/ogg", "3gp": "video/3gpp",
  mp3: "audio/mpeg", wav: "audio/wav", ogg: "audio/ogg", oga: "audio/ogg", flac: "audio/flac",
  m4a: "audio/mp4", aac: "audio/aac", opus: "audio/opus", wma: "audio/x-ms-wma",
  pdf: "application/pdf", txt: "text/plain", md: "text/markdown", csv: "text/csv",
  json: "application/json", rtf: "application/rtf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip",
};

function resolveMime(name, type) {
  if (type && type !== "application/octet-stream") return type;
  const dot = name.lastIndexOf(".");
  if (dot === -1) return type || "application/octet-stream";
  return MIME_BY_EXT[name.slice(dot + 1).toLowerCase()] || type || "application/octet-stream";
}

async function isOwnedFolder(env, userId, folderId) {
  if (!folderId) return true; // racine
  const row = await env.DB.prepare("SELECT id FROM files WHERE id = ? AND user_id = ? AND is_folder = 1")
    .bind(folderId, userId)
    .first();
  return !!row;
}

export async function listFiles(request, env, user) {
  const url = new URL(request.url);
  const parentId = url.searchParams.get("parent_id") || null;
  const type = url.searchParams.get("type"); // ex: "image" -> vue Photos, a plat, tous dossiers confondus

  // Filtres par type MIME — toujours à plat (tous dossiers confondus)
  // "all" = tous les fichiers (hors dossiers), sert au calcul du stockage et aux vues filtrees cote client.
  const mimeFilters = {
    all:   "1 = 1",
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
  if (!body || typeof body.name !== "string" || !body.name.trim()) return errorJson("Nom de dossier requis.", 400);

  const parentId = body.parent_id || null;
  if (!(await isOwnedFolder(env, user.id, parentId))) return errorJson("Dossier parent introuvable.", 404);

  const id = newId();
  await env.DB.prepare(
    `INSERT INTO files (id, user_id, name, r2_key, size, mime, is_folder, parent_id, created_at)
     VALUES (?, ?, ?, NULL, 0, 'folder', 1, ?, ?)`
  )
    .bind(id, user.id, body.name.trim().slice(0, 255), parentId, now())
    .run();

  return json({ id }, 201);
}

export async function uploadFile(request, env, user) {
  const form = await request.formData().catch(() => null);
  if (!form) return errorJson("Formulaire invalide.", 400);

  const file = form.get("file");
  const parentId = form.get("parent_id") || null;
  if (!file || typeof file === "string") return errorJson("Aucun fichier fourni.", 400);
  if (file.size > MAX_FILE_SIZE) return errorJson("Fichier trop volumineux (max 100 Mo).", 413);
  if (!(await isOwnedFolder(env, user.id, parentId))) return errorJson("Dossier parent introuvable.", 404);

  const id = newId();
  const r2Key = `${user.id}/${id}`;
  const mime = resolveMime(file.name, file.type);

  await env.BUCKET.put(r2Key, file.stream(), {
    httpMetadata: { contentType: mime },
  });

  try {
    await env.DB.prepare(
      `INSERT INTO files (id, user_id, name, r2_key, size, mime, is_folder, parent_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`
    )
      .bind(id, user.id, file.name, r2Key, file.size, mime, parentId, now())
      .run();
  } catch (err) {
    // Evite un objet orphelin dans R2 si l'insertion en base echoue.
    await env.BUCKET.delete(r2Key).catch(() => {});
    throw err;
  }

  return json({ id, name: file.name, size: file.size, mime }, 201);
}

// Types que le navigateur pourrait executer s'ils etaient ouverts directement sur l'origine de l'API.
const ACTIVE_TYPES = /^(text\/html|application\/xhtml|image\/svg|text\/xml|application\/xml|text\/javascript|application\/javascript)/i;

function contentDisposition(disposition, name) {
  // RFC 5987 : gere les accents / espaces sans doubler l'encodage
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
  return `${disposition}; filename*=UTF-8''${encoded}`;
}

export async function downloadFile(request, env, user, fileId) {
  const row = await env.DB.prepare("SELECT * FROM files WHERE id = ? AND user_id = ?")
    .bind(fileId, user.id)
    .first();
  if (!row || row.is_folder) return errorJson("Fichier introuvable.", 404);

  // Support de Range : indispensable pour lire / se deplacer dans une video ou un son.
  const rangeHeader = request.headers.get("Range");
  let object;
  try {
    object = await env.BUCKET.get(row.r2_key, rangeHeader ? { range: request.headers } : undefined);
  } catch (_) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${row.size}` } });
  }
  if (!object) return errorJson("Fichier introuvable dans le stockage.", 404);

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("Accept-Ranges", "bytes");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Cache-Control", "private, max-age=3600");

  const type = headers.get("Content-Type") || row.mime || "";
  headers.set("Content-Disposition", contentDisposition(ACTIVE_TYPES.test(type) ? "attachment" : "inline", row.name));

  let status = 200;
  if (rangeHeader && object.range) {
    const r = object.range;
    let start, end;
    if ("suffix" in r && r.suffix !== undefined) {
      start = Math.max(0, object.size - r.suffix);
      end = object.size - 1;
    } else {
      start = r.offset ?? 0;
      end = r.length !== undefined ? start + r.length - 1 : object.size - 1;
    }
    headers.set("Content-Range", `bytes ${start}-${end}/${object.size}`);
    headers.set("Content-Length", String(end - start + 1));
    status = 206;
  } else {
    headers.set("Content-Length", String(object.size));
  }

  return new Response(object.body, { status, headers });
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
  if (!body || typeof body.name !== "string" || !body.name.trim()) return errorJson("Nom requis.", 400);

  const result = await env.DB.prepare("UPDATE files SET name = ? WHERE id = ? AND user_id = ?")
    .bind(body.name.trim().slice(0, 255), fileId, user.id)
    .run();
  if (result.meta.changes === 0) return errorJson("Introuvable.", 404);

  return json({ ok: true });
}
