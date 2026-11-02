# Keizu Server

Keizu için isteğe bağlı senkron sunucusu. Kurulum rehberi: [docs/server/hetzner.md](../docs/server/hetzner.md).

- Node.js 22.18+ (TypeScript doğrudan çalışır, derleme adımı yok) ve Node'un yerleşik SQLite'ı; tek bağımlılık `qrcode`.
- Tek dosyalık veritabanı (`$KEIZU_DATA/keizu.db`), günlük yedek (`$KEIZU_DATA/backups`).
- Haritalar sunucu için opak JSON belgeleridir; her kayıt yeni bir sürüm numarası alır. Eski bir sürüme dayanan kayıt `409` ile reddedilir ve uygulama birleştirir.
- Görseller kullanıcı başına bir kez saklanır (`blob:<sha256>`); sürüm geçmişi onları kopyalamaz.
- Docker imajı Keizu web uygulamasını da içerir: sunucunun adresi (`/`) uygulamanın kendisini, `/panel/` hesap ve yönetim panelini açar. İmaj depo kökünden derlenir: `docker build -f server/Dockerfile .`

## Geliştirme

```bash
npm install
npm run dev        # http://localhost:8787, veriler ./data; ilk açılışta yönetici davet linki yazılır
npm test           # node --test
npm run typecheck
```

Uygulamanın uçtan uca testi (`src/sync/server.e2e.test.ts`) bu sunucuyu aynı süreçte çalıştırır; kök klasörde `npm test` öncesi burada `npm install` gerekir.

## Ortam değişkenleri

| Değişken | Varsayılan | |
| --- | --- | --- |
| `KEIZU_DATA` | `/data` | Veritabanı ve yedek klasörü |
| `KEIZU_PORT` / `KEIZU_HOST` | `8787` / `0.0.0.0` | Dinlenen adres |
| `KEIZU_PUBLIC_URL` | `https://$KEIZU_DOMAIN` | Davet ve eşleştirme linklerinde kullanılan genel adres |
| `KEIZU_WEB` | `/app/web` (imajda) | `/` adresinde sunulan web uygulaması klasörü. Boş bırakılırsa `/` panele yönlenir |
| `KEIZU_TRUST_PROXY` | `1` | `X-Forwarded-*` başlıklarına güven (ters vekil arkasında). Doğrudan internete açıksa `0`. |
| `KEIZU_DEFAULT_QUOTA_MB` | `2048` | Yeni kullanıcı kotası (0 = sınırsız) |
| `KEIZU_MAX_IMAGE_MB` | `5` | Tek görsel üst sınırı |
| `KEIZU_MAX_MAP_MB` | `50` | Tek harita (istek gövdesi) üst sınırı |
| `KEIZU_TOTAL_LIMIT_GB` | `10` | Sunucudaki tüm verinin üst sınırı |
| `KEIZU_MIN_FREE_GB` | `2` | Diskte bundan az yer kalınca yazma durur |
| `KEIZU_BACKUP` / `KEIZU_BACKUP_KEEP` | `1` / `3` | Günlük yedek açık mı, kaç tane saklanır |
| `KEIZU_ADMIN_USER` / `KEIZU_ADMIN_PASSWORD` | | Otomatik kurulumlar için: ilk yöneticiyi davet linki yerine doğrudan oluşturur |

## API (v1)

