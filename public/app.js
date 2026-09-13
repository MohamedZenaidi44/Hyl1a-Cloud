// ===========================================================
// Hylia Cloud — app.js  (structure MEGA-like)
// ===========================================================
const API_BASE = "https://hylia-cloud-api.mohzn44.workers.dev";

// ============================================================
// SFX — Sons Windows 7
// ============================================================
const SFX_VOL = 0.18; // volume SFX — discret (indépendant de la musique)
const _sfxCache = {};

function sfx(name) {
  try {
    if (!_sfxCache[name]) {
      _sfxCache[name] = new Audio(`assets/sfx/${name}.wav`);
      _sfxCache[name].volume = SFX_VOL;
    }
    // Clone pour pouvoir jouer plusieurs fois en parallèle
    const clone = _sfxCache[name].cloneNode();
    clone.volume = SFX_VOL;
    clone.play().catch(() => {}); // ignore si autoplay bloqué
  } catch(_) {}
}

// Pré-charge tous les sons au démarrage
["click","notify","error","logon","logoff","ding","upload","delete","balloon","info"]
  .forEach(n => { try { new Audio(`assets/sfx/${n}.wav`).load(); } catch(_) {} });

// ---- Cache global de tous les fichiers (racine) ----
let _allFilesCache = null;

async function fetchAllFiles() {
  if (_allFilesCache) return _allFilesCache;
  const { files } = await api("/api/files");
  _allFilesCache = files;
  return files;
}
function invalidateFilesCache() { _allFilesCache = null; }

// ---- Icônes Crystal Clear par type de fichier ----
function getFileIcon(f) {
  if (f.is_folder) return "assets/icons/crystal/folder.png";
  const mime = (f.mime || "").toLowerCase();
  const name = (f.name || "").toLowerCase();
  if (mime.startsWith("image/"))       return "assets/icons/crystal/file-image.png";
  if (mime.startsWith("video/"))       return "assets/icons/crystal/folder-video.png";
  if (mime.startsWith("audio/"))       return "assets/icons/crystal/file-audio.png";
  if (mime === "application/pdf")      return "assets/icons/crystal/file-doc.png";
  if (mime.includes("zip") || mime.includes("tar") || mime.includes("rar")) return "assets/icons/crystal/zip.png";
  if (mime.includes("html") || name.endsWith(".html")) return "assets/icons/crystal/file-html.png";
  if (mime.includes("text/"))          return "assets/icons/crystal/file-text.png";
  return "assets/icons/crystal/file-generic.png";
}

// ---- Filtres MIME côté client ----
const MIME_FILTERS = {
  image: m => m.startsWith("image/"),
  video: m => m.startsWith("video/"),
  audio: m => m.startsWith("audio/"),
  doc:   m => m.includes("pdf") || m.startsWith("text/") || m.includes("msword") || m.includes("vnd.") || m.includes("zip"),
};

// ---- État global ----
const state = {
  user: null,
  currentView: "files",
  currentFolderId: null,
  folderStack: [],
  notes: [],
  activeNoteId: null,
  saveTimer: null,
  viewMode: "grid",
  contextTarget: null,
  allFiles: [],
};

// ---- Helpers API ----
async function api(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    credentials: "include",
    headers: options.body instanceof FormData ? {} : { "Content-Type": "application/json" },
    ...options,
  });
  let data = null;
  try { data = await res.json(); } catch (_) {}
  if (!res.ok) throw new Error((data && data.error) || "Erreur serveur.");
  return data;
}

function $id(id) { return document.getElementById(id); }
function show(el) { el.classList.remove("hidden"); }
function hide(el) { el.classList.add("hidden"); }
function formatSize(bytes) {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} Ko`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} Mo`;
  return `${(bytes / 1024 ** 3).toFixed(2)} Go`;
}
function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

// ---- Toast ----
function showToast(msg, type = "info") {
  sfx(type === "error" ? "error" : "notify");
  const el = document.createElement("div");
  el.className = "toast glass";
  if (type === "error") el.style.background = "rgba(200,40,40,0.55)";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2800);
}

