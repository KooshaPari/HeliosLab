# Journey: Deploying to Production

**Journey ID:** JOURNEY-003  
**Project:** heliosApp  
**Tier:** DEEP  
**Last Updated:** 2026-04-04

---

## Overview

This journey guides operators through deploying heliosApp to production. It covers build optimization, security hardening, monitoring setup, and rollback procedures.

**Prerequisites:**
- Access to deployment infrastructure (AWS/GCP/Azure)
- Docker 24+ installed
- kubectl configured for target cluster
- Helm 3.14+ installed
- Completed [Setting Up heliosApp Development](../setting-up-heliosapp-development.md)

**Estimated Time:** 60-90 minutes

---

## Deployment Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                        Production Infrastructure                      │
│                                                                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                  │
│  │   Load     │  │   CDN       │  │   WAF       │                  │
│  │   Balancer │  │   (Cloudflare)│  │   (AWS WAF)│                  │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘                  │
│         │                │                │                          │
│         └────────────────┼────────────────┘                          │
│                          │                                           │
│                    ┌──────▼──────┐                                   │
│                    │   Ingress   │                                   │
│                    │   Gateway   │                                   │
│                    └──────┬──────┘                                   │
│                           │                                          │
│         ┌─────────────────┼─────────────────┐                        │
│         │                 │                 │                        │
│   ┌─────▼─────┐    ┌─────▼─────┐    ┌─────▼─────┐                  │
│   │  Runtime  │    │  Runtime  │    │  Runtime  │                  │
│   │  Pod #1   │    │  Pod #2   │    │  Pod #3   │                  │
│   └─────┬─────┘    └─────┬─────┘    └─────┬─────┘                  │
│         │                 │                 │                         │
│         └─────────────────┼────────────────┘                         │
│                           │                                          │
│                    ┌──────▼──────┐                                   │
│                    │   SQLite    │                                   │
│                    │   Cluster   │                                   │
│                    └─────────────┘                                   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Step 1: Build Optimization

Before deploying, optimize the production build:

### 1.1 Configure Production Environment

Create `apps/runtime/production.env`:

```bash
# Runtime Configuration
NODE_ENV=production
LOG_LEVEL=info
PORT=2935

# Database
DB_PATH=/data/helios.db
DB_POOL_SIZE=20

# Security
CORS_ORIGINS=https://heliosapp.com
API_KEY_REQUIRED=true
RATE_LIMIT_PER_MINUTE=100

# AI Providers
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
DEFAULT_PROVIDER=anthropic

# Monitoring
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
METRICS_ENABLED=true
```

### 1.2 Build the Application

```bash
# Clean previous builds
bun run clean

# Create production build
bun run build --production
```

**Build Outputs:**
```
apps/runtime/dist/
├── index.js           # Bundled runtime (~2.5MB)
├── protocol/          # LocalBus compiled
├── services/          # Business logic
└── package.json

apps/desktop/dist/
├── index.js           # Desktop shell
├── preload.js         # Preload scripts
└── package.json

apps/renderer/dist/
├── _app/             # SolidJS chunks
├── index.html        # Entry point
└── assets/           # Static assets
```

### 1.3 Analyze Bundle Size

```bash
# Analyze JavaScript bundles
bun run analyze:bundle

# Output
┌─────────────────────────────────────────┐
│ Bundle Analysis                          │
├─────────────────────────────────────────┤
│ apps/runtime/dist/index.js    2.5 MB    │
│ apps/desktop/dist/index.js     1.2 MB    │
│ apps/renderer/dist/_app/      450 KB    │
│ apps/renderer/dist/chunk-v.*. js  180 KB │
├─────────────────────────────────────────┤
│ Total:                          4.35 MB │
└─────────────────────────────────────────┘

# Target: < 5MB
# Status: PASS
```

---

## Step 2: Security Hardening

### 2.1 Container Security

Create `Dockerfile` for runtime:

```dockerfile
FROM oven/bun:1.2.20-alpine AS runtime-base

# Security: Run as non-root user
RUN addgroup -g 1001 -S helios && \
    adduser -S helios -u 1001 -G helios

# Install runtime dependencies
RUN apk add --no-cache \
    bash \
    ca-certificates \
    openssl \
    dumb-init \
    su-exec

# Copy application
COPY --chown=helios:helios apps/runtime/dist /app
COPY --chown=helios:helios apps/runtime/production.env /app/.env

WORKDIR /app

# Drop privileges
USER helios

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget -qO- http://localhost:2935/health || exit 1

EXPOSE 2935

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "index.js"]
```

### 2.2 Pod Security Context

Create `security-policy.yaml`:

```yaml
apiVersion: v1
kind: SecurityContext
metadata:
  name: helios-runtime-security
spec:
  # Container security
  allowPrivilegeEscalation: false
  readOnlyRootFilesystem: true
  runAsNonRoot: true
  runAsUser: 1001
  seccompProfile:
    type: RuntimeDefault
  capabilities:
    drop:
      - ALL
    add:
      - NET_BIND_SERVICE

  # Pod security
  hostNetwork: false
  hostPID: false
  hostIPC: false

  # Network policy
  networkIsolation:
    ingress:
      - from:
          - namespaceSelector:
              matchLabels:
                name: helios-app
        ports:
          - protocol: TCP
            port: 2935
    egress:
      - to:
          - podSelector:
              matchLabels:
                app: helios-db
        ports:
          - protocol: TCP
            port: 5432
      - to:
          - namespaceSelector: {}
        ports:
          - protocol: HTTPS
            port: 443
```

### 2.3 Secret Management

Configure external secrets:

```bash
# AWS Secrets Manager
aws secretsmanager create-secret \
    --name helios-app/anthropic-api-key \
    --secret-string "sk-ant-xxxxx"

# Sync to Kubernetes
kubectl create namespace helios-app
helm install external-secrets \
    external-secrets/external-secrets \
    --namespace external-secrets

# Create ExternalSecret
cat <<EOF | kubectl apply -f -
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: helios-secrets
  namespace: helios-app
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: aws-secrets-manager
    kind: ClusterSecretStore
  target:
    name: helios-secrets
    creationPolicy: Owner
  data:
    - secretKey: ANTHROPIC_API_KEY
      remoteRef:
        key: helios-app/anthropic-api-key
EOF
```

---

## Step 3: Deploy to Kubernetes

### 3.1 Helm Chart Structure

```
helm/
└── helios-app/
    ├── Chart.yaml
    ├── values.yaml
    ├── values.production.yaml
    ├── templates/
    │   ├── deployment.yaml
    │   ├── service.yaml
    │   ├── ingress.yaml
    │   ├── hpa.yaml
    │   ├── pdb.yaml
    │   ├── configmap.yaml
    │   └── secret.yaml
    └── .helmignore
```

### 3.2 Configure Production Values

Create `values.production.yaml`:

```yaml
# Application configuration
app:
  name: helios-app
  version: "2026.03A.0"
  environment: production

# Runtime replica configuration
runtime:
  replicaCount: 3
  
  image:
    repository: ghcr.io/kooshaPari/heliosApp
    tag: "2026.03A.0"
    pullPolicy: IfNotPresent
  
  resources:
    requests:
      cpu: 500m
      memory: 1Gi
    limits:
      cpu: 2000m
      memory: 4Gi
  
  autoscaling:
    enabled: true
    minReplicas: 3
    maxReplicas: 10
    targetCPUUtilizationPercentage: 70
    targetMemoryUtilizationPercentage: 80

# Database configuration
database:
  enabled: true
  type: sqlite  # Use managed SQLite for MVP
  storage: 50Gi
  storageClass: gp3

# Network configuration
network:
  port: 2935
  ingress:
    enabled: true
    className: nginx
    host: api.heliosapp.com
    tls:
      enabled: true
      secretName: helios-tls-cert

# Security configuration
security:
  corsOrigins:
    - https://heliosapp.com
    - https://www.heliosapp.com
  
  rateLimit:
    enabled: true
    requestsPerMinute: 100
  
  apiKeyRequired: true

# Monitoring configuration
monitoring:
  prometheus:
    enabled: true
    scrapeInterval: 15s
  
  grafana:
    enabled: true
    dashboardLabels:
      app: helios
  
  tracing:
    enabled: true
    samplingRate: 0.1

# Health check configuration
health:
  livenessProbe:
    path: /health
    initialDelaySeconds: 30
    periodSeconds: 10
    failureThreshold: 3
  
  readinessProbe:
    path: /ready
    initialDelaySeconds: 5
    periodSeconds: 5
    failureThreshold: 3
```

