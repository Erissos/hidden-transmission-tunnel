# Hidden Transmission Tunnel - Bu Proje Nasil Calisiyor?

Bu belgeyi, projeyi okuyup sadece "hangi teknoloji var" seviyesinde degil, gercekten "bunu ben tekrar kurabilirim" seviyesinde anlayabilmeniz icin hazirladim.

Amacim su uc seyi netlestirmek:

1. Hangi teknoloji nerede kullaniliyor?
2. Istemci ile sunucu arasinda veri nasil akiyor?
3. Bu sistem gizliligi tam olarak nasil sagliyor, nerede sinira takiliyor?

Bu proje ozetle su fikre dayaniyor:

- Admin bir oda olusturur.
- Kullanicilar sadece oda kodunu biliyorsa katilabilir.
- Oda anahtari sunucuda uretilmez; tarayicida, oda kodu + room salt ile turetilir.
- Mesajlar tarayicida sifrelenir.
- Sunucu plaintext gormeden sadece ciphertext relay eder.
- Istemciler birbirinden gelen mesaji imza dogrulamasi yapip cozer.

Yani bu sistem klasik "server-side chat" degil. Bu sistem daha cok "sunucu erisim kontrolu ve iletim yapiyor, asil gizlilik istemcide" modeline sahip.

---

## 1. Projenin Teknoloji Haritasi

### Backend tarafi

Backend klasoru icinde Python 3.12 tabanli bir servis var.

Kullanilan ana teknolojiler:

- FastAPI: HTTP endpointleri ve WebSocket sunucusu icin
- Uvicorn: ASGI runtime
- Redis: oda metadatasi, presence, rate limit, pub/sub icin
- MongoDB + Motor: sifreli mesaj zarflarinin opsiyonel saklanmasi icin
- Pydantic + pydantic-settings: config ve request/response dogrulamasi icin
- PyJWT: kisa omurlu join ticket uretmek icin
- PyNaCl: burada dogrudan kutuphane bazli sifreleme degil, rastgele salt uretiminde kullaniliyor

En kritik backend dosyalari:

- `backend/app/main.py`
  - uygulamayi ayaga kaldirir
  - REST endpointlerini tanimlar
  - WebSocket endpointini tanimlar
  - Redis event listener baslatir
- `backend/app/core/config.py`
  - tum `HTT_` ortam degiskenlerini yukler
  - CORS, admin key, Redis, MongoDB, rate limit gibi her sey burada toplanir
- `backend/app/core/security.py`
  - room code -> room_id donusumu
  - room salt uretimi
  - rastgele nickname uretimi
  - JWT join ticket basma ve dogrulama
- `backend/app/services/room_service.py`
  - odanin Redis'e yazilmasi
  - room code ile odanin bulunmasi
  - join sirasinda nickname uretimi
- `backend/app/services/rate_limiter.py`
  - mesaj gonderim limiti
  - brute-force join denemesi engelleme
- `backend/app/services/event_bus.py`
  - Redis pub/sub ile oda olaylarini dagitir
- `backend/app/ws/manager.py`
  - aktif WebSocket baglantilarini tutar
  - presence listesini yonetir
  - ayni instance icindeki baglantilara yayin yapar
- `backend/app/services/message_store.py`
  - MongoDB'ye sadece sifreli payload yazar
  - TTL index ile otomatik silme altyapisi kurar
- `backend/app/dependencies.py`
  - admin erisimi, IP allowlist ve admin key kontrolu burada yapilir

### Frontend tarafi

Frontend klasoru Next.js tabanli bir istemci uygulamasi.

Kullanilan ana teknolojiler:

- Next.js 16 App Router
- React 19
- TypeScript
- Browser Web Crypto API
- Native WebSocket API
- localStorage / sessionStorage

En kritik frontend dosyalari:

- `frontend/app/page.tsx`
  - normal kullanici arayuzu
  - room join, WebSocket baglanti, sifreleme ve mesaj gosterimi burada
