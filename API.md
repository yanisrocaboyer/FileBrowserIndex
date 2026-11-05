# API REST FBI — PHP et Node.js

L'API REST est déjà disponible dans les deux backends. Les mêmes chemins fonctionnent sur une instance PHP (ex. `https://example.com/fbi/api/...`) et sur Node.js (ex. `http://localhost:3000/api/...`).

> **Sécurité :** `JWT_SECRET` est une clé privée de signature du serveur. **Ne l'envoyez jamais à l'API et ne l'intégrez jamais à un bot ou à un script client.** Connectez-vous avec un compte FBI pour obtenir un **JWT utilisateur** temporaire. Les requêtes utilisent `Authorization: Bearer <JWT>`. Le JWT possède les droits du compte connecté. Utilisez HTTPS et un compte dédié aux automatisations, avec des permissions minimales.

## Connexion

```bash
curl -sS -X POST "https://example.com/fbi/api/login" \
  -H "Content-Type: application/json" \
  -d '{"username":"compte_api","password":"VOTRE_MOT_DE_PASSE"}'
```

Réponse : `{"token":"eyJ..."}`. Le JWT expire au bout de 30 jours dans l'implémentation actuelle : reconnectez-vous pour en obtenir un autre. Conservez-le dans une variable d'environnement et ne le publiez jamais.

Les exemples suivants supposent :

```bash
export FBI_URL="https://example.com/fbi"
export FBI_TOKEN="VOTRE_JWT_UTILISATEUR"
```

## Opérations principales

| Méthode | Chemin | Fonction |
| --- | --- | --- |
| `GET` | `/api/me` | Informations sur le compte connecté |
| `GET` | `/api/nodes` | Lister les fichiers/dossiers accessibles, avec ID, parent, nom et permissions |
| `POST` | `/api/nodes` | Créer un fichier ou un dossier |
| `GET` | `/api/nodes/:id/content` | Récupérer le contenu brut d'un fichier |
| `GET` | `/api/nodes/:id/download` | Télécharger un fichier ou une archive ZIP du dossier |
| `PUT` | `/api/nodes/:id` | Modifier le contenu, renommer ou déplacer |
| `DELETE` | `/api/nodes/:id` | Supprimer le fichier/dossier |
| `POST` | `/api/nodes/:id/duplicate` | Dupliquer |
| `POST` | `/api/upload` | Importer des fichiers (multipart/form-data) |

`parent_id: null` désigne la racine de l'espace choisi ; `private: true` cible l'espace privé. Les IDs sont ceux retournés par `GET /api/nodes`. Les droits de lecture/écriture de FBI s'appliquent à toutes les requêtes.

### Créer un dossier privé

```bash
curl -sS -X POST "$FBI_URL/api/nodes" \
  -H "Authorization: Bearer $FBI_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"Documents","type":"folder","parent_id":null,"private":true}'
```

Réponse : `{"id":123}` (exemple). Réutilisez cet ID comme `parent_id`.

### Créer un fichier texte dans ce dossier

```bash
curl -sS -X POST "$FBI_URL/api/nodes" \
  -H "Authorization: Bearer $FBI_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"notes.md","type":"file","parent_id":123,"private":true}'
```

### Écrire ou remplacer le contenu

```bash
curl -sS -X PUT "$FBI_URL/api/nodes/124" \
  -H "Authorization: Bearer $FBI_TOKEN" -H "Content-Type: application/json" \
  -d '{"content":"# Bonjour\nContenu créé par API."}'
```

`PUT` remplace le contenu intégral du fichier, il n'ajoute pas simplement des lignes. Pour les fichiers collaboratifs, récupérez d'abord la révision courante et transmettez `expected_revision` afin de détecter les conflits (HTTP 409).

### Lire le contenu

```bash
curl -sS "$FBI_URL/api/nodes/124/content" -H "Authorization: Bearer $FBI_TOKEN"
```

### Renommer un fichier

```bash
curl -sS -X PUT "$FBI_URL/api/nodes/124" \
  -H "Authorization: Bearer $FBI_TOKEN" -H "Content-Type: application/json" \
  -d '{"name":"nouveau-nom.md"}'
```

### Supprimer

```bash
curl -sS -X DELETE "$FBI_URL/api/nodes/124" -H "Authorization: Bearer $FBI_TOKEN"
```

**Attention :** la suppression est définitive et ne demande aucune confirmation par API.

### Importer un fichier binaire

```bash
curl -sS -X POST "$FBI_URL/api/upload" \
  -H "Authorization: Bearer $FBI_TOKEN" \
  -F "files=@./image.png" -F "parent_id=123" -F "private=1"
```

### Exemple Python

```python
import os
import requests

base = os.environ["FBI_URL"].rstrip("/")
headers = {"Authorization": f"Bearer {os.environ['FBI_TOKEN']}"}
r = requests.get(f"{base}/api/nodes", headers=headers, timeout=20)
r.raise_for_status()
for node in r.json():
    print(node["id"], node["name"], node["type"])
```

## Particularités PHP / OVH

Sur certains hébergements mutualisés, Apache/PHP ne transmet pas automatiquement l'en-tête `Authorization`. Il faut configurer la propagation du header dans `.htaccess` ou dans le serveur. Si la version web fonctionne déjà avec l'authentification Bearer, les appels API peuvent utiliser la même configuration.

Certaines installations OVH bloquent `PUT` et `DELETE` au niveau HTTP. L'interface FBI dispose d'un contournement utilisant `POST` et le paramètre `?_method=PUT` ou `?_method=DELETE` ; vérifiez que la version PHP déployée prend bien en charge ce mécanisme avant de l'utiliser depuis un script.

## Réponses et erreurs

Les opérations JSON retournent généralement `{"ok":true}` ou `{"id":123}`. Les erreurs retournent `{"error":"..."}` avec un statut HTTP adapté : 400 (entrée invalide), 401 (jeton absent/expiré), 403 (permission refusée), 404 (introuvable) ou 409 (conflit d'édition).

## Clés API persistantes

Cette version **n'ajoute pas encore de clés API permanentes indépendantes des JWT utilisateur**. Pour un bot à long terme, la suite recommandée est une gestion des clés API par utilisateur (génération aléatoire, stockage haché, permissions minimales, expiration et révocation), plutôt que d'exposer `JWT_SECRET`.