### 3.3 Deploy with Helm

```bash
# Add Helm repository
helm repo add bitnami https://charts.bitnami.com/bitnami
helm repo update

# Install with production values
helm upgrade --install helios-app ./helm/helios-app \
    --namespace helios-app \
    --create-namespace \
    --values ./helm/helios-app/values.production.yaml \
    --timeout 10m \
    --wait

# Verify deployment
kubectl get pods -n helios-app
```

**Expected Output:**
```
NAME                              READY   STATUS    RESTARTS   AGE
helios-app-runtime-7d8f9c6b4-abc1  1/1     Running   0          2m
helios-app-runtime-7d8f9c6b4-def2  1/1     Running   0          2m
helios-app-runtime-7d8f9c6b4-ghi3  1/1     Running   0          2m
```

---

## Step 4: Configure Monitoring

### 4.1 Set Up Prometheus Metrics

The runtime exposes metrics at `/metrics`:

```bash
# Verify metrics endpoint
kubectl exec -n helios-app deploy/helios-app-runtime -- \
    curl http://localhost:2935/metrics
```

**Exposed Metrics:**
```
# HELP helios_bus_dispatch_total Total LocalBus dispatches
# TYPE helios_bus_dispatch_total counter
helios_bus_dispatch_total{method="terminal.spawn"} 1523

# HELP helios_pty_active Current active PTY count
# TYPE helios_pty_active gauge
helios_pty_active 12

# HELP helios_session_active Current active sessions
# TYPE helios_session_active gauge
helios_session_active 8

# HELP helios_provider_request_duration_seconds Provider request latency
# TYPE helios_provider_request_duration_seconds histogram
helios_provider_request_duration_seconds_bucket{provider="anthropic",le="1"} 1450
```

### 4.2 Create Grafana Dashboard

Import the heliosApp dashboard from `deploy/grafana/helios-overview.json`:

```bash
# Apply dashboard configmap
kubectl apply -f deploy/grafana/helios-dashboard.yaml -n helios-app

# Verify dashboard available
kubectl get configmap -n helios-app | grep helios
```

### 4.3 Set Up Alerting

Create alert rules in `deploy/prometheus/alerts.yaml`:

```yaml
apiVersion: monitoring.coreos.com/v1
kind: PrometheusRule
metadata:
  name: helios-alerts
  namespace: helios-app
spec:
  groups:
    - name: helios-app
      rules:
        - alert: HighErrorRate
          expr: |
            rate(helios_http_requests_total{status=~"5.."}[5m]) > 0.05
          for: 2m
          labels:
            severity: critical
          annotations:
            summary: "High error rate detected"
            description: "Error rate is {{ $value | humanizePercentage }}"

        - alert: HighLatency
          expr: |
            histogram_quantile(0.95, 
              rate(helios_provider_request_duration_seconds_bucket[5m])
            ) > 2
          for: 5m
          labels:
            severity: warning
          annotations:
            summary: "High API latency"
            description: "p95 latency is {{ $value }}s"

        - alert: ProviderDown
          expr: |
            helios_provider_healthy == 0
          for: 1m
          labels:
            severity: critical
          annotations:
            summary: "AI Provider unavailable"
            description: "All providers are unhealthy"
```

---

## Step 5: Verify Deployment

### 5.1 Run Smoke Tests

```bash
# Get ingress endpoint
INGRESS=$(kubectl get ingress -n helios-app -o jsonpath='{.items[0].status.loadBalancer.ingress[0].hostname}')

# Test health endpoint
curl -s https://$INGRESS/health | jq .

# Expected response:
{
  "status": "healthy",
  "version": "2026.03A.0",
  "uptime": 120,
  "checks": {
    "database": "ok",
    "providers": "ok"
  }
}
```

