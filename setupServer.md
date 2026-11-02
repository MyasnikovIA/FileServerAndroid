# Подключение к серверу и настройка доступа

Документ описывает:

1. Как подключиться к серверу (локально, удалённо, через API).
2. Как устроена модель доступа.
3. Как настраивать пользователей.
4. Как настраивать ресурсы (shares) и права.
5. Типовые сценарии и диагностика.

---

## 1. Как подключиться

### 1.1. Адрес сервера

Сервер стартует на `0.0.0.0:8080` (порт и хост на Android **жёстко переопределяются** в `FileServerAndroid.start()`, значения из `config.json → http` игнорируются).

Сразу после запуска `FileServerService` пишет в уведомление:

```
FileServer работает: http://192.168.15.191:8080
```

Этот URL — `<схема>://<ip>:<port>` — виден:

- в уведомлении foreground-сервиса;
- в `MainActivity` (загружается в WebView);
- через `FileServerService.getLastUrl()` (программно).

### 1.2. Локально (на самом устройстве)

Открыть приложение `FileServerAndroid`. Оно:

1. Запускает сервис.
2. Открывает `http://127.0.0.1:8080/` в WebView.
3. Внутри WebView доступен `window.AndroidBridge` (см. `README.md`).

### 1.3. Удалённо (с другого устройства в той же сети)

На ПК / планшете / другом телефоне открыть в браузере:

```
http://192.168.15.191:8080/
```

(IP заменить на тот, что в уведомлении).

Для внешнего доступа — проброс порта 8080 на роутере или VPN (WireGuard / Tailscale).

### 1.4. Через API (curl / fetch)

```bash
# Проверить, что сервер жив
curl http://192.168.15.191:8080/api/whoami
# → {"anonymous":true,"username":null}

# Логин (Basic-аутентификация при первом запросе)
curl -c jar.txt -X POST http://192.168.15.191:8080/api/login \
     -H 'Content-Type: application/json' \
     -d '{"user":"admin","pass":"admin"}'
# → {"ok":true,"token":"<TOKEN>","user":"admin",...}

# Дальше — с cookie
curl -b jar.txt 'http://192.168.15.191:8080/api/list?path='

# Или с Bearer-токеном
curl -H "Authorization: Bearer <TOKEN>" \
     'http://192.168.15.191:8080/api/list?path='
```

### 1.5. Способы передачи учётных данных

`AuthService.authenticate()` проверяет в этом порядке (`мягкий` = если невалидно, пробуем дальше; `строгий` = если указано, но невалидно — сразу 401):

| # | Способ | Пример | Тип |
|---|---|---|---|
| 1 | `Authorization: Bearer` | `curl -H "Authorization: Bearer <TOKEN>"` | мягкий |
| 2 | `X-Auth-Token` | `curl -H "X-Auth-Token: <TOKEN>"` | мягкий |
| 3 | `Authorization: Basic` | `curl -u admin:admin` | мягкий |
| 4 | `Cookie: filebd_token` | ставится `POST /api/login` | мягкий |
| 5 | `?token=` | `?token=<TOKEN>` | **строгий** |
| 6 | `?user=&pass=` | `?user=admin&pass=admin` | **строгий** |
| 7 | аноним | — | — |

Мягкость шагов 1–4 нужна для ситуаций, когда у клиента остался просроченный Bearer-токен, а актуальная сессия — в cookie.

> **`?token=` и `?user=&pass=` используй осторожно:** они попадают в логи сервера и историю браузера. Годятся только для одноразовых ссылок.

### 1.6. Логин через `/api/login`

```
POST /api/login
Content-Type: application/json

{ "user": "admin", "pass": "secret" }
```

Ответ:

```json
{
  "ok": true,
  "token": "Xr7...9f",
  "user": "admin",
  "issuedAt": 1767225600000,
  "expiresAt": 1767312000000,
  "ttlMs": 86400000
}
```

Заголовок ответа:

```
Set-Cookie: filebd_token=<TOKEN>; Path=/; Max-Age=86400; SameSite=Lax
```

Токен живёт **24 часа** или до перезапуска сервиса (хранится в памяти).

Альтернативные форматы тела:

- `username`/`password` вместо `user`/`pass`.
- `application/x-www-form-urlencoded`: `user=admin&pass=secret`.
- Query: `POST /api/login?user=admin&pass=secret` или `GET /api/login?user=admin&pass=secret`.