// ============================================================
// AUTH
// ============================================================
// Signup désactivé — formulaire retiré du HTML

$id("login-form").addEventListener("submit", async e => {
  e.preventDefault();
  const errBox = $id("login-error");
  hide(errBox);
  try {
    const data = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: $id("login-username").value.trim(), password: $id("login-password").value }),
    });
    sfx("logon");
    onLoggedIn(data.user);
  } catch (err) { sfx("error"); errBox.textContent = err.message; show(errBox); }
});



$id("logout-btn").addEventListener("click", async () => {
  sfx("logoff");
  await api("/api/auth/logout", { method: "POST" }).catch(() => {});
  state.user = null;
  invalidateFilesCache();
  hide($id("desktop"));
  show($id("login-screen"));
  ambientAudio.pause();
});

function onLoggedIn(user) {
  state.user = user;
  hide($id("login-screen"));
  show($id("desktop"));
  $id("sidebar-username").textContent = user.username;
  startClock();
  switchView("files");
  startAmbientMusic();
  // Pré-charge le cache des fichiers en arrière-plan
  fetchAllFiles().then(updateStorageBar).catch(() => {});
}

async function checkSession() {
  try {
    const data = await api("/api/auth/me");
    onLoggedIn(data.user);
  } catch (_) {
    // Pas de session active — affiche le formulaire de connexion
    show($id("login-screen"));
  }
}

// ---- Horloge ----
function startClock() {
  const update = () => {
    const n = new Date();
    $id("clock").textContent = n.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
    $id("date").textContent  = n.toLocaleDateString("fr-FR", { weekday: "short", day: "numeric", month: "short" });
  };
  update();
  setInterval(update, 30000);
}

// ============================================================
// NAVIGATION PAR VUES
// ============================================================
document.querySelectorAll(".nav-item").forEach(btn => {
  btn.addEventListener("click", () => { sfx("click"); switchView(btn.dataset.view); });
});

function switchView(view) {
  state.currentView = view;

  document.querySelectorAll(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.view === view));
  document.querySelectorAll(".view-section").forEach(s => s.classList.remove("active"));
  const sec = $id("view-" + view);
  if (sec) sec.classList.add("active");

  const labels = { files: "Mes fichiers", photos: "Photos", videos: "Videos", music: "Musique", docs: "Documents", notes: "Notes", trash: "Corbeille" };
  setBreadcrumb([{ label: labels[view] || view }]);

  if (view === "files")  { state.folderStack = []; state.currentFolderId = null; loadFiles(); }
  if (view === "photos") loadFilteredFast("image", "photo-grid",  renderPhotoGrid);
  if (view === "videos") loadFilteredFast("video", "video-grid",  (g, files) => renderFileGrid(g, files));
  if (view === "music")  loadFilteredFast("audio", "music-grid",  (g, files) => renderFileGrid(g, files));
  if (view === "docs")   loadFilteredFast("doc",   "docs-grid",   (g, files) => renderFileGrid(g, files));
  if (view === "notes")  loadNotes();
}

// ---- Breadcrumb ----
function setBreadcrumb(crumbs) {
  const el = $id("main-breadcrumbs");
  el.innerHTML = "";
  crumbs.forEach((c, i) => {
    if (i > 0) {
      const sep = document.createElement("span");
      sep.className = "bc-sep";
      sep.textContent = "›";
      el.appendChild(sep);
    }
    const span = document.createElement("span");
    span.className = "bc-item" + (c.onClick ? " bc-link" : "");
    span.textContent = c.label;
    if (c.onClick) span.addEventListener("click", c.onClick);
    el.appendChild(span);
  });
}

// ============================================================
// BASCULE VUE GRILLE / LISTE
// ============================================================
$id("view-grid-btn").addEventListener("click", () => setViewMode("grid"));
$id("view-list-btn").addEventListener("click", () => setViewMode("list"));

function setViewMode(mode) {
  state.viewMode = mode;
  $id("view-grid-btn").classList.toggle("active", mode === "grid");
  $id("view-list-btn").classList.toggle("active", mode === "list");
  if (state.currentView === "files") loadFiles();
}

