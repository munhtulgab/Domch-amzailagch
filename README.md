# ДОМЧ ам зайлагч — вэб сайт

Жамц давсны уусмал ДОМЧ-ийн танилцуулга сайт (Жем Интернэшнл ХХК): **https://domch.gem.mn**. Сав хуудсыг гүйлгэх үед 3D-ээр хөдөлж эргэлдэнэ.
Сэтгэгдэл, эмчээс асуух, хамтын ажиллагааны 4 төрлийн хүсэлт, байршлын санал, газрын зурагтай салбар хайлт,
сайтын хайлт, удирдлагын хэсэг (`/admin`) бүгд өгөгдлийн сантай холбогдон ажиллана.

| Хэсэг | Технологи | Хавтас |
| --- | --- | --- |
| Frontend | React 18, Vite 5, three.js (3D), Leaflet + OpenStreetMap (газрын зураг) | `src/`, `public/` |
| Backend | Python, FastAPI (Vercel Python Function) | `api/` |
| Өгөгдлийн сан | Cloudflare D1 (`domch`), REST API-гаар холбогдоно | `api/_lib/schema.sql` |

```
api/index.py          Vercel-ийн оролт (FastAPI app)
api/_lib/app.py       API: агуулга, маягтууд, админ
api/_lib/db.py        D1 (production) / SQLite (компьютер дээр, тест) холболт
api/_lib/schema.sql   хүснэгтүүд
api/_lib/seed.sql     эхний өгөгдөл ба «Жишээ» мөрүүд
src/Landing.jsx       нүүр хуудас
src/three/scene.js    3D сав, гүйлгэлтийн хөдөлгөөн
src/components/       хэсгүүд, маягтууд, газрын зураг, цонхнууд
src/admin/            удирдлагын хэсэг
tests/                API тест (pytest)
vercel.json           build, функц, чиглүүлэлтийн тохиргоо
```

## Vercel дээр нийтлэх

