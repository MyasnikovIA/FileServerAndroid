# FileServerAndroid (MVP)

HTTP/HTTPS файловый сервер, работающий **прямо на Android-устройстве**.
Приложение поднимает локальный веб-сервер (`http://<ip>:8080`) и предоставляет
полноценный веб-интерфейс: файловый менеджер в стиле FAR, оконный менеджер (WM),
просмотрщики файлов, эмуляторы, автозапуск приложений и многое другое.

Одновременно приложение может работать как **лаунчер** (замена домашнего экрана)
и как **сервер для удалённого доступа** — с любого устройства в той же сети
(или через проброс портов) можно открыть веб-интерфейс в обычном браузере.

---
## Документы
[setupServer.md](setupServer.md)
[useHTTPS.md](useHTTPS.md)
[userProxyFileServer.md](useProxyFileServer.md)
[useWeb.md](useWeb.md)

## Содержание

- [Возможности](#возможности)
- [Архитектура](#архитектура)
- [Требования](#требования)
- [Сборка и установка](#сборка-и-установка)
- [Первый запуск](#первый-запуск)
- [Конфигурация `config.json`](#конфигурация-configjson)
- [REST API](#rest-api)
- [JavaScript-мост `AndroidBridge`](#javascript-мост-androidbridge)
- [Автозапуск](#автозапуск)
- [Копирование между серверами](#копирование-между-серверами)
- [HTTPS](#https)
- [Веб-интерфейс](#веб-интерфейс)
- [Структура проекта](#структура-проекта)
- [Известные ограничения](#известные-ограничения)
- [Лицензия](#лицензия)

---

## Возможности

### Сервер

- HTTP/HTTPS на порту `8080` (порт и хост задаются в `config.json`, на Android
  жёстко переопределяются на `0.0.0.0:8080`).
- Полностью **самописная реализация** `com.sun.net.httpserver`
  (`HttpServer`, `HttpsServer`, `HttpExchange`, …) — не тянет JDK-зависимостей,
  работает на Android ART.
- HTTPS с PKCS#12-хранилищем (`*.p12`), поддержка TLS 1.3 и 1.2.
  SSL-контекст собирается через BouncyCastle (`SslHelper`).
- Range-запросы (206 Partial Content) для `GET`/`HEAD` — стриминг
  больших файлов, докачка.
- CORS с поддержкой credentials (`Access-Control-Allow-Credentials: true`).
- Server-Sent Events (`/api/events`) — push-уведомления об изменениях
  файлов и задачах копирования.
- Встроенный прокси (`/api/proxy/...`) — ретрансляция запросов на другие
  серверы с подменой токена.
- Слежение за файлами (`WatchService`) → SSE-события `change`.
- Горячая перезагрузка `config.json` — изменения подхватываются без
  перезапуска сервиса.
- Автообнаружение USB/SD-накопителей: при подключении создаётся/перемонтируется
  share автоматически.

### Файлы

- Виртуальные `shares` — именованные корни (папки или отдельные файлы).
- Управление доступом: `read` / `write` / `delete`, список пользователей,
  анонимный доступ.
- Квоты на пользователя и на share (МБ).
- Операции: `list`, `stat`, `read`, `write` (атомарная запись через temp-файл),
  `mkdir`, `delete`, `move`, `copy`, `server-copy`.
- Валидация имён для FAT32/exFAT (SD-карты).
- Публичные шары (`/api/public/{share}/...`) — без авторизации,
  только `anonymous: true` + `read`.

### Аутентификация

- Логин/пароль (`users` в `config.json`).
- Выдача токенов (`TokenService`) на 24 часа, URL-safe Base64.
- Способы передачи токена (в порядке проверки):

  1. `Authorization: Bearer <token>` — мягкий (если невалиден — идём дальше);
  2. `X-Auth-Token: <token>` — мягкий;
  3. `Authorization: Basic <base64(user:pass)>` — мягкий;
  4. `Cookie: filebd_token=<token>` — мягкий;
  5. `?token=<token>` — **строгий** (если указан, но невалиден → 401);
  6. `?user=<u>&pass=<p>` — **строгий**;
  7. Анонимная сессия.

### Android-мост

- Список установленных приложений (`getApps`).
- Запуск приложений по `pkg` / `activity` (`launchApp`).
- Установка APK (`installApk`) — с обработкой `REQUEST_INSTALL_PACKAGES`
  и `ACTION_MANAGE_UNKNOWN_APP_SOURCES`.
- Открытие системных настроек, настроек лаунчера, внешних ссылок.
- Проверка, является ли приложение лаунчером по умолчанию.
- Открытие встроенного браузера (`BrowserActivity`) на WebView.

### Веб-интерфейс

- Файловый менеджер в стиле **FAR Manager** (две панели, горячие клавиши,
  контекстные меню).
- **WM (оконный менеджер)** — виртуальный рабочий стол с перетаскиванием
  окон, изменением размера, максимизацией.
- Встроенные просмотрщики:
  - видео/аудио (HTML5 `<video>` / `<audio>`);
  - изображения;
  - PDF (`<embed>`);
  - текст (fetch + `<pre>`);
  - панорамы (`Pannellum`);
  - G-code (SVG-рендер);
  - эмуляторы (EmulatorJS) — NES/SNES/GBA/SEGA/PSX;
  - DOS (js-dos);
- **Виртуальный джойстик** (`60-virtual-gamepad.js`) для эмуляторов.
- **Тач-адаптер** (`62-touch-adapter.js`) — long-press → contextmenu,
  тач-drag, resize окон за края.
- Автозапуск: Android-приложения, JS-скрипты, окна WM.
- Смена пароля, WM-приложение «Смена пароля».

---

## Архитектура

```
┌─────────────────────────────────────────────────────────┐
│  MainActivity (WebView, immersive)                       │
│    └─ http://127.0.0.1:8080/  ─────────────┐             │
│  BrowserActivity (полноценный WebView-браузер)│            │
│  FileServerService (foreground, dataSync)    │            │
│    └─ FileServerAndroid.start()              │            │
│         ├─ HttpServer/HttpsServer :8080      │            │
│         ├─ FileServer (static registry)      │            │
│         ├─ Config, TokenService, QuotaService│            │
│         ├─ RootHandler → StaticHandler       │            │
│         │             → shares               │            │
│         ├─ ApiHandler (/api/*)               │            │
│         ├─ ProxyHandler (/api/proxy/*)       │            │
│         ├─ SseHandler (/api/events)          │            │
│         └─ ServerCopyService (фоновые копии) │            │
│                                              │            │
│  Веб-клиенты (локально или удалённо) ────────┘            │
└─────────────────────────────────────────────────────────┘
```

Ключевые точки:

- `FileServer` — статический реестр всего (конфиг, токены, auth, quota,
  handlers, SSE-клиенты, `android.context`).
- `FileServerAndroid` — жизненный цикл сервера (создание сокета, watcher,
  перемонтирование share'ов).
- `FileServerService` — foreground-сервис, поднимающий `FileServerAndroid`
  в отдельном потоке.
- `ProjectInitializer` — при первом запуске копирует `assets/` в
  `/sdcard/FileServerAndroid` и правит `config.json` (пути `web`,
  `keystore`).

---

## Требования

- **Android 8.0+ (API 26)** — для foreground service и `MANAGE_EXTERNAL_STORAGE`.
- **Android 11+ (API 30)** — рекомендуется: доступ к `Android/data`,
  `getStorageVolumes()`.
- Разрешение `MANAGE_EXTERNAL_STORAGE` («Доступ ко всем файлам»).
- Разрешение `REQUEST_INSTALL_PACKAGES` («Установка неизвестных приложений»).
- Для HTTPS — файл `*.p12` в `/sdcard/FileServerAndroid/certs/`.

Сборка:

- Android Studio (AGP 8+, JDK 17).
- BouncyCastle (`org.bouncycastle:bcprov-jdk18on`).

---

## Сборка и установка

```bash
git clone <repo>
cd FileServerAndroid
./gradlew assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Релиз:

```bash
./gradlew assembleRelease
```

При первом запуске приложение:

1. Запросит «Доступ ко всем файлам» (`ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION`).
2. Создаст каталог `/sdcard/FileServerAndroid/`.
3. Скопирует туда `www/`, `certs/`, `config.json`.
4. Запустит foreground-сервис и откроет `http://127.0.0.1:8080/`
   во встроенном WebView.

---

## Первый запуск

1. **Разрешения.** Приложение не запустит сервис, пока не выдано
   `MANAGE_EXTERNAL_STORAGE`. Кнопка «Разрешить» откроет системные настройки.
2. **Порт.** По умолчанию `8080`. Если занят — сервис не стартует,
   в `logcat` будет `Address already in use`.
3. **URL для удалённого доступа.** Отображается в уведомлении
   foreground-сервиса: `http://<ip>:8080/`.
4. **Логин.** По умолчанию в `config.json` обычно есть пользователь
   `admin` — пароль задаётся там же. Если `users` пуст — работает
   только анонимный доступ (в соответствии с `anonymous` у share'ов).

---

## Конфигурация `config.json`

Файл: `/sdcard/FileServerAndroid/config.json`.

Поддерживаются **комментарии** `//`, `#`, `/* ... */`
(`JsonCommentsStripper` вырезает их перед парсингом).

### Структура

```jsonc
{
  "http": {
    "port": 8080,
    "host": "0.0.0.0"
  },
  "https": {
    "enabled": false,
    "cert": "",                          // pem (не используется)
    "key":  "",                          // pem (не используется)
    "keystore": "/sdcard/FileServerAndroid/certs/server.p12",
    "password": "changeit"
  },
  "web": "/sdcard/FileServerAndroid/www",

  "users": [
    { "name": "admin", "password": "admin", "quota": -1, "console": false },
    { "name": "guest", "password": "",      "quota": 100 }
  ],

  "shares": [
    {
      "name": "Files",                    // пустой name = корневой share
      "physical": "/storage/emulated/0",
      "type": "folder",                   // "folder" | "file"
      "access": ["read", "write", "delete"],
      "anonymous": false,
      "users": ["admin"],
      "quota": -1
    },
    {
      "name": "Public",
      "physical": "/storage/emulated/0/Download",
      "type": "folder",
      "access": ["read"],
      "anonymous": true,
      "users": []
    }
  ],

  "autostart": {
    "androidApps": [
      { "pkg": "com.example.app", "act": "", "label": "Example" }
    ],
    "jsScripts": [
      { "url": "js/custom-startup.js", "name": "custom" },
      { "code": "console.log('hello')", "name": "inline" }
    ],
    "wmApps": [
      { "id": "explorer", "title": "Explorer" }
    ]
  }
}
```

### Поля

| Поле | Описание |
|---|---|
| `http.port`, `http.host` | Порт и адрес. На Android принудительно `0.0.0.0:8080`. |
| `https.enabled` | Включить HTTPS. Если keystore отсутствует или битый — автоматический откат на HTTP с записью в logcat. |
| `https.keystore`, `https.password` | PKCS#12-файл и пароль. |
| `web` | Каталог статики. `ProjectInitializer` подставляет абсолютный путь. |
| `users[].quota` | Квота в МБ (`-1` = без лимита). |
| `users[].console` | Разрешить консоль (на Android отключено). |
| `shares[].physical` | Абсолютный путь. Для USB/SD перемонтируется автоматически. |
| `shares[].type` | `folder` или `file` (файл как отдельный share). |
| `shares[].access` | `read`, `write`, `delete`. |
| `shares[].anonymous` | Доступен без логина (виден анонимам). |
| `shares[].users` | Кому виден (кроме `anonymous`). |
| `shares[].quota` | Квота на share в МБ. |
| `autostart.*` | См. [Автозапуск](#автозапуск). |

### Наследование

Если `shares` содержит share с `"name": ""` — это **корневой** share.
Все незнакомые пути сначала ищутся как `shares[name]`, а если такого нет —
как файл в корневом share (`VirtualResolver`).

### Горячая перезагрузка

`config.json` опрашивается каждые 2 секунды (`CONFIG_POLL_MS`).
Изменения применяются без перезапуска. **Не применяются** на лету:

- `http.port`, `http.host`;
- `https.*`;
- `web`.

Для них нужен полный перезапуск сервиса.

---

## REST API

Базовый URL: `http://<ip>:8080`. Все ответы — `application/json; charset=utf-8`,
ошибки — `{ "error": "...", "status": N }`.

### Аутентификация

| Метод | Путь | Описание |
|---|---|---|
| `POST` | `/api/login` | Тело: `{user, pass}` или `{username, password}` (JSON), либо form-urlencoded, либо query. Ответ: `{ok, token, user, issuedAt, expiresAt, ttlMs}` + `Set-Cookie: filebd_token=...` |
| `GET`  | `/api/login?user=&pass=` | То же через query. |
| `POST` | `/api/logout` | Тело: `{token}` (или form, или `Authorization`/`Cookie`). Возвращает `Set-Cookie: filebd_token=; Max-Age=0`. |
| `GET`  | `/api/logout?token=` | То же. |
| `POST` | `/api/change-password` | `{oldPassword, newPassword}`. Только для аутентифицированных. |

### Информация

| Метод | Путь | Описание |
|---|---|---|
| `GET` | `/api/info` | `{type, version, anonymous, username, userQuotaMb, userUsedBytes, shares[]}` |
| `GET` | `/api/whoami` | `{anonymous, username, quotaMb, console}` |

### Файловые операции

| Метод | Путь | Описание |
|---|---|---|
| `GET` | `/api/list?path=&recursive=1` | `{path, recursive, entries[]}` |
| `GET` | `/api/stat?path=` | `{name, path, isFolder, size, mtime, contentType, binary}` |
| `GET` | `/api/read?path=` | Файл. Поддерживает `Range`. |
| `PUT` / `POST` | `/api/write?path=` | Тело — содержимое файла. Максимум 2 ГБ. Запись через temp + атомарный `move` (fallback на обычный `move`). |
| `POST` | `/api/mkdir?path=` | Создать папку. |
| `DELETE` / `POST` | `/api/delete?path=` | Удалить файл/папку (рекурсивно). |
| `POST` | `/api/move?from=&to=` | Переместить. Между share'ами — копия + удаление. |
| `POST` | `/api/copy?from=&to=` | Копировать. |

### Установленные Android-приложения

| Метод | Путь | Описание |
|---|---|---|
| `GET` | `/api/apps` | `{apps: [{pkg, activity, label, icon?}], count}` — список launcher-приложений. Доступен и удалённым клиентам (не требует WebView). Анонимный доступ **разрешён** (как у `GET /api/autostart`). |

### Автозапуск

| Метод | Путь | Описание |
|---|---|---|
| `GET`  | `/api/autostart` | `{androidApps, jsScripts, wmApps}` |
| `POST` | `/api/autostart` | Полная замена конфига (те же три массива). Требует аутентификации. Сохраняет `config.json`, подавляет hot-reload на 3 с, рассылает SSE `autostart-changed`. |

### Server-copy

| Метод | Путь | Описание |
|---|---|---|
| `POST` | `/api/server-copy` | `{mode: "local"\|"push"\|"pull"\|"relay", ...}` → `{ok, taskId, task}` |
| `GET`  | `/api/server-copy/status?taskId=` | Статус: `{taskId, mode, status, bytesDone, bytesTotal, percent, error?}` |
| `GET`  | `/api/server-copy/list` | Только свои задачи. |
| `POST` | `/api/server-copy/cancel?taskId=` | Отмена. |

Режимы:

- **local** — `srcPath` → `dstPath` внутри этого сервера.
- **push** — локальный `srcPath` → удалённый `dstUrl/api/write?path=dstPath`.
- **pull** — удалённый `srcUrl/api/read?path=srcPath` → локальный `dstPath`.
- **relay** — поток `srcUrl/srcPath` → `dstUrl/dstPath` без диска.

Параметры: `srcPath`, `dstPath`, `srcUrl`, `srcToken`, `dstUrl`, `dstToken`.

### SSE

| Метод | Путь | Описание |
|---|---|---|
| `GET` | `/api/events` | `text/event-stream`. События: `ready`, `ping` (15 с), `change` (`{type, path, isFolder}`), `copy-start`, `copy-progress`, `copy-done`, `autostart-changed`. |

### Прокси

| Метод | Путь | Описание |
|---|---|---|
| Любой | `/api/proxy/{base64url(target)}/{path}` | Прозрачная ретрансляция на `target`. Заголовки `Authorization`, `Cookie` **не передаются**. Для авторизации на целевом сервере используется `X-Proxy-Target-Token: <bearer>`. Ответ — как есть, включая SSE. |

### Публичные файлы

| Метод | Путь | Описание |
|---|---|---|
| `GET` | `/api/public/{share}/{path}` | Без авторизации. Только `anonymous: true` + `read` у share. |

### CORS

```
Access-Control-Allow-Origin: <Origin>     (или *)
Access-Control-Allow-Credentials: true
Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS, HEAD
Access-Control-Allow-Headers: Content-Type, Authorization,
                              X-Auth-Token, X-Requested-With
Access-Control-Max-Age: 86400
```

`OPTIONS` обрабатывается автоматически (`204 No Content`).

---

## JavaScript-мост `AndroidBridge`

Доступен как `window.AndroidBridge` **только внутри WebView** приложения
(`MainActivity`). С удалённого клиента — `undefined`, что штатно.

| Метод | Описание |
|---|---|
| `isAndroidApp(): boolean` | `true`, если JS исполняется внутри приложения. |
| `getApps(): string` | JSON-массив `{pkg, activity, label, icon?}` установленных launcher-приложений. |
| `launchApp(pkg, activity): boolean` | Запустить приложение. Дебаунс 800 мс. Три способа (PendingIntent → `activity.startActivity` → `context.startActivity`). |
| `installApk(virtualPath): boolean` | Установить APK из виртуального пути. При отсутствии `REQUEST_INSTALL_PACKAGES` — открывает `ACTION_MANAGE_UNKNOWN_APP_SOURCES` и запоминает путь; повтор при возврате в `MainActivity`. |
| `openInAppBrowser(url[, title]): boolean` | Открыть `BrowserActivity` с заданным URL. |
| `openExternalUrl(url): boolean` | Открыть во внешнем браузере. |
| `openSettings(): boolean` | Системные настройки. |
| `openHomeSettings(): boolean` | Настройки лаунчера (`ACTION_HOME_SETTINGS` → `ACTION_MANAGE_DEFAULT_APPS_SETTINGS` → `ACTION_SETTINGS`). |
| `isDefaultLauncher(): boolean` | Является ли это приложение домашним экраном. |
| `loginRemoteAndSetCookie(url, user, pass): string` | Логин на удалённом FileServer + сохранение `filebd_token` в `CookieManager`. Возвращает JSON `{ok, scheme, port, url, token, tried[]}`. Игнорирует проверку SSL-сертификата. |

> Запуск приложений и установка APK работают **только на самом устройстве**.
> С удалённого клиента эти кнопки покажут тост «только на устройстве».

---

## Автозапуск

Источник истины — `config.json → autostart` (используется и локально,
и для удалённых клиентов).

### Формат

```jsonc
"autostart": {
  "androidApps": [ { "pkg": "...", "act": "...", "label": "..." } ],
  "jsScripts":   [ { "url": "..." } | { "code": "..." } ],
  "wmApps":      [ { "id": "...", "props": {} } ]
}
```

### Логика `FAR.Autostart.run()`

1. Загружает конфиг через `GET /api/autostart`.
2. Выполняет `jsScripts` (`FAR.loadScriptOnce(url)` или `new Function(code)`).
3. Запускает `androidApps` — **только если доступен `AndroidBridge.launchApp`**
   (т.е. на самом устройстве). На удалённом клиенте — no-op.
4. Открывает `wmApps` — только после активации WM и только если нет
   сохранённого состояния окон в `localStorage`.

### Управление из UI

- ПКМ по Android-приложению → «Добавить в автозапуск».
- ПКМ по WM-приложению → «Добавить в автозапуск».
- Настройки автозапуска: `FAR.Autostart.addAndroidApp / addWmApp / addJsScript`
  и соответствующие `remove*`.

### Синхронизация

Изменения через `POST /api/autostart` рассылаются всем SSE-клиентам
событием `autostart-changed`, локальный WebView перечитывает конфиг.

---

## Копирование между серверами

`ServerCopyService` — фоновый пул из 2 потоков. Задачи сохраняются в памяти
(до перезапуска). Каждая задача отдаёт прогресс через SSE `copy-progress`.

- **push:** `PUT <dstUrl>/api/write?path=...` с `Authorization: Bearer <dstToken>`.
- **pull:** `GET <srcUrl>/api/read?path=...` с `Authorization: Bearer <srcToken>`.
- **relay:** одновременно `GET` источник и `PUT` приёмник (pipe).

Прогресс: обновление не чаще 500 мс или каждые 1 МБ.
Отмена: `POST /api/server-copy/cancel?taskId=` (флаг `cancelRequested`,
проверяется в цикле копирования).

---

## HTTPS

1. Положить PKCS#12-хранилище в `/sdcard/FileServerAndroid/certs/server.p12`.
   Например:

   ```bash
   openssl pkcs12 -export -out server.p12 \
       -inkey key.pem -in cert.pem -name fileserver
   ```

2. В `config.json` включить:

   ```jsonc
   "https": {
     "enabled": true,
     "keystore": "/sdcard/FileServerAndroid/certs/server.p12",
     "password": "changeit"
   }
   ```

3. Перезапустить сервис.

Особенности:

- `ProjectInitializer` при первом запуске сам подставляет первый `*.p12`
  из каталога `certs`.
- Используются протоколы TLS 1.3 и 1.2.
- Включаются все поддерживаемые cipher suites.
- **Клиенты** (WebView) настроены игнорировать любые SSL-ошибки —
  самоподписанные сертификаты работают.
- При ошибке загрузки keystore сервер **откатывается на HTTP**
  и пишет причину в logcat.

---

## Веб-интерфейс

Каталог: `/sdcard/FileServerAndroid/www` (копируется из `assets/`).

Основные JS-модули:

| Файл | Назначение |
|---|---|
| `04b-auth-token.js` | Хранение и подстановка токена, `fetch`-обёртка. |
| `05-connection.js` | Подключение к серверу, логин, реконнект. |
| `25-panorama-db-resolver.js` | Панорамы (`Pannellum`). |
| `42-wm-startmenu.js` | Меню «Пуск» WM, категории. |
| `46-wm-explorer.js` | Окно «Проводник», контекстные меню. |
| `60-virtual-gamepad.js` | Виртуальный джойстик для эмуляторов. |
| `61-open-in-tab.js` | «Открыть в новой вкладке» — генерирует HTML-обёртку для файла. |
| `62-touch-adapter.js` | Тач-адаптер: long-press → contextmenu, тач-drag, resize окон. |
| `63-android-apps.js` | Регистрация Android-приложений как WM-приложений, установка APK, настройки. |
| `64-autostart.js` | Автозапуск. |
| `65-change-password.js` | WM-приложение «Смена пароля». |

### Эмуляторы

Поддерживаются через EmulatorJS (`www/lib/js-emulator/`): NES, SNES, GBA,
SEGA MD, PSX. Раскладки клавиш — в `60-virtual-gamepad.js` (`KEYMAPS`,
`LAYOUTS`). DOS — через `js-dos` (`www/lib/js-dos/`).

---

## Структура проекта

```
app/src/main/java/ru/miacomsoft/fileserver/
├── MainActivity.java              — WebView + immersive + retry-логика
├── BrowserActivity.java           — встроенный браузер
├── FileServerService.java         — foreground-сервис
├── FileServerAndroid.java         — жизненный цикл сервера
├── FileServer.java                — статический реестр
├── Config.java                    — парсинг config.json
├── ProjectInitializer.java        — копирование assets → /sdcard
├── AuthService.java               — сессии и права
├── TokenService.java              — токены
├── QuotaService.java              — квоты
├── FileService.java               — операции с файлами (Path)
├── VirtualResolver.java           — виртуальный путь → физический
├── RootHandler.java               — "/" (статика + shares)
├── StaticHandler.java             — статика и Range
├── ApiHandler.java                — /api/*
├── ProxyHandler.java              — /api/proxy/*
├── SseHandler.java                — /api/events
├── SseConnection.java             — одно SSE-соединение
├── ServerCopyService.java         — фоновые копии
├── FileWatcher.java               — WatchService + callback
├── AndroidBridge.java             — @JavascriptInterface
├── WebViewCompatHelper.java       — проверка WebView
├── WebViewFallbackManager.java    — fallback при сбоях WebView
├── SslHelper.java                 — PKCS#12 → SSLContext (BouncyCastle)
├── Json.java                      — мини-сериализатор
├── JsonCommentsStripper.java      — вырезает //, #, /* */
│
└── com/sun/net/httpserver/        — самописная реализация
    ├── HttpServer.java
    ├── HttpsServer.java
    ├── HttpExchange.java
    ├── Headers.java
    ├── HttpContext.java
    ├── HttpHandler.java
    └── HttpsConfigurator.java

app/src/main/assets/
├── config.json                    — шаблон
├── certs/                         — *.p12 (опционально)
└── www/                           — веб-интерфейс
    ├── index.html
    ├── css/
    ├── js/
    │   ├── 04b-auth-token.js
    │   ├── 05-connection.js
    │   ├── 25-panorama-db-resolver.js
    │   ├── 42-wm-startmenu.js
    │   ├── 46-wm-explorer.js
    │   ├── 60-virtual-gamepad.js
    │   ├── 61-open-in-tab.js
    │   ├── 62-touch-adapter.js
    │   ├── 63-android-apps.js
    │   ├── 64-autostart.js
    │   ├── 65-change-password.js
    │   └── custom-startup.js
    └── lib/
        ├── js-emulator/           — EmulatorJS
        ├── js-dos/                — js-dos
        └── Pannellum2_5_6/        — Pannellum
```

---

## Известные ограничения

- **Удалённый клиент не может запускать приложения и ставить APK** —
  для этого нужен `AndroidBridge`, а он есть только внутри WebView на
  самом устройстве. В UI это показывается тостом.
- **Список Android-приложений** доступен удалённо через `GET /api/apps`,
  но только после того, как хотя бы раз был открыт `MainActivity`
  (иначе `sStaticContext == null` и список пуст). После старта
  `FileServerService` контекст устанавливается через
  `AndroidBridge.setContext(...)` в `FileServer.bind()` — это исправлено.
- `console`, `hermes`, `videochat`, `ollama` принудительно отключены
  в `FileServerAndroid.start()` — это десктопные функции.
- `http.port`, `http.host`, `https.*`, `web` **не перезагружаются** на лету.
- Токены хранятся в памяти — после перезапуска сервиса все
  сессии инвалидируются (клиент должен залогиниться заново).
- `ServerCopyService` хранит задачи в памяти — теряются при перезапуске.
- `Config.Share.physicalPath()` возвращает `Path` без проверки
  существования; проверки выполняет `VirtualResolver`.
- Атомарный `Files.move(ATOMIC_MOVE)` на NTFS через FUSE может бросить
  голый `IOException` — `handleWrite` делает fallback на обычный `move`.

---

## Лицензия

Проект `ru.miacomsoft.fileserver`. Условия использования — по договорённости
с автором (miacomsoft). Сторонние библиотеки распространяются под своими
лицензиями:

- **BouncyCastle** — MIT-style (bcprov-jdk18on).
- **EmulatorJS** — GPL-3.0.
- **js-dos** — GPL-2.0.
- **Pannellum** — MIT.