// ============================================================
// RECHERCHE
// ============================================================
let searchTimeout;
$id("search-input").addEventListener("input", e => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => filterFiles(e.target.value.toLowerCase()), 250);
});

function filterFiles(query) {
  if (!query) { renderFileGrid($id("file-grid"), state.allFiles); return; }
  const filtered = state.allFiles.filter(f => f.name.toLowerCase().includes(query));
  renderFileGrid($id("file-grid"), filtered);
}

// ============================================================
// FICHIERS — liste principale
// ============================================================
async function loadFiles() {
  const grid = $id("file-grid");
  grid.innerHTML = `<div style="color:rgba(255,255,255,0.4);font-size:0.78rem;padding:1rem;">Chargement…</div>`;
  try {
    const qs = state.currentFolderId ? `?parent_id=${state.currentFolderId}` : "";
    const { files } = await api(`/api/files${qs}`);
    state.allFiles = files;
    if (!state.currentFolderId) _allFilesCache = files; // met à jour le cache
    renderFileGrid(grid, files);
    updateFileSectionTitle();
  } catch (err) {
    grid.innerHTML = `<div class="empty-state"><img src="assets/icons/crystal/file-important.png" alt=""/><p>${err.message}</p></div>`;
  }
}

function updateFileSectionTitle() {
  const el = $id("files-section-title");
  if (!el) return;
  const name = state.folderStack.length ? state.folderStack[state.folderStack.length - 1].name : "Mes fichiers";
  el.innerHTML = `<img src="assets/icons/crystal/folder.png" alt="" />${escapeHtml(name)}`;
}

function buildFileBreadcrumb() {
  const crumbs = [{
    label: "Mes fichiers", onClick: () => {
      state.folderStack = []; state.currentFolderId = null;
      loadFiles(); buildFileBreadcrumb();
    }
  }];
  state.folderStack.forEach((f, i) => {
    crumbs.push({
      label: f.name, onClick: () => {
        state.folderStack = state.folderStack.slice(0, i + 1);
        state.currentFolderId = f.id;
        loadFiles(); buildFileBreadcrumb();
      }
    });
  });
  setBreadcrumb(crumbs);
}

function renderFileGrid(grid, files) {
  const isGrid = state.viewMode === "grid";
  grid.className = "file-grid " + (isGrid ? "view-grid" : "view-list");
  grid.innerHTML = "";

  if (!files || files.length === 0) {
    grid.innerHTML = `<div class="empty-state"><img src="assets/icons/crystal/folder.png" alt=""/><p>Aucun fichier ici.</p></div>`;
    return;
  }
  files.forEach(f => grid.appendChild(buildFileItem(f, isGrid)));
}

