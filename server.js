require('dotenv').config();
const express  = require('express');
const session  = require('express-session');
const https    = require('https');
const path     = require('path');
const fs       = require('fs');
const Database = require('better-sqlite3');

const CLIENT_ID     = process.env.DISCORD_CLIENT_ID     || '1507385450095054898';
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || '';
const BOT_TOKEN     = process.env.BOT_TOKEN             || '';
const REDIRECT_URI  = process.env.REDIRECT_URI          || 'http://localhost:3002/auth/callback';
const SESSION_SEC   = process.env.SESSION_SECRET        || 'majordome-dev-secret';
const DB_PATH       = process.env.BOT_DB_PATH
  ? path.resolve(process.env.BOT_DB_PATH)
  : path.join(__dirname, '..', 'discord-bot', 'data', 'bot.db');
const PORT = parseInt(process.env.PORT || '3002');

// ── DB ────────────────────────────────────────────────────────────────────────
function getDb() {
  try { return new Database(DB_PATH, { readonly: false }); }
  catch { return null; }
}

const DEFAULT_CONFIG = {
  OWNER_ROLES: [], STAFF_ROLE: null, MOD_LOG_CHANNEL: null,
  WELCOME_CHANNEL: null, WELCOME_MESSAGE: null, WELCOME_COLOR: null,
  GOODBYE_CHANNEL: null, GOODBYE_MESSAGE: null,
  LOGS: { messages: null, moderation: null, vocal: null, server: null, commands: null },
  LEVEL_CHANNEL: null, LEVEL_ROLES: {},
  WORD_FILTER: [],
  TICKET_CATEGORY: null, TICKET_PANEL_CHANNEL: null, TICKET_LOG_CHANNEL: null,
  ROLE_BUTTONS_CHANNEL: null, ROLE_BUTTONS: [],
  SUGGESTION_CHANNEL: null,
  TWITCH_ANNOUNCE_CHANNEL: null, TWITCH_STREAMERS: [],
  PENDING_ROLE: null, VERIFIED_ROLE: null,
  DM_ENABLED: false, DM_MESSAGE: null,
  AUTO_ROLE: null,
  STARBOARD_CHANNEL: null, STARBOARD_THRESHOLD: 3,
  TEMP_VOICE_HUB: null, TEMP_VOICE_CATEGORY: null,
  BIRTHDAY_CHANNEL: null,
  ANTI_SPAM_ENABLED: false, ANTI_SPAM_MAX_MESSAGES: 5, ANTI_SPAM_WINDOW_MS: 5000,
  STATS_MEMBER_CHANNEL: null, STATS_BOT_CHANNEL: null,
};

function readConfig(guildId) {
  const db = getDb();
  if (!db) return { ...DEFAULT_CONFIG };
  try {
    const row = db.prepare('SELECT config FROM guild_configs WHERE guild_id = ?').get(guildId);
    db.close();
    if (!row) return { ...DEFAULT_CONFIG };
    return { ...DEFAULT_CONFIG, ...JSON.parse(row.config) };
  } catch { db.close(); return { ...DEFAULT_CONFIG }; }
}

function writeConfig(guildId, patch) {
  const db = getDb();
  if (!db) return false;
  try {
    const row = db.prepare('SELECT config FROM guild_configs WHERE guild_id = ?').get(guildId);
    const current = row ? { ...DEFAULT_CONFIG, ...JSON.parse(row.config) } : { ...DEFAULT_CONFIG };
    // Deep merge
    const merged = { ...current };
    for (const [k, v] of Object.entries(patch)) {
      if (v !== null && typeof v === 'object' && !Array.isArray(v) && merged[k] && typeof merged[k] === 'object') {
        merged[k] = { ...merged[k], ...v };
      } else {
        merged[k] = v;
      }
    }
    db.prepare(`
      INSERT INTO guild_configs (guild_id, config, updated_at) VALUES (?, ?, ?)
      ON CONFLICT(guild_id) DO UPDATE SET config = excluded.config, updated_at = excluded.updated_at
    `).run(guildId, JSON.stringify(merged), Date.now());
    db.close();
    return merged;
  } catch (e) { console.error(e); db.close(); return false; }
}

async function getStats(guildId) {
  const db = getDb();
  if (!db) return {};
  try {
    const members    = db.prepare('SELECT member_count FROM guilds WHERE guild_id = ?').get(guildId);
    const xpCount    = db.prepare('SELECT COUNT(*) as n FROM xp WHERE guild_id = ?').get(guildId);
    const topXpRaw   = db.prepare('SELECT user_id, xp, level FROM xp WHERE guild_id = ? ORDER BY xp DESC LIMIT 5').all(guildId);
    const errors     = db.prepare('SELECT COUNT(*) as n FROM errors WHERE resolved = 0').get();
    db.close();
    const topXp = await Promise.all(topXpRaw.map(async row => {
      try {
        const u = await discordGet(`/users/${row.user_id}`, BOT_TOKEN, true);
        return { ...row, username: u.global_name || u.username || row.user_id };
      } catch { return { ...row, username: row.user_id }; }
    }));
    return { memberCount: members?.member_count ?? 0, xpUsers: xpCount?.n ?? 0, topXp, errors: errors?.n ?? 0 };
  } catch (e) { try { db.close(); } catch {} return {}; }
}

