# Keizu Server kurulumu (Hetzner ve diğer Linux sunucular)

Keizu sunucusuz da tam çalışır; haritaların her zaman önce cihazında saklanır. Sunucusu olmayanlar Keizu'yu tarayıcıda **https://serkanqltun-hub.github.io/keizu/** adresinden ya da masaüstü uygulamasıyla kullanır. Keizu Server isteğe bağlıdır ve sana şunları kazandırır:

- Uygulama kendi adresinde açılır: `https://keizu.alanadin.com` Keizu'nun kendisidir, yönetim paneli `https://keizu.alanadin.com/panel/` adresindedir.
- Haritaların bilgisayarların, tarayıcıların ve (ileride) telefonun arasında eşitlenir.
- Her kaydın eski sürümleri sunucuda saklanır, silinen haritalar 30 gün çöp kutusunda kalır.
- Ailen veya ekibin için davetle hesap açabilirsin. Herkesin haritaları ayrıdır.

Bu rehber Hetzner Cloud üzerinden anlatıyor; Ubuntu veya Debian çalışan her sunucuda aynı adımlar geçerli.

**İçindekiler**

1. [Gerekenler](#1-gerekenler)
2. [Sunucu ve alan adı](#2-sunucu-ve-alan-adı)
3. [Tek komutla kurulum](#3-tek-komutla-kurulum)
4. [Sunucunda zaten nginx varsa](#4-sunucunda-zaten-nginx-varsa)
5. [İlk giriş ve uygulamadan bağlanma](#5-ilk-giriş-ve-uygulamadan-bağlanma)
6. [Kullanıcılar ve davetler](#6-kullanıcılar-ve-davetler)
7. [Sınırlar ve disk alanı](#7-sınırlar-ve-disk-alanı)
8. [Yedekler (ve Hetzner Storage Box)](#8-yedekler-ve-hetzner-storage-box)
9. [Güncelleme ve günlük işler](#9-güncelleme-ve-günlük-işler)
10. [Güvenlik duvarı](#10-güvenlik-duvarı)
11. [Elle kurulum (betik kullanmadan)](#11-elle-kurulum-betik-kullanmadan)
12. [Sorun giderme](#12-sorun-giderme)

---

## 1. Gerekenler

- Ubuntu 22.04/24.04 veya Debian 12 çalışan bir sunucu. Hetzner'de en küçük plan (ör. CX22, 2 vCPU / 4 GB RAM / 40 GB disk) fazlasıyla yeter.
- Bir alan adı ve onun DNS ayarlarına erişim. Keizu için bir alt alan adı kullanacağız, örneğin `keizu.alanadin.com`.
- Sunucuya SSH ile bağlanabilmek (`ssh root@SUNUCU_IP` veya sudo yetkili bir kullanıcı).

## 2. Sunucu ve alan adı

**Hetzner'de yeni sunucu açıyorsan:** Hetzner Cloud Console → *Add Server* → konum seç → *Ubuntu 24.04* → *CX22* → SSH anahtarını ekle → *Create*. Sunucunun IPv4 adresini not et.

**Zaten bir sunucun varsa** onun IP adresini kullan. Üzerinde başka servisler çalışıyor olması sorun değil (bkz. [bölüm 4](#4-sunucunda-zaten-nginx-varsa)).

**DNS kaydı:** Alan adının DNS panelinde (alan adını nereden aldıysan orası, ya da Hetzner DNS) bir **A kaydı** ekle:

| Tür | Ad | Değer | TTL |
| --- | --- | --- | --- |
| A | `keizu` | `SUNUCU_IPV4` | 300 |

Sunucunun IPv6 adresi varsa aynı ad için bir **AAAA** kaydı da ekleyebilirsin. Kaydın yayıldığını kendi bilgisayarından kontrol et:

```bash
ping keizu.alanadin.com      # yanıt sunucunun IP'sinden gelmeli
```

## 3. Tek komutla kurulum

Sunucuya SSH ile bağlan ve şunu çalıştır:

```bash
curl -fsSL https://raw.githubusercontent.com/serkanqltun-hub/keizu/main/server/deploy/install.sh | sudo bash
```

Betik şunları yapar:

1. Docker yoksa kurar.
2. Alan adını sorar ve DNS kaydının bu sunucuyu gösterip göstermediğini kontrol eder.
3. **80 ve 443 portlarına bakar:**
   - Boşlarsa **Caddy** başlatır. Caddy Let's Encrypt sertifikasını kendisi alır ve yeniler; senin bir şey yapman gerekmez.
   - Doluysa (çoğunlukla nginx), Keizu'yu yalnız `127.0.0.1:8787` üzerinde çalıştırır ve mevcut ters vekiline yönlendirme eklemeyi teklif eder (bkz. bölüm 4).
4. Her şeyi `/opt/keizu` klasörüne koyar: `docker-compose.yml`, `.env` (ayarlar) ve `data/` (veritabanı ve yedekler).
5. `keizu-server` yönetim komutunu kurar.
6. Sonunda **yönetici davet linkini** ekrana yazar.

Seçenekleri baştan verebilirsin:

```bash
curl -fsSL https://raw.githubusercontent.com/serkanqltun-hub/keizu/main/server/deploy/install.sh \
  | sudo bash -s -- --domain keizu.alanadin.com --email sen@alanadin.com
```

| Seçenek | Anlamı |
| --- | --- |
| `--domain` | Sunucunun adresi |
| `--email` | Let's Encrypt bildirimleri için (isteğe bağlı) |
| `--mode auto\|caddy\|proxy` | `auto`: portlar boşsa Caddy, doluysa mevcut ters vekil |
| `--port 8787` | Keizu'nun yerelde dinleyeceği port |
| `--build` | Hazır imajı indirmek yerine kaynak koddan derle |
| `--yes` | Hiçbir şey sorma, varsayılanları kullan |

## 4. Sunucunda zaten nginx varsa

Sunucunda 80/443 portlarını başka bir site için kullanan bir nginx varsa betik bunu fark eder ve:

1. Keizu'yu yalnız sunucunun içinden erişilebilen `127.0.0.1:8787` adresinde başlatır (dışarıya port açmaz).
2. "nginx bulundu, site yapılandırması eklensin mi?" diye sorar. **Evet** dersen:
   - `/etc/nginx/sites-available/keizu-keizu.alanadin.com.conf` dosyasını yazar ve etkinleştirir,
   - `nginx -t` ile test eder (hata olursa değişikliği geri alır), sonra nginx'i yeniden yükler,
   - `certbot` kuruluysa HTTPS sertifikasını alır ve HTTP'yi HTTPS'e yönlendirir.

Diğer sitelerine dokunmaz. **Hayır** dersen eklenecek bloğu ekrana yazar. Elle eklemek istersen örnek dosya [`server/deploy/nginx-keizu.conf`](../../server/deploy/nginx-keizu.conf):

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name keizu.alanadin.com;
    client_max_body_size 50m;          # görselli haritalar büyük olabilir

    location / {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_read_timeout 120s;
    }

    # Canlı ortak çalışma (WebSocket)
    location /api/v1/live {
        proxy_pass http://127.0.0.1:8787;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 1h;
    }
}
```

```bash
sudo nano /etc/nginx/sites-available/keizu.conf        # yukarıdaki blok
sudo ln -s /etc/nginx/sites-available/keizu.conf /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx       # yoksa
sudo certbot --nginx -d keizu.alanadin.com --redirect
```

**Başka bir ters vekil kullanıyorsan:**

- Caddy: `keizu.alanadin.com { reverse_proxy 127.0.0.1:8787 }`
- Traefik / Nginx Proxy Manager: hedef olarak `http://127.0.0.1:8787` (veya Docker ağındaki `keizu:8787`) ver.

> 80/443 doluyken hangi programın kullandığını görmek için: `sudo ss -ltnp '( sport = :80 or sport = :443 )'`

## 5. İlk giriş ve uygulamadan bağlanma

Kurulumun sonunda şuna benzer bir çıktı görürsün:

```
 Keizu Server ilk kez başladı. Yönetici hesabını oluşturmak için
 aşağıdaki linki tarayıcıda aç; kullanıcı adını ve şifreni sen seç.

Davet linki (7 gün geçerli, tek kullanımlık):
  https://keizu.alanadin.com/panel/#davet=…
```

1. Linki tarayıcıda aç, **kullanıcı adını ve şifreni seç**. Bu senin yönetici hesabın. Şifren sunucuda geri çözülemeyen bir özet (scrypt) olarak saklanır; kimse göremez.
2. Linki kaybettiysen sunucuda `keizu-server invite --admin` ile yenisini al.
3. Tarayıcıda `https://keizu.alanadin.com` adresini aç: Keizu açılır. Ana ekranın solundaki **Bulut senkronu**'na tıkla; sunucu adresi hazır dolu gelir, kullanıcı adı ve şifrenle **Bağlan**.
4. Masaüstü uygulamasında veya başka bir adresteki Keizu'da: **Bulut senkronu** → **Adres ile** → `keizu.alanadin.com` yaz → **Bul**. "Keizu Server 1.0 bulundu" çıkınca kullanıcı adı ve şifrenle **Bağlan**.

Uygulama şifreni saklamaz; yalnız o cihaza özel bir anahtar (token) alır. Başka bir cihazı bağlamanın iki kolay yolu daha var:

- **Eşleştirme kodu:** Bağlı bir cihazda *Başka cihaz bağla* → **Kod üret** (veya sunucu panelinde *Cihaz ekle*). Yeni cihazda **Eşleştirme kodu** sekmesine sunucu adresini ve 6 haneli kodu gir. Kod 10 dakika geçerli ve tek kullanımlıktır.
- **Bağlantı linki:** Kodun yanındaki QR, `keizu://connect?server=…&code=…` linkini içerir. Masaüstü uygulaması kuruluysa bu link uygulamayı açar ve bilgileri doldurur.

Bağlandıktan sonra haritaların her değişiklikten birkaç saniye sonra ve dakikada bir eşitlenir. İnternet yokken çalışmaya devam edersin; bağlantı gelince bekleyen değişiklikler gönderilir. İki cihaz aynı haritayı çevrimdışıyken düzenlerse uygulama değişiklikleri **konu konu birleştirir**. Aynı konu iki yerde farklı değiştirildiyse hiçbir şey kaybolmaz: senin hâlin "(çakışan kopya)" adıyla ayrı bir harita olarak kalır.

## 6. Kullanıcılar ve davetler

Açık kayıt yoktur; hesaplar yalnız davetle açılır.

- **Davet:** Panel (`https://keizu.alanadin.com/panel/`) → *Kullanıcılar* → kime olduğunu not et, isteğe bağlı kota ver → **Davet linki oluştur**. Linki kişiye gönder; kullanıcı adını ve şifresini kendisi seçer. Link 7 gün geçerlidir ve tek kullanımlıktır. Kullanılmamış davetleri aynı yerden iptal edebilirsin.
- **Şifre sıfırlama:** Kullanıcının satırında **Sıfırlama linki**. Yeni şifreyi kullanıcı kendisi belirler; ardından tüm cihazlarının oturumu kapanır.
- **Gizlilik:** Her kullanıcının haritaları ayrıdır. Yönetici dahil kimse başkasının haritasını uygulamada göremez. Harita paylaşımı ve ortak çalışma sonraki sürümde gelecek.
- **Cihazlar:** Herkes kendi panelinde bağlı cihazlarını görür ve kaybolan bir cihazın erişimini kaldırabilir.

Aynı işler komut satırından:

```bash
keizu-server invite                 # yeni davet linki
keizu-server invite --admin         # yönetici daveti
keizu-server invite --quota-mb 500  # 500 MB kotalı davet
keizu-server user list
keizu-server user passwd ayse       # şifre sıfırlama linki
keizu-server user delete ayse       # hesabı ve haritalarını sil
keizu-server pair ayse              # ayse için 6 haneli cihaz kodu
```

## 7. Sınırlar ve disk alanı

Sunucunun dolmasını önlemek için varsayılan sınırlar şunlar. Hepsi `/opt/keizu/.env` içinde; değiştirdikten sonra `keizu-server restart`.

| Ayar | Varsayılan | Anlamı |
| --- | --- | --- |
| `KEIZU_MAX_IMAGE_MB` | `5` | Bir haritadaki tek bir görselin üst sınırı. Uygulama görselleri zaten 1600 piksele küçültür. |
| `KEIZU_MAX_MAP_MB` | `50` | Tek bir haritanın üst sınırı (görseller dahil). |
| `KEIZU_DEFAULT_QUOTA_MB` | `2048` | Yeni kullanıcıların kotası. Davet oluştururken farklı bir kota verebilirsin; `0` sınırsız. |
| `KEIZU_TOTAL_LIMIT_GB` | `10` | Sunucuda saklanan her şeyin toplamı: haritalar, çöp kutusu, sürüm geçmişi. |
| `KEIZU_MIN_FREE_GB` | `2` | Diskte bundan az boş yer kalırsa yeni kayıtlar reddedilir ve günlük yedek atlanır. |
| `KEIZU_BACKUP_KEEP` | `3` | Sunucuda kaç günlük yedek tutulacağı. |

Kabaca hesap: görselsiz bir harita 50–300 KB, uygulamanın küçülttüğü bir görsel 200–400 KB tutar. Sürüm geçmişinde (her haritanın son 50 kaydı) görseller tekrar saklanmaz; her görsel bir kez saklanır. Bireysel kullanım ya da küçük bir ekip için 10 GB yıllarca yeter.

Disk planı (40 GB'lık bir sunucu için): işletim sistemi ve Docker ~5 GB + Keizu verisi en çok 10 GB + 3 günlük yedek (her biri veritabanı kadar) ≈ 40 GB'ın rahatça altında. Yedekleri Storage Box'a gönderiyorsan `KEIZU_BACKUP_KEEP=1` yapıp `KEIZU_TOTAL_LIMIT_GB` değerini artırabilirsin.

Panelin *Kullanıcılar* bölümü sunucudaki toplam kullanımı ve diskteki boş yeri gösterir.

## 8. Yedekler (ve Hetzner Storage Box)

Sunucu her gün kendiliğinden bir yedek alır: `/opt/keizu/data/backups/keizu-YYYY-AA-GG-….db`. Bu dosya kullanıcıları, haritaları, görselleri ve sürüm geçmişini içeren tam bir SQLite kopyasıdır. Panelde **Yedeği indir** ile istediğin an bir kopya da indirebilirsin. Elle yedek almak için: `keizu-server backup`.

Yedeklerin aynı sunucuda durması disk arızasına karşı korumaz. Bir **Hetzner Storage Box**'a göndermek için:

1. Hetzner Console → *Storage Boxes* → bir kutu aç, *SSH Support*'u etkinleştir. Kullanıcı adı `u123456` gibi olur.
2. Sunucuda bir SSH anahtarı oluştur ve kutuya ekle:

   ```bash
   sudo ssh-keygen -t ed25519 -f /root/.ssh/storagebox -N ''
   sudo cat /root/.ssh/storagebox.pub | ssh -p 23 u123456@u123456.your-storagebox.de install-ssh-key
   ```

3. Her gece yedekleri gönderen bir cron işi ekle (`sudo crontab -e`):

   ```cron
   30 3 * * * rsync -a --delete -e "ssh -p 23 -i /root/.ssh/storagebox" /opt/keizu/data/backups/ u123456@u123456.your-storagebox.de:keizu-backups/
   ```

**Geri yükleme:**

```bash
keizu-server stop
cd /opt/keizu/data
mv keizu.db keizu.db.eski && rm -f keizu.db-wal keizu.db-shm
cp backups/keizu-2026-11-02-03-00-00.db keizu.db && chown 1000:1000 keizu.db
keizu-server start
```

## 9. Güncelleme ve günlük işler

```bash
keizu-server update     # yeni sürümü indirir ve yeniden başlatır (veriler korunur)
keizu-server logs       # günlükleri izle (Ctrl+C ile çık)
keizu-server status     # çalışıyor mu?
keizu-server restart    # .env değişikliğinden sonra
keizu-server stop | start
```

Uygulama bağlanırken sunucunun sürümüne bakar. Sunucu eski kalırsa ayarlar ekranında "sunucuyu güncelle" uyarısı çıkar.

## 10. Güvenlik duvarı

- **Hetzner Cloud Firewall** (önerilir, Console → *Firewalls*): gelen trafikte yalnız **22** (SSH), **80** ve **443** (TCP; 443 için UDP de, HTTP/3 için) açık olsun. Keizu'nun 8787 portu zaten yalnız sunucunun içinden erişilebilir; dışarı açmana gerek yok.
- **ufw** kullanıyorsan betik Caddy modunda 80/443'ü kendisi açar. ufw'yi ilk kez açacaksan SSH'yi kilitlememek için önce `sudo ufw allow OpenSSH`, sonra `sudo ufw enable`.

Başka güvenlik önlemleri:

- Şifreler scrypt ile, cihaz anahtarları ve eşleştirme kodları SHA-256 özeti olarak saklanır. Veritabanı çalınsa bile bunlarla giriş yapılamaz.
- Hatalı giriş, eşleştirme kodu ve davet denemeleri sınırlıdır (15 dakikada IP başına birkaç deneme).
- Sunucu yalnız HTTPS arkasında çalışmalı. Uygulama, HTTPS'siz bir adrese bağlanırken uyarı gösterir.

## 11. Elle kurulum (betik kullanmadan)

**Docker Compose ile:**

```bash
sudo mkdir -p /opt/keizu/data && cd /opt/keizu
sudo curl -fsSLO https://raw.githubusercontent.com/serkanqltun-hub/keizu/main/server/deploy/docker-compose.yml
sudo curl -fsSLO https://raw.githubusercontent.com/serkanqltun-hub/keizu/main/server/deploy/Caddyfile
sudo chown 1000:1000 data
sudo tee .env >/dev/null <<'EOF'
KEIZU_DOMAIN=keizu.alanadin.com
KEIZU_PUBLIC_URL=https://keizu.alanadin.com
KEIZU_PORT=8787
COMPOSE_PROFILES=caddy        # mevcut nginx kullanacaksan boş bırak
EOF
sudo docker compose up -d
sudo docker compose logs keizu     # yönetici davet linki burada
```

**Docker olmadan (systemd):** Node.js 22.18 veya daha yeni gerekir. Adımlar [`server/deploy/keizu-server.service`](../../server/deploy/keizu-server.service) dosyasının başında. Önüne nginx veya Caddy koy.

## 12. Sorun giderme

| Belirti | Çözüm |
| --- | --- |
| Uygulama "Bu adreste bir Keizu Server bulunamadı" diyor | Tarayıcıda `https://keizu.alanadin.com/.well-known/keizu` aç; JSON görmelisin. Görmüyorsan ters vekil yönlendirmesini ve `keizu-server status` çıktısını kontrol et. |
| "Sunucuya ulaşılamadı" | DNS kaydı, güvenlik duvarında 443 ve sertifika. `curl -I https://keizu.alanadin.com` |
| Caddy sertifika alamıyor | A kaydı bu sunucuyu göstermiyor ya da 80 portu kapalı. `docker compose -f /opt/keizu/docker-compose.yml logs caddy` |
| Görselli harita gönderilemiyor (413) | nginx'te `client_max_body_size 50m;` satırı eksik, ya da görsel `KEIZU_MAX_IMAGE_MB` sınırını aşıyor. |
| "Sunucunun depolama alanı doldu" (507) | `KEIZU_TOTAL_LIMIT_GB` sınırına gelindi ya da diskte 2 GB'tan az yer kaldı. Eski yedekleri sil veya sınırı artır. |
| Davet linki localhost gösteriyor | `.env` içinde `KEIZU_PUBLIC_URL=https://keizu.alanadin.com` olmalı; sonra `keizu-server restart` ve `keizu-server invite`. |
| Hazır imaj indirilemiyor | Betik kaynak koddan derlemeye geçer. Elle denemek için: `install.sh --build`. |
| Web uygulamasında WebDAV çalışmıyor | WebDAV sunucusunun CORS izni vermesi gerekir. Masaüstü uygulamasında bu kısıt yoktur. |
