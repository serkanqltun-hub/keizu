# Yapay zekâ asistanı

Masaüstü Keizu, bilgisayarına kurduğun ve **kendi aboneliğinle giriş yaptığın** yapay zekâ komut satırı aracını kullanır. API anahtarı gerekmez; kullanım aboneliğinin kotasından düşer. Keizu şifreni ya da oturum bilgini hiç görmez: girişi aracın kendisi yapar, Keizu yalnızca aracı çalıştırır.

| Araç | Abonelik | Kurulum |
| --- | --- | --- |
| Claude Code | Claude Pro / Max | Windows (PowerShell): `irm https://claude.ai/install.ps1 \| iex` · macOS/Linux: `curl -fsSL https://claude.ai/install.sh \| bash` |
| Gemini CLI | Google hesabı | `npm install -g @google/gemini-cli` (Node.js 20+) |

## Kurulum

1. Aracı kur (yukarıdaki komut).
2. Keizu → Ayarlar → **Yapay zekâ asistanı** → aracın kartında **Giriş yap**. Açılan terminalde aboneliğinle giriş yap, pencereyi kapat.
3. **Tekrar denetle**, sonra **Dene**. "Çalışıyor" yazıyorsa hazırsın.

Keizu aracı kendisi bulamazsa "Gelişmiş: aracın yolu" alanına tam yolunu yaz.

## Kullanım

- Bir konuya sağ tıkla → **Asistan**: fikir üret, dalı genişlet, özetle, yeniden yaz, nottan dallar, çeviri.
- Araç çubuğunda **Asistan** ya da `Ctrl+J`: yan panel; serbest soru da sorabilirsin.
- Öneriler haritada soluk görünür. İstemediklerinin işaretini kaldır, **Ekle** de. Onaylamadan haritaya hiçbir şey yazılmaz; eklenenler `Ctrl+Z` ile geri alınır.

## Gizlilik ve güvenlik

- Yalnızca seçili dalın metni (ve üst başlıkların adları) seçtiğin araca gider.
- Keizu yalnızca `claude` ve `gemini` programlarını sabit argümanlarla çalıştırır. Harita metni komut satırına değil, standart girişe verilir. Araçlar boş bir geçici klasörde çalışır; Claude Code'un kendi araçları (dosya, komut) kapalı açılır.
- Web sürümü bilgisayardaki programları başlatamadığı için asistan yalnızca masaüstünde çalışır.
