# Portfolio

Application personnelle de suivi de patrimoine : banque (CSV), crypto (wallets + CEX), budget partagé, stratégie d'épargne et analyse IA. Stockage local en **SQLite**, serveur API local uniquement.

## 🚀 Fonctionnalités

- **Dashboard** : patrimoine net (courbe avec historique quotidien), comptes bancaires (CSV), wallets crypto & NFTs, graphiques de flux
- **Portefeuille** : wallets blockchain (Etherscan) et Binance (CEX), assets masquables, NFTs
- **Budget & Tricount** : dépenses/revenus, répartition Romain/Sophie, poches budgétaires
- **Épargne** : stratégie d'allocation par poches + simulation avec intérêts composés
- **Banque** : import de relevés CSV, mapping de colonnes, synchronisation Bourso
- **Conseiller IA** : Gemini répond à vos questions en langage naturel (achat immobilier, rééquilibrage, fiscalité) avec vos comptes, lignes (PEA, PEE, assurance vie), wallets crypto et stratégie d'épargne joints
- **🗄️ SQLite** : stockage local fiable (`portfolio.db`)

## 🔧 Technologies

- **Frontend** : React 18 + TypeScript 5 + Vite
- **Styling** : Tailwind CSS · **Graphiques** : Recharts
- **API** : Express (bind `127.0.0.1`, CORS local uniquement) + better-sqlite3
- **Données** : CoinGecko (prix crypto), Binance (tickers), Etherscan (wallets), OpenSea (NFTs)
- **IA** : Gemini AI

## 📊 Sources de données

| Donnée | Source | Clé API |
| --- | --- | --- |
| Wallets blockchain | Etherscan | Requise (gratuite) |
| NFTs | OpenSea | Requise |
| Prix crypto | CoinGecko | Optionnelle |
| Comptes Binance | API Binance | Requise (lecture) |
| Conseiller IA | Gemini | Requise |
| Comptes bancaires | CSV importés | — |

## 🗄️ Base de données SQLite

Un seul fichier `portfolio.db` (non versionné). Tables principales :

```sql
wallets (id, user_id, name, address, wallet_type, blockchains, total_value, ...)
wallet_assets (id, wallet_id, symbol, name, balance, blockchain, price, value, is_hidden, ...)
wallet_nfts (id, wallet_id, token_id, name, collection, image, is_hidden, ...)
bank_csv_uploads (id, user_id, file_name, content, uploaded_at, ...)
tricount_expenses / tricount_incomes (budget partagé)
user_settings (user_id, settings_json)
```

## 🚀 Installation et démarrage

### Prérequis

- Node.js 18+

```bash
npm install
npm start        # serveur API (3001) + client Vite (5173) en parallèle
```

Ou séparément :

```bash
npm run server   # API locale http://127.0.0.1:3001
npm run dev      # Client http://localhost:5173
```

### Vérifications

```bash
npm run type-check   # TypeScript strict
npm run lint         # ESLint
npm run build        # Build de production
curl http://127.0.0.1:3001/api/database/stats
```

## 🔑 Configuration

Toutes les clés API se configurent via l'interface : **Paramètres > Clés API**.

- **Gemini AI** : conseiller patrimonial (contexte joints : comptes, lignes, crypto, stratégie)
- **Etherscan** / **OpenSea** : wallets et NFTs
- **Binance** : connexion du compte CEX
- **CoinGecko** : optionnel (limites plus hautes)
- **Bourso** : synchronisation des comptes (identifiants stockés par le CLI `bourso-api`, jamais par cette app)

## 📁 Structure du projet

```
├── src/
│   ├── components/            # Composants React
│   ├── pages/                 # Dashboard, Investments, Banking, BudgetTricount, Savings, AIAnalysis, Settings
│   ├── utils/
│   │   ├── storage.ts         # Persistance (wallets, CSV bancaires)
│   │   ├── databaseService.ts # Client de l'API locale
│   │   ├── database/          # Gestionnaire SQLite (Node)
│   │   ├── blockchainService.ts / binanceService.ts / cryptoDatabase.ts
│   │   ├── geminiAI.ts        # Conseiller IA (Gemini) + aiContext.ts (collecte du contexte)
│   │   └── tricountStorage.ts / savingsStorage.ts
│   └── types/
├── server.js                  # API locale (Express)
├── public/                    # Favicon, placeholder NFT
└── portfolio.db               # Base SQLite (générée, non versionnée)
```

## 🧪 Tests

La suite de tests (Vitest) couvre l'API serveur, les flux de stockage front, les utilitaires purs et la couche SQLite :

```bash
npm test              # Lance toute la suite (83 tests)
npm run test:watch    # Mode surveillance
npm run test:coverage # Rapport de couverture
```

Le serveur de test est lancé automatiquement sur un **port libre dédié** avec une
**base SQLite temporaire** (`.test-tmp/`), sans toucher à `portfolio.db` ni aux
données réelles. En cas d'échec, les logs du serveur restent dans
`.test-tmp/server.log` (conservés avec `KEEP_TEST_TMP=1`).

## 🛠️ Résolution de problèmes

```bash
lsof -i :3001             # Le serveur ne démarre pas ?
pkill -f "node server.js"

rm portfolio.db && npm run db:init   # Réinitialiser la base
npm run db:restore                   # Restaurer depuis un backup
```

## 📄 Licence

MIT License - voir LICENSE pour détails
