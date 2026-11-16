# 🪙 Portfolio — Gestion de Budget, Épargne & Patrimoine

Application personnelle et complète de gestion de patrimoine, de budget de foyer et de stratégie financière : connexion bancaire PSD2 multi-banques (Enable Banking), valorisation immobilière automatisée, suivi des prêts avec amortissement, budget partagé façon **Tricount**, stratégie d'épargne avec calcul d'objectifs, et **Conseiller IA (Gemini 2.5 Flash)** contextualisé avec vos finances réelles.

Conçue selon une philosophie **Local-First** avec **SQLite**, ultra-rapide, sécurisée (sessions serveur HttpOnly, secrets chiffrés AES-256-GCM), exécutable localement sur votre machine ou déployable sur votre propre serveur/VPS avec HTTPS automatique.

---

## ✨ Fonctionnalités Clés

### 🏛️ Patrimoine & Open Banking (Nouveau)
- **Multi-banques via Enable Banking (PSD2 / Open Banking)** : connexion directe et synchronisation de plus de 2000 banques européennes (BoursoBank, BNP Paribas, Crédit Agricole, Société Générale, etc.).
- **Immobilier automatisé** : estimation de valeur basée sur l'Open Data des transactions réelles (DVF / Cerema), géocodage officiel IGN et ré-indexation trimestrielle INSEE, complétée par des coefficients déclaratifs (étage, terrasse, DPE, travaux).
- **Prêts & Emprunts** : calcul des mensualités, du capital restant dû et tableau d'amortissement complet synchronisé avec le patrimoine net.
- **Marchés & Titres** : suivi des cours d'actions, ETF et cryptos via Yahoo Finance avec conversion en euros et résolution automatique des codes ISIN via OpenFIGI.
- **Répartition & Parts de propriété** : affectation au prorata pour les comptes joints et les biens immobiliers partagés au sein du foyer (Romain / Sophie).

### 🧾 Budget Foyer & Tricount
- **Suivi des dépenses et revenus au mois le mois** : qui a payé quoi, répartition personnalisée (50/50, au prorata des revenus ou sur-mesure).
- **Équilibrage automatique des comptes** : calcul instantané des dettes croisées pour savoir qui doit rembourser qui en fin de mois.
- **Enveloppes & Poches budgétaires** : suivi des charges fixes, dépenses courantes, loisirs et épargne programmée.

### 🎯 Stratégie & Objectifs d'Épargne
- **Poches d'épargne dédiées** : fonds de secours, projets d'achat, investissements.
- **Simulateur d'effort d'épargne** : calcul dynamique de la capacité d'épargne mensuelle nécessaire pour atteindre un objectif financier à une date donnée.
- **Simulation avec intérêts composés** : projection temporelle de la valorisation du capital.

