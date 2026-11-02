#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
// keizu-server: runs the server and manages accounts from the command line.
//
//   keizu-server serve                 start the server
//   keizu-server invite [--admin] [--quota-mb N]   one-time sign-up link
//   keizu-server user list
//   keizu-server user passwd <name>    password reset link
//   keizu-server user delete <name>
//   keizu-server pair <name>           print a 6-digit pairing code and QR
//   keizu-server backup                write a backup now
//   keizu-server version

import { statSync, statfsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import QRCode from 'qrcode';
import { openDb, type Db } from './db.ts';
import { createApp, SERVER_VERSION, type Config } from './app.ts';
import { createInvite, createPairCode, createUser, findUser, inviteLink } from './auth.ts';
import { backupNow, pruneBackups } from './backup.ts';
import { purgeTrash } from './maps.ts';

const env = process.env;
const DATA = env.KEIZU_DATA ?? '/data';
const DB_FILE = join(DATA, 'keizu.db');
const BACKUP_DIR = join(DATA, 'backups');
const PUBLIC_URL = env.KEIZU_PUBLIC_URL?.trim() || (env.KEIZU_DOMAIN ? `https://${env.KEIZU_DOMAIN.trim()}` : undefined);

// The built web app: bundled into the Docker image at /app/web. Empty KEIZU_WEB turns it off.
const WEB_DIR = env.KEIZU_WEB ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'web');

const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);

function flag(args: string[], name: string): string | true | undefined {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = args[i + 1];
  return v && !v.startsWith('--') ? v : true;
}

function hasWebApp(dir: string): boolean {
  if (!dir) return false;
  try {
    return statSync(join(dir, 'index.html')).isFile();
  } catch {
    return false;
  }
}

function linkBase(): string {
  return PUBLIC_URL ?? `http://localhost:${env.KEIZU_PORT ?? 8787}`;
}

function printInvite(db: Db, admin: boolean, quotaBytes = 0) {
  const { token } = createInvite(db, { kind: 'signup', admin, quotaBytes });
  console.log(`\nDavet linki (7 gün geçerli, tek kullanımlık):\n  ${inviteLink(linkBase(), token)}\n`);
  console.log('Linki açan kişi kendi kullanıcı adını ve şifresini seçer.\n');
}

async function printPairing(db: Db, username: string) {
  const user = findUser(db, username);
  if (!user) throw new Error(`Kullanıcı yok: ${username}`);
  const { code } = createPairCode(db, user.id);
  const pretty = `${code.slice(0, 3)} ${code.slice(3)}`;
  console.log(`\nEşleştirme kodu (${username}, 10 dakika geçerli): ${pretty}`);
  if (PUBLIC_URL) {
    const link = `keizu://connect?server=${encodeURIComponent(PUBLIC_URL)}&code=${code}`;
    console.log(`Bağlantı linki: ${link}\n`);
    console.log(await QRCode.toString(link, { type: 'terminal', small: true }));
  }
  console.log('Keizu → Ayarlar → Bulut senkronu → Eşleştirme kodu: sunucu adresini ve bu kodu gir.\n');
}

function daily(db: Db, keep: number) {
  const run = () => {
    try {
      // Never let a backup fill the disk.
      const dbSize = statSync(DB_FILE).size;
      const fs = statfsSync(DATA);
      const minFree = Number(env.KEIZU_MIN_FREE_GB ?? 2) * 1073741824;
      if (fs.bavail * fs.bsize - dbSize < minFree) {
        log('UYARI: diskte yer az; bugünkü yedek atlandı. Eski yedekleri sil ya da başka bir yere taşı.');
        return;
      }
      const file = backupNow(db, BACKUP_DIR);
      pruneBackups(BACKUP_DIR, keep);
      const purged = purgeTrash(db);
      log(`Yedek alındı: ${file}${purged ? `; çöp kutusundan ${purged} eski harita silindi` : ''}`);
    } catch (e) {
      log(`Yedek alınamadı: ${(e as Error).message}`);
    }
  };
  // First backup a minute after start, then every 24 hours.
  setTimeout(run, 60_000).unref();
  setInterval(run, 24 * 3600e3).unref();
}

