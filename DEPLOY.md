# Déployer Hylia Cloud

Le projet a deux parties :
- **`worker/`** → l'API (Cloudflare Worker) : authentification, fichiers (R2), notes (D1).
- **`public/`** → le site (HTML/CSS/JS statique), à héberger où tu veux (Vercel, Cloudflare Pages, Netlify...).

## 1. Prérequis

- Un compte Cloudflare (gratuit) — tu en as sûrement déjà un vu `wrangler.toml` dans Hylia Plaza.
- Node.js installé sur ta machine.

```bash
cd worker
npm install
npx wrangler login
```

## 2. Créer le bucket R2 (stockage des fichiers)

```bash
npx wrangler r2 bucket create hylia-cloud-files
```

Le nom doit correspondre à `bucket_name` dans `worker/wrangler.toml` (déjà rempli).

## 3. Créer la base D1 (comptes, métadonnées, notes)

```bash
npx wrangler d1 create hylia-cloud-db
```

Cette commande t'affiche un `database_id`. Copie-le dans `worker/wrangler.toml` à la place de
`REMPLACE_MOI_AVEC_TON_ID_D1`.

Puis applique le schéma :

```bash
npx wrangler d1 execute hylia-cloud-db --remote --file=./schema.sql
```

## 4. Configurer l'origine autorisée (CORS)

Dans `worker/src/index.js`, remplace :

```js
const ALLOWED_ORIGIN = "*";
```

par l'URL exacte de ton site une fois déployé, par exemple :

```js
const ALLOWED_ORIGIN = "https://hylia-cloud.vercel.app";
```

(`*` fonctionne pour tester en local mais empêche l'envoi des cookies de session en production.)

## 5. Déployer le Worker

```bash
npx wrangler deploy
```

Note l'URL affichée à la fin, du style :
`https://hylia-cloud-api.<ton-sous-domaine>.workers.dev`

## 6. Brancher le front sur l'API

Dans `public/app.js`, tout en haut :

```js
const API_BASE = "https://hylia-cloud-api.YOUR-SUBDOMAIN.workers.dev";
```

Remplace par l'URL obtenue à l'étape 5.

## 7. Déployer le site statique

N'importe quel hébergeur de sites statiques fonctionne. Avec Vercel par exemple :

```bash
cd public
npx vercel deploy --prod
```

Ou avec Cloudflare Pages :

```bash
npx wrangler pages deploy public
```

## 8. Tester

Ouvre ton site, crée un compte, envoie un fichier depuis l'app **Fichiers**, vérifie qu'il apparaît
bien dans **Photos** (si c'est une image) et essaie le **Bloc-notes**.

---

### Pistes d'évolution
- Limite de stockage par utilisateur (actuellement seule la taille max par fichier est limitée, à 200 Mo, dans `worker/src/files.js`).
- Renommage/déplacement de fichiers par glisser-déposer entre dossiers.
- Partage de fichiers via lien public temporaire (signed URL R2).
- Miniatures compressées côté serveur pour accélérer la galerie Photos.