### 🤖 Conseiller IA Intégré (Gemini 2.5 Flash)
- **Chatbot financier contextualisé** : Gemini dispose en direct d'une vue d'ensemble de vos finances (comptes bancaires, soldes, cryptos, poches d'épargne, budget du mois) pour vous offrir un conseil sur-mesure en français et en euros.
- **Thématiques couvertes** : capacité d'emprunt, rééquilibrage de portefeuille, choix d'allocation, fiscalité, optimisation de budget.
- **Contrôle de la vie privée** : vous sélectionnez quelles catégories de données transmettre à l'IA avant chaque question.

### 🏦 Banque & Catégorisation Intelligente
- **Import de relevés CSV bancaires** : support natif des formats Boursorama et banques françaises avec mapping flexible de colonnes.
- **Catégorisation automatique par IA** : analyse sémantique des libellés d'opérations pour assigner la bonne catégorie et sous-catégorie.
- **Passerelle vers le budget** : liaison en un clic d'une opération bancaire vers une dépense Tricount.

### ⚡ Portefeuille Crypto & Web3
- **Suivi des portefeuilles on-chain (EVM)** : synchronisation via l'API Etherscan.
- **Centralized Exchanges (CEX)** : connexion en lecture seule à votre compte Binance.
- **NFTs & Objets numériques** : affichage et valorisation de votre collection OpenSea.
- **Mode discrétion** : masquage en un clic des soldes sensibles.

---

## 🏗️ Architecture & Technologies

| Couche | Technologie |
| :--- | :--- |
| **Frontend** | React 18, TypeScript 5, Vite (avec support natif HTTPS en dev), Tailwind CSS |
| **Dataviz** | Recharts, Lucide Icons, Thème sombre "Noir & Or" soigné |
| **Backend API** | Node.js, Express, better-sqlite3 |
| **Base de données** | SQLite local (`portfolio.db` en dev, `data/portfolio.db` en Docker), sauvegardes cohérentes via `npm run db:backup` |
| **Sécurité** | Sessions serveur HttpOnly par profil, secrets chiffrés AES-256-GCM, HTTP Basic Auth obligatoire par défaut en production, création de profil protégée par jeton |
| **Intelligence Artificielle** | Google Gemini 2.5 Flash |
| **Open Banking** | Enable Banking API (PSD2 / AIS via JWT RS256 signés localement) |
| **Sources de données** | Yahoo Finance, OpenFIGI, DVF / Cerema, IGN Géoplateforme, INSEE, CoinGecko, Binance, Etherscan |

---

## 🐳 Pourquoi Docker, Dockerfile & Caddy ?

Vous trouverez à la racine un `Dockerfile`, un `docker-compose.yml` et un dossier `deploy/Caddyfile` :
- **Pour le local au quotidien** : Vous n'avez pas besoin de Docker (`npm start` suffit).
- **Pour l'accès mobile & serveur permanent** : Si vous souhaitez héberger l'application sur un mini-PC, NAS ou VPS afin d'y accéder depuis votre smartphone, lancez `docker compose --profile tls up -d --build`. Caddy génère et renouvelle **automatiquement un certificat HTTPS Let's Encrypt gratuit** pour votre nom de domaine. Sans le profil `tls`, seul le port loopback `127.0.0.1:3001` est publié.
- C'est ce qui garantit une URL HTTPS stable et permanente requise par les redirections bancaires d'Enable Banking.

> [!IMPORTANT]
> **Base Docker** : le conteneur utilise `/app/data/portfolio.db`, monté depuis `./data`. Avant le premier démarrage, arrêtez l'application locale puis préparez la base avec `npm run db:prepare-docker`. Sans cette étape, Docker démarre sur une base vide. Le script refuse d'écraser une base Docker non vide sans `--force`, vérifie l'intégrité SQLite et applique les permissions `0600`.
>
> `data/` est ignoré par Git car il contient des données personnelles. Sauvegardez séparément `data/portfolio.db`, `data/.portfolio-secret` et `data/.portfolio-session-secret` : sans les deux clés, les secrets et sessions existants ne peuvent plus être déchiffrés/validés.
>
> **Accès Docker** : copiez `.env.production.example` vers `.env.production`, puis renseignez `BASIC_AUTH_USER`, `BASIC_AUTH_PASSWORD` et `AUTH_SETUP_TOKEN` (`openssl rand -hex 24`). `docker-compose.yml` impose `REQUIRE_AUTH=true` : sans Basic Auth, le conteneur refuse de démarrer. Sans `AUTH_SETUP_TOKEN`, la création de profil est désactivée.

Pour plus de détails, consultez le guide complet dans [`docs/deployment.md`](docs/deployment.md).

---

## 🚀 Démarrage Rapide

### Prérequis
- Node.js 18 ou version supérieure
- npm

### 1. Installation
```bash
git clone https://github.com/Romaindujardin/Portfolio-Dashboard.git
cd Portfolio-Dashboard
npm install
```

### 2. Lancement en Développement (avec HTTPS activé)
```bash
npm start
```
Cette commande démarre simultanément :
1. **Le serveur Express** sur `http://127.0.0.1:3001`
2. **L'application Vite** en HTTPS sur **`https://localhost:5173`**

> [!TIP]
> **Certificat SSL local :** Au premier lancement sur `https://localhost:5173`, votre navigateur peut afficher un avertissement de sécurité standard lié au certificat auto-signé généré par Vite (`basic-ssl`). Cliquez simplement sur *« Avancé »* puis *« Continuer vers le site »*.

---

## 🔐 Sécurité & données sensibles

- **Authentification par profil** : chaque profil (Romain / Sophie) possède son propre mot de passe (8 caractères minimum). Le serveur émet un cookie de session `portfolio_session` **HttpOnly**, `SameSite=Lax`, valable 7 jours. Les routes `/api` protégées refusent toute requête sans session (seules la santé, la connexion et le callback OAuth restent publics), et un `user_id` différent de la session est rejeté (`403 USER_MISMATCH`). Un changement de mot de passe invalide les anciens jetons.
- **Création de profil protégée** : en production, `/auth/setup` exige `AUTH_SETUP_TOKEN` (16 caractères minimum, à générer avec `openssl rand -hex 24`). Sans ce jeton, la création de profil est désactivée ; les profils existants continuent de fonctionner. Le code est saisi une fois dans l'interface, puis pour chaque nouveau profil.
- **GET sans effet de bord** : le nettoyage des doublons d'autorisations bancaires n'est plus déclenché par une lecture. Il s'exécute après une synchronisation BoursoBank ou via `POST /api/portfolio/transactions/cleanup-duplicates`.
- **Coffre de secrets** : les clés API Gemini, Binance, Etherscan, CoinGecko et OpenSea, ainsi que les identifiants du sidecar BoursoBank, ne sont plus stockés dans le navigateur ni dans `user_settings`. Ils sont chiffrés au repos en **AES-256-GCM** dans la table `user_secrets`, rattachés au profil, et ne sont jamais renvoyés en clair par l'API. Les appels authentifiés Gemini, Etherscan, CoinGecko, Binance et OpenSea passent par des proxies serveur.
- **Administration** : la configuration globale Enable Banking (Application ID, clé PEM, URL de retour) n'est modifiable que par les profils listés dans `ADMIN_USERS` (séparés par des virgules). Si la variable est absente, le profil le plus ancien fait office d'administrateur ; `canManage=false` est renvoyé aux autres profils et l'API répond `403` sur toute mutation.
- **En-têtes de sécurité** : Express applique une CSP **Report-Only** par défaut et collecte les violations sur `/api/csp-report`. Après analyse, `CSP_MODE=enforce` active le blocage. Caddy ne duplique pas la CSP : Express reste la source unique pour que le mode soit réellement appliqué. Les autres en-têtes (HSTS, `X-Frame-Options`, `Permissions-Policy`, COOP/CORP) sont posés par les deux couches.
- **Clés locales** : `data/.portfolio-secret` (chiffrement des secrets) et `data/.portfolio-session-secret` (signature des sessions) sont générés automatiquement en `0600`. Sauvegardez-les avec la base : sans eux, les secrets et sessions existants ne peuvent plus être déchiffrés/validés. On peut aussi fournir `PORTFOLIO_SECRET_KEY` et `PORTFOLIO_SESSION_SECRET`.
- **Sauvegardes** : `npm run db:backup` crée une sauvegarde SQLite cohérente dans `backups/`. Les sauvegardes de plus de **30 jours** (`BACKUP_RETENTION_DAYS`) sont purgées automatiquement ; la purge peut aussi être lancée avec `npm run db:prune-backups` (`-- --days 7`, `-- --dry-run`). La suppression d'un profil purge immédiatement les copies accessibles dans `BACKUP_DIR` avant de compacter chaque fichier ; les copies externes ou hors ligne restent soumises à la rétention. Pour restaurer, arrêtez le serveur puis lancez `npm run db:restore -- [fichier.db]` (le script refuse de s'exécuter si des fichiers `-wal`/`-shm` indiquent un serveur actif, sauf `--force`).
- **Suppression de profil** : `DELETE /api/portfolio/users/:username` supprime les données du profil, ses secrets, ses identifiants et ses miroirs disque, purge les sauvegardes accessibles, puis invalide sa session. Les comptes partagés sont transférés à un co-owner avant la suppression.

