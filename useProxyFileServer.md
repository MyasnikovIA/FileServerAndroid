# Механизм проксирования запросов (`ProxyHandler`)

## 1. Назначение

`ProxyHandler` — прозрачный **прямой HTTP-прокси**, встроенный в `FileServerAndroid`. Он позволяет клиенту, подключённому к этому серверу, отправлять запросы на **другие** HTTP-серверы через этот сервер, не раскрывая своих учётных данных целевого сервера.

Типичный сценарий: приложение (WebView или удалённый браузер) подключено к **локальному** `FileServerAndroid` (`http://127.0.0.1:8080`), а с его помощью обращается к **удалённому** `FileServerAndroid` (`http://192.168.15.191:8080`), который может быть недоступен напрямую (NAT, firewall, CORS, mixed-content).

```
Клиент ─── http://proxy:8080/api/proxy/<b64(http://target:8080)>/api/list
               │
               ▼
        ProxyHandler (на proxy:8080)
               │  расшифровывает target, подставляет target-токен
               ▼
         http://target:8080/api/list
               │
               ▼
        Прокси возвращает ответ как есть
```

Отличие от прямого `fetch`:

| | Напрямую | Через прокси |
|---|---|---|
| CORS | нужен `Access-Control-Allow-Origin` от target | не нужен — браузер общается только с proxy |
| Mixed content | блокируется, если proxy https, а target http | не блокируется — target опрашивает сервер |
| Учётные данные target | видны клиенту | видны только серверу-прокси, клиент передаёт отдельный токен |
| Cookie target | автоматически прикладываются браузером | намеренно **не** передаются |

---

## 2. Маршрут и формат URL

Регистрация в `FileServerAndroid.start()`:

```java
srv.createContext("/api/proxy", ex -> ProxyHandler.handle(ex));
```

Формат запроса:

```
/api/proxy/{base64url(target_base)}/{target_path}?{rawQuery}
```

- **`target_base`** — URL-безопасный Base64 (`Base64.getUrlEncoder().withoutPadding()`) от строки `http(s)://host:port` без завершающих `/`.
- **`target_path`** — путь на целевом сервере (начинается с `/`). Может быть пустым.
- **`rawQuery`** — передаётся **без декодирования** (`getRawQuery()`), чтобы `%26` в именах файлов не превратился в `&` и не разрезал query.

Разбор (`ProxyHandler.handle`):

```java
String after = path.substring("/api/proxy/".length());
int slash = after.indexOf('/');
String b64Target  = (slash < 0) ? after : after.substring(0, slash);
String targetPath = (slash < 0) ? "/"     : after.substring(slash);   // включает ведущий '/'
```

Декодирование с «мягкой» достройкой padding (Base64url без `=`):

```java
int mod = b64Target.length() % 4;
if (mod == 2) padded += "==";
else if (mod == 3) padded += "=";
targetBase = new String(Base64.getUrlDecoder().decode(padded), UTF_8);
```

Валидация: `targetBase` обязан начинаться с `http://` или `https://`. Иначе `400`.

**Пример:**

```
GET /api/proxy/aHR0cDovLzE5Mi4xNjguMTUuMTkxOjgwODA/api/list?path=Family
                                         ▲
                                         └ base64url("http://192.168.15.191:8080")
```

→ Прокси сделает `GET http://192.168.15.191:8080/api/list?path=Family`.

---

## 3. Двухуровневая аутентификация

Ключевая особенность: у прокси **два независимых слоя auth**.

### 3.1. Слой 1 — аутентификация на самом прокси

```java
AuthService.Session session = FileServer.auth().authenticate(ex);
if (session == null) {
    ex.getResponseHeaders().set("WWW-Authenticate", "Basic realm=\"FileServer\"");
    FileServer.sendError(ex, 401, "Unauthorized");
    return;
}
```

Проверяются все стандартные механизмы: `Bearer`, `X-Auth-Token`, `Basic`, `Cookie`, `?token=`, `?user=&pass=`. То есть клиент должен быть аутентифицирован **на этом** `FileServerAndroid`.

### 3.2. Слой 2 — токен для целевого сервера

Заголовок **`X-Proxy-Target-Token`** содержит Bearer-токен **удалённого** сервера. Прокси:

1. **Не передаёт** его как есть (он в `SKIP_REQUEST_HEADERS`).
2. Читает отдельно и **преобразует** в `Authorization: Bearer <token>` для target:

```java
String targetToken = ex.getRequestHeaders().getFirst("X-Proxy-Target-Token");
if (targetToken != null && !targetToken.isEmpty()) {
    conn.setRequestProperty("Authorization", "Bearer " + targetToken);
}
```

### 3.3. Почему так

- **`Authorization` и `Cookie` прокси-сервера не утекают на target** (они в skip-list).
- **`Authorization` и `Set-Cookie` target не попадают к клиенту** (тоже в skip-list).
- Клиент явно управляет сессией target через `X-Proxy-Target-Token` — это делает поведение **stateless**: прокси ничего не кэширует и не поддерживает «сессию с target».
- Даже если клиент анонимен на target, он всё равно проходит слой 1 — прокси не превращается в открытый релей.

В JS-клиенте это реализовано в `65-change-password.js`, `04b-auth-token.js` и т.п.:

```javascript
const headers = { 'Content-Type': 'application/json' };
if (ctx.db.isProxy) headers['X-Proxy-Target-Token'] = ctx.db.token;
else                headers['Authorization']        = 'Bearer ' + ctx.db.token;
```

---

## 4. Обработка запроса (`forward`)

### 4.1. Соединение с target

```java
HttpURLConnection conn = (HttpURLConnection) url.openConnection();
conn.setRequestMethod(method);          // GET / POST / PUT / DELETE / HEAD / ...
conn.setConnectTimeout(10_000);         // CONNECT_TIMEOUT
conn.setReadTimeout(60_000);            // READ_TIMEOUT
conn.setInstanceFollowRedirects(false); // redirect — клиенту, не следуем
conn.setDoInput(true);
```

**Редиректы не разворачиваются** — 3xx возвращается клиенту как есть (см. п.6).

### 4.2. Копирование заголовков запроса

Все заголовки, кроме skip-list, копируются **как есть** (`addRequestProperty`, сохраняя множественные значения):

```java
for (Map.Entry<String, List<String>> entry : ex.getRequestHeaders().entrySet()) {
    String lower = entry.getKey().toLowerCase();
    if (SKIP_REQUEST_HEADERS.contains(lower)) continue;
    for (String v : entry.getValue()) conn.addRequestProperty(entry.getKey(), v);
}
```

**`SKIP_REQUEST_HEADERS`:**

| Заголовок | Причина удаления |
|---|---|
| `host` | target сам подставит свой `Host:` |
| `connection` | hop-by-hop (RFC 7230 §6.1) |
| `content-length` | пересчитывается из тела (см. 4.3) |
| `transfer-encoding` | hop-by-hop, `HttpURLConnection` сам управится |
| `upgrade` | не поддерживаем WebSocket/HTTP/2 upgrade |
| `keep-alive` | hop-by-hop |
| `proxy-connection` | устаревший hop-by-hop |
| `proxy-authorization` | принадлежит прокси, не target |
| `cookie` | сессия **прокси**, не target |
| `authorization` | сессия **прокси**, не target |
| `x-proxy-target-token` | **не** уходит в target как есть, конвертируется в `Authorization` (п.3.2) |

### 4.3. Тело запроса

Только для `POST`, `PUT`, `PATCH`:

```java
boolean hasBody = "POST".equals(method) || "PUT".equals(method) || "PATCH".equals(method);
if (hasBody) {
    conn.setDoOutput(true);
    long contentLength = parseFromHeader("Content-Length");  // может быть -1
    if (contentLength >= 0) conn.setFixedLengthStreamingMode(contentLength);
    else                    conn.setChunkedStreamingMode(16384);
    try (InputStream in  = ex.getRequestBody();
         OutputStream out = conn.getOutputStream()) {
        byte[] buf = new byte[16384];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
    }
}
```

- **Есть `Content-Length`** → фиксированный режим, target получает точное тело без буферизации.
- **Нет** → chunked, размер буфера 16 КБ.
- **Никакой буферизации** — тело стримится напрямую, поэтому 2 ГБ тоже проходят (в отличие от `handleWrite`, где лимит `MAX_WRITE_SIZE`).

---

## 5. Обработка ответа

### 5.1. Чтение статуса и потока

```java
int status = conn.getResponseCode();
InputStream responseStream = (status >= 400) ? conn.getErrorStream() : conn.getInputStream();
if (responseStream == null) {              // 204, 304, HEAD
    ex.sendResponseHeaders(status, -1);
    ex.close();
    conn.disconnect();
    return;
}
```