- `frontend/app/admin/page.tsx`
  - admin paneli
  - admin key girisi ve oda olusturma burada
- `frontend/lib/crypto.ts`
  - anahtar turetme, AES-GCM sifreleme, ECDSA imzalama, imza dogrulama ve sifre cozme burada
- `frontend/lib/api.ts`
  - backend ile HTTP konusmasi ve WebSocket URL uretimi burada
- `frontend/lib/session.ts`
  - local anonim kimlik ve admin key saklama mantigi burada
- `frontend/lib/types.ts`
  - istemci tarafi tipleri burada

### Altyapi

Root seviyesinde su teknoloji var:

- Docker Compose
- Redis container'i
- MongoDB container'i

`docker-compose.yml` sadece Redis ve MongoDB'yi ayağa kaldiriyor. Uygulamalar gelistirme sirasinda ayri process olarak kosuyor.

---

## 2. Bu Sistemin Ana Tasarim Fikri

Bu sistemin en onemli tasarim karari su:

**Sunucu guvenilir veri sahibi degil; sadece erisim kontrolu ve tasiyici.**

Bu ne demek?

- Sunucu oda kodunu bilerek erisim yetkisini kontrol ediyor.
- Ama mesaj icerigini cozecek anahtari ideal olarak bilmiyor.
- Mesajlar istemcide sifreleniyor.
- Sunucu sadece sifreli envelope tasiyor.

Bu mimariyi kurarken iki farkli guvenlik alani dusunulmus:

1. **Access control**
   Odaya kim girebilir?

2. **Content confidentiality**
   Odaya girenlerin disinda biri mesaji okuyabilir mi?

Bu projede access control backend tarafinda, content confidentiality ise frontend tarafinda cozuluyor.

---

## 3. Oda Olusturma Akisi

Oda olusturma sadece admin tarafindan yapiliyor.

Akis su sekilde:

1. Admin, frontend admin panelinden veya direkt API ile bir `room_code` gonderir.
2. Backend once `require_admin(...)` ile iki kontrol yapar:
   - istemcinin IP adresi allowlist icinde mi?
   - `x-admin-key` dogru mu?
3. Her sey dogruysa `RoomService.create_room(...)` cagrilir.
4. Bu servis, room code'u direkt saklamaz; once `room_identifier(...)` ile deterministik bir `room_id` uretir.
5. Oda icin rastgele bir `room_salt` uretilir.
6. Redis'e su tipte metadata yazilir:
   - `room_id`
   - `room_salt`
   - `created_at`
   - `expires_at`
   - `persist_messages`
7. Redis anahtarina TTL verilir; sure dolunca oda metadata'si otomatik duser.

Buradaki kritik nokta:

- `room_code` kullanici tarafinda bilinen sir gibi davranir.
- Backend onu birebir id olarak kullanmaz.
- `room_id`, `app_secret` ile HMAC-SHA256 tabanli turetilir.

Bu sayede birisi Redis'te sadece `room_xxx` formatli id gorurse, orijinal room code'u geriye cikarmasi kolay degildir.

---

## 4. Room Code -> Room ID Donusumu Neden Onemli?

`backend/app/core/security.py` icinde su mantik var:

- room code temizleniyor
- buyuk harfe cevriliyor
- `app_secret` ile HMAC-SHA256 uygulanuyor
- ilk 24 hex karakter alinip `room_` on ekiyle id uretiliyor

Bu tasarimin faydasi:

- oda kodlari veri tabaninda acik sekilde tutulmuyor
- ayni code her zaman ayni `room_id`'yi uretiyor
- admin yeniden ayni odayi acmaya calisirsa cakisma tespit edilebiliyor

Ama sunu bilmek onemli:

- Bu, mesaj icerigi sifrelemesi degil
- Bu sadece oda tanimlayicisini gizlemek icin yapilan bir obfuscation + keyed derivation katmani

---

## 5. Kullanici Odaya Nasil Giriyor?