function buildFileItem(f, isGrid) {
  const item = document.createElement("div");
  item.className = "file-item" + (isGrid ? "" : " list-item");
  item.dataset.id = f.id;

  const thumb = document.createElement("div");
  thumb.className = "file-thumb";

  if (!f.is_folder && f.mime && f.mime.startsWith("image/")) {
    const img = document.createElement("img");
    img.src = `${API_BASE}/api/files/${f.id}/download`;
    img.className = "thumb-preview";
    img.loading = "lazy";
    img.alt = f.name;
    thumb.appendChild(img);
  } else {
    const img = document.createElement("img");
    img.src = getFileIcon(f);
    img.className = "thumb-icon";
    img.alt = f.is_folder ? "Dossier" : "Fichier";
    thumb.appendChild(img);
  }

  const nameEl = document.createElement("div");
  nameEl.className = "file-name";
  nameEl.textContent = f.name;

  const metaEl = document.createElement("div");
  metaEl.className = "file-meta";
  metaEl.textContent = f.is_folder ? "Dossier" : formatSize(f.size);

  const actions = document.createElement("div");
  actions.className = "file-actions";

  if (!f.is_folder) {
    const dlBtn = document.createElement("button");
    dlBtn.className = "file-action-btn";
    dlBtn.title = "Télécharger";
    dlBtn.innerHTML = `<img src="assets/icons/crystal/action-down.png" alt="" />`;
    dlBtn.addEventListener("click", e => { e.stopPropagation(); window.open(`${API_BASE}/api/files/${f.id}/download`, "_blank"); });
    actions.appendChild(dlBtn);
  }

  const delBtn = document.createElement("button");
  delBtn.className = "file-action-btn btn-del";
  delBtn.title = "Supprimer";
  delBtn.innerHTML = `<img src="assets/icons/crystal/action-delete.png" alt="" />`;
  delBtn.addEventListener("click", async e => {
    e.stopPropagation();
    if (!confirm(`Supprimer "${f.name}" ?`)) return;
    await api(`/api/files/${f.id}`, { method: "DELETE" });
    invalidateFilesCache();
    showToast(`"${f.name}" supprimé.`);
    loadFiles();
  });
  actions.appendChild(delBtn);

  if (isGrid) {
    item.append(thumb, nameEl, metaEl, actions);
  } else {
    const info = document.createElement("div");
    info.className = "file-info";
    info.append(nameEl, metaEl);
    item.append(thumb, info, actions);
  }

  item.addEventListener("click", () => {
    if (f.is_folder) {
      sfx("click");
      state.folderStack.push({ id: f.id, name: f.name });
      state.currentFolderId = f.id;
      loadFiles();
      buildFileBreadcrumb();
    } else if (f.mime && f.mime.startsWith("image/")) {
      sfx("ding");
      openLightbox(`${API_BASE}/api/files/${f.id}/download`, f.name);
    } else {
      sfx("click");
      window.open(`${API_BASE}/api/files/${f.id}/download`, "_blank");
    }
  });

  item.addEventListener("contextmenu", e => { e.preventDefault(); sfx("info"); openContextMenu(e, f); });
  return item;
}

// ============================================================
// FILTRES PAR TYPE — rapide via cache global
// ============================================================
async function loadFilteredFast(type, gridId, renderer) {
  const grid = $id(gridId);
  if (!grid) return;

  const filterFn = MIME_FILTERS[type];

  const applyFilter = (allFiles) => {
    const filtered = allFiles.filter(f => !f.is_folder && filterFn((f.mime || "").toLowerCase()));
    renderer(grid, filtered);
  };

  // Si cache dispo → affichage instantané
  if (_allFilesCache) {
    applyFilter(_allFilesCache);
    return;
  }

  // Sinon → spinner puis fetch
  grid.innerHTML = `<div style="color:rgba(255,255,255,0.4);font-size:0.78rem;padding:1rem;">Chargement…</div>`;
  try {
    const allFiles = await fetchAllFiles();
    applyFilter(allFiles);
  } catch (err) {
    grid.innerHTML = `<div class="empty-state"><img src="assets/icons/crystal/file-important.png" alt=""/><p>${err.message}</p></div>`;
  }
}

// ============================================================
// ACCÈS RAPIDE
// ============================================================
document.querySelectorAll(".quick-item").forEach(item => {
  item.addEventListener("click", () => {
    const map = { images: "photos", videos: "videos", music: "music", docs: "docs" };
    switchView(map[item.dataset.quick] || "files");
  });
});

// ============================================================
// VUE PHOTOS
// ============================================================
function renderPhotoGrid(grid, files) {
  grid.className = "photo-grid";
  grid.innerHTML = "";
  if (!files || files.length === 0) {
    grid.innerHTML = `<div class="empty-state"><img src="assets/icons/crystal/folder-image.png" alt=""/><p>Aucune photo.</p></div>`;
    return;
  }
  files.forEach(f => {
    const cell = document.createElement("div");
    cell.className = "photo-cell";
    const img = document.createElement("img");
    img.src = `${API_BASE}/api/files/${f.id}/download`;
    img.alt = f.name;
    img.loading = "lazy";
    cell.appendChild(img);
    cell.addEventListener("click", () => openLightbox(img.src, f.name));
    grid.appendChild(cell);
  });
}

// ============================================================
// UPLOAD
// ============================================================
$id("sidebar-upload-btn").addEventListener("click", () => $id("file-input").click());
$id("file-input").addEventListener("change", e => uploadFiles(e.target.files));