- `4xx/5xx` идут через `getErrorStream()` — стандартное поведение `HttpURLConnection`.
- Пустой поток (204/304) → `-1`, тело не отправляется.

### 5.2. Копирование заголовков ответа

```java
for (Map.Entry<String, List<String>> entry : conn.getHeaderFields().entrySet()) {
    String lower = entry.getKey().toLowerCase();
    if (lower.equals("content-length")) { responseLength = ...; continue; }
    if (lower.equals("content-type"))   { contentType    = ...; }
    if (SKIP_RESPONSE_HEADERS.contains(lower)) continue;
    for (String v : entry.getValue()) ex.getResponseHeaders().add(key, v);
}
```

**`SKIP_RESPONSE_HEADERS`:**

| Заголовок | Причина удаления |
|---|---|
| `transfer-encoding` | `HttpExchange` сам выставит `Content-Length` или `Transfer-Encoding` |
| `connection` | hop-by-hop |
| `content-length` | обрабатывается отдельно (см. 5.3) |
| `keep-alive` | hop-by-hop |
| `upgrade` | не поддерживаем |
| `set-cookie` | **намеренно**: не даём target-серверу перезаписать `filebd_token` прокси |
| `content-encoding` | тело передаётся как есть (без декодирования); `Accept-Encoding` тоже не уходит в target, значит ответ должен быть uncompressed |

`Content-Type` и `Content-Length` сохраняются в переменные для последующей логики. `Content-Length` **не копируется напрямую** — иначе `HttpExchange.sendResponseHeaders` выставит его повторно и получится дубль.

### 5.3. Четыре режима передачи тела

Выбор режима — по `method`, `contentType` и `responseLength`:

```java
boolean isSSE = contentType != null && contentType.contains("text/event-stream");
```

#### (a) `HEAD`

```java
if ("HEAD".equals(method)) {
    ex.getResponseHeaders().set("Content-Length", String.valueOf(responseLength >= 0 ? responseLength : 0));
    ex.sendResponseHeaders(status, -1);
    ex.close();
    responseStream.close();
    conn.disconnect();
    return;
}
```

`Content-Length` выставляется вручную, тело не отправляется (`-1`).

#### (b) SSE — Server-Sent Events

```java
if (isSSE) {
    ex.sendResponseHeaders(status, 0);        // chunked
    try (OutputStream out = ex.getResponseBody()) {
        byte[] buf = new byte[4096];
        int n;
        while ((n = responseStream.read(buf)) > 0) {
            out.write(buf, 0, n);
            out.flush();                     // ← критично: каждое событие сразу клиенту
        }
    }
}
```

- `sendResponseHeaders(status, 0)` → chunked (потому что длина неизвестна).
- `flush()` после каждого `read` — иначе события «залипнут» в буфере, и SSE-клиент (EventSource) их не увидит.
- Буфер 4 КБ — SSE-сообщения маленькие, больший не нужен.
- **Таймаут:** `READ_TIMEOUT = 60_000` — если SSE-сервер молчит 60 секунд, `read()` бросит `SocketTimeoutException`, и соединение закроется. Клиенту нужно переподключаться самому (EventSource это умеет).

#### (c) Известная длина

```java
if (responseLength >= 0) {
    ex.sendResponseHeaders(status, responseLength);
    try (OutputStream out = ex.getResponseBody()) {
        byte[] buf = new byte[16384];
        long remaining = responseLength;
        int n;
        while (remaining > 0 && (n = responseStream.read(buf, 0, (int) Math.min(buf.length, remaining))) > 0) {
            out.write(buf, 0, n);
            remaining -= n;
        }
    }
}
```

- `HttpExchange.sendResponseHeaders(status, responseLength)` → `Content-Length: N` в ответе.
- Чтение **ровно** `N` байт — если target закроет соединение раньше, клиент получит `IOException` на чтении из `ex.getResponseBody()`.
- Буфер 16 КБ.

#### (d) Неизвестная длина

```java
else {
    ex.sendResponseHeaders(status, 0);        // chunked
    try (OutputStream out = ex.getResponseBody()) {
        byte[] buf = new byte[16384];
        int n;
        while ((n = responseStream.read(buf)) > 0) out.write(buf, 0, n);
    }
}
```

