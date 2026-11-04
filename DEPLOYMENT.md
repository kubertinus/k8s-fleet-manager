# K8s Fleet Manager Kubernetes Deployment Guide

K8s Fleet Manager was called **Kubertinus** before. Upgrading an existing Kubertinus
installation? Follow [Migrating from Kubertinus](#migrating-from-kubertinus).

## Prerequisites
- Kubernetes cluster with the [CloudNativePG](https://cloudnative-pg.io) operator (for PostgreSQL)
- An ingress controller (nginx) and DNS for the host in `deploy/ingress.yaml`
- kubectl configured

## Deployment Steps

### 1. Build and Push Docker Image
```bash
./build-dockerhub.sh    # builds kubertinus/k8s-fleet-manager:<version> and :latest (amd64)
docker push kubertinus/k8s-fleet-manager:<version>
docker push kubertinus/k8s-fleet-manager:latest
```

### 2. Create the namespace, database and secrets
Secrets are not stored in Git; see `deploy/secrets.example`.
```bash
kubectl apply -f deploy/namespace.yaml
kubectl apply -f deploy/database.yaml

# Signing key for login tokens (changing it logs everyone out)
kubectl -n k8s-fleet-manager create secret generic k8s-fleet-manager-secrets \
  --from-literal=NEXTAUTH_SECRET="$(openssl rand -hex 32)"

# TLS certificate for the ingress host (or let cert-manager issue it)
kubectl -n k8s-fleet-manager create secret tls k8s-fleet-manager-tls --cert=fullchain.pem --key=privkey.pem
```
CloudNativePG creates the Secret `k8s-fleet-manager-postgres-app` with the database connection
(`uri`); the app reads `DATABASE_URL` from it.

### 3. Deploy the application
```bash
kubectl apply -f deploy/
```
This applies the namespace, database, Deployment, Service and Ingress
(`secrets.example` is skipped: it has no `.yaml` extension).

The app itself needs no Kubernetes permissions: it reaches every cluster through the
kubeconfigs and talosconfigs you add in Settings. No ServiceAccounts or RBAC objects are
created.

### 4. Verify Deployment
```bash
kubectl get pods -n k8s-fleet-manager
kubectl logs -f deployment/k8s-fleet-manager-app -n k8s-fleet-manager
kubectl port-forward svc/k8s-fleet-manager-app 3000:80 -n k8s-fleet-manager
curl http://localhost:3000/api/health
```

## Migrating from Kubertinus

The rename moves everything to a new namespace with its own database. The steps below copy the
data from the old installation, then remove it. Plan a short downtime (a few minutes).

```bash
OLD_NS=kubertinus
NEW_NS=k8s-fleet-manager

# 1. Stop the old app so the data doesn't change during the copy
kubectl -n $OLD_NS scale deployment/kubertinus-app --replicas=0

# 2. New namespace, database and secrets (see step 2 above), then wait for the database
kubectl apply -f deploy/namespace.yaml -f deploy/database.yaml
kubectl -n $NEW_NS wait cluster/k8s-fleet-manager-postgres --for=condition=Ready --timeout=10m
kubectl -n $NEW_NS create secret generic k8s-fleet-manager-secrets \
  --from-literal=NEXTAUTH_SECRET="$(openssl rand -hex 32)"
# TLS secret k8s-fleet-manager-tls for the new host, see step 2 above

# 3. Copy the data from the old database to the new one
OLD_DB=$(kubectl -n $OLD_NS get pod -l cnpg.io/cluster=kubertinus-postgress,cnpg.io/instanceRole=primary -o name)
NEW_DB=$(kubectl -n $NEW_NS get pod -l cnpg.io/cluster=k8s-fleet-manager-postgres,cnpg.io/instanceRole=primary -o name)
kubectl -n $OLD_NS exec $OLD_DB -c postgres -- pg_dump -Fc -d kubertinus > kubertinus.dump
kubectl -n $NEW_NS exec -i $NEW_DB -c postgres -- pg_restore --no-owner --role=k8sfleet -d k8sfleet < kubertinus.dump

# 4. Deploy K8s Fleet Manager
kubectl apply -f deploy/
kubectl -n $NEW_NS rollout status deployment/k8s-fleet-manager-app
```

Then:
5. **DNS**: point `k8s-fleet-manager.diersmann.com` at the ingress controller.
6. **Settings in the app** (Settings page, as admin):
   - Authentication → *App hostname*: `https://k8s-fleet-manager.diersmann.com`
   - Antrea flow API URL: replace `.kubertinus.svc` with `.k8s-fleet-manager.svc`, and redeploy the
     adapter with `tools/antrea-flow-adapter/k8s/antrea-flow-adapter.yaml` (new namespace).
7. **Keycloak** (if used): add `https://k8s-fleet-manager.diersmann.com/api/auth/keycloak/callback`
   as a valid redirect URI and the host as web origin of the client. Client roles of the client set
   in the Keycloak settings count as admin roles; the old client name `kubertinus-app` still does too.
8. **Everyone logs in again**: the new `NEXTAUTH_SECRET` invalidates old sessions.
9. **Remove the old installation** once everything works:
   ```bash
   kubectl delete namespace kubertinus
   kubectl delete clusterrolebinding kubertinus-clusterrolebinding
   kubectl delete clusterrole kubertinus-clusterrole
   rm kubertinus.dump
   ```
   This also removes the old database, whose password is in the Git history of `deploy/`.

Unchanged by the rename: node labels `kubertinus.io/disk-size` are still read (the new name is
`k8s-fleet-manager.io/disk-size`), and existing users, clusters, settings and image reports move
along with the database.

## Troubleshooting

### Common Issues

1. **Client-side exception error**:
   - Check that NEXTAUTH_URL matches your actual domain
   - Verify all environment variables are set correctly
   - Check browser console for specific JavaScript errors

2. **Database connection issues**:
   - Check the database: `kubectl -n k8s-fleet-manager get cluster k8s-fleet-manager-postgres`
   - The Secret `k8s-fleet-manager-postgres-app` must exist (created by CloudNativePG)
   - Ensure network policies allow pod-to-pod communication

3. **Pod does not start, missing secret**:
   - Create `k8s-fleet-manager-secrets` (see step 2)

4. **Image pull errors**:
   - Verify image name and tag in app.yaml
   - Ensure image was pushed successfully

5. **Keycloak login fails with "TLS certificate … not trusted"** (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`,
   `SELF_SIGNED_CERT_IN_CHAIN`, …): inside the cluster Keycloak presents a certificate from a CA
   the app doesn't know (often an internal CA, or a server that leaves out the intermediate certificate).
   - Check what the pod sees: Tools → Certificates in the app connects from the pod and shows the chain
   - Trust the CA: create the ConfigMap `k8s-fleet-manager-ca` with key `ca.crt`
     (see `deploy/ca-configmap.example`) and restart the app. `deploy/app.yaml` points
     `NODE_EXTRA_CA_CERTS` at it; this also covers Nexus and other internal HTTPS services
   - Emergency only: Settings → Authentication → "Allow insecure TLS for Keycloak" makes the
     token exchange accept any certificate

### Debug Commands
```bash
kubectl describe pod -l app=k8s-fleet-manager -n k8s-fleet-manager
kubectl logs -f deployment/k8s-fleet-manager-app -n k8s-fleet-manager
kubectl get endpoints -n k8s-fleet-manager
kubectl run debug --image=busybox --rm -it -n k8s-fleet-manager -- nslookup k8s-fleet-manager-postgres-rw
```

## Environment Variables Reference

| Variable | Description | Source |
|----------|-------------|--------|
| `DATABASE_URL` | PostgreSQL connection string | Secret `k8s-fleet-manager-postgres-app`, key `uri` |
| `NEXTAUTH_SECRET` | Secret for signing login tokens | Secret `k8s-fleet-manager-secrets` |
| `NEXTAUTH_URL` | Public URL of the application | `deploy/app.yaml` |
| `DISABLE_LOCAL_LOGIN` | `true` to allow only Keycloak logins | `deploy/app.yaml` |
| `NODE_EXTRA_CA_CERTS` | Extra CA certificates (PEM) to trust, e.g. an internal CA for Keycloak | ConfigMap `k8s-fleet-manager-ca`, key `ca.crt` (optional) |
| `NODE_ENV` | Node.js environment | `production` |

## Security Notes

- Secrets live in Kubernetes Secrets, never in Git (`deploy/secrets.example` describes them)
- Generate a unique NEXTAUTH_SECRET per installation
- Use HTTPS in production with proper TLS certificates
- Consider network policies for additional security
- The container runs as non-root (distroless)