const dropzone = $id("dropzone");
if (dropzone) {
  dropzone.addEventListener("click", () => $id("file-input").click());
  ["dragenter", "dragover"].forEach(ev => dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.add("drag-over"); }));
  ["dragleave", "drop"].forEach(ev => dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.remove("drag-over"); }));
  dropzone.addEventListener("drop", e => uploadFiles(e.dataTransfer.files));
}

document.addEventListener("dragover", e => e.preventDefault());
document.addEventListener("drop", e => {
  e.preventDefault();
  if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
});

async function uploadFiles(fileList) {
  const files = [...fileList];
  if (!files.length) return;
  invalidateFilesCache();
  showToast(`Envoi de ${files.length} fichier${files.length > 1 ? "s" : ""}…`);
  for (const file of files) {
    const form = new FormData();
    form.append("file", file);
    if (state.currentFolderId) form.append("parent_id", state.currentFolderId);
    try {
      await api("/api/files/upload", { method: "POST", body: form });
    } catch (err) {
      showToast(`Echec : ${file.name} — ${err.message}`, "error");
    }
  }
  sfx("upload");
  showToast("Envoi termine ✓");
  if (state.currentView === "files") loadFiles();
}

// ============================================================
// NOUVEAU DOSSIER
// ============================================================
$id("new-folder-btn").addEventListener("click", () => {
  sfx("balloon");
  $id("folder-name-input").value = "";
  show($id("folder-modal"));
  setTimeout(() => $id("folder-name-input").focus(), 80);
});
$id("folder-modal-cancel").addEventListener("click", () => { sfx("click"); hide($id("folder-modal")); });
$id("folder-modal").addEventListener("click", e => { if (e.target === $id("folder-modal")) hide($id("folder-modal")); });
$id("folder-modal-confirm").addEventListener("click", async () => {
  const name = $id("folder-name-input").value.trim();
  if (!name) return;
  try {
    await api("/api/folders", { method: "POST", body: JSON.stringify({ name, parent_id: state.currentFolderId }) });
    invalidateFilesCache();
    hide($id("folder-modal"));
    showToast(`Dossier "${name}" cree.`);
    loadFiles();
  } catch (err) { showToast(err.message, "error"); }
});
$id("folder-name-input").addEventListener("keydown", e => { if (e.key === "Enter") $id("folder-modal-confirm").click(); });

// ============================================================
// LIGHTBOX
// ============================================================
function openLightbox(src, name) {
  sfx("ding");
  $id("lightbox-img").src = src;
  $id("lightbox-caption").textContent = name;
  show($id("lightbox"));
}
$id("lightbox-close").addEventListener("click", () => hide($id("lightbox")));
$id("lightbox").addEventListener("click", e => { if (e.target === $id("lightbox")) hide($id("lightbox")); });
document.addEventListener("keydown", e => {
  if (e.key === "Escape") { hide($id("lightbox")); hide($id("context-menu")); hide($id("folder-modal")); }
});

// ============================================================
// MENU CONTEXTUEL
// ============================================================
function openContextMenu(e, f) {
  state.contextTarget = f;
  const menu = $id("context-menu");
  menu.style.left = `${Math.min(e.clientX, window.innerWidth - 180)}px`;
  menu.style.top  = `${Math.min(e.clientY, window.innerHeight - 120)}px`;
  show(menu);
  $id("ctx-download").style.display = f.is_folder ? "none" : "";
}
document.addEventListener("click", () => hide($id("context-menu")));

$id("ctx-download").addEventListener("click", () => {
  const f = state.contextTarget;
  if (f) window.open(`${API_BASE}/api/files/${f.id}/download`, "_blank");
});
$id("ctx-rename").addEventListener("click", async () => {
  const f = state.contextTarget;
  if (!f) return;
  const newName = prompt("Nouveau nom :", f.name);
  if (!newName || newName.trim() === f.name) return;
  await api(`/api/files/${f.id}`, { method: "PATCH", body: JSON.stringify({ name: newName.trim() }) });
  invalidateFilesCache();
  showToast("Renomme ✓");
  loadFiles();
});
$id("ctx-delete").addEventListener("click", async () => {
  const f = state.contextTarget;
  if (!f || !confirm(`Supprimer "${f.name}" ?`)) return;
  await api(`/api/files/${f.id}`, { method: "DELETE" });
  invalidateFilesCache();
  showToast(`"${f.name}" supprime.`);
  loadFiles();
});

