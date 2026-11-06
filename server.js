require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const AdmZip = require('adm-zip');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// ---- Configuration
const DB_NAME = 'fileweb';
const DB_CONF = {
  host: process.env.DB_HOST || 'localhost',
  port: +process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
};
const SECRET = process.env.JWT_SECRET || 'changez-moi';
if (!process.env.JWT_SECRET) console.warn('⚠ JWT_SECRET non défini : définissez-le en production.');
const MAX_UPLOAD = (+process.env.MAX_UPLOAD_MB || 100) * 1024 * 1024; // taille max d'un import
const MAX_UNZIP = 500 * 1024 * 1024; // taille max décompressée d'un zip

let pool;

// ---- Base de données : création automatique + migrations des versions précédentes
const hasCol = async (t, c) => +(await pool.query(
  'SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND COLUMN_NAME=?',
  [DB_NAME, t, c]))[0][0].n > 0;

async function initDb() {
  const c = await mysql.createConnection(DB_CONF);
  await c.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await c.end();
  pool = mysql.createPool({ ...DB_CONF, database: DB_NAME, connectionLimit: 10 });
  await pool.query(`CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(32) NOT NULL UNIQUE,
    password_hash VARCHAR(100) NOT NULL,
    role ENUM('root','admin','user') NOT NULL DEFAULT 'user',
    display_name VARCHAR(80) NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB`);
  // user_id = créateur (information) ; private_owner = propriétaire si l'élément est dans l'espace privé d'un utilisateur
  await pool.query(`CREATE TABLE IF NOT EXISTS nodes (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NULL,
    private_owner INT NULL,
    parent_id INT NULL,
    name VARCHAR(255) NOT NULL,
    type ENUM('file','folder') NOT NULL,
    mime VARCHAR(100) NULL,
    content LONGBLOB NULL,
    size BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX (parent_id),
    FOREIGN KEY (parent_id) REFERENCES nodes(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`);
  if (!(await hasCol('users', 'role')))
    await pool.query(`ALTER TABLE users ADD COLUMN role ENUM('root','admin','user') NOT NULL DEFAULT 'user'`);
  if (!(await hasCol('users', 'avatar'))) await pool.query('ALTER TABLE users ADD COLUMN avatar MEDIUMTEXT NULL');
  if (!(await hasCol('users', 'display_name')))
    await pool.query('ALTER TABLE users ADD COLUMN display_name VARCHAR(80) NULL');
  if (!(await hasCol('nodes', 'revision'))) await pool.query('ALTER TABLE nodes ADD COLUMN revision INT NOT NULL DEFAULT 0');
  if (!(await hasCol('nodes', 'private_owner')))
    await pool.query('ALTER TABLE nodes ADD COLUMN private_owner INT NULL');
  const [fks] = await pool.query(
    `SELECT CONSTRAINT_NAME c FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA=? AND TABLE_NAME='nodes' AND COLUMN_NAME='user_id' AND REFERENCED_TABLE_NAME='users'`, [DB_NAME]);
  for (const f of fks) await pool.query(`ALTER TABLE nodes DROP FOREIGN KEY \`${f.c}\``);
  if (fks.length) await pool.query('ALTER TABLE nodes MODIFY user_id INT NULL');

  await pool.query(`CREATE TABLE IF NOT EXISTS user_groups (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(64) NOT NULL UNIQUE
  ) ENGINE=InnoDB`);
  await pool.query(`CREATE TABLE IF NOT EXISTS group_members (
    group_id INT NOT NULL,
    user_id INT NOT NULL,
    PRIMARY KEY (group_id, user_id),
    FOREIGN KEY (group_id) REFERENCES user_groups(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`);
  await pool.query(`CREATE TABLE IF NOT EXISTS perms (
    id INT AUTO_INCREMENT PRIMARY KEY,
    node_id INT NOT NULL,
    subject_type ENUM('user','group','all') NOT NULL,
    subject_id INT NOT NULL DEFAULT 0,
    can_view TINYINT(1) NOT NULL DEFAULT 1,
    can_edit TINYINT(1) NOT NULL DEFAULT 0,
    UNIQUE (node_id, subject_type, subject_id),
    FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`);
  await pool.query(`CREATE TABLE IF NOT EXISTS private_shares (
    node_id INT NOT NULL, user_id INT NOT NULL, can_edit TINYINT(1) NOT NULL DEFAULT 0,
    PRIMARY KEY(node_id,user_id),
    FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`);
  await pool.query(`CREATE TABLE IF NOT EXISTS collaboration_presence (
    node_id INT NOT NULL,user_id INT NOT NULL,seen_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(node_id,user_id),FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`);
  await pool.query(`CREATE TABLE IF NOT EXISTS file_comments (
    id INT AUTO_INCREMENT PRIMARY KEY,node_id INT NOT NULL,user_id INT NOT NULL,
    body TEXT NOT NULL,created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved TINYINT(1) NOT NULL DEFAULT 0,
    FOREIGN KEY(node_id) REFERENCES nodes(id) ON DELETE CASCADE,
    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE,INDEX(node_id)
  ) ENGINE=InnoDB`);
  for(const [column,type] of [['cursor_start','INT NULL'],['cursor_end','INT NULL']]) if(!(await hasCol('collaboration_presence',column))) await pool.query('ALTER TABLE collaboration_presence ADD COLUMN '+column+' '+type);
  for(const [column,type] of [['quote_text','TEXT NULL'],['selection_start','INT NULL'],['selection_end','INT NULL']]) if(!(await hasCol('file_comments',column))) await pool.query('ALTER TABLE file_comments ADD COLUMN '+column+' '+type);
  await pool.query(`CREATE TABLE IF NOT EXISTS share_links (
    id INT AUTO_INCREMENT PRIMARY KEY,
    node_id INT NOT NULL UNIQUE,
    token CHAR(64) NOT NULL UNIQUE,
    enabled TINYINT(1) NOT NULL DEFAULT 1,
    editor_only TINYINT(1) NOT NULL DEFAULT 0,
    created_by INT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (node_id) REFERENCES nodes(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB`);
  await ensureRoot();
}

// Premier démarrage : création du compte root, mot de passe affiché dans la console.
// RESET_ROOT=1 au démarrage génère un nouveau mot de passe root.
async function ensureRoot() {
  const [[r]] = await pool.query("SELECT id FROM users WHERE role='root' LIMIT 1");
  if (r && process.env.RESET_ROOT !== '1') return;
  const pw = crypto.randomBytes(9).toString('base64url');
  const hash = await bcrypt.hash(pw, 10);
  if (r) await pool.query('UPDATE users SET password_hash=? WHERE id=?', [hash, r.id]);
  else {
    const [[old]] = await pool.query("SELECT id FROM users WHERE username='root'");
    if (old) await pool.query("UPDATE users SET role='root', password_hash=? WHERE id=?", [hash, old.id]);
    else await pool.query("INSERT INTO users(username,password_hash,role) VALUES('root',?,'root')", [hash]);
  }
  console.log(`\n==========================================\n  Compte root créé\n  Identifiant  : root\n  Mot de passe : ${pw}\n  Notez-le : il n'est affiché qu'une fois.\n==========================================\n`);
}