### 1.7. Logout

```bash
curl -X POST http://<ip>:8080/api/logout \
     -H "Authorization: Bearer <TOKEN>"
```

Токен отзывается, cookie обнуляется (`Max-Age=0`).

---

## 2. Модель доступа

### 2.1. Три уровня

```
Пользователь (Config.User)
    │  username / password / quotaMb
    │
    ├── получает Session (AuthService.Session)
    │
    └── видит Share'ы, у которых username ∈ share.users  (или share.anonymous == true)
            │
            └── операции read / write / delete разрешены полями share.access
```

### 2.2. Анонимный доступ

- **Анонимная сессия** создаётся, когда клиент не прислал валидных учётных данных.
- `share.anonymous = true` → share виден и анонимам (только если `read` в `access`).
- Анонимные сессии **не видят** share с `anonymous = false`, даже если в `users` есть запись.

Логика `Config.Share.visibleTo()`:

```java
public boolean visibleTo(String username, boolean anonymousSession) {
    if (anonymous)           return true;              // share открыт всем
    if (anonymousSession)    return false;             // аноним не видит закрытых
    return username != null && users.contains(username); // только из списка
}
```

### 2.3. Права на операции

| Поле в `access` | Что разрешает | Затрагивает эндпоинты |
|---|---|---|
| `read` | Чтение, листинг | `/api/list`, `/api/read`, `/api/stat`, `GET /` |
| `write` | Создание, изменение | `/api/write`, `/api/mkdir`, `/api/move` (to), `/api/copy` (to) |
| `delete` | Удаление, перемещение (from) | `/api/delete`, `/api/move` (from) |

`move` требует **обе** операции на разных концах: `delete` на источнике + `write` на приёмнике (см. `handleMove`).

### 2.4. Корневой share

Share с `"name": ""` — **корневой**. `VirtualResolver` использует его, когда запрошенный путь не начинается с имени известного share:

```
Запрос: /api/list?path=Documents/report.pdf
        │
        ├─ share "Documents" существует? → нет
        │
        └─ корневой share → physical/Documents/report.pdf
```

Корневой share обычно маппится на `/storage/emulated/0` — так любой путь из внешнего хранилища становится доступен. Это удобно для «общего» доступа, но **опасно**: пользователь с `write`/`delete` в корневом share имеет их на **всём** устройстве. Ограничивай через `users` и `access`.

---

## 3. Настройка пользователей

Файл: `/sdcard/FileServerAndroid/config.json`, массив `users`.

### 3.1. Поля пользователя

```jsonc
{
  "name":     "admin",      // уникальное имя, обязательно
  "password": "secret",     // открытым текстом (см. 3.4)
  "quota":    -1,           // квота в МБ; -1 = без лимита
  "console":  false         // на Android принудительно false
}
```

| Поле | Обязательно | Значение |
|---|---|---|
| `name` | да | Имя. Пустые `name` **игнорируются** при загрузке. |
| `password` | нет | Пустая строка → вход без пароля (только если знаешь имя). |
| `quota` | нет | `-1` или отсутствие = без лимита. Считается по **всем** видимым share'ам. |
| `console` | нет | На Android **принудительно `false`** в `FileServerAndroid.start()`. |

### 3.2. Минимальный пример

```jsonc
"users": [
  { "name": "admin", "password": "сильный-пароль-здесь" }
]
```

После сохранения `config.json` изменения подхватываются **горячо** (опрос раз в 2 секунды) — перезапуск не нужен. Существующие токены **не отзываются** (сессии живут до истечения TTL).

### 3.3. Квоты

- `quotaMb` в пользователе — суммарный размер файлов на всех **видимых** пользователю share'ах.
- `quotaMb` в share — суммарный размер содержимого **этого** share.
- Проверка при записи: `QuotaService.checkWriteQuota()`.
- При превышении: `HTTP 507 Insufficient Storage` с JSON `{error, scope, quotaMb, usedBytes, freeBytes, deltaBytes}`.

Кэш квот — TTL 5 секунд; `invalidate()` сбрасывает при каждой операции.

### 3.4. Про пароли

В текущей реализации пароль хранится **открытым текстом** в `config.json`. Это компромисс:

- `config.json` лежит в `/sdcard/FileServerAndroid/` — доступен любому приложению с `MANAGE_EXTERNAL_STORAGE`.
- Если это критично — используй отдельный `users` только для гостей/публичного доступа, а админку веди через Android UI напрямую.

Смена пароля **через веб**:

```bash
curl -X POST http://<ip>:8080/api/change-password \
     -H "Authorization: Bearer <TOKEN>" \
     -H 'Content-Type: application/json' \
     -d '{"oldPassword":"old","newPassword":"new"}'
```

Пароль в `config.json` перезапишется, `config.save()` сохранит файл.

### 3.5. Смена пароля из UI

WM-приложение **«Смена пароля»** (`65-change-password.js`, `id: password_changer`):

- Открывается из меню Пуск → «Смена пароля».
- Требует активную неанонимную сессию.
- Меняет пароль текущего пользователя.

---

## 4. Настройка ресурсов (shares)

Файл: тот же `config.json`, массив `shares`.

### 4.1. Поля share

```jsonc
{
  "name":      "Files",                              // "" = корневой
  "physical":  "/storage/emulated/0/Documents",
  "type":      "folder",                             // "folder" | "file"
  "access":    ["read", "write", "delete"],
  "anonymous": false,
  "users":     ["admin", "user1"],
  "quota":     -1
}
```

| Поле | Обязательно | Значение |
|---|---|---|
| `name` | да | Имя share. Пустое → корневой share (только один). В URL: `/{name}/...`. |
| `physical` | да | Абсолютный путь. `virtualPath()` нормализует и делает `toAbsolutePath()`. |
| `type` | нет | `"folder"` (по умолчанию) или `"file"` — файл как отдельный ресурс. |
| `access` | нет | Массив из `read`/`write`/`delete`. Пусто → `["read"]`. |
| `anonymous` | нет | `true` → доступен без логина (только на чтение). |
| `users` | нет | Кому виден (кроме `anonymous`). Пусто → **никому**, кроме анонимов через `anonymous`. |
| `quota` | нет | Квота в МБ, `-1` = без лимита. |

### 4.2. Как share появляется в URL