// ============================================================
// NOTES
// ============================================================
async function loadNotes() {
  const { notes } = await api("/api/notes");
  state.notes = notes;
  renderNotesList();
  if (notes.length > 0) selectNote(notes[0].id);
  else clearEditor();
}

function renderNotesList() {
  const list = $id("notes-list-items");
  list.innerHTML = "";
  state.notes.forEach(n => {
    const item = document.createElement("div");
    item.className = "note-list-item" + (n.id === state.activeNoteId ? " active" : "");
    item.innerHTML = `<div class="n-title">${escapeHtml(n.title || "Sans titre")}</div>
      <div class="n-preview">${escapeHtml((n.content || "").slice(0, 40))}</div>`;
    item.addEventListener("click", () => selectNote(n.id));
    list.appendChild(item);
  });
}

// ============================================================
// NOTES — éditeur enrichi (contenteditable)
// ============================================================
function getNoteBody() {
  return $id("note-content").innerHTML || "";
}
function setNoteBody(html) {
  $id("note-content").innerHTML = html || "";
  updateCounts();
}

function updateCounts() {
  const el = $id("note-content");
  if (!el) return;
  const text = el.innerText || "";
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const chars = text.replace(/\n/g, "").length;
  const counter = $id("note-counts");
  if (counter) counter.textContent = `${words} mot${words > 1 ? "s" : ""} · ${chars} caractère${chars > 1 ? "s" : ""}`;
}

function selectNote(id) {
  state.activeNoteId = id;
  const note = state.notes.find(n => n.id === id);
  if (!note) return clearEditor();
  $id("note-title").value = note.title || "";
  setNoteBody(note.content || "");
  $id("note-status").textContent = `Modifié le ${new Date(note.updated_at).toLocaleString("fr-FR")}`;
  renderNotesList();
}

function clearEditor() {
  state.activeNoteId = null;
  $id("note-title").value = "";
  setNoteBody("");
  $id("note-status").textContent = "";
}

// Nouvelle note + suppression
$id("new-note-btn").addEventListener("click", async () => {
  sfx("balloon");
  const { id } = await api("/api/notes", { method: "POST", body: JSON.stringify({ title: "Nouvelle note", content: "" }) });
  await loadNotes();
  selectNote(id);
});
$id("delete-note-btn").addEventListener("click", async () => {
  if (!state.activeNoteId || !confirm("Supprimer cette note ?")) return;
  sfx("delete");
  await api(`/api/notes/${state.activeNoteId}`, { method: "DELETE" });
  await loadNotes();
});

$id("save-note-btn").addEventListener("click", async () => {
  if (!state.activeNoteId) return;
  sfx("notify");
  await saveActiveNote();
  // Feedback visuel bref sur le bouton
  const btn = $id("save-note-btn");
  btn.textContent = "✓ Sauvegardé !";
  setTimeout(() => { btn.textContent = "✓ Sauvegarder"; }, 1500);
});

// Auto-save
function scheduleSave() {
  clearTimeout(state.saveTimer);
  $id("note-status").textContent = "Enregistrement…";
  updateCounts();
  state.saveTimer = setTimeout(saveActiveNote, 700);
}
async function saveActiveNote() {
  if (!state.activeNoteId) return;
  const title   = $id("note-title").value;
  const content = getNoteBody();
  await api(`/api/notes/${state.activeNoteId}`, { method: "PATCH", body: JSON.stringify({ title, content }) });
  $id("note-status").textContent = `Sauvegardé à ${new Date().toLocaleTimeString("fr-FR", {hour:"2-digit",minute:"2-digit"})}`;
  const note = state.notes.find(n => n.id === state.activeNoteId);
  if (note) { note.title = title; note.content = content; }
  renderNotesList();
}

