# Déploiement accessible depuis plusieurs appareils

Objectif : une URL HTTPS fixe, utilisable depuis un ordinateur ou un téléphone,
sans tunnel temporaire.

## Pourquoi pas Vercel pour toute l'application ?

Vercel convient au frontend statique, mais pas au backend actuel :

- le backend est un serveur Express permanent ;
- les données sont dans un fichier SQLite (`portfolio.db`) ;
- les sauvegardes, la clé de chiffrement et les secrets vivent dans `data/` ;
- `better-sqlite3` est un module natif.

Il faudrait donc sortir la base et les fichiers vers un service externe, puis
séparer frontend et backend. Ce n'est pas nécessaire pour une application
personnelle.

**Architecture recommandée : un seul serveur**, avec Express qui sert le
frontend et l'API sur la même origine, derrière Caddy pour HTTPS.

```text
Téléphone / ordinateur
        │
        ▼
https://portfolio.tondomaine.fr       (Caddy, certificat Let's Encrypt)
        │
        ▼
   app:3001 (Express + dist/ + SQLite)
```

## Prérequis

- un serveur ou une machine toujours allumée, avec Docker ;
- un nom de domaine qui pointe vers ce serveur (`A`/`AAAA`) ;
- les ports `80` et `443` ouverts ;
- un mot de passe pour protéger l'accès.

Si le serveur est derrière une box, il faut rediriger les ports 80 et 443 vers
la machine. Si ce n'est pas possible, un tunnel Cloudflare **nommé** avec un
domaine fixe reste une alternative.

## 1. Configurer le domaine et les secrets

```bash
cp .env.production.example .env.production
chmod 600 .env.production
```

Modifier `.env.production` :

```bash
APP_DOMAIN=portfolio.tondomaine.fr
APP_URL=https://portfolio.tondomaine.fr
ENABLE_BANKING_REDIRECT_URI=https://portfolio.tondomaine.fr/api/portfolio/connections/enable-banking/callback
BASIC_AUTH_USER=portfolio
BASIC_AUTH_PASSWORD=un-mot-de-passe-long-et-unique
REQUIRE_AUTH=true
AUTH_SETUP_TOKEN=
# Administrateurs de la configuration Enable Banking (liste CSV).
ADMIN_USERS=Romain
# CSP : report-only par défaut, enforce après analyse des rapports.
CSP_MODE=report-only
```

Renseigner `AUTH_SETUP_TOKEN` avec un jeton aléatoire (le laisser vide
désactive la création de profil). Pour le mot de passe et le jeton
d'initialisation, on peut générer des valeurs sans caractères spéciaux :

```bash
openssl rand -hex 24
```

`docker-compose.yml` impose `REQUIRE_AUTH=true` : sans
`BASIC_AUTH_USER`/`BASIC_AUTH_PASSWORD`, le conteneur refuse de démarrer. Si un
reverse proxy authentifie déjà les utilisateurs, cette protection ne doit être
désactivée que par un override Compose explicite.

`AUTH_SETUP_TOKEN` protège `/auth/setup`. En production, sans ce jeton, la
création de profil est désactivée (les profils existants peuvent toujours se
connecter). Le code est demandé une fois dans l'interface lors de la création
d'un profil, puis pour chaque nouveau profil du foyer.

`ADMIN_USERS` est une liste de noms séparés par des virgules (par exemple
`Romain,Sophie`). Seuls ces profils peuvent modifier ou supprimer la
configuration globale Enable Banking. Si la variable est absente, le profil
créé en premier devient administrateur ; les autres profils reçoivent
`canManage=false` et l'API refuse leurs mutations avec `403`.

`CSP_MODE` contrôle l'en-tête Content-Security-Policy émis par Express :
`report-only` (défaut) collecte les violations sur `/api/csp-report`, tandis
que `enforce` bloque les ressources non autorisées. Caddy ne duplique pas cet
en-tête pour que le mode choisi s'applique réellement ; il conserve les autres
en-têtes de sécurité.

