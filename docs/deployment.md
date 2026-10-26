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
```

Pour le mot de passe, on peut générer une valeur sans caractères spéciaux :

```bash
openssl rand -hex 24
```

Le nom de domaine doit être le même partout : `APP_DOMAIN`, `APP_URL` et l'URL
de retour Enable Banking.

## 2. Récupérer les données existantes

Arrêter l'application locale, puis sauvegarder la base proprement :

```bash
mkdir -p data
sqlite3 portfolio.db ".backup 'data/portfolio.db'"
```

Copier sur le serveur :

- `data/portfolio.db` ;
- `data/.portfolio-secret` (indispensable pour déchiffrer les clés déjà
  enregistrées) ;
- éventuellement les autres fichiers de `data/` et `backups/`.

Si `data/.portfolio-secret` est perdu, les secrets stockés en base ne peuvent
plus être déchiffrés. On peut aussi fournir la même clé via
`PORTFOLIO_SECRET_KEY`.

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

L'application n'a pas de système de comptes avec mots de passe séparés : les
profils « Romain / Sophie » du frontend sont des profils de données, pas une
barrière de sécurité.

La protection HTTP Basic protège l'application entière, mais avec **un seul
compte partagé**. Pour un accès public, utiliser un mot de passe long, ou placer
l'application derrière Cloudflare Access, un VPN (Tailscale/WireGuard) ou un
reverse proxy avec authentification.

Le port `3001` est publié uniquement sur `127.0.0.1` par Docker Compose. Ne pas
le changer en `0.0.0.0:3001` : tout passage depuis Internet doit rester derrière
Caddy, Cloudflare ou le reverse proxy TLS.

## Sauvegardes

Sauvegarder régulièrement :

- `data/portfolio.db` (base SQLite) ;
- `data/.portfolio-secret` (clé de chiffrement) ;
- éventuellement `data/*.json` et `backups/` ;
- `.env.production` et `secrets/enablebanking.pem` (à stocker de façon
  sécurisée, jamais dans Git).

Exemple à chaud :

```bash
sqlite3 data/portfolio.db ".backup 'backups/portfolio-$(date +%F).db'"
```

## Alternative : frontend Vercel + backend serveur

C'est possible, mais moins simple et **non recommandé** pour cette application :

1. déployer le backend et SQLite sur le serveur ;
2. builder le frontend avec `VITE_API_URL=https://api.tondomaine.fr` ;
3. autoriser cette origine avec `CORS_ORIGINS=https://portfolio.tondomaine.fr` ;
4. configurer Enable Banking avec l'URL du backend.

La protection HTTP Basic fournie ici est prévue pour un déploiement **même
origine**. En mode séparé, les appels du frontend vers l'API ne porteront pas
automatiquement les identifiants : il faudrait ajouter une authentification par
token ou placer l'API derrière un VPN/Cloudflare Access. Le déploiement
mono-serveur évite ces problèmes.
