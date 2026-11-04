# K8s Fleet Manager - Kubernetes Monitoring Application

A Next.js application for monitoring Talos-based Kubernetes clusters with real-time health tracking, resource metrics, and Velero backup monitoring.

## Architecture & Data Flow

**Frontend**: Next.js 15 with TypeScript, Tailwind CSS, Radix UI components
**Backend**: Next.js API routes with PostgreSQL database
**Auth**: Custom JWT-based auth + optional Keycloak SSO
**Monitoring**: Direct Kubernetes API integration via `@kubernetes/client-node`

### Core Services
- `src/lib/database.ts` - PostgreSQL connection pool with schema migrations
- `src/lib/kubernetes.ts` - K8s API client with kubeconfig parsing (2400+ lines)
- `src/lib/auth.ts` - JWT auth + Keycloak integration

### API Structure
API routes follow REST patterns in `src/app/api/`:
- `/clusters` - CRUD operations for cluster configs
- `/clusters/[id]/health` - Real-time cluster health checks
- `/clusters/[id]/details` - Node metrics and resource usage
- `/auth/*` - Authentication endpoints

## Development Patterns

### Database Schema Management
Auto-migration system in `database.ts` - tracks schema versions:
```typescript
await pool.query(`CREATE TABLE IF NOT EXISTS database_migrations...`)
```

### Real-time Updates
Dashboard auto-refreshes every 30 seconds via `setInterval(fetchData, 30000)`.
Use this pattern for other real-time features.

### Authentication Flow
All API routes require token verification:
```typescript
const token = request.cookies.get('auth-token')?.value
if (!token || !verifyToken(token)) {
  return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
```

### Resource Formatting
Complex CPU/memory parsing in dashboard components - handles millicores (m), Ki/Mi/Gi units.
See `formatCpuMemory()` and `calculatePercentage()` functions.

## Development Commands

- `npm run dev` - Development server with hot reload
- `docker-compose up` - Full stack with PostgreSQL
- `./quick-build.sh` - Build AMD64 Docker image for deployment
- Use the "Run K8s Fleet Manager Development Server" task in VS Code

## Deployment Architecture

**Local**: `docker-compose.yml` with PostgreSQL service
**K8s**: Complete manifests in `deploy/` directory
- Namespace isolation, RBAC service account
- ConfigMap-driven environment variables
- Multi-registry support (Docker Hub + Harbor)

## Critical Conventions

1. **Database Access**: Always call `initializeDatabase()` in API routes
2. **Auth Middleware**: Verify tokens before any data operations
3. **Error Handling**: Consistent JSON error responses with HTTP status codes
4. **Component Structure**: Radix UI primitives in `components/ui/`
5. **Kubeconfig Parsing**: Use `parseKubeconfig()` for cluster endpoint extraction

## Integration Points

- **Kubernetes**: Direct API calls to multiple clusters via stored kubeconfigs
- **Metrics**: Node resource usage from K8s metrics API
- **Backups**: Velero job status monitoring
- **SSO**: Optional Keycloak integration with role mapping