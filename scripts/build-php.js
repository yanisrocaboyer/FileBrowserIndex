const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'dist', 'php');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

for (const item of ['index.php', 'config.example.php', '.htaccess', 'README.md']) {
  const src = path.join(root, 'php', item);
  fs.copyFileSync(src, path.join(out, item));
}
for (const file of ['index.html', 'manifest.webmanifest', 'sw.js', 'python-worker.js', 'share-view.js', 'share-view.css', 'zip-view.js']) {
  fs.copyFileSync(path.join(root, 'public', file), path.join(out, file));
}
fs.cpSync(path.join(root, 'public', 'assets'), path.join(out, 'assets'), { recursive: true });

const vendor = path.join(out, 'vendor');
fs.mkdirSync(vendor, { recursive: true });
fs.copyFileSync(path.join(root, 'node_modules', 'marked', 'marked.min.js'), path.join(vendor, 'marked.js'));
fs.copyFileSync(path.join(root, 'node_modules', 'mermaid', 'dist', 'mermaid.min.js'), path.join(vendor, 'mermaid.js'));
fs.cpSync(path.join(root, 'node_modules', 'katex', 'dist'), path.join(vendor, 'katex'), { recursive: true });

fs.mkdirSync(path.join(out, 'storage'), { recursive: true });
fs.writeFileSync(path.join(out, 'storage', '.htaccess'), 'Require all denied\n');
fs.writeFileSync(path.join(out, 'INSTALLATION.txt'),
  'FBI — distribution PHP + MySQL\n\n' +
  'Prérequis : PHP 8.2+, pdo_mysql, fileinfo, zip, MySQL/MariaDB.\n' +
  '1. Envoyez tout le contenu de ce dossier dans votre espace web.\n' +
  '2. Copiez config.example.php vers config.php et renseignez la base et une clé JWT secrète.\n' +
  '3. Vérifiez les limites upload_max_filesize, post_max_size et memory_limit de PHP.\n' +
  '4. Ouvrez le site. Le compte root initial et son mot de passe sont créés automatiquement.\n' +
  '5. Récupérez le mot de passe dans storage/initial-root.txt, connectez-vous puis supprimez ce fichier.\n' +
  'Voir README.md pour les détails et la configuration Nginx.\n');
console.log('Distribution PHP créée : dist/php');
