# Cloud First Deploy (trading-bot)

Use this runbook when you are deploying `trading-bot` to AWS from scratch.
Complete `platform-ops/docs/cloud-first-deploy.md` first. `trading-bot` depends on the shared production host, OpenBao, Redpanda, the observability stack and ingress managed there.

## 0. Read This Before Anything Else

`trading-bot` does not fit on the shared production host, and the delivery path in this repository is built that way on purpose.

| measurement                             | value                        |
| --------------------------------------- | ---------------------------- |
| stack resident memory, measured locally | ~10.6 GiB                    |
| ClickHouse historical store alone       | ~5.57 GiB                    |
| containers in this stack                | 7                            |
| shared production host                  | one t3.large, 2 vCPU / 8 GiB |
| containers already running on that host | 23                           |

A t3.large cannot host this. A t3.xlarge (4 vCPU / 16 GiB) is smaller than the
combined demand once the 23 existing containers are counted, so the first size
that actually fits is a **t3.2xlarge (8 vCPU / 32 GiB)**, or a dedicated host of
that class.

Three separate things enforce that, and all three have to be satisfied before
anything runs in production:

1. `.github/workflows/deploy.yml` has **no release trigger and no push trigger**.
   Merging a pull request or cutting a release cannot deploy `trading-bot`.
   The only way in is `workflow_dispatch`.
2. That dispatch takes a required `capacity_confirmed` input. The first job
   fails unless it is ticked, and prints the table above into the run summary.
3. `scripts/prod-deploy-remote.sh` reads `MemAvailable` on the host and refuses
   to start the stack when less than 12 GiB is free.

If you resize the host and want `trading-bot` deployed on a release instead,
that is a deliberate change to `deploy.yml` and to this section, not an
accident.

## 1. What You Are Building

When this runbook is complete, you will have:

- `trading-bot` control-plane, operator-console, market-data,
  research-backtesting and execution images published to ECR
- a `trading-bot` application deployment running on a host that can hold it
- Postgres and ClickHouse volumes owned by this stack
- runtime secrets stored in OpenBao and SSM
- market-data and execution publishing to the shared platform Kafka broker
- public routing handled by the shared `platform-ops` ingress

## 2. Prerequisites

Run every command in this document from the `trading-bot` repo root unless stated otherwise.

Required:

- `platform-ops` production is already deployed
- the production host has at least 32 GiB of RAM
- OpenBao production is initialized, unsealed, and has `kv` v2 enabled
- Redpanda production is reachable on the shared network
- AWS CLI with access to the target account
- `jq`
- GitHub access to configure repository environments

## 3. Provision The ECR Repositories

This repository ships five images, so it needs five repositories:

- `trading-bot-control-plane`
- `trading-bot-operator-console`
- `trading-bot-market-data`
- `trading-bot-research-backtesting`
- `trading-bot-execution`

Create them with immutable tags, as the other products do. The deploy workflow
reuses an existing tag rather than overwriting it, and signs and scans by
digest.

## 4. Configure The GitHub `production` Environment

In the `trading-bot` GitHub repository, create or update environment `production`.

Required environment variables:

- `AWS_REGION`
- `AWS_ECR_CONTROL_PLANE_REPOSITORY_URI`
- `AWS_ECR_OPERATOR_CONSOLE_REPOSITORY_URI`
- `AWS_ECR_MARKET_DATA_REPOSITORY_URI`
- `AWS_ECR_RESEARCH_BACKTESTING_REPOSITORY_URI`
- `AWS_ECR_EXECUTION_REPOSITORY_URI`
- `AWS_DEPLOY_BUCKET`
- `AWS_DEPLOY_INSTANCE_ID`
- `AWS_SSM_APP_PREFIX`
  - `/trading-bot/prod/app`

Optional:

- `DEPLOY_HEALTHCHECK_URL`
  - the post-deploy smoke job is skipped when this is empty

Required secret:

- `AWS_DEPLOY_ROLE_ARN`

## 5. Review The Tracked Non-Secret Config

`docker/.env.app.prod` is tracked and holds every non-secret production value.
Check these before the first deploy:

- `NEXT_PUBLIC_CONTROL_PLANE_BASE_URL`
  - baked into the operator-console image at build time, so it has to be the
    real public control-plane URL before the image is built
- `EXECUTION_DEFAULT_MODE`
  - `paper` in the tracked file. `live` makes the execution service place real
    orders and additionally requires `BINANCE_API_KEY` and `BINANCE_API_SECRET`
    in OpenBao
- `SCHEDULED_BACKTESTS_ENABLED`
  - `false` in the tracked file. Scheduled backtests replay trades out of
    ClickHouse on a timer, which is the most expensive thing this stack does
- `HISTORICAL_KLINE_RETENTION_DAYS` and `HISTORICAL_TRADE_RETENTION_DAYS`
  - these bound how far the ClickHouse volume grows

## 6. Create The OpenBao Secret `kv/trading-bot`

Create secret path `kv/trading-bot` in the OpenBao production UI.

Add these keys:

- `POSTGRES_PASSWORD`
  - production database password for `trading-bot`
- `HISTORICAL_STORE_PASSWORD`
  - production ClickHouse password for `trading-bot`

Only when `EXECUTION_DEFAULT_MODE=live`:

