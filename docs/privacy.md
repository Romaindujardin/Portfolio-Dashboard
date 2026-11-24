# Politique de confidentialité

Dernière mise à jour : 10 novembre 2026

## 1. Responsable du traitement

Cette application est un projet personnel et non commercial de suivi de
patrimoine, auto-hébergé par **Romain Dujardin**.

Contact : [github.com/Romaindujardin](https://github.com/Romaindujardin)

## 2. Données traitées

L'application peut traiter les catégories de données suivantes :

- **Données bancaires** obtenues via Enable Banking : nom du compte, IBAN,
  devise, solde, transactions et informations d'identification du compte.
- **Données patrimoniales** saisies manuellement : biens immobiliers, prêts,
  comptes, positions et parts de propriété.
- **Données de marché** : identifiants de titres, tickers, cours et devises.
- **Secrets d'intégration** : clés API Gemini, Binance, Etherscan, CoinGecko
  et OpenSea, ainsi que les identifiants BoursoBank, le numéro client BNP et
  l'identifiant Fortuneo, uniquement si vous les configurez.
- **Données techniques** : journaux d'erreurs et informations nécessaires au
  fonctionnement de l'application, dont un cookie de session
  `portfolio_session` (HttpOnly, SameSite=Lax, 7 jours).

Avec la connexion Enable Banking, les identifiants et mots de passe bancaires
ne sont **jamais** collectés ni stockés par l'application : l'authentification
est effectuée directement sur le site ou l'application de la banque.

Le sidecar BoursoBank optionnel nécessite l'identifiant client et le mot de
passe BoursoBank. Ils sont chiffrés côté serveur en AES-256-GCM, rattachés au
profil concerné, utilisés uniquement pour exécuter le CLI local de
synchronisation et ne sont jamais renvoyés en clair par l'API. Ils peuvent être
supprimés à tout moment depuis l'application.

Les sidecars BNP Paribas et Fortuneo optionnels mémorisent uniquement le numéro
client BNP ou l'identifiant Fortuneo dans le coffre chiffré. Le code secret BNP
et le mot de passe Fortuneo sont demandés à chaque synchronisation, transmis au
CLI local et **jamais enregistrés**. La validation forte BNP utilise des
fichiers privés éphémères (`0600`) supprimés à la fin du job ; les codes SMS
Fortuneo sont également effacés après usage.

## 3. Finalités et bases légales

Les données sont utilisées uniquement pour :

- afficher et suivre le patrimoine personnel ;
- synchroniser les comptes bancaires auxquels l'utilisateur a consenti ;
- calculer les soldes, les échéances de prêts et les valorisations ;
- produire des estimations immobilières et des cours de marché ;
- assurer le fonctionnement, la sécurité et le diagnostic de l'application.

Le traitement repose sur le consentement de l'utilisateur pour la connexion
bancaire, et sur l'intérêt légitime du responsable pour le fonctionnement de
son application personnelle. Le consentement bancaire peut être retiré à tout
moment en supprimant la connexion correspondante.

## 4. Destinataires et services tiers

Les données peuvent être transmises aux services strictement nécessaires :

- **Enable Banking** et les banques concernées, pour l'accès PSD2 aux comptes ;
- **Google Gemini**, **Binance**, **Etherscan**, **CoinGecko** et **OpenSea**,
  uniquement pour les fonctions que vous utilisez et avec vos propres clés ;
- **Yahoo Finance** et **OpenFIGI**, pour les cours et la résolution des
  identifiants de titres ;
- **IGN**, **DVF/Cerema** et **INSEE**, pour le géocodage et les données
  immobilières ;
- l'hébergement local ou le serveur personnel sur lequel l'application est
  installée.

Seules les données nécessaires à chaque service sont transmises. Les données
bancaires ne sont pas vendues et ne sont pas utilisées à des fins publicitaires.

## 5. Transferts hors Union européenne

Certains fournisseurs de données de marché peuvent être situés hors de l'Union
européenne. Les requêtes qui leur sont adressées concernent les identifiants de
titres et les cours, et non les données bancaires personnelles.

## 6. Durée de conservation

Les données sont conservées localement tant que l'utilisateur ne les supprime
pas. La suppression d'un profil via l'application efface ses données, ses
secrets et ses identifiants, et invalide sa session. La suppression d'une
connexion bancaire révoque la session associée lorsque la banque le permet.

Les sauvegardes SQLite sont conservées **30 jours par défaut**
(`BACKUP_RETENTION_DAYS`). La purge est appliquée après chaque sauvegarde
réussie et peut être lancée manuellement avec `npm run db:prune-backups`. Lors
de la suppression d'un profil, ses données, secrets et identifiants sont
également retirés immédiatement des sauvegardes accessibles dans `BACKUP_DIR`
avant compactage. Les copies externes, hors ligne ou déjà déplacées hors de ce
répertoire ne peuvent pas être modifiées automatiquement : elles restent
soumises à la rétention ou doivent être détruites manuellement. Pour purger
toutes les sauvegardes immédiatement, lancer la purge avec `--days 0`.

## 7. Sécurité

Les secrets d'intégration (Enable Banking, Gemini, Binance, Etherscan,
CoinGecko, OpenSea) sont chiffrés côté serveur avec AES-256-GCM et ne sont
jamais renvoyés en clair par l'API. Les sessions sont signées côté serveur et
transportées par un cookie HttpOnly ; les mots de passe des profils sont
hachés avec scrypt et un sel unique. L'application est destinée à un usage
local et personnel. L'utilisateur reste responsable de la sécurité de son
appareil, de ses sauvegardes et de l'exposition éventuelle de l'application sur
un réseau.

## 8. Droits de l'utilisateur

L'utilisateur peut demander l'accès, la rectification ou la suppression de ses
données, retirer son consentement bancaire et supprimer les données locales.
Ces demandes peuvent être adressées via le contact indiqué ci-dessus.

## 9. Cookies et mesure d'audience

L'application n'utilise pas de cookies publicitaires ni de mesure d'audience
commerciale. Le cookie `portfolio_session` est strictement nécessaire à
l'authentification et à la sécurité des profils. Des mécanismes de stockage
local peuvent être utilisés pour le fonctionnement de l'interface et la
persistance de certaines préférences ; les clés API n'y sont jamais stockées.

## 10. Modifications

Cette politique peut être mise à jour pour refléter une évolution de
l'application ou de la réglementation. La date de mise à jour figure en tête de
ce document.
