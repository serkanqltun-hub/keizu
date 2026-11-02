# Keizu logosu

Keizu, Japonca **系図** (keizu) kelimesinden gelir: soy ağacı, soy şeması. Logo iki parçadan oluşur.

| Dosya | Ne için |
| --- | --- |
| `keizu-mark.svg`, `keizu-mark-dark.svg` | Uygulama ikonu: arduvaz zeminde **系** (kei, "soy, bağ") ve çivit renkli bir düğüm |
| `keizu-wordmark.svg`, `keizu-wordmark-dark.svg` | Yazı logosu: "keizu" ve yanında dikey **ケイズ** (katakana okunuş) etiketi |
| `keizu-lockup.svg`, `keizu-lockup-dark.svg` | İkon ve yazı yan yana (web sitesi, README başlığı) |

`-dark` dosyaları koyu zemin içindir.

## Renkler

| | Açık zemin | Koyu zemin |
| --- | --- | --- |
| İkon zemini | `#1f2a37` | `#232c38` |
| Düğüm | `#7389ff` | `#8197ff` |
| Yazı | `#1d232b` | `#e6e9ee` |
| Etiket | `#3446b8`, yazı `#ffffff` | `#8197ff`, yazı `#14181e` |

## Fontlar ve lisans

Harfler fonttan vektör çizgiye çevrildi, yani dosyalar hiçbir fonta ihtiyaç duymaz. Kullanılan fontların hepsi [SIL Open Font License 1.1](https://openfontlicense.org) ile dağıtılır ve logoda kullanılmalarına izin verir:

- 系: Shippori Mincho B1 ExtraBold (The Shippori Mincho Project Authors)
- keizu: Plus Jakarta Sans 800 (The Plus Jakarta Sans Project Authors)
- ケイズ: Zen Kaku Gothic New Black (The Zen Project Authors)

## Yeniden üretmek

`glyphs.py` fontlardan harf çizgilerini çıkarır, `build.py` SVG dosyalarını, `public/icon.svg` ve `src/ui/brandPaths.ts` dosyalarını yazar (fonttools gerekir). Masaüstü ikon seti `public/icon.svg` dosyasının 1024 piksellik PNG hâlinden `npx tauri icon <png> -o src-tauri/icons` ile üretilir.
