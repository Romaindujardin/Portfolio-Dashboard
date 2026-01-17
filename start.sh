#!/bin/bash

echo "🚀 Démarrage du Portfolio avec Base de Données SQLite"
echo "📊 Serveur proxy: http://localhost:3001"
echo "🌐 Application: http://localhost:5173"
echo "🗄️ Base de données: SQLite (portfolio.db)"
echo ""

# Stop any previous server still listening on 3001 (prevents stale routes)
OLD_SERVER_PID=$(lsof -nP -iTCP:3001 -sTCP:LISTEN 2>/dev/null | awk 'NR==2{print $2}')
if [ ! -z "$OLD_SERVER_PID" ]; then
    echo "🛑 Arrêt de l'ancien serveur (PID $OLD_SERVER_PID) sur le port 3001..."
    kill "$OLD_SERVER_PID" 2>/dev/null || true
    sleep 0.5
fi

# Vérifier si les dépendances sont installées
if [ ! -d "node_modules" ]; then
    echo "📦 Installation des dépendances..."
    npm install
fi

# Initialiser la base de données si elle n'existe pas
if [ ! -f "portfolio.db" ]; then
    echo "🗄️ Initialisation de la base de données SQLite..."
    npm run db:init
fi

# Démarrer le serveur proxy et l'application en parallèle
echo "🚀 Démarrage des services..."
node server.js &
npm run dev 