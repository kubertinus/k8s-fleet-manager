  import { Pool } from 'pg'
import bcrypt from 'bcryptjs'

let pool: Pool | null = null

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/k8sfleet'
    console.log('Connecting to database with URL:', connectionString.replace(/password@/, '***@'))
    
    pool = new Pool({
      connectionString,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    })
  }
  return pool
}

export async function initializeDatabase() {
  const pool = getPool()
  
  try {
    // Create database_migrations table for tracking schema versions
    await pool.query(`
      CREATE TABLE IF NOT EXISTS database_migrations (
        id SERIAL PRIMARY KEY,
        migration_name VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `)

    // Create users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(50) DEFAULT 'user',
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `)

    // Create clusters table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS clusters (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        endpoint VARCHAR(500) NOT NULL,
        kubeconfig TEXT,
        talosconfig TEXT,
        description TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `)

    // Add talosconfig column if it doesn't exist (for existing databases)
    await runMigration('add_talosconfig_column', async () => {
      await pool.query(`
        ALTER TABLE clusters 
        ADD COLUMN IF NOT EXISTS talosconfig TEXT
      `)
    })

    // Create cluster_health table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cluster_health (
        id SERIAL PRIMARY KEY,
        cluster_id INTEGER REFERENCES clusters(id) ON DELETE CASCADE,
        status VARCHAR(50) NOT NULL,
        healthy_nodes INTEGER DEFAULT 0,
        total_nodes INTEGER DEFAULT 0,
        cpu_usage_percent DECIMAL(5,2),
        memory_usage_percent DECIMAL(5,2),
        last_checked TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(cluster_id)
      )
    `)

    // Create backup_jobs table for Velero monitoring
    await pool.query(`
      CREATE TABLE IF NOT EXISTS backup_jobs (
        id SERIAL PRIMARY KEY,
        cluster_id INTEGER REFERENCES clusters(id) ON DELETE CASCADE,
        job_name VARCHAR(255) NOT NULL,
        status VARCHAR(50) NOT NULL,
        phase VARCHAR(50),
        start_time TIMESTAMP WITH TIME ZONE,
        completion_time TIMESTAMP WITH TIME ZONE,
        backup_size BIGINT,
        errors TEXT,
        warnings TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `)

    // Create settings table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS settings (
        id SERIAL PRIMARY KEY,
        key VARCHAR(255) UNIQUE NOT NULL,
        value TEXT,
        description TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `)

    // Run additional migrations
    await runAllMigrations()

    // Insert default admin user if no users exist
    const userCount = await pool.query('SELECT COUNT(*) FROM users')
    if (parseInt(userCount.rows[0].count) === 0) {
      const hashedPassword = await bcrypt.hash('admin123', 12)
      
      await pool.query(`
        INSERT INTO users (username, email, password_hash, role)
        VALUES ($1, $2, $3, $4)
      `, ['admin', 'admin@k8s-fleet-manager.local', hashedPassword, 'admin'])
      
      console.log('Default admin user created: admin / admin123')
    }

    console.log('Database initialized successfully')
  } catch (error) {
    console.error('Database initialization error:', error)
    throw error
  }
}