Normal kullanici akisinda merkez nokta `frontend/app/page.tsx`.

Akis adim adim su:

1. Sayfa acilinca istemci local anonim identity yuklemeye calisiyor.
2. Eger yoksa `createIdentity()` ile tarayicida ECDSA key pair uretiliyor.
3. Bu key pair localStorage'a yaziliyor.
4. Kullanici bir room code giriyor.
5. Frontend `POST /api/v1/rooms/join` endpointine room code gonderiyor.
6. Backend room'u bulursa:
   - rastgele bir relay nickname uretiyor (`ghost_xxxxxx`)
   - odanin `room_salt` bilgisini donuyor
   - kisa omurlu bir `ws_ticket` JWT basiyor
7. Frontend `deriveRoomKey(roomCode, room_salt)` cagiriyor.
8. Sonra `ws_ticket` ile WebSocket baglantisi aciyor.

Bu noktada kullanicinin elinde iki farkli kimlik oluyor:

- **Signing identity**: tarayicida olusturulan kalici yerel ECDSA kimligi
- **Relay nickname**: backend'in o oturum icin verdigi takma ad

Bu ayirim cok onemli. Cunku proje sunu hedefliyor:

- sohbet protokolunde bir imza kimligi olsun
- ama relay bunu farkli bir gorunen takma adla tasisin

---

## 6. Join Ticket Nedir, Neden Var?

`issue_join_ticket(...)` backend tarafinda bir JWT uretir.

Bu ticket'in icinde:

- `sub`: nickname
- `room_id`
- `exp`: son kullanma zamani
- `iat`: olusturma zamani
- `jti`: benzersiz token kimligi

Neden gerekli?

Cunku istemcinin WebSocket'e baglanirken tekrar room code gondermesi yerine, once HTTP tarafinda yetkilendirilip kisa omurlu bir baglanti belgesi almasi daha temiz bir model.

Bu ne saglar?

- WebSocket tarafi room code bilmek zorunda kalmaz
- kisa sureli bir capability token mantigi elde edilir
- sonradan gecersiz/bozuk baglanti denemeleri kolay reddedilir

Ama sunu da bilin:

- Bu token mesaj gizliligi saglamaz
- Bu sadece erisim ve oturum baglamini tasir

---

## 7. Oda Anahtari Nasil Turetiliyor?

Asil gizlilik burada basliyor.

`frontend/lib/crypto.ts` icindeki `deriveRoomKey(...)` fonksiyonu su isi yapiyor:

1. room code normalize ediliyor
2. bu deger PBKDF2 icin base key olarak import ediliyor
3. `room_salt` ile birlikte PBKDF2-SHA256 calistiriliyor
4. 310000 iterasyonla AES-256-GCM anahtari turetiliyor

Bu cok kritik. Cunku:

- backend bu room key'i istemciye acik sekilde vermiyor
- istemci anahtari kendi tarafinda hesapluyor
- ayni room code + ayni room salt kombinasyonuna sahip herkes ayni oda anahtarini turetebiliyor

Yani bu sistemde paylasilan sir su:

- kullanicilarin bildigi `room_code`
- backend'in join sirasinda verdigi `room_salt`

Bu ikisinden oda anahtari uretiliyor.

Pratikte model su:

- room code = insanin bildigi sir
- room salt = backend'in oda bazli ek rastgeleligi
- PBKDF2 = kaba kuvveti pahali hale getiren turetme mekanizmasi
- AES-GCM = mesaj sifreleme algoritmasi

---

## 8. Mesaj Gonderilirken Neler Oluyor?

Kullanici mesaj yazip gonder dediginde `encryptMessage(...)` calisiyor.

Adim adim:

1. 12 byte random nonce uretiliyor.
2. Mesaj govdesi UTF-8 byte dizisine cevriliyor.
3. Oda anahtari ile AES-GCM sifreleme yapiliyor.
4. `nonce`, `ciphertext` ve zaman damgasi bir imzalanabilir payload haline getiriliyor.
5. Kullanicinin private signing key'i ile ECDSA P-256 / SHA-256 imzasi uretiliyor.
6. WebSocket uzerinden sunucuya su alanlar gonderiliyor:
   - `nonce`
   - `ciphertext`
   - `signature`
   - `public_key`
   - `timestamp`
   - opsiyonel `self_destruct_seconds`

Sunucu plaintext almiyor.

Sunucunun gordugu sey yalnizca sunlar:

- hangi room_id'ye gonderildigi
- kimden geldigi olarak relay nickname
- ciphertext
- public signing key
- signature
- timestamp
- istemci baglanti bilgisi seviyesinde IP

Yani "mesajin icerigi" gizli, ama "iletisim metadatasi" tamamen yok olmuyor.

Bu ayrim cok onemli. E2EE sistemlerde genelde plaintext gizlenir, metadata tam anlamiyla yok edilmez.

---

## 9. Sunucu Mesaji Nasil Isliyor?

WebSocket endpointi `backend/app/main.py` icinde.

Baglanti kurulduktan sonra su mantik var:

1. Query param icinden `ticket` aliniyor.
2. Ticket decode edilip room_id ve nickname cikartiliyor.
3. `ConnectionManager.connect(...)` ile aktif baglanti kayda aliniyor.
4. Redis presence set'ine nickname ekleniyor.
5. Bir `presence` olayi tum odaya publish ediliyor.

Sonra gelen her mesaj tipi inceleniyor:

### `hello`

Istemci ilk baglandiginda kendi public signing key'ini gonderiyor.

Sunucu bunu `participant-key` eventi olarak relay ediyor.

Bu event su an frontend tarafinda saklanmiyor ya da ileri bir key agreement adiminda kullanilmiyor. Yani su anki kodda bu daha cok protokol genisletme noktasi gibi duruyor.

### `ciphertext`

Mesaj geldiginde backend su adimlari uyguluyor:

1. Rate limit kontrolu yapar.
2. Pydantic ile payload dogrular.
3. Encrypted envelope olusturur.
4. Opsiyonel olarak MongoDB'ye yazar.
5. Redis event bus'a publish eder.

Burada backend'in isi bittiginde yaptigi sey "kaydet ve yayinla" seviyesidir. Cozme islemi yapmaz.

---

## 10. Redis Bu Projede Tam Olarak Ne Ise Yariyor?

Redis burada sadece cache degil; sistemin operasyonel omurgasi.

### 10.1 Room metadata

Room bilgileri Redis hash olarak tutuluyor.

Ornek mantik:

- `room:<room_id>`
  - room_salt
  - created_at
  - expires_at
  - persist_messages

Bu sayede room olusturma ve join akisi hizli.

### 10.2 Presence

Bagli kullanicilar Redis set icinde tutuluyor:

- `presence:<room_id>`

WebSocket acilinca nickname ekleniyor, kapaninca siliniyor.

Bu sayede ayni odaya bagli kisilerin listesi UI'da gosterilebiliyor.

### 10.3 Rate limiting

Iki farkli koruma var:

- oda join brute-force korumasi
- mesaj gonderme hiz limiti

Mesaj gonderme limiti `INCR + EXPIRE` mantigi ile yapiliyor.

Join brute-force mantigi biraz daha farkli:

- basarisiz denemeler sayiliyor
- zaman gectikce deneme hakki geri kazaniliyor
- limit asilinca lock key olusuyor

Bu, kaba kuvvetle room code taramasini zorlastirmak icin kullaniliyor.

### 10.4 Pub/Sub event dagitimi

`RedisEventBus` tum oda eventlerini `room-events:*` pattern'i ile dinliyor.

Yarar:

- yatay olceklemede farkli backend instance'lari ayni oda olaylarini gorebilir
- bir instance'a gelen mesaj diger instance'daki socketlere de iletilebilir

Bu mimari, tek process icinde kalmayan relay yapisi icin dogru bir temel.

