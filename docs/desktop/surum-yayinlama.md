# Masaüstü sürümü yayınlama ve otomatik güncelleme

Masaüstü uygulaması yeni sürümleri GitHub Releases'tan bulur:
`https://github.com/serkanqltun-hub/keizu/releases/latest/download/latest.json`.
Yeni bir sürüm varsa açılışta sorar (Ayarlar → Güncellemeler'den kapatılabilir)
ve onaylanınca indirip kurar. Güncelleme paketleri imzalıdır; uygulama imzayı
`src-tauri/tauri.conf.json` içindeki açık anahtarla doğrular.

## Bir kez yapılacak: imza anahtarı

Depoda **Settings → Secrets and variables → Actions → New repository secret** ile:

| Ad | Değer |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | Özel anahtar dosyasının içeriği (tek satır) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Anahtarın parolası |

Özel anahtarı ve parolayı güvenli bir yerde yedekle. Kaybolursa kurulu
uygulamalar yeni sürümleri kabul etmez; yeni anahtarla çıkan ilk sürümü herkes
elle kurmak zorunda kalır.

Yeni anahtar üretmek gerekirse: `npx tauri signer generate -w keizu.key`,
sonra `keizu.key.pub` içeriğini `tauri.conf.json → plugins.updater.pubkey`
alanına yaz.

## Her sürümde

```sh
git tag v0.2.0
git push origin v0.2.0
```

"Release" iş akışı sürüm numarasını etiketten alır (v0.2.0 → 0.2.0), Windows
(NSIS), macOS ve Linux paketlerini derler, imzalar, `latest.json` dosyasını
ekler ve tüm platformlar bitince sürümü yayınlar. Bir platform hata verse de
diğerleri yayınlanır.

Notlar:

- MSI paketi yapılmaz: WiX, uygulama bilgilerindeki Türkçe karakterleri kabul etmiyor. Windows kurulumu NSIS ile (`Keizu_x.y.z_x64-setup.exe`).
- Uygulama kod imzalı değil; Windows ilk kurulumda SmartScreen uyarısı gösterebilir. Otomatik güncellemeler bu uyarıyı tekrar göstermez.
- Yerel derleme (`npm run tauri build`) özel anahtar istemez; güncelleme paketlerini yalnız iş akışı üretir.
- Güncelleme Linux'ta AppImage ile çalışır; .deb/.rpm kurulumlarını paket yöneticisi günceller.
