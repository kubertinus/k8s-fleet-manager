# Local Development Configuration

## Keycloak Configuration Issue Resolution

### Problem
When clicking "Sign in with Keycloak" on the login page, the authentication process would hang in a loading state indefinitely.

### Root Cause
The application was configured for production with:
- `app_hostname`: `https://k8s-fleet-manager.diersmann.com`
- `keycloak_enabled`: `true`
- Keycloak server: `https://keycloak.diersmann.com`

When running locally on `http://localhost:3000`, the Keycloak redirect flow would:
1. Redirect to external Keycloak server
2. Keycloak would try to callback to production URL instead of localhost
3. This caused the authentication to fail and hang

### Solution
For local development, updated database settings:

```sql
UPDATE settings SET value = 'http://localhost:3000' WHERE key = 'app_hostname';
UPDATE settings SET value = 'false' WHERE key = 'keycloak_enabled';
```

### Local Development Login
With Keycloak disabled, use local authentication:
- **Username**: `admin`
- **Password**: `admin123`

### Production Deployment
When deploying to production, ensure these settings are restored:

```sql
UPDATE settings SET value = 'https://k8s-fleet-manager.diersmann.com' WHERE key = 'app_hostname';
UPDATE settings SET value = 'true' WHERE key = 'keycloak_enabled';
```

### Alternative Solutions

#### Option 1: Configure Localhost in Keycloak
Add `http://localhost:3000/api/auth/keycloak/callback` as a valid redirect URI in the Keycloak client configuration.

#### Option 2: Local Keycloak Instance
Set up a local Keycloak instance for development and update the `keycloak_server_url` setting.

#### Option 3: Environment-Based Configuration
Consider implementing environment-based configuration that automatically uses appropriate settings based on NODE_ENV.

## Cluster Troubleshooting

### Cluster name visible, but no data

If a cluster shows in the UI but nodes/pods/metrics stay empty, run these checks:

1. **Verify details endpoint returns data**

```bash
curl -s http://localhost:3000/api/clusters/<id>/details | jq '.status, (.nodes|length), .kubernetesVersion'
```

Expected: non-empty node count and Kubernetes version.

2. **Verify kubeconfig/talosconfig are stored**

```bash
node -e "const {Client}=require('pg');const c=new Client({connectionString:process.env.DATABASE_URL||'postgresql://postgres:password@localhost:5432/k8sfleet'});c.connect().then(()=>c.query('select id,name,length(kubeconfig) as kube_len,length(talosconfig) as talos_len from clusters order by id')).then(r=>{console.log(r.rows)}).finally(()=>c.end())"
```

Expected: `kube_len` has a value for the target cluster.

3. **Check authentication on protected routes**

Routes like `/api/clusters/<id>/health` require a valid auth cookie and return `Unauthorized` without login.

4. **Confirm Kubernetes client compatibility shim exists**

In `src/lib/kubernetes.ts`, API clients should be created via `makeWrappedApiClient` so both old (`response.body`) and new (direct object) `@kubernetes/client-node` response formats work.

5. **Restart local dev server after updates**

```bash
npm run dev
```