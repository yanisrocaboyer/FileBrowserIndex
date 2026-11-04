const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'dist', 'node');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

for (const item of ['server.js', 'package.json', 'package-lock.json', '.env.example', 'README.md', 'public']) {
  const src = path.join(root, item);
  if (fs.existsSync(src)) fs.cpSync(src, path.join(out, item), { recursive: true });
}
fs.writeFileSync(path.join(out, 'INSTALLATION.txt'),
  'FBI — distribution Node.js + MySQL\n\n' +
  'Prérequis : Node.js 20+, MySQL 8+ ou MariaDB compatible.\n' +
  '1. Copiez .env.example vers .env et configurez DB_HOST, DB_PORT, DB_USER, DB_PASSWORD et JWT_SECRET.\n' +
  '2. npm install --omit=dev\n' +
  '3. npm start\n' +
  '4. Ouvrez http://localhost:3000. Le mot de passe initial root est affiché une seule fois dans le terminal.\n' +
  'Conservez .env secret et servez le site derrière HTTPS en production.\n');
console.log('Distribution Node.js créée : dist/node');
