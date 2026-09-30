// ===========================================================
// Hyl1a Cloud — app.js
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

// ---- Cache global de tous les fichiers (TOUS dossiers confondus) ----
// Sert aux vues Photos / Vidéos / Musique / Documents et au calcul du stockage.
// (avant : on utilisait /api/files sans filtre = uniquement la racine)
let _allFilesCache = null;
let _allFilesPromise = null;
let _filesGen = 0;

function invalidateFilesCache() {
  _allFilesCache = null;
  _allFilesPromise = null;
  _filesGen++;
}

function fetchAllFiles() {
  if (_allFilesCache) return Promise.resolve(_allFilesCache);
  if (!_allFilesPromise) {
    const gen = _filesGen;
    _allFilesPromise = api("/api/files?type=all")
      .then(({ files }) => {
        if (gen === _filesGen) _allFilesCache = files;
        return files;
      })
      .catch(err => {
        if (gen === _filesGen) _allFilesPromise = null;
        throw err;
      });
  }
  return _allFilesPromise;
}

// ---- Icônes locales par type de fichier ----
function iconData(kind) {
  const paths = {
    folder: '<path d="M3 7.5A1.5 1.5 0 0 1 4.5 6H9l2 2h8.5A1.5 1.5 0 0 1 21 9.5v7A1.5 1.5 0 0 1 19.5 18h-15A1.5 1.5 0 0 1 3 16.5z" fill="none" stroke="#777" stroke-width="1.7" stroke-linejoin="round"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2" fill="none" stroke="#777" stroke-width="1.7"/><circle cx="8" cy="9" r="1.5" fill="#777"/><path d="m4 17 5-5 3.5 3 2.5-2.5 5 4" fill="none" stroke="#777" stroke-width="1.7" stroke-linejoin="round"/>',
    video: '<rect x="3" y="5" width="14" height="14" rx="2" fill="none" stroke="#777" stroke-width="1.7"/><path d="m17 10 4-2v8l-4-2z" fill="none" stroke="#777" stroke-width="1.7" stroke-linejoin="round"/>',
    audio: '<path d="M9 18V6l10-2v12" fill="none" stroke="#777" stroke-width="1.7" stroke-linecap="round"/><circle cx="6" cy="18" r="3" fill="none" stroke="#777" stroke-width="1.7"/><circle cx="16" cy="16" r="3" fill="none" stroke="#777" stroke-width="1.7"/>',
    doc: '<path d="M6 3h8l4 4v14H6z" fill="none" stroke="#777" stroke-width="1.7" stroke-linejoin="round"/><path d="M14 3v5h4M9 12h6M9 15h6" fill="none" stroke="#777" stroke-width="1.5" stroke-linecap="round"/>',
    archive: '<path d="M5 5h14v14H5zM8 8h8M9 12h6M10 16h4" fill="none" stroke="#777" stroke-width="1.7" stroke-linecap="round"/>',
    generic: '<path d="M6 3h8l4 4v14H6z" fill="none" stroke="#777" stroke-width="1.7"/><path d="M14 3v5h4" fill="none" stroke="#777" stroke-width="1.7"/>',
  };
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${paths[kind] || paths.generic}</svg>`)}`;
}

// Type d'un fichier, d'après son MIME puis (si le MIME est vide / générique) son extension.
const KIND_BY_EXT = [
  ["image",   /\.(jpe?g|png|gif|webp|avif|bmp|svg|heic|heif|ico)$/i],
  ["video",   /\.(mp4|webm|mov|m4v|avi|mkv|ogv|3gp)$/i],
  ["audio",   /\.(mp3|wav|oga|ogg|flac|m4a|aac|opus|wma)$/i],
  ["archive", /\.(zip|rar|7z|tar|gz|tgz|bz2|xz)$/i],
  ["doc",     /\.(pdf|txt|md|rtf|docx?|xlsx?|pptx?|odt|ods|odp|csv|json)$/i],
];

function fileKind(f) {
  if (f.is_folder) return "folder";
  const mime = (f.mime || "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  if (mime === "application/pdf" || mime.startsWith("text/") || mime.includes("word") ||
      mime.includes("document") || mime.includes("vnd.")) return "doc";
  if (mime.includes("zip") || mime.includes("tar") || mime.includes("rar")) return "archive";
  const name = f.name || "";
  for (const [kind, re] of KIND_BY_EXT) if (re.test(name)) return kind;
  return "other";
}

function getFileIcon(f) {
  const kind = fileKind(f);
  return iconData(kind === "other" ? "generic" : kind);
}

// ============================================================
// HEIC / HEIF (photos iPhone)
// Chrome et Firefox ne savent pas afficher ce format : on convertit en JPEG dans le
// navigateur (librairie chargée seulement à la 1re photo HEIC). Le fichier stocké reste
// l'original, et « Télécharger » renvoie toujours l'original.
// ============================================================
const HEIC_RE = /\.(heic|heif)$/i;

function isHeicFile(f) {
  return !f.is_folder && (HEIC_RE.test(f.name || "") || /^image\/hei[cf]/i.test(f.mime || ""));
}

let _heicLibPromise = null;
function loadHeicLib() {
  if (window.HeicTo) return Promise.resolve(window.HeicTo);
  if (!_heicLibPromise) {
    _heicLibPromise = new Promise((resolve, reject) => {
      const sc = document.createElement("script");
      sc.src = "vendor/heic-to.js";
      sc.onload = () => window.HeicTo ? resolve(window.HeicTo) : reject(new Error("Convertisseur HEIC invalide."));
      sc.onerror = () => { _heicLibPromise = null; reject(new Error("Convertisseur HEIC introuvable.")); };
      document.head.appendChild(sc);
    });
  }
  return _heicLibPromise;
}

// Conversions en file (2 à la fois) : décoder du HEIC est lourd
const _heicQueue = [];
let _heicActive = 0;
function heicRun(task) {
  return new Promise((resolve, reject) => {
    _heicQueue.push({ task, resolve, reject });
    heicPump();
  });
}
function heicPump() {
  while (_heicActive < 2 && _heicQueue.length) {
    const job = _heicQueue.shift();
    _heicActive++;
    job.task().then(job.resolve, job.reject).finally(() => { _heicActive--; heicPump(); });
  }
}

async function heicToJpegBlob(f) {
  const lib = await loadHeicLib();
  const res = await fetch(`${API_BASE}/api/files/${encodeURIComponent(f.id)}/download`, { credentials: "include" });
  if (!res.ok) throw new Error("Téléchargement impossible.");
  const src = await res.blob();
  try {
    // Dans le build "iife" de heic-to, window.HeicTo EST la fonction de conversion (avec .isHeic dessus)
    const convert = typeof lib === "function" ? lib : lib.heicTo;
    return await convert({ blob: src, type: "image/jpeg", quality: 0.85 });
  } catch (_) {
    throw new Error(`Impossible de convertir « ${f.name} ».`);
  }
}