// Migration helper functions
async function runMigration(migrationName: string, migrationFunction: () => Promise<void>) {
  const pool = getPool()
  
  try {
    // First ensure the migrations table exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS database_migrations (
        id SERIAL PRIMARY KEY,
        migration_name VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `)
    
    // Check if migration has already been applied
    const existingMigration = await pool.query(
      'SELECT id FROM database_migrations WHERE migration_name = $1',
      [migrationName]
    )
    
    if (existingMigration.rows.length > 0) {
      console.log(`Migration ${migrationName} already applied, skipping`)
      return
    }
    
    // Run the migration
    console.log(`Applying migration: ${migrationName}`)
    await migrationFunction()
    
    // Record that the migration was applied
    await pool.query(
      'INSERT INTO database_migrations (migration_name) VALUES ($1)',
      [migrationName]
    )
    
    console.log(`Migration ${migrationName} completed successfully`)
  } catch (error) {
    console.error(`Migration ${migrationName} failed:`, error)
    throw error
  }
}

async function runAllMigrations() {
  const pool = getPool()
  
  // Migration 1: Ensure all Keycloak settings exist (for upgrades from pre-Keycloak versions)
  await runMigration('add_keycloak_settings', async () => {
    const keycloakSettings = [
      {
        key: 'keycloak_enabled',
        value: 'false',
        description: 'Enable Keycloak authentication'
      },
      {
        key: 'keycloak_server_url',
        value: '',
        description: 'Keycloak server URL (e.g., https://auth.example.com)'
      },
      {
        key: 'keycloak_realm',
        value: '',
        description: 'Keycloak realm name'
      },
      {
        key: 'keycloak_client_id',
        value: '',
        description: 'Keycloak client ID'
      },
      {
        key: 'keycloak_client_secret',
        value: '',
        description: 'Keycloak client secret'
      },
      {
        key: 'keycloak_scope',
        value: 'openid profile email',
        description: 'Keycloak OAuth scopes'
      },
      {
        key: 'disable_local_login',
        value: 'false',
        description: 'Disable local username/password authentication'
      },
      {
        key: 'keycloak_admin_roles',
        value: 'admin,k8s-fleet-manager-admin',
        description: 'Comma-separated list of Keycloak roles that grant admin access'
      },
      {
        key: 'keycloak_admin_groups',
        value: 'admin,administrators',
        description: 'Comma-separated list of Keycloak groups that grant admin access'
      }
    ]
    
    for (const setting of keycloakSettings) {
      await pool.query(`
        INSERT INTO settings (key, value, description)
        VALUES ($1, $2, $3)
        ON CONFLICT (key) DO NOTHING
      `, [setting.key, setting.value, setting.description])
    }
  })
  
  // Migration 2: Add the new keycloak_admin_group setting (for upgrades from pre-admin-group versions)
  await runMigration('add_keycloak_admin_group_setting', async () => {
    await pool.query(`
      INSERT INTO settings (key, value, description)
      VALUES ($1, $2, $3)
      ON CONFLICT (key) DO NOTHING
    `, [
      'keycloak_admin_group',
      '',
      'Primary Keycloak group name for admin access (takes priority over admin_groups)'
    ])
  })
  
  // Migration 3: Add app_hostname setting for proper Keycloak callback URLs
  await runMigration('add_app_hostname_setting', async () => {
    await pool.query(`
      INSERT INTO settings (key, value, description)
      VALUES ($1, $2, $3)
      ON CONFLICT (key) DO NOTHING
    `, [
      'app_hostname',
      '',
      'Full hostname/URL where this application is accessible (used for Keycloak callbacks)'
    ])
  })
  
  // Migration 4: Add keycloak_access_group setting for restricting access
  await runMigration('add_keycloak_access_group_setting', async () => {
    await pool.query(`
      INSERT INTO settings (key, value, description)
      VALUES ($1, $2, $3)
      ON CONFLICT (key) DO NOTHING
    `, [
      'keycloak_access_group',
      '',
      'Keycloak group name required for access. Only users in this group can log into K8s Fleet Manager'
    ])
  })
  
  // Migration 5: Add Ollama AI settings for chatbot functionality
  await runMigration('add_ollama_ai_settings', async () => {
    const ollamaSettings = [
      {
        key: 'ollama_enabled',
        value: 'false',
        description: 'Enable AI chatbot functionality using Ollama'
      },
      {
        key: 'ollama_server_url',
        value: 'http://localhost:11434',
        description: 'Ollama server URL for AI model access'
      },
      {
        key: 'ollama_model',
        value: 'llama3.2',
        description: 'Ollama model to use for chat responses'
      },
      {
        key: 'ollama_temperature',
        value: '0.7',
        description: 'Temperature setting for AI responses (0.0-1.0)'
      },
      {
        key: 'ollama_max_tokens',
        value: '4096',
        description: 'Maximum tokens for AI responses'
      }
    ]

    for (const setting of ollamaSettings) {
      await pool.query(`
        INSERT INTO settings (key, value, description)
        VALUES ($1, $2, $3)
        ON CONFLICT (key) DO NOTHING
      `, [setting.key, setting.value, setting.description])
    }
  })

  // Migration 6: Add AI prompt templates for customizable chatbot behavior
  await runMigration('add_ai_prompt_templates', async () => {
    const promptSettings = [
      {
        key: 'ai_system_prompt',
        value: 'You are a helpful Kubernetes expert assistant. You have deep knowledge of Kubernetes concepts, troubleshooting, best practices, and operations. You can help with:\n\n- Kubernetes cluster management and troubleshooting\n- Pod, Service, Deployment, and other resource management\n- YAML configuration and best practices\n- Security and RBAC configurations\n- Monitoring and observability\n- Performance optimization\n- Networking and ingress\n- Storage and persistent volumes\n- CI/CD and GitOps practices\n- Talos Linux specific configurations and maintenance\n\nPlease provide accurate, helpful, and actionable advice. Keep responses concise but thorough. Use markdown formatting for code examples and structured information.',
        description: 'Base system prompt for AI assistant behavior and expertise'
      },
      {
        key: 'ai_cluster_context_prompt',
        value: 'You currently have direct access to live cluster data including:\n- Real-time node status and resource usage\n- Pod health and deployment status\n- Cluster events and logs\n- Storage and networking configurations\n- Backup status (Velero)\n- Talos system information\n\nUse this live data to provide specific, actionable advice for the current cluster state. When discussing specific issues, always refer to the actual cluster context and data provided.',
        description: 'Additional prompt when cluster context is available'
      },
      {
        key: 'ai_dashboard_context_prompt',
        value: 'You are currently on the dashboard without access to specific cluster data. For cluster-specific questions requiring live data, diagnostics, or troubleshooting, users should navigate to the individual cluster details page where you can access real-time cluster information.\n\nFocus on providing general Kubernetes knowledge, best practices, and conceptual guidance. For cluster-specific diagnostics, recommend users visit the cluster details page.',
        description: 'Additional prompt when user is on dashboard without cluster context'
      },
      {
        key: 'ai_cluster_redirect_prompt',
        value: 'I see you\'re asking about cluster-specific information! For the best assistance with cluster details, please navigate to the specific cluster page where I\'ll have access to real-time data.\n\nFrom the cluster details page, I can provide:\n• Real-time node and pod status\n• Live resource usage and metrics\n• Recent events and error analysis\n• Deployment and service health checks\n• Backup status and storage information\n• Specific troubleshooting for that cluster\n\nFor general Kubernetes questions without cluster context, I\'m happy to help here on the dashboard!',
        description: 'Message shown when redirecting users to cluster details page'
      }
    ]

    for (const setting of promptSettings) {
      await pool.query(`
        INSERT INTO settings (key, value, description)
        VALUES ($1, $2, $3)
        ON CONFLICT (key) DO NOTHING
      `, [setting.key, setting.value, setting.description])
    }
  })
  
  // Migration 7: Add Harbor registry settings for image update checks
  await runMigration('add_harbor_registry_settings', async () => {
    const harborSettings = [
      {
        key: 'harbor_enabled',
        value: 'false',
        description: 'Enable Harbor registry for image update checks'
      },
      {
        key: 'harbor_url',
        value: '',
        description: 'Harbor registry URL (e.g., harbor.diersmann.com)'
      },
      {
        key: 'harbor_username',
        value: '',
        description: 'Harbor username for authentication (optional)'
      },
      {
        key: 'harbor_password',
        value: '',
        description: 'Harbor password for authentication (optional)'
      },
      {
        key: 'harbor_project',
        value: 'proxy-cache',
        description: 'Harbor project name to search for images (leave empty to search all projects)'
      }
    ]

    for (const setting of harborSettings) {
      await pool.query(`
        INSERT INTO settings (key, value, description)
        VALUES ($1, $2, $3)
        ON CONFLICT (key) DO NOTHING
      `, [setting.key, setting.value, setting.description])
    }
  })

  // Migration 8: Add Antrea flow API settings for allow/drop flow visibility
  await runMigration('add_antrea_flow_settings', async () => {
    const antreaSettings = [
      {
        key: 'antrea_flow_api_url',
        value: '',
        description: 'External Antrea flow API endpoint (supports {clusterId} placeholder)'
      },
      {
        key: 'antrea_flow_api_token',
        value: '',
        description: 'Bearer token for Antrea flow API (optional)'
      }
    ]

    for (const setting of antreaSettings) {
      await pool.query(`
        INSERT INTO settings (key, value, description)
        VALUES ($1, $2, $3)
        ON CONFLICT (key) DO NOTHING
      `, [setting.key, setting.value, setting.description])
    }
  })

  // Migration 9: Add Nexus registry setting for image update checks
  await runMigration('add_nexus_registry_settings', async () => {
    const nexusSettings = [
      {
        key: 'nexus_server_url',
        value: '',
        description: 'Nexus Docker registry base URL for image update checks (optional)'
      }
    ]

    for (const setting of nexusSettings) {
      await pool.query(`
        INSERT INTO settings (key, value, description)
        VALUES ($1, $2, $3)
        ON CONFLICT (key) DO NOTHING
      `, [setting.key, setting.value, setting.description])
    }
  })

  // Migration 10: Add Nexus TLS behavior setting for image update checks
  await runMigration('add_nexus_tls_settings', async () => {
    const nexusTlsSettings = [
      {
        key: 'nexus_allow_insecure_tls',
        value: 'false',
        description: 'Allow insecure TLS for Nexus image update checks (self-signed/untrusted certs)'
      }
    ]

    for (const setting of nexusTlsSettings) {
      await pool.query(`
        INSERT INTO settings (key, value, description)
        VALUES ($1, $2, $3)
        ON CONFLICT (key) DO NOTHING
      `, [setting.key, setting.value, setting.description])
    }
  })

  // Migration 11: Add Nexus authentication settings for image update checks
  await runMigration('add_nexus_auth_settings', async () => {
    const nexusAuthSettings = [
      {
        key: 'nexus_username',
        value: '',
        description: 'Nexus username for Docker registry API authentication (optional)'
      },
      {
        key: 'nexus_password',
        value: '',
        description: 'Nexus password for Docker registry API authentication (optional)'
      }
    ]

    for (const setting of nexusAuthSettings) {
      await pool.query(`
        INSERT INTO settings (key, value, description)
        VALUES ($1, $2, $3)
        ON CONFLICT (key) DO NOTHING
      `, [setting.key, setting.value, setting.description])
    }
  })

  // Migration 12: Persist image update check state per cluster
  await runMigration('add_cluster_image_update_checks', async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cluster_image_update_checks (
        cluster_id INTEGER PRIMARY KEY REFERENCES clusters(id) ON DELETE CASCADE,
        last_checked_at TIMESTAMP WITH TIME ZONE,
        images_with_updates JSONB NOT NULL DEFAULT '[]'::jsonb,
        update_details JSONB NOT NULL DEFAULT '{}'::jsonb,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
      )
    `)
  })
  
  // Migration 13: Nightly image inventory and update report
  await runMigration('add_image_report', async () => {
    // One row per scan (scheduled or manual)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS image_scan_runs (
        id SERIAL PRIMARY KEY,
        trigger VARCHAR(20) NOT NULL,
        scheduled_for DATE,
        status VARCHAR(20) NOT NULL DEFAULT 'running',
        started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
        finished_at TIMESTAMP WITH TIME ZONE,
        clusters_total INTEGER DEFAULT 0,
        clusters_failed INTEGER DEFAULT 0,
        workloads_total INTEGER DEFAULT 0,
        images_total INTEGER DEFAULT 0,
        updates_found INTEGER DEFAULT 0,
        error TEXT
      )
    `)
    // Every container image used by a workload, as of the cluster's last successful scan
    await pool.query(`
      CREATE TABLE IF NOT EXISTS image_workloads (
        id SERIAL PRIMARY KEY,
        cluster_id INTEGER NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
        namespace VARCHAR(255) NOT NULL,
        kind VARCHAR(30) NOT NULL,
        name VARCHAR(255) NOT NULL,
        container VARCHAR(255) NOT NULL,
        init_container BOOLEAN NOT NULL DEFAULT false,
        image TEXT NOT NULL
      )
    `)
    await pool.query('CREATE INDEX IF NOT EXISTS idx_image_workloads_cluster ON image_workloads(cluster_id)')
    await pool.query('CREATE INDEX IF NOT EXISTS idx_image_workloads_image ON image_workloads(image)')
    // Inventory freshness per cluster
    await pool.query(`
      CREATE TABLE IF NOT EXISTS image_cluster_scans (
        cluster_id INTEGER PRIMARY KEY REFERENCES clusters(id) ON DELETE CASCADE,
        scanned_at TIMESTAMP WITH TIME ZONE,
        attempted_at TIMESTAMP WITH TIME ZONE,
        error TEXT
      )
    `)
    // Version check result per unique image reference
    await pool.query(`
      CREATE TABLE IF NOT EXISTS image_versions (
        image TEXT PRIMARY KEY,
        registry VARCHAR(255) NOT NULL,
        repository TEXT NOT NULL,
        tag VARCHAR(255),
        digest VARCHAR(255),
        status VARCHAR(20) NOT NULL,
        latest_version VARCHAR(255),
        update_type VARCHAR(10),
        source VARCHAR(20),
        error TEXT,
        checked_at TIMESTAMP WITH TIME ZONE
      )
    `)

    const scanSettings = [
      { key: 'image_scan_enabled', value: 'true', description: 'Run the nightly image inventory and update check' },
      { key: 'image_scan_time', value: '02:00', description: 'Time of the nightly image scan (HH:MM)' },
      { key: 'image_scan_timezone', value: 'Europe/Amsterdam', description: 'Timezone for the nightly image scan' }
    ]
    for (const setting of scanSettings) {
      await pool.query(`
        INSERT INTO settings (key, value, description)
        VALUES ($1, $2, $3)
        ON CONFLICT (key) DO NOTHING
      `, [setting.key, setting.value, setting.description])
    }
  })

  // Migration 14: Newest version within the current major, shown next to a major update
  await runMigration('add_image_latest_in_major', async () => {
    await pool.query('ALTER TABLE image_versions ADD COLUMN IF NOT EXISTS latest_in_major VARCHAR(255)')
  })

  // Migration 15: Remember whether a workload's namespace is labelled customer_managed=yes
  await runMigration('add_image_workloads_customer_managed', async () => {
    await pool.query('ALTER TABLE image_workloads ADD COLUMN IF NOT EXISTS customer_managed BOOLEAN NOT NULL DEFAULT false')
  })

  // Migration 16: Health samples per cluster for availability and trends
  await runMigration('add_cluster_health_history', async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cluster_health_history (
        id BIGSERIAL PRIMARY KEY,
        cluster_id INTEGER NOT NULL REFERENCES clusters(id) ON DELETE CASCADE,
        checked_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
        status VARCHAR(20) NOT NULL,
        healthy_nodes INTEGER NOT NULL DEFAULT 0,
        total_nodes INTEGER NOT NULL DEFAULT 0,
        cpu_percent REAL,
        memory_percent REAL,
        critical INTEGER NOT NULL DEFAULT 0,
        warning INTEGER NOT NULL DEFAULT 0
      )
    `)
    await pool.query('CREATE INDEX IF NOT EXISTS idx_cluster_health_history_cluster_time ON cluster_health_history(cluster_id, checked_at)')
    const historySettings = [
      { key: 'history_interval_minutes', value: '5', description: 'Minutes between two health samples per cluster' },
      { key: 'history_retention_days', value: '30', description: 'Days of health history to keep' }
    ]
    for (const setting of historySettings) {
      await pool.query(`
        INSERT INTO settings (key, value, description)
        VALUES ($1, $2, $3)
        ON CONFLICT (key) DO NOTHING
      `, [setting.key, setting.value, setting.description])
    }
  })

  // Migration 17: Nexus settings of an older version that nothing reads anymore
  await runMigration('remove_unused_nexus_settings', async () => {
    await pool.query("DELETE FROM settings WHERE key IN ('nexus_url', 'nexus_enabled', 'nexus_repository_name')")
  })

  // Migration 18: Emergency switch to accept an untrusted Keycloak certificate
  await runMigration('add_keycloak_tls_setting', async () => {
    await pool.query(`
      INSERT INTO settings (key, value, description)
      VALUES ($1, $2, $3)
      ON CONFLICT (key) DO NOTHING
    `, ['keycloak_allow_insecure_tls', 'false', 'Accept an untrusted TLS certificate from Keycloak (prefer trusting the CA via NODE_EXTRA_CA_CERTS)'])
  })

  // Migration 19: Trivy severity and counts from the Harbor scan overview
  await runMigration('add_image_cve_summary', async () => {
    await pool.query(`
      ALTER TABLE image_versions
        ADD COLUMN IF NOT EXISTS cve_severity VARCHAR(20),
        ADD COLUMN IF NOT EXISTS cve_critical INTEGER,
        ADD COLUMN IF NOT EXISTS cve_high INTEGER,
        ADD COLUMN IF NOT EXISTS cve_medium INTEGER,
        ADD COLUMN IF NOT EXISTS cve_low INTEGER,
        ADD COLUMN IF NOT EXISTS cve_total INTEGER,
        ADD COLUMN IF NOT EXISTS cve_fixable INTEGER,
        ADD COLUMN IF NOT EXISTS cve_scanned_at TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS cve_error TEXT
    `)
  })

  // Future migrations can be added here
  // await runMigration('migration_name', async () => { ... })
}

export async function query(text: string, params?: any[]) {
  const pool = getPool()
  const start = Date.now()
  const res = await pool.query(text, params)
  const duration = Date.now() - start
  console.log('Executed query', { text, duration, rows: res.rowCount })
  return res
}