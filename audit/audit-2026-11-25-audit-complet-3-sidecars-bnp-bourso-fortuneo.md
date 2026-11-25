# Audit complet des trois sidecars bancaires

**BNP Paribas · BoursoBank · Fortuneo**

| | |
|---|---|
| **Date de l'audit** | 25 novembre 2026 |
| **Objet** | Vérifier le fonctionnement réel des trois sidecars, leur parité fonctionnelle et leur intégration dans Portfolio-Dashboard |
| **Périmètre** | Services serveur, routes API, interface, tests, documentation, CLI et schémas d'export des trois sidecars |
| **Version auditée** | Commit `d0686f8` (`fix(fortuneo): traiter les liquidités comme du cash sans position synthétique`) |
| **Nature** | Audit documentaire et vérification empirique sur une copie en lecture seule de la base |
| **Modifications de code** | Aucune |

---

## 1. Synthèse exécutive

**Les trois sidecars ne fonctionnent pas à l'identique.**

BNP Paribas et Fortuneo partagent une architecture très proche : job asynchrone, validation forte par fichiers privés, identifiant mémorisable, mot de passe jamais stocké, priorité sur Enable Banking, erreurs structurées. BoursoBank suit un chemin différent : synchronisation HTTP synchrone, mot de passe mémorisable par défaut, aucune validation forte pilotée par l'interface, aucun job, aucun mécanisme de priorité, et plusieurs erreurs partielles silencieuses.

Les principaux risques identifiés ne sont pas des vulnérabilités critiques au sens intrusion, mais des **risques de données financières** :

1. **Liquidités BoursoBank pouvant devenir obsolètes** : le `cash_balance` d'un compte-titres n'est pas mis à jour à chaque synchronisation ; un écart a été observé en base entre le solde du compte et son cash mémorisé.
2. **Positions disparues non supprimées** : BoursoBank et Fortuneo ne réconcilient jamais les holdings absents du nouvel export. Une position vendue peut rester indéfiniment dans le patrimoine.
3. **Comptes disparus non archivés** : aucun des trois sidecars n'archive les comptes absents d'un export réussi. Un compte clôturé peut continuer à peser dans la synthèse.
4. **Historique de patrimoine incomplet** : les sidecars n'enregistrent aucun `balance_snapshot`, contrairement à Enable Banking. La courbe de patrimoine ignore donc les comptes sidecar.
5. **Parité BoursoBank incomplète** : pas de job, pas de challenge MFA dans l'interface, timeout serveur de 120 s alors que le CLI peut attendre 300 s, pas de priorité sur Enable Banking, erreurs de positions/transactions non remontées.

**Verdict de parité** : BNP et Fortuneo sont fonctionnellement alignés à environ 85–90 %. BoursoBank est aligné à environ 50–60 % et constitue le principal chantier de mise à niveau.

**État de santé du projet** : 281 tests passent, le type-check est propre, le lint ne remonte aucune erreur (27 avertissements). Les tests spécifiques aux sidecars sont cependant déséquilibrés : BoursoBank n'a pas de test d'intégration complet de synchronisation.

---

## 2. Méthodologie

L'audit a combiné quatre sources :

1. **Lecture intégrale du code d'intégration** des trois services, des modules partagés, des routes, de l'interface et du repository.
2. **Lecture des projets CLI** : contrats, schémas JSON, authentification, validation forte, capacités en lecture/écriture, timeouts.
3. **Vérification empirique** sur une copie de la base active (`portfolio.db` + WAL), ouverte en lecture seule après checkpoint. Seuls des agrégats ont été extraits : aucun libellé de compte, solde, position, ISIN, identifiant ou secret n'est reproduit dans ce rapport.
4. **Exécution de la suite de vérification** : `npm test`, `npm run type-check`, `npm run lint`.

Limites :

- Aucun appel bancaire réel n'a été effectué pendant l'audit.
- Les comportements dépendant de la banque (MFA, QR code, disponibilité des positions) sont analysés à partir du code et des contrats CLI, pas d'une session live.
- La copie de base représente l'état observé au 25 novembre 2026 ; elle ne prouve pas à elle seule un comportement futur.

---

## 3. Architecture et flux

### 3.1 Côté Portfolio-Dashboard