$id("note-title").addEventListener("input", scheduleSave);
$id("note-content").addEventListener("input", scheduleSave);

// Barre d'outils — commandes de formatage
document.querySelectorAll(".tb-btn").forEach(btn => {
  btn.addEventListener("mousedown", e => {
    e.preventDefault(); // garde le focus dans l'éditeur
    const cmd = btn.dataset.cmd;
    const editor = $id("note-content");
    editor.focus();
    switch (cmd) {
      case "bold":      document.execCommand("bold");           break;
      case "italic":    document.execCommand("italic");         break;
      case "underline": document.execCommand("underline");      break;
      case "strike":    document.execCommand("strikeThrough");  break;
      case "h1":        document.execCommand("formatBlock", false, "h2"); break;
      case "h2":        document.execCommand("formatBlock", false, "h3"); break;
      case "ul":        document.execCommand("insertUnorderedList"); break;
      case "ol":        document.execCommand("insertOrderedList");   break;
      case "code":      document.execCommand("formatBlock", false, "pre"); break;
      case "hr":        document.execCommand("insertHorizontalRule"); break;
      case "clear":     document.execCommand("removeFormat");   break;
    }
    scheduleSave();
  });
});

// Raccourcis clavier dans l'éditeur
$id("note-content").addEventListener("keydown", e => {
  if ((e.ctrlKey || e.metaKey) && e.key === "s") {
    e.preventDefault();
    saveActiveNote();
  }
});

// ============================================================
// STOCKAGE
// ============================================================
async function updateStorageBar() {
  try {
    const files = _allFilesCache || (await fetchAllFiles());
    const total = files.reduce((s, f) => s + (f.size || 0), 0);
    const QUOTA = 5 * 1024 ** 3;
    const pct = Math.min((total / QUOTA) * 100, 100);
    $id("storage-bar").style.width = pct + "%";
    $id("storage-text").textContent = `${formatSize(total)} sur ${formatSize(QUOTA)}`;
  } catch (_) {
    $id("storage-text").textContent = "Indisponible";
  }
}

// ============================================================
// MUSIQUE D'AMBIANCE
// ============================================================
const ambientAudio = new Audio("assets/ambient.mp3");
ambientAudio.loop   = true;
ambientAudio.volume = 0.28; // 28% — fond musical agréable

let musicStarted = false;

function startAmbientMusic() {
  if (musicStarted) return;
  musicStarted = true;
  ambientAudio.play().catch(() => {
    // Autoplay bloque par le navigateur — on attend le premier clic utilisateur
    const resume = () => { ambientAudio.play(); document.removeEventListener("click", resume); };
    document.addEventListener("click", resume);
  });
}

// Bouton play/pause
const musicBtn    = $id("music-toggle-btn");
const musicSlider = $id("music-volume-slider");
const musicIcon   = $id("music-icon");

if (musicBtn) {
  musicBtn.addEventListener("click", e => {
    e.stopPropagation();
    if (ambientAudio.paused) {
      ambientAudio.play();
      musicBtn.classList.remove("muted");
      if (musicIcon) musicIcon.textContent = ambientAudio.volume < 0.4 ? "🎵" : "🎶";
    } else {
      ambientAudio.pause();
      musicBtn.classList.add("muted");
      if (musicIcon) musicIcon.textContent = "🔇";
    }
  });
}

// Slider de volume
if (musicSlider) {
  musicSlider.value = String(ambientAudio.volume);
  musicSlider.addEventListener("input", e => {
    e.stopPropagation();
    const vol = parseFloat(musicSlider.value);
    ambientAudio.volume = vol;
    if (musicIcon) {
      musicIcon.textContent = vol === 0 ? "🔇" : vol < 0.4 ? "🎵" : "🎶";
    }
    if (vol > 0 && ambientAudio.paused) {
      ambientAudio.play();
      if (musicBtn) musicBtn.classList.remove("muted");
    }
  });
}

// ============================================================
// PANNEAU DÉTAILS
// ============================================================
$id("detail-close").addEventListener("click", () => hide($id("detail-panel")));

// ============================================================
// INIT
// ============================================================
checkSession();
