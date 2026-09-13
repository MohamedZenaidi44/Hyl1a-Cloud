import { json, errorJson, newId, now, hashPassword, verifyPassword, parseCookies, sessionCookie, clearSessionCookie } from "./utils.js";

const SESSION_DAYS = 30;
const SESSION_MS = SESSION_DAYS * 24 * 60 * 60 * 1000;

export async function getUserFromRequest(request, env) {
  const cookies = parseCookies(request);
  const token = cookies["hylia_session"];
  if (!token) return null;

  const row = await env.DB.prepare(
    "SELECT sessions.user_id as user_id, sessions.expires_at as expires_at, users.username as username FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token = ?"
  )
    .bind(token)
    .first();

  if (!row) return null;
  if (row.expires_at < now()) {
    await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
    return null;
  }
  return { id: row.user_id, username: row.username };
}

export async function requireUser(request, env) {
  const user = await getUserFromRequest(request, env);
  if (!user) return null;
  return user;
}

function validUsername(username) {
  return typeof username === "string" && /^[a-zA-Z0-9_\-]{3,20}$/.test(username);
}

// handleSignup est intentionnellement non-exporte pour bloquer toute inscription publique.

// handleSetup : cree le compte admin UNE SEULE FOIS si la base est vide
export async function handleSetup(request, env, cors) {
  // Verifie qu'aucun utilisateur n'existe deja (protection one-shot)
  const count = await env.DB.prepare("SELECT COUNT(*) as n FROM users").first();
  if (count && count.n > 0) {
    return errorJson("Setup deja effectue. Compte existant.", 403);
  }

  const body = await request.json().catch(() => null);
  if (!body || !body.username || !body.password) {
    return errorJson("username et password requis.", 400);
  }
  const { username, password } = body;

  if (!validUsername(username)) {
    return errorJson("Nom d'utilisateur invalide (3-20 car, lettres/chiffres/_/-).", 400);
  }
  if (typeof password !== "string" || password.length < 6) {
    return errorJson("Mot de passe trop court (min 6 car).", 400);
  }

  const { hash, salt } = await hashPassword(password);
  const id = newId();
  await env.DB.prepare(
    "INSERT INTO users (id, username, password_hash, salt, created_at) VALUES (?, ?, ?, ?, ?)"
  )
    .bind(id, username, hash, salt, now())
    .run();

  return startSession(env, id, username, cors);
}

export async function handleLogin(request, env, cors) {
  const body = await request.json().catch(() => null);
  if (!body) return errorJson("Requete invalide", 400);
  const { username, password } = body;
  if (typeof username !== "string" || typeof password !== "string") {
    return errorJson("Identifiants invalides.", 400);
  }

  const user = await env.DB.prepare("SELECT * FROM users WHERE username = ?").bind(username).first();
  if (!user) return errorJson("Identifiants incorrects.", 401);

  const ok = await verifyPassword(password, user.salt, user.password_hash);
  if (!ok) return errorJson("Identifiants incorrects.", 401);

  return startSession(env, user.id, user.username, cors);
}

async function startSession(env, userId, username, cors) {
  const token = newId() + newId();
  const expires = now() + SESSION_MS;
  await env.DB.prepare("INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)")
    .bind(token, userId, now(), expires)
    .run();

  return json(
    { user: { id: userId, username } },
    200,
    { "Set-Cookie": sessionCookie(token, SESSION_DAYS * 24 * 60 * 60), ...cors }
  );
}

export async function handleLogout(request, env, cors) {
  const cookies = parseCookies(request);
  const token = cookies["hylia_session"];
  if (token) {
    await env.DB.prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
  }
  return json({ ok: true }, 200, { "Set-Cookie": clearSessionCookie(), ...cors });
}