| Élément | Rôle |
|---|---|
| `server/services/bnpSidecarService.js` | Intégration BNP : job, MFA par broker de fichiers, import comptes/transactions |
| `server/services/boursoSidecarService.js` | Intégration Bourso : exécution synchrone, comptes/positions/transactions, credentials |
| `server/services/fortuneoSidecarService.js` | Intégration Fortuneo : job, OTP par broker de fichiers, comptes/transactions/positions |
| `server/services/sidecarPriority.js` | Priorité sidecar sur Enable Banking, marquage et archivage |
| `server/services/sidecarProcess.js` | Exécution contrôlée des CLI, allowlist d'environnement, timeouts, redaction |
| `server/services/sidecarFormat.js` | Conversions partagées (nombres, dates, entités HTML, classes d'actifs) |
| `server/services/syncService.js` | Orchestration, `syncAll`, déconnexion, snapshots Enable Banking |
| `server/services/portfolioRepository.js` | Persistance comptes, transactions, holdings, snapshots, lecture du patrimoine |
| `server/routes/portfolio.js` | Routes `/sidecar/bnp/*`, `/sidecar/bourso/*`, `/sidecar/fortuneo/*` |
| `src/components/patrimoine/ConnectionsTab.tsx` | Modales de connexion, polling MFA/OTP, messages de résultat |
| `src/services/portfolioApi.ts` | Types et appels API des sidecars |

### 3.2 Flux nominal

**BNP**

1. L'utilisateur saisit le numéro client (mémorisable) et le code secret à 6 chiffres (jamais stocké).
2. Le serveur crée un job et un répertoire privé `0700`.
3. Le CLI `bnp-direct` reçoit le code par `stdin`, écrit une demande MFA `0600`, attend la réponse.
4. L'interface soumet le code ou l'action ; le CLI produit un export JSON versionné.
5. Le service importe les comptes et transactions de tous les comptes, puis marque et archive les comptes Enable Banking BNP.

**BoursoBank**

1. L'utilisateur saisit l'identifiant et le mot de passe (mémorisables par défaut).
2. Le serveur crée un `HOME` temporaire, y écrit `settings.json` en `0600`, puis lance `bourso-cli`.
3. Le CLI se connecte, peut demander une validation dans l'application mobile ou un QR code, puis écrit des comptes en Debug Rust et des CSV.
4. Le service importe les comptes, les positions des comptes `trading` et les transactions des comptes `banking`.
5. La réponse HTTP n'est renvoyée qu'à la fin ; il n'y a ni job, ni polling, ni annulation.

**Fortuneo**

1. L'utilisateur saisit l'identifiant (mémorisable) et le mot de passe (jamais stocké).
2. Le serveur crée un job et un répertoire privé `0700`.
3. Le CLI reçoit le mot de passe par `stdin`, écrit une demande OTP `0600`, attend la réponse.
4. L'interface soumet le code SMS ; le CLI produit un export JSON versionné.
5. Le service importe les comptes, transactions et positions, traite les liquidités comme du cash, puis marque et archive les comptes Enable Banking Fortuneo.

---

## 4. Matrice comparative

| Critère | BNP Paribas | BoursoBank | Fortuneo |
|---|---|---|---|
| **Contrat CLI** | JSON versionné `bnp-sidecar/export/v1` | Sortie Debug Rust + CSV, sans schéma versionné | JSON versionné `fortuneo-sidecar/export/v1` |
| **Lecture seule** | Oui, par conception | Non : le CLI expose `trade` et `transfer` ; le dashboard n'appelle que les commandes de lecture | Oui, par conception et test dédié |
| **Découverte du CLI** | `BNP_CLI_PATH`, workspace, `~/.local/bin`, `PATH` | `BOURSO_CLI_PATH`, `../bourso-api/target/{release,debug}` uniquement | `FORTUNEO_CLI_PATH`, workspace, `~/.local/bin`, `PATH` |
| **Mode d'exécution** | Job asynchrone | Requête HTTP synchrone | Job asynchrone |
| **Réponse API de démarrage** | `202` + `jobId` | `200` + résultat complet | `202` + `jobId` |
| **Validation forte** | Broker de fichiers MFA (SMS ou action) | Validation dans l'application mobile ou QR code, sans broker dashboard | Broker de fichiers OTP (SMS) |
| **Timeout par défaut** | 300 s, aligné sur MFA (180 s + 120 s) | 120 s, alors que le CLI peut attendre 300 s | 300 s, aligné sur OTP (180 s + 120 s) |
| **Annulation** | Oui (`DELETE` job + kill) | Non | Oui (`DELETE` job + kill) |
| **Identifiant mémorisé** | Numéro client | Identifiant client | Identifiant |
| **Mot de passe mémorisé** | Non | **Oui, par défaut** | Non |
| **Comptes importés** | Tous | Tous | Tous |
| **Transactions importées** | Tous les comptes | Comptes `banking` uniquement | Comptes avec historique (`banking`, `savings`, `trading`, etc.) |
| **Positions importées** | Aucune (non exposées par le CLI) | Comptes `trading` uniquement | Comptes `trading` et `insurance` |
| **Liquidités** | Pas de `cash_balance` ; le solde porte la valeur | `cash_balance` calculé, mais mise à jour conditionnelle | `cash_balance` calculé ; ligne `XX-liquidity` exclue |
| **Priorité Enable Banking** | Oui, marquage + archivage | **Non** | Oui, marquage + archivage |
| **Suppression des holdings obsolètes** | Sans objet | **Non** | **Non** (seule la ligne `XX-liquidity` est supprimée) |
| **Archivage des comptes absents** | Non | Non | Non |
| **Snapshots de solde** | Non | Non | Non |
| **Erreurs par compte** | Oui, structurées | Partiellement : positions/transactions seulement `console.warn` | Oui, structurées |
| **Statut `partial`** | Oui | Uniquement pour erreurs de compte externe | Oui |
| **Rate limiting des credentials** | Oui | **Non** | Oui |
| **Garde de concurrence par profil** | Oui | **Non** | Oui |
| **Validation du `connectionId`** | Oui (provider vérifié) | **Non** | Oui |
| **UI de suivi** | Polling job + MFA | Attente bloquante, pas de challenge | Polling job + OTP |
| **Bannière CLI indisponible** | Oui | **Non** | Oui |
| **Tests d'intégration complets** | Oui | **Non** | Oui |

---

## 5. Vérifications empiriques

### 5.1 Agrégats observés

| Provider | Connexions | Comptes | Holdings | Transactions | Runs en erreur | Snapshots |
|---|---:|---:|---:|---:|---:|---:|
| `bnp-sidecar` | 1 | 6 | 0 | 496 | 1 | 0 |
| `bourso-sidecar` | 1 | 4 | 2 | 1 325 | 3 | 0 |
| `fortuneo-sidecar` | 1 | 4 | 3 | 16 | 5 | 0 |
| `enable-banking` | 1 | 3 (tous archivés) | 0 | 326 | 0 | 9 |

Autres constats agrégés :

- Les 3 comptes Enable Banking présents sont archivés et la connexion BNP est marquée `sidecarLinked` : la priorité BNP a bien fonctionné.
- Les transactions BoursoBank sont toutes rattachées à **un seul compte**, de type courant. Les comptes épargne et titres n'ont aucune transaction importée.
- Les 3 positions Fortuneo observées n'ont **ni ticker ni ISIN** ; elles ne portent que des métadonnées de code Fortuneo, souvent vides. Leur valorisation dépend donc du prix fourni par le sidecar.
- Aucun snapshot de solde n'a été créé pour un compte sidecar, alors que les sources Enable Banking, crypto et CSV en ont créé.
- Aucun run ne reste bloqué en `running` dans la copie auditée.
- Un compte-titres BoursoBank sans position présente un `cash_balance` différent de son solde, ce qui confirme le défaut de mise à jour du cash.

### 5.2 Ce que les agrégats ne disent pas

Les agrégats ne permettent pas de conclure à eux seuls que les holdings sont obsolètes : un holding plus ancien qu'un run peut simplement avoir été importé avant la fin de ce run. La conclusion d'obsolescence potentielle vient du **code** : aucun des trois services ne supprime les holdings ou comptes absents d'un export réussi.

---

## 6. Constats détaillés

### SID-01 — Le cash BoursoBank n'est pas mis à jour de façon fiable

**Sévérité : élevée (intégrité des données)**

**Constat**

`PortfolioRepository.upsertSyncedAccount()` met à jour le nom, le type, la devise, le solde, le solde disponible, l'IBAN, la connexion et les métadonnées, mais **pas `cashBalance`** (`server/services/portfolioRepository.js:325-346`).

BoursoBank compense partiellement ce défaut en appelant `updateAccount()` après l'import des positions (`server/services/boursoSidecarService.js:707-712`), mais :

- la condition utilise un compteur **global** `holdingsSynced`, et non le nombre de positions du compte courant ;
- si un compte-titres n'a aucune position lors d'une synchronisation, son cash n'est jamais rafraîchi ;
- si l'extraction des positions échoue, le cash reste celui de la dernière synchronisation réussie ;
- le calcul `solde - totalHoldingsValue` peut produire un cash supérieur au solde si les positions sont partielles ou obsolètes.

**Preuve observée**

Sur la copie de base, un compte-titres BoursoBank sans holding possède un `cash_balance` supérieur à son solde. Le `getOverview()` utiliserait ce cash dès qu'une position apparaîtrait, ce qui fausserait la valorisation.

**Impact**

- Valorisation erronée d'un PEA/CTO BoursoBank.
- Double comptage possible entre cash et positions.
- Écart persistant entre le solde affiché et la somme cash + positions.

**Recommandation**

1. Faire de `cashBalance` un champ explicitement supporté par la mise à jour de `upsertSyncedAccount()`.
2. Calculer le cash par compte, à partir des positions réellement importées pour ce compte.
3. Ne mettre à jour le cash que si l'étape positions a réussi.
4. Ajouter un test d'invariant : `balance ≈ cash_balance + Σ(quantity × price)` pour chaque compte d'investissement.

---

### SID-02 — Les positions disparues ne sont jamais supprimées

**Sévérité : élevée (intégrité des données)**

**Constat**

- BoursoBank importe les positions par `upsertHolding()` mais ne supprime jamais celles qui ne figurent plus dans l'export (`server/services/boursoSidecarService.js:682-712`).
- Fortuneo fait de même, à une exception près : il supprime uniquement l'ancienne ligne synthétique `XX-liquidity` (`server/services/fortuneoSidecarService.js:400-407`).
- BNP n'est pas concerné, faute de positions.

**Impact**

- Une position vendue reste indéfiniment dans le patrimoine.
- Le cash est recalculé sur le nouvel export, mais la synthèse continue d'ajouter l'ancienne position : double comptage.
- Les performances et la qualité des calculs de performance/plus-values se dégradent avec le temps.

**Recommandation**

1. Réconcilier les holdings par compte après chaque import réussi :
   - clé stable : ISIN, puis ticker, puis nom ;
   - supprimer ou marquer « close » les holdings absents ;
   - ne jamais supprimer si l'étape positions a échoué.
2. Ajouter un test de non-régression : une position présente au run N et absente au run N+1 doit disparaître.
3. Documenter le comportement en cas de position sans identifiant stable.

---

### SID-03 — Les comptes disparus ne sont jamais archivés

**Sévérité : élevée (intégrité des données)**

**Constat**

Les trois services utilisent `upsertSyncedAccount()` pour les comptes présents dans l'export, mais aucun ne réconcilie l'ensemble des comptes du provider à la fin d'un run. Un compte fermé côté banque reste actif avec son dernier solde.

Le mécanisme d'archivage existant (`archiveAccountsByConnection`, `server/services/portfolioRepository.js:419-426`) n'est utilisé que pour les comptes Enable Banking remplacés par un sidecar.

**Impact**

- Un compte clôturé continue à peser dans la synthèse.
- Les doublons avec Enable Banking peuvent persister, surtout pour BoursoBank qui n'applique pas la priorité.
- L'utilisateur ne voit aucun signal lui indiquant qu'un compte n'est plus présent dans l'export.

**Recommandation**

1. Après un run entièrement réussi, comparer les comptes du provider à l'ensemble vu dans l'export.
2. Archiver les comptes absents, ou les marquer `stale` avec une date de dernière présence.
3. Ne jamais archiver si l'export est partiel ou si l'étape comptes a échoué.
4. Prévoir une option de rétention pour les comptes historiques.

---

### SID-04 — Aucun snapshot de solde n'est créé pour les sidecars

**Sévérité : élevée (fonctionnelle)**

**Constat**

Enable Banking appelle `repository.saveSnapshot()` après chaque compte synchronisé (`server/services/syncService.js:306-313`). Les trois services sidecar appellent directement le repository et **n'appellent jamais `saveSnapshot`**. La copie de base confirme : 0 snapshot pour les providers sidecar.

**Impact**

- L'historique de patrimoine ignore les comptes sidecar.
- Les graphiques d'évolution et les calculs de performance sont incomplets.
- Le problème s'aggrave à mesure que les comptes sidecar remplacent Enable Banking.

**Recommandation**

1. Centraliser une fonction `recordAccountSnapshot()` appelée par les quatre chemins d'import.
2. Enregistrer le solde une fois par compte et par jour, de façon idempotente.
3. Ajouter un test vérifiant qu'une synchronisation sidecar crée bien un snapshot.

---

### SID-05 — L'authentification BoursoBank est incompatible avec l'interface

**Sévérité : élevée (fonctionnelle)**

**Constat**

Le CLI BoursoBank peut demander une validation dans l'application mobile et attendre jusqu'à **300 secondes** (`bourso-api/src/lib.rs:171-205`). Il peut aussi afficher un **QR code** dans le terminal (`bourso-api/src/lib.rs:212-230`).

Or l'intégration dashboard :

- exécute la synchronisation en requête HTTP synchrone, sans job (`server/services/boursoSidecarService.js:518-857`) ;
- applique un timeout de **120 secondes** (`server/services/boursoSidecarService.js:78-81`) ;
- n'expose aucun challenge MFA, aucun statut intermédiaire et aucune annulation ;
- ne traite pas le QR code.

**Impact**

- Un utilisateur soumis à une validation mobile peut voir un timeout avant d'avoir validé.
- Un utilisateur soumis au QR code ne peut pas se connecter via le dashboard.
- Les tentatives répétées peuvent déclencher des contrôles de sécurité côté banque.
- L'interface reste bloquée pendant toute la durée de l'appel.

**Recommandation**

1. Aligner le timeout Bourso sur le CLI (au minimum 300 s + marge), ou rendre le timeout configurable et documenté.
2. Passer BoursoBank sur le même modèle de job que BNP/Fortuneo.
3. Exposer un statut `mfa_required` avec le type de validation et, si possible, le QR code.
4. Ajouter une annulation et un garde de concurrence par profil.

---

### SID-06 — BoursoBank n'applique pas la priorité sur Enable Banking

**Sévérité : élevée (doublons fonctionnels)**

**Constat**

BNP et Fortuneo appellent `markSidecarPriority()` après un import réussi (`bnpSidecarService.js:353-362`, `fortuneoSidecarService.js:436-445`). BoursoBank n'importe même pas ce module.

Le filtre `filterSyncableConnections()` empêche bien une synchronisation Enable Banking Bourso tant qu'une connexion sidecar Bourso existe, mais il **ne marque ni n'archive** les comptes Enable Banking déjà présents.

**Impact**

- Les comptes Enable Banking Bourso restent visibles dans la synthèse.
- Les transactions peuvent être comptées deux fois si les deux sources ont déjà importé.
- Le retrait du sidecar ne nettoie pas la situation.
- Le comportement est différent des deux autres banques.

**Recommandation**

1. Appeler `markSidecarPriority({ bankKey: "bourso", ... })` après un import réussi.
2. Vérifier la présence d'une connexion Enable Banking Bourso existante dans les tests.
3. Ajouter un test de bout en bout : sidecar Bourso + EB Bourso → comptes EB archivés, aucun doublon.

---

### SID-07 — Les erreurs partielles BoursoBank sont silencieuses

**Sévérité : élevée (observabilité)**

**Constat**

Dans `syncBoursoSidecar()` :

- une erreur d'extraction des positions est seulement `console.warn` (`server/services/boursoSidecarService.js:714`) ;
- une erreur d'extraction des transactions est seulement `console.warn` (`server/services/boursoSidecarService.js:821`) ;
- `finishSyncRun()` ne reçoit que les erreurs de la boucle externe (`server/services/boursoSidecarService.js:829-846`) ;
- le résultat retourné contient `errors: []` même si des positions ou transactions ont échoué.

**Impact**

- Une synchronisation partielle est rapportée comme un succès.
- L'utilisateur peut croire que ses positions ou son historique sont à jour.
- Les runs en base ne permettent pas de diagnostiquer les échecs.
- Le cash peut être mis à jour alors que les positions ont échoué.

**Recommandation**

1. Pousser des erreurs structurées `{ account, step, code, message }` dans `errors`.
2. Terminer le run en `partial` dès qu'une étape compte/positions/transactions échoue.
3. Ne pas mettre à jour le cash si l'étape positions a échoué.
4. Afficher ces erreurs dans l'interface.

---

### SID-08 — BoursoBank n'a ni rate limiting, ni garde de concurrence, ni validation du `connectionId`

**Sévérité : élevée (sécurité et intégrité)**

**Constat**

- Les routes `/sidecar/bourso/connect` et `/sidecar/bourso/sync` n'appliquent pas `sidecarCredentialLimiter`, contrairement à BNP et Fortuneo (`server/routes/portfolio.js:1670-1710` vs `:1731-1734`, `:1834-1843`).
- Aucun verrou par profil n'empêche deux synchronisations Bourso simultanées.
- `syncBoursoSidecar()` accepte n'importe quel `connectionId` sans vérifier son provider (`server/services/boursoSidecarService.js:550-553`). BNP et Fortuneo vérifient le provider et recréent une connexion si nécessaire.

**Impact**

- Surface de brute force / déni de service sur les identifiants Bourso.
- Synchronisations concurrentes et écritures entrelacées.
- Risque d'attacher les comptes Bourso à une connexion Enable Banking ou à une autre banque ; une déconnexion de cette connexion archiverait alors les comptes Bourso.

**Recommandation**

1. Appliquer le même rate limiter que BNP/Fortuneo.
2. Ajouter un verrou par `userId` (job ou mutex).
3. Vérifier `connection.provider === BOURSO_PROVIDER` avant réutilisation.
4. Ajouter des tests d'API sur ces trois points.

---

### SID-09 — Couverture et troncature des transactions BoursoBank

**Sévérité : moyenne (fonctionnelle et documentaire)**

**Constat**

- Les transactions ne sont importées que pour les comptes dont `kind === "banking"` (`server/services/boursoSidecarService.js:714-760`). Les livrets, PEA, CTO et assurance-vie n'ont aucune transaction importée.
- Le nombre de pages est limité à `10` par défaut et `50` au maximum (`server/services/boursoSidecarService.js:523`, `:726-727`), sans avertissement si l'historique est plus long.
- L'interface annonce pourtant « toutes vos transactions » (`ConnectionsTab.tsx:1390`).

**Preuve observée**

Les 1 325 transactions Bourso de la base sont toutes rattachées à un seul compte courant ; les autres comptes n'en ont aucune.

**Impact**

- Historique incomplet pour les comptes d'épargne et de titres.
- Troncature silencieuse au-delà de 50 pages.
- Promesse UI non tenue.

**Recommandation**

1. Vérifier les capacités du CLI pour les transactions des comptes non bancaires et les importer si possible.
2. Persister un curseur de pagination ou avertir explicitement quand la limite est atteinte.
3. Aligner le texte de l'interface sur la couverture réelle.

---

### SID-10 — Détection du CLI BoursoBank plus restrictive que les deux autres

**Sévérité : moyenne (exploitation)**

**Constat**

`resolveBoursoCliPath()` ne cherche que :

- `BOURSO_CLI_PATH` ;
- `../bourso-api/target/release/bourso-cli` ;
- `../bourso-api/target/debug/bourso-cli`.

Il ne cherche ni dans `PATH`, ni dans `~/.local/bin`, ni via `resolveExecutable()` partagé (`server/services/boursoSidecarService.js:24-47`). BNP et Fortuneo le font (`bnpSidecarService.js:83-93`, `fortuneoSidecarService.js:81-97`).

Le README indique pourtant que la commande peut être dans le `PATH` (`README.md:166`).

**Impact**

- Installation standard via `pipx`/binaire dans `~/.local/bin` non détectée pour Bourso.
- Message d'erreur moins utile.
- Comportement d'installation différent des deux autres sidecars.

**Recommandation**

1. Utiliser `resolveExecutable()` avec les mêmes candidats que BNP/Fortuneo.
2. Corriger le README ou le code, mais pas les deux en désaccord.
3. Ajouter un test de résolution (env, workspace, `PATH`).

---

### SID-11 — Les avertissements des exports sont ignorés

**Sévérité : moyenne (observabilité)**

**Constat**

- BNP ne lit que `transactionsTruncated` (`bnpSidecarService.js:327-334`) ; le tableau `warnings` du schéma n'est pas exploité.
- Fortuneo ne lit jamais `payload.warnings`.
- Aucun des deux ne vérifie `payload.status === "partial"` de façon indépendante ; le statut est recalculé uniquement à partir des erreurs importées.
- Bourso n'a pas de notion d'avertissement.

**Impact**

- Des données partielles peuvent être présentées comme complètes.
- Les avertissements de pagination, de session ou de compte sont perdus.
- Le diagnostic utilisateur est appauvri.

**Recommandation**

1. Agréger `payload.warnings` dans le résultat et dans le run de synchronisation.
2. Traiter `payload.status` comme un signal de partialité.
3. Afficher un indicateur « données partielles » dans l'interface.

---

### SID-12 — L'épargne salariale n'est jamais mappée vers `EMPLOYEE_SAVINGS`

**Sévérité : faible à moyenne (classification)**

**Constat**

Aucun des trois services ne produit le type `EMPLOYEE_SAVINGS`, alors que le modèle et la synthèse le supportent (`portfolioRepository.js:1649`, `src/types/portfolio.ts`). Un PEE/PERCO peut être classé :

- `SAVINGS` si le libellé contient « ÉPARGNE » ;
- `SECURITIES` si le kind est `trading` et que le libellé ne contient pas « PEA ».

**Impact**

- Mauvaise catégorie dans la synthèse.
- Valorisation et agrégations par type moins pertinentes.
- Comportement différent d'Enable Banking, qui sait produire `EMPLOYEE_SAVINGS`.

**Recommandation**

1. Ajouter une détection explicite PEE/PERCO/PERCOL dans les trois mappers.
2. Ajouter des tests de classification.
3. Documenter les libellés reconnus.

---

### SID-13 — Incohérences d'interface

**Sévérité : moyenne (UX)**

**Constat**

- Les notifications de succès BNP, Bourso et Fortuneo ignorent `result.errors` (`ConnectionsTab.tsx:249-253`, `:300-303`, `:414-417`). Un import partiel est donc annoncé comme un succès.
- La modale Bourso ne vérifie pas `boursoStatus.available` et n'affiche pas de bannière « CLI introuvable », contrairement à BNP (`:1491`) et Fortuneo (`:1669`).
- La modale Bourso reste bloquée pendant l'appel synchrone, sans progression ni annulation.
- Le libellé Bourso promet « toutes vos transactions », ce qui n'est pas le cas.

**Impact**

- Confiance excessive dans des données partielles.
- Diagnostic d'installation difficile pour Bourso.
- Expérience utilisateur différente entre les trois banques.

**Recommandation**

1. Afficher un statut `partial` et le nombre d'erreurs dans les trois modales.
2. Ajouter la bannière de disponibilité Bourso.
3. Afficher une progression ou un job pour Bourso.
4. Corriger les textes.

---

### SID-14 — Couverture de tests déséquilibrée

**Sévérité : moyenne (qualité)**

**Constat**

La suite compte 43 tests liés aux sidecars sur 281 tests au total :

| Fichier | Tests | Couverture principale |
|---|---:|---|
| `tests/bnp-sidecar.test.ts` | 5 | Mapping, import, credentials |
| `tests/bnp-sidecar-job.test.ts` | 2 | Job, MFA, mot de passe invalide |
| `tests/bourso-sidecar.test.ts` | 10 | Parsing, credentials, repository, market data |
| `tests/fortuneo-sidecar.test.ts` | 5 | Mapping, import, liquidités, credentials |
| `tests/fortuneo-sidecar-job.test.ts` | 4 | OTP, annulation, concurrence, format |
| `tests/sidecar-priority.test.ts` | 7 | Priorité, filtrage, archivage |
| `tests/sidecar-process.test.ts` | 2 | Redaction stdout/stderr |
| `tests/sidecar-routes.test.ts` | 8 | Statuts, erreurs, jobs inconnus |

Lacunes principales :

- aucun test d'intégration complet de `syncBoursoSidecar()` avec un faux CLI ;
- aucun test de priorité spécifique à Bourso ;
- aucun test de rate limiting ou de concurrence Bourso ;
- aucun test de snapshot sidecar ;
- aucun test de suppression des holdings/comptes obsolètes ;
- aucun test de contrat croisé vérifiant que les trois services exposent les mêmes garanties ;
- `sidecar-routes.test.ts` ne teste pas l'authentification de `/sidecar/bourso/status` ni les credentials Bourso.

**Recommandation**

1. Ajouter un faux CLI Bourso et un test de synchronisation complet.
2. Ajouter les tests de priorité, concurrence, rate limiting et validation du `connectionId`.
3. Ajouter un test paramétré « contrat commun » pour les trois providers.
4. Ajouter les tests de snapshots et de réconciliation.

---

### SID-15 — Dérive documentaire

**Sévérité : moyenne (documentation)**

**Constat**

- `README.md:138-176` présente les trois sidecars comme uniformément « en lecture seule ». Le CLI Bourso expose des commandes d'écriture (`trade`, `transfer`), même si le dashboard ne les appelle pas.
- `README.md:166` indique que la commande peut être dans le `PATH` ; ce n'est pas vrai pour Bourso.
- `README.md` et l'interface promettent l'historique complet des transactions ; Bourso est limité aux comptes bancaires et à 50 pages.
- La section « Priorité et non-régression » décrit un comportement qui n'est pas implémenté pour Bourso.
- `.env.example:65-71` documente les timeouts BNP/Fortuneo mais pas `BOURSO_TIMEOUT_MS` ni `BOURSO_MAX_OUTPUT_BYTES`.

**Impact**

- Attentes utilisateur erronées.
- Diagnostic d'installation et de support plus difficile.
- Risque de considérer Bourso comme équivalent aux deux autres.

**Recommandation**

1. Nuancer la mention « lecture seule » : « le dashboard n'appelle que des commandes de lecture ; le CLI Bourso expose aussi des commandes d'écriture ».
2. Corriger la phrase sur le `PATH`.
3. Documenter la couverture réelle des transactions et la limite de pages.
4. Documenter les variables d'environnement Bourso.
5. Ajouter une matrice de parité dans le README.

---

### SID-16 — Écart de conception sur le stockage du mot de passe Bourso

**Sévérité : moyenne (sécurité/design)**

**Constat**

- BNP ne stocke que le numéro client ; le code secret est demandé à chaque synchronisation.
- Fortuneo ne stocke que l'identifiant ; le mot de passe est demandé à chaque synchronisation.
- Bourso stocke l'identifiant **et le mot de passe** dans le coffre chiffré, par défaut (`server/routes/portfolio.js:1676`, `ConnectionsTab.tsx:173`).

Le stockage est chiffré AES-256-GCM et rattaché au profil, ce qui limite le risque. Mais la différence de modèle est structurante : compromission du coffre = compromission du mot de passe bancaire Bourso, alors que BNP/Fortuneo ne stockent jamais le secret de connexion.

**Impact**

- Surface de risque plus élevée pour Bourso.
- Comportement utilisateur différent.
- La documentation privacy le mentionne, mais l'interface pourrait être plus explicite.

**Recommandation**

1. Passer `saveCredentials` à `false` par défaut, avec opt-in explicite.
2. Afficher un avertissement clair sur la conservation du mot de passe.
3. Envisager un stockage par session courte plutôt que permanent.
4. Aligner la politique des trois sidecars.

---

### SID-17 — Positions Fortuneo sans identifiant de marché

**Sévérité : moyenne (qualité de données)**

**Constat**

Les 3 positions Fortuneo observées n'ont ni ticker ni ISIN. Le mapper utilise `stockSymbol` puis `code` ; si le CLI ne fournit ni l'un ni l'autre, le holding est créé avec un nom et un prix, mais sans identifiant exploitable (`fortuneoSidecarService.js:251-294`).

**Impact**

- Impossible de rafraîchir le prix via Yahoo Finance ou le service de market data.
- La valorisation dépend entièrement du prix fourni par le sidecar à chaque synchronisation.
- Les rapprochements et les calculs de performance par titre sont limités.

**Recommandation**

1. Vérifier si le CLI peut fournir `stockSymbol` ou un ISIN pour ces lignes.
2. À défaut, conserver le prix du sidecar et documenter la limite.
3. Ajouter un indicateur « prix non rafraîchissable » dans l'interface.
4. Ne pas fabriquer de ticker à partir du libellé sans validation.

---

### SID-18 — Cycle de vie des jobs et des runs

**Sévérité : faible (robustesse)**

**Constat**

Les jobs BNP et Fortuneo sont stockés en mémoire (`Map`), avec un TTL de 15 minutes. Un redémarrage du serveur perd les jobs en cours. De même, un arrêt brutal peut laisser un `sync_run` en `running`, sans réconciliation au démarrage.

**Impact**

- Job perdu après redémarrage.
- Run bloqué en `running` dans l'historique.
- Difficulté de diagnostic.

**Recommandation**

1. Au démarrage, marquer les runs `running` comme `interrupted`.
2. Persister l'état minimal des jobs ou documenter la limitation.
3. Ajouter un test de reprise.

---

### SID-19 — Synchronisation non incrémentale par défaut

**Sévérité : faible (performance)**

**Constat**

- BNP et Fortuneo acceptent un paramètre `since`, mais il est optionnel et vide par défaut ; chaque synchronisation peut donc redemander tout l'historique.
- Bourso pagine par défaut sur 10 pages et ne mémorise pas de curseur.

**Impact**

- Temps de synchronisation et charge bancaire plus élevés.
- Risque de troncature silencieuse pour Bourso.
- Comportement différent d'Enable Banking, qui calcule une fenêtre à partir de la dernière transaction.

**Recommandation**

1. Calculer une date de départ par défaut à partir de la dernière transaction connue.
2. Pour Bourso, persister un curseur ou augmenter la limite avec avertissement.
3. Ajouter des tests de reprise après une synchronisation partielle.

---

### SID-20 — BNP n'expose aucune position : écart assumé

**Sévérité : information**

Le CLI BNP ne fournit ni positions ni holdings ; son export contient les comptes, soldes et transactions. Le service force donc `holdingsSynced: 0` (`bnpSidecarService.js:394`) et n'appelle jamais `upsertHolding`.

Ce n'est pas un bug, mais cela signifie que :

- un PEA/CTO BNP est valorisé par son solde global, pas par ses lignes ;
- la parité avec Bourso/Fortuneo est structurellement impossible sur les positions ;
- l'interface ne doit pas promettre de positions BNP.

---

## 7. Sécurité

| Contrôle | BNP | BoursoBank | Fortuneo | Commentaire |
|---|---|---|---|---|
| Mot de passe hors `argv` | Oui (`stdin`) | Oui (`settings.json` temporaire) | Oui (`stdin`) | Bourso transite par un fichier, pas par `argv` |
| Mot de passe hors environnement | Oui | Oui (fichier `HOME` temporaire) | Oui | |
| Mot de passe jamais stocké | Oui | **Non, par défaut** | Oui | Voir SID-16 |
| Répertoire privé `0700` | Oui | Oui | Oui | |
| Fichiers MFA/OTP `0600` | Oui | Sans objet | Oui | |
| Protection contre les symlinks | Oui | Partielle (settings) | Oui | BNP/Fortuneo vérifient les fichiers de réponse |
| Nettoyage des secrets temporaires | Oui (`finally`) | Oui (`finally`) | Oui (`finally`) | Un crash brutal peut laisser des restes |
| Redaction des erreurs | Oui | Oui (password + customerId) | Oui | Les libellés de comptes peuvent rester dans les erreurs |
| Allowlist d'environnement | Oui | Oui, proche | Oui | Bourso autorise en plus `BOURSO_*` |
| Limite de sortie | 10 Mo | 10 Mo | 10 Mo | |
| Timeout | 300 s | **120 s** | 300 s | Voir SID-05 |
| Rate limiting credentials | Oui | **Non** | Oui | Voir SID-08 |
| Garde de concurrence | Oui | **Non** | Oui | Voir SID-08 |
| Validation du `connectionId` | Oui | **Non** | Oui | Voir SID-08 |
| CLI strictement lecture seule | Oui | **Non** | Oui | Le dashboard n'appelle que la lecture |

**Conclusion sécurité** : aucune exécution de commande arbitraire, aucun secret en `argv`, bon usage de `spawn` avec tableau d'arguments. Les écarts portent sur la politique de conservation du mot de passe Bourso, l'absence de rate limiting/concurrence Bourso et l'incompatibilité MFA.

---

## 8. Tests et qualité

### 8.1 Vérifications exécutées

| Vérification | Résultat |
|---|---|
| `npm test` | **281 tests / 281 passés**, 24 fichiers |
| `npm run type-check` | **OK** |
| `npm run lint` | **0 erreur**, 27 avertissements |
| Git | Arbre propre au moment de l'audit |

Les avertissements lint sont majoritairement des hooks React et des variables `_` non utilisées ; aucun ne concerne directement les sidecars.

### 8.2 Couverture fonctionnelle

| Domaine | BNP | BoursoBank | Fortuneo |
|---|---|---|---|
| Mapping comptes | Oui | Oui | Oui |
| Mapping transactions | Oui | Oui (parsing) | Oui |
| Mapping positions | Sans objet | Oui (repository) | Oui |
| Import complet | Oui | **Non** | Oui |
| Job asynchrone | Oui | **Non** | Oui |
| MFA/OTP | Oui | **Non** | Oui |
| Priorité EB | Oui (générique) | **Non** | Oui (générique) |
| Credentials | Oui | Oui | Oui |
| Snapshots | **Non** | **Non** | **Non** |
| Réconciliation holdings | Sans objet | **Non** | **Non** |
| Réconciliation comptes | **Non** | **Non** | **Non** |
| Rate limiting | Oui | **Non** | Oui |
| Concurrence | Oui | **Non** | Oui |

---

## 9. Documentation et interface

### 9.1 Documentation

Points corrects :

- Les variables `BNP_CLI_PATH`, `FORTUNEO_CLI_PATH`, `BOURSO_CLI_PATH` sont documentées.
- Les timeouts BNP/Fortuneo et les bornes OTP sont documentés.
- La politique de non-stockage des mots de passe BNP/Fortuneo est claire.
- La priorité sidecar/Enable Banking est expliquée.

Points à corriger :

- « Lecture seule » pour les trois sidecars : Bourso expose des commandes d'écriture.
- « Dans le `PATH` » : non implémenté pour Bourso.
- « Toutes les transactions » : Bourso ne prend que les comptes bancaires.
- « Priorité » : non implémentée pour Bourso.
- Timeouts Bourso absents de `.env.example` et de `docs/deployment.md`.

### 9.2 Interface

Points corrects :

- BNP et Fortuneo ont un vrai parcours job + validation.
- Les mots de passe sont effacés du formulaire après lancement.
- Les statuts `available` et `configured` sont affichés pour BNP/Fortuneo.
- Les jobs inconnus renvoient 404.

Points à corriger :

- Bourso n'affiche pas `available`.
- Bourso n'a pas de progression ni d'annulation.
- Les erreurs partielles ne sont pas affichées dans les trois modales.
- Les textes Bourso promettent plus que la couverture réelle.
- Aucun indicateur « données partielles » ou « holding sans identifiant ».

---

## 10. Plan de remédiation recommandé

### Phase 1 — Intégrité des données (priorité maximale)

1. **SID-01** : corriger la mise à jour de `cashBalance` et le calcul par compte.
2. **SID-02** : réconcilier les holdings absents.
3. **SID-03** : archiver les comptes absents après un run complet réussi.
4. **SID-04** : enregistrer les snapshots pour les sidecars.
5. Ajouter les tests d'invariant cash + positions + solde.

### Phase 2 — Parité et sécurité BoursoBank

1. **SID-05** : job asynchrone, timeout aligné, challenge MFA/QR, annulation.
2. **SID-06** : appliquer `markSidecarPriority` pour Bourso.
3. **SID-07** : remonter les erreurs positions/transactions et le statut `partial`.
4. **SID-08** : rate limiting, verrou par profil, validation du `connectionId`.
5. **SID-16** : opt-in explicite pour la conservation du mot de passe.

### Phase 3 — Contrats et expérience

1. **SID-09** : couverture transactions et pagination.
2. **SID-10** : découverte du CLI Bourso via `PATH`/`~/.local/bin`.
3. **SID-11** : exploiter `warnings` et `status`.
4. **SID-12** : mapper `EMPLOYEE_SAVINGS`.
5. **SID-13** : afficher les erreurs partielles et la disponibilité Bourso.
6. **SID-15** : corriger la documentation.
7. **SID-17** : documenter les positions sans identifiant.

### Phase 4 — Robustesse

1. **SID-18** : réconcilier les runs `running` au démarrage.
2. **SID-19** : synchronisation incrémentale par défaut.
3. **SID-14** : compléter la matrice de tests.

---

## 11. Checklist « les trois fonctionnent-ils à l'identique ? »

| Question | Réponse |
|---|---|
| Même mode d'exécution ? | **Non** : BNP/Fortuneo en job, Bourso en synchrone |
| Même validation forte ? | **Non** : brokers de fichiers BNP/Fortuneo, validation mobile/QR pour Bourso |
| Même politique de credentials ? | **Non** : Bourso stocke le mot de passe par défaut |
| Même priorité sur Enable Banking ? | **Non** : BNP/Fortuneo seulement |
| Même couverture des comptes ? | **Oui**, tous les comptes sont importés |
| Même couverture des transactions ? | **Non** : Bourso limité aux comptes bancaires |
| Même couverture des positions ? | **Non** : BNP aucune, Bourso trading, Fortuneo trading/insurance |
| Même gestion du cash ? | **Non** : BNP pas de cash, Bourso conditionnel, Fortuneo avec exclusion des liquidités |
| Même réconciliation des obsolètes ? | **Non** : aucun ne réconcilie complètement |
| Même gestion des erreurs ? | **Non** : Bourso partiellement silencieux |
| Mêmes snapshots ? | **Non** : aucun sidecar n'en crée |
| Même sécurité opérationnelle ? | **Non** : rate limiting et concurrence absents pour Bourso |
| Même expérience UI ? | **Non** : Bourso sans job ni challenge |

---

## 12. Points à confirmer avec le produit

1. **Comptes absents** : faut-il les archiver automatiquement ou les conserver comme historique ?
2. **Positions absentes** : faut-il les supprimer ou les marquer « clôturées » ?
3. **Mot de passe Bourso** : la conservation par défaut est-elle un choix produit assumé ?
4. **Transactions Bourso non bancaires** : le CLI permet-il de les extraire ?
5. **Positions Fortuneo sans identifiant** : peut-on obtenir un ISIN/ticker via Woob ?
6. **MFA Bourso** : faut-il supporter le QR code dans l'interface ou documenter son absence ?
7. **Snapshots sidecar** : fréquence souhaitée (par run, par jour, par compte) ?

---

## 13. Annexes

### 13.1 Fichiers inspectés

**Portfolio-Dashboard**

- `server/services/bnpSidecarService.js`
- `server/services/boursoSidecarService.js`
- `server/services/fortuneoSidecarService.js`
- `server/services/sidecarPriority.js`
- `server/services/sidecarProcess.js`
- `server/services/sidecarFormat.js`
- `server/services/syncService.js`
- `server/services/portfolioRepository.js`
- `server/services/marketData.js`
- `server/routes/portfolio.js`
- `src/components/patrimoine/ConnectionsTab.tsx`
- `src/services/portfolioApi.ts`
- `tests/bnp-sidecar.test.ts`
- `tests/bnp-sidecar-job.test.ts`
- `tests/bourso-sidecar.test.ts`
- `tests/fortuneo-sidecar.test.ts`
- `tests/fortuneo-sidecar-job.test.ts`
- `tests/sidecar-priority.test.ts`
- `tests/sidecar-process.test.ts`
- `tests/sidecar-routes.test.ts`
- `README.md`
- `docs/deployment.md`
- `docs/privacy.md`
- `.env.example`

**Projet BNP**

- `README.md`
- `docs/JSON-SCHEMAS.md`
- `bnp_sidecar/cli.py`
- `bnp_sidecar/direct/cli.py`
- `bnp_sidecar/direct/client.py`
- `bnp_sidecar/serialize.py`

**Projet Bourso**

- `README.md`
- `src/lib.rs`
- `src/main.rs`
- `src/settings.rs`
- `src/bourso_api/src/account.rs`
- `src/bourso_api/src/client/account.rs`
- `src/bourso_api/src/client/banking.rs`
- `src/bourso_api/src/client/trade/mod.rs`

**Projet Fortuneo**

- `README.md`
- `docs/JSON-SCHEMAS.md`
- `fortuneo_sidecar/cli.py`
- `fortuneo_sidecar/engine.py`
- `fortuneo_sidecar/serialize.py`
- `fortuneo_sidecar/otp.py`

### 13.2 Commandes de vérification

```bash
npm test
npm run type-check
npm run lint
```

### 13.3 Glossaire

| Terme | Définition |
|---|---|
| **Sidecar** | CLI local qui se connecte directement à la banque et exporte les données |
| **Enable Banking** | Agrégation bancaire DSP2 utilisée comme source alternative |
| **MFA** | Authentification multifacteur (validation mobile, SMS, action) |
| **OTP** | Code à usage unique envoyé par SMS |
| **Holding** | Position d'investissement (titre, fonds, ETF) |
| **Snapshot** | Relevé de solde daté utilisé pour l'historique de patrimoine |
| **Priorité sidecar** | Remplacement des comptes Enable Banking d'une banque par ceux du sidecar |
| **Réconciliation** | Suppression ou archivage des entités absentes du dernier export |

---

## 14. Conclusion

Les sidecars BNP et Fortuneo constituent une base solide, cohérente et bien testée. BoursoBank, plus ancien et construit sur un CLI différent, n'a pas bénéficié des mêmes évolutions : il reste synchrone, sans job, sans priorité, sans challenge MFA dashboard et avec une gestion du cash fragile.

Les trois sidecars **importent bien les comptes**, mais ils ne garantissent pas encore de façon homogène :

- la fraîcheur des positions et du cash ;
- la disparition des comptes/positions obsolètes ;
- l'historique de patrimoine ;
- la visibilité des erreurs partielles ;
- la sécurité opérationnelle des credentials.

La priorité d'action est claire : **corriger d'abord l'intégrité des données** (cash, holdings, comptes, snapshots), puis **aligner BoursoBank sur le modèle BNP/Fortuneo**, enfin **harmoniser les contrats, l'interface et la documentation**.