// ── Discord API helper ────────────────────────────────────────────────────────
function discordPost(endpoint, body) {
  return new Promise((resolve, reject) => {
    const payload = body.toString();
    const opts = {
      hostname: 'discord.com', path: `/api/v10${endpoint}`, method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(payload) },
    };
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error(d)); } });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function discordBotPost(endpoint, body, method = 'POST') {
  return new Promise((resolve, reject) => {
    const payload = body != null ? JSON.stringify(body) : null;
    const opts = {
      hostname: 'discord.com', path: `/api/v10${endpoint}`, method,
      headers: {
        'Authorization': `Bot ${BOT_TOKEN}`,
        'User-Agent': 'LeMajordome Dashboard/1.0',
      },
    };
    if (payload) {
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        if (!d.trim()) return resolve({ ok: true });
        try { resolve(JSON.parse(d)); } catch { reject(new Error(d)); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function discordGet(endpoint, token, bot = false) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'discord.com', path: `/api/v10${endpoint}`,
      headers: { Authorization: bot ? `Bot ${token}` : `Bearer ${token}` },
    };
    https.get(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error(d)); } });
    }).on('error', reject);
  });
}

function isAdmin(permissions) {
  try { return (BigInt(permissions) & BigInt(0x8)) === BigInt(0x8) || (BigInt(permissions) & BigInt(0x20)) === BigInt(0x20); }
  catch { return false; }
}

// ── Express ───────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json({ limit: '12mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: SESSION_SEC, resave: false, saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000, secure: false },
}));

function auth(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: 'Non authentifié' });
  next();
}

function authGuild(req, res, next) {
  const adminGuilds = req.session?.user?.adminGuilds || [];
  if (!adminGuilds.includes(req.params.id)) return res.status(403).json({ error: 'Accès refusé' });
  next();
}

// ── Auth routes ───────────────────────────────────────────────────────────────
app.get('/auth/login', (req, res) => {
  const p = new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'code', scope: 'identify guilds' });
  res.redirect(`https://discord.com/oauth2/authorize?${p}`);
});

