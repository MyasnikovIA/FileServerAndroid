# Инструкция: HTTPS-режим FileServerAndroid через `keystore.p12`

Документ описывает, как создать PKCS#12-хранилище с ключом и сертификатом, положить его в нужное место и включить HTTPS в проекте `FileServerAndroid`.

Содержание:

1. [Зачем это нужно](#1-зачем-это-нужно)
2. [Как это работает внутри проекта](#2-как-это-работает-внутри-проекта)
3. [Требования](#3-требования)
4. [Создание `keystore.p12`](#4-создание-keystorep12)
5. [Размещение файла](#5-размещение-файла)
6. [Правка `config.json`](#6-правка-configjson)
7. [Перезапуск сервиса](#7-перезапуск-сервиса)
8. [Проверка, что HTTPS работает](#8-проверка-что-https-работает)
9. [Поведение клиентов](#9-поведение-клиентов)
10. [Диагностика проблем](#10-диагностика-проблем)
11. [Продление / замена сертификата](#11-продление--замена-сертификата)
12. [Что не поддерживается](#12-что-не-поддерживается)

---

## 1. Зачем это нужно

По умолчанию сервер работает по HTTP на `http://<ip>:8080`. Это нормально для локальной сети, но:

- браузеры начинают предупреждать про «небезопасное соединение»;
- некоторые API (`navigator.clipboard`, `Service Worker`, `getUserMedia`, `crypto.subtle`) **не работают** вне «secure context» (HTTPS или `localhost`);
- при пробросе портов наружу пароль и токены летят в открытом виде.

Включение HTTPS решает всё это, но требует `keystore.p12` — файла, содержащего **приватный ключ + цепочку сертификатов** в формате PKCS#12.

---

## 2. Как это работает внутри проекта

Цепочка запуска в `FileServerAndroid.start()`:

```
1. config.httpsEnabled == true ?
        ↓ да
2. resolveHttpsKeystore() → Path
        ↓ файл существует (Files.isRegularFile)
3. SslHelper.createFromPkcs12(path, config.httpsPassword)
        ↓ SSLContext создан (BouncyCastle + KeyManagerFactory)
4. HttpsServer.create(addr, 0)
   httpsSrv.setHttpsConfigurator(new HttpsConfigurator(sslContext))
        ↓
5. actualProtocol = "https"
```

Если **что-то из шагов 2–4 падает**, сервер логирует причину и **откатывается на HTTP** (не падает, но HTTPS не включается).

Ключевые файлы:

- `FileServerAndroid.java` — `start()`, `resolveHttpsKeystore()`, `getListenUrl()`.
- `SslHelper.java` — загрузка `*.p12` через `KeyStore.getInstance("PKCS12", BouncyCastleProvider)`.
- `HttpsServer.java` — `SSLServerSocket` с `TLSv1.3` + `TLSv1.2` и всеми cipher suites.
- `ProjectInitializer.java` — `modifyConfig()` при каждом старте **автоматически** подставляет путь первого `*.p12` из `certs/` в поле `keystore` файла `config.json` (текстовая замена, комментарии сохраняются).

---

## 3. Требования

- **OpenSSL 1.1.1+** на ПК (для генерации; в системах с OpenSSL 3.x всё то же, флаг `-addext` работает).
    - Windows: используйте Git Bash, WSL, или готовые бинарники из [slproweb.com/products/Win32OpenSSL.html](https://slproweb.com/products/Win32OpenSSL.html).
    - macOS: `brew install openssl` (системный `openssl` от Apple — LibreSSL, тоже подходит, но без `-addext`).
    - Linux: пакет `openssl`.
- **Android 8.0+** на устройстве (TLS 1.3 в клиентском стеке — с Android 10+; TLS 1.2 работает и на 8.0).
- Портал `8080` доступен в локальной сети / проброшен, если нужен внешний доступ.

---

## 4. Создание `keystore.p12`

Выбери **один** из вариантов.

### Вариант A. Простой self-signed (рекомендуется для локальной сети)

Один сертификат, без CA. Браузеры покажут «Ваше подключение не защищено», но соединение будет зашифровано, а WebView внутри приложения ошибку проигнорирует автоматически.

```bash
mkdir -p certs && cd certs

# 1. Приватный ключ + самоподписанный сертификат (10 лет)
openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
    -keyout key.pem \
    -out    cert.pem \
    -subj   "/C=RU/ST=Local/L=Local/O=FileServer/CN=fileserver.local"

# 2. Упаковать в PKCS#12 (alias обязателен: fileserver)
openssl pkcs12 -export \
    -inkey  key.pem \
    -in     cert.pem \
    -name   fileserver \
    -out    keystore.p12
# (openssl спросит пароль — введи тот, который потом пропишешь в config.json)
```

### Вариант B. С Subject Alternative Name (для нормальной работы браузеров)

Современный Chrome/Edge/Safari требуют расширения `subjectAltName` (SAN), иначе они покажут `ERR_CERT_COMMON_NAME_INVALID`.

```bash
# Задай IP телефона в локальной сети — его видно в уведомлении сервиса
# (например, 192.168.15.191). DNS-имя — опционально.

IP="192.168.15.191"
HOST="fileserver.local"

openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
    -keyout key.pem \
    -out    cert.pem \
    -subj   "/C=RU/ST=Local/L=Local/O=FileServer/CN=$HOST" \
    -addext "subjectAltName=DNS:$HOST,DNS:localhost,IP:$IP,IP:127.0.0.1"

openssl pkcs12 -export \
    -inkey  key.pem \
    -in     cert.pem \
    -name   fileserver \
    -out    keystore.p12
```

> Если `openssl` старый (LibreSSL на macOS), `-addext` не сработает. Тогда:
> ```bash
> openssl req -new -newkey rsa:2048 -nodes -keyout key.pem -out req.csr \
>     -subj "/CN=$HOST"
> printf "subjectAltName=DNS:$HOST,IP:$IP,IP:127.0.0.1\n" > san.cnf
> openssl x509 -req -in req.csr -signkey key.pem -days 3650 -sha256 \
>     -extfile san.cnf -out cert.pem
> openssl pkcs12 -export -inkey key.pem -in cert.pem -name fileserver -out keystore.p12
> ```

### Вариант C. Из готового сертификата (например, Let's Encrypt)

Если у тебя уже есть `fullchain.pem` и `privkey.pem`:

```bash
openssl pkcs12 -export \
    -inkey  privkey.pem \
    -in     fullchain.pem \
    -name   fileserver \
    -out    keystore.p12
```

### Вариант D. Из Android JKS (если сертификат уже был)

```bash
keytool -importkeystore \
    -srckeystore  old.jks \
    -srcstoretype JKS \
    -destkeystore keystore.p12 \
    -deststoretype PKCS12 \
    -destkeypass  <пароль> \
    -deststorepass <пароль>
```

### Обязательные свойства итогового `keystore.p12`

- **формат**: PKCS#12 (`-export` в `openssl pkcs12` даёт именно его).
- **приватный ключ + сертификат** — оба внутри (флаг `-inkey` и `-in` одновременно).
- **пароль не пустой** (пустой технически допустим, но `KeyStore.load(..., new char[0])` от BouncyCastle на Android ведёт себя непредсказуемо — всегда задавай пароль).
- **один alias** (у нас `fileserver`) — `KeyManagerFactory.getDefaultAlgorithm()` найдёт первый ключ автоматически, но alias — хорошая практика.

Проверка содержимого перед копированием на телефон:

```bash
openssl pkcs12 -info -in keystore.p12 -noout -passin pass:<пароль>
# Должно быть:
#   MAC: sha256, Iteration 2048
#   PKCS7 Encrypted data: ...
#   Shrouded Keybag: ...
#   Cert bag: ...
```

---

## 5. Размещение файла

**Рекомендуемый путь:** `/sdcard/FileServerAndroid/certs/keystore.p12`.

### Способ 1. Положить в `assets/certs/` (для установки «из коробки»)

```
app/src/main/assets/certs/keystore.p12
```

При первом запуске `ProjectInitializer.copyAssetsRecursive()` скопирует его в
`/sdcard/FileServerAndroid/certs/keystore.p12`.

> Файл должен быть добавлен в репозиторий **явно**. Это самый удобный вариант для предустановки на устройства.

### Способ 2. Скинуть на устройство вручную

- Через `adb`:
  ```bash
  adb push keystore.p12 /sdcard/FileServerAndroid/certs/keystore.p12
  ```
- Или любым файловым менеджером (MTP, FTP, загрузка через веб-интерфейс).
- Или прямо через этот же сервер по HTTP:
  `http://<ip>:8080/api/write?path=certs/keystore.p12` — но сначала нужно, чтобы сервер уже работал по HTTP.

### Важное правило `ProjectInitializer.modifyConfig()`

При **каждом** старте сервиса `ProjectInitializer` сканирует `certs/` и подставляет путь **первого по алфавиту** `*.p12` в поле `https.keystore` файла `config.json`.

Отсюда следствия:

- Если у тебя **несколько** `*.p12` в `certs/` — нужный переименуй так, чтобы он был первым (`0-server.p12`, `a-prod.p12` и т.п.).
- Если `certs/` **пуст** — `keystore` будет установлен в путь **каталога** (`.../certs`). `resolveHttpsKeystore()` проверяет `Files.isRegularFile()` → ложь → сервер откатится на HTTP.
- Если ты положил `keystore.p12` **вне** `certs/` и вручную прописал абсолютный путь — при следующем старте он будет **перезаписан** обратно на `certs/...`. Чтобы использовать файл вне `certs/`, убедись, что в `certs/` нет ни одного `*.p12`.

**Вывод:** просто положи `keystore.p12` в `certs/` — и путь обновится сам.

---

## 6. Правка `config.json`

Файл: `/sdcard/FileServerAndroid/config.json`.

Найди блок `https` и приведи к виду:

```jsonc
"https": {
  "enabled": true,
  "keystore": "/sdcard/FileServerAndroid/certs/keystore.p12",
  "password": "changeit"
}
```

Поля:

| Поле | Значение |
|---|---|
| `enabled` | `true` — включить HTTPS. `false` — принудительно HTTP. |
| `keystore` | Абсолютный путь к `*.p12`. При наличии файла в `certs/` — обновляется автоматически. |
| `password` | Тот же пароль, который запрашивал `openssl pkcs12 -export`. |
| `cert`, `key` | Оставь пустыми (`""`). Используются только в desktop-версии, в Android игнорируются. |

> **Не путай** `password` (пароль хранилища) и пароль ключа. В `openssl pkcs12 -export` без `-passout`/`-passin` — это один и тот же пароль.

---

## 7. Перезапуск сервиса

`https.*` **не перезагружается горячо** — `reloadConfig()` явно копирует старые значения. Нужен полный перезапуск `FileServerService`.

Варианты:

1. **Через UI**: уведомление foreground-сервиса → кнопка **«Остановить»**, затем открыть приложение заново.
2. **Force-stop**:
   ```bash
   adb shell am force-stop ru.miacomsoft.fileserver
   adb shell am start -n ru.miacomsoft.fileserver/.MainActivity
   ```
3. **Или просто «смахнуть» приложение из недавних** — сервис останавливается, при следующем запуске создаётся заново.

После старта в `logcat` должны появиться:

```
FileServerAndroid: HTTPS enabled, keystore: /sdcard/FileServerAndroid/certs/keystore.p12
SslHelper: SSLContext created from /sdcard/FileServerAndroid/certs/keystore.p12 (using full BouncyCastle)
FileServerAndroid: Starting HTTPS server on /0.0.0.0:8080
FileServerAndroid: Started on https://0.0.0.0:8080, web=/sdcard/FileServerAndroid/www
FileServerService: Server started: https://<ip>:8080 (local: https://<ip>:8080)
```

`getListenUrl()` теперь вернёт `https://...` — именно этот URL будет виден в уведомлении и его откроет `MainActivity`.

---

## 8. Проверка, что HTTPS работает

### С ПК в той же сети

```bash
# 1. TLS-хендшейк проходит
openssl s_client -connect 192.168.15.191:8080 -showcerts </dev/null
# Должно быть: "Verify return code: 18 (self signed certificate)" — нормально для self-signed

# 2. Сертификат читается
openssl s_client -connect 192.168.15.191:8080 -showcerts </dev/null 2>/dev/null \
    | openssl x509 -noout -subject -dates -ext subjectAltName

# 3. Сервер отвечает
curl -k https://192.168.15.191:8080/api/whoami
# ожидаемо: {"anonymous":true,...}

# 4. Логин и файлы
curl -k -c jar.txt -X POST https://192.168.15.191:8080/api/login \
    -H 'Content-Type: application/json' \
    -d '{"user":"admin","pass":"admin"}'

curl -k -b jar.txt 'https://192.168.15.191:8080/api/list?path='
```

Флаг `-k` (или `--insecure`) обязателен для self-signed. Без `-k` будет ошибка `SSL certificate problem: self-signed certificate`.

### С Android-устройства

Открой приложение. `MainActivity` загрузит `https://<ip>:8080/`. Внутри WebView ошибка сертификата **проигнорируется** — `onReceivedSslError` вызывает `handler.proceed()`:

```java
// MainActivity.java и BrowserActivity.java
@Override
public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
    Log.w(TAG, "SSL error: " + error.toString() + " — proceeding anyway.");
    handler.proceed();   // ← самоподписанные сертификаты разрешены
}
```

### С удалённого браузера (Chrome, Firefox, Safari)

1. Открыть `https://<ip>:8080/`.
2. Chrome/Edge: **«Дополнительно» → «Перейти на <ip> (небезопасно)»**.
3. Firefox: **«Дополнительно» → «Принять риск и продолжить»**.
4. Safari: **«Посетить этот веб-сайт»**.

Предупреждение исчезнет при использовании настоящего сертификата от CA (шаг 4, вариант C), но это требует домена, валидации и подписи — для локальной сети обычно нецелесообразно.

---

## 9. Поведение клиентов

| Клиент | Что делает проект с самоподписанным сертификатом |
|---|---|
| Встроенный WebView (`MainActivity`, `BrowserActivity`) | Игнорирует **любые** SSL-ошибки (`handler.proceed()`). |
| `AndroidBridge.loginRemoteAndSetCookie()` (Java HTTP) | `TrustManager` принимает любой сертификат + `HostnameVerifier` всегда `true`. |
| `ServerCopyService` (push/pull/relay) | Стандартный `HttpsURLConnection`. **Самоподписанный НЕ примет** без своего `TrustManager`. |
| `ProxyHandler` | То же — стандартный `HttpsURLConnection`. |
| `BrowserActivity` (нативный браузер) | Игнорирует SSL-ошибки, как и WebView. |
| Обычный браузер на ПК | Показывает предупреждение, пользователь проходит вручную. |
| `curl`, `wget` | Нужен `-k` (или `--ca-certificate` для настоящего CA). |

Если нужен **полноценный** HTTPS без предупреждений — используй сертификат от реального CA (Let's Encrypt, ZeroSSL) с DNS-именем, указывающим на IP устройства (например, через DDNS).

---

## 10. Диагностика проблем

Смотри `logcat` по тегу `FileServerAndroid`, `SslHelper`, `HttpServer`:

```bash
adb logcat -s FileServerAndroid SslHelper HttpServer FileServerService
```

### Симптом → вероятная причина → решение

| Симптом в logcat | Причина | Решение |
|---|---|---|
| `HTTPS enabled but httpsKeystore is empty in config` | `https.keystore` не заполнен | Проверь `config.json`; положи `*.p12` в `certs/` |
| `HTTPS enabled but keystore not found: <path>` | Файл отсутствует | Проверь путь и `adb shell ls -la <path>` |
| `Failed to load keystore ... — falling back to HTTP: keystore password was incorrect` | Пароль не совпадает | Пароль в `config.json` == пароль `openssl pkcs12 -export` |
| `Failed to load keystore ...: Integrity check failed` | P12 повреждён / другой формат | Пересоздай через `openssl pkcs12 -export` |
| `Failed to load keystore ...: KeyStore exception` / `PKCS12` | P12 создан как JKS или BKS | Пересоздай через `openssl pkcs12 -export` (см. п.4) |
| `Failed to load keystore ...: no key found` | В P12 нет приватного ключа | Пересоздай с `-inkey key.pem` |
| `Failed to create HTTPS server — falling back to HTTP: ...` | Порт занят, TLS не инициализировался | Смени порт или убей предыдущий сервис |
| `SSL connection rejected by client` | Клиент не принял сертификат (самоподписанный) | Ожидаемо для Chrome без «Продолжить» |
| `Address already in use` | Старый инстанс сервиса не остановлен | `adb shell am force-stop ru.miacomsoft.fileserver` |
| Сервер стартует по HTTP, хотя `enabled: true` | `certs/` пуст, или путь указывает на каталог | `adb shell ls /sdcard/FileServerAndroid/certs/` |

### Быстрая проверка пути

```bash
adb shell run-as ru.miacomsoft.fileserver ls -la /sdcard/FileServerAndroid/certs/
adb shell run-as ru.miacomsoft.fileserver cat /sdcard/FileServerAndroid/config.json \
    | grep -A4 '"https"'
```

### Проверка P12 «на месте»

```bash
adb shell run-as ru.miacomsoft.fileserver sh -c \
    'openssl pkcs12 -in /sdcard/FileServerAndroid/certs/keystore.p12 -nokeys -noout -passin pass:<пароль>'
```

Если OpenSSL на телефоне нет — просто проверь на ПК через `adb pull` и `openssl pkcs12 -info`.

---

## 11. Продление / замена сертификата

Порядок действий при истечении или смене IP:

1. Сгенерируй новый `keystore.p12` (см. п.4). Дай ему имя, например `keystore.p12` — перезапиши старый.
2. `adb push keystore.p12 /sdcard/FileServerAndroid/certs/keystore.p12`.
3. Перезапусти сервис (`am force-stop` + `am start`).
4. **Очисти кэш браузера** на удалённом клиенте:
    - Chrome: `chrome://net-internals/#hsts` → «Delete domain security policies» для IP/домена,
      или открой в **Инкогнито**.
    - Firefox: Настройки → Приватность → «Управление исключениями» → удалить запись.
5. Проверь через `openssl s_client` — должны измениться даты `notBefore`/`notAfter`.

> HSTS. Если сервер когда-либо отдавал `Strict-Transport-Security` (сейчас **не отдаёт**), после замены сертификата браузер будет требовать HTTPS ещё какое-то время. На текущей версии это не актуально, но если включат в `StaticHandler` — имей в виду.

---

## 12. Что не поддерживается

- **Автоматический Let's Encrypt / ACME.** Порт 80/443 на Android занят, нет встроенного ACME-клиента. Сертификат обновляется вручную.
- **SNI с несколькими сертификатами.** Один `SSLContext`, один сертификат.
- **PEM (`.pem`/`.crt`/`.key`).** Только PKCS#12. Поля `https.cert`/`https.key` в `config.json` игнорируются на Android.
- **Горячая замена сертификата.** Перезапуск сервиса обязателен.
- **Клиентские сертификаты (mTLS).** Не реализовано.

Если в будущем понадобится — потребуется правка `SslHelper` + отдельный механизм подгрузки PEM через `CertificateFactory` и `KeyFactory`.

---

## TL;DR

```bash
# 1. Сгенерировать
openssl req -x509 -newkey rsa:2048 -sha256 -days 3650 -nodes \
    -keyout key.pem -out cert.pem \
    -subj "/CN=fileserver.local" \
    -addext "subjectAltName=DNS:fileserver.local,IP:192.168.15.191,IP:127.0.0.1"
openssl pkcs12 -export -inkey key.pem -in cert.pem -name fileserver -out keystore.p12

# 2. Положить
adb push keystore.p12 /sdcard/FileServerAndroid/certs/keystore.p12

# 3. В config.json
#   "https": { "enabled": true, "password": "<пароль>" }

# 4. Перезапустить
adb shell am force-stop ru.miacomsoft.fileserver
adb shell am start -n ru.miacomsoft.fileserver/.MainActivity

# 5. Проверить
curl -k https://192.168.15.191:8080/api/whoami
```