---

## 11. MongoDB Ne Icin Var?

MongoDB burada plaintext chat gecmisi tutmak icin degil, sadece sifreli envelope saklamak icin var.

`MessageStore.save_encrypted_message(...)` su yapida belge yazar:

- `room_id`
- `created_at`
- `expires_at`
- `payload`

`payload` icinde yine sadece ciphertext zarfi var.

Onemli nokta:

- MongoDB saklansa bile mesajin acik metni yok
- TTL index sayesinde sure dolunca otomatik silme var

Ama burada cok onemli bir kod gercegi var:

### Room-level persistence bayragi su an tam uygulanmis degil

Admin panelinde oda olustururken `persist_messages` secenegi var.
Bu bilgi Redis room metadata'sina yaziliyor ve join cevabinda istemciye donuluyor.

Fakat WebSocket tarafinda mesaj kaydi yapilirken oda bazli bu bayrak kontrol edilmiyor. `message_store.save_encrypted_message(...)` sadece global config olan `HTT_ENABLE_MESSAGE_PERSISTENCE` aciksa kayit yapiyor.

Yani bugunku kodda fiili davranis su:

- global persistence kapaliysa hicbir oda kaydedilmez
- global persistence aciksa room-level `persist_messages` bayragi pratikte etkisiz kalir

Bu dokumani okurken bunu mimari niyet ile mevcut implementasyon farki olarak aklinizda tutun.

---

## 12. Frontend Nasil Cozuyor ve Dogruluyor?

Sunucudan `ciphertext` eventi geldiginde frontend `decryptMessage(...)` cagiriyor.

Buradaki sira su:

1. Public key import edilir.
2. Signature verify edilir.
3. Dogrulama basariliysa AES-GCM ile plaintext cozulur.
4. Sonuc chat UI'da gosterilir.

Imza dogrulama basarisizsa veya sifre cozumunde hata olursa:

- mesaj `[unable to decrypt]` olarak gosterilir
- `invalid` flag'i set edilir

Bu tasarim su iki saldiriya karsi faydali:

- relay tarafinda paket icerigi degistirme
- yanlis anahtarla sahte mesaj gonderme girisimleri

Tam anlamiyla kimlik guvencesi sagliyor mu?

Kismen. Cunku su an public key pinning ya da uzun omurlu participant trust modeli yok. Kullaniciya bir public key geldi diye bunun hangi kisiye ait oldugunu dissal bir mekanizma ile baglamiyorsunuz. Bu, bugunku haliyle "mesaj kendi ilan ettigi key ile imzalanmis mi" seviyesinde bir butunluk kontrolu sagliyor.

---

## 13. Self-Destruct Mantigi Nasil Calisiyor?

UI'da self-destruct saniyesi girilebiliyor.

Mesaj gonderilirken bu deger envelope'a ekleniyor.
Mesaj alininca frontend `setTimeout(...)` ile lokal mesaj listesinden siliyor.

Bu cok onemli bir detay:

**Bu, su an istemci tarafi gorunum silme mekanizmasi.**

Yani:

- alici arayuzunden mesaji kaldirir
- ama relay hafizasindan veya MongoDB'den ayni saniyede silme garantisi vermez

Ozellikle global message persistence aciksa, self-destruct UI'da silinse bile arka planda encrypted envelope TTL suresi dolana kadar MongoDB'de kalabilir.

Bu sebeple self-destruct ozelligini "kriptografik silme" degil, "istemci sunum seviyesinde gecici gorunum" olarak dusunmek gerekir.

---

## 14. Admin Panel Nasil Korunuyor?

Admin panelinin gorunur olmasi tek basina risk anlamina gelmiyor; asil kontrol backend'de.

`/api/v1/admin/session` ve `/api/v1/admin/rooms` endpointleri `require_admin` dependency'si ile korunuyor.

Bu dependency su kontrolleri yapar:

