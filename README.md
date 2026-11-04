# K8s Fleet Manager - Kubernetes Monitoring Application

A comprehensive Kubernetes monitoring application specifically designed for Talos-based clusters. K8s Fleet Manager provides real-time cluster health monitoring, Velero backup tracking, and resource usage monitoring with a beautiful, responsive web interface.

## Features

🚢 **Cluster Health Monitoring**
- Real-time monitoring of multiple Kubernetes clusters
- Node status and health tracking
- Automatic health checks every 30 seconds

📊 **Resource Metrics**
- CPU and memory usage monitoring for all nodes
- Resource capacity tracking
- Performance visualization

💾 **Velero Backup Monitoring**
- Track backup job status and results
- Backup completion monitoring
- Error and warning reporting

👥 **User Management**
- Secure authentication system
- Role-based access control (Admin/User)
- User creation and management interface

⚙️ **Cluster Configuration**
- Easy cluster addition through web interface
- Kubeconfig support
- Cluster endpoint management

🎨 **Modern UI**
- Responsive design for mobile and desktop
- Real-time updates
- Intuitive dashboard and settings pages

## Quick Start

### Prerequisites

- Docker and Docker Compose
- PostgreSQL (or use the included Docker setup)
- Access to Kubernetes clusters with appropriate kubeconfig files

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd k8s-fleet-manager
   ```

2. **Start with Docker Compose**
   ```bash
   docker-compose up -d
   ```

3. **Access the application**
   - Open your browser to `http://localhost:3000`
   - Login with default credentials:
     - Username: `admin`
     - Password: `admin123`

### Development Setup

1. **Install dependencies**
   ```bash
   npm install
   ```

2. **Set up environment variables**
   ```bash
   cp .env.example .env.local
   ```
   Edit `.env.local` with your database and authentication settings:
   ```
   DATABASE_URL=postgresql://postgres:password@localhost:5432/k8sfleet
   NEXTAUTH_SECRET=your-jwt-secret-change-in-production
   NEXTAUTH_URL=http://localhost:3000
   ```

3. **Start PostgreSQL**
   ```bash
   docker run -d \
     --name k8s-fleet-manager-postgres \
     -e POSTGRES_DB=k8s-fleet-manager \
     -e POSTGRES_USER=postgres \
     -e POSTGRES_PASSWORD=password \
     -p 5432:5432 \
     postgres:15
   ```

4. **Start development server**
   ```bash
   npm run dev
   ```

5. **Access the application**
   - Open `http://localhost:3000`
   - Database tables will be created automatically on first run

## Docker Hub Build & Push

This repository includes Docker Hub-focused scripts with sensible defaults:

- Default Docker Hub user: `k8s-fleet-manager`
- Default version tag: `0.5.10`
- Default platform: `linux/amd64`

### NPM Commands

```bash
# Build image only
npm run docker:build

# Build and push image
npm run docker:push
```

### Optional Overrides

```bash
# Use a different tag/version
VERSION=0.5.10 npm run docker:build
VERSION=0.5.10 npm run docker:push

# Use a different Docker Hub username temporarily
DOCKER_USER=myuser npm run docker:push
```

### Script Files

- `build-dockerhub.sh` - Build only
- `push-dockerhub.sh` - Docker login + build + push
- `build-amd64.sh` / `quick-build.sh` - Updated to default to Docker Hub user `k8s-fleet-manager`

## Kubernetes Client Compatibility

K8s Fleet Manager now includes a compatibility layer for `@kubernetes/client-node` response formats.

- Older versions often return API data inside `response.body`
- Newer versions can return the resource object directly (without `body`)

To prevent empty cluster data in the UI after dependency updates, API clients in
`src/lib/kubernetes.ts` are normalized so both response formats are handled.

If cluster names appear but metrics/resources stay empty after an upgrade, verify that
calls in `KubernetesClient` continue using the wrapped API clients.

## Troubleshooting

### Cluster name visible, but no data

If a cluster appears in the UI but node/pod/resource data stays empty, check these items:

1. **API endpoint returns real data**
   ```bash
   curl -s http://localhost:3000/api/clusters/<id>/details | jq '.status, (.nodes|length), .kubernetesVersion'
   ```
   Expected: non-empty node count and a Kubernetes version (for example `v1.x.x`).

