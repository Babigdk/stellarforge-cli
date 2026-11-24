# {{projectName}}

Generated with the StellarForge `full-stack` template.

## Structure

```text
frontend/   Browser-facing application boundary, starter page, styles, and tests
backend/    Node.js API/runtime boundary and tests
contracts/  Soroban contract workspace boundary
```

The starter keeps these layers separate so application UI, server-side Stellar integration, and smart-contract code can evolve independently.

## Requirements

- Node.js 22.13 or newer

## Validate the starter

```bash
npm run check
npm test
```

These checks are dependency-free and do not require network access.

## Scripts

| Script                  | Purpose                                                                |
| ----------------------- | ---------------------------------------------------------------------- |
| `npm run check`         | Syntax-checks the frontend and backend entry points.                   |
| `npm test`              | Runs the frontend and backend test files with the Node.js test runner. |
| `npm run start:backend` | Starts the backend server.                                             |

The starter has no build step and no runtime dependencies; `frontend/src/app.js` is plain ES module code that a host page or bundler can import.

## Run the backend

```bash
npm run start:backend
```

The backend exposes `GET /health` and static frontend assets on `127.0.0.1:3000` by default. Open `http://127.0.0.1:3000/index.html` for the generated starter UI, or import `frontend/src/app.js` from your own page. Set `BACKEND_PORT` to override the port. The frontend has no server and no port variable at all.

### Local health endpoint contract

`GET http://127.0.0.1:3000/health` returns a minimal JSON contract. A healthy response is HTTP `200`:

```json
{
  "status": "ok",
  "version": 1
}
```

If the health handler fails, the endpoint returns HTTP `503` with:

```json
{
  "status": "unavailable",
  "version": 1
}
```

The `version` field identifies the health response contract, not the application release. Frontends must treat an absent or unsupported version, a missing/unknown status, malformed JSON, or a non-success HTTP response as unavailable. Additional response fields are ignored. Keep this public payload limited to `status` and `version`; do not add environment values, endpoint URLs, credentials, filesystem paths, or diagnostic details. A future incompatible contract change must increment `version` and update the generated frontend and tests together.

Unexpected non-health route handler failures return HTTP `500` with the generic body `{ "error": "internal_error" }`; exception messages and stack details are not sent to clients.

The starter page checks `GET /health` once on load. Its live status region announces `checking backend`, `backend healthy`, or `backend unavailable` as text, so status is not conveyed by color alone. If the backend is unavailable, activate the **Retry backend status** button to try again; the button is disabled while a request is in flight, and the page never polls automatically.

On `SIGINT` or `SIGTERM`, the backend stops accepting new connections, drains active requests for up to five seconds, and then closes remaining connections so a stuck request cannot keep the process alive. Repeated signals do not start a second shutdown.

If the configured port is already in use, startup fails with a raw Node error such as:

```text
Error: listen EADDRINUSE: address already in use 127.0.0.1:3000
```

That message is printed by the operating system, not by the backend. The port shown in the error matches `BACKEND_PORT` (or the `3000` default when it is not set), and the bind address is always `127.0.0.1`.

Resolve it safely by either changing the port or stopping only a process you recognize as your own:

1. Change the port:
   - the backend does not automatically load `.env`, so set `BACKEND_PORT` in your environment or in the environment manager of your choice (for example `BACKEND_PORT=3100 npm run start:backend`);
2. Or find and stop only the process you recognize as your own previous instance:
   - Windows: `netstat -ano | findstr :3000` shows the owning PID; stop it with `taskkill /PID <pid> /T`;
   - macOS/Linux: `lsof -i :3000` shows the owning process; stop it with `kill <pid>`;
   - inspect what the process actually is first — handle only the one you started yourself, for example an earlier instance of this backend;
   - never kill arbitrary processes that happen to hold the port; prefer the owning PID you found above (`taskkill /PID <pid>` or `kill <pid>`) and avoid killing by process name, broad `pkill` matching, or SIGKILL-style forced termination.

