# devdeck: Storage (Garage) and Secrets (OpenBao) explorers

> 2026-10-17 · owner: Vrishank Warrier · details Wave 1 plugins `garage` and `openbao` from [`03-plugin-catalog.md`](03-plugin-catalog.md)
> Design sample: [`ui-design/storage.html`](../ui-design/storage.html) · [`ui-design/secrets.html`](../ui-design/secrets.html)

---

## 1. The job

See everything in local Garage and OpenBao, and **view, add, edit and delete** it from devdeck, **without opening OpenBao's web UI or exposing either service to the network**.

---

## 2. What runs today (infrabot-backend-service `docker-compose.yml`)

| | Garage | OpenBao |
|---|---|---|
| Image | `dxflrs/garage:v0.9.4` (Helm uses v1.0.1) | `openbao/openbao:latest` (unpinned) |
| Ports | S3 `3900`, admin API `3903` | API `8200` |
| Setup | `garage-init` creates bucket `infrabot-artifacts` + dev key | **dev mode**: root token, **in-memory**, KV v2 at `secret/` |
| Used by | backend `storage/backend/garage.go` (keys like `uploads/<tenant>/<ts>-<id>-<name>`) | backend `secret/vault/*` (KV v2 Put/Get/GetMetadata under a mount) |

**Fix these in infrabot (separate from devdeck):**
1. **Ports are published on every network interface.** `"8200:8200"`, `"3900:3900"` and `"3903:3903"` make OpenBao (root token) and Garage's admin API reachable from the office LAN. Change to `"127.0.0.1:8200:8200"`, `"127.0.0.1:3900:3900"`, `"127.0.0.1:3903:3903"` in both `docker-compose.yml` and `docker-compose.local.yaml`.
2. **Pin `openbao/openbao:latest`** to a version.
3. **Dev mode wipes secrets on restart.** Fine for local, and devdeck's Snapshot/Restore (§4) covers it. A persistent file-storage OpenBao config is the alternative.

---

## 3. How devdeck connects (nothing exposed)

```
devdeck UI (browser / desktop window)
   │  localhost only (127.0.0.1 + Host/Origin check, plan §6.1)
   ▼
devdeck Go core ── garage plugin ──▶ Garage S3 API :3900 (aws-sdk-go-v2 / minio-go)
                │                 └▶ Garage admin API :3903 (bearer admin token)
                └─ openbao plugin ──▶ OpenBao API :8200 (openbao/api/v2 client)
```

- **The browser never talks to Garage or OpenBao directly.** Only the Go core does. Tokens and keys live in Windows Credential Manager (connections), never in the page.
- **OpenBao's own UI stays off.** devdeck uses the HTTP API.
- **Least-privilege connections.** Browsing uses a `devdeck-ro` policy and a read-only Garage key. Write actions need the write connection, local env only (`uat`/`prod` connections are read-only, plan catalog §8).
- **Secret values** are fetched only when you click **Reveal** or **Copy**, re-masked after 20 s, never logged, never in notifications, never sent to Claude or MCP (names only).

---

## 4. Features

### Storage (Garage)

| Area | What you can do | API |
|---|---|---|
| Header | health (quorum), version, buckets / objects / bytes | admin `/health`, `/v1/bucket` (v0.9 admin API v1; v2 for Garage ≥ 2.0) |
| Buckets | list with size, create (name validation), delete (empty only; Garage refuses non-empty) | admin `POST/DELETE /v1/bucket` |
| Object browser | folders (prefixes), breadcrumbs, filter, sizes, types, modified | S3 `ListObjectsV2` with delimiter |
| Preview | text / YAML / JSON / CSV (first 4 KB), images, metadata (size, type, ETag, key) | S3 `GetObject` (range) / `HeadObject` |
| Upload | button or drag-and-drop, into the current folder | S3 `PutObject` (multipart above 16 MB) |
| Folders | create (zero-byte `name/` marker), delete with object count confirm | S3 `PutObject` / batched `DeleteObjects` |
| Delete / download | per object, in-place confirm | S3 `DeleteObject` / presigned `GetObject` |
| Access keys | list, create, delete, secret masked + reveal, per-bucket R / W / Owner toggles | admin `/v1/key`, `/v1/bucket/allow`, `/v1/bucket/deny` |

### Secrets (OpenBao)

| Area | What you can do | API |
|---|---|---|
| Header | seal status, dev-mode / in-memory warning, secrets / versions / policies | `sys/health`, `sys/seal-status` |
| Tree | paths under `secret/` as folders, search, version count per secret | KV v2 `LIST secret/metadata/*` |
| View | keys with masked values; reveal / copy per value | KV v2 `GET secret/data/<path>?version=n` |
| Versions | switch versions, see created/updated | KV v2 `GET secret/metadata/<path>` |
| Edit | key/value editor (values masked while typing, toggle to show); **Save creates the next version** (check-and-set) | KV v2 `POST secret/data/<path>` with `cas` |
| New secret | path + key/values, validation | KV v2 `POST secret/data/<path>` with `cas=0` |
| Delete | **soft delete** a version (undelete available), **destroy** a version (permanent), **delete secret** (all versions + metadata), each with in-place confirm | `POST secret/delete`, `secret/undelete`, `secret/destroy`, `DELETE secret/metadata/<path>` |
| Policies | view HCL (read-only in devdeck) | `sys/policies/acl` |
| Snapshot / Restore | save every secret **encrypted with your Windows login (DPAPI)** in devdeck's store; restore after the dev container restarts | KV v2 read all + write back |

---

## 5. Links from the rest of devdeck

- **Flow trace**: a `garage` or `openbao` hop opens the object or secret path here (plan 04 §6a).
- **Home**: Garage and OpenBao nodes on the 3D map, with health from these plugins.
- **Doctor**: warns when ports are bound to `0.0.0.0`, when OpenBao is sealed, when tags are `:latest`, and when the Garage version differs from Helm.
- **Notifications**: OpenBao sealed, Garage quorum lost, bucket near quota.

---

## 6. Phasing

Part of **Phase 6b (Infrastructure explorers)**:

| Step | Size |
|---|---|
| garage plugin: S3 + admin API clients, health, buckets, browse, preview | M |
| garage write actions: upload (multipart), folders, delete, keys + permissions | M |
| openbao plugin: health/seal, tree, view, versions, policies | S–M |
| openbao write actions: edit with CAS, new, delete/undelete/destroy, snapshot/restore (DPAPI) | M |
| UI pages (from the design sample) on the real API | M |

**Done when**: against infrabot's local compose, you can upload a playbook to `infrabot-artifacts`, preview it, delete it; create, edit (new version), soft-delete, undelete and destroy a secret; restore all secrets after `docker restart dev-openbao`. All of this works with OpenBao's web UI unused and with both services bound to `127.0.0.1`.
