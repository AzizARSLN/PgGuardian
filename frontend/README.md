# PgGuardian Dashboard UI

PostgreSQL veritabanı yöneticileri (DBA), veri bilimciler ve sistem yöneticileri için tasarlanmış modern, özellikli bir yönetici paneli. 14 ekran ve 69+ API endpoint ile tam kapsamlı PostgreSQL izleme, teşhis, bakım ve güvenlik operasyonları için tek bir arayüz sunar.

---

## 1. Genel Bakış

**Hedef Kullanıcılar:**
- **DBA (Database Administrator)**: Günlük bakım, indeks yönetimi, replikasyon izleme, yedekleme
- **Veri Bilimci**: Sorgu optimizasyonu, şema taraması, SQL editörü ile veri keşfi
- **DB Yöneticisi**: Roller/izinler, güvenlik politikaları, bağlantı yönetimi, genel sağlık takibi

**Özellik Özeti:**
- 14 ekran (Dashboard, Connections, SQL Editor, Diagnostics, Maintenance, Roles, Backups, Snapshots, Config, Replication, Report, Query Management, Schema Browser, Settings)
- Backend ile entegre 69+ REST API endpoint
- Karanlık tema + responsive tasarım
- Gerçek zamanlı sorgu izleme ve sonlandırma
- 2-adım güvenli operasyon akışı (dry-run → onay → çalıştır)

---

## 2. Kurulum

