# Dashboard LeMajordome

Interface web de configuration pour le bot Discord **LeMajordome (RNA)**. Permet de configurer tous les modules du bot via une interface graphique sans toucher au code.

---

## Sommaire

1. [Fonctionnalités](#fonctionnalités)
2. [Prérequis](#prérequis)
3. [Installation](#installation)
4. [Variables d'environnement](#variables-denvironnement)
5. [Déploiement en production](#déploiement-en-production)
6. [Pages et onglets](#pages-et-onglets)
7. [Structure du projet](#structure-du-projet)

---

## Fonctionnalités

- **Connexion sécurisée** via Discord OAuth2 — seuls les admins du serveur peuvent accéder
- **Vue d'ensemble** par serveur : membres actifs, top XP, erreurs bot
- **Configuration complète** de tous les modules du bot via formulaires :
  - Général (rôles owner/staff, auto-rôle, bump Disboard)
  - Automod (filtre de mots, anti-spam)
  - Logs (salon par type d'événement)
  - Bienvenue (message, couleur embed, DM, au revoir)
  - Niveaux XP (salon d'annonce, rôles de récompense par niveau)
  - Tickets (catégorie, salon panel, logs)
  - Rôles auto (boutons libre-service)
  - Twitch (streamers suivis, salon d'annonce)
  - Avancé (starboard, salons vocaux temporaires, compteurs membres, anniversaires)
- **Données en temps réel** : salons, rôles et catégories chargés depuis Discord via le token bot
- **Sauvegarde instantanée** dans la base SQLite du bot

---

## Prérequis

- **Node.js** v18 ou supérieur
- Le bot **LeMajordome** déjà installé et sa base `bot.db` accessible
- Une **application Discord** avec OAuth2 configurée ([Discord Developer Portal](https://discord.com/developers/applications))

---

## Installation

### 1. Installer les dépendances

```bash
cd bot-dashboard
npm install
```

### 2. Créer le fichier d'environnement

Copier `.env.example` et remplir les valeurs :

```bash
cp .env.example .env
```

```env
DISCORD_CLIENT_ID=ton_client_id
DISCORD_CLIENT_SECRET=ton_client_secret
BOT_TOKEN=token_du_bot
SESSION_SECRET=chaine_aleatoire_de_64_caracteres_minimum
REDIRECT_URI=http://ton-ip:3002/auth/callback
BOT_DB_PATH=../discord-bot/data/bot.db
PORT=3002
```

> **Où trouver ces valeurs :**
> - `DISCORD_CLIENT_ID` → [Discord Dev Portal](https://discord.com/developers/applications) → ton app → **General Information** → *Application ID*
> - `DISCORD_CLIENT_SECRET` → même page → **OAuth2** → *Client Secret* (cliquer sur Reset)
> - `BOT_TOKEN` → **Bot** → *Reset Token*
> - `SESSION_SECRET` → n'importe quelle chaîne longue et aléatoire (ex: résultat de `openssl rand -hex 32`)

### 3. Configurer le Redirect URI dans Discord

Dans le [Discord Developer Portal](https://discord.com/developers/applications) → **OAuth2 → Redirects**, ajouter exactement la même URL que `REDIRECT_URI` dans ton `.env`.

Exemple : `http://85.239.155.164:3002/auth/callback`

### 4. Lancer le dashboard

```bash
npm start
# ou en dev avec rechargement automatique :
npm run dev
```

Accès : `http://localhost:3002` (ou l'IP du serveur en production)

---

## Variables d'environnement

| Variable | Obligatoire | Description |
|---|---|---|
| `DISCORD_CLIENT_ID` | ✅ | ID de l'application Discord |
| `DISCORD_CLIENT_SECRET` | ✅ | Secret OAuth2 de l'application |
| `BOT_TOKEN` | ✅ | Token du bot — utilisé pour récupérer salons/rôles en temps réel |
| `SESSION_SECRET` | ✅ | Clé de chiffrement des sessions (longue et aléatoire) |
| `REDIRECT_URI` | ✅ | URL de callback OAuth2 — doit correspondre exactement au portail Discord |
| `BOT_DB_PATH` | ✅ | Chemin vers `bot.db` du bot (relatif ou absolu) |
| `PORT` | ❌ | Port d'écoute (défaut : `3002`) |

---

## Déploiement en production

### Avec PM2

Créer `ecosystem.config.js` :

```js
module.exports = {
  apps: [
    {
      name: 'dashboard',
      script: 'server.js',
      cwd: '/opt/dashboard',
      watch: false,
      autorestart: true,
      env: {
        NODE_ENV: 'production',
        PORT: '3002',
        DISCORD_CLIENT_ID: '...',
        DISCORD_CLIENT_SECRET: '...',
        BOT_TOKEN: '...',
        SESSION_SECRET: '...',
        REDIRECT_URI: 'http://ton-ip:3002/auth/callback',
        BOT_DB_PATH: '/opt/bots/discord-bot/data/bot.db',
      },
    },
  ],
};
```

```bash
pm2 start ecosystem.config.js
pm2 save
```

### Accès via Tailscale (réseau privé)

Si tu utilises Tailscale pour accéder au serveur, tu peux exposer le dashboard sur le réseau Tailscale uniquement :

```bash
tailscale serve --bg http://127.0.0.1:3002
```

Attention : le `REDIRECT_URI` doit correspondre à l'URL Tailscale si tu te connectes via celle-ci.

---

## Pages et onglets

### Page de connexion (`/`)
Login via Discord OAuth2. Seuls les membres avec la permission **Gérer le serveur** sur au moins un serveur où le bot est présent peuvent accéder.

### Sélection de serveur (`/app` → select)
Liste les serveurs Discord communs entre l'utilisateur et le bot.

### Vue d'ensemble (onglet Overview)
- Nombre de membres
- Nombre de joueurs XP
- Top 5 XP avec pseudos Discord résolus
- Nombre d'erreurs bot non résolues

### Onglet Général
- Rôles propriétaires (accès admin)
- Rôle staff (modération)
- Rôle automatique à l'arrivée
- Configuration bump Disboard (salon + rôle à mentionner)

### Onglet Automod
- Liste de mots bannis
- Anti-spam (activation + seuil + fenêtre de temps)

### Onglet Logs
- Salon pour les logs de messages (suppression/modification)
- Salon pour les logs de modération
- Salon pour les logs vocaux
- Salon pour les logs serveur

### Onglet Bienvenue
- Canal de bienvenue
- Message personnalisé (variables : `{user}` `{server}` `{count}`)
- Couleur de l'embed (color picker)
- DM optionnel à l'arrivée
- Canal et message de départ

### Onglet Niveaux XP
- Canal d'annonce des montées de niveau
- Rôles de récompense par niveau (tableau éditable)

### Onglet Tickets
- Catégorie des tickets
- Canal du panel ticket
- Canal de logs des tickets

### Onglet Rôles auto
- Canal pour les boutons de rôles
- Sélection des rôles proposés

### Onglet Twitch
- Canal d'annonce des lives
- Liste des streamers Twitch suivis

### Onglet Avancé
- Starboard (canal + seuil d'étoiles)
- Salons vocaux temporaires (hub + catégorie)
- Salons statistiques membres/bots
- Canal d'annonce des anniversaires

---

## Structure du projet

```
bot-dashboard/
├── server.js           # Serveur Express — OAuth2, API, lecture/écriture SQLite
├── ecosystem.config.js # Config PM2 pour le déploiement
├── .env                # Variables d'environnement (ne pas committer)
├── package.json
└── public/
    ├── index.html      # Page de connexion Discord OAuth2
    ├── select.html     # Sélection du serveur Discord
    ├── app.html        # Interface principale de configuration (tous les onglets)
    ├── pokemon-battle.html   # Interface de configuration des combats Pokémon
    └── pokemon-embeds.html   # Prévisualisation des embeds Pokémon
```

### API interne

| Route | Méthode | Description |
|---|---|---|
| `GET /auth/login` | — | Redirige vers Discord OAuth2 |
| `GET /auth/callback` | — | Callback OAuth2, crée la session |
| `GET /auth/logout` | — | Détruit la session |
| `GET /api/me` | Auth | Infos de l'utilisateur connecté |
| `GET /api/guilds` | Auth | Liste des serveurs accessibles |
| `GET /api/guild/:id` | Auth | Config + stats + salons + rôles d'un serveur |
| `PATCH /api/guild/:id` | Auth | Sauvegarde la configuration d'un serveur |
