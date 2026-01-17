# Portfolio

Application complète de suivi de portefeuille d'investissements avec données temps réel via Yahoo Finance et **base de données SQLite**.

## 🚀 Fonctionnalités

- **Dashboard** : Vue d'ensemble du portefeuille avec graphiques et statistiques
- **Gestion d'investissements** : Ajout, modification, suppression avec prix temps réel
- **Suivi de marché** : Watchlist pour actions et cryptomonnaies
- **Actualités financières** : Flux d'actualités avec filtres
- **Analyse IA** : Analyse de portefeuille avec recommandations Gemini AI
- **Données temps réel** : Prix Yahoo Finance sans limitations
- **🗄️ Base de données SQLite** : Stockage fiable et performant

## 🔧 Technologies

- **Frontend** : React 18 + TypeScript + Vite
- **Styling** : Tailwind CSS
- **Charts** : Recharts
- **Routing** : React Router
- **API** : Yahoo Finance 2 + Express proxy
- **IA** : Gemini AI
- **🗄️ Base de données** : SQLite avec better-sqlite3

## 📊 Sources de données

### Actions (70+ titres)

- **Source** : Yahoo Finance via serveur proxy local
- **Couverture** : US (NASDAQ/NYSE), Europe (Euronext), UK (LSE), Suisse (SIX)
- **Mise à jour** : Temps réel avec cache 5 minutes
- **Avantages** : Aucune limitation, pas de clé API requise

### Cryptomonnaies (1000+ cryptos)

- **Source** : CoinGecko API
- **Mise à jour** : Automatique toutes les 10 minutes
- **Recherche** : Instantanée dans la base locale

### Analyse IA

- **Source** : Gemini AI
- **Fonctions** : Analyse de portefeuille, recommandations, évaluation des risques

## 🗄️ Base de Données SQLite

### **Avantages de SQLite**

- **🔒 Fiabilité** : Données persistantes et sécurisées
- **⚡ Performance** : Requêtes rapides avec index optimisés
- **📁 Portable** : Un seul fichier `portfolio.db`
- **🛡️ Intégrité** : Contraintes et transactions ACID
- **🔄 Migration** : Import automatique depuis localStorage

### **Structure de la base**

```sql
-- Investissements
investments (id, name, type, symbol, quantity, purchase_price, current_price, ...)

-- Watchlist
watchlist (id, symbol, name, type, added_at)

-- Wallets blockchain
wallets (id, name, address, wallet_type, blockchains, total_value, ...)

-- Assets des wallets
wallet_assets (id, wallet_id, symbol, name, balance, blockchain, price, ...)
```

## 🚀 Installation et démarrage

### Prérequis

- Node.js 18+
- npm ou yarn

### Installation

```bash
git clone <repository>
cd Portfolio
npm install
```

### Démarrage rapide

```bash
# Option 1: Script automatique (Recommandé)
./start.sh

# Option 2: Commandes séparées
npm run server  # Terminal 1: Serveur proxy + Base de données
npm run dev     # Terminal 2: Application React

# Option 3: Démarrage simultané
npm start
```

### URLs

- **Application** : http://localhost:5173
- **Serveur proxy** : http://localhost:3001
- **Test API** : http://localhost:3001/api/test
- **Stats DB** : http://localhost:3001/api/database/stats

## 🔑 Configuration

### Configuration initiale

1. Copier le fichier de configuration :
```bash
cp .env.example .env
```

2. Modifier `.env` selon vos besoins (optionnel) :
```bash
VITE_API_URL=http://localhost:3001
PORT=3001
```

### Clés API (via l'interface)

Toutes les clés API sont configurables via l'interface utilisateur :
**Paramètres > Clés API**

- **Gemini AI** : Pour l'analyse de portefeuille
- **Etherscan** : Pour scanner les wallets Ethereum
- **OpenSea** : Pour les NFTs
- **Binance** : Pour connecter votre compte CEX
- **CoinGecko** : Pour les prix crypto (optionnel)

### Aucune clé requise pour démarrer !

- Yahoo Finance : Gratuit via serveur proxy
- CoinGecko : Gratuit jusqu'à 50 requêtes/minute (sans clé)
- SQLite : Aucune configuration requise

## 📁 Structure du projet