// ---- Outils
const MIMES = {
  html: 'text/html', htm: 'text/html', md: 'text/markdown', markdown: 'text/markdown', txt: 'text/plain',
  css: 'text/css', js: 'text/javascript', json: 'application/json', csv: 'text/csv', xml: 'application/xml',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon', pdf: 'application/pdf', zip: 'application/zip',
};
const mimeOf = (n) => MIMES[(n.split('.').pop() || '').toLowerCase()] || 'application/octet-stream';
const validName = (n) => typeof n === 'string' && n.trim() && n.length <= 255 && !/[\/\\]/.test(n);
const validUser = (u) => /^[\w.-]{3,32}$/.test(String(u || ''));
const validPw = (p) => typeof p === 'string' && p.length >= 6;
const sign = (id) => jwt.sign({ id }, SECRET, { expiresIn: '30d' });
const w = (f) => (q, s) => f(q, s).catch((e) => { console.error(e); if (!s.headersSent) s.status(500).json({ error: 'Erreur serveur' }); });
const fixName = (f) => Buffer.from(f.originalname, 'latin1').toString('utf8'); // noms accentués (multer)
const fail = (s, code, msg) => s.status(code).json({ error: msg });

const auth = async (q, s, n) => {
  let u;
  try {
    const { id } = jwt.verify((q.headers.authorization || '').slice(7), SECRET);
    [[u]] = await pool.query('SELECT id,username,role,display_name,avatar FROM users WHERE id=?', [id]);
    if (!u) throw 0;
  } catch { return s.status(401).json({ error: 'Non authentifié' }); }
  q.user = u; n();
};
const adminOnly = (q, s, n) =>
  q.user.role === 'user' ? fail(s, 403, 'Réservé aux administrateurs.') : n();

const ins = async (uid, parent, name, type, content, po = null) => {
  const f = type === 'file';
  const [r] = await pool.query(
    'INSERT INTO nodes(user_id,private_owner,parent_id,name,type,mime,content,size) VALUES(?,?,?,?,?,?,?,?)',
    [uid, po, parent, name, type, f ? mimeOf(name) : null, f ? content : null, f ? content.length : 0]);
  return r.insertId;
};

// ---- Droits d'accès
// Règles :
//  - espace privé : visible et modifiable uniquement par son propriétaire (même pas par les admins) ;
//  - espace partagé : sans règle nulle part, tout le monde voit et modifie ;
//  - dès qu'un dossier porte des règles, elles remplacent celles du parent pour lui et tout son contenu :
//    seuls les utilisateurs / groupes listés (ou « tout le monde ») ont accès ;
//  - pour voir un élément, il faut aussi pouvoir voir tous ses dossiers parents ;
//  - root et administrateurs ont toujours accès à l'espace partagé.
async function ctx(user) {
  const [ns] = await pool.query('SELECT id,parent_id,name,type,private_owner FROM nodes');
  const [ps] = await pool.query('SELECT node_id,subject_type,subject_id,can_view,can_edit FROM perms');
  const [gm] = await pool.query('SELECT group_id FROM group_members WHERE user_id=?', [user.id]);
  const [privateShares] = await pool.query('SELECT node_id,can_edit FROM private_shares WHERE user_id=?',[user.id]);
  const shares = new Map(privateShares.map(p=>[p.node_id,!!p.can_edit]));
  const groups = new Set(gm.map((g) => g.group_id)), admin = user.role !== 'user';
  const byId = new Map(), kids = new Map(), acl = new Map(), acc = new Map();
  for (const n of ns) { byId.set(n.id, n); const k = n.parent_id || 0; (kids.get(k) || kids.set(k, []).get(k)).push(n.id); }
  for (const p of ps) (acl.get(p.node_id) || acl.set(p.node_id, []).get(p.node_id)).push(p);
  const hit = (p) => p.subject_type === 'all' ||
    (p.subject_type === 'user' && p.subject_id === user.id) || (p.subject_type === 'group' && groups.has(p.subject_id));
  const calc = (id) => {
    if (acc.has(id)) return acc.get(id);
    const n = byId.get(id), par = n.parent_id ? calc(n.parent_id) : { v: true, av: true, ae: true };
    let r;
    if (n.private_owner != null) { const ok = n.private_owner === user.id; let grant; for(let x=id;x;x=byId.get(x)?.parent_id){if(shares.has(x)){grant=shares.get(x);break;}}r = { v: ok || grant !== undefined, e: ok || grant === true }; }
    else {
      const rules = acl.get(id);
      const av = rules ? rules.some((p) => hit(p) && p.can_view) : par.av;
      const ae = rules ? rules.some((p) => hit(p) && p.can_edit) : par.ae;
      const v = admin || (av && par.v);
      r = { v, e: admin || (ae && v), av, ae };
    }
    acc.set(id, r); return r;
  };
  ns.forEach((n) => calc(n.id));
  return { byId, kids, acl, acc };
}
const can = (c, id, l) => { const a = c.acc.get(+id); return !!a && a[l]; };
const subtree = (c, id) => {
  const out = [], st = [id];
  while (st.length) { const x = st.pop(); out.push(x); (c.kids.get(x) || []).forEach((k) => st.push(k)); }
  return out;
};
// Où créer un élément ? Renvoie { parent, po } ou { err: [code, message] }
function place(c, user, parent, priv) {
  if (parent) {
    const p = c.byId.get(+parent);
    if (!p || p.type !== 'folder' || !can(c, p.id, 'v')) return { err: [404, 'Dossier introuvable.'] };
    if (!can(c, p.id, 'e')) return { err: [403, 'Ce dossier est en lecture seule.'] };
    return { parent: p.id, po: p.private_owner };
  }
  return { parent: null, po: priv ? user.id : null };
}

// Copie récursive : seuls les éléments visibles par l'utilisateur sont copiés
async function copy(c, id, uid, parent, name, privateOwner = undefined) {
  const [[n]] = await pool.query(
    'SELECT type,mime,content,size,private_owner FROM nodes WHERE id=?',
    [id]
  );

  const targetOwner = privateOwner === undefined
    ? n.private_owner
    : privateOwner;

  const [r] = await pool.query(
    `INSERT INTO nodes(
      user_id,private_owner,parent_id,name,type,mime,content,size
    ) VALUES(?,?,?,?,?,?,?,?)`,
    [
      uid,
      targetOwner,
      parent,
      name,
      n.type,
      n.mime,
      n.content,
      n.size
    ]
  );

  if (n.type === 'folder') {
    for (const k of c.kids.get(id) || []) {
      if (can(c, k, 'v')) {
        await copy(
          c,
          k,
          uid,
          r.insertId,
          c.byId.get(k).name,
          targetOwner
        );
      }
    }
  }

  return r.insertId;
}
// Ajoute un fichier ou un dossier (éléments visibles uniquement) à une archive zip
async function addTo(c, zip, n, prefix) {
  if (n.type === 'file') {
    const [[r]] = await pool.query('SELECT content FROM nodes WHERE id=?', [n.id]);
    zip.addFile(prefix + n.name, r.content || Buffer.alloc(0));
  } else {
    zip.addFile(prefix + n.name + '/', Buffer.alloc(0));
    for (const k of c.kids.get(n.id) || []) if (can(c, k, 'v')) await addTo(c, zip, c.byId.get(k), prefix + n.name + '/');
  }
}

// ---- Application
const app = express();
app.use(express.json({ limit: '50mb' }));
// Compatible with PHP shared hosting: tunnel PUT/DELETE over POST for authenticated API routes.
app.use('/api', (req, res, next) => {
  if (req.method === 'POST' && ['PUT', 'DELETE'].includes(String(req.query._method || '').toUpperCase())) {
    req.method = String(req.query._method).toUpperCase();
  }
  next();
});
app.use(express.static(path.join(__dirname, 'public')));
// Bibliothèques du navigateur servies localement (fonctionne hors ligne, y compris dans Electron)
const pkgDir = (name) => {
  try { return path.dirname(require.resolve(name + '/package.json')); }
  catch { // paquet qui n'exporte pas son package.json : on remonte depuis son point d'entrée
    let d = path.dirname(require.resolve(name));
    while (!fs.existsSync(path.join(d, 'package.json'))) d = path.dirname(d);
    return d;
  }
};
app.get('/vendor/marked.js', (q, s) => s.sendFile(path.join(pkgDir('marked'), 'marked.min.js')));
app.get('/vendor/mermaid.js', (q, s) => s.sendFile(path.join(pkgDir('mermaid'), 'dist', 'mermaid.min.js'), { maxAge: '7d' }));
// KaTeX (formules LaTeX) : script, CSS et polices. CORS ouvert car l'aperçu tourne dans un iframe isolé (origine « null »)
app.use('/vendor/katex', (q, s, n) => { s.set('Access-Control-Allow-Origin', '*'); n(); },
  express.static(path.join(pkgDir('katex'), 'dist'), { maxAge: '7d' }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_UPLOAD } });

