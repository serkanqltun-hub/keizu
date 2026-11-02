<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/brand/keizu-lockup-dark.svg">
    <img src="docs/brand/keizu-lockup.svg" alt="Keizu" height="56">
  </picture>
</h1>

Açık kaynak, önce yerel çalışan bir zihin haritası uygulaması. Web'de ve masaüstünde (Windows, macOS, Linux) aynı kodla çalışır. Hesap, bulut ya da sunucu gerekmez: haritaların cihazında kalır. İstersen ileride kendi sunucunu bağlayıp cihazlar arası senkron ve ücretsiz ortak çalışma kazanırsın.

*An open-source, local-first mind mapping app for the web and desktop. No account or server needed; an optional self-hosted server (coming in phase 4) adds sync and free collaboration.*

## Durum

**Faz 2 / 6: Dosyalar ve içe/dışa aktarma.** Kullanılabilir ama erken bir sürüm. Yol haritası aşağıda.

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

## Klavye

| Tuş | İşlev |
| --- | --- |
| Tab | Alt konu ekle |
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
| ? | Kısayol listesi |

## Geliştirme

Gerekenler: Node.js 20+; masaüstü için ayrıca [Rust](https://rustup.rs) ve [Tauri ön koşulları](https://tauri.app/start/prerequisites/).

```bash
npm install
npm run dev          # web: http://localhost:5173
npm test             # birim testleri
npm run build        # web derlemesi (dist/)
npm run tauri dev    # masaüstü uygulaması
npm run tauri build  # masaüstü kurulum dosyaları
```

`v0.1.0` gibi bir etiket gönderildiğinde GitHub Actions üç işletim sistemi için kurulum dosyalarını taslak bir sürüme ekler.

## Yapı

```
src/core/     Veri modeli, yerleşim motoru, geri al, temalar, dosya formatları (tarayıcıdan bağımsız, testli)
src/sync/     Depolama ve senkron arayüzleri: IndexedDB kitaplığı, sürüm geçmişi, dosya bağlantıları
src/ui/       React arayüzü: başlangıç ekranı, editör, tuval, biçim paneli
src-tauri/    Masaüstü kabuğu (Tauri 2)
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
2. **Dosyalar** (bu sürüm): `.keizu` zip formatı, masaüstünde gerçek dosyalar, `.xmind` / OPML içe aktarma, PDF, sürüm geçmişi
3. Hız ve gezinme: ana hat görünümü, Ctrl+K komut paleti, arama, Türkçe + İngilizce arayüz, 10.000 konuda akıcılık
4. Keizu Server (isteğe bağlı): tek komutla kurulum, QR / kodla bağlanma, senkron
5. Ortak çalışma ve yeni şemalar: canlı ortak düzenleme, kavram haritası, zaman çizelgesi, balık kılçığı
6. Genişleme: eklentiler, mobil

## Lisans

[MIT](LICENSE). Keizu bağımsız bir projedir; XMind ile bir bağı yoktur.
