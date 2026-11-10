# Yapay zekâ asistanı

Masaüstü Keizu, bilgisayarına kurduğun ve **kendi aboneliğinle giriş yaptığın** yapay zekâ komut satırı aracını kullanır. API anahtarı gerekmez; kullanım aboneliğinin kotasından düşer. Keizu şifreni ya da oturum bilgini hiç görmez: girişi aracın kendisi yapar, Keizu yalnızca aracı çalıştırır.

| Araç | Abonelik | Kurulum |
| --- | --- | --- |
| Claude Code | Claude Pro / Max | Windows (PowerShell): `irm https://claude.ai/install.ps1 \| iex` · macOS/Linux: `curl -fsSL https://claude.ai/install.sh \| bash` |
| Gemini CLI | Ücretli Gemini API anahtarı ya da kurumsal lisans (aşağıdaki nota bak) | `npm install -g @google/gemini-cli` (Node.js 20+) |

> **Not (Kasım 2026):** Google, Haziran 2026'dan beri Gemini CLI'ye kişisel Google hesabıyla (ücretsiz ya da Google AI Pro) girişi kapattı. Giriş denemesi "This client is no longer supported for Gemini Code Assist for individuals" hatası verir. Google'ın yerine önerdiği Antigravity CLI (`agy`) için şartlar, başka uygulamalardan kullanıma izin verip vermediği konusunda belirsiz; bu yüzden Keizu onu desteklemiyor. Kişisel abonelikle asistan için Claude Code kullan.

## Kurulum

1. Aracı kur (yukarıdaki komut).
2. Keizu → Ayarlar → **Yapay zekâ asistanı** → aracın kartında **Giriş yap**. Açılan terminalde aboneliğinle giriş yap, pencereyi kapat.
3. **Tekrar denetle**, sonra **Dene**. "Çalışıyor" yazıyorsa hazırsın.

Keizu aracı kendisi bulamazsa "Gelişmiş: aracın yolu" alanına tam yolunu yaz.

## Kullanım

- Bir konuya sağ tıkla → **Asistan**: fikir üret, dalı genişlet, özetle, yeniden yaz, nottan dallar, çeviri.
- Araç çubuğunda **Asistan** ya da `Ctrl+J`: yan panel; serbest soru da sorabilirsin.
- **Sıradaki adımlar**: asistan tüm haritaya, açık/bitmiş görevlere ve tarihlere bakar; durumu ve eksikleri yazar, sıradaki adımları görev olarak önerir.
- Soru kutusu bir sohbettir: "peki onu biraz aç" gibi devam soruları sorabilirsin. Sohbet harita açık kaldığı sürece hatırlanır; "Yeni sohbet" ile sıfırlanır.
- Öneriler haritada soluk görünür. İstemediklerinin işaretini kaldır, **Ekle** de. Onaylamadan haritaya hiçbir şey yazılmaz; eklenenler `Ctrl+Z` ile geri alınır.
- Bir metni (ör. bir hikâye ya da toplantı notu) soru kutusuna yapıştırıp "haritaya dönüştür" diyebilirsin; dallar öneri olarak gelir. Yanıt yalnızca yazı olarak geldiyse altındaki **Dallara dönüştür** düğmesi aynı konuşmayı dal önerilerine çevirir.

## Gizlilik ve güvenlik

- Açık haritanın metni (notlar, görevler, etiketler, oklar dahil) seçtiğin araca gider; seçili dal "odak" olarak işaretlenir. Çok büyük haritalarda odak dışındaki dallar kısaltılır. Başka haritalar gönderilmez.
- Keizu yalnızca `claude` ve `gemini` programlarını sabit argümanlarla çalıştırır. Harita metni komut satırına değil, standart girişe verilir. Araçlar boş bir geçici klasörde çalışır; Claude Code'un kendi araçları (dosya, komut), MCP sunucuları ve eğik çizgi komutları kapalı açılır, oturum kaydedilmez; yanıt belirli bir JSON şemasına uymak zorundadır.
- Web sürümü bilgisayardaki programları başlatamadığı için asistan yalnızca masaüstünde çalışır.