// ---- Compte courant
app.post('/api/login', w(async (q, s) => {
  const [[u]] = await pool.query('SELECT * FROM users WHERE username=?', [String(q.body.username || '')]);
  if (!u || !(await bcrypt.compare(String(q.body.password || ''), u.password_hash)))
    return fail(s, 401, 'Identifiant ou mot de passe incorrect.');
  s.json({ token: sign(u.id) });
}));
app.get('/api/me', auth, (q, s) => s.json(q.user));

app.put('/api/me/avatar',auth,w(async(q,s)=>{
  const avatar=q.body.avatar??null;
  if(avatar!==null){
    if(typeof avatar!=='string'||avatar.length>150000)return fail(s,400,'Image trop volumineuse.');
    const parts=avatar.split(',');
    if(parts.length!==2||!['data:image/png;base64','data:image/jpeg;base64','data:image/webp;base64'].includes(parts[0]))return fail(s,400,'Format non autorisé.');
    const bytes=Buffer.from(parts[1],'base64');
    if(bytes.length>100000||bytes.length===0||bytes.toString('base64').replace(/=+$/,'')!==parts[1].replace(/=+$/,''))return fail(s,400,'Image invalide.');
    const png=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const jpg=bytes[0]===255&&bytes[1]===216&&bytes[2]===255;
    const webp=bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP';
    if(!(png||jpg||webp))return fail(s,400,'Image invalide.');
  }
  await pool.query('UPDATE users SET avatar=? WHERE id=?',[avatar,q.user.id]);s.json({ok:true});
}));
app.put('/api/me/profile', auth, w(async (q, s) => {
  const name = String(q.body.name || '').trim();
  const username = String(q.body.username || '').trim();
  const password = String(q.body.password || '');
  if (!name || name.length > 80) return fail(s, 400, 'Le nom affiché doit contenir entre 1 et 80 caractères.');
  if (!validUser(username)) return fail(s, 400, 'Identifiant invalide (3 à 32 caractères).');
  const [[u]] = await pool.query('SELECT password_hash FROM users WHERE id=?', [q.user.id]);
  if (!u || !(await bcrypt.compare(password, u.password_hash))) return fail(s, 403, 'Mot de passe actuel incorrect.');
  try {
    await pool.query('UPDATE users SET display_name=?,username=? WHERE id=?', [name, username, q.user.id]);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return fail(s, 409, 'Cet identifiant est déjà utilisé.');
    throw e;
  }
  s.json({ ok: true });
}));
app.put('/api/me/password', auth, w(async (q, s) => {
  const [[u]] = await pool.query('SELECT password_hash FROM users WHERE id=?', [q.user.id]);
  if (!(await bcrypt.compare(String(q.body.old || ''), u.password_hash))) return fail(s, 403, 'Mot de passe actuel incorrect.');
  if (!validPw(q.body.password)) return fail(s, 400, 'Mot de passe : 6 caractères minimum.');
  await pool.query('UPDATE users SET password_hash=? WHERE id=?', [await bcrypt.hash(q.body.password, 10), q.user.id]);
  s.json({ ok: true });
}));

// ---- Gestion des comptes (root et administrateurs)
app.get('/api/users', auth, adminOnly, w(async (q, s) => {
  const [r] = await pool.query("SELECT id,username,role,created_at FROM users ORDER BY FIELD(role,'root','admin','user'),username");
  s.json(r);
}));
app.post('/api/users', auth, adminOnly, w(async (q, s) => {
  const { username, password } = q.body, role = q.body.role === 'admin' ? 'admin' : 'user';
  if (role === 'admin' && q.user.role !== 'root') return fail(s, 403, 'Seul root peut créer un administrateur.');
  if (!validUser(username) || !validPw(password)) return fail(s, 400, 'Identifiant : 3 à 32 caractères. Mot de passe : 6 minimum.');
  try {
    const [r] = await pool.query('INSERT INTO users(username,password_hash,role) VALUES(?,?,?)',
      [username, await bcrypt.hash(password, 10), role]);
    s.json({ id: r.insertId });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return fail(s, 409, 'Cet identifiant existe déjà.');
    throw e;
  }
}));
// Compte ciblé modifiable ? Jamais root ni soi-même ; un admin ne gère que les comptes « user ».
async function target(q, s) {
  const [[t]] = await pool.query('SELECT id,role FROM users WHERE id=?', [q.params.id]);
  if (!t) { fail(s, 404, 'Compte introuvable.'); return null; }
  if (t.role === 'root' || t.id === q.user.id || (q.user.role !== 'root' && t.role !== 'user')) {
    fail(s, 403, 'Action non autorisée sur ce compte.'); return null;
  }
  return t;
}
app.put('/api/users/:id', auth, adminOnly, w(async (q, s) => {
  const t = await target(q, s); if (!t) return;
  if ('role' in q.body) {
    if (q.user.role !== 'root') return fail(s, 403, 'Seul root change les rôles.');
    if (!['admin', 'user'].includes(q.body.role)) return fail(s, 400, 'Rôle invalide.');
    await pool.query('UPDATE users SET role=? WHERE id=?', [q.body.role, t.id]);
  }
  if ('password' in q.body) {
    if (!validPw(q.body.password)) return fail(s, 400, 'Mot de passe : 6 caractères minimum.');
    await pool.query('UPDATE users SET password_hash=? WHERE id=?', [await bcrypt.hash(q.body.password, 10), t.id]);
  }
  s.json({ ok: true });
}));
app.delete('/api/users/:id', auth, adminOnly, w(async (q, s) => {
  const t = await target(q, s); if (!t) return;
  // l'espace privé du compte est supprimé avec lui ; les fichiers partagés qu'il a créés sont conservés
  await pool.query('DELETE FROM nodes WHERE private_owner=? AND parent_id IS NULL', [t.id]);
  await pool.query("DELETE FROM perms WHERE subject_type='user' AND subject_id=?", [t.id]);
  await pool.query('DELETE FROM users WHERE id=?', [t.id]);
  s.json({ ok: true });
}));

