# Hylia Cloud

Un espace de stockage personnel (fichiers, photos, bloc-notes) dans le même style visuel que
[Hylia Plaza](https://hyl1a-hub.vercel.app) : fond sombre, tuiles arrondies, ticker d'infos en bas,
écrans de connexion/inscription en carte centrée.

## Fonctionnalités

- **Comptes** : inscription / connexion, sessions par cookie sécurisé.
- **Fichiers** : dossiers, envoi par glisser-déposer, téléchargement, suppression.
- **Photos** : galerie automatique de toutes les images envoyées, avec visionneuse plein écran.
- **Bloc-notes** : plusieurs notes, sauvegarde automatique.

## Stack

- **Frontend** : HTML / CSS / JS vanilla, aucune dépendance — `public/`.
- **Backend** : Cloudflare Worker — `worker/`.
- **Stockage fichiers** : Cloudflare R2.
- **Base de données** : Cloudflare D1 (SQLite).

## Démarrer

Voir [DEPLOY.md](./DEPLOY.md) pour les instructions complètes de déploiement.

En résumé :
1. `cd worker && npm install`
2. Créer le bucket R2 et la base D1, remplir `wrangler.toml`.
3. `npx wrangler deploy`
4. Mettre l'URL du Worker dans `public/app.js` (`API_BASE`).
5. Héberger `public/` sur Vercel / Cloudflare Pages / Netlify.

## Structure

```
hylia-cloud/
├── public/              # Site statique
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── worker/               # API Cloudflare Worker
│   ├── src/
│   │   ├── index.js      # Routeur principal
│   │   ├── auth.js       # Inscription / connexion / sessions
│   │   ├── files.js      # Fichiers et dossiers (R2 + D1)
│   │   ├── notes.js      # Bloc-notes (D1)
│   │   └── utils.js      # Helpers (mots de passe, cookies, JSON...)
│   ├── schema.sql        # Schéma D1
│   └── wrangler.toml
└── DEPLOY.md
```