1. [vercel.com/new](https://vercel.com/new) → `munhtulgab/domch-amzailagch` repo-г **Import** → Project Name: `domch-amzailagch`.
   Framework, build командыг `vercel.json` тохируулна, өөрчлөх шаардлагагүй.
2. **Environment Variables** хэсэгт доорх утгуудыг оруулаад **Deploy** дарна.

| Нэр | Утга |
| --- | --- |
| `CF_ACCOUNT_ID` | Cloudflare dashboard-ын хаяг `dash.cloudflare.com/<ACCOUNT_ID>/...` дахь 32 тэмдэгт (Workers & Pages хуудасны баруун талд ч бий) |
| `CF_D1_DATABASE_ID` | `0e1a2ad5-1dc0-4fb3-9429-e84fb3a5fa2e` |
| `CF_API_TOKEN` | My Profile → API Tokens → Create Token → **Create Custom Token** → Permissions: *Account · D1 · Edit* |
| `ADMIN_TOKEN` | `/admin`-д нэвтрэх түлхүүр. Урт, санамсаргүй утга сонгоно |
| `IP_HASH_SALT` | заавал биш, санамсаргүй тэмдэгт мөр |
| `SITE_URL` | заавал биш. Үндсэн хаяг, анхдагч нь `https://domch.gem.mn` |

3. Нийтлэгдсэний дараа `https://domch.gem.mn/api/health` нээхэд `"db": "d1"` гэж харагдвал D1-тэй холбогдсон байна.
   `"db": "not_configured"` гэвэл env утга дутуу, `"db": "error"` гэвэл токены эрхийг шалгана.
   Env утгыг өөрчилсний дараа **Redeploy** хийнэ.

`main` салбар руу push хийх бүрт Vercel автоматаар дахин нийтэлнэ.

### Үндсэн хаяг — domch.gem.mn

- Vercel → Project → Settings → Domains дээр `domch.gem.mn` нэмэгдсэн, DNS нь Vercel рүү заасан байна.
- Хуучин `domchamzailagch.vercel.app` хаягийн хуудсууд `domch.gem.mn` руу 308-аар шилжинэ (`vercel.json` → `redirects`).
  `/api/...` шилжихгүй, хуучин хаягаар ирсэн Facebook webhook тасрахгүй.
- Messenger, Instagram, AI-ийн хариултад орох сайтын холбоос үргэлж үндсэн хаягтай байна. Мэдлэгийн сан, асуулт-хариултад
  хуучин `…vercel.app` холбоос үлдсэн бол илгээхээс өмнө автоматаар `domch.gem.mn` болгоно.
- Facebook-ийн webhook хуучин хаяг дээр бүртгэлтэй бол дараагийн мессеж ирэхэд `https://domch.gem.mn/api/messenger/webhook`
  руу өөрөө шилжинэ (эсвэл Тохиргоо → Messenger, Instagram → **Холболт шалгах**).
- Хаягийг өөрчлөх бол Vercel-д `SITE_URL` env нэмж, `index.html`, `public/robots.txt`, `public/sitemap.xml`, `vercel.json`-ийг засна.

## Компьютер дээр ажиллуулах

```bash
npm install
pip install -r requirements-dev.txt
npm run dev:api   # API: http://127.0.0.1:8000, өгөгдөл .local/domch.db-д, админ түлхүүр: dev-admin
npm run dev       # Сайт: http://localhost:5173 (/api хүсэлтийг 8000 руу дамжуулна)
npm run test:api  # API тест
npm run build     # dist/ хавтсанд бэлэн сайт
```

D1-гүйгээр локал SQLite дээр ажиллана. `.env.example`-д бүх тохиргооны тайлбар бий.

## Удирдлагын хэсэг — `/admin`

`ADMIN_TOKEN`-оор нэвтэрнэ.

- **Тойм** — шинэ хүсэлтийн тоо, сүүлийн 30 хоногийн үйлдэл (салбар хайсан, зам заалгасан, видео тоглуулсан гэх мэт)
- **Хамтын ажиллагаа, Эмчээс асуусан, Сэтгэгдэл, Байршлын санал** — ирсэн хүсэлтүүд. Төлөв өөрчлөх, устгах, CSV татах.
  Сэтгэгдэл **Нийтлэх** дарсны дараа сайтад гарна.
- **Салбарууд, Бүтээгдэхүүн, үнэ, Эмчийн зөвлөгөө, Видео, Түгээмэл асуулт** — сайтын агуулга нэмэх, засах, нуух, устгах
- **Messenger** — Facebook Page руу ирсэн мессежүүд, эндээс хариулах (сүүлийн мессежээс хойш 24 цагийн дотор)
- **Тохиргоо → Холбоо барих** — утас, и-мэйл, хаяг, онлайн дэлгүүр, сошиал холбоос (footer-т харагдана)
- **Тохиргоо → Facebook Messenger** — App ID, App Secret, Page access token оруулаад **Хадгалаад холбох** дарна
- **Тохиргоо → AI** — Gemini API key, загвар, Messenger-т AI-аар хариулах эсэх, нэмэлт заавар, туршиж асуух
- **Мэдлэгийн сан** — AI-ийн ашиглах баталгаатай мэдээлэл (асуулт/сэдэв, хариулт, түлхүүр үг)

«Жишээ» тэмдэгтэй мөрүүд нь загварын өгөгдөл. Засвал бодит мөр болно, **Тойм → Жишээг устгах** нь үлдсэнийг устгана.
Агуулгын өөрчлөлт сайтад 1 минутын дотор гарна.

## Facebook Messenger

1. [developers.facebook.com/apps](https://developers.facebook.com/apps) → Create app → Messenger-ийн хувилбар.
2. App settings → Basic: **App ID**, **App Secret**. Messenger → API Setup → Generate access tokens: Page-ээ холбоод **Page access token**.
3. `/admin` → Тохиргоо → Facebook Messenger хэсэгт гурвыг оруулаад **Хадгалаад холбох**. Систем token-ийг шалгаж,
   webhook-ийг (`https://<сайт>/api/messenger/webhook`) бүртгэж, Page-ийг апптай холбоно.
4. Сайт дээр «Messenger-ээр бичих» товч гарна. Page руу ирсэн мессеж админы **Messenger** цэсэнд орж, хариулах боломжтой.
   Автомат хариу тохируулж болно.

Апп Development горимд байхад зөвхөн апп дээр эрхтэй хүмүүсийн мессеж ирнэ. Бүх хүнд нээхэд App Review-ээр
`pages_messaging` эрх авч, аппыг Live болгоно. Token-ууд D1-ийн `integrations` хүснэгтэд хадгалагдах бөгөөд сайтын
нийтийн API-д хэзээ ч гарахгүй.

### Instagram DM

Instagram-ийн DM нь Facebook Page-ийн нэг token-оор Messenger-тэй хамт ажиллана (Instagram API with Facebook Login).
1. Instagram professional аккаунтыг Facebook Page-тэй холбоно; Instagram апп → Мессеж → Холбогдсон хэрэгслүүд →
   «Allow access to messages»-ийг асаана.
2. Meta апп-д Instagram-ийн use case нэмж, `instagram_basic`, `instagram_manage_messages` эрхтэй Page token үүсгэнэ.
3. Тохиргоо → Messenger, Instagram хэсэгт тэр token-ийг оруулаад **Хадгалаад холбох**. «Instagram DM» алхам ✓ болно.

Instagram-ийн DM админы **Messenger, Instagram** цэсэнд «IG» тэмдэгтэй ирж, мэндчилгээ, асуултын товч, AI хариулт
Messenger-тэй адил ажиллана (Instagram-д эхлэх дэлгэцийн текст байхгүй, асуултын товч л харагдана).

### Мэндчилгээ ба AI хариулт

- **Мэндчилгээ ба автомат хариу** (Facebook Messenger таб): эхлэх дэлгэцийн текст, мэндчилгээ мессеж, 4 хүртэлх асуулт-хариулт.
  Хүн анх бичихэд (эсвэл 24 цаг завсарласны дараа) мэндчилгээ ба асуултын товч очно; товч дарахад хариулт автоматаар очно.
- **AI** (Тохиргоо → AI): [Google AI Studio](https://aistudio.google.com/apikey)-оос Gemini API key авч оруулна.
  Асуултын товчинд хамаарахгүй асуултад AI нь **Мэдлэгийн сан**, жишээ биш **Эмчийн зөвлөгөө**, түгээмэл асуулт,
  үнэ, холбоо барих мэдээлэлд тулгуурлан монголоор хариулна. Мэдлэгт байхгүй зүйлийг зохиохгүй, ажилтанд шилжүүлнэ.
- Админ харилцан ярианд өөрөө хариулсан бол тэр хүнд Тохиргоо → AI-д сонгосон хугацаанд (анх 30 минут) AI хариулахгүй.

## API

| Арга | Зам | Үүрэг |
| --- | --- | --- |
| GET | `/api/content` | бүтээгдэхүүн, FAQ, зөвлөгөө, видео, нийтлэгдсэн сэтгэгдэл, шүүлтүүр, холбоо барих |
| GET | `/api/branches?city=&district=&chain=&size=&q=` | салбар хайлт |
| GET | `/api/search?q=` | сайтын хайлт |
| POST | `/api/reviews`, `/api/questions`, `/api/partners`, `/api/location-requests` | маягтууд |
| POST | `/api/events` | үйлдлийн статистик |
| GET, POST | `/api/messenger/webhook` | Facebook Messenger webhook (гарын үсгээр шалгана) |
| * | `/api/admin/...` | удирдлага (`Authorization: Bearer <ADMIN_TOKEN>`) |

Бүрэн тайлбар: `/api/docs`. Маягт бүр 10 минутад нэг хүнээс 5 хүртэл хүсэлт авна, спам-бот шүүх нууц талбартай.

## Бөглөх мэдээлэл

- Үнэ, онлайн дэлгүүрийн холбоос (Бүтээгдэхүүн, үнэ)
- Салбарууд: Ази Фарма (e.apteka.mn/mn/location, 19), Хүрмэн эмийн сан (khurmen.mn/emiin-san, 17), Тавин Ус эмийн сан
  (tavinus.mn/sector-and-location, 12) 2026.11.05-нд нэмэгдсэн. Тавин Усын 11 салбар координатгүй (сайтад нь зөвхөн төв байрных бий). Ази Фармагийн 15 орон нутгийн салбар болон Хүрмэн Хархорин координатгүй (газрын зураг дээр
  гарахгүй, «Зам заалгах» хаягаар хайна). Хүрмэнгийн салбаруудын утас, ДОМЧ аль салбарт байгааг баталгаажуулна.
- Эмчийн зөвлөгөө, видео, контент бүтээгчдийн видео
- Холбоо барих мэдээлэл, сошиал холбоос
- Хэрэглэх хэмжээ, зайлах хугацаа, хүүхдийн насны заалт — шошгоор баталгаажуулна

## Тэмдэглэл

- Савлагааг 250 мл / 500 мл гэж оруулсан. Хөгжүүлэлтийн гайдад 200 мл гэж бичсэн тул шалгана уу.
- 3D сав нь бүтээгдэхүүний зурагт тулгуурласан ойролцоо загвар. Дизайнерын `.glb` файл байвал сольж болно.
- Сэтгэгдэлд зураг хавсаргах боломж одоогоор алга (файл хадгалах сан шаардана: Cloudflare R2 эсвэл Vercel Blob).
- Онлайн дэлгүүрийн холбоосын даралтыг борлуулалт гэж тооцохгүй.
