# Bassin widget API server for umbrelOS

Lightweight, zero-runtime-dependency HTTP widget server bridging [Bassin](https://github.com/blockdyor/bassin) (CKPool solo) and the umbrelOS dashboard.

## Endpoints

| Endpoint | Widget type | Description |
| --- | --- | --- |
| `GET /widgets/pool` | `four-stats` | Pool 5m hashrate (with scientific-notation normalization), active worker count, round best share, and total accepted shares. Falls back to `-` if `pool.status` is stale. |
| `GET /widgets/workers` | `list` | **Worker Best Diff Leaderboard** — ranks workers across `/users/` by all-time best share difficulty (`bestever`), showing rank, worker name, best diff ever, and live 5m hashrate (or `Idle`). |
| `GET /widgets/hashrate` | `four-stats` | Pool hashrate averages (`1m`, `5m`, `1h`, `24h`). |
| `GET /health` | JSON | Container health probe (`{"status":"ok"}`). |

## Environment variables

| Variable | Default | Description |
| --- | --- | --- |
| `BASSIN_API_POOL_URL` | *(required)* | URL to CKPool's `pool.status` (e.g. `http://bassin_ui_1:8080/pool/pool.status`) |
| `BASSIN_API_USERS_URL` | Derived from `BASSIN_API_POOL_URL` (`/users/`) | Optional override for the CKPool `/users/` directory index URL |
| `BASSIN_STALE_SECONDS` | `300` | Seconds after `lastupdate` before pool widgets treat stats as stale |
| `BASSIN_WIDGET_MAX_WORKERS` | `5` | Maximum workers shown in the `/widgets/workers` leaderboard |
| `PORT` | `3000` | HTTP listen port |

## Verify locally

```sh
npm ci --ignore-scripts
npm run typecheck
npm test
```

## Container

Compiled with Bun (`oven/bun:1.4.5-slim`) into a standalone multi-arch binary (`linux/amd64` + `linux/arm64`) running as non-root (`65532:65532`) on a digest-pinned Chainguard `glibc-dynamic` distroless runtime with SBOM and provenance attestations.