// ---- Groupes d'utilisateurs (administrateurs)
app.get('/api/groups', auth, adminOnly, w(async (q, s) => {
  const [gs] = await pool.query('SELECT id,name FROM user_groups ORDER BY name');
  const [ms] = await pool.query('SELECT group_id,user_id FROM group_members');
  s.json(gs.map((g) => ({ ...g, members: ms.filter((m) => m.group_id === g.id).map((m) => m.user_id) })));
}));
const validGroup = (n) => typeof n === 'string' && n.trim() && n.trim().length <= 64;
app.post('/api/groups', auth, adminOnly, w(async (q, s) => {
  if (!validGroup(q.body.name)) return fail(s, 400, 'Nom de groupe invalide (64 caractères max).');
  try {
    const [r] = await pool.query('INSERT INTO user_groups(name) VALUES(?)', [q.body.name.trim()]);
    s.json({ id: r.insertId });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return fail(s, 409, 'Ce groupe existe déjà.');
    throw e;
  }
}));
app.put('/api/groups/:id', auth, adminOnly, w(async (q, s) => {
  const [[g]] = await pool.query('SELECT id FROM user_groups WHERE id=?', [q.params.id]);
  if (!g) return fail(s, 404, 'Groupe introuvable.');
  if ('name' in q.body) {
    if (!validGroup(q.body.name)) return fail(s, 400, 'Nom de groupe invalide.');
    try { await pool.query('UPDATE user_groups SET name=? WHERE id=?', [q.body.name.trim(), g.id]); }
    catch (e) { if (e.code === 'ER_DUP_ENTRY') return fail(s, 409, 'Ce groupe existe déjà.'); throw e; }
  }
  if (Array.isArray(q.body.members)) {
    const ids = q.body.members.map(Number).filter(Boolean);
    await pool.query('DELETE FROM group_members WHERE group_id=?', [g.id]);
    if (ids.length) await pool.query('INSERT INTO group_members(group_id,user_id) SELECT ?, id FROM users WHERE id IN (?)', [g.id, ids]);
  }
  s.json({ ok: true });
}));
app.delete('/api/groups/:id', auth, adminOnly, w(async (q, s) => {
  await pool.query("DELETE FROM perms WHERE subject_type='group' AND subject_id=?", [q.params.id]);
  await pool.query('DELETE FROM user_groups WHERE id=?', [q.params.id]);
  s.json({ ok: true });
}));

// ---- Permissions d'un dossier (administrateurs)
app.get('/api/nodes/:id/perms', auth, adminOnly, w(async (q, s) => {
  const c = await ctx(q.user), n = c.byId.get(+q.params.id);
  if (!n || n.private_owner != null) return fail(s, 404, 'Introuvable.');
  const [rules] = await pool.query(
    'SELECT subject_type type,subject_id id,can_view view,can_edit edit FROM perms WHERE node_id=?', [n.id]);
  let from = null; // dossier parent dont les règles s'appliquent ici
  if (!rules.length)
    for (let p = n.parent_id; p; p = c.byId.get(p).parent_id)
      if (c.acl.has(p)) { from = { id: p, name: c.byId.get(p).name }; break; }
  s.json({ rules: rules.map((r) => ({ type: r.type, id: r.id, view: !!r.view, edit: !!r.edit })), from });
}));

app.put('/api/nodes/:id/perms', auth, adminOnly, w(async (q, s) => {
  const c = await ctx(q.user), n = c.byId.get(+q.params.id);
  if (!n || n.private_owner != null || n.type !== 'folder')
    return fail(s, 404, 'Dossier introuvable.');
  if (!Array.isArray(q.body.rules))
    return fail(s, 400, 'Règles de permissions invalides.');

  const rules = [];
  for (const rule of q.body.rules) {
    const type = rule?.type;
    const id = Number(rule?.id || 0);
    if (!['user', 'group', 'all'].includes(type))
      return fail(s, 400, 'Type de permission invalide.');
    if (type === 'user' && !(await pool.query('SELECT id FROM users WHERE id=?', [id]))[0].length)
      return fail(s, 400, 'Utilisateur introuvable.');
    if (type === 'group' && !(await pool.query('SELECT id FROM user_groups WHERE id=?', [id]))[0].length)
      return fail(s, 400, 'Groupe introuvable.');
    if (type === 'all' && id !== 0)
      return fail(s, 400, 'Identifiant de règle invalide.');
    rules.push({ type, id, view: !!rule.view, edit: !!rule.edit });
  }

  await pool.query('DELETE FROM perms WHERE node_id=?', [n.id]);
  for (const rule of rules) {
    await pool.query(
      'INSERT INTO perms(node_id,subject_type,subject_id,can_view,can_edit) VALUES(?,?,?,?,?)',
      [n.id, rule.type, rule.id, rule.view ? 1 : 0, rule.edit ? 1 : 0]
    );
  }
  s.json({ ok: true });
}));
app.put('/api/nodes/:id', auth, w(async (q, s) => {
  const c = await ctx(q.user);
  const n = c.byId.get(+q.params.id);

  if (!n || !can(c, n.id, 'v'))
    return fail(s, 404, 'Introuvable.');

  if (!can(c, n.id, 'e'))
    return fail(s, 403, 'Lecture seule : modification impossible.');

  const b = q.body;
  const sets = [];
  const v = [];

  if ('name' in b) {
    if (!validName(b.name))
      return fail(s, 400, 'Nom invalide.');

    sets.push('name=?');
    v.push(b.name.trim());

    if (n.type === 'file') {
      sets.push('mime=?');
      v.push(mimeOf(b.name));
    }
  }

  if ('parent_id' in b) {
    const pl = place(
      c,
      q.user,
      b.parent_id,
      'private' in b ? b.private : n.private_owner != null
    );

    if (pl.err)
      return fail(s, ...pl.err);

    const ids = subtree(c, n.id);

    if (pl.parent && ids.includes(pl.parent))
      return fail(s, 400, 'Impossible de déplacer un dossier dans lui-même.');

    // Passage entre espace partagé et espace personnel :
    // on copie au lieu de déplacer.
    if (pl.po !== n.private_owner) {
      if (!ids.every((i) => can(c, i, 'e')))
        return fail(s, 403, 'Certains éléments sont en lecture seule.');

      const newId = await copy(
        c,
        n.id,
        q.user.id,
        pl.parent,
        'name' in b ? b.name.trim() : n.name,
        pl.po
      );

      // Le contenu éventuel est appliqué à la nouvelle copie.
      if ('content' in b && n.type === 'file') {
        const buf = Buffer.from(String(b.content), 'utf8');

        await pool.query(
          'UPDATE nodes SET content=?,size=? WHERE id=?',
          [buf, buf.length, newId]
        );
      }

      return s.json({
        ok: true,
        id: newId,
        copied: true,
        original_id: n.id
      });
    }

    // Déplacement normal au sein du même espace.
    sets.push('parent_id=?');
    v.push(pl.parent);
  }

  if ('content' in b && n.type === 'file') {
    const buf = Buffer.from(String(b.content), 'utf8');

    sets.push('content=?', 'size=?', 'revision=revision+1');
    v.push(buf, buf.length);
  }

  if (sets.length) {
    if ('content' in b && Number.isInteger(b.expected_revision)) {
      const [result] = await pool.query(`UPDATE nodes SET ${sets.join(',')} WHERE id=? AND revision=?`, [...v,n.id,b.expected_revision]);
      if (!result.affectedRows) return fail(s,409,'Le fichier a été modifié par un autre utilisateur. Rechargez sa version avant de sauvegarder.');
    } else {
      await pool.query(`UPDATE nodes SET ${sets.join(',')} WHERE id=?`, [...v,n.id]);
    }
  }

  s.json({ ok: true, id: n.id, copied: false });
}));