- `BINANCE_API_KEY`
- `BINANCE_API_SECRET`

The deploy script reads the Binance pair only in live mode, and fails the
deploy if the mode is live and either key is missing.

## 7. Create The OpenBao Read Policy And App Token

Open an SSM shell on the production EC2 instance:

```bash
aws ssm start-session --profile platform-ops --target <AWS_DEPLOY_INSTANCE_ID> --region <AWS_REGION>
```

Inside that shell, resolve the latest `platform-ops` release directory:

```bash
OPS_DIR="$(ls -1dt /opt/platform-ops/releases/* | head -n1)"
echo "$OPS_DIR"
```

Create the narrow read policy:

```bash
ROOT_TOKEN='paste_openbao_root_token'

sudo docker compose --env-file "$OPS_DIR/docker/.env.ops.prod" -f "$OPS_DIR/docker/compose.ops.prod.yml" exec -T \
  -e BAO_ADDR=http://127.0.0.1:8200 \
  -e BAO_TOKEN="$ROOT_TOKEN" \
  openbao sh -lc "
cat > /tmp/trading-bot-prod-read.hcl <<'EOF'
path \"kv/data/trading-bot\" { capabilities = [\"read\"] }
path \"kv/metadata/trading-bot\" { capabilities = [\"read\"] }
EOF
bao policy write trading-bot-prod-read /tmp/trading-bot-prod-read.hcl
"
```

Create the token:

```bash
TRADING_BOT_OPENBAO_TOKEN="$(
  sudo docker compose --env-file "$OPS_DIR/docker/.env.ops.prod" -f "$OPS_DIR/docker/compose.ops.prod.yml" exec -T \
    -e BAO_ADDR=http://127.0.0.1:8200 \
    -e BAO_TOKEN="$ROOT_TOKEN" \
    openbao bao token create -policy=trading-bot-prod-read -format=json | jq -r '.auth.client_token'
)"
echo "$TRADING_BOT_OPENBAO_TOKEN"
```

Use this app token only for `trading-bot`.

## 8. Store The App Token In SSM

```bash
aws ssm put-parameter \
  --profile platform-ops \
  --name /trading-bot/prod/app/OPENBAO_TOKEN \
  --type SecureString \
  --value "$TRADING_BOT_OPENBAO_TOKEN" \
  --overwrite \
  --region <AWS_REGION>
```

If your prefix differs, use `${AWS_SSM_APP_PREFIX}/OPENBAO_TOKEN`.

## 9. Add The Ingress Routes And DNS Records

Routing lives in `platform-ops`, not here. Two public names are needed, and
both vhosts already exist there:

- `TRADING_BOT_CONSOLE_DOMAIN`, proxied to `trading-bot-operator-console:3000`
- `TRADING_BOT_API_DOMAIN`, proxied to `trading-bot-control-plane:8080`

Both are needed. `NEXT_PUBLIC_CONTROL_PLANE_BASE_URL` in `docker/.env.app.prod`
must match `TRADING_BOT_API_DOMAIN`, because it is baked into the console image
at build time and the browser calls the control plane directly and opens a
WebSocket to it. Changing it after a build means rebuilding, not restarting.

The DNS records are the only part still missing, and they are deliberately
left out: nothing serves either name until the host is resized, so creating
them early only produces 502s. Point them at the production host when you
intend the stack to be reachable.

## 10. Trigger The First Deploy

There is no automatic path. In the GitHub Actions UI:

1. open `Deploy AWS App (EC2 Compose, manual dispatch only)`
2. click `Run workflow`
3. enter the release tag, for example `v0.1.20`
4. tick `capacity_confirmed`

The run fails immediately if the box is not ticked, and the host-side script
fails again if the machine does not actually have the memory.

## 11. Validate The Production Deployment

On the host:

```bash
RELEASE_DIR="$(ls -1dt /opt/trading-bot/releases/* | head -n1)"
sudo docker compose -f "$RELEASE_DIR/docker/compose.app.prod.yml" ps
```

All seven services should be `running`, and the five application services
should be `healthy`.

Check memory headroom immediately after the first deploy:

```bash
free -g
sudo docker stats --no-stream
```

If ClickHouse is the largest consumer, that is expected; it was ~5.57 GiB of
the ~10.6 GiB measured locally.

## 12. Troubleshooting

- **The workflow fails at `Capacity Gate`.** The `capacity_confirmed` input was
  not ticked. That is the gate doing its job.
- **The host-side script exits with "resize before deploying".** The instance
  reports less than 12 GiB of `MemAvailable`. Resize it; do not lower the
  threshold.
- **`Missing required SSM secret`.** Section 8 has not been done, or
  `AWS_SSM_APP_PREFIX` does not match the parameter name.
- **`OpenBao secret is missing required key`.** Section 6 has not been done, or
  the deploy is in `live` mode without the Binance pair.
- **The console shows the wrong control-plane URL.** It is a build argument.
  Fix `NEXT_PUBLIC_CONTROL_PLANE_BASE_URL` in `docker/.env.app.prod` and
  dispatch a new deploy; restarting the container will not change it.
- **ClickHouse never becomes healthy.** Check the three config files under
  `docker/` are present in the release directory; `clickhouse-listen.xml` is
  what makes it bind IPv4 at all.
