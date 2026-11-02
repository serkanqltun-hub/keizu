<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/keizu-lockup-dark.svg">
    <img src="docs/brand/keizu-lockup.svg" alt="Keizu" height="56">
  </picture>
</h1>

Açık kaynak, önce yerel çalışan bir zihin haritası uygulaması. Web'de ve masaüstünde (Windows, macOS, Linux) aynı kodla çalışır. Hesap, bulut ya da sunucu gerekmez: haritaların cihazında kalır. İstersen ileride kendi sunucunu bağlayıp cihazlar arası senkron ve ücretsiz ortak çalışma kazanırsın.

*An open-source, local-first mind mapping app for the web and desktop. No account or server needed; an optional self-hosted Keizu Server adds sync between devices.*

## Kullanmaya başla

- **Tarayıcıda:** https://serkanqltun-hub.github.io/keizu/ (kurulum yok, haritalar tarayıcında kalır)
- **Masaüstü:** Windows, macOS ve Linux sürümleri [Releases](https://github.com/serkanqltun-hub/keizu/releases) sayfasında
- **Kendi sunucunla:** Keizu Server kurduysan uygulama sunucunun adresinde açılır (ör. `https://keizu.alanadin.com`)

## Durum

**Faz 4 / 6: İsteğe bağlı Keizu Server.** Kullanılabilir ama erken bir sürüm. Yol haritası aşağıda.

## Özellikler (şu an)

- Zihin haritası, mantık şeması ve organizasyon şeması yerleşimleri, otomatik düzen
- Tek merkeze bağlı değil: tuvalde istediğin kadar **serbest konu** (ayrı ağaç) ve konular arasında etiketli **ilişki okları**
- Klavyeyle hızlı yazma: Tab alt konu, Enter kardeş konu, yazmaya başlayınca düzenleme
- Sürükle-bırak ile konu taşıma; boş alana bırakınca serbest konu olur
- Dal daraltma, geri al / yinele, kopyala / kes / yapıştır
- 4 tema (Taze, Gece, Kâğıt, Sade), dal stilleri (eğri, dirsek, düz), konu şekli ve rengi
- İşaretler (öncelik, ilerleme, bayrak, simge) ve konu notları
- Konulara görsel ekleme (PNG, JPEG, GIF, WebP)
- `.keizu` dosyası: harita JSON'u ve görselleri tek bir pakette; istersen git dostu düz JSON
- Masaüstünde gerçek dosyalar: Kaydet ile bir dosya seç, değişiklikler o dosyaya otomatik yazılır; `.keizu` dosyasına çift tıklayınca Keizu'da açılır
- Web'de **Bilgisayara kaydet**: Chrome ve Edge'de dosya bağlı kalır ve otomatik güncellenir, diğer tarayıcılarda indirilir
- İçe aktarma: `.keizu`, düz JSON, `.xmind` (tüm sayfalar; konular, notlar, işaretler, görseller, serbest konular, ilişkiler), OPML, Markdown. Dosyayı pencereye sürükleyip bırakmak da olur
- Dışa aktarma: PNG, SVG, PDF, Markdown, OPML, `.keizu`, düz JSON
- Haritalar bu cihazda (IndexedDB) otomatik kaydedilir; ilk sürümde tarayıcıya kaydedilenler kendiliğinden taşınır
- Otomatik yerel **sürüm geçmişi**: açarken, kapatırken ve düzenlerken en çok beş dakikada bir anlık görüntü; önizleyip geri yükleyebilirsin (geri yükleme de geri alınabilir)
- **Dal başına yerleşim**: herhangi bir dalı haritanın geri kalanından farklı bir şemayla (zihin, mantık, org) dizebilirsin (Biçim paneli → Dal yerleşimi)
- **Ana hat görünümü**: aynı harita girintili liste olarak; Tab içeri al, Shift+Tab dışarı al, Alt+↑/↓ sırala
- **Komut paleti** (Ctrl/⌘ + K): her komutu ve haritadaki her konuyu yazarak bul; Türkçe karakterlere duyarsız arama ("sik" → "Şık")
- **Tüm haritalarda arama**: başlangıç ekranındaki arama, bütün haritaların konularında ve notlarında arar; sonuca tıklayınca harita o konuda açılır
- **Değiştirilebilir kısayollar**: Klavye kısayolları penceresinden her komuta istediğin tuşu ata
- **Türkçe ve İngilizce arayüz** (başlangıç ekranından veya komut paletinden değişir); yeni dil eklemek tek dosya
- **İsteğe bağlı bulut senkronu** (Ayarlar → Bulut senkronu): kendi **Keizu Server**'ını ya da bir WebDAV klasörünü (Nextcloud vb.) bağla, haritaların cihazların arasında arka planda eşitlensin. İlk açılışta hiçbir şey sorulmaz; bağlamazsan Keizu tamamen yerel çalışır. Çevrimdışı düzenlemeler bağlantı gelince gönderilir, iki cihazın değişiklikleri konu konu birleştirilir, birleşemeyen durumda hiçbir şey kaybolmaz (çakışan kopya)
- **Büyük haritalar**: yalnız ekranda görünen konular çizilir, çok uzaktan bakınca sade çizime geçilir; 10.000+ konuluk harita akıcı kalır (performans testi: `src/ui/perf.test.tsx`)

## Klavye

| Tuş | İşlev |
| --- | --- |
| Ctrl/⌘ + K | Komut paleti: komut veya konu ara |
| Tab | Alt konu ekle (ana hatta: içeri al) |
| Shift+Tab | Ana hatta: dışarı al |
| Alt + ↑ / ↓ | Konuyu kardeşleri arasında yukarı / aşağı taşı |
| Ctrl/⌘ + Alt + O | Harita / ana hat görünümü |
| Ctrl/⌘ + Enter | Seçili konuyu ortala |
| Enter / Shift+Enter | Kardeş konu ekle (sonrasına / öncesine) |
| F2, Boşluk veya yazmaya başla | Metni düzenle (Shift+Enter yeni satır) |
| Delete | Konuyu veya seçili ilişkiyi sil |
| Ok tuşları | Konular arasında gezin |
| Ctrl/⌘ + / | Daralt / genişlet |
| Ctrl/⌘ + Z, Ctrl/⌘ + Shift + Z | Geri al, yinele |
| Ctrl/⌘ + C / X / V | Konuyu kopyala, kes, yapıştır |
| Ctrl/⌘ + S, Ctrl/⌘ + Shift + S | Dosyaya kaydet, farklı kaydet |
| Ctrl/⌘ + tekerlek, Ctrl/⌘ + 0 | Yakınlaştır, sığdır |
| Boş alana çift tıkla | Serbest konu |
| ? | Kısayollar (buradan değiştirilebilir) |

Bunlar varsayılanlardır; değiştirdiğin kısayollar bu cihazda saklanır.

## Geliştirme

Gerekenler: Node.js 20+; masaüstü için ayrıca [Rust](https://rustup.rs) ve [Tauri ön koşulları](https://tauri.app/start/prerequisites/).

```bash
npm install
npm run dev          # web: http://localhost:5173
npm test             # birim testleri
npm run build        # web derlemesi (dist/)
npm run tauri dev    # masaüstü uygulaması
npm run tauri build  # masaüstü kurulum dosyaları

cd server && npm install
npm run dev          # Keizu Server: http://localhost:8787 (veriler server/data)
npm test             # sunucu testleri
```

`v0.1.0` gibi bir etiket gönderildiğinde GitHub Actions üç işletim sistemi için kurulum dosyalarını taslak bir sürüme ekler.

## Kendi sunucun (isteğe bağlı)

Keizu Server tek bir Docker imajıdır (Node.js + SQLite). Hetzner veya herhangi bir Linux sunucuya tek komutla kurulur; sunucunda zaten nginx varsa onun arkasında çalışır, yoksa Caddy ile HTTPS'i kendisi alır:

```bash
curl -fsSL https://raw.githubusercontent.com/serkanqltun-hub/keizu/main/server/deploy/install.sh | sudo bash
```

Sunucunun adresi Keizu'nun kendisini açar, bağlanma ekranında adres hazır gelir; yönetim paneli `/panel/` adresindedir. Adım adım rehber: **[docs/server/hetzner.md](docs/server/hetzner.md)**. Hesaplar yalnız davetle açılır, herkes şifresini kendisi seçer, herkesin haritaları ayrıdır. Uygulamadan adres + şifreyle, 6 haneli eşleştirme koduyla veya `keizu://connect` linkiyle bağlanılır. API ve geliştirme notları: [server/README.md](server/README.md).

## Yapı

```
src/core/     Veri modeli, yerleşim motoru, geri al, temalar, dosya formatları (tarayıcıdan bağımsız, testli)
src/sync/     Depolama ve senkron: IndexedDB kitaplığı, sürüm geçmişi, dosya bağlantıları, senkron motoru, birleştirme, Keizu Server ve WebDAV adaptörleri
src/ui/       React arayüzü: başlangıç ekranı, editör, tuval, ana hat, komut paleti, biçim paneli
src/i18n/     Arayüz dilleri (tr.ts kaynak dil, en.ts; eksik çeviri derlemede hata verir)
src-tauri/    Masaüstü kabuğu (Tauri 2)
server/       Keizu Server (Node.js + SQLite), paneli, Docker ve kurulum dosyaları
docs/server/  Sunucu kurulum rehberi
```

Bir harita bir graftır: birden çok kök konu (ilki ana konu, diğerleri tuvalde serbest) ve konular arası ilişkiler. Şema türü veri değil, görünüm ayarıdır.

## Dosya formatı

`.keizu` bir zip paketidir; içi okunabilir kalır:

```
manifest.json          { "format": "keizu/1", "package": 1 }
map.json               harita (format: "keizu/1"); görseller aşağıdaki dosyaları gösterir
resources/<id>.<uzantı> konu görselleri
```

Düz JSON seçeneği aynı haritayı tek bir metin dosyasına yazar (görseller içine gömülür), böylece git'te satır satır fark görülebilir. Keizu her iki biçimi de, ilk sürümün düz JSON `.keizu` dosyalarını da açar. Dosya uzantısı `.json` ise düz JSON, değilse paket yazılır.

## Yol haritası

1. Editör çekirdeği
2. Dosyalar: `.keizu` zip formatı, masaüstünde gerçek dosyalar, `.xmind` / OPML içe aktarma, PDF, sürüm geçmişi
3. Hız ve gezinme: ana hat görünümü, Ctrl+K komut paleti, tüm haritalarda arama, değiştirilebilir kısayollar, Türkçe + İngilizce arayüz, 10.000 konuda akıcılık, dal başına yerleşim
4. **Keizu Server** (bu sürüm, isteğe bağlı): tek komutla kurulum, davetle hesaplar, QR / kodla bağlanma, senkron, sunucuda sürüm geçmişi ve yedek
5. Ortak çalışma ve yeni şemalar: canlı ortak düzenleme, kavram haritası, zaman çizelgesi, balık kılçığı
6. Genişleme: eklentiler, mobil

## Lisans

[MIT](LICENSE). Keizu bağımsız bir projedir; XMind ile bir bağı yoktur.