app.get('/auth/callback', async (req, res) => {
  const { code, error } = req.query;
  if (error || !code) return res.redirect('/?error=denied');
  try {
    const token = await discordPost('/oauth2/token', new URLSearchParams({
      client_id: CLIENT_ID, client_secret: CLIENT_SECRET,
      grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI,
    }));
    if (!token.access_token) return res.redirect('/?error=token');
    const [user, userGuilds] = await Promise.all([
      discordGet('/users/@me', token.access_token),
      discordGet('/users/@me/guilds', token.access_token),
    ]);
    const adminGuilds = Array.isArray(userGuilds)
      ? userGuilds.filter(g => isAdmin(g.permissions)).map(g => ({
          id: g.id, name: g.name,
          icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png?size=128` : null,
        }))
      : [];
    req.session.user = {
      id: user.id, username: user.username, global_name: user.global_name, avatar: user.avatar,
      accessToken: token.access_token,
      adminGuilds: adminGuilds.map(g => g.id),   // IDs only — pour authGuild()
      cachedGuilds: adminGuilds,                  // objets complets — pour /api/guilds
    };
    res.redirect('/select.html');
  } catch (e) { console.error('OAuth:', e.message); res.redirect('/?error=oauth'); }
});

app.get('/auth/logout', (req, res) => { req.session.destroy(); res.redirect('/'); });

// ── API ───────────────────────────────────────────────────────────────────────
app.get('/api/me', auth, (req, res) => res.json(req.session.user));

app.get('/api/guilds', auth, (req, res) => {
  try {
    const cached = req.session.user.cachedGuilds || [];

    const db = getDb();
    let botGuildIds = new Set();
    if (db) {
      botGuildIds = new Set(db.prepare('SELECT guild_id FROM guilds').all().map(r => r.guild_id));
      db.close();
    }

    // Filter by bot presence if DB has entries, otherwise show all admin guilds
    const list = botGuildIds.size > 0 ? cached.filter(g => botGuildIds.has(g.id)) : cached;
    res.json(list);
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

app.get('/api/guild/:id', auth, authGuild, async (req, res) => {
  const gid = req.params.id;
  try {
    const config = readConfig(gid);
    const stats  = await getStats(gid);
    // Fetch channels & roles via bot token
    let channels = [], roles = [], emojis = [], activeThreads = [];
    if (BOT_TOKEN) {
      try { channels = await discordGet(`/guilds/${gid}/channels`, BOT_TOKEN, true); } catch {}
      try { roles    = await discordGet(`/guilds/${gid}/roles`,    BOT_TOKEN, true); } catch {}
      try { emojis   = await discordGet(`/guilds/${gid}/emojis`,   BOT_TOKEN, true); } catch {}
      try {
        const tr = await discordGet(`/guilds/${gid}/threads/active`, BOT_TOKEN, true);
        activeThreads = Array.isArray(tr?.threads) ? tr.threads : [];
      } catch {}
    }
    const textChannels = Array.isArray(channels)
      ? channels.filter(c => [0, 5].includes(c.type)).sort((a, b) => a.position - b.position)
      : [];
    const categories   = Array.isArray(channels) ? channels.filter(c => c.type === 4).sort((a, b) => a.position - b.position) : [];
    const guildRoles   = Array.isArray(roles)    ? roles.filter(r => r.id !== gid).sort((a, b) => b.position - a.position) : [];
    const guildEmojis  = Array.isArray(emojis)   ? emojis.map(e => ({ id: e.id, name: e.name, animated: e.animated || false })) : [];
    const threads      = activeThreads.map(t => ({ id: t.id, name: t.name, parent_id: t.parent_id }));
    res.json({ config, stats, channels: textChannels, categories, roles: guildRoles, emojis: guildEmojis, threads });
  } catch (e) { console.error(e); res.status(500).json({ error: e.message }); }
});

// ── Upload image ──────────────────────────────────────────────────────────────
app.post('/api/upload-image', auth, (req, res) => {
  const { data, filename } = req.body;
  if (!data || !data.startsWith('data:image')) return res.status(400).json({ error: 'Format invalide' });
  const m = data.match(/^data:image\/(\w+);base64,(.+)$/s);
  if (!m) return res.status(400).json({ error: 'Format invalide' });
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 8 * 1024 * 1024) return res.status(400).json({ error: 'Fichier trop lourd (max 8 Mo)' });
  const dir = path.join(__dirname, 'public', 'uploads');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const fname = Date.now() + '_' + Math.random().toString(36).slice(2, 7) + '.' + ext;
  fs.writeFileSync(path.join(dir, fname), buf);
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  res.json({ url: `http://${host}/uploads/${fname}` });
});

// ── Panneaux dynamiques ───────────────────────────────────────────────────────
app.get('/api/guild/:id/panels', auth, authGuild, (req, res) => {
  const db = getDb();
  if (!db) return res.json([]);
  try {
    db.prepare('CREATE TABLE IF NOT EXISTS panels (id TEXT PRIMARY KEY, guild_id TEXT, channel_id TEXT, message_id TEXT, config TEXT NOT NULL DEFAULT \'{}\', created_at INTEGER NOT NULL)').run();
    const rows = db.prepare('SELECT id, channel_id, message_id, config, created_at FROM panels WHERE guild_id = ? ORDER BY created_at DESC LIMIT 20').all(req.params.id);
    db.close();
    res.json(rows.map(r => { try { return { ...r, config: JSON.parse(r.config) }; } catch { return { ...r, config: {} }; } }));
  } catch (e) { try { db.close(); } catch {} res.json([]); }
});

app.post('/api/guild/:id/panel', auth, authGuild, async (req, res) => {
  const gid = req.params.id;
  const { channelId, embed, options, multi, placeholder } = req.body;
  if (!channelId || !Array.isArray(options) || !options.length) return res.status(400).json({ error: 'Canal et options requis' });

  const panelId = Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

  const selectOptions = options.slice(0, 25).map(o => {
    const opt = { label: (o.label || 'Rôle').slice(0, 100), value: o.roleId };
    if (o.emojiId)   opt.emoji = { id: o.emojiId, name: o.emojiName || 'e', animated: !!o.emojiAnimated };
    else if (o.emoji) opt.emoji = { name: o.emoji };
    if (o.description) opt.description = o.description.slice(0, 100);
    return opt;
  });

  const embedObj = {};
  if (embed?.title)       embedObj.title       = embed.title.slice(0, 256);
  if (embed?.description) embedObj.description = embed.description.slice(0, 4096);
  if (embed?.color)       embedObj.color       = parseInt((embed.color || '#000000').replace('#', ''), 16);
  if (embed?.image)       embedObj.image       = { url: embed.image };
  if (embed?.thumbnail)   embedObj.thumbnail   = { url: embed.thumbnail };

  const payload = {
    content:    embed?.content  || undefined,
    embeds:     Object.keys(embedObj).length ? [embedObj] : undefined,
    components: [{ type: 1, components: [{
      type: 3, custom_id: 'panel_select_' + panelId,
      placeholder: (placeholder || 'Choisir...').slice(0, 150),
      min_values: 0, max_values: multi ? options.length : 1,
      options: selectOptions,
    }] }],
  };

  try {
    const msg = await discordBotPost(`/channels/${channelId}/messages`, payload);
    if (!msg.id) return res.status(400).json({ error: msg.message || 'Erreur Discord', code: msg.code });

    const db = getDb();
    if (db) {
      try {
        db.prepare('CREATE TABLE IF NOT EXISTS panels (id TEXT PRIMARY KEY, guild_id TEXT, channel_id TEXT, message_id TEXT, config TEXT NOT NULL DEFAULT \'{}\', created_at INTEGER NOT NULL)').run();
        db.prepare('INSERT OR REPLACE INTO panels (id, guild_id, channel_id, message_id, config, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(panelId, gid, channelId, msg.id, JSON.stringify({ embed, options, multi, placeholder }), Date.now());
        db.close();
      } catch { try { db.close(); } catch {} }
    }
    res.json({ ok: true, panelId, messageId: msg.id });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/guild/:id/panel/:panelId', auth, authGuild, async (req, res) => {
  const gid = req.params.id;
  const panelId = req.params.panelId;
  const { channelId, messageId, embed, options, multi, placeholder } = req.body;
  if (!channelId || !messageId || !Array.isArray(options) || !options.length) return res.status(400).json({ error: 'Données manquantes' });

  const selectOptions = options.slice(0, 25).map(o => {
    const opt = { label: (o.label || 'Rôle').slice(0, 100), value: o.roleId };
    if (o.emojiId)   opt.emoji = { id: o.emojiId, name: o.emojiName || 'e', animated: !!o.emojiAnimated };
    else if (o.emoji) opt.emoji = { name: o.emoji };
    if (o.description) opt.description = o.description.slice(0, 100);
    return opt;
  });

  const embedObj = {};
  if (embed?.title)       embedObj.title       = embed.title.slice(0, 256);
  if (embed?.description) embedObj.description = embed.description.slice(0, 4096);
  if (embed?.color)       embedObj.color       = parseInt((embed.color || '#000000').replace('#', ''), 16);
  if (embed?.image)       embedObj.image       = { url: embed.image };
  if (embed?.thumbnail)   embedObj.thumbnail   = { url: embed.thumbnail };

  const payload = {
    content:    embed?.content  || null,
    embeds:     Object.keys(embedObj).length ? [embedObj] : [],
    components: [{ type: 1, components: [{
      type: 3, custom_id: 'panel_select_' + panelId,
      placeholder: (placeholder || 'Choisir...').slice(0, 150),
      min_values: 0, max_values: multi ? options.length : 1,
      options: selectOptions,
    }] }],
  };

  try {
    const msg = await discordBotPost(`/channels/${channelId}/messages/${messageId}`, payload, 'PATCH');
    if (!msg.id) return res.status(400).json({ error: msg.message || 'Erreur Discord', code: msg.code });

    const db = getDb();
    if (db) {
      try {
        db.prepare('UPDATE panels SET config = ? WHERE id = ? AND guild_id = ?').run(JSON.stringify({ embed, options, multi, placeholder }), panelId, gid);
        db.close();
      } catch { try { db.close(); } catch {} }
    }
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/guild/:id/panel/:panelId', auth, authGuild, async (req, res) => {
  const gid = req.params.id;
  const panelId = req.params.panelId;

  const db = getDb();
  let channelId, messageId;
  if (db) {
    try {
      const row = db.prepare('SELECT channel_id, message_id FROM panels WHERE id = ? AND guild_id = ?').get(panelId, gid);
      if (row) { channelId = row.channel_id; messageId = row.message_id; }
      db.prepare('DELETE FROM panels WHERE id = ? AND guild_id = ?').run(panelId, gid);
      db.close();
    } catch { try { db.close(); } catch {} }
  }

  if (channelId && messageId) {
    try { await discordBotPost(`/channels/${channelId}/messages/${messageId}`, null, 'DELETE'); } catch {}
  }

  res.json({ ok: true });
});

app.patch('/api/guild/:id', auth, authGuild, (req, res) => {
  const gid = req.params.id;
  const patch = req.body;
  if (!patch || typeof patch !== 'object') return res.status(400).json({ error: 'Body invalide' });
  const result = writeConfig(gid, patch);
  if (!result) return res.status(500).json({ error: 'Erreur écriture DB' });
  res.json({ ok: true, config: result });
});


app.listen(PORT, () => console.log(`✅ Dashboard → http://localhost:${PORT}`));