### 5.2 Test LocalBus End-to-End

```bash
# Test LocalBus dispatch via HTTP
curl -s -X POST https://$INGRESS/v1/protocol/dispatch \
    -H "Content-Type: application/json" \
    -H "X-API-Key: $HELIOS_API_KEY" \
    -d '{
      "envelope": {
        "id": "env_test",
        "correlation_id": "cor_test",
        "type": "command",
        "method": "workspace.list",
        "payload": {},
        "context": {},
        "timestamp": '$(date +%s000)'
      }
    }' | jq .
```

### 5.3 Verify Database Connectivity

```bash
# Check database replication lag
kubectl exec -n helios-app deploy/helios-app-runtime -- \
    sqlite3 /data/helios.db "SELECT * FROM audit_events ORDER BY timestamp DESC LIMIT 1;"
```

---

## Step 6: Configure Rollback

### 6.1 Automatic Rollback

Configure in Helm values:

```yaml
rollback:
  automatic: true
  failureThreshold: 3
  checkInterval: 30s
```

### 6.2 Manual Rollback Procedure

```bash
# List deployment history
helm history helios-app -n helios-app

# Rollback to previous revision
helm rollback helios-app -n helios-app

# Rollback to specific revision
helm rollback helios-app 5 -n helios-app

# Verify rollback
kubectl rollout status deployment/helios-app-runtime -n helios-app
```

### 6.3 Blue-Green Deployment

For zero-downtime deployments:

```bash
# Deploy new version alongside current
helm upgrade --install helios-app-new ./helm/helios-app \
    --namespace helios-app \
    --values ./helm/helios-app/values.production.yaml \
    --set app.version=2026.04A.0 \
    --wait

# Run smoke tests against new version
# If tests pass, switch traffic:

kubectl patch service helios-app-service \
    -n helios-app \
    -p '{"spec":{"selector":{"app":"helios-app-new"}}}'

# Monitor for 5 minutes
# If issues detected, rollback:
kubectl patch service helios-app-service \
    -n helios-app \
    -p '{"spec":{"selector":{"app":"helios-app"}}}'
```

---

## Step 7: Post-Deployment Verification

### 7.1 Run Integration Tests

```bash
# Execute production smoke tests
kubectl run smoke-test \
    --image=ghcr.io/kooshaPari/heliosApp:smoke-test \
    --restart=Never \
    -n helios-app \
    --wait

# Check test results
kubectl logs smoke-test -n helios-app
```

### 7.2 Verify Observability

1. **Check Grafana:** Confirm metrics flowing
2. **Check Jaeger:** Confirm traces appearing
3. **Check Loki:** Confirm logs indexed
4. **Check PagerDuty:** Confirm alerts routing

### 7.3 Update DNS

Point DNS to new ingress:

```bash
# Cloudflare DNS update
cf-cli dns-record-create \
    --zone=heliosapp.com \
    --type=CNAME \
    --name=api \
    --content=$INGRESS \
    --ttl=300
```

---

## Rollback Checklist

If issues are detected:

- [ ] 1. Verify issue scope (single pod, all pods, or external)
- [ ] 2. Check recent changes (deployment, config, secrets)
- [ ] 3. If deployment-related, execute `helm rollback`
- [ ] 4. Verify pod restarts healthy
- [ ] 5. Monitor error rates return to normal
- [ ] 6. Document incident in postmortem

---

## Summary

You have successfully deployed heliosApp to production:

| Component | Status | Endpoint |
|-----------|--------|----------|
| Runtime Cluster | Running | api.heliosapp.com |
| Monitoring | Active | grafana.heliosapp.com |
| Alerting | Configured | PagerDuty integrated |
| Database | Healthy | SQLite cluster replicated |
| TLS | Valid | Expires in 90 days |

**Next Steps:**
- Set up continuous deployment pipeline
- Configure backup strategy
- Schedule regular security audits

---

*Document Version: 1.0*  
*Maintainer: Phenotype SRE*