Le nom de domaine doit être le même partout : `APP_DOMAIN`, `APP_URL` et l'URL
de retour Enable Banking.

## 2. Récupérer les données existantes

Arrêter l'application locale, puis préparer la base Docker avec le script
dédié (API backup SQLite, vérification d'intégrité, permissions `0600`) :

```bash
npm run db:prepare-docker
```

Le script lit `portfolio.db` et écrit `data/portfolio.db`. Il refuse
d'écraser une base Docker non vide sans `--force`. Vérifier ensuite :

```bash
ls -l data/portfolio.db
```

Si `data/portfolio.db` est absent ou fait 0 octet, le conteneur démarrera sur
une base vide : l'historique, les comptes et les secrets déjà enregistrés ne
seront pas visibles.

Copier sur le serveur :

- `data/portfolio.db` ;
- `data/.portfolio-secret` (indispensable pour déchiffrer les clés déjà
  enregistrées) ;
- `data/.portfolio-session-secret` (indispensable pour valider les sessions
  existantes) ;
- éventuellement les autres fichiers de `data/` et `backups/`.

Si `data/.portfolio-secret` est perdu, les secrets stockés en base ne peuvent
plus être déchiffrés. On peut aussi fournir la même clé via
`PORTFOLIO_SECRET_KEY`. De même, `PORTFOLIO_SESSION_SECRET` peut remplacer le
fichier de signature des sessions.

En Docker, la base utilisée est `/app/data/portfolio.db` (variable
`DATABASE_PATH`) et le volume `./data:/app/data` conserve la base, les clés
locales et les miroirs JSON.

## 3. Clé Enable Banking

Deux possibilités :

1. **Via l'interface** : après le déploiement, aller dans
   `Patrimoine > Connexions` et saisir l'Application ID, la clé PEM et l'URL de
   retour.
2. **Via l'environnement** (recommandé en production) :

```bash
mkdir -p secrets
cp /chemin/vers/application.pem secrets/enablebanking.pem
chmod 600 secrets/enablebanking.pem
```

Puis dans `.env.production` :

```bash
ENABLE_BANKING_APP_ID=00000000-0000-0000-0000-000000000000
ENABLE_BANKING_PRIVATE_KEY_PATH=/app/secrets/enablebanking.pem
```

Les variables d'environnement sont prioritaires sur la configuration stockée
en base.

## Sidecars bancaires (optionnel)

Les sidecars BoursoBank, BNP Paribas et Fortuneo sont des CLI Python locaux.
Ils ne sont pas inclus dans l'image Docker : pour les utiliser, installez-les
sur la machine hôte et rendez leurs commandes accessibles au processus Node.

```bash
# BNP Paribas
pipx install "git+https://github.com/Romaindujardin/bnp-cli.git@v0.2.0"
pipx inject bnp-cli curl-cffi

# Fortuneo
pipx install "git+https://github.com/Romaindujardin/fortuneo-cli.git@v0.2.0"
```

Puis dans `.env.production` :

```bash
BOURSO_CLI_PATH=/home/portfolio/.local/bin/bourso-cli
BNP_CLI_PATH=/home/portfolio/.local/bin/bnp-direct
FORTUNEO_CLI_PATH=/home/portfolio/.local/bin/fortuneo-sidecar
BNP_MFA_TIMEOUT_SECONDS=180
BNP_TIMEOUT_MS=300000
FORTUNEO_TIMEOUT_MS=180000
```

Avec Docker, montez les binaires et leurs dépendances dans le conteneur, ou
lancez l'application directement avec `npm start` sur l'hôte. Le sidecar est
prioritaire sur Enable Banking dès qu'une connexion sidecar existe pour la
banque. Le code secret BNP et le mot de passe Fortuneo sont demandés à chaque
synchronisation et ne sont jamais enregistrés.

## 4. Lancer

Arrêter d'abord l'éventuel `npm start` local sur le port 3001, sinon Docker ne
pourra pas publier le port.

```bash
mkdir -p data secrets
# Le conteneur tourne avec l'utilisateur node (UID 1000).
# Sur un serveur Linux, s'assurer qu'il peut écrire dans data/ :
sudo chown -R 1000:1000 data secrets
chmod 600 secrets/enablebanking.pem 2>/dev/null || true

docker compose --profile tls up -d --build
docker compose logs -f app
```

Caddy demande automatiquement un certificat Let's Encrypt. Vérifier :

```bash
curl -I https://portfolio.tondomaine.fr
curl https://portfolio.tondomaine.fr/api/health
```

Le navigateur demandera le couple `BASIC_AUTH_USER` /
`BASIC_AUTH_PASSWORD` une fois.

## 5. Déclarer l'URL dans Enable Banking

Dans l'application Enable Banking Production, ajouter exactement :

```text
https://portfolio.tondomaine.fr/api/portfolio/connections/enable-banking/callback
```

Puis reconnecter la banque depuis `Patrimoine > Connexions`. L'URL doit être
identique, caractère pour caractère, à `ENABLE_BANKING_REDIRECT_URI`.

## 6. Mise à jour

```bash
git pull
docker compose --profile tls up -d --build
```

## Sans domaine : Tailscale Funnel

Si tu n'as pas de nom de domaine, Tailscale Funnel peut fournir une URL HTTPS
fixe du type `https://machine.tailnet.ts.net`, sans ouvrir de ports.

1. installer Tailscale sur le serveur (ou la machine qui héberge l'app) ;
2. se connecter et activer HTTPS/Funnel dans la console Tailscale ;
3. lancer l'app, puis `tailscale funnel 3001` ;
4. récupérer l'URL affichée par `tailscale funnel status` ;
5. utiliser cette URL pour `APP_URL` et l'URL de retour Enable Banking.

La machine doit rester allumée et connectée à Tailscale. Funnel est accessible
depuis Internet : garder impérativement la protection Basic auth.

## Sans IP publique : tunnel Cloudflare nommé

Un **Quick Tunnel** (`trycloudflare.com`) change d'URL à chaque redémarrage : il
ne convient pas à une URL de retour Enable Banking stable. Un **tunnel nommé**
avec un domaine Cloudflare donne une URL fixe, sans ouvrir les ports 80/443.

Principe :

1. créer un tunnel nommé dans Cloudflare Zero Trust ;
2. lui associer un hostname public, par exemple
   `portfolio.tondomaine.fr` ;
3. faire pointer le tunnel vers `http://127.0.0.1:3001` (l'app Docker sans
   Caddy) ;
4. mettre `APP_URL=https://portfolio.tondomaine.fr` et la même URL de retour
   Enable Banking ;
5. lancer seulement l'application : `docker compose up -d app`.

Cloudflare termine le HTTPS. Garder la protection Basic auth de l'application,
puisque le tunnel est public.

## Reverse proxy existant

Si Nginx, Traefik ou un autre proxy gère déjà le HTTPS sur le serveur :

```bash
docker compose up -d app
```

Faire pointer le proxy vers `127.0.0.1:3001`. Garder `TRUST_PROXY=1` et
`APP_URL=https://...` dans `.env.production`. Dans ce cas, ne pas démarrer le
profil `tls`.

## Sécurité et comptes

Chaque profil « Romain / Sophie » possède désormais son propre mot de passe
(8 caractères minimum). Le serveur délivre un cookie de session HttpOnly,
SameSite=Lax, valable 7 jours, et refuse toute route `/api` protégée sans
session ou avec un `user_id` différent du profil authentifié (les routes de
santé, de connexion et le callback OAuth restent publics). Les clés API et les
identifiants BoursoBank, le numéro client BNP et l'identifiant Fortuneo sont
chiffrés côté serveur, rattachés au profil, ne sont plus stockés dans le
navigateur et ne sont jamais renvoyés en clair par l'API. Les mots de passe et
codes secrets BNP/Fortuneo ne sont jamais persistés.

La protection HTTP Basic reste utile en défense en profondeur, mais elle ne
remplace pas les mots de passe des profils. Pour un accès public, utiliser un
mot de passe Basic long, ou placer l'application derrière Cloudflare Access, un
VPN (Tailscale/WireGuard) ou un reverse proxy avec authentification.

Les fichiers `data/.portfolio-secret` et `data/.portfolio-session-secret` sont
générés en `0600`. Ne les exposez jamais et sauvegardez-les avec la base.

Le port `3001` est publié uniquement sur `127.0.0.1` par Docker Compose. Ne pas
le changer en `0.0.0.0:3001` : tout passage depuis Internet doit rester derrière
Caddy, Cloudflare ou le reverse proxy TLS.

## Sauvegardes

Sauvegarder régulièrement :

- `data/portfolio.db` (base SQLite) ;
- `data/.portfolio-secret` (clé de chiffrement des secrets) ;
- `data/.portfolio-session-secret` (clé de signature des sessions) ;
- éventuellement `data/*.json` et `backups/` ;
- `.env.production` et `secrets/enablebanking.pem` (à stocker de façon
  sécurisée, jamais dans Git).

Sauvegarde cohérente à chaud (API backup SQLite) :

```bash
npm run db:backup
# ou, en Docker (sauvegarde persistée dans le volume data) :
docker compose exec -e BACKUP_DIR=/app/data/backups app node scripts/backup-database.js

# Purge selon la politique de rétention (30 jours par défaut) :
npm run db:prune-backups
npm run db:prune-backups -- --days 7 --dry-run
```

`BACKUP_RETENTION_DAYS` permet de modifier la rétention. La purge est aussi
exécutée après chaque sauvegarde réussie, et supprime les fichiers annexes
`-wal`/`-shm` des sauvegardes retirées.

Lors de la suppression d'un profil, le serveur applique immédiatement la même
suppression logique aux sauvegardes accessibles dans `BACKUP_DIR`, puis
compacte chaque copie et restaure sa date de modification d'origine. Les
copies externes, hors ligne ou déjà sorties de `BACKUP_DIR` ne peuvent pas être
modifiées : elles restent soumises à la rétention et doivent être détruites
manuellement si nécessaire.

Restauration : arrêter le serveur, puis :

```bash
npm run db:restore -- backups/portfolio-backup-AAAA-MM-JJ.db
# ou, en Docker :
docker compose stop app
docker compose run --rm -e BACKUP_DIR=/app/data/backups app \
  node restore-database.js /app/data/backups/portfolio-backup-AAAA-MM-JJ.db
```

Si des fichiers `-wal`/`-shm` subsistent après l'arrêt, ajoutez `--force`
uniquement après avoir vérifié qu'aucun processus n'utilise la base.

Le script vérifie l'intégrité de la sauvegarde, crée une sauvegarde de sécurité
de la base actuelle et refuse de restaurer si des fichiers `-wal`/`-shm`
indiquent que le serveur tourne encore (sauf `--force`).

## Alternative : frontend Vercel + backend serveur

C'est possible, mais moins simple et **non recommandé** pour cette application :

1. déployer le backend et SQLite sur le serveur ;
2. builder le frontend avec `VITE_API_URL=https://api.tondomaine.fr` ;
3. autoriser cette origine avec `CORS_ORIGINS=https://portfolio.tondomaine.fr` ;
4. configurer Enable Banking avec l'URL du backend.

Le cookie de session et la protection HTTP Basic fournis ici sont prévus pour
un déploiement **même origine**. En mode séparé, les appels du frontend vers
l'API doivent inclure `credentials: "include"`, l'origine doit être autorisée
par `CORS_ORIGINS`, et les deux domaines doivent rester *same-site* pour que le
cookie `SameSite=Lax` soit envoyé. Le plus simple reste le déploiement
mono-serveur, qui évite ces contraintes.