2. **Kubeconfig and Talosconfig are stored in DB**
   ```bash
   node -e "const {Client}=require('pg');const c=new Client({connectionString:process.env.DATABASE_URL||'postgresql://postgres:password@localhost:5432/k8sfleet'});c.connect().then(()=>c.query('select id,name,length(kubeconfig) as kube_len,length(talosconfig) as talos_len from clusters order by id')).then(r=>{console.log(r.rows)}).finally(()=>c.end())"
   ```
   Expected: `kube_len` should be populated for the affected cluster.

3. **You are authenticated for protected routes**
   Endpoints like `/api/clusters/<id>/health` require a valid auth cookie and return `Unauthorized` without it.

4. **Kubernetes client compatibility fix is present**
   Confirm `src/lib/kubernetes.ts` uses wrapped API clients (`makeWrappedApiClient`) so both response formats are handled:
   - old format: `response.body`
   - new format: direct resource object

5. **Development server picked up latest code**
   Restart dev server if needed:
   ```bash
   npm run dev
   ```

## Configuration

### Adding Kubernetes Clusters

1. Go to Settings page after logging in
2. Click "Add Cluster" in the Cluster Management section
3. Fill in the cluster details:
   - **Name**: A friendly name for your cluster
   - **API Endpoint**: The Kubernetes API server URL
   - **Description**: Optional description
   - **Kubeconfig**: Optional - paste your kubeconfig YAML

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | Required |
| `NEXTAUTH_SECRET` | JWT signing secret | Required |
| `NEXTAUTH_URL` | Application URL | http://localhost:3000 |
| `NODE_ENV` | Environment mode | development |
| `DISABLE_LOCAL_LOGIN` | Disable local username/password login (true/false) | false |
| `ANTREA_FLOW_API_URL` | Optional external Antrea flow endpoint (supports `{clusterId}` placeholder) | Not set |
| `ANTREA_FLOW_API_TOKEN` | Optional bearer token for Antrea flow endpoint | Not set |

Flow settings can also be stored in the `settings` table using keys `antrea_flow_api_url` and `antrea_flow_api_token`.

## Architecture

### Tech Stack

- **Frontend**: Next.js 15 with TypeScript
- **Styling**: Tailwind CSS with custom components
- **Database**: PostgreSQL with direct SQL queries
- **Authentication**: JWT-based with HTTP-only cookies
- **Kubernetes**: @kubernetes/client-node for cluster communication
- **Containerization**: Docker with multi-stage builds

### Database Schema

The application creates the following tables:

- `users` - User accounts and authentication
- `clusters` - Kubernetes cluster configurations
- `cluster_health` - Health monitoring data
- `backup_jobs` - Velero backup tracking
- `settings` - Application settings

### API Endpoints

- `POST /api/auth/login` - User authentication
- `POST /api/auth/logout` - User logout
- `GET /api/clusters` - List clusters
- `POST /api/clusters` - Add new cluster
- `GET /api/clusters/health` - Get cluster health data
- `GET /api/users` - List users (admin only)
- `POST /api/users` - Create user (admin only)

## Security Features

- JWT authentication with HTTP-only cookies
- Role-based access control
- Password hashing with bcrypt
- SQL injection protection with parameterized queries
- CSRF protection through SameSite cookies

## Kubernetes Deployment

### Using Helm (Recommended)

```bash
# Add custom values
helm install k8s-fleet-manager ./helm-chart \
  --set database.host=your-postgres-host \
  --set database.password=your-password \
  --set auth.secret=your-jwt-secret
```

### Using kubectl

```bash
# Apply the Kubernetes manifests
kubectl apply -f k8s/
```

### Required Permissions

K8s Fleet Manager reaches every cluster, including the one it runs on, through the
kubeconfig (and talosconfig) you add in Settings, as is. No ServiceAccounts or RBAC
objects are created in any cluster, and the app's own pod gets no Kubernetes
permissions (no ServiceAccount token is mounted). The kubeconfig needs read access to
the cluster; a Talos admin kubeconfig works.

## Version Management & Releases

K8s Fleet Manager includes automated version management scripts to ensure consistency across all components.

### Automated Version Updates

Use the provided scripts to update versions consistently:

#### Update Version Only
```bash
# Update version in all files (package.json, Header.tsx, deployment, build scripts)
./update-version.sh 0.4.9
```