```
Portfolio/
├── src/
│   ├── components/          # Composants React
│   ├── pages/              # Pages principales
│   ├── utils/              # Services et utilitaires
│   │   ├── api.ts          # API unifiée
│   │   ├── stockDatabase.ts # Base actions Yahoo Finance
│   │   ├── cryptoDatabase.ts # Base crypto CoinGecko
│   │   ├── geminiAI.ts     # Service Gemini AI
│   │   ├── storage.ts      # Interface de persistance
│   │   ├── databaseService.ts # Service SQLite
│   │   └── database/       # Gestionnaire SQLite
│   │       ├── database.ts # Manager principal
│   │       ├── init.js     # Script d'initialisation
│   │       └── migrate.js  # Script de migration
│   └── types/              # Types TypeScript
├── server.js               # Serveur proxy + API DB
├── portfolio.db            # Base de données SQLite
├── start.sh               # Script de démarrage
└── package.json
```

## 🎯 Utilisation

### 1. Ajouter un investissement

- Recherche instantanée dans le catalogue
- Prix récupéré automatiquement
- Support actions internationales et crypto
- **💾 Sauvegarde automatique en SQLite**

### 2. Suivi en temps réel

- Bouton 🔄 pour actualiser les prix
- Cache intelligent 5 minutes
- Pas de limitations API
- **📊 Données persistantes et fiables**

### 3. Analyse IA

- Page "Analyse IA" dans le menu
- Évaluation automatique du portefeuille
- Recommandations personnalisées

### 4. Gestion des données

```bash
# Initialiser la base de données
npm run db:init

# Migrer depuis localStorage
npm run db:migrate

# Voir les statistiques
curl http://localhost:3001/api/database/stats
```

## 🔧 Développement

### Structure des API

#### Actions (Yahoo Finance)

```javascript
// Recherche dans le catalogue
const stocks = searchStocks("AAPL");

// Prix temps réel
const price = await getStockPrice("AAPL");

// Actualisation forcée
const newPrice = await refreshStockPrice("AAPL");
```

#### Cryptomonnaies (CoinGecko)

```javascript
// Recherche dans la base locale
const cryptos = searchCryptos("bitcoin");

// Prix depuis la base (mis à jour auto)
const crypto = getCryptoBySymbol("bitcoin");
```

#### Base de données SQLite

```javascript
// Service de base de données
import databaseService from "./utils/databaseService";

// Récupérer les investissements
const investments = databaseService.getStoredInvestments();

// Ajouter un investissement
databaseService.addInvestment(newInvestment);

// Statistiques
const stats = databaseService.getDatabaseStats();
```

### Ajout de nouvelles actions

Modifier `STOCK_CATALOG` dans `src/utils/stockDatabase.ts` :

```javascript
{
  symbol: "NOUVEAU.PA",
  name: "Nouvelle Société",
  market: "EU",
  currency: "EUR",
  exchange: "Euronext Paris",
}
```

## 🛠️ Résolution de problèmes

### Serveur proxy ne démarre pas

```bash
# Vérifier le port 3001
lsof -i :3001

# Redémarrer
pkill -f "node server.js"
npm run server
```

### Erreurs de base de données

```bash
# Réinitialiser la base de données
rm portfolio.db
npm run db:init

# Vérifier les permissions
ls -la portfolio.db
```

### Données manquantes

```bash
# Test du serveur
curl http://localhost:3001/api/test

# Test d'un prix
curl http://localhost:3001/api/price/AAPL

# Statistiques de la base
curl http://localhost:3001/api/database/stats
```

## 📈 Performances

- **Recherche** : Instantanée (catalogue local)
- **Prix** : Cache 5 minutes, < 1s si non-caché
- **Crypto** : Mise à jour auto 10 minutes
- **Base de données** : Requêtes < 10ms avec index
- **Limitations** : Aucune ! 🎉

## 🔄 Migration depuis localStorage

Si vous avez des données dans localStorage, elles seront automatiquement migrées vers SQLite :

```bash
# Migration manuelle si nécessaire
npm run db:migrate

# Vérifier la migration
curl http://localhost:3001/api/database/stats
```

## 🤝 Contribution

1. Fork le projet
2. Créer une branche feature
3. Commit des changements
4. Push vers la branche
5. Ouvrir une Pull Request

## 📄 Licence

MIT License - voir LICENSE pour détails

---

**Note** : Cette application utilise SQLite pour un stockage fiable et performant, remplaçant le localStorage pour une meilleure fiabilité et gestion des données.
