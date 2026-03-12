# Streak Tracking

A streak tracking UserApp for [Transport Tycoon](https://tycoon.community/). Captures player streak data from the api, providing a draggable and resizable in-game overlay with backend logging.

## Architecture

- **Frontend** - Vanilla JS overlay that runs inside the game's CEF browser. Polls the API for streak data and renders a draggable/resizable panel.
- **Backend** - Fastify server that receives streak events, deduplicates them, stores them in MongoDB, and forwards them to Discord.
- **Infrastructure** - Docker Compose stack with MongoDB, mongo-express, Cloudflare Tunnel, and the app container.

## Dependencies

The frontend uses backup URLs provided by [tt-proxy](https://github.com/matthew-brough/tt-proxy/tree/master) as fallback endpoints when the primary Transport Tycoon API servers are unreachable.

## Setup

### Prerequisites

- Docker & Docker Compose
- A Cloudflare Tunnel token (for remote access)

### Configuration

Copy `.env.example` to `.env` and fill in the values:

```bash
cp .env.example .env
```

| Variable | Description |
|---|---|
| `CLOUDFLARE_TUNNEL_TOKEN` | Cloudflare Zero Trust tunnel token |
| `MONGO_ROOT_USERNAME` | MongoDB admin username |
| `MONGO_ROOT_PASSWORD` | MongoDB admin password |
| `MONGO_DB` | Database name |
| `MONGO_ROOT_PORT` | MongoDB port (default: `27017`) |
| `WEB_USERNAME` | mongo-express UI username |
| `WEB_PASSWORD` | mongo-express UI password |
| `APP_PORT` | HTTP server port (default: `8000`) |
| `DISCORD_WEBHOOK_URL` | Optional Discord webhook for streak notifications |
| `WEBHOOK_TIMEOUT_MS` | Webhook request timeout in ms (default: `5000`) |

### Running

```bash
docker compose up -d
```

Services:
- **App** - accessible through CF tunnel
- **mongo-express** - `http://localhost:8081`

### Local Development

```bash
npm install
node Tracker/index.js
```

Requires a running MongoDB instance and the relevant env vars set.

## API

### `POST /api/streak`

Accepts a streak event. Deduplicates against the last known value for the user+streak pair.

```json
{
  "user_id": 12345,
  "streak_name": "EMS Paramedic",
  "streak_value": 10,
  "timestamp": "2026-03-12T00:00:00.000Z"
}
```

Returns `201` on insert, `202` if the value is unchanged (skipped).

### `GET /healthz`

Returns `{ "ok": true }`.

## Overlay Settings

The in-game overlay stores preferences in `localStorage`:

- **Private Key** - Transport Tycoon API key for fetching streak data
- **Telemetry** - Toggle server reporting on/off
- **Refresh Interval** - Minutes between API polls (default: 5)

The panel position and width are also persisted across sessions.