#### Full Release Pipeline
```bash
# Complete release: version update + build + deploy + commit
./release.sh 0.4.9
```

#### Manual Build & Deploy
```bash
# Build Docker image
./quick-build.sh

# Deploy to Kubernetes
kubectl apply -f deploy/
kubectl rollout restart deployment/k8s-fleet-manager-app -n k8s-fleet-manager
```

### What Gets Updated

The version management scripts automatically update:

- ✅ **package.json** - Application version
- ✅ **Header component** - UI version display (v0.4.x)
- ✅ **Deployment manifest** - Docker image tag
- ✅ **Build scripts** - Image tags and version references

### Release Process

1. **Update version**: `./update-version.sh <version>`
2. **Review changes**: `git diff`
3. **Build & deploy**: `./release.sh <version>` (or individual steps)
4. **Verify deployment**: Check https://k8s-fleet-manager.diersmann.com

### Release Checklist

Use this checklist for each release (example: `0.6.1`):

- [ ] Update app and script versions to the new tag
- [ ] Confirm UI version badge next to the K8s Fleet Manager logo
- [ ] Build AMD64 image: `VERSION=<version> DOCKER_USER=k8s-fleet-manager ./build-dockerhub.sh`
- [ ] Push tags: `docker push kubertinus/k8s-fleet-manager:<version>` and `docker push kubertinus/k8s-fleet-manager:latest`
- [ ] Verify image tag in [deploy/app.yaml](deploy/app.yaml)
- [ ] Add changelog entry in [README.md](README.md)
- [ ] Run automated checks: `./release-check.sh <version> --check-dockerhub`
- [ ] Smoke-test `/dashboard` and `/settings` in production

## Monitoring Talos Clusters

K8s Fleet Manager is specifically designed for Talos-based Kubernetes clusters:

1. **Node Metrics**: Monitors Talos node health and status
2. **Resource Usage**: Tracks CPU and memory across Talos nodes
3. **Cluster Health**: Provides overall cluster status visualization
4. **Backup Integration**: Works with Velero for backup monitoring

### Talos Configuration

Ensure your Talos cluster has:
- Metrics server enabled
- Velero installed (for backup monitoring)
- Appropriate RBAC permissions for monitoring

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Submit a pull request

## Support

For issues and questions:
- Check the [Issues](../../issues) page
- Review the documentation
- Check Kubernetes cluster permissions

## License

This project is licensed under the MIT License - see the LICENSE file for details.

## Changelog

### v0.11.0
- New Platform → Backups page: Velero backups of all clusters in one overview
- Tiles for protected clusters, clusters needing attention, the fleet-wide 7-day success rate and clusters without Velero
- Per-day outcome grid (last 14 days) per cluster, per-cluster details (last successful backup, schedules, storage locations, findings) and a list of failed backups
- Published AMD64 image to Docker Hub (`kubertinus/k8s-fleet-manager:0.11.0`)

### v0.10.3
- Image update check retries registry requests that fail temporarily (timeouts, dropped connections, 429, 5xx) up to three times before falling back from Nexus to online
- Images that still failed temporarily get one more try at the end of the check
- No retries on the online fallback when Nexus is configured, so offline environments don't wait on it
- Published AMD64 image to Docker Hub (`kubertinus/k8s-fleet-manager:0.10.3`)

### v0.10.2
- Keycloak behind an internal CA: trust the CA through the optional ConfigMap `k8s-fleet-manager-ca` (`NODE_EXTRA_CA_CERTS`, see `deploy/ca-configmap.example`)
- Emergency setting "Allow insecure TLS for Keycloak" in Settings → Authentication
- Keycloak connection errors (TLS, DNS, refused) are explained in the log and on the login page
- Published AMD64 image to Docker Hub (`kubertinus/k8s-fleet-manager:0.10.2`)

### v0.10.1
- Cluster sections are listed under the open cluster in the left sidebar again, instead of as tabs on top
- The cluster list sits below Platform and Tools; the sidebar scrolls as a whole and keeps the active section in view
- Tools are collapsed by default (the choice is remembered)
- Published AMD64 image to Docker Hub (`kubertinus/k8s-fleet-manager:0.10.1`)