- `sendResponseHeaders(status, 0)` → `Transfer-Encoding: chunked` (см. `HttpExchange.sendResponseHeaders`, ветка `length == 0`).
- Без `flush()` — для больших бинарных потоков flush каждого блока только замедляет.

### 5.4. Очистка

`finally`:

```java
try { responseStream.close(); } catch (IOException ignored) {}
conn.disconnect();
```

`conn.disconnect()` освобождает сокет; `HttpURLConnection` не поддерживает пул на Android, поэтому важно закрывать явно.

---

## 6. Редиректы

`setInstanceFollowRedirects(false)` — прокси **не следует** редиректам сам. Причина: `HttpURLConnection` при автоматическом follow:

- теряет заголовки (в т.ч. `X-Proxy-Target-Token` конвертированный в `Authorization`);
- меняет метод на `GET` для 301/302/303;
- «съедает» `Location` и `Set-Cookie`, которые клиенту может быть важно увидеть.

Поэтому клиент получает `3xx` и `Location: /...` как есть. JS-клиент (fetch) сам решает, идти ли по `Location` (и, если идёт — снова через прокси).

**Исключение:** сам `fetch` в браузере по умолчанию **не** идёт по редиректу через CORS-запросы (`redirect: 'follow'` работает только для same-origin). Значит, если target отдаёт `302`, клиент увидит `opaqueredirect` — и это осознанный компромисс, а не баг.

---

## 7. Ошибки

Прокси различает три класса ошибок.

### 7.1. Ошибки до `forward()`

| Условие | Ответ |
|---|---|
| Не `GET/POST/...` (OPTIONS отсекается раньше, в `handleOptions`) | обрабатывается методом |
| Нет auth на прокси | `401` |
| Путь не начинается с `/api/proxy/` | `400 Invalid proxy path` |
| Пустой `b64Target` | `400 Missing target in proxy URL` |
| Невалидный Base64 | `400 Invalid base64 target: ...` |
| Target не `http(s)://` | `400 Target must be http(s): ...` |

### 7.2. Ошибки `forward()`

`forward()` пробрасывает `IOException`. Если target недоступен:

```java
catch (IOException io) {
    throw new IOException("Target unreachable: " + io.getMessage(), io);
}
```

`handle()` ловит и отдаёт `502`:

```java
catch (Exception e) {
    System.err.println("[Proxy] ERROR " + method + " " + targetUrl + ": " + e.getMessage());
    try {
        FileServer.sendError(ex, 502, "Proxy error: " + e.getMessage());
    } catch (IOException ignored) {}
}
```

Типовые случаи `502`:

- `Connection refused` — target не запущен / порт закрыт.
- `No route to host` — сеть недоступна.
- `UnknownHostException` — DNS.
- `SSLHandshakeException` — самоподписанный сертификат target (прокси использует **стандартный** `HttpsURLConnection`, а не «игнорирующий» `TrustManager`, как в `AndroidBridge.loginRemoteAndSetCookie`).
- `SocketTimeoutException` — 10 с connect / 60 с read.

### 7.3. Ошибки в `handle()` до/после `forward()`

`FileServer.handleOptions(ex)` в начале — `OPTIONS` отдаётся `204` с CORS-заголовками, до всякой аутентификации.

---

## 8. Ограничения (важно знать)

1. **WebSocket не поддерживается.** `Upgrade` и `Connection` вырезаются, `HttpURLConnection` не умеет `Upgrade`. Если нужно релеить WS — только через отдельный канал (у `FileServerAndroid` есть встроенный WS для videochat, но он не через `/api/proxy`).
2. **HTTP/2 не поддерживается.** `HttpURLConnection` на Android по умолчанию HTTP/1.1; при target за nginx/h2 клиент получит обычный ответ (nginx downgrade’ит).
3. **HTTPS к self-signed target — fail.** Прокси не переопределяет `TrustManager`/`HostnameVerifier`. Если target — `https://192.168.x.x:8443` с самоподписанным сертификатом, `forward()` бросит `SSLHandshakeException` → `502`. (Для сравнения: `AndroidBridge.loginRemoteAndSetCookie` **игнорирует** сертификат, потому что это логин-хелпер, а не прокси.)
4. **Cookie target не сохраняются.** `Set-Cookie` вырезается, `Cookie` запроса тоже не прикладывается автоматически. `X-Proxy-Target-Token` — единственный способ аутентификации на target.
5. **Тело запроса не модифицируется.** Прокси не трогает JSON, не переписывает пути, не добавляет `?token=`.
6. **Нет кэша.** Каждый запрос — новое TCP-соединение к target. Для десятков мелких запросов (листинг + иконки) это ощутимо; выигрыш — только в изоляции credentials.
7. **Нет ограничения размера тела.** Стрим идёт без лимита — при желании клиент закачает 100 ГБ. (В отличие от `handleWrite` с `MAX_WRITE_SIZE = 2 ГБ`.)
8. **`X-Proxy-Target-Token` виден в логах прокси.** В `System.out.println("[Proxy] " + method + " " + targetUrl)` он не попадает, но если включить полный дамп заголовков — попадёт. Это **не секрет клиента**, а одноразовый токен доступа; TTL 24 часа, отзыв при перезапуске target-сервиса.
9. **Нет mTLS.** Клиентские сертификаты не поддерживаются.
10. **SSE требует живой `read`.** Если target молчит >60 с, соединение падает. Прокси не шлёт keep-alive `ping` в SSE (в отличие от `SseHandler` самого FileServer).