### Gerekli Yazılımlar
- **Node.js** >= 20 (22 önerilir)
- **pnpm** 10.17.1 (package.json'da sabitlenmiştir)

### Adım Adım Kurulum

```bash
# 1. Proje kökünden frontend klasörüne gir
cd frontend

# 2. pnpm aktif değilse corepack ile etkinleştir (Node.js 20+ ile gelir)
corepack enable
corepack prepare pnpm@10.17.1 --activate

# 3. Bağımlılıkları yükle
pnpm install
```

### Ayarlar (isteğe bağlı)
- Backend farklı bir adreste çalışıyorsa `next.config.mjs` içindeki `rewrites()` hedefini güncelleyin.
- Üretim için Docker kullanıyorsanız `NEXT_PUBLIC_API_URL` env değişkeni ile hedefi ayarlayın.

---

## 3. Çalıştırma

### Yöntem A: Yerel Geliştirme (önerilen)

```bash
# Backend + PostgreSQL + Frontend (tek komut, Windows)
# Proje KÖK dizininden çalıştır:
..\start-all.bat
```

Bu komut sırasıyla:
1. Docker Desktop kontrolü
2. PostgreSQL container başlatma (5432) ve sağlık kontrolü
3. Python bağımlılık doğrulama (python-multipart, pgguardian editable)
4. CLI sağlık kontrolü
5. **Yeni pencerede** `frontend/` altında `pnpm dev` (port 3000)
6. **Ana pencerede** Uvicorn API (port 8000, debug reload)

Veya ayrı ayrı:
```bash
# Frontend sadece (geliştirme, 3000)
cd frontend
pnpm dev
```

Tarayıcıda aç: http://localhost:3000

### Yöntem B: Docker Compose (Production benzeri)

Proje kök dizininden:

```bash
docker compose up -d postgres ui
```

Bu komut:
- `postgres` servisini başlatır (5432 portu)
- `ui` servisini build eder ve başlatır (3000 portu, Next.js standalone production build)
- PostgreSQL sağlıklı olmadan UI başlamaz

Logları izle:
```bash
docker compose logs -f ui
```

Durur:
```bash
docker compose down
```

---

## 4. Ekranlar Listesi

| Kısaltma | Ekran Adı                      | Rota                               | Açıklama                                                                 |
|----------|--------------------------------|------------------------------------|-------------------------------------------------------------------------|
| E0       | Ana Sayfa / Landing            | `/`                                | Giriş, Master Password modal, hızlı bağlantı seçimi                     |
| E1       | Dashboard                      | `/dashboard`                       | Genel sağlık skoru, bağlantı özeti, grafikler, kritik bulgular          |
| E2       | Bağlantılar (Connections)      | `/connections`                     | DB bağlantı profillerini listele, ekle, test et, sil                    |
| E3       | SQL Editörü                    | `/sql-editor`                      | Sorgu yaz, çalıştır, planla (EXPLAIN), kaydet, tablo sonuçlarını incele |
| E4       | Teşhis (Diagnostics)           | `/diagnostics`                     | Bloat, indeks kullanımı, kilitler, sıralar, sorgu profili taramaları    |
| E5       | Bakım (Maintenance)            | `/maintenance`                     | VACUUM, ANALYZE, REINDEX, vacuum durumu + çalıştırma                    |
| E6       | Roller (Roles List)            | `/roles`                           | PostgreSQL rollerini listele, özniteliklerini gör                        |
| E7       | Rol Detayı                     | `/roles/[role]`                    | Tek rol detayı: izinler, sahip olduğu nesneler, düzenle                |
| E8       | Yedekleme (Backups)            | `/backups`                         | pg_dump / pg_restore arayüzü, tarihçe, indirme                          |
| E9       | Anlık Görüntü (Snapshots)      | `/snapshots`                       | DB durum anlık görüntüsü al, karşılaştır, fark gör                      |
| E10      | Konfigürasyon (Config)         | `/config`                          | postgresql.conf parametrelerini gör, güncelle, restart önerisi          |
| E11      | Replikasyon                    | `/replication`                     | Primary / replica durumu, lag, slotlar, WAL arşivi                      |
| E12      | Rapor                          | `/report`                          | Tek tıkla tam sağlık / öneri raporu (HTML/JSON export)                  |
| E13      | Sorgu Yönetimi                 | `/query-management`                | Çalışan aktif sorgular, uzun sürenler, iptal et / sonlandır             |
| E14      | Ayarlar                        | `/settings`                        | UI tema, dil, güvenlik, oturum ayarları                                 |

> **Ekstra:** `/schema-browser` — Şema, tablo, sütun, indeks, kısıt taraması (hiyerarşik gezinme)

---

## 5. Güvenlik

PgGuardian UI, hassas DB operasyonlarını 3 katmanla korur:

### 5.1 Master Password Modal
- İlk girişte ve/veya her oturum açılışında şifre sorar
- Doğrulama backend `/api/auth` endpointi üzerinden yapılır
- Başarılı olunca oturum state'i Zustand ile tutulur

### 5.2 HttpOnly Cookie ile Oturum
- Backend, başarılı doğrulamada HttpOnly + Secure (üretim) cookie imzalar
- Tarayıcı JS'i cookie'ye erişemez (XSS'e karşı ekstra koruma)
- Middleware ile korunan rotalara erişim önceden kontrol edilir

### 5.3 2-Adım Mutation Akışı (Dry-Run → Confirm)
Tüm **yapıcı** operasyonlar (DROP, ALTER, VACUUM FULL, ROLE DROP vb.):
1. **Dry-Run**: Önce simülasyon çalışır, kullanıcıya etki alanı (etkilenen satır/sayı/tablo) gösterilir
2. **Confirm Dialog**: Risk seviyesi (Low / Medium / High) + onay checkbox + "Bu işlemi anladım" metni
3. **Execute**: Kullanıcı onayından sonra gerçek mutation çalışır, sonucu toast ile bildirilir

---

## 6. Kullanılan Teknolojiler

| Kategori              | Teknoloji / Kütüphane              | Amacı                                                               |
|-----------------------|------------------------------------|---------------------------------------------------------------------|
| Framework             | **Next.js 15** (App Router)        | SSR, RSC, rewrites, route grupları, production standalone build     |
| UI Kütüphanesi        | **React 19** (ESNext)              | Bileşen modeli, hook'lar, concurrent features                       |
| Bileşen Seti          | **shadcn/ui** + Radix UI Primitives| Erişilebilir (a11y) ui: button, dialog, table, tabs, sheet...      |
| Grafik / Dashboard    | **Tremor** + **Recharts**          | KPI kartları, çizgi/bar/pasta grafikleri, karşılaştırma panelleri   |
| Veri Yönetimi         | **TanStack Query (React Query) v5**| Server state cache, arka plan yenileme, mutation + optimistic UI    |
| Tablo                 | **TanStack Table v8**              | Sıralama, filtreleme, sayfalama, kolon seçimi, sanallaştırma        |
| Global State          | **Zustand 5**                      | useAuthStore, useUIPrefsStore — basit, bağımlılıksız store          |
| Validasyon            | **Zod 3**                          | Tüm form/API tipi doğrulamaları, şema paylaşımı (backend ile)       |
| Kod Editörü           | **Monaco** / CodeMirror entegrasyonu| SQL editörü, sözdizimi vurgulama, tamamlama                          |
| Bildirim              | **Sonner**                         | Toast / snackbar (başarılı / hata / uyarı / info)                   |
| İkon Seti             | **Lucide React**                   | Tutarlı, tree-shakable ikon seti                                    |
| Stil                  | **Tailwind CSS v4 (beta)**         | Utility-first CSS, tema (dark/light), bileşen varyantları (CVA)     |
| Paket Yöneticisi      | **pnpm 10**                        | Hızlı, disk-uzayı tasarruflu kurulum (node_modules hard-link)       |
| Tipler                | **TypeScript 5.6**                 | Strict mode, noEmit doğrulaması, tam yol eşleştirmeleri             |
| Lint                  | **ESLint + eslint-config-next**    | Next.js + React hook kuralları, exhaustive-deps uyarıları           |

---

## 7. Komutlar

Tüm komutlar `frontend/` klasörü içinden `pnpm <komut>` olarak çalıştırılır:

| Komut          | Açıklama                                                                 |
|----------------|--------------------------------------------------------------------------|
| `pnpm dev`     | Geliştirme sunucusu (http://localhost:3000, HMR, debug log, rewrites açık) |
| `pnpm build`   | Production build — Next.js `.next/standalone` + `.next/static` çıktısı   |
| `pnpm start`   | Build sonrası production server başlatır (NODE_ENV=production)           |
| `pnpm lint`    | ESLint çalıştırır (next lint — React hook, Next.js özel kurallar)        |
| `pnpm typecheck` | `tsc --noEmit` — tüm TypeScript dosyalarını derlemeden tip doğrular    |

> **CI/CD önerisi**: Her PR'da `pnpm typecheck && pnpm lint && pnpm build` çalıştırın.

---

## 8. Backend ile Entegrasyon

### Proxy Rewrites (CORS GEREKTİRMEZ)
`next.config.mjs` içinde tanımlı rewrite kuralı:

```mjs
async rewrites() {
  return [
    {
      source: "/api/v1/:path*",
      destination: "http://127.0.0.1:8000/api/v1/:path*",
    },
  ];
}
```

Bu sayede:
- Frontend `/api/v1/health` çağırır → Next.js otomatik olarak backend `8000` portuna proxy'ler
- Tarayıcı CORS (Cross-Origin Resource Sharing) sorunu görmez
- Cookie ve auth header'ları backend'e şeffaf şekilde iletilir

### Docker Üretim Ortamında
`docker-compose.yml` içindeki `ui` servisi için:
```yaml
environment:
  NEXT_PUBLIC_API_URL: http://127.0.0.1:8000
```
API ayrı bir host'ta çalışacaksa bu değeri değiştirmek yeterlidir. Rewrite `next.config.mjs` yerine doğrudan `NEXT_PUBLIC_API_URL` baz alınarak da özelleştirilebilir.

### Backend Gereksinimleri
- PgGuardian Python API (FastAPI / Uvicorn) **8000** portunda çalışmalı
- `/openapi.json`, `/docs`, `/reference`, `/api/v1/*` uç noktalarına erişilebilir olmalı
- Master Password doğrulaması `POST /api/auth` üzerinden sağlanır

---

## Lisans

Üst dizindeki LICENSE dosyasına bakınız.
