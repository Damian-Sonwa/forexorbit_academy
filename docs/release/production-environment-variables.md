# Production environment variables (Render)

Names and safe examples only. Never paste real values into chat, Git or documents. Change them in Render → the service → Environment, only during the approved release window. `NEXT_PUBLIC_*` values are compiled in at **build** time, so changing one needs a rebuild (a deploy).

## Session, origin and URL variables

| Variable | Current purpose | Production action | Safe value / example | Required before deployment |
|---|---|---|---|---|
| `APP_ORIGIN` | **New.** The one trusted origin for cookies, CSRF, CORS and sockets. Read at run time. | **Add** | `https://forexorbit-academy.onrender.com` (exact; no trailing path) | **Yes.** Without it, production refuses to start. |
| `AUTH_LEGACY_BEARER_UNTIL` | **New, temporary.** Opens the one-time exchange of a pre-4.5 token for a cookie session. | **Leave unset** (owner decision D3: the exchange stays disabled). The code ignores any date after 2027-01-31 and is removed in a follow-up. | (unset) | No |
| `JWT_SECRET` | Signs the pre-4.5 tokens. After 4.5 it is used only to verify them in the legacy exchange. `server.js` still requires it to start. | **Keep unchanged** for the whole transition | (existing secret) | Yes (already set) |
| `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_API_URL` | Formerly the browser's API host. **No longer read:** every browser call is a relative same-origin URL (`/api/...`). | **Remove** if present (harmless if left) | (unset) | No |
| `NEXT_PUBLIC_SOCKET_URL` | Formerly the socket host. **No longer read:** the socket uses the page origin. | **Remove** if present; also removed from `render.yaml` | (unset) | No |
| `ALLOWED_ORIGINS` | Old CORS list. **No longer read.** | **Remove** after the release (harmless if left) | (unset) | No |
| `APP_BASE_URL` | Origin used to build password-reset links in emails | **Update** to the Render origin, so reset links open where the session cookie works | `https://forexorbit-academy.onrender.com` | **Yes** |
| `NEXT_PUBLIC_APP_URL` | Not read by any code | **Remove** if present | (unset) | No |
| `PORT` | Listening port (`render.yaml`: 3000; otherwise Render supplies one) | **Keep** | `3000` | Already set |
| `NODE_ENV` | `production` (also forced by `scripts/start-production.js`) | **Keep** | `production` | Already set |
| `NODE_VERSION` | Render's Node.js version selector | **Add** (owner decision D6): the validated runtime | `22.19.0` | Yes |

## Database and server variables (unchanged by this release)

| Variable | Current purpose | Production action | Safe value / example | Required before deployment |
|---|---|---|---|---|
| `MONGO_URI` (or `MONGODB_URI`) | Atlas connection for the app user `forexorbit_app` | **Keep unchanged.** The user's role gains `sessions` access in Atlas, not here. | `mongodb+srv://<user>:<password>@<cluster>/` | Yes (already set) |
| `MONGODB_DB_NAME` | Database name; default `Forex_elearning` | **Keep.** If set, it must be `Forex_elearning`. | `Forex_elearning` | No |
| `SHARED_RATE_LIMIT` | `mongodb` turns on the shared login and reset limits | **Keep** the current setting | `mongodb` | No |
| `TRUSTED_PROXY_HOPS` | Proxies trusted in `X-Forwarded-For` (default 1) | **Keep.** Render responses come through Cloudflare (`server: cloudflare` header) in front of Render's proxy. The real hop count was never verified (`docs/audits/auth-rate-limiting-h1.md`), so keep the current value; this release does not change it. | `1` | No |
| `MEDIA_CLEANUP` | `delete` removes unused uploads; unset only reports them | **Keep** | (unset) | No |

## Providers (unchanged by this release)

| Variable | Purpose | Production action | Required before deployment |
|---|---|---|---|
| `PAYSTACK_SECRET_KEY` (server only), `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` (browser checkout) | Live course checkout. Render already rejects unsigned webhooks with 401, which shows a live secret key is configured there. The public key is compiled into the browser bundle by `next build`, so it must be set on Render **before** the build. It must be the `pk_live_` key matching the live secret key. | Keep. Confirm the public key exists on Render; it may currently be set only on Vercel. | **Yes** (public key before the build) |
| `RESEND_API_KEY`, `RESEND_FROM` | Password-reset and notice emails | Keep (`APP_BASE_URL` updated as above) | Already set |
| `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` | Uploads | Keep | As today |
| `AGORA_APP_ID` (or the older `NEXT_PUBLIC_AGORA_APP_ID`), `AGORA_APP_CERTIFICATE` | Consultation calls; both read on the server only | Keep as today | As today |
| `AI_API_KEY`, `AI_MODEL`, `AI_MAX_TOKENS`, `AI_TEMPERATURE` | AI assistant | Keep | As today |
| `OANDA_API_KEY`, `OANDA_ACCOUNT_ID`, `OANDA_DEMO_URL`, `BROKER_TYPE`, `BROKER_DEMO_MODE`, `NEXT_PUBLIC_BROKER_API_ENABLED` | Broker demo | Keep | As today |
| `NEXT_PUBLIC_ADS_*`, `NEXT_PUBLIC_ADSENSE_*`, `NEXT_PUBLIC_ADMOB_*`, `NEXT_PUBLIC_PROPELLERADS_*`, `NEXT_PUBLIC_PROP_PLACEMENT_*` | Advertising | Keep | As today |
| `NEXT_PUBLIC_PHONE_DEFAULT_REGION`, `SMS_DEFAULT_REGION` | Phone formatting | Keep | As today |
| `RENDER_EXTERNAL_URL` | Supplied by Render; used only in the start-up log | — | — |

## Never set on the app service

`CERTIFICATE_INDEX_MONGO_URI` (the privileged index connection) and the `ACCEPTANCE_*` test variables. These belong to operator machines and local tests only.

## Vercel project (retained)

Vercel needs no new variables. Its API routes are not configured (`/api/health` there returns 503: no database or JWT), and after cutover it only redirects (`production-deployment-runbook.md`). Do not add `APP_ORIGIN` or database settings to Vercel.