---

## 9. Связь с другими компонентами

### 9.1. `loginRemoteAndSetCookie` (`AndroidBridge`)

Это **не** использует `/api/proxy`. Это отдельный код на Java, который делает `POST /api/login` на удалённый сервер и сохраняет `filebd_token` в `CookieManager` WebView. Применяется, когда WebView подключается к удалённому серверу напрямую (не через прокси).

Прокси и `loginRemoteAndSetCookie` — **альтернативы**:

- `loginRemoteAndSetCookie` — target-сервер становится «второй панелью» WebView, cookie кладётся в общее хранилище, все запросы идут напрямую.
- `/api/proxy` — target скрыт за прокси, cookie не смешиваются, токен передаётся per-request.

### 9.2. `ServerCopyService`

Push/pull/relay **не** используют `/api/proxy`. Они ходят на target напрямую (`srcUrl/api/read`, `dstUrl/api/write`) со своим `Authorization: Bearer`. Причины:

- прокси работает **от имени клиента** (сессия истечёт — прокси перестанет работать);
- копирование — фоновая задача на сервере, у неё нет «клиента»;
- сервер сам решает, к каким target обращаться (через `config.json` или параметры задачи).

`ServerCopyService` **не** игнорирует SSL — для HTTPS с self-signed target он упадёт так же, как `ProxyHandler`.

### 9.3. `04b-auth-token.js`

Клиентский модуль определяет, к какому серверу подключён (`ctx.db.isProxy`), и выбирает:

- `isProxy == false` → `Authorization: Bearer <localToken>` к самому FileServer;
- `isProxy == true` → `X-Proxy-Target-Token: <remoteToken>` через `/api/proxy`.

Сам прокси-URL собирается в `05-connection.js` (Base64url от `baseUrl`) и подставляется во все запросы второй панели.

---

## 10. Примеры

### 10.1. Простой запрос

```bash
# Закодировать target
TARGET=$(printf 'http://192.168.15.191:8080' | base64 | tr '+/' '-_' | tr -d '=')
# → aHR0cDovLzE5Mi4xNjguMTUuMTkxOjgwODA

# Логин на target (получить target-токен)
TOKEN=$(curl -s -X POST "http://127.0.0.1:8080/api/proxy/$TARGET/api/login" \
    -H "Authorization: Bearer <LOCAL_TOKEN>" \
    -H 'Content-Type: application/json' \
    -d '{"user":"admin","pass":"secret"}' | jq -r .token)

# Листинг target через прокси
curl "http://127.0.0.1:8080/api/proxy/$TARGET/api/list?path=" \
    -H "Authorization: Bearer <LOCAL_TOKEN>" \
    -H "X-Proxy-Target-Token: $TOKEN"
```

### 10.2. Скачивание файла

```bash
curl "http://127.0.0.1:8080/api/proxy/$TARGET/api/read?path=Files/report.pdf" \
    -H "Authorization: Bearer <LOCAL_TOKEN>" \
    -H "X-Proxy-Target-Token: $TOKEN" \
    --output report.pdf
```

Range-запросы работают «сквозняком»: `Range` не в skip-list, `Content-Range` и `206` возвращаются клиенту как есть, `Accept-Ranges` тоже.

### 10.3. SSE через прокси