### v0.10.0
- Health history: a background sampler stores the health of every cluster every 5 minutes (kept 30 days, both configurable in Settings → Health History)
- Cluster Overview shows availability (24h/7d/30d), a status timeline, CPU/memory usage and the periods a cluster was not healthy; the dashboard list has an Uptime 7d column
- Unit tests with Vitest (`npm test`), also run by `release-check.sh`
- Removed unused dashboard pages and the old settings `nexus_url`, `nexus_enabled` and `nexus_repository_name`
- Published AMD64 image to Docker Hub (`kubertinus/k8s-fleet-manager:0.10.0`)

### v0.9.0
- Velero backups: Backups tab per cluster (schedules, storage locations, backups) and the last backup on the dashboard, with warnings for failed, stale or shrinking backups
- Dashboard warns when a kubeconfig client certificate expires within 30 days
- Platform → Hostnames: every hostname from Gateway API routes and Ingresses across all clusters, with route status and TLS certificate expiry
- Platform → Versions: Kubernetes and Talos versions per cluster and node against the newest releases (looked up through Nexus or online)
- Networking tab shows the Gateway API (Gateways, routes, GatewayClasses) instead of Ingress
- Published AMD64 image to Docker Hub (`kubertinus/k8s-fleet-manager:0.9.0`)

### v0.6.1
- Refreshed the Settings page UI with improved spacing, hierarchy, and consistent card/form styling
- Added a sticky left-side Settings menu with section jump links to reduce scrolling
- Updated version display next to the K8s Fleet Manager logo to `v0.6.1`
- Bumped application and Docker default version to `0.6.1`
- Rebuilt and published AMD64 image to Docker Hub (`kubertinus/kubertinus:0.6.1`)

### v0.5.10
- Extended certificate threshold matching so postgres and cnpg secret names (including opaque cert fields like `ca.crt`) use warning/error thresholds at 6/3 days
- Bumped application and Docker default version to `0.5.10`
- Rebuilt and published AMD64 image to Docker Hub (`kubertinus/kubertinus:0.5.10`)

### v0.5.9
- Refined health certificate warning logic so postgres TLS secrets use warning/error thresholds at 6/3 days
- Bumped application and Docker default version to `0.5.9`
- Rebuilt and published AMD64 image to Docker Hub (`kubertinus/kubertinus:0.5.9`)

### v0.5.8
- Added Nexus server setting in Settings for image update checks
- Updated image update check flow to use Nexus first when configured
- Bumped application and Docker default version to `0.5.8`
- Rebuilt and published AMD64 image to Docker Hub (`kubertinus/kubertinus:0.5.8`)

### v0.5.7
- Added dedicated CNPG PostgreSQL certificate alert thresholds (warning at 6 days, error at 3 days)
- Synced cluster Overview warnings with dashboard health warnings
- Skipped SMB PVC free-space/usage measurement to reduce storage load time
- Bumped application and Docker default version to `0.5.7`
- Rebuilt and published AMD64 image to Docker Hub (`kubertinus/kubertinus:0.5.7`)

### v0.5.6
- Added Antrea flow visibility support with status indicator in the network topology
- Added minimal Antrea flow adapter service with direct IPFIX receiver mode (UDP/TCP 4739)
- Added Antrea Flow settings in Settings page and removed Harbor settings UI
- Bumped application and Docker default version to `0.5.6`
- Rebuilt and published AMD64 image to Docker Hub (`kubertinus/kubertinus:0.5.6`)

### v0.5.5
- Added node taints display in the Nodes tab next to node labels
- Bumped application and Docker default version to `0.5.5`
- Rebuilt and published AMD64 image to Docker Hub (`kubertinus/kubertinus:0.5.5`)

### v0.5.3
- Bumped application and Docker default version to `0.5.3`
- Rebuilt and published AMD64 image to Docker Hub (`kubertinus/kubertinus:0.5.3`)

### v0.5.2
- Bumped application and Docker default version to `0.5.2`
- Rebuilt and published AMD64 image to Docker Hub (`kubertinus/kubertinus:0.5.2`)

### v0.5.1
- Added Docker Hub scripts (`docker:build`, `docker:push`) with defaults for `k8s-fleet-manager`
- Updated build scripts to Docker Hub-first defaults
- Added Kubernetes API response compatibility handling for new `@kubernetes/client-node` behavior

### v0.1.0
- Initial release
- Basic cluster monitoring
- User management
- Velero backup tracking
- Docker containerization