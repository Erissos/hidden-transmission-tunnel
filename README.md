# Hidden Transmission Tunnel

Hidden Transmission Tunnel is a privacy-first, anonymous, real-time messaging platform built around private channel codes such as XRT-4821 or ABC-0934. Rooms are not publicly discoverable, only administrators can create them, and clients derive room encryption keys locally before exchanging ciphertext over a FastAPI WebSocket relay.

## Current MVP

This repository now contains a working full-stack scaffold with these implemented pieces:

- FastAPI backend with async WebSocket relay
- Admin-only room creation endpoint
- Restricted admin panel with backend-enforced IP allowlist and admin key gate
- Room join flow based on private channel codes
- Redis-backed presence tracking, brute-force throttling, and per-room event fan-out
- Optional encrypted message persistence interface for MongoDB with TTL indexes
- Next.js frontend with a dark, minimal anonymous chat UI
- Client-side end-to-end encryption using the browser Web Crypto API
- Per-message digital signatures generated and verified on the client
- Local-only anonymous identity bootstrap and panic mode
- Self-destruct timers handled client-side

## Security Model

The server is designed to authorize access and relay ciphertext, not plaintext.

- Room discovery: impossible without the room code and admin-created room metadata
- Room identifiers: derived from the code with an HMAC-based irreversible identifier
- Message confidentiality: messages are encrypted in the browser before transmission
- Message integrity: messages are signed client-side and verified client-side
- Key handling: the room encryption key is derived in the client from room code + room salt
- Backend storage: when enabled, only encrypted envelopes are stored in MongoDB
- Message retention: stored envelopes are deleted automatically with TTL indexes
- Presence and rate limiting: handled in Redis with short-lived operational state
- PII minimization: no email requirement, no profile requirement, no persistent IP/device storage in application code
- Admin surface protection: backend verifies both admin key and source IP allowlist before exposing room management actions

## Important Boundary Conditions

The current implementation is a secure MVP, not a finished hardened platform.

- Transport security still depends on deploying behind HTTPS/WSS
- Forward secrecy is not yet implemented
- WebRTC voice and TURN integration are planned, not implemented
- Silent moderation and shadow banning are planned, not implemented
- File/image transfer is planned, not implemented
- The frontend currently uses Web Crypto instead of libsodium because this stack builds cleanly in Next.js without bundler breakage while preserving client-side E2EE and signatures
- Abuse prevention is intentionally metadata-light, so advanced anti-abuse controls still need a production pass

## Architecture

### Backend

- Framework: FastAPI
- Runtime model: fully async request and WebSocket handling
- State: Redis for presence, throttling, room metadata, and pub/sub distribution
- Persistence: MongoDB optional, encrypted payloads only

Core backend modules:

- [backend/app/main.py](backend/app/main.py): application bootstrap, REST routes, WebSocket endpoint
- [backend/app/services/room_service.py](backend/app/services/room_service.py): room creation and join lookup
- [backend/app/services/rate_limiter.py](backend/app/services/rate_limiter.py): Redis-backed throttling
- [backend/app/services/event_bus.py](backend/app/services/event_bus.py): Redis pub/sub fan-out for horizontal scaling
- [backend/app/services/message_store.py](backend/app/services/message_store.py): encrypted message persistence abstraction
- [backend/app/core/security.py](backend/app/core/security.py): room identifiers, random nicknames, join tickets

### Frontend

- Framework: Next.js App Router
- Crypto boundary: browser-only
- Identity model: local-only anonymous signing identity stored in browser storage

Core frontend modules:

- [frontend/app/page.tsx](frontend/app/page.tsx): room join flow and chat UI
- [frontend/app/admin/page.tsx](frontend/app/admin/page.tsx): restricted admin panel for room provisioning
- [frontend/lib/crypto.ts](frontend/lib/crypto.ts): key derivation, encryption, signing, verification
- [frontend/lib/api.ts](frontend/lib/api.ts): backend join and WebSocket URL helpers
- [frontend/lib/session.ts](frontend/lib/session.ts): local anonymous identity persistence and panic wipe

## Protocol Summary

1. Admin creates a room with a private code.
2. Backend stores only derived room metadata and a random room salt in Redis.
3. User submits a room code to join.
4. Backend validates access, assigns a random nickname like ghost_a8f3x, and returns a short-lived WebSocket ticket plus room salt.
5. Client derives the room encryption key locally from room code + room salt.
6. Client opens a WebSocket connection and shares its ephemeral signing public key.
7. Every chat message is encrypted locally, signed locally, and transmitted as ciphertext.
8. Backend relays the encrypted envelope through Redis-backed event distribution.
9. Receiving clients verify the signature and decrypt locally.

## Project Structure

```text
.
├── backend
│   ├── app
│   │   ├── core
│   │   ├── schemas
│   │   ├── services
│   │   └── ws
│   └── pyproject.toml
├── frontend
│   ├── app
│   ├── lib
│   ├── package.json
│   └── next.config.ts
├── .env.example
└── docker-compose.yml
```

## Local Development

### 1. Infrastructure

Start Redis and MongoDB:

```powershell
docker compose up -d redis mongodb
```

### 2. Backend

Install dependencies and run the API:

```powershell
cd backend
python -m pip install -e .
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000 --no-access-log
```

### 3. Frontend

Install dependencies and run the UI:

```powershell
cd frontend
npm install
npm run dev
```

### 4. Environment

Copy values from [/.env.example](.env.example) into a local .env file at repository root and change at least these values:

- HTT_ADMIN_API_KEY
- HTT_ADMIN_ALLOWED_IPS
- HTT_TRUST_PROXY_HEADERS
- HTT_APP_SECRET
- HTT_ALLOWED_ORIGINS
- NEXT_PUBLIC_API_BASE_URL

## Admin Workflow

There are now two admin entry points:

- API-only room creation via the backend endpoint
- Restricted web panel at /admin

The web panel still depends on backend authorization. A user only gains access when both conditions are true:

- the request comes from an IP inside HTT_ADMIN_ALLOWED_IPS
- the correct admin key is entered in the panel

If the backend is behind a trusted reverse proxy, set HTT_TRUST_PROXY_HEADERS=true so the allowlist can use the forwarded client IP.

Room creation is intentionally restricted. Example request:

```powershell
Invoke-RestMethod \
	-Method Post \
	-Uri http://localhost:8000/api/v1/admin/rooms \
	-Headers @{ "x-admin-key" = "replace-with-a-long-random-secret" } \
	-ContentType "application/json" \
	-Body '{"room_code":"XRT-4821","ttl_seconds":86400,"persist_messages":false}'
```

Users then enter the same room code in the frontend to connect.

## Validation Completed

The current scaffold was validated with:

- Backend import smoke test
- Backend Ruff lint pass
- Frontend dependency install
- Frontend production build

## Recommended Next Steps

1. Move from room-code-derived long-lived room keys to session ratcheting for forward secrecy.
2. Add encrypted image/file transfer with client-side chunk encryption.
3. Add WebRTC voice signaling plus TURN-only relay mode to reduce IP leakage.
4. Add silent moderation and metadata-only admin controls.
5. Add security tests for replay resistance, brute-force protection, and envelope tampering.