1. Istemci IP'sini cikarir
2. `HTT_TRUST_PROXY_HEADERS=true` ise `x-forwarded-for` kullanabilir
3. IP allowlist icinde mi bakar
4. `x-admin-key` dogru mu kontrol eder

Bu yaklasimin avantaji:

- biri admin sayfasini acsa bile backend yetki vermezse oda olusturamaz
- reverse proxy arkasinda da kullanilabilir

Ama burada dikkat edilmesi gereken sey:

- `TRUST_PROXY_HEADERS` sadece guvenilir proxy arkasinda acilmali
- aksi halde kullanici sahte `x-forwarded-for` yollayarak IP spoof etmeye calisabilir

---

## 15. Gizlilik Tam Olarak Nasil Saglaniyor?

Bu projede gizlilik tek bir ozellikten gelmiyor. Katmanli geliyor.

### 15.1 Oda kesfedilemiyor

Odalar public listelenmiyor.
Bir kullanici oda kodunu bilmeden dogrudan ulasamaz.

### 15.2 Room identifier geri donusume uygun degil

Room code, HMAC tabanli room_id'ye cevriliyor.
Veri katmaninda kodun kendisiyle calisilmiyor.

### 15.3 Oda anahtari istemcide turetiliyor

Backend plaintext key dagitmiyor.
Tarayici room code + room salt ile anahtari turetiyor.

### 15.4 Mesajlar istemcide sifreleniyor

Sunucu plaintext'e dokunmuyor.

### 15.5 Mesajlar istemcide imzalaniyor

Sunucu sadece zarfi relay ediyor; alici dogrulamayi kendi yapiyor.

### 15.6 Kalici saklama plaintext degil ciphertext uzerinden

MongoDB acik olsa bile yalnizca encrypted envelope saklaniyor.

### 15.7 Operasyonel veri kisa omurlu

Redis verileri operasyonel amacli:

- room TTL
- lock TTL
- rate limit window
- presence state

Bu tasarim geregi sistem, gereksiz uzun sureli uygulama seviyesi veri biriktirmemeye calisiyor.

---

## 16. Gizlilik Neleri Saglamiyor?

Bu kisim cok onemli. Cunku gercek sistem tasarlarken "ne saklaniyor" kadar "ne saklanmiyor saniliyor" da onemlidir.

Bu sistem bugunku haliyle su garantileri vermez:

### 16.1 IP anonimligi saglamaz

Backend kullanicinin IP'sini gorur. Admin korumasi icin zaten gormek zorunda.
Uygulama kodu bunu kalici tutmuyor olabilir, ama baglanti seviyesinde sunucu bunu bilir.

### 16.2 Metadata gizleme tam degil

Sunucu sunlari bilir:

- hangi oda aktif
- kim ne zaman baglandi
- kim ne zaman mesaj atti
- mesaj boyutlari yaklasik olarak ne olabilir
- public signing key'ler

### 16.3 Forward secrecy yok

Bugun oda anahtari room code + salt'tan turetiliyor ve oturum bazli ratchet mekanizmasi yok.

Bu ne demek?

- eger bir sekilde room code ve salt sonradan ele gecerse
- kaydedilmis ciphertext'ler teorik olarak sonradan cozulmeye aday olabilir

### 16.4 Tam kimlik dogrulama modeli yok

Imza var ama katilimci anahtarlarini baglayan guclu bir trust modeli yok.
Yani "bu public key gercekten bekledigim kisiye ait" sorusunun sosyal/protokol yaniti eksik.

### 16.5 Self-destruct kriptografik yok etme degil

Bu sadece UI temizligi.

### 16.6 Gece kalan mesajlari geri yukleme akisi yok

MongoDB'ye saklama var ama bu repoda gecmisi geri okuyan endpoint veya istemci akis bulunmuyor.
Yani persistence su an daha cok arka plan kapasitesi, tam mesaj gecmisi ozelligi degil.

---

## 17. Neden Web Crypto API Kullanilmis?