---

## 🔒 Configuration d'Enable Banking (Multi-Banques)

1. Créez un compte et une application sur le portail [Enable Banking](https://enablebanking.com/).
2. Téléchargez votre clé privée RSA (fichier `.pem`) et notez votre **Application ID**.
3. Dans les paramètres de votre application sur le portail Enable Banking, ajoutez exactement l'URL de redirection suivante dans **Redirect URIs** :
   ```text
   https://localhost:5173/api/portfolio/connections/enable-banking/callback
   ```
   *(En production sur un serveur, remplacez `localhost:5173` par votre nom de domaine HTTPS).*
4. Dans l'application Portfolio Dashboard, rendez-vous sur la page **Patrimoine > Connexions**.
5. Cliquez sur **« Configurer l'intégration »**, renseignez votre Application ID et collez le contenu de votre clé privée PEM.
6. Recherchez votre établissement bancaire (ex: *BoursoBank*, *BNP*, *Crédit Agricole*), lancez la connexion et validez l'authentification forte sur l'application de votre banque !

> [!NOTE]
> La configuration globale Enable Banking est partagée par tous les profils mais sa modification est réservée aux administrateurs définis par `ADMIN_USERS` (par exemple `ADMIN_USERS=Romain,Sophie`). Sans cette variable, le profil créé en premier est administrateur. Les autres profils peuvent connecter leurs banques et synchroniser leurs comptes, mais ne peuvent ni modifier ni supprimer les identifiants de l'application.

---

## 🗺️ Feuille de Route (Roadmap)

Les grandes fonctionnalités (marché live, ETF look-through, passerelle Enable
Banking → Tricount, conseiller IA enrichi) sont déjà implémentées. Les
prochains chantiers portent sur la robustesse et l'exploitation :

### 🔐 1. Finaliser le modèle multi-profils
- Permissions co-owner explicites (lecture/écriture vs opérations destructives).
- Clés `localStorage` Tricount/Savings préfixées par profil.
- Paramètres d'intégration Enable Banking / BoursoBank par profil.

### 🗄️ 2. Fiabiliser la persistance
- Migrations versionnées (`user_version` + table `schema_migrations`).
- `busy_timeout` SQLite et transactions explicites pour les opérations multi-étapes.
- Planification automatique des sauvegardes et test de restauration régulier.

### 🚀 3. Dette technique et déploiement
- Migration React Router v6 → v7 (corrige les 2 advisories `npm audit`).
- Code-splitting des routes pour réduire le bundle JavaScript (> 1,2 Mo).
- CI GitHub Actions : tests, type-check, lint, build, audit.

---

## 🧪 Tests & Qualité

Le projet dispose d'une suite de tests complète (248 tests automatisés avec Vitest) garantissant la fiabilité des calculs financiers, du chiffrement, des sessions et des synchronisations :

```bash
npm test              # Exécute l'ensemble des 248 tests
npm run test:watch    # Mode surveillance interactif
npm run test:coverage # Rapport de couverture de code
npm run type-check    # Vérification stricte TypeScript
npm run lint          # Analyse ESLint
```

Les tests s'exécutent sur une base SQLite temporaire isolée sans jamais altérer votre base de données réelle `portfolio.db`.

---

## 📄 Licence

Ce projet est distribué sous licence MIT.