async function serve() {
  const db = openDb(DB_FILE);
  const count = (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
  if (count === 0 && env.KEIZU_ADMIN_PASSWORD) {
    // Unattended setups can create the first admin directly.
    createUser(db, env.KEIZU_ADMIN_USER?.trim() || 'admin', env.KEIZU_ADMIN_PASSWORD, { admin: true });
  } else if (count === 0) {
    console.log('\n================================================================');
    console.log(' Keizu Server ilk kez başladı. Yönetici hesabını oluşturmak için');
    console.log(' aşağıdaki linki tarayıcıda aç; kullanıcı adını ve şifreni sen seç.');
    console.log('================================================================');
    printInvite(db, true);
    console.log('Link kaybolursa: keizu-server invite --admin\n');
  }
  const cfg: Config = {
    db,
    backupDir: BACKUP_DIR,
    trustProxy: env.KEIZU_TRUST_PROXY !== '0',
    maxBodyBytes: Number(env.KEIZU_MAX_MAP_MB ?? 50) * 1048576,
    publicUrl: PUBLIC_URL,
    defaultQuotaBytes: Number(env.KEIZU_DEFAULT_QUOTA_MB ?? 2048) * 1048576,
    maxImageBytes: Number(env.KEIZU_MAX_IMAGE_MB ?? 5) * 1048576,
    totalBytes: Number(env.KEIZU_TOTAL_LIMIT_GB ?? 10) * 1073741824,
    minFreeBytes: Number(env.KEIZU_MIN_FREE_GB ?? 2) * 1073741824,
    freeBytes: () => {
      const s = statfsSync(DATA);
      return s.bavail * s.bsize;
    },
    log,
    webDir: hasWebApp(WEB_DIR) ? WEB_DIR : undefined,
  };
  log(cfg.webDir ? `Web uygulaması: ${cfg.webDir}` : 'Web uygulaması yok; adres yönetim paneline açılır.');
  const port = Number(env.KEIZU_PORT ?? 8787);
  const host = env.KEIZU_HOST ?? '0.0.0.0';
  const server = createApp(cfg);
  server.listen(port, host, () => log(`Keizu Server ${SERVER_VERSION} dinliyor: http://${host}:${port}${PUBLIC_URL ? ` (genel adres ${PUBLIC_URL})` : ''}`));
  if (env.KEIZU_BACKUP !== '0') daily(db, Number(env.KEIZU_BACKUP_KEEP ?? 3));
  const stop = () => {
    log('Kapanıyor…');
    server.close(() => {
      db.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

async function main(argv: string[]) {
  const [cmd, sub, ...rest] = argv;
  if (!cmd || cmd === 'serve') return serve();
  if (cmd === 'version' || cmd === '--version') return console.log(SERVER_VERSION);
  const db = openDb(DB_FILE);
  if (cmd === 'invite') {
    const quota = flag(argv, 'quota-mb');
    return printInvite(db, flag(argv, 'admin') === true, typeof quota === 'string' ? Number(quota) * 1048576 : 0);
  }
  if (cmd === 'pair') {
    if (!sub) throw new Error('Kullanım: keizu-server pair <kullanıcı>');
    return printPairing(db, sub);
  }
  if (cmd === 'backup') {
    const file = backupNow(db, BACKUP_DIR);
    pruneBackups(BACKUP_DIR, Number(env.KEIZU_BACKUP_KEEP ?? 3));
    return console.log(file);
  }
  if (cmd === 'user') {
    const name = rest[0];
    if (sub === 'list') {
      const rows = db.prepare('SELECT username, is_admin, quota_bytes FROM users ORDER BY username').all() as {
        username: string;
        is_admin: number;
        quota_bytes: number;
      }[];
      for (const r of rows) console.log(`${r.username}${r.is_admin ? ' (yönetici)' : ''}${r.quota_bytes ? ` kota ${r.quota_bytes / 1048576} MB` : ''}`);
      return;
    }
    if (!name) throw new Error('Kullanıcı adı gerekli.');
    const user = findUser(db, name);
    if (!user) throw new Error(`Kullanıcı yok: ${name}`);
    if (sub === 'passwd') {
      const { token } = createInvite(db, { kind: 'reset', userId: user.id });
      return console.log(`Şifre sıfırlama linki (${name}, 7 gün geçerli):\n  ${inviteLink(linkBase(), token)}\nYeni şifreyi kullanıcı kendisi seçer; ardından tüm cihazlarının oturumu kapanır.`);
    }
    if (sub === 'delete') {
      db.prepare('DELETE FROM users WHERE id = ?').run(user.id);
      return console.log(`Silindi: ${name} (haritalarıyla birlikte)`);
    }
  }
  if (cmd !== 'help') process.exitCode = 1;
  console.log(`Kullanım:
  keizu-server serve
  keizu-server invite [--admin] [--quota-mb N]
  keizu-server user list | passwd <ad> | delete <ad>
  keizu-server pair <ad>
  keizu-server backup
  keizu-server version`);
}

main(process.argv.slice(2)).catch((e) => {
  console.error(`Hata: ${(e as Error).message}`);
  process.exit(1);
});