// Miniature (640 px max) : gardée en mémoire pour toute la session
const _heicThumbs = new Map();   // id -> Promise<objectURL>
function heicThumbUrl(f) {
  if (!_heicThumbs.has(f.id)) {
    const p = heicRun(async () => {
      const blob = await heicToJpegBlob(f);
      const bmp = await createImageBitmap(blob);
      const scale = Math.min(1, 640 / Math.max(bmp.width, bmp.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bmp.width * scale));
      canvas.height = Math.max(1, Math.round(bmp.height * scale));
      canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
      if (bmp.close) bmp.close();
      const thumb = await new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error("canvas")), "image/jpeg", 0.8));
      return URL.createObjectURL(thumb);
    });
    p.catch(() => _heicThumbs.delete(f.id));
    _heicThumbs.set(f.id, p);
  }
  return _heicThumbs.get(f.id);
}

// Pleine taille (visionneuse) : on ne garde que les 3 dernières (mémoire)
const _heicFull = new Map();     // id -> Promise<objectURL>
function heicFullUrl(f) {
  if (!_heicFull.has(f.id)) {
    const p = heicRun(async () => URL.createObjectURL(await heicToJpegBlob(f)));
    p.catch(() => _heicFull.delete(f.id));
    _heicFull.set(f.id, p);
    if (_heicFull.size > 3) {
      const oldest = _heicFull.keys().next().value;
      _heicFull.get(oldest).then(u => URL.revokeObjectURL(u)).catch(() => {});
      _heicFull.delete(oldest);
    }
  }
  return _heicFull.get(f.id);
}

function clearHeicCaches() {
  [_heicThumbs, _heicFull].forEach(m => {
    m.forEach(p => p.then(u => URL.revokeObjectURL(u)).catch(() => {}));
    m.clear();
  });
}

// Affiche une image HEIC dans un <img> dès qu'elle devient visible
function attachHeicThumb(img, f, anchor) {
  img.src = iconData("image");               // en attendant la conversion
  const observer = new IntersectionObserver(entries => {
    if (!entries.some(e => e.isIntersecting)) return;
    observer.disconnect();
    heicThumbUrl(f)
      .then(url => { img.src = url; img.classList.add("loaded"); })
      .catch(() => { img.title = "Aperçu HEIC indisponible"; });
  }, { rootMargin: "240px" });
  observer.observe(anchor || img);
}

// Miniatures vidéo : génération locale, uniquement quand la carte devient visible.
const videoThumbQueue = [];
let activeVideoThumbs = 0;
const VIDEO_THUMB_CONCURRENCY = 3;

function queueVideoThumbnail(file, target) {
  videoThumbQueue.push({ file, target });
  processVideoThumbQueue();
}

function processVideoThumbQueue() {
  while (activeVideoThumbs < VIDEO_THUMB_CONCURRENCY && videoThumbQueue.length) {
    const job = videoThumbQueue.shift();
    activeVideoThumbs++;
    createVideoThumbnail(job.file, job.target)
      .catch(() => {})
      .finally(() => {
        activeVideoThumbs--;
        processVideoThumbQueue();
      });
  }
}

function createVideoThumbnail(file, target) {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    // crossOrigin DOIT être posé AVANT src, sinon la requête part sans CORS
    // et le canvas est "tainted" (toDataURL lève une SecurityError).
    video.crossOrigin = "use-credentials";
    video.src = `${API_BASE}/api/files/${file.id}/download`;

    let done = false;
    const finish = (err) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.removeAttribute("src");
      video.load();
      err ? reject(err) : resolve();
    };
    // Sans ça, une vidéo qui ne déclenche jamais d'événement bloquerait la file (3 slots).
    const timer = setTimeout(() => finish(new Error("timeout")), 15000);

    video.addEventListener("loadedmetadata", () => {
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      video.currentTime = duration > 1 ? Math.min(1, duration * 0.15) : 0;
    }, { once: true });

    video.addEventListener("seeked", () => {
      try {
        const canvas = document.createElement("canvas");
        const maxW = 640;
        const scale = Math.min(1, maxW / (video.videoWidth || maxW));
        canvas.width = Math.max(1, Math.round((video.videoWidth || 640) * scale));
        canvas.height = Math.max(1, Math.round((video.videoHeight || 360) * scale));
        canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
        target.src = canvas.toDataURL("image/jpeg", 0.72);
        target.classList.add("loaded");
        finish();
      } catch (e) {
        finish(e);
      }
    }, { once: true });

    video.addEventListener("error", () => finish(new Error("thumbnail")), { once: true });
  });
}


// ---- Filtres par type (côté client) ----
// Basés sur fileKind() : un .mkv / .flac envoyé avec un MIME vide est bien classé.
const MIME_FILTERS = {
  image: f => fileKind(f) === "image",
  video: f => fileKind(f) === "video",
  audio: f => fileKind(f) === "audio",
  doc:   f => { const k = fileKind(f); return k === "doc" || k === "archive"; },
};

// ---- État global ----
let suppressHistory = false;

// Données affichées dans la grille courante (sert à la recherche et au changement grille/liste)
let _viewData = null;   // { files, render(list, query) }
// Numéro de la dernière demande de chargement : ignore les réponses périmées
let _viewSeq = 0;

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
};

// ---- Helpers API ----
async function api(path, options = {}) {
  const isForm = options.body instanceof FormData;
  const headers = { ...(options.body && !isForm ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) };

  let res;
  try {
    res = await fetch(API_BASE + path, { credentials: "include", ...options, headers });
  } catch (_) {
    throw new Error("Impossible de joindre le serveur.");
  }

  let data = null;
  try { data = await res.json(); } catch (_) {}

  if (!res.ok) {
    // Session expirée en cours d'utilisation -> retour à l'écran de connexion
    if (res.status === 401 && state.user && !path.startsWith("/api/auth/")) {
      resetToLogin("Session expirée, reconnecte-toi.");
    }
    throw new Error((data && data.error) || "Erreur serveur.");
  }

  return data;
}

async function downloadFile(f) {
  try {
    const res = await fetch(
      `${API_BASE}/api/files/${f.id}/download`,
      {
        method: "GET",
        credentials: "include",
      }
    );

    if (!res.ok) {
      let message = "Erreur lors du téléchargement.";

      try {
        const data = await res.json();
        if (data?.error) message = data.error;
      } catch (_) {}

      throw new Error(message);
    }

    const blob = await res.blob();
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = f.name;

    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);

  } catch (err) {
    showToast(
      err.message || "Erreur lors du téléchargement.",
      "error"
    );
  }
}


function $id(id) { return document.getElementById(id); }
function show(el) { el.classList.remove("hidden"); }
function hide(el) { el.classList.add("hidden"); }