```bash
curl -N "http://127.0.0.1:8080/api/proxy/$TARGET/api/events" \
    -H "Authorization: Bearer <LOCAL_TOKEN>" \
    -H "X-Proxy-Target-Token: $TOKEN"
# event: ready
# data: {"id":"sse-1"}
# event: ping
# data: {"t":...}
```

`Content-Type: text/event-stream` детектится — включается SSE-режим с `flush()`. `EventSource` в браузере тоже это переварит (см. ниже «о подводных камнях»).

### 10.4. Использование в JS

```javascript
const target = btoa('http://192.168.15.191:8080')
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const res = await fetch(`/api/proxy/${target}/api/list?path=`, {
    headers: {
        'Authorization': 'Bearer ' + localToken,
        'X-Proxy-Target-Token': remoteToken
    },
    credentials: 'include'
});
const data = await res.json();
```

---

## 11. Подводные камни при использовании

1. **`Content-Length` и `Transfer-Encoding`.** Если target отдаёт `Transfer-Encoding: chunked` без `Content-Length`, прокси уйдёт в ветку (d) — тоже chunked, клиент получит `Transfer-Encoding: chunked` от прокси. Совместимо, но `resp.headers.get('content-length')` будет `null`.

2. **`Content-Encoding`.** Target, увидев отсутствие `Accept-Encoding` от прокси, обычно возвращает **uncompressed**. Но если какой-то сервер всё равно отдал `gzip` (например, по умолчанию на nginx), `content-encoding: gzip` из ответа вырезается — клиент получит **gzip-байты как `text/plain`**. Это известная шероховатость. Для `FileServerAndroid`-target неактуально (он не сжимает), для внешних — имей в виду.

3. **`Set-Cookie` теряется.** Если target-сервер аутентифицирует через cookie, а не через `Authorization: Bearer`, прокси не сможет её сохранить. `FileServerAndroid` умеет и то, и другое (см. `AuthService.authenticate`), поэтому для него это не проблема.

4. **SSE-таймаут.** 60 секунд `READ_TIMEOUT` — на медленных сетях, где `ping` идёт раз в 15 секунд, хватает. Но если target-сервер замолчал на минуту — поток закроется с `SocketTimeoutException`, и EventSource начнёт переподключение. На клиенте это выглядит как «мигание» статуса; не баг.

5. **Редирект на другой origin.** Если target отвечает `301 Location: https://other-host/...`, клиент должен **сам** решить, идти ли туда (обычно нет — это выход за пределы прокси). JS-обёртка в `04b-auth-token.js` не следует редиректам автоматически.

6. **Мусор в логах прокси.** `System.out.println("[Proxy] " + method + " " + targetUrl)` — при `path` с 10 000 символов засорит `logcat`. В проде можно урезать; сейчас не урезано.

7. **Прокси не различает «свой» и «чужой» target.** Любой клиент, прошедший слой 1, может обратиться к **любому** `http(s)://...` — включая внутренние сервисы, доступные с телефона (`http://192.168.1.1/`, `http://127.0.0.1:9090/` и т.п.). Это **SSRF-поверхность**: если прокси-сервер имеет доступ к чему-то, что клиент видеть не должен — он это увидит. Сейчас не реализован whitelist target'ов; при выносе наружу его стоит добавить.

8. **Basic auth target через прокси.** `Authorization: Basic` вырезается из запроса — передать target логин/пароль можно только как `X-Proxy-Target-Token: <token>`, полученный через `POST /api/proxy/.../api/login`. Прямой Basic к target не пройдёт.

---

## 12. Резюме

`ProxyHandler` реализует **stateless, двухаутентифицированный, потоковый** HTTP-прокси:

- клиент аутентифицируется на **прокси** (все стандартные механизмы `AuthService`);
- target-токен передаётся отдельным заголовком `X-Proxy-Target-Token` и конвертируется в `Authorization: Bearer`;
- заголовки фильтруются по hop-by-hop правилам (RFC 7230 §6.1) + изоляция cookie/authorization между прокси и target;
- тело запроса и ответа стримятся без буферизации (16 КБ буфер; 4 КБ для SSE с `flush()`);
- редиректы не разворачиваются — 3xx идёт клиенту;
- SSE и `HEAD` — отдельные ветки с корректной семантикой;
- ошибки target → `502 Proxy error: ...`;
- ограничения: нет WebSocket, нет HTTP/2, нет self-signed HTTPS к target, нет cookie-сессии с target, нет whitelist target'ов (SSRF).