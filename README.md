# File Browser Index (FBI)

**File Browser Index** est un gestionnaire de fichiers auto-hébergé, utilisable depuis un navigateur ou comme application de bureau Electron.

Chaque personne peut héberger sa propre instance et choisir entre deux distributions serveur :
- **Node.js + MySQL** : backend Express utilisé par Electron et la version serveur historique.
- **PHP + MySQL** : backend PHP autonome pour les hébergements mutualisés ne proposant pas Node.js.

## Fonctionnalités

- Gestion des fichiers et dossiers : création, import, téléchargement, renommage, duplication et suppression.
- Prévisualisation et édition de fichiers depuis l'interface.
- Comptes root, administrateur et utilisateur.
- Espaces partagé et privé.
- Permissions par utilisateur, groupe ou accès global.
- Liens publics de partage, en lecture seule ou avec édition.
- Compression et extraction ZIP.
- Interface web avec thèmes clair et sombre.
- Application de bureau Electron.

## Prérequis

### Serveur Node.js
- Node.js 20 ou supérieur et npm.
- MySQL ou MariaDB compatible.
- Un compte MySQL pouvant créer les tables et la base `fileweb`.

### Serveur PHP
- PHP 8.2 ou supérieur.
- MySQL ou MariaDB.
- Extensions PHP `pdo_mysql`, `fileinfo` et `zip`.
- Apache avec `mod_rewrite`, ou règles équivalentes sur Nginx/PHP-FPM.

## Développement et lancement Node.js

```bash
git clone https://github.com/yanisrocaboyer/FileBrowserIndex.git
cd FileBrowserIndex
npm install
cp .env.example .env
```

Configurez les paramètres MySQL et une clé secrète dans `.env` :

```dotenv
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=fbi
DB_PASSWORD=remplacez_par_votre_mot_de_passe
JWT_SECRET=une_cle_aleatoire_longue_et_secrete
PORT=3000
MAX_UPLOAD_MB=100
```

Puis lancez :

```bash
npm start
```

Ouvrez `http://localhost:3000`. Au premier démarrage, les tables et la base `fileweb` sont créées. Un compte root est initialisé et son mot de passe temporaire est affiché une seule fois dans le terminal.

## Construire les distributions d'hébergement

Les commandes suivantes génèrent des dossiers prêts à être transférés sur le serveur. Elles ne déploient rien automatiquement et ne modifient aucun VPS.

### Node.js + MySQL

```bash
npm run build:node
```

Le dossier `dist/node/` contient le serveur Express, l'interface, les fichiers de dépendances et les instructions d'installation. Sur le serveur, configurez `.env`, exécutez `npm install --omit=dev`, puis `npm start`.

### PHP + MySQL

```bash
npm run build:php
```

Le dossier `dist/php/` contient l'interface web, l'API PHP, les bibliothèques front-end, les règles Apache et les instructions d'installation. Transférez son contenu sur votre hébergement, copiez `config.example.php` vers `config.php`, puis renseignez les accès MySQL et une clé `JWT_SECRET` privée.

Le backend PHP utilise le même modèle de données MySQL que le backend Node.js : utilisateurs, nœuds/fichiers, groupes, membres, permissions et liens de partage. Faites une sauvegarde avant tout changement de backend et ne faites pas fonctionner les deux serveurs simultanément sur la même base pendant une migration.

Consultez [php/README.md](php/README.md) pour les prérequis, limites d'import et précautions de déploiement PHP.

## Application de bureau Electron

```bash
npm run electron
```

Pour générer les installateurs :

```bash
npm run dist:win
npm run dist:mac
npm run dist:linux
```

Les fichiers sont générés dans `dist-apps/`. La version macOS est volontairement **non signée et non notarisée** : aucun abonnement Apple Developer n'est nécessaire pour la construire, mais macOS peut afficher un avertissement Gatekeeper lors de son ouverture.

## Configuration

| Variable | Utilité |
| --- | --- |
| `DB_HOST` | Adresse du serveur MySQL |
| `DB_PORT` | Port MySQL (3306 par défaut) |
| `DB_USER` | Utilisateur MySQL |
| `DB_PASSWORD` | Mot de passe MySQL |
| `JWT_SECRET` | Clé de signature des jetons |
| `PORT` | Port HTTP Node.js (3000 par défaut) |
| `MAX_UPLOAD_MB` | Taille maximale d'un import Node.js (100 Mo par défaut) |

La version PHP utilise les mêmes paramètres MySQL dans `php/config.php`, ainsi que `MAX_UPLOAD_BYTES` et `MAX_UNZIP_BYTES`.

## Sécurité et sauvegardes

- Utilisez HTTPS dès que l'application est accessible depuis Internet.
- Choisissez un `JWT_SECRET` long, aléatoire et propre à chaque instance.
- Utilisez un compte MySQL dédié et n'exposez pas MySQL à Internet.
- Ne publiez jamais `.env` ou `config.php`.
- Sauvegardez régulièrement la base MySQL : les fichiers y sont stockés.
- Vérifiez les limites d'import imposées par PHP ou votre hébergeur.

## Licence

Aucune licence open source n'est indiquée dans ce dépôt pour le moment. Contactez l'auteur avant toute réutilisation ou redistribution si les conditions ne sont pas précisées.

---

**Ce projet a été développé avec Codex.**
