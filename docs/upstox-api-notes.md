# Upstox Developer API — reference for an order executor (Node 22 / TS)

Compiled 2026-10-04 from the official docs (Markdown sources at
`https://upstox.com/developer/api-documentation/<page>.md`), the published
proto file, and the official SDKs `upstox/upstox-nodejs` (v2.31.0) and
`upstox/upstox-python`. Doc base: `https://upstox.com/developer/api-documentation/`
(cited below as `DOC/<page>`). Items not stated in those sources are marked
**UNCONFIRMED**; items checked by an unauthenticated request are marked **OBSERVED**.

## 0. Base URLs, headers, envelopes

| Use | Base URL | Source |
|---|---|---|
| Everything (auth, data, portfolio, GTT, multi-order, exit-all) | `https://api.upstox.com` (+ `/v2` or `/v3` per endpoint) | DOC/request-structure |
| Place / modify / cancel (single orders, v2 and v3) | `https://api-hft.upstox.com` | DOC/announcements/enhanced-url, DOC/v3/place-order |
| Sandbox (order APIs only) | `https://api-sandbox.upstox.com` (the SDK's value; **OBSERVED** answering 401 `UDAPI100050` without a token). DOC/api-overview shows `https://sandbox.upstox.com/v2/order/place`, which didn't resolve from here | upstox-nodejs `src/ApiClient.js` |
| Market WS | `wss://api.upstox.com/v3/feed/market-data-feed` (redirects) | upstox-nodejs `src/feeder/MarketDataFeederV3.js` |
| Portfolio WS | `wss://api.upstox.com/v2/feed/portfolio-stream-feed` | DOC/get-portfolio-stream-feed |

The SDK sends only paths matching `/\/order\/(place|modify|cancel)/` to the HFT host (so multi-order and GTT go to `api.upstox.com`).

Headers: `Authorization: Bearer <access_token>`, `Accept: application/json`, `Content-Type: application/json` on JSON bodies (form-urlencoded only for token exchange). The `Api-Version` header is no longer needed (DOC/announcements/new-url-and-simplified-headers). The v3 funds sample still sends `Api-Version: 3.0`.
Optional `X-Algo-Name: <algo name configured in My Apps>` on order-placement APIs, needed only for exchange-approved algos. Send the name, not the Algo ID (DOC/announcements/algo-trading-circular). An invalid name returns `UDAPI1156`.

Success: `{"status":"success","data":...}`. Error (DOC/response-structure):
```json
{"status":"error","errors":[{"error_code":"UDAPI1008","message":"Price is required","property_path":"price","invalid_value":null}]}
```
The camelCase duplicates (`errorCode`, `propertyPath`, `invalidValue`) are deprecated. HTTP codes are 400/401/403/404/405/406/410/429/500/503 (DOC/error-codes).
Common error codes: `UDAPI10005` Too Many Requests, `UDAPI100050` invalid token, `UDAPI100067` API not allowed with extended_token, `UDAPI100073` client_id inactive, `UDAPI100500` internal error, `UDAPI10000` unsupported request/URL.
**OBSERVED:** `api-hft` validates the order body before it checks auth (an empty body returned 400 with field errors, not 401).

## 1. Authentication (DOC/authentication, DOC/authorize, DOC/get-token, DOC/logout)

**Authorize dialog:** `GET https://api.upstox.com/v2/login/authorization/dialog`

| Param | Req | Notes |
|---|---|---|
| `client_id` | Y | API key |
| `redirect_uri` | Y | must exactly match the app's registered URI |
| `response_type` | Y | always `code` |
| `state` | N | echoed back. Use a random value and verify it |

The response is a 302 to `<redirect_uri>?code=XXXX&state=...`. Error `UDAPI100068` means the client_id or redirect_uri is wrong. QR login isn't supported.

**Token exchange:** `POST https://api.upstox.com/v2/login/authorization/token`, `Content-Type: application/x-www-form-urlencoded`.
Body: `code`, `client_id`, `client_secret`, `redirect_uri`, `grant_type=authorization_code`. A code works once, even if the exchange fails.
```json
{"email":"…","exchanges":["NSE","NFO","BSE","CDS","BFO","BCD"],"products":["D","CO","I"],"broker":"UPSTOX",
 "user_id":"<UCC>","user_name":"…","order_types":["MARKET","LIMIT","SL","SL-M"],"user_type":"individual",
 "poa":false,"is_active":true,"access_token":"…","extended_token":"…"}
```
Note that this response is not wrapped in `status`/`data`. `products` can contain `I`, `D`, `CO`, `MTF`. `extended_token` gives long-lived, read-only access to some endpoints.
Errors: `UDAPI100069` bad id/secret, `UDAPI100070` bad redirect_uri, `UDAPI100057` invalid code. If the user has no active segments, the error says to reactivate them manually.

**Expiry rule:** an access token is valid until **03:30 IST the next day**, whatever time it was generated. A token generated at 02:30 still expires at 03:30 the same day.

**TOTP login (fully headless, individual apps only):** `POST https://api.upstox.com/v2/totp-login/authorization/token`
Headers: `x-api-key: <API key>`, `Content-Type: application/json`. Body: `{"totp":"123456","pin":"123456"}` (6 digits each).
The response is the same as the token exchange. This call **revokes the app's current active token**.
Errors: `UDAPI1241` pin format, `UDAPI1242` totp format, `UDAPI100096` bad x-api-key, `UDAPI100097` wrong pin/totp, `UDAPI100098` TOTP not enabled, `UDAPI100099` rate limited, `UDAPI100101` app not individual.
Rate limit: 1/s, 10/min, 60/30 min (DOC/rate-limiting). The executor holds the user's PIN and TOTP seed, so secure them accordingly.

**Access Token Request (one-tap approval, beta)** (DOC/access-token-request):
`POST https://api.upstox.com/v3/login/auth/token/request/{client_id}` with body `{"client_secret":"…"}`. The page header says `/login/auth/token/request/:client_id`, but the curl uses `/v3`.
```json
{"status":"success","data":{"authorization_expiry":"1732226400000","notifier_url":"https://…"}}
```
The user gets an in-app and WhatsApp prompt. On approval, Upstox POSTs this to the app's **Notifier Webhook URL**, which is set in My Apps, must be unauthenticated, and must return a string or JSON (DOC/appendix/notifier-webhook-endpoint):
```json
{"client_id":"…","user_id":"…","access_token":"…","token_type":"Bearer","expires_at":"1731448800000","issued_at":"1731412800000","message_type":"access_token"}
```
A pending request expires at 03:30 the next day. Errors: `UDAPI1123` notifier URL not configured, `UDAPI1124` not an individual user, `UDAPI1155` app under exchange review or rejected, `UDAPI1157` app expired.

**Manual:** the "Generate" button in My Apps. **Logout:** `DELETE https://api.upstox.com/v2/logout` returns `{"status":"success","data":true}`.

**Analytics token** (DOC/analytics-token): valid 1 year, read-only (GET only), generated in My Apps → Analytics. It **cannot trade**. Account endpoints (orders, portfolio, funds, GTT get) need a registered static IP. Market data doesn't.

## 2. Orders

### 2.1 Place Order V3 — `POST https://api-hft.upstox.com/v3/order/place` (DOC/v3/place-order)

| Field | Req | Type | Values / rules |
|---|---|---|---|
| `quantity` | Y | int32 | units, in multiples of the lot size (MCX takes lots). `0` → `UDAPI1052` |
| `product` | Y | string | `I` intraday, `D` delivery, `MTF` |
| `validity` | Y | string | `DAY`, `IOC` |
| `price` | Y | float | `0` for MARKET and SL-M |
| `tag` | N | string | ≤ 40 chars (`UDAPI1119`). Filterable in order history, exit-all and cancel-multi |
| `instrument_token` | Y | string | instrument key, e.g. `NSE_EQ\|INE669E01016` |
| `order_type` | Y | string | `MARKET`, `LIMIT`, `SL` (stop-loss limit), `SL-M` (stop-loss market) |
| `transaction_type` | Y | string | `BUY`, `SELL` |
| `disclosed_quantity` | Y | int32 | `0` = none. If set, it must be ≥ 10% of qty (`UDAPI1039`, from the modify page) |
| `trigger_price` | Y | float | `0` unless SL/SL-M |
| `is_amo` | N | bool | **Ignored.** The server works out AMO from the market session |
| `slice` | N | bool | default `false`. `true` auto-splits by `freeze_quantity` |
| `market_protection` | N | int32 | MARKET/SL-M only. `-1` (default) = auto, `1`–`25` = %, `0` = none, which is **rejected** because exchanges bar API market orders without protection |

Which prices each order type requires is inferred from the error codes `UDAPI1040` "Price not required", `1043` price required, `1041` both required and `1042` only trigger_price (**UNCONFIRMED** mapping):

| Type | `price` | `trigger_price` |
|---|---|---|
| MARKET | 0 | 0 |
| LIMIT | > 0 | 0 |
| SL | > 0 | > 0 |
| SL-M | 0 | > 0 |

For SL, `UDAPI1037` and `UDAPI1038` ("trigger should be less/greater than limit price") cover the BUY and SELL direction checks.

```json
{"quantity":1,"product":"I","validity":"DAY","price":0,"tag":"sig-123","instrument_token":"NSE_EQ|INE002A01018",
 "order_type":"MARKET","transaction_type":"BUY","disclosed_quantity":0,"trigger_price":0,"is_amo":false,"slice":true,"market_protection":-1}
```
Response: `{"status":"success","data":{"order_ids":["1644490272000","1644490272001"]},"metadata":{"latency":30}}`. `latency` is in ms, and you get one id per slice.
The maximum number of slices per request is **UNCONFIRMED** (the doc link points back to itself). Exceeding it returns `UDAPI1118`.
Errors worth handling:

| Code | Meaning |
|---|---|
| `UDAPI100074` | place API is only open 05:30–24:00 IST |
| `UDAPI100039` | AMO during market hours |
| `UDAPI100011` | invalid instrument key |
| `UDAPI1154` | **blocked: not from a whitelisted static IP** |
| `UDAPI1156` | bad `X-Algo-Name` |
| `UDAPI1158` | market orders not allowed (use market protection) |
| `UDAPI1159`, `UDAPI1160` | market protection > 25 / invalid |
| `UDAPI1161` | MCX via API temporarily disabled |
| `UDAPI100049` | account restricted to Uplink Business |

### 2.2 Modify V3 — `PUT https://api-hft.upstox.com/v3/order/modify` (DOC/v3/modify-order)
Required fields: `order_id`, `validity`, `price`, `order_type`, `trigger_price`. Optional: `quantity`, `disclosed_quantity` (non-zero if sent), `market_protection`. Fields you omit default to the original order's values.
Response: `{"status":"success","data":{"order_id":"…"},"metadata":{"latency":40}}`.
Errors: `UDAPI100010` not found, `UDAPI100041` order already cancelled/rejected/completed, `UDAPI1036` trigger_price required, `UDAPI1029`–`1032` price combination errors, plus `1154`, `1156`, `1158`–`1161`.

### 2.3 Cancel V3 — `DELETE https://api-hft.upstox.com/v3/order/cancel?order_id=<id>` (DOC/v3/cancel-order)
Response: `{"status":"success","data":{"order_id":"…"},"metadata":{"latency":30}}`. Works for AMO and regular orders.
Errors: `UDAPI100010` not found, `UDAPI100040` already final, `UDAPI1010` bad id format (pattern `^[-a-zA-Z0-9]+`), `1154`, `1156`.

v2 place/modify/cancel (`/v2/order/place|modify|cancel` on api-hft) are marked **Deprecated** (DOC/announcements/deprecation-notice-v2). The v2 place response is `data.order_id` (single).

### 2.4 Place Multi Order — `POST https://api.upstox.com/v2/order/multi/place` (DOC/place-multi-order)
The body is a JSON **array**, at most **10 lines** including any slices. Each line has the v3 place fields plus `correlation_id` (unique, 1–20 chars), and `slice`, `tag` ≤ 40 and `market_protection` per line.
**All BUY lines run before all SELL lines.** If any line has a payload error, nothing is placed (`summary.payload_error`).
HTTP 200 means success. HTTP 207 means `partial_success`.
```json
{"status":"partial_success","data":[{"correlation_id":"1","order_id":"1644490272000"}],
 "errors":[{"correlation_id":"2","error_code":"UDAPI100500","message":"…","property_path":null,"invalid_value":null}],
 "summary":{"total":2,"payload_error":0,"success":1,"error":1}}
```
Sliced lines come back as `<cid>_1`, `<cid>_2`, and so on.
Errors: `UDAPI1114` empty, `1115` missing cid, `1116` cid length, `1117` duplicate cid, `1118` > max orders, `1119` tag length, `1176`/`1177` market protection, `1178` MCX disabled, `1154`, `1156`.

### 2.5 Exit All Positions — `POST https://api.upstox.com/v2/order/positions/exit[?segment=&tag=]` (DOC/exit-all-positions)
This squares off with **MARKET orders using the default MPP**, BUY positions first. `segment` ∈ `NSE_EQ BSE_EQ NSE_FO BSE_FO MCX_FO NCD_FO BCD_FO NSE_COM`.
The tag filter only works for **intraday** positions (tags don't survive carry-forward).
The response is `data.order_ids[]`, `errors[]` (each with `instrument_key`, `order_id`) and `summary{total,success,error}`. HTTP 200 or 207.
Errors: `UDAPI1111` no open positions, **`UDAPI1112` more than 10 open positions** (the API refuses), `UDAPI1113` outside market hours, `UDAPI1108` bad segment.

### 2.6 Cancel Multi Order — `DELETE https://api.upstox.com/v2/order/multi/cancel[?segment=&tag=]` (DOC/cancel-multi-order)
Cancels all open orders (AMO and regular), at most 10 (`UDAPI1110` if there are more). `UDAPI1109` means none are open. The response has the same shape as exit-all.

### 2.7 Read endpoints (all `GET https://api.upstox.com/v2/...`). Orders are kept for **one trading day only**.

| Endpoint | Path | Params |
|---|---|---|
| Order book | `/order/retrieve-all` | — (`data[]` = latest state of each order) |
| Order details | `/order/details` | `order_id` (or `tag`; `UDAPI100059` if neither is given) |
| Order history | `/order/history` | `order_id` and/or `tag`. A tag alone returns every order with that tag. Returns one row per state transition |
| Trades for day | `/order/trades/get-trades-for-day` | — |
| Trades by order | `/order/trades` | `order_id` (required) |

Order object (DOC/get-order-details): `exchange, product, price, quantity, status, tag, instrument_token, placed_by, trading_symbol, order_type, validity, trigger_price, disclosed_quantity, transaction_type, average_price, filled_quantity, pending_quantity, status_message, status_message_raw, exchange_order_id, parent_order_id, order_id, variety ("SIMPLE"), order_timestamp ("YYYY-MM-DD HH:mm:ss"), exchange_timestamp, is_amo, order_request_id, order_ref_id` (`GTT-…` when a GTT placed the order). Order book rows also carry `guid`.
Trade object: `exchange, product, trading_symbol, instrument_token, order_type, transaction_type, quantity, exchange_order_id, order_id, exchange_timestamp, average_price (fill price), trade_id, order_ref_id, order_timestamp`. The sample timestamps use the `DD-Mon-YYYY HH:mm:ss` format.

**Order status values** (DOC/appendix/order-status), lower-case with spaces:
`validation pending`, `modify pending`, `trigger pending`, `put order req received`, `modify after market order req received`, `cancelled after market order`, `open`, `complete`, `modify validation pending`, `after market order req received`, `modified`, `not cancelled`, `cancel pending`, `rejected`, `cancelled`, `open pending`, `not modified`.
Terminal states: `complete`, `rejected`, `cancelled`, `cancelled after market order`. Partial fills show as `open` with `filled_quantity > 0` (**UNCONFIRMED**: there is no explicit partial status).

## 3. GTT orders (v3) (DOC/place-gtt-order, DOC/modify-gtt-order, DOC/cancel-gtt-order, DOC/get-gtt-order-details)

| Op | Method & URL | Body / query |
|---|---|---|
| Place | `POST https://api.upstox.com/v3/order/gtt/place` | see below |
| Modify | `PUT https://api.upstox.com/v3/order/gtt/modify` | `type, quantity, gtt_order_id, rules[]` (resend `trailing_gap` for TSL) |
| Cancel | `DELETE https://api.upstox.com/v3/order/gtt/cancel` | JSON body `{"gtt_order_id":"GTT-…"}` |
| Get | `GET https://api.upstox.com/v3/order/gtt?gtt_order_id=GTT-…` | the id is optional. Completed GTTs are **not** returned. What a call without an id returns is **UNCONFIRMED** (presumably all active GTTs) |

Place body: `type` (`SINGLE` = exactly 1 rule, `MULTIPLE` = 2–3 rules), `quantity` (int), `product` (`I`, `D`, `MTF`), `instrument_token`, `transaction_type` (of the ENTRY leg), and `rules[]`:

| Rule field | Notes |
|---|---|
| `strategy` | `ENTRY` (exactly one is mandatory), `TARGET`, `STOPLOSS`. Each strategy at most once. Exit legs take the opposite side to ENTRY |
| `trigger_type` | ENTRY: `ABOVE`, `BELOW` or `IMMEDIATE`. TARGET and STOPLOSS: `IMMEDIATE` only (`UDAPI1143`). `IMMEDIATE` sends a **LIMIT order at `trigger_price`** right away, irrespective of LTP |
| `trigger_price` | float > 0 (`UDAPI1140`) |
| `trailing_gap` | STOPLOSS only (makes it a TSL, beta). It is the fixed gap the SL trails at. **Minimum = 10% of (LTP − SL trigger)** (`UDAPI1151`). The current trailed trigger shows in Get GTT and on the portfolio stream |
| `market_protection` | per rule, same semantics as orders. That it applies to triggered market orders implies ABOVE/BELOW ENTRY triggers fire **market** orders (**UNCONFIRMED** inference; the docs never state the order type a triggered ABOVE/BELOW sends, and there is no `price` field) |

```json
{"type":"MULTIPLE","quantity":1,"product":"D","instrument_token":"NSE_EQ|INE669E01016","transaction_type":"BUY",
 "rules":[{"strategy":"ENTRY","trigger_type":"ABOVE","trigger_price":7.5},
          {"strategy":"TARGET","trigger_type":"IMMEDIATE","trigger_price":8.2},
          {"strategy":"STOPLOSS","trigger_type":"IMMEDIATE","trigger_price":7.1,"trailing_gap":0.1}]}
```
Response: `{"status":"success","data":{"gtt_order_ids":["GTT-CU25280200021013"]},"metadata":{"latency":88}}`. Cancel returns the same shape.
Get returns `data[]` with `type, exchange, quantity, product, rules[{strategy,status,trigger_type,trigger_price,transaction_type,message,order_id,trailing_gap}], trading_symbol, instrument_token, gtt_order_id, expires_at, created_at`. **Timestamps are in microseconds** (e.g. `1781029799000000`).
Rule `status` values: `SCHEDULED TRIGGERED EXPIRED OPEN COMPLETED CANCELLED PENDING FAILED INACTIVE`.

Validity: an IMMEDIATE ENTRY is valid for the day. Once the primary leg completes, the SL and target legs are valid for **365 days**. Intraday (`I`) GTTs last only the day they were created. The sample `expires_at` is about 1 year after creation.
Modify rules: after the ENTRY leg is `OPEN`, quantity can't change and only `IMMEDIATE` is allowed (`UDAPI1150`).
**GTT triggers on CAS-eligible stocks only work until 15:15 IST** (DOC/announcements/closing-auction-session).
Errors: `UDAPI1126`–`1143` (validation), `1134` id required, `1135` id must start with `GTT-`, `1151` trailing gap, `1154`, `1156`, `1158`, `1176`–`1178`.
Webhook and portfolio stream deliver `update_type:"gtt_order"` (GTT webhooks must be enabled in My Apps; DOC/webhook).

## 4. Portfolio, funds, margin, charges

| API | Method & URL | Notes |
|---|---|---|
| Positions | `GET https://api.upstox.com/v2/portfolio/short-term-positions` | `data[]`: `exchange, multiplier, value, pnl, product, instrument_token, average_price, buy_value, overnight_quantity, day_buy_value, day_buy_price, overnight_buy_amount, overnight_buy_quantity, day_buy_quantity, day_sell_value, day_sell_price, overnight_sell_amount, overnight_sell_quantity, day_sell_quantity, quantity (net), last_price, unrealised, realised, sell_value, trading_symbol, close_price, buy_price, sell_price`. Delivery positions move to holdings the next day |
| Holdings | `GET https://api.upstox.com/v2/portfolio/long-term-holdings` | `data[]`: `isin, cnc_used_quantity, collateral_type, company_name, haircut, product, quantity, trading_symbol, last_price, close_price, pnl, day_change, day_change_percentage, instrument_token, average_price, collateral_quantity, collateral_update_quantity, t1_quantity, exchange` |
| Funds v2 | `GET https://api.upstox.com/v2/user/get-funds-and-margin[?segment=SEC\|COM]` | `data.equity` and `data.commodity`: `used_margin, payin_amount, span_margin, adhoc_margin, notional_cash, available_margin, exposure_margin` |
| Funds v3 | `GET https://api.upstox.com/v3/user/get-funds-and-margin` | `data.available_to_trade.{total, cash_available_to_trade{total, cash{opening_balance,added_today,withdrawn_today,amount_from_stock_sale,unpaid_charges}, margin_used{…}}, pledge_available_to_trade{…}}`, `data.unavailable_to_trade{…}` (DOC/get-funds-and-margin-v3) |
| Margin | `POST https://api.upstox.com/v2/charges/margin` | body `{"instruments":[{"instrument_key","quantity","transaction_type","product":"I\|D\|CO\|MTF","price"?}]}`, **max 20** (`UDAPI1102`), no duplicates (`1103`). Returns `data.margins[]{span_margin,exposure_margin,equity_margin,net_buy_premium,additional_margin,total_margin,tender_margin}, data.required_margin, data.final_margin` |
| Brokerage | `GET https://api.upstox.com/v2/charges/brokerage?instrument_token=&quantity=&product=&transaction_type=&price=` | all params required, price and qty non-zero. Returns `data.charges{total, brokerage, taxes{gst,stt,stamp_duty}, other_charges{transaction,clearing,ipft,sebi_turnover}, dp_plan{name,min_expense}}`. The sample also shows deprecated `otherTaxes`/`dpPlan` |

**The funds service is down from 00:00 to 05:30 IST** (`UDAPI100072`; v3 returns HTTP **423**).
Kill switch (DOC/update-kill-switch): `GET|POST https://api.upstox.com/v2/user/kill-switch`. The POST body is `[{"segment":"NSE_EQ","action":"DISABLE"}]`. Positions must be closed first. Disabling cancels open orders and starts a 12 h cool-off. The token must be regenerated afterwards for the switch to take effect.

## 5. WebSockets

### 5.1 Market Data Feed V3 (DOC/v3/get-market-data-feed, DOC/get-market-data-feed-authorize-v3)
- Authorize: `GET https://api.upstox.com/v3/feed/market-data-feed/authorize` (path from the SDK `WebsocketApi.js`) returns `{"status":"success","data":{"authorized_redirect_uri":"wss://…/market-data-feeder/v3/upstox-developer-api/feeds?requestId=…&code=…"}}`. The URL is **single-use**.
  Alternatively, connect to `wss://api.upstox.com/v3/feed/market-data-feed` with `Authorization: Bearer` and `Accept: */*` and follow the 302 (`ws` option `followRedirects: true`).
- Proto: `https://assets.upstox.com/feed/market-data-feed/v3/MarketDataFeed.proto`, package `com.upstox.marketdatafeederv3udapi.rpc.proto`. The root message is `FeedResponse{type(enum initial_feed=0, live_feed=1, market_info=2), map<string,Feed> feeds, int64 currentTs, MarketInfo marketInfo}`.
  `Feed` is a oneof of `ltpc | fullFeed{marketFF|indexFF} | firstLevelWithGreeks`, plus `requestMode` (enum `ltpc=0, full_d5=1, option_greeks=2, full_d30=3`). It imports `google/protobuf/wrappers.proto` (`LTPC.iep` is a DoubleValue).
- **Server frames are binary protobuf. Subscription messages must also be sent as binary frames** (JSON bytes; the SDK sends `Buffer.from(JSON.stringify(req))`).
```json
{"guid":"13syxu852ztodyqncwt0","method":"sub","data":{"mode":"full","instrumentKeys":["NSE_EQ|INE002A01018"]}}
```
  `method` is one of `sub` (mode defaults to `ltpc`), `change_mode` (keys and mode required) or `unsub`.
  `mode` is one of `ltpc` (ltp, ltt, ltq, cp), `option_greeks` (firstLevelWithGreeks: ltpc, best bid/ask, greeks, vtt, oi, iv), `full` (ltpc, 5-level `marketLevel.bidAskQuote`, greeks, `marketOHLC`, atp, vtt, oi, iv, tbq, tsq and CAS fields) or `full_d30` (30 levels, Plus plan only).
- Message order: the first message is `market_info` (`segmentStatus` per segment, plus `casMarketStatus` and `preOpenSessionStatus` maps), then a snapshot, then live ticks. The server sends ping frames when idle.
- **OHLC in `full`:** `marketOHLC.ohlc[]` with `{interval, open, high, low, close, vol, ts}`. The documented examples contain only `interval:"1d"` and `"I1"` (the current 1-minute candle). **30-minute (`I30`) OHLC is not shown in the feed**; it exists only in the OHLC v3 REST API. Whether the feed ever sends I30 is **UNCONFIRMED**. Index `indexFF` carries `ltpc` and `marketOHLC` only.

| Limits | Normal | Upstox Plus |
|---|---|---|
| Connections per user | **2** | 5 |
| LTPC keys | 5000 (2000 when mixed with other modes) | — |
| Option Greeks keys | 3000 (2000 when mixed) | — |
| Full keys | 2000 (1500 when mixed) | — |
| Full D30 keys | n/a | 50 (1500 combined) |

### 5.2 Portfolio Stream Feed (DOC/get-portfolio-stream-feed, DOC/get-portfolio-stream-feed-authorize)
- Authorize: `GET https://api.upstox.com/v2/feed/portfolio-stream-feed/authorize?update_types=order%2Cgtt_order%2Cposition%2Cholding` returns `data.authorized_redirect_uri` (single use; the camelCase copy is deprecated). Alternatively, connect directly to `wss://api.upstox.com/v2/feed/portfolio-stream-feed?update_types=…` and follow the redirect.
- `update_types` defaults to `order`. Messages are **JSON text**, and no subscribe message is needed. Updates arrive for orders placed from any platform (app, web, API).
- Order message: `update_type:"order"`, the order-book fields plus `user_id`, `instrument_key` and `guid`.
  GTT message: `update_type:"gtt_order"` plus the Get GTT fields.
  Position message: the positions fields. Holding message: the holdings fields.
- The same JSON can be pushed to the app's **postback/webhook URL** (POST, no auth, reply 2xx) (DOC/webhook).

## 6. Market quotes and market info (all `GET`, `https://api.upstox.com`)

| API | URL | Notes |
|---|---|---|
| LTP v3 | `/v3/market-quote/ltp?instrument_key=K1,K2` | returns `{last_price, instrument_token, ltq, volume, cp}` per key. **Response keys are `EXCHANGE:SYMBOL`** (e.g. `NSE_EQ:RELIANCE`), so map back via `instrument_token`. Exceeding the key limit returns `UDAPI100043` (max **UNCONFIRMED** for LTP; 500 for quotes) |
| Full quote v3 | `/v3/market-quote/quotes?instrument_key=…` (max 500, `UDAPI100042`) | returns `ohlc{open,high,low,close,volume,ts}`, `depth{buy[5],sell[5]}{quantity,price,orders}`, `timestamp`, `instrument_token`, `symbol`, `last_price`, `volume`, `average_price`, `oi`, `net_change`, `total_buy_quantity`, `total_sell_quantity`, **`lower_circuit_limit`, `upper_circuit_limit`**, `last_trade_time`, `oi_day_high/low`, `prev_close_price`, `year_high/low`, `previous_oi` and CAS fields (`indicative_equilibrium_price`, `reference_price`, `cas_eligible`, …). v2 is `/v2/market-quote/quotes` (same, without the v3 extras) |
| OHLC v3 | `/v3/market-quote/ohlc?instrument_key=…&interval=1d\|I1\|I30` | returns `last_price`, `instrument_token`, `prev_ohlc` and `live_ohlc` with `{open,high,low,close,volume,ts}`. Errors: `UDAPI1027` missing interval, `1028` bad interval |
| Exchange status | `/v2/market/status/{exchange}` | returns `{exchange, status, last_updated, cas_eligible_status?{status,last_updated}}`. Status is one of `NORMAL_OPEN NORMAL_CLOSE PRE_OPEN_START PRE_OPEN_END CLOSING_START CLOSING_END`. CAS statuses: `CTS_CLOSE CAS_LM_START CAS_M_STOP CAS_STOP` |
| Holidays | `/v2/market/holidays` or `/v2/market/holidays/{YYYY-MM-DD}` | returns `data[]{date, description, holiday_type (TRADING_HOLIDAY\|SETTLEMENT_HOLIDAY\|SPECIAL_TIMING), closed_exchanges[], open_exchanges[{exchange,start_time,end_time}]}` (epoch ms) |
| Timings | `/v2/market/timings/{YYYY-MM-DD}` | returns `data[]{exchange,start_time,end_time}` (epoch ms) |

**Closing Auction Session (effective 2026-08-03)** for CAS-eligible stocks (instrument field `cas_eligible`):
- Continuous trading ends at about 15:15.
- 15:15–15:20: no order entry.
- 15:20–15:25: LIMIT and MARKET only.
- From 15:25: LIMIT only.
- At 15:28–15:30 (random): entry closes.

Throughout the auction, SL, SL-M, IOC and slicing are rejected, and prices must be within ±3% of the reference price. NSE_FO and BSE_FO now close at **15:40** (DOC/announcements/closing-auction-session).

## 7. Instruments (DOC/instruments, DOC/appendix/field-pattern)
- Key format: `<SEGMENT>|<id>`. Equity uses the ISIN (`NSE_EQ|INE002A01018`), F&O uses the exchange token (`NSE_FO|43919`), and indices use the name (`NSE_INDEX|Nifty 50`, `NSE_INDEX|India VIX`).
  Segments: `NSE_EQ NSE_FO NCD_FO BSE_EQ BSE_FO BCD_FO MCX_FO NSE_COM NSE_INDEX BSE_INDEX MCX_INDEX`. URL-encode `|` as `%7C`.
  Use `instrument_key` as the identifier, not `exchange_token` (exchanges reuse tokens).
- BOD JSON (gzip) files: `https://assets.upstox.com/market-quote/instruments/exchange/{complete|NSE|BSE|MCX}.json.gz`.
  Other lists: `MTF.json.gz`, `NSE_MIS.json.gz` / `BSE_MIS.json.gz` (these add `intraday_margin` and `intraday_leverage`), `suspended-instrument.json.gz`, `global.json.gz`. Use JSON; the CSV files are deprecated.
- EQ record: `segment, name, exchange, isin, instrument_type, instrument_key, lot_size, freeze_quantity, exchange_token, tick_size, trading_symbol, short_name, qty_multiplier, security_type, cas_eligible`. F&O records add `expiry` (epoch ms), `strike_price`, `minimum_lot`, `underlying_key`, `underlying_symbol`, `underlying_type` and `weekly`.
- **`tick_size` is in paise.** **OBSERVED** in NSE.json.gz on 2026-10-04: SBIN `5.0` (₹0.05), RELIANCE `10.0` (₹0.10), IDEA `1.0` (₹0.01). The docs don't state the unit, so divide by 100 before rounding prices.

## 8. Sandbox (DOC/sandbox, DOC/build-using-sandbox)
- Create one sandbox app per user in My Apps → Sandbox, then press "Generate". The token is valid for **30 days** and only works for sandbox orders.
- Supported APIs: place, modify and cancel (v2 and v3), and place multi order. Sandbox orders live for 24 h, need no funds, use live-identical validation and are available 24/7.
  The announcement says the order details, order book and history endpoints are also usable, but the SDK only sandbox-routes the 7 order paths, so this is **UNCONFIRMED**.
- No GTT, market data, websockets or portfolio in the sandbox. Base URL: see §0. SDK toggle: `new UpstoxClient.ApiClient(true)`.

## 9. Static IP and algo rules (DOC/announcements/algo-trading-circular, DOC/update-app-static-ips, DOC/get-app-static-ips, DOC/appendix/my-apps-support-for-algo-trading-circular)
- Based on the NSE circular of 2025-05-05 (INVG67858). Upstox's announcement is dated **April 1, 2026**. API orders must come from the user's registered static IP, and **requests from other IPs are rejected with `UDAPI1154` "Access to this API is blocked due to static IP restrictions."**
- Applies to: place, modify, cancel, place multi, cancel multi, GTT (all ops) and exit-all. Not to holdings, positions, funds or candles. The analytics token, however, needs a static IP for account GETs.
- One **primary** and one optional **secondary** IP (IPv4 or IPv6) per user. These are user-level, not per app. An IP can belong to **only one customer**.
  Set them in My Apps (the "Static IPs" item in the app listing) or with `PUT https://api.upstox.com/v2/user/ip` and body `{"primary_ip":"203.0.113.10","secondary_ip":"203.0.113.11"}`. The response includes `access_tokens_invalidated:true`. Read them back with `GET /v2/user/ip`.
- **Changes are allowed once per calendar week** (`UDAPI1185`), and **every change invalidates the existing access tokens**.
  Other errors: `UDAPI1179` not allowed, `1180` app inactive, `1181` not available for this app type, `1182` primary required, `1183` invalid IP, `1184` IPs identical, `1186` concurrent update.
- Order throughput: **more than 10 orders/s requires a SEBI/exchange-registered algo** (an Algo ID configured in My Apps, and `X-Algo-Name` sent on orders). Below that, no registration is needed.

## 10. Rate limits (DOC/rate-limiting). Per API, per user. Exceeding them returns 429 / `UDAPI10005`, and "temporary suspension" is possible.

| Category | /s | /min | /30 min |
|---|---|---|---|
| Order APIs **combined** (place, modify, cancel, multi, GTT), unregistered algo | **10** | 500 | 2000 |
| Same, SEBI-registered algo | 50 | 500 | 2000 |
| Other standard APIs (holdings, positions, funds, candles, quotes…) | 50 | 500 | 2000 |
| Payout read APIs | 10 | 500 | 2000 |
| Payout write APIs | — | 10 | 300 |
| Apply IPO | 1 | 10 | 300 |
| TOTP login | 1 | 10 | 60 |

Multi-order and cancel-multi are said to have "a different rate limit", but the rate-limit page only lists them inside the combined order bucket. Separate numbers are **UNCONFIRMED**.

## 11. Implementation checklist for the executor
1. Daily token: get a new token at or after 03:30 IST, either by TOTP login (headless) or by an Access Token Request with a webhook. Re-auth whenever the static IP changes or the kill switch is used.
2. Send orders from the registered static IP. Treat `UDAPI1154` as fatal, never as something to retry.
3. Place with v3 on `api-hft`. Use `market_protection:-1` (or 1–25) for MARKET and SL-M, since `0` gets rejected. Use `slice:true` for quantities above the freeze quantity.
4. Throttle **all order-type calls together** to at most 10/s (leave headroom; the 500/min and 2000/30 min caps also apply). That's about 1 order per second sustained over 30 min.
5. Drive state from the portfolio stream (`order,gtt_order,position`), and reconcile with `/v2/order/retrieve-all` and `/v2/order/trades/get-trades-for-day`.
6. Round prices to `tick_size/100`. Clamp to `lower/upper_circuit_limit` from the v3 quotes.
7. Respect the windows: the place API is open 05:30–24:00 IST, funds are unavailable 00:00–05:30, CAS-eligible stocks have the 15:15–15:30 restrictions, F&O closes at 15:40, and orders vanish at end of day.