// ---- Liens de partage publics (un lien unique par fichier)
app.get('/api/nodes/:id/share', auth, w(async (q, s) => {
  const c = await ctx(q.user), n = c.byId.get(+q.params.id);
  if (!n || n.type !== 'file' || !can(c, n.id, 'e')) return fail(s, 404, 'Fichier introuvable ou non modifiable.');
  const [[share]] = await pool.query('SELECT id,token,enabled,editor_only,created_at FROM share_links WHERE node_id=?', [n.id]);
  s.json(share || null);
}));
app.put('/api/nodes/:id/share', auth, w(async (q, s) => {
  const c = await ctx(q.user), n = c.byId.get(+q.params.id);
  if (!n || n.type !== 'file' || !can(c, n.id, 'e')) return fail(s, 404, 'Fichier introuvable ou non modifiable.');
  const enabled = q.body.enabled === false || q.body.enabled === 0 ? 0 : 1;
  const editorOnly = q.body.editor_only ? 1 : 0;
  const [[existing]] = await pool.query('SELECT id,token FROM share_links WHERE node_id=?', [n.id]);
  if (existing) {
    await pool.query('UPDATE share_links SET enabled=?,editor_only=? WHERE id=?', [enabled, editorOnly, existing.id]);
    return s.json({ id: existing.id, token: existing.token, enabled: !!enabled, editor_only: !!editorOnly });
  }
  const token = crypto.randomBytes(32).toString('hex');
  const [r] = await pool.query('INSERT INTO share_links(node_id,token,enabled,editor_only,created_by) VALUES(?,?,?,?,?)', [n.id, token, enabled, editorOnly, q.user.id]);
  s.json({ id: r.insertId, token, enabled: !!enabled, editor_only: !!editorOnly });
}));
app.delete('/api/nodes/:id/share', auth, w(async (q, s) => {
  const c = await ctx(q.user), n = c.byId.get(+q.params.id);
  if (!n || n.type !== 'file' || !can(c, n.id, 'e')) return fail(s, 404, 'Fichier introuvable ou non modifiable.');
  await pool.query('DELETE FROM share_links WHERE node_id=?', [n.id]);
  s.json({ ok: true });
}));
app.get('/api/public-share/:token', w(async (q, s) => {
  const [[r]] = await pool.query(`SELECT sl.editor_only,n.id,n.name,n.mime,n.content FROM share_links sl JOIN nodes n ON n.id=sl.node_id WHERE sl.token=? AND sl.enabled=1`, [q.params.token]);
  if (!r) return fail(s, 404, 'Lien de partage introuvable ou désactivé.');
  s.set('Cache-Control', 'no-store').set('X-Content-Type-Options', 'nosniff');
  s.json({ name: r.name, mime: r.mime || 'text/plain', content: (r.content || Buffer.alloc(0)).toString('utf8'), editor_only: !!r.editor_only });
}));
app.put('/api/public-share/:token', w(async (q, s) => {
  const [[r]] = await pool.query(`SELECT sl.id,n.id node_id FROM share_links sl JOIN nodes n ON n.id=sl.node_id WHERE sl.token=? AND sl.enabled=1 AND sl.editor_only=1`, [q.params.token]);
  if (!r) return fail(s, 403, 'Ce lien ne permet pas la modification.');
  if (typeof q.body.content !== 'string' || Buffer.byteLength(q.body.content, 'utf8') > MAX_UPLOAD) return fail(s, 400, 'Contenu invalide ou trop volumineux.');
  const b = Buffer.from(q.body.content, 'utf8');
  await pool.query('UPDATE nodes SET content=?,size=? WHERE id=?', [b, b.length, r.node_id]);
  s.json({ ok: true });
}));

const ZIP_ENTRY_LIMIT=1500, ZIP_PREVIEW_LIMIT=4*1024*1024;
function zipEntrySafe(name){return name&&!name.includes('\\')&&!name.startsWith('/')&&!name.split('/').some(p=>p==='..'||p==='.')&&!/^[a-z]:/i.test(name);}
function zipIndex(content){
 const zip=new AdmZip(content), entries=zip.getEntries();
 if(entries.length>ZIP_ENTRY_LIMIT)throw Object.assign(new Error('Archive contenant trop de fichiers.'),{status:413});
 return {zip,entries:entries.filter(e=>zipEntrySafe(e.entryName)).map(e=>({path:e.entryName,size:e.header.size,dir:e.isDirectory}))};
}
function zipRespond(s,content,entryPath,download){
 let zip,entries;try{({zip,entries}=zipIndex(content));}catch(e){return fail(s,e.status||400,e.message||'Archive ZIP invalide.');}
 if(!entryPath)return s.json({entries});
 const entry=entries.find(e=>e.path===entryPath&&!e.dir);
 if(!entry)return fail(s,404,'Fichier absent de cette archive.');
 if(entry.size>ZIP_PREVIEW_LIMIT&&!download)return fail(s,413,'Fichier trop volumineux pour un aperçu.');
 if(entry.size>100*1024*1024)return fail(s,413,'Entrée trop volumineuse.');
 let data;try{data=zip.getEntry(entryPath).getData();}catch{return fail(s,400,'Entrée ZIP illisible.');}
 const filename=entryPath.split('/').pop();
 s.set('Cache-Control','no-store').set('X-Content-Type-Options','nosniff');
 if(download)return s.attachment(filename).type('application/octet-stream').send(data);
 return s.type('application/octet-stream').send(data);
}
app.get('/api/nodes/:id/zip-preview',auth,w(async(q,s)=>{
 const c=await ctx(q.user),n=c.byId.get(+q.params.id);
 if(!n||n.type!=='file'||!can(c,n.id,'v')||!n.name.toLowerCase().endsWith('.zip'))return fail(s,404,'Archive inaccessible.');
 const [[r]]=await pool.query('SELECT content FROM nodes WHERE id=?',[n.id]);
 return zipRespond(s,r.content||Buffer.alloc(0),q.query.entry||'',q.query.download==='1');
}));
app.get('/s/:token/zip-preview',w(async(q,s)=>{
 const [[r]]=await pool.query("SELECT n.name,n.content FROM share_links sl JOIN nodes n ON n.id=sl.node_id WHERE sl.token=? AND sl.enabled=1 AND n.type='file'",[q.params.token]);
 if(!r||!r.name.toLowerCase().endsWith('.zip'))return fail(s,404,'Archive inaccessible.');
 return zipRespond(s,r.content||Buffer.alloc(0),q.query.entry||'',q.query.download==='1');
}));

