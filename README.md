# File Browser Index (FBI)

**File Browser Index** est un gestionnaire de fichiers auto-hébergé, accessible depuis un navigateur et également utilisable comme application de bureau avec Electron.

L'objectif est de proposer un espace de stockage organisé en dossiers et fichiers, avec plusieurs comptes, des permissions et des liens de partage.

## Fonctionnalités

- Gestion des fichiers et dossiers : création, import, téléchargement, renommage, duplication et suppression.
- Prévisualisation et édition de fichiers depuis l'interface.
- Comptes utilisateurs avec rôles **root**, **administrateur** et **utilisateur**.
- Espaces partagé et privé.
- Gestion des permissions par utilisateur, groupe ou accès global.
- Liens de partage pour consulter un fichier, avec possibilité d'autoriser sa modification.
- Compression et extraction d'archives ZIP.
- Interface avec thèmes clair et sombre.
- Application de bureau compatible avec Electron.

## Technologies

- **Node.js** et **Express** pour le serveur et l'API.
- **MySQL** pour les comptes, les fichiers et les permissions.
- **HTML, CSS et JavaScript** pour l'interface web.
- **Electron** et **electron-builder** pour l'application de bureau.

## Prérequis

Pour héberger une instance, il faut :

- Node.js (version 20 LTS ou supérieure recommandée).
- npm.
- MySQL ou un serveur compatible avec le protocole MySQL.
- Un compte MySQL autorisé à créer la base de données et les tables de l'application.

## Installation et lancement du serveur

1. Récupérez le dépôt :

   ```bash
   git clone https://github.com/yanisrocaboyer/FileBrowserIndex.git
   cd FileBrowserIndex
   ```

2. Installez les dépendances :

   ```bash
   npm install
   ```

3. Créez votre fichier de configuration :

   **Linux / macOS**
   ```bash
   cp .env.example .env
   ```

   **Windows (PowerShell)**
   ```powershell
   Copy-Item .env.example .env
   ```

4. Renseignez les paramètres de connexion MySQL dans le fichier `.env` :

   ```dotenv
   DB_HOST=127.0.0.1
   DB_PORT=3306
   DB_USER=fbi
   DB_PASSWORD=remplacez_par_votre_mot_de_passe
   JWT_SECRET=remplacez_par_une_cle_aleatoire_longue_et_secrete
   PORT=3000
   MAX_UPLOAD_MB=100
   ```

   La base utilisée actuellement par l'application s'appelle `fileweb` : elle est créée automatiquement au premier démarrage. L'utilisateur MySQL configuré doit donc avoir les droits nécessaires pour créer cette base et ses tables.

   **Important :** choisissez une valeur longue et aléatoire pour `JWT_SECRET`. Ne publiez jamais votre fichier `.env`, vos mots de passe ou vos clés secrètes.

5. Démarrez le serveur :

   ```bash
   npm start
   ```

6. Ouvrez l'adresse suivante dans votre navigateur :

   ```
   http://localhost:3000
   ```

   Adaptez le port si vous avez défini une autre valeur dans `PORT`.

Au premier démarrage, un compte **root** est créé. Son mot de passe temporaire est affiché dans le terminal : conservez-le, car il n'est affiché qu'à cette occasion. Le compte root permet ensuite de gérer les comptes et les administrateurs.

## Déploiement sur son propre serveur

Chaque personne peut héberger sa propre instance sur un serveur compatible avec Node.js et MySQL :

1. Installer Node.js et MySQL sur le serveur (ou utiliser une base MySQL distante).
2. Récupérer le dépôt et installer les dépendances avec `npm install`.
3. Créer et configurer le fichier `.env`.
4. Lancer l'application avec `npm start`.
5. Pour une mise en production, utiliser un gestionnaire de processus (par exemple systemd ou PM2) et placer un serveur web inverse proxy HTTPS devant l'application.

Chaque instance possède sa propre base de données et sa propre configuration. Il n'est pas nécessaire d'utiliser le serveur de l'auteur du projet.

### Hébergement PHP

L'interface est écrite en HTML, CSS et JavaScript, mais l'application ne se limite pas à des fichiers statiques : elle communique avec une API Express qui gère l'authentification, les permissions, les fichiers et la base MySQL.

Par conséquent, **un hébergement PHP classique qui ne permet pas d'exécuter Node.js ne suffit pas à faire fonctionner l'application complète**. Il peut servir des fichiers statiques, mais il ne fournit pas automatiquement les routes API nécessaires.

Pour rendre FBI entièrement compatible avec un hébergement PHP, il faudrait notamment réécrire l'API Express en PHP. Une autre possibilité serait de servir l'interface depuis un hébergement PHP et de conserver l'API Node.js sur un autre serveur, après adaptation de l'URL de l'API et de la configuration CORS. Cette compatibilité n'est pas encore implémentée.

## Application de bureau (Electron)

Le projet contient également une version Electron.

Après avoir installé et configuré les dépendances et la base MySQL :

```bash
npm run electron
```

Pour construire l'application selon le système utilisé :

```bash
npm run dist:win
npm run dist:mac
npm run dist:linux
```

Les fichiers générés sont placés dans le dossier `dist-apps/`.

### Signature macOS

La création d'un DMG ne nécessite pas à elle seule un compte Apple Developer. En revanche, pour distribuer une application macOS signée et notarisée afin d'éviter les avertissements de sécurité habituels, il faut un certificat **Developer ID Application** et un abonnement Apple Developer Program actif. Consultez la documentation Apple et Electron avant de préparer une distribution signée.

## Configuration

Les principales variables disponibles sont :

| Variable | Rôle |
| --- | --- |
| `DB_HOST` | Adresse du serveur MySQL |
| `DB_PORT` | Port MySQL (3306 par défaut) |
| `DB_USER` | Utilisateur MySQL |
| `DB_PASSWORD` | Mot de passe MySQL |
| `JWT_SECRET` | Clé secrète utilisée pour les jetons d'authentification |
| `PORT` | Port HTTP de l'application (3000 par défaut) |
| `MAX_UPLOAD_MB` | Taille maximale d'un fichier importé en Mo (100 par défaut) |

La base de données est actuellement nommée `fileweb` directement dans le code.

## Sécurité et sauvegardes

- Utilisez HTTPS dès que l'application est accessible depuis Internet.
- Définissez un `JWT_SECRET` personnel, long et aléatoire.
- N'exposez pas MySQL directement à Internet.
- Gardez Node.js, MySQL et les dépendances à jour.
- Sauvegardez régulièrement la base MySQL : elle contient les fichiers et les données des comptes.
- Ne partagez jamais votre fichier `.env`.

## Licence

Aucune licence open source n'est indiquée dans ce dépôt pour le moment. Contactez l'auteur avant toute réutilisation ou redistribution si les conditions ne sont pas précisées.

---

**Ce projet a été développé avec Codex.**