README'de de belirtilmis: frontend tarafinda libsodium yerine browser Web Crypto API secilmis.

Sebep pratik:

- Next.js / Turbopack tarafinda daha az paket uyumluluk problemi
- tarayicida yerel kripto primitive'lerine ulasmak kolay
- ekstra native binding veya bundler karmasasi yok

Burada kullanilan primitive'ler:

- PBKDF2-SHA256
- AES-256-GCM
- ECDSA P-256 / SHA-256

Bu kombinasyon MVP icin mantikli. Uretim sertliginde daha ileri protokoller dusunulebilir ama bugunku kodun amaci sade ve calisan bir E2EE iskelet cikarmak.

---

## 18. Uygulamayi Sifirdan Yazmak Isterseniz Hangi Sira Ile Kurarsiniz?

Bu belgeyi okuyup benzer sistemi yazmak istiyorsaniz, su sirayla gitmek mantikli olur:

1. **Config katmani**
   - ortam degiskenlerini toplayin
   - admin key, app secret, Redis URL, Mongo URL, CORS ayarlarini belirleyin

2. **Room kimlik modeli**
   - room code'u normalize edin
   - HMAC ile room_id uretin
   - room_salt yaratip Redis'e TTL ile yazin

3. **Admin API**
   - IP allowlist
   - admin key
   - oda olusturma endpointi

4. **Join API**
   - room code ile oda lookup
   - brute-force koruma
   - nickname uretimi
   - kisa omurlu JWT ticket

5. **Frontend local identity**
   - tarayicida signing key pair yarat
   - localStorage'a koy

6. **Room key derivation**
   - room code + room salt ile PBKDF2 uygula
   - AES-GCM key elde et

7. **WebSocket protokolu**
   - ticket ile baglan
   - hello mesaji ile public key gonder
   - ciphertext payload'i relay et

8. **Message integrity**
   - nonce + ciphertext + timestamp uzerinden imza uret
   - alici tarafta verify et

9. **Operational Redis katmani**
   - presence set
   - rate limit key'leri
   - pub/sub fan-out

10. **Opsiyonel persistence**
   - sadece encrypted envelope sakla
   - TTL index kullan

11. **Hardening**
   - HTTPS/WSS zorunlulugu
   - forward secrecy
   - key ratchet
   - replay korumasi
   - audit/test

---

## 19. Bu Projeyi Okurken Aklinizda Tutmaniz Gereken Ana Gercek

Bu repo tamamlanmis bir Signal alternatifi degil.
Bu repo daha cok su seyin calisan iskeleti:

- private code-based room access
- client-side encryption
- server-side ciphertext relay
- lightweight anonymous session model

Yani proje, "gizli iletisim altyapisinin cekirdek fikirlerini gosteren MVP" olarak dusunulmeli.

Bu haliyle en guclu yani:

- plaintext'i relay'den uzak tutmasi

En zayif yani:

- metadata ve oturum guvenliginde ileri seviye protokol sertlestirmelerinin henuz olmamasi

---

## 20. Kisa Ozet

Bu projede:

- FastAPI erisim kontrolu ve WebSocket relay yapiyor
- Redis oda durumu, presence, brute-force koruma, rate limit ve event dagitimi icin kullaniliyor
- MongoDB sadece encrypted envelope saklamak icin opsiyonel kullaniliyor
- Next.js arayuzu sagliyor
- Web Crypto API oda anahtari turetme, sifreleme ve imzalama yapiyor
- JWT kisa omurlu WebSocket giris bileti sagliyor

Gizlilik modeli su prensibe dayaniyor:

**sunucu mesaj icerigi bilmesin, sadece iletsin**

Bu prensip kodun hemen her yerine yansitilmis.

Eger bu sistemi siz yazacak olsaydiniz, once access control, sonra key derivation, sonra ciphertext relay, sonra integrity verification, en son persistence ve hardening katmanlarini eklersiniz. Bu repo tam olarak o siralamayi gosteriyor.