- **Корень:** `/api/list?path=` — листинг виртуального корня (список share'ов).
- **Share:** `/api/list?path=Files` — содержимое share `Files`.
- **Внутри share:** `/api/list?path=Files/2024/report.pdf`.
- **Прямая ссылка:** `/Files/2024/report.pdf` — если не перехвачено статикой, уйдёт в `RootHandler.serveFromShare()`.

### 4.3. Пример: личное хранилище

```jsonc
"users": [
  { "name": "alice", "password": "alice-pass" },
  { "name": "bob",   "password": "bob-pass" }
],
"shares": [
  {
    "name": "alice",
    "physical": "/storage/emulated/0/Users/alice",
    "type": "folder",
    "access": ["read", "write", "delete"],
    "users": ["alice"]
  },
  {
    "name": "bob",
    "physical": "/storage/emulated/0/Users/bob",
    "type": "folder",
    "access": ["read", "write", "delete"],
    "users": ["bob"]
  }
]
```

`alice` видит только `alice`, `bob` — только `bob`. Анонимы не видят ничего.

### 4.4. Пример: публичная папка (read-only)

```jsonc
"shares": [
  {
    "name": "Public",
    "physical": "/storage/emulated/0/Public",
    "type": "folder",
    "access": ["read"],
    "anonymous": true,
    "users": []
  }
]
```

Доступно всем без логина через `/api/public/Public/...` **или** `GET /Public/...` (если анонимная сессия).

> Прямой `/api/public/{share}/{path}` работает **только** для `anonymous: true` + `read`, и не создаёт сессию — удобно для `<img src="...">` и скачивания без токена.

### 4.5. Пример: общая папка для команды

```jsonc
"users": [
  { "name": "admin", "password": "..." },
  { "name": "editor", "password": "..." },
  { "name": "viewer", "password": "..." }
],
"shares": [
  {
    "name": "Team",
    "physical": "/storage/emulated/0/Team",
    "type": "folder",
    "access": ["read", "write", "delete"],
    "users": ["admin", "editor"]
  },
  {
    "name": "Docs",
    "physical": "/storage/emulated/0/Team/docs",
    "type": "folder",
    "access": ["read"],
    "users": ["admin", "editor", "viewer"]
  }
]
```

- `admin`, `editor` — полный доступ к `Team`.
- `viewer` — только чтение `Docs`.
- `viewer` **не видит** `Team` (его нет в `users`), но может читать `Docs` по прямому пути.

### 4.6. Пример: один файл как ресурс

```jsonc
{
  "name": "release.apk",
  "physical": "/storage/emulated/0/Download/FileServerAndroid.apk",
  "type": "file",
  "access": ["read"],
  "anonymous": true
}
```

- `GET /api/read?path=release.apk` → файл.
- `GET /api/public/release.apk` → файл без авторизации.
- `GET /api/list?path=release.apk` → пустой массив (у файла нет детей).
- Запись в этот share запрещена (`Cannot write into a file share`).

### 4.7. Пример: корневой share

```jsonc
{
  "name": "",
  "physical": "/storage/emulated/0",
  "type": "folder",
  "access": ["read"],
  "users": ["admin"],
  "anonymous": false
}
```

- Любой запрос, чей первый сегмент не совпадает с именем другого share, идёт сюда.
- `path=Documents/2024/report.pdf` → `/storage/emulated/0/Documents/2024/report.pdf`.
- Только `admin`, только чтение.

Используй корневой share **осознанно**: он даёт «обзор» всего хранилища, но `write`/`delete` на нём = права на всё.

### 4.8. Перезагрузка конфига

Изменения `shares` и `users` подхватываются **горячо** (опрос раз в 2 секунды, `reloadConfig()`):

- `auth` и `quota` пересоздаются;
- `FileServer.bind()` перерегистрирует `auth`, `quota`, `android.context`;
- `FileWatcher` перезапускается (следит за первым folder-share'ом).

**Не перезагружаются** на лету: `http.port`, `http.host`, `https.*`, `web`. Для них — полный перезапуск сервиса.

> Изменения, внесённые через API (`POST /api/autostart`), сохраняются с подавлением hot-reload на 3 секунды (`noteInternalConfigSave()`), чтобы `reloadConfig()` не пересоздавал `auth`/`quota` при каждом сохранении автозапуска.

---

## 5. Типовые сценарии

### 5.1. «Только я, только чтение»

```jsonc
"users": [
  { "name": "me", "password": "<сильный>" }
],
"shares": [
  {
    "name": "Files",
    "physical": "/storage/emulated/0",
    "access": ["read"],
    "users": ["me"]
  }
]
```

### 5.2. «Семейный обменник»

```jsonc
"users": [
  { "name": "dad",  "password": "..." },
  { "name": "mom",  "password": "..." },
  { "name": "kid",  "password": "...", "quota": 500 }
],
"shares": [
  {
    "name": "Family",
    "physical": "/storage/emulated/0/Family",
    "access": ["read", "write", "delete"],
    "users": ["dad", "mom", "kid"]
  },
  {
    "name": "Public",
    "physical": "/storage/emulated/0/Public",
    "access": ["read"],
    "anonymous": true
  }
]
```

`kid` ограничен 500 МБ суммарно.

### 5.3. «Только для скачивания APK»

```jsonc
"shares": [
  {
    "name": "dist",
    "physical": "/storage/emulated/0/Dist",
    "type": "folder",
    "access": ["read"],
    "anonymous": true
  }
]
```

Раздавай ссылки вида `http://<ip>:8080/api/public/dist/app-release.apk` — клиенты скачают без логина.

### 5.4. «Две панели FAR с разными правами»

```jsonc
"shares": [
  {
    "name": "Work",
    "physical": "/storage/emulated/0/Work",
    "access": ["read", "write", "delete"],
    "users": ["admin"]
  },
  {
    "name": "Backup",
    "physical": "/storage/emulated/0/Backup",
    "access": ["read", "write"],
    "users": ["admin"]
  }
]
```

`Backup` — только запись (нельзя случайно удалить).

---

## 6. Проверка и диагностика

### 6.1. Кто я сейчас

```bash
curl -s http://<ip>:8080/api/whoami
# {"anonymous":true,"username":null}                 — не залогинен
# {"anonymous":false,"username":"admin","quotaMb":-1,"console":false} — залогинен
```

### 6.2. Что видно

```bash
curl -s -b jar.txt http://<ip>:8080/api/info | jq
```

Ответ `shares[]` — **только видимые** текущей сессии:

```json
{
  "shares": [
    { "name": "Family", "type": "folder",
      "access": ["read","write","delete"],
      "quotaMb": -1, "usedBytes": 0, "root": false }
  ]
}
```

Если share не появился — проверь:

- `users` содержит твоё имя (или `anonymous: true`);
- `access` содержит `read`;
- `physical` существует (`adb shell ls <path>`).

### 6.3. Что внутри

```bash
curl -s -b jar.txt 'http://<ip>:8080/api/list?path=Family'
```

Ошибки:

| Ответ | Что значит |
|---|---|
| `403 Access denied to share ...` | Тебя нет в `users`, или `read` не включён |
| `404 Unknown share ...` | Такого share нет в `config.json` |
| `404 Share '...' is not available: ...` | `physical` не существует (SD вынута) |
| `401 Unauthorized` | Ты не залогинен, а share требует логин |

### 6.4. Квоты

```bash
curl -s -b jar.txt http://<ip>:8080/api/whoami | jq '.quotaMb, .userUsedBytes'
```

Ответ `507` при записи:

```json
{
  "error": "Quota exceeded",
  "scope": "alice",         // имя share или пользователя
  "quotaMb": 500,
  "usedBytes": 524000000,
  "freeBytes": 4000000,
  "deltaBytes": 5000000,
  "status": 507
}
```

### 6.5. Логи

```bash
adb logcat -s FileServerAndroid FileServerService ApiHandler AuthService
```

Ищи:

- `reloadConfig OK: shares=N (was M), users=K (was L)` — конфиг перечитан.
- `Auto-mounted share: ...` — подключён USB/SD.
- `Remount share '...': <old> -> <new>` — путь перемонтирован.
- `getInstalledApps: N apps in Xms`.

### 6.6. Если «не видно» share

Проверь по шагам:

1. `config.json` валиден? `curl /api/info` вернул 200 (не 500) — да.
2. `users` содержит твой логин? `curl /api/whoami` → `username` совпадает.
3. `access` содержит `read`?
4. `physical` существует? `adb shell ls -la <path>`.
5. Share — не корневой с пустым именем? Тогда он **не появится** отдельным пунктом в `/api/list?path=` — только через `path=<...>` напрямую (см. 4.7).

---

## 7. Безопасность

Кратко:

1. **Не делай `anonymous: true` на корневом share** — он отдаст всё хранилище.
2. **`write` на корневом share = право менять всё** — ограничь `users` до одного.
3. **`delete` через `move`:** `move` срабатывает от имени того, кто вызвал, — проверяй, что у пользователя есть `delete` на источнике, а не только `write` на приёмнике (это уже делает `handleMove`).
4. **Пароли — открытым текстом** в `config.json`. Смени дефолтный `admin/admin` сразу.
5. **`?user=&pass=` в URL** — попадает в логи браузера и сервера. Только для одноразовых скриптов.
6. **Проброс порта наружу** — используй HTTPS (см. отдельную инструкцию), длинные пароли и, по возможности, VPN вместо `8080` наружу.
7. **Токен TTL = 24 часа**, хранится в памяти → перезапуск сервиса инвалидирует все сессии. Это фича, а не баг.

---

## TL;DR

**Подключиться:**

```
http://<ip>:8080/          — в браузере
POST /api/login {user,pass} — API
```

**Добавить пользователя** (`config.json`):

```jsonc
"users": [ { "name": "alice", "password": "secret", "quota": 500 } ]
```

**Дать доступ к папке:**

```jsonc
"shares": [ {
  "name": "Alice",
  "physical": "/storage/emulated/0/Users/alice",
  "access": ["read", "write", "delete"],
  "users": ["alice"]
} ]
```

**Проверить:**

```bash
curl -b jar.txt http://<ip>:8080/api/whoami
curl -b jar.txt 'http://<ip>:8080/api/list?path=Alice'
```

Изменения подхватываются автоматически через ~2 секунды. Перезапуск нужен только при смене порта/HTTPS/`web`.


## 7. Горячая перезагрузка настроек

Большинство изменений `config.json` подхватываются **на лету** — перезапускать сервис не нужно.

### 7.1. Что перезагружается горячо

| Что | Как | Задержка |
|---|---|---|
| `users[]` | `reloadConfig()` пересоздаёт `AuthService`, `QuotaService` | ~2 сек |
| `shares[]` | то же + `FileServer.bind()` перерегистрирует `rootHandler`, `quota`, `android.context` | ~2 сек |
| `autostart.*` | `Config.load()` в `reloadConfig()` | ~2 сек |
| кэш квот | `QuotaService.invalidateAll()` после `reloadConfig()` | мгновенно |
| `FileWatcher` | перезапускается (следит за первым folder-share'ом) | ~2 сек |
| подмонтирование USB/SD | по broadcast `ACTION_MEDIA_*` → `rescanAndRemountShares()` | ~1.5 сек |
| файлы на диске | `WatchService` → SSE-событие `change` | мгновенно |

### 7.2. Как это работает

`FileServerAndroid.startConfigWatcher()` запускает фоновый поток (`ConfigWatcher`), который раз в **2 секунды** (`CONFIG_POLL_MS = 2000L`) проверяет `lastModifiedTime` файла `config.json`:

```
while (!interrupted) {
sleep(2000);
mtime = Files.getLastModifiedTime(configTemp);
if (mtime <= lastConfigMtime) continue;
sleep(300);                       // ждём завершения записи
mtime = Files.getLastModifiedTime(configTemp);
lastConfigMtime = mtime;
if (System.currentTimeMillis() < suppressConfigReloadUntil) continue;
reloadConfig();                   // ← перечитываем
}
```

`reloadConfig()` вызывает `Config.load()` в новую переменную; если `Config.load()` бросит исключение (битый JSON, ошибка чтения) — **старый конфиг сохраняется**, сервер продолжает работать как раньше. Затем `auth`, `quota` и `FileServer.bind()` пересоздаются, `FileWatcher` перезапускается.

### 7.3. Что НЕ перезагружается на лету

Только параметры, затрагивающие уже открытый сокет или загрузку SSLContext:

| Поле | Почему |
|---|---|
| `http.port` | сокет уже забинден |
| `http.host` | то же |
| `https.enabled` | SSLContext создаётся один раз в `start()` |
| `https.keystore` / `https.password` / `https.cert` / `https.key` | то же |
| `web` | `StaticHandler` создан с `webRoot` |

Если ты меняешь что-то из этого списка, `reloadConfig()` **явно копирует старые значения** обратно в новую конфигурацию и пишет в `logcat` предупреждение, например:

```
reloadConfig: http.port change (8080 → 9090) requires full restart — keeping 8080
```

Сервер продолжает работать с прежними значениями. Чтобы применить — останови сервис и запусти заново:

```bash
adb shell am force-stop ru.miacomsoft.fileserver
adb shell am start -n ru.miacomsoft.fileserver/.MainActivity
```

### 7.4. Подавление перезагрузки при внутренних сохранениях

Когда сам сервер записывает `config.json` (`POST /api/autostart`, `POST /api/change-password`, `rescanAndRemountShares()`), он вызывает `noteInternalConfigSave()`:

```java
private void noteInternalConfigSave() {
    suppressConfigReloadUntil = System.currentTimeMillis() + 3000L;
    lastConfigMtime = Files.getLastModifiedTime(configTemp).toMillis();
}
```

Три секунды после внутреннего сохранения watcher игнорирует изменения файла. Иначе `reloadConfig()` пересоздавал бы `auth` и `quota` на **каждое** сохранение автозапуска, сбрасывая кэш и инвалидируя внутренние ссылки.

Практическое следствие: если ты сохранил пароль через `POST /api/change-password`, `config.json` обновится мгновенно, но `AuthService` пересоздастся (и подхватит новый пароль) только через ~3 секунды, если не сработал `noteInternalConfigSave()`. Обычно этого достаточно, потому что `changePassword` меняет пароль **уже аутентифицированного** пользователя — новый пароль применяется при следующем логине.

### 7.5. Что НЕ теряется

- **Активные сессии.** Токены хранятся в `TokenService` (в памяти), не в `config.json`. `reloadConfig()` **не отзывает** токены. Удаление пользователя из `users[]` делает его токен недействительным (сессия перестаёт находить `Config.User`), но сам токен висит в `TokenService` до истечения TTL. Перезапуск сервиса — инвалидирует **все** сессии.
- **Активные задачи `ServerCopyService`.** Они держат ссылку на `AuthService.Session` через `reResolveSession()`, поэтому пересоздание `auth` не влияет на уже запущенные копии. Пользователь, удалённый из `users[]`, получит `SecurityException` в момент следующего `runTask()`.
- **SSE-клиенты.** `FileServer.sseClients` не трогается. Соединения продолжают жить; после `reloadConfig()` они не получают никакого специального события (кроме `ping` каждые 15 секунд).

### 7.6. Как посмотреть, что перезагрузилось

```bash
adb logcat -s FileServerAndroid
```

После сохранения `config.json`:

```
ConfigWatcher: mtime changed → reload
reloadConfig: config changed, reloading...
reloadConfig OK: shares=3 (was 2), users=2 (was 1)
```

Если изменений не было — строк не будет. Если `Config.load()` упал:

```
reloadConfig: Config.load failed, keeping old config
```

— и старая конфигурация продолжает работать.

### 7.7. Как форсировать перезагрузку

Если подозреваешь, что watcher не сработал (например, ФС не отдаёт `mtime` для `/sdcard` — такое бывает на некоторых прошивках):

```bash
# «Прикоснуться» к файлу — mtime изменится, watcher проснётся
adb shell 'echo "" >> /sdcard/FileServerAndroid/config.json'  # ⚠️ сломает JSON!
```

**Не делай так.** Правильнее — перезапустить сервис:

```bash
adb shell am force-stop ru.miacomsoft.fileserver
adb shell am start -n ru.miacomsoft.fileserver/.MainActivity
```

Или через UI: уведомление foreground-сервиса → **«Остановить»**, затем снова открыть приложение.

> Если `mtime` действительно не обновляется на твоём устройстве, `ConfigWatcher` можно отключить и перезагружать конфиг вручную через `adb shell am force-stop` — других путей в текущей версии нет.

---

## 8. Безопасность

Кратко:

1. **Не делай `anonymous: true` на корневом share** — он отдаст всё хранилище.
2. **`write` на корневом share = право менять всё** — ограничь `users` до одного.
3. **`delete` через `move`:** `move` срабатывает от имени того, кто вызвал, — проверяй, что у пользователя есть `delete` на источнике, а не только `write` на приёмнике (это уже делает `handleMove`).
4. **Пароли — открытым текстом** в `config.json`. Смени дефолтный `admin/admin` сразу.
5. **`?user=&pass=` в URL** — попадает в логи браузера и сервера. Только для одноразовых скриптов.
6. **Проброс порта наружу** — используй HTTPS (см. отдельную инструкцию), длинные пароли и, по возможности, VPN вместо `8080` наружу.
7. **Токен TTL = 24 часа**, хранится в памяти → перезапуск сервиса инвалидирует все сессии. Это фича, а не баг.
8. **Горячая перезагрузка `users[]`** применяется без перезапуска — если ты случайно удалил пользователя из `config.json` и сохранил, его сессия инвалидируется через ~2 секунды. Отменить это можно, только вернув запись обратно (тоже горячо).

---

## TL;DR

**Подключиться:**

```
http://<ip>:8080/           — в браузере
POST /api/login {user,pass} — API
```

**Добавить пользователя** (`config.json`):

```jsonc
"users": [ { "name": "alice", "password": "secret", "quota": 500 } ]
```

**Дать доступ к папке:**

```jsonc
"shares": [ {
  "name": "Alice",
  "physical": "/storage/emulated/0/Users/alice",
  "access": ["read", "write", "delete"],
  "users": ["alice"]
} ]
```

**Проверить:**

```bash
curl -b jar.txt http://<ip>:8080/api/whoami
curl -b jar.txt 'http://<ip>:8080/api/list?path=Alice'
```

**Горячая перезагрузка:**

- `users[]`, `shares[]`, `autostart.*` — **автоматически, ~2 секунды** после сохранения `config.json`.
- Смена `http.port`, `http.host`, `https.*`, `web` — **только перезапуском сервиса** (`am force-stop` + `am start`).
- Сессии и задачи копирования при горячей перезагрузке **не прерываются**.
- После внутренних сохранений (`POST /api/autostart`, `POST /api/change-password`) — пауза 3 секунды (`noteInternalConfigSave()`), чтобы watcher не пересоздавал `auth`/`quota` зря.