The backend never hops ports automatically; it always binds exactly the configured port, which makes collisions visible instead of hiding on a random one. This starter targets Stellar Testnet only; it does not configure or claim Mainnet or hosted deployment support.

## API Boundaries and Request Handling

The generated backend enforces deterministic, minimal HTTP boundaries without external framework overhead:

- **Method boundaries:** Routes enforce explicit allowed methods (`GET, HEAD` on `/health`, `POST` on `/api/echo`). Unsupported methods return a deterministic `405 Method Not Allowed` with an `Allow` header and `{ "error": "method_not_allowed" }`.
- **Unknown routes:** Requests to unmapped paths return a safe `404 Not Found` response (`{ "error": "not_found" }`) with no internal stack or environment reflection.
- **Request size bounds:** Incoming request bodies are constrained by `MAX_REQUEST_BODY_BYTES` (64 KiB default). Payloads exceeding this bound (either via `Content-Length` or chunked transfer streaming) are rejected immediately with `413 Payload Too Large` before unbounded memory buffering.
- **Content type & JSON validation:** JSON endpoints require `application/json` (returning `415 Unsupported Media Type` otherwise) and explicitly handle malformed JSON syntax with `400 Bad Request` (`{ "error": "malformed_json" }`).
- **Security headers:** Responses include baseline `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, and `Referrer-Policy: strict-origin-when-cross-origin`.

### Response security headers and production deployment

The backend applies conservative baseline HTTP security headers across API and static asset responses:

- `X-Content-Type-Options: nosniff` — prevents MIME type sniffing of responses and static files;
- `X-Frame-Options: DENY` — defends against clickjacking across application boundaries;
- `Referrer-Policy: strict-origin-when-cross-origin` — retains origin semantics for same-origin requests while protecting cross-origin navigation.

To keep loopback development seamless, HTTP Strict Transport Security (`Strict-Transport-Security`) is not enabled for plain HTTP development, and no restrictive Content-Security-Policy (CSP) is imposed that would break starter UI integrations.

Production deployments must implement deployment-specific security controls:
- Terminate TLS with valid certificates and enable HSTS exclusively over HTTPS;
- Configure reverse proxy headers, CORS policies, and upstream request filtering;
- Author a dedicated Content-Security-Policy (CSP) matching your frontend distribution and asset domains.

## Environment

Copy `.env.example` into your preferred local environment-management flow. The example contains public Stellar Testnet endpoints only and no credentials.

Backend startup validates configuration before opening a socket:

- `BACKEND_PORT` is an integer from `1` to `65535` (default `3000`);
- `STELLAR_NETWORK` must be `TESTNET` (the default);
- `STELLAR_HORIZON_URL` and `STELLAR_RPC_URL` must be absolute `http`/`https` URLs without embedded credentials (defaults are the public Testnet endpoints) and must not point to a non-Testnet network.

Missing values use the documented Testnet defaults. Missing, malformed, or conflicting values fail with field-specific guidance before any bind, so an invalid configuration never partially starts the server. Error messages do not echo environment values or credentials.

Never commit wallet seeds, secret keys, signing credentials, production tokens, or private infrastructure credentials.

## Accessibility checklist

The generated starter page is dependency-free and intended to be usable with a keyboard and assistive technology:

1. Tab from the beginning of the page; the skip link, status button, and controls receive a visible focus outline.
2. Activate **Retry backend status** with `Enter` or `Space`; it is disabled while a status request is in flight.
3. Confirm the screen reader announces heading levels in order (`h1` then `h2`) and announces status changes through the `role="status"` live region.
4. Confirm the status word (`checking backend`, `backend healthy`, or `backend unavailable`) is visible and not indicated only by color.

## Contracts

`contracts/` is intentionally a boundary rather than a fake production contract. Add reviewed Soroban code when the application domain is defined, or generate a dedicated StellarForge `smart-contract` starter for contract-focused work.

## Offline smoke coverage

`npm run check`, `npm test`, and `npm run start:backend` are executed in a freshly generated temporary project. The backend start command is probed on a local loopback port and then stopped by the smoke test; it never contacts a Stellar service. No Stellar CLI, signing identity, credential, or external network access is required.