app.get('/s/:token/download', w(async (q, s) => {
  const [[r]] = await pool.query(
    'SELECT n.name,n.content FROM share_links sl JOIN nodes n ON n.id=sl.node_id WHERE sl.token=? AND sl.enabled=1 AND n.type=?',
    [q.params.token,'file']
  );
  if (!r) return s.status(404).json({error:'Lien de partage invalide ou désactivé.'});
  s.set('Cache-Control','no-store').set('X-Content-Type-Options','nosniff')
   .attachment(r.name).type('application/octet-stream').send(r.content || Buffer.alloc(0));
}));
app.get('/s/:token', w(async (q, s) => {
  const [[r]] = await pool.query(
    `SELECT sl.editor_only,n.name,n.mime,n.content
     FROM share_links sl JOIN nodes n ON n.id=sl.node_id
     WHERE sl.token=? AND sl.enabled=1`, [q.params.token]
  );
  const escHtml = v => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  if (!r) return s.status(404).type('html').send(`<!doctype html><html lang="fr"><meta charset="utf-8"><title>Page non trouvée</title><body style="font:16px system-ui;padding:3rem"><h1>Page non trouvée...</h1><p>Ce lien est invalide ou désactivé.</p></body></html>`);

  const name = r.name, ext = (name.split('.').pop() || '').toLowerCase();
  const mime = r.mime || 'text/plain', raw = r.content || Buffer.alloc(0);
  const textContent = raw.toString('utf8');
  const nonce = crypto.randomBytes(18).toString('base64');
  const editor = !!r.editor_only;
  const safeHtml = source => {
    let v = source
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<\s*(script|iframe|object|embed|applet|form|base|meta|link)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
      .replace(/<\s*(script|iframe|object|embed|applet|form|base|meta|link)\b[^>]*\/?\s*>/gi, '')
      .replace(/\s+on[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
      .replace(/\s+(href|src|xlink:href|action|formaction)\s*=\s*(["'])\s*javascript:[\s\S]*?\2/gi, ' $1="#"');
    const csp = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data: blob: https:; style-src \'unsafe-inline\'; font-src data: https:; form-action \'none\'; base-uri \'none\'">';
    return /<head\b[^>]*>/i.test(v) ? v.replace(/<head\b[^>]*>/i, m => m + csp) : csp + v;
  };
  let preview = '';
  if (['png','jpg','jpeg','gif','webp','svg','bmp','ico'].includes(ext) || mime.startsWith('image/')) {
    preview = `<img class="media" alt="${escHtml(name)}" src="data:${escHtml(mime)};base64,${raw.toString('base64')}">`;
  } else if (ext === 'pdf' || mime === 'application/pdf') {
    preview = `<iframe class="pdf" title="${escHtml(name)}" src="data:application/pdf;base64,${raw.toString('base64')}" sandbox="allow-same-origin"></iframe>`;
  } else if (ext === 'html' || ext === 'htm' || mime === 'text/html') {
    preview = `<iframe class="html" title="${escHtml(name)}" sandbox="" srcdoc="${escHtml(safeHtml(textContent))}"></iframe>`;
  } else if (ext === 'md' || ext === 'markdown' || mime === 'text/markdown') {
    preview = `<article id="markdown" class="markdown"></article><textarea id="source" hidden>${escHtml(textContent)}</textarea>`;
  } else if (ext === 'json' || mime === 'application/json') {
    let formatted = textContent; try { formatted = JSON.stringify(JSON.parse(textContent), null, 2); } catch {}
    preview = `<pre class="code">${escHtml(formatted)}</pre>`;
  } else if (mime.startsWith('text/') || ['txt','css','js','ts','py','java','c','cpp','cs','sh','yml','yaml','xml','csv','log'].includes(ext)) {
    preview = `<pre class="code">${escHtml(textContent)}</pre>`;
  } else {
    preview = '<div class="no-preview">Aucun aperçu disponible pour ce type de fichier. Vous pouvez le télécharger.</div>';
  }
  const downloadLink = `<a class="download" href="/s/${q.params.token}/download" download="${escHtml(name)}">↓ Télécharger le fichier</a>`;
  const editorBox = editor ? `<section class="editor"><label for="edit-content">Modifier le fichier partagé</label><textarea id="edit-content">${escHtml(textContent)}</textarea><button id="save">Enregistrer</button><span id="status" role="status"></span></section>` : '';
  const isHtml=['html','htm'].includes(ext)||mime==='text/html';
  const isMd=['md','markdown'].includes(ext)||mime==='text/markdown';
  const isCode=!isHtml&&!isMd&&(mime.startsWith('text/')||['txt','json','css','js','ts','py','java','c','cpp','cs','sh','yml','yaml','xml','csv','log'].includes(ext));
  const language=isHtml?'html':isMd?'markdown':ext;
  const mode=ext==='zip'?'zip':isHtml?'html':isMd?'markdown':isCode?'code':'other';
  const contentPreview=mode==='zip'?'<div class="fbi-zip-host"></div>':isHtml?'<iframe class="share-html-frame" title="Aperçu HTML" sandbox=""></iframe>'
    :isMd?'<article class="share-markdown share-rendered-markdown"></article>'
    :isCode?'<pre><code class="share-code" data-lang="'+escHtml(language)+'"></code></pre>'
    :preview;
  const showSource=isHtml||isMd;
  const editable=editor&&(isHtml||isMd||isCode);
  const editorHTML=editable?'<section class="share-card"><h2>Modifier le fichier</h2><textarea id="edit-content" class="share-editor" spellcheck="false">'+escHtml(textContent)+'</textarea><div class="share-editor-actions"><button class="share-button share-button-primary" id="save">Enregistrer</button><span id="status" role="status" class="share-muted"></span></div></section>':'';
  s.set('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; img-src data: blob: https:; frame-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
   .set('X-Content-Type-Options','nosniff').set('Cache-Control','no-store').type('html')
   .send(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escHtml(name)}</title><link rel="stylesheet" href="../../share-view.css"></head>
   <body><main class="share-page" data-share-view data-mode="${mode}" data-lang="${escHtml(language)}" data-token="${q.params.token}" data-base="">
   <header class="share-header"><div><h1>${escHtml(name)}</h1><span class="share-muted">${editor?'Lien éditeur':'Partage en lecture seule'}</span></div><div class="share-actions">${showSource?'<button class="share-button" id="share-source-toggle" aria-expanded="false">Afficher le code source</button>':''}<a class="share-button share-button-primary" href="./${q.params.token}/download" download="${escHtml(name)}">↓ Télécharger</a></div></header>
   <section class="share-card"><h2>Aperçu</h2><div id="share-preview" class="share-preview">${contentPreview}</div></section>
   ${showSource?'<section id="share-source-panel" class="share-card share-source-panel" hidden><h2>Code source</h2><pre><code id="share-source-code" class="share-source-code"></code></pre></section>':''}
   ${editorHTML}<textarea id="share-source" hidden>${escHtml(textContent)}</textarea></main>
   ${isMd||mode==='zip'?'<script src="../../vendor/marked.js?v=20261106b" defer></script>':''}<script src="../../zip-view.js?v=20261106b" defer></script><script src="../../share-view.js?v=20261106b" defer></script></body></html>`);

}));

// Présence et commentaires sur les fichiers accessibles.
async function collabAccess(q,s){
  const c=await ctx(q.user),n=c.byId.get(+q.params.id);
  if(!n||n.type!=='file'||!can(c,n.id,'v')){fail(s,404,'Fichier inaccessible.');return null;}
  return {c,n};
}
app.get('/api/nodes/:id/collaboration',auth,w(async(q,s)=>{
  if(!await collabAccess(q,s))return;
  const [users]=await pool.query('SELECT u.id,u.username,u.avatar,p.cursor_start,p.cursor_end,COALESCE(u.display_name,u.username) name FROM collaboration_presence p JOIN users u ON u.id=p.user_id WHERE p.node_id=? AND p.seen_at>DATE_SUB(NOW(),INTERVAL 35 SECOND) ORDER BY u.username',[+q.params.id]);
  const [[version]]=await pool.query('SELECT updated_at,revision FROM nodes WHERE id=?',[+q.params.id]);
  s.json({users,updated_at:version.updated_at,revision:version.revision});
}));
app.post('/api/nodes/:id/collaboration',auth,w(async(q,s)=>{
  if(!await collabAccess(q,s))return;
  await pool.query('INSERT INTO collaboration_presence(node_id,user_id,seen_at,cursor_start,cursor_end) VALUES(?,?,NOW(),?,?) ON DUPLICATE KEY UPDATE seen_at=NOW(),cursor_start=VALUES(cursor_start),cursor_end=VALUES(cursor_end)', [+q.params.id,q.user.id,Number.isInteger(q.body.cursor_start)?Math.max(0,q.body.cursor_start):null,Number.isInteger(q.body.cursor_end)?Math.max(0,q.body.cursor_end):null]);
  const [users]=await pool.query('SELECT u.id,u.username,u.avatar,p.cursor_start,p.cursor_end,COALESCE(u.display_name,u.username) name FROM collaboration_presence p JOIN users u ON u.id=p.user_id WHERE p.node_id=? AND p.seen_at>DATE_SUB(NOW(),INTERVAL 35 SECOND) ORDER BY u.username',[+q.params.id]);
  const [[version]]=await pool.query('SELECT updated_at FROM nodes WHERE id=?',[+q.params.id]);
  s.json({users,updated_at:version.updated_at});
}));
app.get('/api/nodes/:id/comments',auth,w(async(q,s)=>{
  if(!await collabAccess(q,s))return;
  const [rows]=await pool.query('SELECT c.id,c.user_id,c.body,c.quote_text,c.selection_start,c.selection_end,c.created_at,c.resolved,u.username FROM file_comments c JOIN users u ON u.id=c.user_id WHERE c.node_id=? ORDER BY c.id',[+q.params.id]);
  s.json(rows);
}));
app.post('/api/nodes/:id/comments',auth,w(async(q,s)=>{
  if(!await collabAccess(q,s))return;
  const body=String(q.body.body||'').trim();
  if(!body||body.length>2000)return fail(s,400,'Commentaire invalide (1 à 2000 caractères).');
  await pool.query('INSERT INTO file_comments(node_id,user_id,body,quote_text,selection_start,selection_end) VALUES(?,?,?,?,?,?)',[+q.params.id,q.user.id,body,String(q.body.quote_text||'').slice(0,500),Number.isInteger(q.body.selection_start)?Math.max(0,q.body.selection_start):null,Number.isInteger(q.body.selection_end)?Math.max(0,q.body.selection_end):null]);
  s.json({ok:true});
}));
app.delete('/api/nodes/:id/comments/:commentId',auth,w(async(q,s)=>{
  const access=await collabAccess(q,s);if(!access)return;
  const [[comment]]=await pool.query('SELECT user_id FROM file_comments WHERE id=? AND node_id=?',[+q.params.commentId,+q.params.id]);
  if(!comment)return fail(s,404,'Commentaire introuvable.');
  if(comment.user_id!==q.user.id&&!can(access.c,access.n.id,'e'))return fail(s,403,'Suppression non autorisée.');
  await pool.query('DELETE FROM file_comments WHERE id=? AND node_id=?',[+q.params.commentId,+q.params.id]);
  s.json({ok:true});
}));
app.put('/api/nodes/:id/comments/:commentId',auth,w(async(q,s)=>{
  const access=await collabAccess(q,s);if(!access)return;
  const [[comment]]=await pool.query('SELECT user_id FROM file_comments WHERE id=? AND node_id=?',[+q.params.commentId,+q.params.id]);
  if(!comment)return fail(s,404,'Commentaire introuvable.');
  if(comment.user_id!==q.user.id&&!can(access.c,access.n.id,'e'))return fail(s,403,'Action non autorisée.');
  await pool.query('UPDATE file_comments SET resolved=? WHERE id=?',[q.body.resolved?1:0,+q.params.commentId]);
  s.json({ok:true});
}));

// Partages privés entre comptes : le propriétaire seul gère les accès.
app.get('/api/share-users', auth, w(async(q,s)=>{
  const [users]=await pool.query('SELECT id,username,display_name FROM users WHERE id<>? ORDER BY username',[q.user.id]);
  s.json(users);
}));
app.get('/api/nodes/:id/private-shares', auth, w(async(q,s)=>{
  const [[n]]=await pool.query('SELECT private_owner FROM nodes WHERE id=?',[+q.params.id]);
  if(!n||n.private_owner!==q.user.id)return fail(s,403,'Seul le propriétaire peut partager cet élément.');
  const [rows]=await pool.query('SELECT ps.user_id,us.username,ps.can_edit FROM private_shares ps JOIN users us ON us.id=ps.user_id WHERE ps.node_id=? ORDER BY us.username',[+q.params.id]);
  s.json(rows);
}));
app.put('/api/nodes/:id/private-shares', auth, w(async(q,s)=>{
  const [[n]]=await pool.query('SELECT private_owner FROM nodes WHERE id=?',[+q.params.id]);
  if(!n||n.private_owner!==q.user.id)return fail(s,403,'Seul le propriétaire peut partager cet élément.');
  const uid=+q.body.user_id;
  const [[target]]=await pool.query('SELECT id FROM users WHERE id=?',[uid]);
  if(!target||uid===q.user.id)return fail(s,400,'Utilisateur invalide.');
  await pool.query('INSERT INTO private_shares(node_id,user_id,can_edit) VALUES(?,?,?) ON DUPLICATE KEY UPDATE can_edit=VALUES(can_edit)',[+q.params.id,uid,q.body.can_edit?1:0]);
  s.json({ok:true});
}));
app.delete('/api/nodes/:id/private-shares', auth, w(async(q,s)=>{
  const [[n]]=await pool.query('SELECT private_owner FROM nodes WHERE id=?',[+q.params.id]);
  if(!n||n.private_owner!==q.user.id)return fail(s,403,'Seul le propriétaire peut partager cet élément.');
  await pool.query('DELETE FROM private_shares WHERE node_id=? AND user_id=?',[+q.params.id,+q.body.user_id]);
  s.json({ok:true});
}));

// ---- Arborescence : uniquement ce que l'utilisateur a le droit de voir
app.get('/api/nodes', auth, w(async (q, s) => {
  const c = await ctx(q.user), admin = q.user.role !== 'user';
  const [r] = await pool.query('SELECT id,parent_id,name,type,mime,size,updated_at,private_owner FROM nodes');
  s.json(r.filter((n) => can(c, n.id, 'v')).map((n) => ({
    id: n.id, parent_id: n.parent_id, name: n.name, type: n.type, mime: n.mime, size: n.size, updated_at: n.updated_at,
    priv: n.private_owner != null, shared_with_me: n.private_owner != null && n.private_owner !== q.user.id, edit: can(c, n.id, 'e'),
    lock: admin && n.private_owner == null && c.acl.has(n.id), // dossier avec règles propres
  })));
}));

app.post('/api/nodes', auth, w(async (q, s) => {
  const { name, type } = q.body;
  if (!validName(name) || !['file', 'folder'].includes(type))
    return fail(s, 400, 'Nom invalide (les caractères / et \\ sont interdits).');
  const pl = place(await ctx(q.user), q.user, q.body.parent_id, q.body.private);
  if (pl.err) return fail(s, ...pl.err);
  s.json({ id: await ins(q.user.id, pl.parent, name.trim(), type, Buffer.alloc(0), pl.po) });
}));

// Importer n'importe quel type de fichier
app.post('/api/upload', auth, upload.fields([{ name: 'files', maxCount: 1000 }, { name: 'files[]', maxCount: 1000 }]), w(async (q, s) => {
  const pl = place(await ctx(q.user), q.user, +q.body.parent_id || null, q.body.private === '1');
  if (pl.err) return fail(s, ...pl.err);
  const files = [...(q.files?.files || []), ...(q.files?.['files[]'] || [])];
  for (const f of files) await ins(q.user.id, pl.parent, fixName(f).slice(0, 255), 'file', f.buffer, pl.po);
  s.json({ ok: true });
}));

// Contenu brut (affichage dans l'application)
app.get('/api/nodes/:id/content', auth, w(async (q, s) => {
  const c = await ctx(q.user), n = c.byId.get(+q.params.id);
  if (!n || n.type !== 'file' || !can(c, n.id, 'v')) return fail(s, 404, 'Fichier introuvable.');
  const [[r]] = await pool.query('SELECT mime,content FROM nodes WHERE id=?', [n.id]);
  s.set('X-Content-Type-Options', 'nosniff').type(r.mime || 'application/octet-stream').send(r.content);
}));

// Télécharger : le fichier tel quel, ou le dossier compressé en zip
app.get('/api/nodes/:id/download', auth, w(async (q, s) => {
  const c = await ctx(q.user), n = c.byId.get(+q.params.id);
  if (!n || !can(c, n.id, 'v')) return fail(s, 404, 'Introuvable.');
  if (n.type === 'file') {
    const [[r]] = await pool.query('SELECT content FROM nodes WHERE id=?', [n.id]);
    return s.attachment(n.name).type('application/octet-stream').send(r.content);
  }
  const z = new AdmZip(); await addTo(c, z, n, '');
  s.attachment(n.name + '.zip').send(z.toBuffer());
}));

// Renommer / déplacer / enregistrer le contenu
app.put('/api/nodes/:id', auth, w(async (q, s) => {
  const c = await ctx(q.user), n = c.byId.get(+q.params.id);
  if (!n || !can(c, n.id, 'v')) return fail(s, 404, 'Introuvable.');
  if (!can(c, n.id, 'e')) return fail(s, 403, 'Lecture seule : modification impossible.');
  const b = q.body, sets = [], v = [];
  if ('name' in b) {
    if (!validName(b.name)) return fail(s, 400, 'Nom invalide.');
    sets.push('name=?'); v.push(b.name.trim());
    if (n.type === 'file') { sets.push('mime=?'); v.push(mimeOf(b.name)); }
  }
  if ('parent_id' in b) {
    const pl = place(c, q.user, b.parent_id, 'private' in b ? b.private : n.private_owner != null);
    if (pl.err) return fail(s, ...pl.err);
    const ids = subtree(c, n.id);
    if (pl.parent && ids.includes(pl.parent)) return fail(s, 400, 'Impossible de déplacer un dossier dans lui-même.');
    sets.push('parent_id=?'); v.push(pl.parent);
    if (pl.po !== n.private_owner) { // changement d'espace (partagé <-> privé) : tout le contenu suit
      if (!ids.every((i) => can(c, i, 'e'))) return fail(s, 403, 'Certains éléments sont en lecture seule.');
      await pool.query('UPDATE nodes SET private_owner=? WHERE id IN (?)', [pl.po, ids]);
      await pool.query('DELETE FROM perms WHERE node_id IN (?)', [ids]);
    }
  }
  if ('content' in b && n.type === 'file') {
    const buf = Buffer.from(String(b.content), 'utf8');
    sets.push('content=?', 'size=?'); v.push(buf, buf.length);
  }
  if (sets.length) await pool.query(`UPDATE nodes SET ${sets.join(',')} WHERE id=?`, [...v, n.id]);
  s.json({ ok: true });
}));

// Dupliquer (récursif pour les dossiers)
app.post('/api/nodes/:id/duplicate', auth, w(async (q, s) => {
  const c = await ctx(q.user), n = c.byId.get(+q.params.id);
  if (!n || !can(c, n.id, 'v')) return fail(s, 404, 'Introuvable.');
  const pl = place(c, q.user, n.parent_id, n.private_owner != null);
  if (pl.err) return fail(s, ...pl.err);
  s.json({ id: await copy(c, n.id, q.user.id, n.parent_id, n.name.replace(/(\.[^.]*)?$/, ' (copie)$1')) });
}));

// Compresser un fichier ou un dossier en zip (le zip est créé à côté, dans l'arborescence)
app.post('/api/nodes/:id/zip', auth, w(async (q, s) => {
  const c = await ctx(q.user), n = c.byId.get(+q.params.id);
  if (!n || !can(c, n.id, 'v')) return fail(s, 404, 'Introuvable.');
  const pl = place(c, q.user, n.parent_id, n.private_owner != null);
  if (pl.err) return fail(s, ...pl.err);
  const z = new AdmZip(); await addTo(c, z, n, '');
  const base = n.type === 'file' ? n.name.replace(/\.[^.]*$/, '') || n.name : n.name;
  s.json({ id: await ins(q.user.id, pl.parent, base.slice(0, 250) + '.zip', 'file', z.toBuffer(), pl.po) });
}));

// Extraire un zip dans un nouveau dossier du même nom ; la réponse est un flux de progression (une ligne JSON par étape)
app.post('/api/nodes/:id/extract', auth, w(async (q, s) => {
  const c = await ctx(q.user), n = c.byId.get(+q.params.id);
  if (!n || n.type !== 'file' || !can(c, n.id, 'v')) return fail(s, 404, 'Fichier introuvable.');
  const pl = place(c, q.user, n.parent_id, n.private_owner != null);
  if (pl.err) return fail(s, ...pl.err);
  const [[{ content }]] = await pool.query('SELECT content FROM nodes WHERE id=?', [n.id]);
  let entries;
  try { entries = new AdmZip(content).getEntries(); }
  catch { return fail(s, 400, "Ce fichier n'est pas une archive zip valide."); }
  const total = entries.reduce((a, e) => a + e.header.size, 0);
  if (entries.length > 10000 || total > MAX_UNZIP) return fail(s, 400, 'Archive trop volumineuse.');

  s.set({ 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' });
  s.flushHeaders();
  const send = (o) => s.write(JSON.stringify(o) + '\n');
  let root = null;
  try {
    root = await ins(q.user.id, pl.parent, (n.name.replace(/\.zip$/i, '') || n.name).slice(0, 255), 'folder', null, pl.po);
    const cache = new Map([['', root]]);
    const ensure = async (parts) => { // crée les sous-dossiers manquants
      let key = '';
      for (const p of parts) {
        key += '/' + p;
        if (!cache.has(key)) cache.set(key, await ins(q.user.id, cache.get(key.slice(0, key.lastIndexOf('/'))), p, 'folder', null, pl.po));
      }
      return cache.get(key);
    };
    let done = 0, last = -1;
    for (const e of entries) {
      const pct = total ? Math.floor((done * 100) / total) : 0;
      if (pct !== last) { last = pct; send({ p: pct }); }
      done += e.header.size;
      const parts = e.entryName.replace(/\\/g, '/').split('/').filter((p) => p && p !== '.');
      // protection « zip slip » + dossiers parasites macOS
      if (!parts.length || parts[0] === '__MACOSX' || parts.some((p) => p === '..' || p.length > 255)) continue;
      if (e.isDirectory) { await ensure(parts); continue; }
      const name = parts.pop();
      await ins(q.user.id, await ensure(parts), name, 'file', e.getData(), pl.po);
    }
    send({ p: 100 });
    send({ id: root });
  } catch (err) {
    console.error(err);
    if (root) await pool.query('DELETE FROM nodes WHERE id=?', [root]).catch(() => {});
    send({ error: 'Extraction interrompue : ' + err.message });
  }
  s.end();
}));

// Supprimer (cascade) : refusé si un élément du dossier est en lecture seule pour l'utilisateur
app.delete('/api/nodes/:id', auth, w(async (q, s) => {
  const c = await ctx(q.user), n = c.byId.get(+q.params.id);
  if (!n || !can(c, n.id, 'v')) return fail(s, 404, 'Introuvable.');
  if (!subtree(c, n.id).every((i) => can(c, i, 'e'))) return fail(s, 403, 'Suppression impossible : certains éléments sont protégés.');
  await pool.query('DELETE FROM nodes WHERE id=?', [n.id]);
  s.json({ ok: true });
}));

app.use((q, s, n) => {
  if (q.path.startsWith('/api/')) return s.status(404).json({ error: 'Page non trouvée...' });
  if (q.method === 'GET') return s.status(404).type('html').send('<!doctype html><html lang="fr"><meta charset="utf-8"><title>Page non trouvée</title><body style="font:16px system-ui;padding:3rem"><h1>Page non trouvée...</h1><p>La page demandée n’existe pas.</p></body></html>');
  n();
});

app.use((e, q, s, n) => { // erreurs d'import (fichier trop gros…)
  if (e.code === 'LIMIT_FILE_SIZE') return fail(s, 413, `Fichier trop volumineux (max ${MAX_UPLOAD / 1048576} Mo).`);
  console.error(e); fail(s, 500, 'Erreur serveur');
});

// ---- Démarrage (utilisable seul ou depuis Electron)
async function start(port = process.env.PORT || 3000) {
  await initDb();
  return new Promise((res) => {
    const srv = app.listen(port, () => { console.log(`FileWeb : http://localhost:${port}`); res(srv); });
  });
}
module.exports = { start };
if (require.main === module)
  start().catch((e) => { console.error('Démarrage impossible :', e.message); process.exit(1); });
