# 🪙 Portfolio — Gestion de Budget, Épargne & Patrimoine

Application personnelle et complète de gestion de patrimoine, de budget de foyer et de stratégie financière : connexion bancaire PSD2 multi-banques (Enable Banking), valorisation immobilière automatisée, suivi des prêts avec amortissement, budget partagé façon **Tricount**, stratégie d'épargne avec calcul d'objectifs, et **Conseiller IA (Gemini 2.5 Flash)** contextualisé avec vos finances réelles.

Conçue selon une philosophie **Local-First** avec **SQLite**, ultra-rapide, sécurisée (chiffrement AES-256-GCM), exécutable localement sur votre machine ou déployable sur votre propre serveur/VPS avec HTTPS automatique.

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
| **Base de données** | SQLite local (`portfolio.db`), persistance disque garantie |
| **Sécurité** | Chiffrement AES-256-GCM des clés privées et secrets, HTTP Basic Auth en production |
| **Intelligence Artificielle** | Google Gemini 2.5 Flash |
| **Open Banking** | Enable Banking API (PSD2 / AIS via JWT RS256 signés localement) |
| **Sources de données** | Yahoo Finance, OpenFIGI, DVF / Cerema, IGN Géoplateforme, INSEE, CoinGecko, Binance, Etherscan |

---

## 🐳 Pourquoi Docker, Dockerfile & Caddy ?

Vous trouverez à la racine un `Dockerfile`, un `docker-compose.yml` et un dossier `deploy/Caddyfile` :
- **Pour le local au quotidien** : Vous n'avez pas besoin de Docker (`npm start` suffit).
- **Pour l'accès mobile & serveur permanent** : Si vous souhaitez héberger l'application sur un mini-PC, NAS ou VPS afin d'y accéder depuis votre smartphone, Docker Compose démarre l'application derrière **Caddy**. Caddy génère et renouvelle **automatiquement un certificat HTTPS Let's Encrypt gratuit** pour votre nom de domaine.
- C'est ce qui garantit une URL HTTPS stable et permanente requise par les redirections bancaires d'Enable Banking.

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

---

## 🗺️ Feuille de Route (Roadmap)

Voici les prochaines évolutions planifiées pour enrichir l'application :

### 📈 1. Suivi Live des Cours d'Actions & Marchés Boursiers
- Intégration en temps réel des cotations d'actions et ETF via l'API de marché (Yahoo Finance).
- Recherche dynamique de titres par ticker ou ISIN avec autocomplétion.
- Graphiques boursiers interactifs (intraday, 1M, 6M, 1A, max) et mini-sparklines dans la vue Portefeuille.
- Suivi des principaux indices de référence (CAC 40, S&P 500, MSCI World).

### 🔄 2. Passerelle Directe Enable Banking ➔ Module Banque & Tricount
- Possibilité d'injecter directement les opérations bancaires récupérées par l'Open Banking dans la table des transactions de la page Banque.
- Catégorisation IA automatique à la volée dès la synchronisation bancaire.
- Affectation directe des dépenses synchronisées au **Budget Tricount** (Romain / Sophie / 50-50) sans avoir besoin d'importer manuellement des fichiers CSV.

### 🧠 3. Enrichissement du Conseiller IA Gemini
- Connexion native de toutes les données du module Patrimoine au contexte du Conseiller IA :
  - Connaissance des mensualités de prêts et du capital restant dû.
  - Connaissance des valorisations immobilières nettes (patrimoine brut vs dettes).
  - Conseils personnalisés sur l'arbitrage entre remboursement anticipé de crédit et investissement en Bourse/Crypto.

### 🔍 4. Analyse Approfondie & Look-Through des ETF
- Décomposition sectorielle (Technologie, Santé, Finance, Énergie, etc.) et géographique (États-Unis, Europe, Marchés Émergents) des ETF détenus en portefeuille.
- Calcul de l'exposition réelle aux plus grandes entreprises mondiales (Apple, Microsoft, LVMH, etc.) à travers les différentes enveloppes d'investissement.

---

## 🧪 Tests & Qualité

Le projet dispose d'une suite de tests complète (150 tests automatisés avec Vitest) garantissant la fiabilité des calculs financiers, du chiffrement et des synchronisations :

```bash
npm test              # Exécute l'ensemble des 150 tests
npm run test:watch    # Mode surveillance interactif
npm run test:coverage # Rapport de couverture de code
npm run type-check    # Vérification stricte TypeScript
npm run lint          # Analyse ESLint
```

Les tests s'exécutent sur une base SQLite temporaire isolée sans jamais altérer votre base de données réelle `portfolio.db`.

---

## 📄 Licence

Ce projet est distribué sous licence MIT.