function formatSize(bytes) {
  if (bytes == null) return "";
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
// NAVIGATION NAVIGATEUR — retour / suivant
// ============================================================
window.addEventListener("popstate", event => {
  const data = event.state;
  if (!data || !state.user) return;

  suppressHistory = true;
  state.folderStack = Array.isArray(data.folderStack) ? data.folderStack : [];
  state.currentFolderId = data.currentFolderId || null;
  switchView(data.view || "files", { fromHistory: true, preserveFolder: data.view === "files" });
  if (data.view === "files") buildFileBreadcrumb();
  suppressHistory = false;
});

// ============================================================
// AUTH
// ============================================================

// Signup désactivé — formulaire retiré du HTML
$id("login-form").addEventListener("submit", async e => {
  e.preventDefault();
  const errBox = $id("login-error");
  const btn = $id("login-submit-btn");
  hide(errBox);
  btn.disabled = true;

  try {
    const data = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        username: $id("login-username").value.trim(),
        password: $id("login-password").value
      }),
    });

    sfx("logon");
    onLoggedIn(data.user);

  } catch (err) {
    sfx("error");
    errBox.textContent = err.message;
    show(errBox);
  } finally {
    btn.disabled = false;
  }
});

$id("logout-btn").addEventListener("click", async () => {
  sfx("logoff");
  await api("/api/auth/logout", { method: "POST" }).catch(() => {});
  resetToLogin();
});

// Remet toute l'interface à zéro (déconnexion ou session expirée)
function resetToLogin(message) {
  clearTimeout(state.saveTimer);
  state.user = null;
  state.folderStack = [];
  state.currentFolderId = null;
  state.notes = [];
  state.activeNoteId = null;
  _viewData = null;
  _viewSeq++;
  invalidateFilesCache();

  ["file-grid", "photo-grid", "video-grid", "music-grid", "docs-grid", "notes-list-items"]
    .forEach(id => { const el = $id(id); if (el) el.innerHTML = ""; });
  clearEditor();
  closeLightbox();
  clearHeicCaches();

  hide($id("desktop"));
  show($id("login-screen"));
  $id("login-password").value = "";

  const box = $id("login-error");
  if (message) { box.textContent = message; show(box); } else { hide(box); }

  try { ambientAudio.pause(); } catch (_) {}
  musicStarted = false;
}

function onLoggedIn(user) {
  state.user = user;

  hide($id("login-screen"));
  show($id("desktop"));

  $id("sidebar-username").textContent = user.username;

  startClock();
  history.replaceState({ view: "files", currentFolderId: null, folderStack: [] }, "", location.href);
  switchView("files", { fromHistory: true });

  // Pré-charge le cache des fichiers en arrière-plan
  updateStorageBar();
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
let _clockTimer = null;
function startClock() {
  const update = () => {
    const n = new Date();

    $id("clock").textContent =
      n.toLocaleTimeString("fr-FR", {
        hour: "2-digit",
        minute: "2-digit"
      });

    $id("date").textContent =
      n.toLocaleDateString("fr-FR", {
        weekday: "short",
        day: "numeric",
        month: "short"
      });
  };

  update();
  clearInterval(_clockTimer);
  _clockTimer = setInterval(update, 30000);
}

// ============================================================
// NAVIGATION PAR VUES
// ============================================================

document.querySelectorAll(".nav-item").forEach(btn => {
  btn.addEventListener("click", () => {
    sfx("click");
    switchView(btn.dataset.view);
  });
});

const VIEW_LABELS = {
  files: "Mes fichiers",
  photos: "Mes photos",
  videos: "Mes vidéos",
  music: "Ma musique",
  docs: "Mes documents",
  notes: "Mes notes",
  trash: "Ma corbeille"
};

// Vues "à plat" filtrées par type (tous dossiers confondus)
const FILTER_VIEWS = {
  photos: { type: "image", grid: "photo-grid", empty: "Aucune photo.",    render: (g, f, msg) => renderPhotoGrid(g, f, msg) },
  videos: { type: "video", grid: "video-grid", empty: "Aucune vidéo.",    render: (g, f, msg) => renderFileGrid(g, f, msg) },
  music:  { type: "audio", grid: "music-grid", empty: "Aucun morceau.",   render: (g, f, msg) => renderFileGrid(g, f, msg) },
  docs:   { type: "doc",   grid: "docs-grid",  empty: "Aucun document.",  render: (g, f, msg) => renderFileGrid(g, f, msg) },
};

// Empile l'état de navigation courant dans l'historique du navigateur
function scrollToTop(smooth = false) {
  try { window.scrollTo({ top: 0, behavior: smooth ? "smooth" : "auto" }); } catch (_) {}
}

function pushNavState() {
  if (suppressHistory) return;
  history.pushState({
    view: state.currentView,
    currentFolderId: state.currentFolderId,
    folderStack: state.folderStack.map(f => ({ id: f.id, name: f.name }))
  }, "", location.href);
}

function switchView(view, options = {}) {
  // Ne perd pas une note en cours de frappe quand on quitte l'éditeur
  if (state.currentView === "notes" && view !== "notes") flushNoteSave();

  state.currentView = view;

  // Le dossier doit être remis à la racine AVANT de pousser l'historique
  // (avant : l'entrée d'historique gardait l'ancien dossier).
  if (view === "files" && !options.preserveFolder) {
    state.folderStack = [];
    state.currentFolderId = null;
  }

  if (!suppressHistory && !options.fromHistory) pushNavState();

  document.querySelectorAll(".nav-item")
    .forEach(b => b.classList.toggle("active", b.dataset.view === view));

  document.querySelectorAll(".view-section")
    .forEach(s => s.classList.remove("active"));

  const sec = $id("view-" + view);
  if (sec) sec.classList.add("active");

  setBreadcrumb([{ label: VIEW_LABELS[view] || view }]);

  clearSearch();
  scrollToTop();
  loadViewContent(view);
}

// Charge (ou recharge) le contenu de la vue donnée
function loadViewContent(view) {
  _viewData = null;

  if (view === "files") {
    loadFiles();
    buildFileBreadcrumb();
  } else if (FILTER_VIEWS[view]) {
    loadFilteredView(view);
  } else {
    _viewSeq++; // annule tout chargement en cours
    if (view === "notes") loadNotes();
  }
}

// Recharge la vue affichée (après envoi, suppression, renommage...)
function refreshCurrentView() {
  const v = state.currentView;
  if (v === "files" || FILTER_VIEWS[v]) loadViewContent(v);
}

// Après toute modification de fichiers : cache, vue courante et jauge de stockage
function afterMutation() {
  invalidateFilesCache();
  refreshCurrentView();
  updateStorageBar();
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

    if (c.onClick)
      span.addEventListener("click", c.onClick);

    el.appendChild(span);
  });
}

// ============================================================
// BASCULE VUE GRILLE / LISTE
// ============================================================

$id("view-grid-btn")
  .addEventListener("click", () => setViewMode("grid"));

$id("view-list-btn")
  .addEventListener("click", () => setViewMode("list"));

function setViewMode(mode) {
  state.viewMode = mode;

  $id("view-grid-btn")
    .classList.toggle("active", mode === "grid");

  $id("view-list-btn")
    .classList.toggle("active", mode === "list");

  // Re-rend simplement la liste déjà en mémoire (marche dans toutes les vues)
  applySearch();
}