Keşif: `GET /.well-known/keizu` → `{ keizu: "server", version, api: "/api/v1", apiVersion, minClientApi, features }` (`features`: 1.1'den beri `share`, `live`, `viewLinks`). Diğer her şey `Authorization: Bearer <token>` ister (giriş ve davet uçları hariç). CORS herkese açıktır; çerez kullanılmaz.

| Yöntem | Yol | |
| --- | --- | --- |
| POST | `/api/v1/auth/login` | `{username, password, device}` → `{token, user}` |
| POST | `/api/v1/auth/pair` | `{code, device}` → `{token, user}` (6 haneli, 10 dk, tek kullanımlık) |
| POST | `/api/v1/auth/logout` | Bu cihazın token'ını iptal eder |
| GET / POST | `/api/v1/invites/:token` | Davet bilgisi / kabul: `{username, password}` → `{token, user}` |
| GET | `/api/v1/me` | Kullanıcı, kullanım ve kota |
| PUT | `/api/v1/me/password` | `{current, next}` |
| GET / DELETE | `/api/v1/devices[/:id]` | Bağlı cihazlar |
| POST | `/api/v1/pair-codes` | Yeni cihaz kodu + `keizu://connect` linki + QR (SVG) |
| GET | `/api/v1/maps` | Harita listesi (`id, title, version, updatedAt, size`) |
| GET | `/api/v1/maps/:id` | Harita JSON'u; sürüm `X-Keizu-Version` ve `ETag` başlığında |
| PUT | `/api/v1/maps/:id` | Kaydet. `If-Match: "<sürüm>"` (güncelleme) veya `If-None-Match: *` (yeni). Uyuşmazlıkta `409`/`412` ve gövdede güncel harita. |
| DELETE | `/api/v1/maps/:id` | Çöp kutusuna taşı (30 gün) |
| POST | `/api/v1/maps/:id/restore` | Çöp kutusundan geri al |
| GET | `/api/v1/trash` | Çöp kutusu |
| GET | `/api/v1/changes?since=<imleç>` | İmleçten sonra değişenler (silinenler `deleted: true`) |
| GET | `/api/v1/maps/:id/versions[/:v]` | Sunucudaki sürüm geçmişi (son 50) |
| GET / POST / DELETE | `/api/v1/admin/invites` | Davetler (yönetici) |
| GET / PATCH / DELETE | `/api/v1/admin/users[/:id]` | Kullanıcılar, kota, sıfırlama linki (yönetici) |
| GET | `/api/v1/admin/backup` | Anlık SQLite yedeği indir (yönetici) |
| GET | `/api/v1/maps/:id/shares` | Haritanın paylaşımları, salt okunur link ve şu an canlı oturumdaki kişi sayısı (yalnız sahibi) |
| PUT / DELETE | `/api/v1/maps/:id/shares/:kullanıcı` | `{role: "view" \| "edit"}` ile paylaş / paylaşımı kaldır |
| POST / DELETE | `/api/v1/maps/:id/link` | Salt okunur link oluştur / iptal et (`https://sunucu/#view=<token>`) |
| GET | `/api/v1/shared` | Benimle paylaşılan haritalar (`id, title, role, ownerId, owner`) |
| GET | `/api/v1/shared/:sahip/:id` | Paylaşılan haritanın JSON'u; yetki `X-Keizu-Role` başlığında |
| GET | `/api/v1/public/:token` | Salt okunur linkin haritası (hesap gerekmez; hatalı denemeler IP başına sınırlı) |

### Canlı ortak çalışma (WebSocket)

`/api/v1/live` adresine WebSocket açılır. İlk mesaj `{type: "hello", token, map, owner?}` olmalıdır (`owner`: başkasının haritasıysa sahibinin kullanıcı kimliği). Sunucu `welcome` ile haritanın CRDT hâlini (`src/core/crdt.ts`), yetkiyi (`owner`/`edit`/`view`) ve odadakileri gönderir. Sonra:

- `{type: "ops", ops, seq}`: değişiklikler (kayıt yazmaları). Sunucu uygular, odadaki diğerlerine iletir, `{type: "ack", seq}` döner. `view` yetkisi yazamaz.
- `{type: "sel", id}`: seçili konu (diğerlerinde renkli çerçeve olarak görünür).
- Sunucudan: `ops`, `peers`, `sel`, `role` (yetki değişti), `saved` (harita kaydedildi), `error`.

Oda, son değişiklikten 1,5 saniye sonra haritayı normal kayıt gibi saklar (sürüm geçmişine de girer). Oda açıkken REST ile gelen bir kayıt (ör. başka cihazın senkronu) odaya birleştirilir. Paylaşım kaldırılınca o kişi odadan çıkarılır. Ters vekil (nginx) arkasında `Upgrade` başlıklarının iletilmesi gerekir: [deploy/nginx-keizu.conf](deploy/nginx-keizu.conf); Caddy bunu kendiliğinden yapar.

Hata gövdeleri `{error, message}` biçimindedir. `413` (çok büyük / kota / görsel), `429` (çok fazla deneme), `507` (sunucu dolu).
