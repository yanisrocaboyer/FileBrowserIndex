# FBI — hébergement PHP

Cette distribution permet d'héberger FBI sur un hébergement PHP classique, sans Node.js côté serveur.

## Prérequis

- PHP 8.2 ou supérieur
- MySQL ou MariaDB
- Extensions PHP : `pdo_mysql`, `fileinfo`, `zip`
- Apache avec `mod_rewrite` (ou règles Nginx équivalentes)
- Autoriser les imports de fichiers : ajustez `upload_max_filesize`, `post_max_size` et `memory_limit` selon la limite choisie.

## Installation

1. Décompressez le contenu de cette distribution dans le dossier web de votre sous-domaine ou site.
2. Créez une base de données MySQL et un utilisateur disposant des droits de création et modification des tables.
3. Copiez `config.example.php` en `config.php`.
4. Renseignez les identifiants MySQL et remplacez `JWT_SECRET` par une clé aléatoire longue et privée.
5. Vérifiez que le dossier `storage` peut être créé/écrit par PHP. Il ne contient que les informations temporaires de première installation et est protégé par Apache.
6. Ouvrez le site. Au premier démarrage, les tables sont créées automatiquement et le compte root est initialisé.
7. Récupérez le mot de passe initial dans `storage/initial-root.txt`, connectez-vous, puis supprimez ce fichier.

Ne publiez jamais `config.php` ni le mot de passe root. Si votre hébergeur ne permet pas de protéger le dossier `storage`, placez-le hors de la racine web et adaptez la configuration avant la mise en production.

## Limites PHP

Les opérations ZIP nécessitent `ZipArchive`. Les limites PHP et celles de l'hébergeur peuvent être inférieures à la limite configurée dans FBI. Les imports volumineux peuvent donc être refusés par l'hébergeur avant d'arriver à l'application.

Pour Nginx, adaptez le bloc PHP-FPM à votre version et à votre hébergeur. Exemple de principe à intégrer dans le bloc `server` :

```nginx
location ^~ /storage/ { deny all; }
location ~ /config(\.example)?\.php$ { deny all; }
location / {
    try_files $uri $uri/ /index.php?$query_string;
}
location ~ \.php$ {
    include fastcgi_params;
    fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
    fastcgi_pass unix:/run/php/php8.2-fpm.sock;
}
```

Adaptez le socket PHP-FPM à votre système. Ne rendez jamais `config.php` accessible au téléchargement.

## Base de données

La distribution utilise les mêmes tables `users`, `nodes`, `user_groups`, `group_members`, `perms` et `share_links` que le backend Node.js. Faites une sauvegarde avant de basculer un site existant entre les deux distributions. Ne faites pas tourner simultanément les deux backends sur la même base pendant une migration.

## Sécurité

- Servez FBI uniquement en HTTPS.
- Utilisez une clé JWT secrète unique.
- Utilisez un utilisateur MySQL dédié, avec les droits limités à la base FBI.
- Gardez PHP et MySQL à jour.
- Faites des sauvegardes régulières de MySQL : les fichiers sont stockés dans la base.