// ============================================================
// RECHERCHE — filtre la liste actuellement affichée (dossier ou vue filtrée)
// ============================================================

let searchTimeout;

$id("search-input").addEventListener("input", () => {
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(applySearch, 200);
});

function clearSearch() {
  clearTimeout(searchTimeout);
  $id("search-input").value = "";
}

function setViewData(files, render) {
  _viewData = { files, render };
  applySearch();
}

function applySearch() {
  if (!_viewData) return;

  const q = $id("search-input").value.trim().toLowerCase();
  const list = q
    ? _viewData.files.filter(f => (f.name || "").toLowerCase().includes(q))
    : _viewData.files;

  _viewData.render(list, q);
}

// ============================================================
// FICHIERS — liste principale
// ============================================================

const LOADING_HTML =
  `<div style="color:rgba(255,255,255,0.4);font-size:0.78rem;padding:1rem;">Chargement…</div>`;

function errorHtml(err) {
  return `<div class="empty-state"><p>${escapeHtml(err.message || "Erreur.")}</p></div>`;
}

async function loadFiles() {
  const grid = $id("file-grid");
  const seq = ++_viewSeq;

  grid.innerHTML = LOADING_HTML;

  try {
    const qs = state.currentFolderId
      ? `?parent_id=${encodeURIComponent(state.currentFolderId)}`
      : "";

    const { files } = await api(`/api/files${qs}`);
    if (seq !== _viewSeq) return; // l'utilisateur a navigué ailleurs entre-temps

    // NB : on ne touche plus au cache global ici. Avant, le contenu du dossier
    // courant écrasait le cache "tous les fichiers" (=> vues Photos/Vidéos fausses).
    setViewData(files, (list, q) =>
      renderFileGrid(grid, list, q ? "Aucun résultat." : "Aucun fichier ici."));
    updateFileSectionTitle();

  } catch (err) {
    if (seq === _viewSeq) grid.innerHTML = errorHtml(err);
  }
}

function updateFileSectionTitle() {
  // On met à jour le libellé seulement (textContent sur le conteneur effaçait l'icône)
  const el = $id("files-section-label") || $id("files-section-title");
  if (!el) return;

  el.textContent =
    state.folderStack.length
      ? state.folderStack[state.folderStack.length - 1].name
      : "Mes fichiers";
}

function buildFileBreadcrumb() {
  const crumbs = [{
    label: "Mes fichiers",
    onClick: () => goToFolderDepth(0)
  }];

  state.folderStack.forEach((f, i) => {
    crumbs.push({
      label: f.name,
      onClick: () => goToFolderDepth(i + 1)
    });
  });

  setBreadcrumb(crumbs);
}

function goToFolderDepth(depth) {
  if (depth === state.folderStack.length) return;

  state.folderStack = state.folderStack.slice(0, depth);
  state.currentFolderId = depth ? state.folderStack[depth - 1].id : null;

  clearSearch();
  scrollToTop();
  pushNavState();
  loadFiles();
  buildFileBreadcrumb();
}

function enterFolder(f) {
  sfx("click");

  state.folderStack.push({ id: f.id, name: f.name });
  state.currentFolderId = f.id;

  clearSearch();
  scrollToTop();
  pushNavState();
  loadFiles();
  buildFileBreadcrumb();
}

function renderFileGrid(grid, files, emptyMsg = "Aucun fichier ici.") {
  const isGrid = state.viewMode === "grid";

  grid.className =
    "file-grid " + (isGrid ? "view-grid" : "view-list");

  grid.innerHTML = "";

  if (!files || files.length === 0) {
    grid.innerHTML =
      `<div class="empty-state"><p>${escapeHtml(emptyMsg)}</p></div>`;
    return;
  }

  files.forEach(f =>
    grid.appendChild(buildFileItem(f, isGrid))
  );
}

// ---- Actions communes (bouton ×, menu contextuel) ----
async function deleteEntry(f) {
  const msg = f.is_folder
    ? `Supprimer le dossier "${f.name}" et tout son contenu ?`
    : `Supprimer "${f.name}" ?`;

  if (!confirm(msg)) return;

  try {
    await api(`/api/files/${f.id}`, { method: "DELETE" });
    showToast(`"${f.name}" supprimé.`);
    afterMutation(); // recharge la vue COURANTE (avant : toujours la vue Fichiers)
  } catch (err) {
    showToast(err.message, "error");
  }
}

async function renameEntry(f) {
  const newName = prompt("Nouveau nom :", f.name);

  if (!newName || !newName.trim() || newName.trim() === f.name) return;

  try {
    await api(`/api/files/${f.id}`, {
      method: "PATCH",
      body: JSON.stringify({ name: newName.trim() })
    });
    showToast("Renommé ✓");
    afterMutation();
  } catch (err) {
    showToast(err.message, "error");
  }
}

function openFile(f) {
  if (f.is_folder) {
    if (state.currentView === "files") enterFolder(f);
    return;
  }

  const kind = fileKind(f);

  if (kind === "image" || kind === "video" || kind === "audio") {
    openViewer(f);          // lecture directe (avant : vidéos/sons étaient téléchargés)
  } else {
    sfx("click");
    downloadFile(f);
  }
}

