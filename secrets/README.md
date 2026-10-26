# Secrets de déploiement

Ce dossier est ignoré par Git, sauf ce fichier.

Place ici la clé privée Enable Banking de production, par exemple :

```text
secrets/enablebanking.pem
```

Puis, dans `.env.production` :

```bash
ENABLE_BANKING_APP_ID=...
ENABLE_BANKING_PRIVATE_KEY_PATH=/app/secrets/enablebanking.pem
```

La clé doit rester en permissions `600` :

```bash
chmod 600 secrets/enablebanking.pem
```

Le conteneur monte ce dossier en lecture seule sur `/app/secrets`.