function buildFileItem(f, isGrid) {
  const item = document.createElement("div");

  item.className =
    "file-item" + (isGrid ? "" : " list-item");

  item.dataset.id = f.id;

  const kind = fileKind(f);

  const thumb = document.createElement("div");
  thumb.className = "file-thumb";

  if (kind === "image") {
    const img = document.createElement("img");
    img.className = "thumb-preview";
    img.decoding = "async";
    img.alt = f.name;
    if (isHeicFile(f)) {
      attachHeicThumb(img, f, item);
    } else {
      img.src = `${API_BASE}/api/files/${f.id}/download`;
      img.loading = "lazy";
    }
    thumb.appendChild(img);
  } else if (kind === "video") {
    const img = document.createElement("img");
    img.className = "thumb-preview video-thumb";
    img.alt = f.name;
    img.src = iconData("video");
    thumb.appendChild(img);
    const observe = new IntersectionObserver(entries => {
      if (entries.some(e => e.isIntersecting)) {
        observe.disconnect();
        queueVideoThumbnail(f, img);
      }
    }, { rootMargin: "240px" });
    observe.observe(item);
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
  metaEl.textContent =
    f.is_folder ? "Dossier" : formatSize(f.size);

  const actions = document.createElement("div");
  actions.className = "file-actions";

  if (!f.is_folder) {
    const dlBtn = document.createElement("button");

    dlBtn.className = "file-action-btn";
    dlBtn.title = "Télécharger";
    dlBtn.innerHTML = `↓`;

    dlBtn.addEventListener("click", e => {
      e.stopPropagation();
      downloadFile(f);
    });

    actions.appendChild(dlBtn);
  }

  const delBtn = document.createElement("button");

  delBtn.className = "file-action-btn btn-del";
  delBtn.title = "Supprimer";
  delBtn.innerHTML = `×`;

  delBtn.addEventListener("click", e => {
    e.stopPropagation();
    deleteEntry(f);
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

  item.addEventListener("click", () => openFile(f));

  item.addEventListener("contextmenu", e => {
    e.preventDefault();
    sfx("info");
    openContextMenu(e, f);
  });

  return item;
}

// ============================================================
// FILTRES PAR TYPE — via le cache global (tous dossiers confondus)
// ============================================================

async function loadFilteredView(view) {
  const cfg = FILTER_VIEWS[view];
  const grid = cfg && $id(cfg.grid);

  if (!grid) return;

  const seq = ++_viewSeq;
  const filterFn = MIME_FILTERS[cfg.type];

  const display = allFiles => {
    const files = allFiles.filter(f => !f.is_folder && filterFn(f));

    setViewData(files, (list, q) =>
      cfg.render(grid, list, q ? "Aucun résultat." : cfg.empty));
  };

  if (_allFilesCache) {
    display(_allFilesCache);
    return;
  }

  grid.innerHTML = LOADING_HTML;

  try {
    const allFiles = await fetchAllFiles();
    if (seq !== _viewSeq) return;
    display(allFiles);

  } catch (err) {
    if (seq === _viewSeq) grid.innerHTML = errorHtml(err);
  }
}

// ============================================================
// ACCÈS RAPIDE
// ============================================================

document.querySelectorAll(".quick-item").forEach(item => {
  item.addEventListener("click", () => {
    const map = {
      images: "photos",
      videos: "videos",
      music: "music",
      docs: "docs"
    };

    switchView(
      map[item.dataset.quick] || "files"
    );
  });
});

// ============================================================
// VUE PHOTOS
// ============================================================

function renderPhotoGrid(grid, files, emptyMsg = "Aucune photo.") {
  grid.className = "photo-grid";
  grid.innerHTML = "";

  if (!files || files.length === 0) {
    grid.innerHTML =
      `<div class="empty-state"><p>${escapeHtml(emptyMsg)}</p></div>`;
    return;
  }

  files.forEach(f => {
    const cell = document.createElement("div");
    cell.className = "photo-cell";

    const img = document.createElement("img");

    img.alt = f.name;
    img.decoding = "async";

    if (isHeicFile(f)) {
      attachHeicThumb(img, f, cell);
    } else {
      img.src = `${API_BASE}/api/files/${f.id}/download`;
      img.loading = "lazy";
    }

    cell.appendChild(img);

    // openViewer gère aussi le HEIC (avant : on ouvrait img.src directement)
    cell.addEventListener("click", () => openViewer(f));

    grid.appendChild(cell);
  });
}

// ============================================================
// UPLOAD
// ============================================================

const MAX_UPLOAD = 100 * 1024 * 1024; // limite du Worker (corps de requête)

$id("sidebar-upload-btn")
  .addEventListener("click", () => $id("file-input").click());

$id("top-upload-btn")?.addEventListener("click", () => $id("file-input").click());

$id("file-input")
  .addEventListener("change", e => {
    const files = [...e.target.files];
    // Remise à zéro : sinon renvoyer le même fichier ne déclenche plus "change"
    e.target.value = "";
    uploadFiles(files);
  });

const dropzone = $id("dropzone");

if (dropzone) {
  dropzone.addEventListener("click", () => $id("file-input").click());

  ["dragenter", "dragover"].forEach(ev =>
    dropzone.addEventListener(ev, e => {
      e.preventDefault();
      dropzone.classList.add("drag-over");
    })
  );

  dropzone.addEventListener("dragleave", e => {
    e.preventDefault();
    dropzone.classList.remove("drag-over");
  });

  dropzone.addEventListener("drop", e => {
    e.preventDefault();
    // stopPropagation : sinon le handler "drop" du document envoyait les fichiers une 2e fois
    e.stopPropagation();
    dropzone.classList.remove("drag-over");
    uploadFiles(e.dataTransfer.files);
  });
}

document.addEventListener("dragover", e => e.preventDefault());

document.addEventListener("drop", e => {
  e.preventDefault();

  if (state.user && e.dataTransfer.files.length)
    uploadFiles(e.dataTransfer.files);
});

async function uploadFiles(fileList) {
  const files = [...fileList];

  if (!files.length) return;

  // Depuis Photos / Vidéos / etc. on envoie à la racine (pas dans un dossier caché ailleurs)
  const parentId = state.currentView === "files" ? state.currentFolderId : null;

  showToast(
    `J’envoie ${files.length} fichier${files.length > 1 ? "s" : ""}…`
  );

  let ok = 0;

  for (const file of files) {
    if (file.size > MAX_UPLOAD) {
      showToast(`${file.name} dépasse 100 Mo.`, "error");
      continue;
    }

    const form = new FormData();
    form.append("file", file);
    if (parentId) form.append("parent_id", parentId);

    try {
      await api("/api/files/upload", { method: "POST", body: form });
      ok++;
    } catch (err) {
      showToast(`Échec : ${file.name} — ${err.message}`, "error");
    }
  }

  if (ok > 0) {
    sfx("upload");
    showToast(`${ok} fichier${ok > 1 ? "s" : ""} envoyé${ok > 1 ? "s" : ""} ✓`);
    afterMutation(); // vue courante + stockage (avant : seulement la vue Fichiers)
  }
}

// ============================================================
// NOUVEAU DOSSIER
// ============================================================

$id("new-folder-btn").addEventListener("click", () => {
  sfx("balloon");

  // Un dossier se crée dans la vue Fichiers (sinon on ne verrait pas le résultat)
  if (state.currentView !== "files") switchView("files");

  $id("folder-name-input").value = "";

  show($id("folder-modal"));

  setTimeout(() => $id("folder-name-input").focus(), 80);
});

$id("folder-modal-cancel").addEventListener("click", () => {
  sfx("click");
  hide($id("folder-modal"));
});

$id("folder-modal").addEventListener("click", e => {
  if (e.target === $id("folder-modal"))
    hide($id("folder-modal"));
});

$id("folder-modal-confirm").addEventListener("click", async () => {
  const name = $id("folder-name-input").value.trim();

  if (!name) return;

  try {
    await api("/api/folders", {
      method: "POST",
      body: JSON.stringify({ name, parent_id: state.currentFolderId })
    });

    hide($id("folder-modal"));
    showToast(`Dossier "${name}" créé.`);
    afterMutation();

  } catch (err) {
    showToast(err.message, "error");
  }
});

$id("folder-name-input").addEventListener("keydown", e => {
  if (e.key === "Enter")
    $id("folder-modal-confirm").click();
});

// ============================================================
// VISIONNEUSE (lightbox) — images, vidéos, sons
// ============================================================

let _viewerToken = 0;

function closeLightbox() {
  _viewerToken++;
  ["lightbox-video", "lightbox-audio"].forEach(id => {
    const m = $id(id);
    m.pause();
    m.removeAttribute("src");
    m.load();
    hide(m);
  });

  const img = $id("lightbox-img");
  img.removeAttribute("src");
  hide(img);

  hide($id("lightbox"));
}

function openViewer(f) {
  const kind = fileKind(f);
  const src = `${API_BASE}/api/files/${encodeURIComponent(f.id)}/download`;

  sfx("ding");

  const img = $id("lightbox-img");
  const video = $id("lightbox-video");
  const audio = $id("lightbox-audio");

  hide(img); hide(video); hide(audio);

  if (kind === "video") {
    video.src = src;
    show(video);
    video.play().catch(() => {});
  } else if (kind === "audio") {
    audio.src = src;
    show(audio);
    audio.play().catch(() => {});
  } else if (isHeicFile(f)) {
    // Conversion HEIC -> JPEG dans le navigateur (quelques secondes la 1re fois)
    const token = ++_viewerToken;
    $id("lightbox-caption").textContent = `${f.name} — conversion en cours…`;
    heicFullUrl(f)
      .then(url => {
        if (token !== _viewerToken) return; // visionneuse fermée ou autre fichier ouvert entre-temps
        img.src = url;
        img.alt = f.name;
        show(img);
        $id("lightbox-caption").textContent = f.name;
      })
      .catch(err => {
        if (token !== _viewerToken) return;
        closeLightbox();
        showToast(err.message || "Conversion HEIC impossible.", "error");
      });
    show($id("lightbox"));
    return;
  } else {
    img.src = src;
    img.alt = f.name;
    show(img);
  }

  $id("lightbox-caption").textContent = f.name;
  show($id("lightbox"));
}

function openLightbox(src, name) {
  sfx("ding");

  hide($id("lightbox-video"));
  hide($id("lightbox-audio"));

  const img = $id("lightbox-img");
  img.src = src;
  img.alt = name;
  show(img);

  $id("lightbox-caption").textContent = name;
  show($id("lightbox"));
}

$id("lightbox-close").addEventListener("click", closeLightbox);

$id("lightbox").addEventListener("click", e => {
  if (e.target === $id("lightbox"))
    closeLightbox();
});

document.addEventListener("keydown", e => {
  if (e.key === "Escape") {
    closeLightbox();
    hide($id("context-menu"));
    hide($id("folder-modal"));
  }
});

// ============================================================
// MENU CONTEXTUEL
// ============================================================

function openContextMenu(e, f) {
  state.contextTarget = f;

  const menu = $id("context-menu");

  $id("ctx-download").style.display =
    f.is_folder ? "none" : "";

  show(menu);

  // Position calculée avec la vraie taille du menu (avant : marges codées en dur)
  const w = menu.offsetWidth || 180;
  const h = menu.offsetHeight || 120;

  menu.style.left = `${Math.max(4, Math.min(e.clientX, window.innerWidth - w - 4))}px`;
  menu.style.top  = `${Math.max(4, Math.min(e.clientY, window.innerHeight - h - 4))}px`;
}

document.addEventListener("click", () => hide($id("context-menu")));

$id("ctx-download").addEventListener("click", () => {
  const f = state.contextTarget;
  if (f) downloadFile(f);
});

$id("ctx-rename").addEventListener("click", () => {
  const f = state.contextTarget;
  if (f) renameEntry(f);
});

$id("ctx-delete").addEventListener("click", () => {
  const f = state.contextTarget;
  if (f) deleteEntry(f);
});

// ============================================================
// NOTES
// ============================================================

// ---- Sécurité / robustesse du contenu des notes ----
// Le contenu est du HTML (éditeur contenteditable) réinjecté via innerHTML :
// on ne garde qu'une liste blanche de balises et de styles.
const NOTE_TAGS = new Set([
  "B","STRONG","I","EM","U","S","STRIKE","DEL","H1","H2","H3","H4","P","DIV","BR",
  "UL","OL","LI","PRE","CODE","HR","SPAN","FONT","BLOCKQUOTE"
]);
const NOTE_DROP_TAGS = new Set([
  "SCRIPT","STYLE","IFRAME","OBJECT","EMBED","LINK","META","NOSCRIPT","TEMPLATE",
  "SVG","MATH","IMG","VIDEO","AUDIO","FORM","INPUT","TEXTAREA","BUTTON","SELECT"
]);
const NOTE_STYLE_PROPS = new Set([
  "color","background-color","text-align","font-weight","font-style","text-decoration","text-decoration-line"
]);

function cleanNoteStyle(value) {
  return value.split(";").map(d => d.trim()).filter(d => {
    const idx = d.indexOf(":");
    if (idx === -1) return false;
    const prop = d.slice(0, idx).trim().toLowerCase();
    const val = d.slice(idx + 1).trim().toLowerCase();
    return NOTE_STYLE_PROPS.has(prop) && !/url\(|expression|javascript|\\|@import/.test(val);
  }).join("; ");
}

function sanitizeNoteHtml(html) {
  // DOMParser : document inerte (aucun script / onerror n'est exécuté pendant l'analyse)
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");

  const walk = node => {
    [...node.childNodes].forEach(child => {
      if (child.nodeType === Node.TEXT_NODE) return;
      if (child.nodeType !== Node.ELEMENT_NODE) { child.remove(); return; }

      if (NOTE_DROP_TAGS.has(child.tagName)) { child.remove(); return; }

      if (!NOTE_TAGS.has(child.tagName)) {
        walk(child);
        child.replaceWith(...child.childNodes); // balise inconnue : on garde juste le texte
        return;
      }

      [...child.attributes].forEach(a => {
        const name = a.name.toLowerCase();
        if (name === "style") {
          const clean = cleanNoteStyle(a.value);
          if (clean) child.setAttribute("style", clean); else child.removeAttribute("style");
        } else if (!(name === "color" && child.tagName === "FONT" && /^[#\w(),.\s%-]+$/.test(a.value))) {
          child.removeAttribute(a.name);
        }
      });

      walk(child);
    });
  };

  walk(doc.body);
  return doc.body.innerHTML;
}

// Anciennes notes en texte brut : on garde les retours à la ligne
function prepareNoteHtml(content) {
  if (!content) return "";
  if (!/<\/?[a-z][^>]*>/i.test(content)) return escapeHtml(content).replace(/\n/g, "<br>");
  return sanitizeNoteHtml(content);
}

function htmlToText(html) {
  const doc = new DOMParser().parseFromString(`<body>${html || ""}</body>`, "text/html");
  return (doc.body.textContent || "").replace(/\s+/g, " ").trim();
}

// ---- Liste / sélection ----
let _savePending = false;
let _saveChain = Promise.resolve();

async function loadNotes(selectId) {
  try {
    const { notes } = await api("/api/notes");

    state.notes = notes;

    // On garde la note ouverte si elle existe encore (avant : toujours la 1re de la liste)
    const wanted = selectId || state.activeNoteId;

    if (wanted && notes.some(n => n.id === wanted))
      selectNote(wanted, true);
    else if (notes.length > 0)
      selectNote(notes[0].id, true);
    else
      clearEditor();

    renderNotesList();

  } catch (err) {
    showToast(err.message, "error");
  }
}

function renderNotesList() {
  const list = $id("notes-list-items");

  list.innerHTML = "";

  state.notes.forEach(n => {
    const item = document.createElement("div");

    item.className =
      "note-list-item" + (n.id === state.activeNoteId ? " active" : "");

    // Aperçu en texte pur (avant : on affichait le HTML brut "<div>...")
    item.innerHTML =
      `<div class="n-title">${escapeHtml(n.title || "Sans titre")}</div>
       <div class="n-preview">${escapeHtml(htmlToText(n.content).slice(0, 40))}</div>`;

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
  $id("note-content").innerHTML = prepareNoteHtml(html);
  updateCounts();
}

function updateCounts() {
  const el = $id("note-content");

  if (!el) return;

  const text = el.innerText || "";

  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const chars = text.replace(/\n/g, "").length;

  const counter = $id("note-counts");

  if (counter)
    counter.textContent =
      `${words} mot${words > 1 ? "s" : ""} · ${chars} caractère${chars > 1 ? "s" : ""}`;
}

// Sans note ouverte, l'éditeur est verrouillé (avant : on pouvait taper dans le vide, rien n'était enregistré)
function setEditorEnabled(on) {
  $id("note-content").contentEditable = on ? "true" : "false";
  $id("note-title").disabled = !on;
}

function selectNote(id, force = false) {
  // Enregistre d'abord la note qu'on quitte : le contenu est capturé de façon
  // synchrone par saveActiveNote() avant que l'éditeur ne change.
  // (avant : la modif en cours était perdue, ou écrite dans la mauvaise note)
  if (!force && id !== state.activeNoteId) flushNoteSave();

  state.activeNoteId = id;

  const note = state.notes.find(n => n.id === id);

  if (!note) return clearEditor();

  setEditorEnabled(true);

  $id("note-title").value = note.title || "";

  setNoteBody(note.content || "");

  $id("note-status").textContent =
    `Modifié le ${new Date(note.updated_at).toLocaleString("fr-FR")}`;

  renderNotesList();
}

function clearEditor() {
  state.activeNoteId = null;

  $id("note-title").value = "";

  setNoteBody("");

  $id("note-status").textContent = "Aucune note — crée-en une avec « Nouvelle note ».";

  setEditorEnabled(false);
}

// Nouvelle note + suppression
$id("new-note-btn").addEventListener("click", async () => {
  sfx("balloon");

  try {
    await flushNoteSave();

    const { id } = await api("/api/notes", {
      method: "POST",
      body: JSON.stringify({ title: "Nouvelle note", content: "" })
    });

    await loadNotes(id);
  } catch (err) {
    showToast(err.message, "error");
  }
});

$id("delete-note-btn").addEventListener("click", async () => {
  if (!state.activeNoteId || !confirm("Supprimer cette note ?"))
    return;

  sfx("delete");

  const id = state.activeNoteId;

  clearTimeout(state.saveTimer);
  _savePending = false;

  try {
    await _saveChain; // laisse finir une sauvegarde en cours avant de supprimer
    await api(`/api/notes/${id}`, { method: "DELETE" });

    state.activeNoteId = null;
    await loadNotes();
  } catch (err) {
    showToast(err.message, "error");
  }
});

$id("save-note-btn").addEventListener("click", async () => {
  if (!state.activeNoteId) return;

  sfx("notify");

  const ok = await saveActiveNote();

  const btn = $id("save-note-btn");

  btn.textContent = ok ? "✓ Sauvegardé !" : "✕ Échec";

  setTimeout(() => { btn.textContent = "✓ Sauvegarder"; }, 1500);
});

// Auto-save
function scheduleSave() {
  if (!state.activeNoteId) return;

  clearTimeout(state.saveTimer);

  _savePending = true;

  $id("note-status").textContent = "Enregistrement…";

  updateCounts();

  state.saveTimer = setTimeout(saveActiveNote, 700);
}

// Enregistre tout de suite s'il y a une modification en attente
function flushNoteSave() {
  if (!_savePending) return Promise.resolve(true);

  return saveActiveNote();
}

// Capture l'id + le contenu tout de suite, puis envoie (les envois sont mis en file
// pour qu'une ancienne version n'écrase pas une plus récente).
function saveActiveNote() {
  const id = state.activeNoteId;

  if (!id) return Promise.resolve(false);

  clearTimeout(state.saveTimer);
  _savePending = false;

  const title = $id("note-title").value;
  const content = getNoteBody();

  const run = async () => {
    try {
      await api(`/api/notes/${id}`, {
        method: "PATCH",
        body: JSON.stringify({ title, content })
      });

      const note = state.notes.find(n => n.id === id);

      if (note) {
        note.title = title;
        note.content = content;
        note.updated_at = Date.now();
        state.notes.sort((a, b) => b.updated_at - a.updated_at);
      }

      if (state.activeNoteId === id)
        $id("note-status").textContent =
          `Sauvegardé à ${new Date().toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;

      renderNotesList();
      return true;

    } catch (err) {
      if (state.activeNoteId === id)
        $id("note-status").textContent = "Échec de l’enregistrement — réessaie.";
      return false;
    }
  };

  _saveChain = _saveChain.then(run);
  return _saveChain;
}

// Sauvegarde quand on quitte / cache l'onglet
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushNoteSave();
});

$id("note-title").addEventListener("input", scheduleSave);
$id("note-content").addEventListener("input", scheduleSave);

// Colle en texte brut : évite d'importer du HTML étranger dans la note
$id("note-content").addEventListener("paste", e => {
  e.preventDefault();

  const text = (e.clipboardData || window.clipboardData).getData("text/plain");

  document.execCommand("insertText", false, text);
});

// Barre d'outils — commandes de formatage
document.querySelectorAll(".tb-btn")
  .forEach(btn => {
    btn.addEventListener(
      "mousedown",
      e => {
        e.preventDefault();
        if (!state.activeNoteId) return;


        const cmd =
          btn.dataset.cmd;

        const editor =
          $id("note-content");

        editor.focus();

        switch (cmd) {
          case "bold":
            document.execCommand("bold");
            break;

          case "italic":
            document.execCommand("italic");
            break;

          case "underline":
            document.execCommand("underline");
            break;

          case "strike":
            document.execCommand("strikeThrough");
            break;

          case "h1":
            document.execCommand(
              "formatBlock",
              false,
              "h2"
            );
            break;

          case "h2":
            document.execCommand(
              "formatBlock",
              false,
              "h3"
            );
            break;

          case "ul":
            document.execCommand(
              "insertUnorderedList"
            );
            break;

          case "ol":
            document.execCommand(
              "insertOrderedList"
            );
            break;

          case "code":
            document.execCommand(
              "formatBlock",
              false,
              "pre"
            );
            break;

          case "hr":
            document.execCommand(
              "insertHorizontalRule"
            );
            break;

          case "alignLeft":
            document.execCommand(
              "justifyLeft"
            );
            break;

          case "alignCenter":
            document.execCommand(
              "justifyCenter"
            );
            break;

          case "alignRight":
            document.execCommand(
              "justifyRight"
            );
            break;

          case "clear":
            document.execCommand(
              "removeFormat"
            );
            break;
        }

        scheduleSave();
      }
    );
  });

// Raccourcis clavier dans l'éditeur
$id("note-content")
  .addEventListener(
    "keydown",
    e => {
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key === "s"
      ) {
        e.preventDefault();
        saveActiveNote();
      }
    }
  );

// Couleur du texte
const textColorInput =
  $id("tb-text-color");

const textColorBar =
  $id("tb-text-color-bar");

// Couleur de surlignage
const hlColorInput =
  $id("tb-highlight-color");

const hlColorBar =
  $id("tb-hl-color-bar");

// Sauvegarde / restauration de la sélection
let _savedRange = null;

function saveSelection() {
  const sel =
    window.getSelection();

  if (
    sel &&
    sel.rangeCount > 0
  )
    _savedRange =
      sel.getRangeAt(0).cloneRange();
}

function restoreSelection() {
  if (!_savedRange) return;

  const sel =
    window.getSelection();

  sel.removeAllRanges();
  sel.addRange(_savedRange);
}

// Sauvegarde la sélection quand on clique sur un color picker
document.querySelectorAll(".tb-color-input")
  .forEach(inp => {
    inp.addEventListener(
      "mousedown",
      saveSelection
    );
  });

if (textColorInput) {
  textColorInput.addEventListener(
    "input",
    () => {
      if (textColorBar)
        textColorBar.style.background =
          textColorInput.value;
    }
  );

  textColorInput.addEventListener(
    "change",
    () => {
      restoreSelection();

      document.execCommand(
        "foreColor",
        false,
        textColorInput.value
      );

      scheduleSave();
    }
  );
}

if (hlColorInput) {
  hlColorInput.addEventListener(
    "input",
    () => {
      if (hlColorBar)
        hlColorBar.style.background =
          hlColorInput.value;
    }
  );

  hlColorInput.addEventListener(
    "change",
    () => {
      restoreSelection();

      document.execCommand(
        "hiliteColor",
        false,
        hlColorInput.value
      );

      scheduleSave();
    }
  );
}

// ============================================================
// STOCKAGE
// ============================================================

async function updateStorageBar() {
  try {
    const files =
      _allFilesCache ||
      (await fetchAllFiles());

    const total =
      files.reduce(
        (s, f) => s + (f.size || 0),
        0
      );

    const QUOTA =
      5 * 1024 ** 3;

    const pct =
      Math.min(
        (total / QUOTA) * 100,
        100
      );

    $id("storage-bar")
      .style.width =
      pct + "%";

    $id("storage-text")
      .textContent =
      `${formatSize(total)} sur ${formatSize(QUOTA)}`;

  } catch (_) {
    $id("storage-text")
      .textContent =
      "Indisponible";
  }
}

// ============================================================
// MUSIQUE D'AMBIANCE
// ============================================================

const ambientAudio =
  new Audio("assets/ambient.mp3");

ambientAudio.loop = true;
ambientAudio.preload = "none"; // 4,8 Mo : ne rien télécharger tant que la musique n'est pas lancée
ambientAudio.volume = 0.28;

let musicStarted = false;

function startAmbientMusic() {
  if (musicStarted) return;

  musicStarted = true;

  ambientAudio.play().catch(() => {
    const resume = () => {
      ambientAudio.play();
      document.removeEventListener(
        "click",
        resume
      );
    };

    document.addEventListener(
      "click",
      resume
    );
  });
}

const musicBtn =
  $id("music-toggle-btn");

const musicSlider =
  $id("music-volume-slider");

const musicIcon =
  $id("music-icon");

const musicBubble =
  $id("music-player");

let _musicCollapseTimer = null;

function expandMusic() {
  if (!musicBubble) return;

  musicBubble.classList.add(
    "expanded"
  );

  resetCollapseTimer();
}

function collapseMusic() {
  if (!musicBubble) return;

  musicBubble.classList.remove(
    "expanded"
  );

  clearTimeout(
    _musicCollapseTimer
  );
}

function resetCollapseTimer() {
  clearTimeout(
    _musicCollapseTimer
  );

  _musicCollapseTimer =
    setTimeout(
      collapseMusic,
      2000
    );
}

function updateMusicIcon() {
  if (!musicIcon) return;

  if (ambientAudio.paused) {
    musicIcon.textContent = "🔇";
    return;
  }

  musicIcon.textContent =
    ambientAudio.volume < 0.35
      ? "🎵"
      : "🎶";
}

if (musicBtn) {
  musicBtn.addEventListener(
    "click",
    e => {
      e.stopPropagation();

      // Dans la sidebar il n'y a pas de bulle (#music-player) : avant, ce clic plantait (null.classList)
      const isExpanded =
        musicBubble
          ? musicBubble.classList.contains("expanded")
          : true;

      if (!isExpanded) {
        expandMusic();
        return;
      }

      if (ambientAudio.paused) {
        ambientAudio.play().catch(() => {});
        musicBtn.classList.remove(
          "paused"
        );
      } else {
        ambientAudio.pause();
        musicBtn.classList.add(
          "paused"
        );
      }

      updateMusicIcon();
      resetCollapseTimer();
    }
  );
}

// Slider volume — reset le timer à chaque interaction
if (musicSlider) {
  musicSlider.value =
    String(ambientAudio.volume);

  musicSlider.addEventListener(
    "input",
    e => {
      e.stopPropagation();

      const vol =
        parseFloat(
          musicSlider.value
        );

      ambientAudio.volume = vol;

      updateMusicIcon();

      if (
        vol > 0 &&
        ambientAudio.paused
      ) {
        ambientAudio.play();

        if (musicBtn)
          musicBtn.classList.remove(
            "paused"
          );
      }

      resetCollapseTimer();
    }
  );

  const panel =
    $id("music-expand-panel");

  if (panel) {
    panel.addEventListener(
      "mouseenter",
      () =>
        clearTimeout(
          _musicCollapseTimer
        )
    );

    panel.addEventListener(
      "mouseleave",
      () =>
        resetCollapseTimer()
    );
  }
}

// ============================================================
// PANNEAU DÉTAILS
// ============================================================

$id("detail-close")
  .addEventListener(
    "click",
    () =>
      hide($id("detail-panel"))
  );

// ============================================================
// BOUTON « HAUT DE PAGE »
// ============================================================

(function () {
  const btn = $id("to-top-btn");
  if (!btn) return;

  window.addEventListener("scroll", () => {
    btn.classList.toggle("hidden", window.scrollY < 500);
  }, { passive: true });

  btn.addEventListener("click", () => scrollToTop(true));
})();

// ============================================================
// INIT
// ============================================================

setEditorEnabled(false); // aucune note ouverte au démarrage
checkSession();