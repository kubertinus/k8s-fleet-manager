import { NextRequest, NextResponse } from 'next/server'
import { exec } from 'child_process'
import https from 'https'
import { promisify } from 'util'
import { query } from '../../../../../../lib/database'

const execAsync = promisify(exec)

interface ImageToCheck {
  name: string
  tag: string
  fullName: string
}

interface ImageUpdateCheckRequest {
  images: ImageToCheck[]
}

interface ImageUpdateInfo {
  fullName: string
  hasUpdate: boolean
  currentVersion: string
  newerVersion?: string
  checkedVia: 'nexus' | 'current-repo'
}

interface NexusAuthConfig {
  username: string
  password: string
}

/**
 * Check if newer versions of images are available in their registries
 * This uses docker/skopeo to check registry tags without pulling images
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const resolvedParams = await params
    const clusterId = parseInt(resolvedParams.id)
    
    const body: ImageUpdateCheckRequest = await request.json()
    const { images } = body
    
    if (!images || !Array.isArray(images)) {
      return NextResponse.json(
        { error: 'Invalid request body' },
        { status: 400 }
      )
    }

    const nexusSettingsResult = await query(
      'SELECT key, value FROM settings WHERE key = ANY($1)',
      [['nexus_server_url', 'nexus_allow_insecure_tls', 'nexus_username', 'nexus_password']]
    )
    const nexusSettings: Record<string, string> = {}
    nexusSettingsResult.rows.forEach((row: any) => {
      nexusSettings[row.key] = row.value
    })

    const nexusServerUrl = (nexusSettings.nexus_server_url || '').trim()
    const nexusAllowInsecureTls = (nexusSettings.nexus_allow_insecure_tls || 'false') === 'true'
    const nexusAuthConfig: NexusAuthConfig = {
      username: (nexusSettings.nexus_username || '').trim(),
      password: nexusSettings.nexus_password || ''
    }
    
    const imagesWithUpdates: string[] = []
    const updateDetails: Record<string, ImageUpdateInfo> = {}
    
    // Check each image for updates
    // We'll use a simple approach: check if 'latest' tag exists and is different from current tag
    // For production, you'd want more sophisticated version comparison
    for (const image of images) {
      try {
        // Skip images that already use 'latest' tag
        if (image.tag === 'latest') {
          updateDetails[image.fullName] = {
            fullName: image.fullName,
            hasUpdate: false,
            currentVersion: image.tag,
            checkedVia: 'current-repo'
          }
          continue
        }
        
        // Parse the image name to get registry and repository
        const { registry, repository } = parseImageName(image.name)
        
        // Check if the image has a newer version available
        // This is a simplified check - in production you'd want to:
        // 1. Query the registry API for all tags
        // 2. Compare semantic versions
        // 3. Handle private registries with authentication
        const updateInfo = await checkImageHasUpdate(
          registry,
          repository,
          image.tag,
          nexusServerUrl,
          nexusAllowInsecureTls,
          nexusAuthConfig
        )
        
        updateDetails[image.fullName] = {
          fullName: image.fullName,
          hasUpdate: updateInfo.hasUpdate,
          currentVersion: image.tag,
          newerVersion: updateInfo.newerVersion,
          checkedVia: updateInfo.checkedVia
        }
        
        if (updateInfo.hasUpdate) {
          imagesWithUpdates.push(image.fullName)
        }
      } catch (err) {
        // Log error but continue checking other images
        console.error(`Error checking image ${image.fullName}:`, err)
        updateDetails[image.fullName] = {
          fullName: image.fullName,
          hasUpdate: false,
          currentVersion: image.tag,
          checkedVia: 'current-repo'
        }
      }
    }
    
    return NextResponse.json({
      imagesWithUpdates,
      updateDetails,
      checkedCount: images.length,
      updatesFound: imagesWithUpdates.length
    })
  } catch (error) {
    console.error('Error checking for image updates:', error)
    return NextResponse.json(
      { error: 'Failed to check for image updates' },
      { status: 500 }
    )
  }
}

async function checkNexusForUpdate(
  nexusServerUrl: string,
  repository: string,
  currentTag: string,
  allowInsecureTls: boolean,
  authConfig: NexusAuthConfig
): Promise<{ checked: boolean; hasUpdate: boolean; newerVersion?: string }> {
  if (!nexusServerUrl) {
    return { checked: false, hasUpdate: false }
  }

  try {
    const baseUrl = nexusServerUrl.replace(/\/$/, '')
    const tagsUrl = `${baseUrl}/v2/${repository}/tags/list`
    const response = await fetchRegistryTags(tagsUrl, allowInsecureTls, authConfig)

    if (!response.ok) {
      console.log(`Nexus API returned ${response.status} for ${repository}`)
      return { checked: false, hasUpdate: false }
    }

    const data = response.data
    const allTags = data.tags || []
    if (allTags.length === 0) {
      return { checked: true, hasUpdate: false }
    }

    if (!isSemanticVersion(currentTag)) {
      return { checked: true, hasUpdate: false }
    }

    const currentSuffix = extractVersionSuffix(currentTag)
    const currentIsPreRelease = /-(rc|beta|alpha|dev|snapshot)/i.test(currentTag)
    const semanticTags = allTags.filter((tag: string) => {
      if (!isSemanticVersion(tag)) return false

      if (extractVersionSuffix(tag) !== currentSuffix) return false

      if (!currentIsPreRelease && /-(rc|beta|alpha|dev|snapshot)/i.test(tag)) {
        return false
      }

      return true
    })

    if (semanticTags.length === 0) {
      return { checked: true, hasUpdate: false }
    }

    semanticTags.sort((a: string, b: string) => compareSemanticVersions(b, a))
    const newestTag = semanticTags[0]

    if (compareSemanticVersions(newestTag, currentTag) > 0) {
      return { checked: true, hasUpdate: true, newerVersion: newestTag }
    }

    return { checked: true, hasUpdate: false }
  } catch (error) {
    console.error(`Error checking Nexus for ${repository}:`, error)
    return { checked: false, hasUpdate: false }
  }
}

async function fetchRegistryTags(
  tagsUrl: string,
  allowInsecureTls: boolean,
  authConfig: NexusAuthConfig
): Promise<{ ok: boolean; status: number; data: { tags?: string[] } }> {
  const headers: Record<string, string> = {
    'Accept': 'application/json'
  }

  if (authConfig.username && authConfig.password) {
    const authToken = Buffer.from(`${authConfig.username}:${authConfig.password}`).toString('base64')
    headers['Authorization'] = `Basic ${authToken}`
  }

  if (allowInsecureTls && tagsUrl.startsWith('https://')) {
    return new Promise((resolve, reject) => {
      const req = https.request(tagsUrl, {
        method: 'GET',
        headers,
        rejectUnauthorized: false
      }, (res) => {
        let body = ''

        res.on('data', (chunk) => {
          body += chunk
        })

        res.on('end', () => {
          const status = res.statusCode || 500

          if (status < 200 || status >= 300) {
            resolve({ ok: false, status, data: {} })
            return
          }

          try {
            const parsed = body ? JSON.parse(body) : {}
            resolve({ ok: true, status, data: parsed })
          } catch {
            resolve({ ok: false, status: 502, data: {} })
          }
        })
      })

      req.on('error', reject)
      req.end()
    })
  }

  const response = await fetch(tagsUrl, { headers })
  if (!response.ok) {
    return { ok: false, status: response.status, data: {} }
  }

  const data = await response.json() as { tags?: string[] }
  return { ok: true, status: response.status, data }
}

/**
 * Parse image name to extract registry and repository
 */
function parseImageName(imageName: string): { registry: string; repository: string } {
  console.log(`[parseImageName] Input: "${imageName}"`)
  
  // Handle various image name formats:
  // - docker.io/library/nginx
  // - gcr.io/project/image
  // - localhost:5000/image
  // - nginx (defaults to docker.io/library/nginx)
  
  const parts = imageName.split('/')
  
  let result
  if (parts.length === 1) {
    // No registry specified, assume Docker Hub official image
    result = {
      registry: 'docker.io',
      repository: `library/${parts[0]}`
    }
  } else if (parts.length === 2) {
    // Check if first part looks like a registry (has . or :)
    if (parts[0].includes('.') || parts[0].includes(':')) {
      result = {
        registry: parts[0],
        repository: parts[1]
      }
    } else {
      // Docker Hub user image
      result = {
        registry: 'docker.io',
        repository: imageName
      }
    }
  } else {
    // Full path with registry
    result = {
      registry: parts[0],
      repository: parts.slice(1).join('/')
    }
  }
  
  console.log(`[parseImageName] Output: registry="${result.registry}", repository="${result.repository}"`)
  return result
}

/**
 * Check registry.k8s.io for newer image versions via OCI distribution API
 * Returns {hasUpdate, newerVersion}
 */
async function checkRegistryK8sForUpdate(
  repository: string,
  currentTag: string
): Promise<{ hasUpdate: boolean; newerVersion?: string }> {
  try {
    // registry.k8s.io uses OCI distribution API
    // API endpoint: https://registry.k8s.io/v2/{repository}/tags/list
    const tagsUrl = `https://registry.k8s.io/v2/${repository}/tags/list`
    
    console.log(`Fetching tags from registry.k8s.io: ${tagsUrl}`)
    
    const response = await fetch(tagsUrl, {
      headers: {
        'Accept': 'application/json'
      }
    })
    
    if (!response.ok) {
      console.log(`registry.k8s.io API returned ${response.status} for ${repository}`)
      return { hasUpdate: false }
    }
    
    const data = await response.json() as { name: string; tags: string[] }
    const allTags = data.tags || []
    
    console.log(`Found ${allTags.length} tags for ${repository} in registry.k8s.io`)
    
    if (allTags.length === 0) {
      return { hasUpdate: false }
    }
    
    // Use the same semantic versioning logic as Docker Hub
    if (!isSemanticVersion(currentTag)) {
      console.log(`Current tag "${currentTag}" is not a semantic version`)
      return { hasUpdate: false }
    }
    
    console.log(`✓ Current tag "${currentTag}" is a semantic version`)
    
    // Extract suffix from current tag (e.g., "-alpine", "-slim")
    const currentSuffix = extractVersionSuffix(currentTag)
    console.log(`Current tag suffix: "${currentSuffix}"`)
    
    // Check if current version is a pre-release
    const currentIsPreRelease = /-(rc|beta|alpha|dev|snapshot)/i.test(currentTag)
    console.log(`Current tag is pre-release: ${currentIsPreRelease}`)
    
    // Filter tags to only semantic versions with the same suffix
    const semanticTags = allTags.filter(tag => {
      const isSemantic = isSemanticVersion(tag)
      if (!isSemantic) return false
      
      const suffix = extractVersionSuffix(tag)
      const hasSameSuffix = suffix === currentSuffix
      
      // If current tag is NOT a pre-release, exclude pre-release tags
      if (!currentIsPreRelease && /-(rc|beta|alpha|dev|snapshot)/i.test(tag)) {
        return false
      }
      
      return hasSameSuffix
    })
    
    console.log(`Found ${semanticTags.length} semantic version tags with same suffix "${currentSuffix}"`)
    
    if (semanticTags.length === 0) {
      console.log(`No stable semantic version tags found`)
      return { hasUpdate: false }
    }
    
    // Sort by semantic version (descending)
    semanticTags.sort((a: string, b: string) => compareSemanticVersions(b, a))
    
    const newestTag = semanticTags[0]
    console.log(`Newest tag: "${newestTag}", Current: "${currentTag}"`)
    
    // Compare versions
    const comparison = compareSemanticVersions(newestTag, currentTag)
    console.log(`compareSemanticVersions("${newestTag}", "${currentTag}") = ${comparison}`)
    
    if (comparison > 0) {
      console.log(`✓✓✓ UPDATE AVAILABLE: ${currentTag} -> ${newestTag}`)
      return { hasUpdate: true, newerVersion: newestTag }
    } else {
      console.log(`✗ No update (comparison result: ${comparison})`)
      return { hasUpdate: false }
    }
  } catch (error) {
    console.error(`Error checking registry.k8s.io for ${repository}:`, error)
    return { hasUpdate: false }
  }
}

/**
 * Check Harbor registry for newer image versions
 * Returns {checked: true/false, hasUpdate, newerVersion}
 */
async function checkHarborForUpdate(
  registry: string,
  repository: string,
  currentTag: string
): Promise<{ checked: boolean; hasUpdate: boolean; newerVersion?: string }> {
  try {
    // Fetch Harbor settings from database
    const settingsResult = await query(
      'SELECT key, value FROM settings WHERE key LIKE $1',
      ['harbor_%']
    )
    
    const harborSettings: Record<string, string> = {}
    settingsResult.rows.forEach((row: any) => {
      harborSettings[row.key] = row.value
    })
    
    // Check if Harbor is enabled
    if (harborSettings.harbor_enabled !== 'true' || !harborSettings.harbor_url) {
      return { checked: false, hasUpdate: false }
    }
    
    const harborUrl = harborSettings.harbor_url.replace(/\/$/, '') // Remove trailing slash
    const projectName = harborSettings.harbor_project || ''
    
    console.log(`Checking Harbor for ${repository}:${currentTag}`)
    console.log(`Harbor URL: ${harborUrl}, Project: ${projectName || 'all projects'}`)
    
    // Harbor API uses /v2/<project>/<repository>/tags/list format
    // But we need to find the right project first
    // Try the specified project, or search common project names based on registry
    let projectsToTry: string[] = []
    if (projectName) {
      projectsToTry = [projectName]
    } else if (registry === 'registry.k8s.io') {
      // Try common project names for Kubernetes registry proxy
      projectsToTry = ['nexus', 'registry.k8s.io', 'k8s', 'kubernetes', 'proxy-cache', 'library']
    } else if (registry === 'quay.io') {
      projectsToTry = ['quay.io', 'quay', 'nexus', 'proxy-cache', 'library']
    } else {
      projectsToTry = ['nexus', 'proxy-cache', 'library', 'dockerhub']
    }
    
    const headers: Record<string, string> = {
      'Accept': 'application/json'
    }
    
    // Add authentication if configured
    if (harborSettings.harbor_username && harborSettings.harbor_password) {
      const authString = Buffer.from(`${harborSettings.harbor_username}:${harborSettings.harbor_password}`).toString('base64')
      headers['Authorization'] = `Basic ${authString}`
      console.log(`Using authentication for Harbor`)
    }
    
    let allTags: string[] = []
    
    for (const project of projectsToTry) {
      // For Harbor, use the full repository path (e.g., sig-storage/snapshot-controller)
      // Harbor stores the full path under the project
      const imageName = repository
      
      console.log(`[Harbor] Trying project "${project}" for image "${imageName}" from registry "${registry}"`)
      
      // Harbor V2 API: /api/v2.0/projects/{project}/repositories/{repository}/artifacts
      // The repository parameter should be URL-encoded and can include slashes
      const artifactsUrl = `https://${harborUrl}/api/v2.0/projects/${project}/repositories/${encodeURIComponent(imageName)}/artifacts?page=1&page_size=100&with_tag=true`
      
      console.log(`Trying Harbor URL: ${artifactsUrl}`)
      
      try {
        const response = await fetch(artifactsUrl, { headers })
        
        console.log(`Harbor response status for ${project}/${imageName}: ${response.status}`)
        
        if (response.ok) {
          const data = await response.json()
          console.log(`Found ${data.length} artifacts in Harbor ${project}/${imageName}`)
          
          // Extract tags from artifacts
          data.forEach((artifact: any) => {
            if (artifact.tags && Array.isArray(artifact.tags)) {
              artifact.tags.forEach((tag: any) => {
                if (tag.name && tag.name !== 'latest') {
                  allTags.push(tag.name)
                }
              })
            }
          })
          
          // If we found tags, no need to try other projects
          if (allTags.length > 0) {
            console.log(`Found ${allTags.length} tags in Harbor project ${project}`)
            break
          }
        }
      } catch (err) {
        console.log(`Error checking Harbor project ${project}: ${err}`)
        continue
      }
    }
    
    console.log(`Extracted tags from Harbor: ${allTags.join(', ')}`)
    
    if (allTags.length === 0) {
      console.log(`No tags found in Harbor for ${repository}`)
      return { checked: true, hasUpdate: false }
    }
    
    // Apply the same version comparison logic as Docker Hub
    if (isSemanticVersion(currentTag)) {
      const currentSuffix = extractVersionSuffix(currentTag)
      const currentIsPreRelease = /-(rc|beta|alpha|dev|snapshot)/i.test(currentTag)
      
      const semanticTags = allTags.filter(tag => {
        const isSemantic = isSemanticVersion(tag)
        const hasSameSuffix = extractVersionSuffix(tag) === currentSuffix
        
        // If current tag is NOT a pre-release, exclude pre-release tags from comparison
        if (!currentIsPreRelease) {
          const isPreRelease = /-(rc|beta|alpha|dev|snapshot)/i.test(tag)
          if (isPreRelease) {
            return false
          }
        }
        
        return isSemantic && hasSameSuffix
      })
      
      console.log(`Found ${semanticTags.length} semantic tags with suffix "${currentSuffix}"`)
      
      if (semanticTags.length > 0) {
        const sortedTags = semanticTags.sort((a, b) => compareSemanticVersions(b, a))
        const newestVersion = sortedTags[0]
        
        console.log(`Newest version in Harbor: ${newestVersion}, Current: ${currentTag}`)
        
        if (compareSemanticVersions(newestVersion, currentTag) > 0) {
          console.log(`✓ Harbor: Update available: ${currentTag} -> ${newestVersion}`)
          return { checked: true, hasUpdate: true, newerVersion: newestVersion }
        }
      }
    }
    
    return { checked: true, hasUpdate: false }
  } catch (err) {
    console.error(`Error checking Harbor for ${repository}:`, err)
    return { checked: false, hasUpdate: false }
  }
}

/**
 * Check if an image has updates available
 * This checks Nexus first (if configured), then falls back to Docker Hub
 */
async function checkImageHasUpdate(
  registry: string,
  repository: string,
  currentTag: string,
  nexusServerUrl: string,
  nexusAllowInsecureTls: boolean,
  nexusAuthConfig: NexusAuthConfig
): Promise<{ hasUpdate: boolean; newerVersion?: string; checkedVia: 'nexus' | 'current-repo' }> {
  try {
    // First, check Nexus when configured in settings
    const nexusResult = await checkNexusForUpdate(
      nexusServerUrl,
      repository,
      currentTag,
      nexusAllowInsecureTls,
      nexusAuthConfig
    )
    if (nexusResult.checked) {
      return { hasUpdate: nexusResult.hasUpdate, newerVersion: nexusResult.newerVersion, checkedVia: 'nexus' }
    }

    // First, check if Harbor is enabled and try checking it
    const harborResult = await checkHarborForUpdate(registry, repository, currentTag)
    if (harborResult.checked && harborResult.hasUpdate) {
      // If Harbor found an update, return it
      return { hasUpdate: harborResult.hasUpdate, newerVersion: harborResult.newerVersion, checkedVia: 'current-repo' }
    }
    
    // Always fallback to Docker Hub/ECR checks
    // (even if Harbor was checked but found no updates)
    if (registry === 'docker.io') {
      const result = await checkDockerHubForUpdate(repository, currentTag)
      return { ...result, checkedVia: 'current-repo' }
    }
    
    // For AWS ECR Public (public.ecr.aws), check if it's a Docker Hub mirror
    // ECR mirrors Docker Hub images under public.ecr.aws/docker/library/*
    if (registry === 'public.ecr.aws' && repository.startsWith('docker/library/')) {
      // Extract the actual image name from the mirror path
      const dockerHubRepo = repository.replace('docker/library/', 'library/')
      console.log(`ECR image detected: checking Docker Hub for ${dockerHubRepo}`)
      const result = await checkDockerHubForUpdate(dockerHubRepo, currentTag)
      return { ...result, checkedVia: 'current-repo' }
    }
    
    // For registry.k8s.io, check via its public OCI API
    if (registry === 'registry.k8s.io') {
      console.log(`registry.k8s.io image detected: checking via OCI API for ${repository}`)
      const result = await checkRegistryK8sForUpdate(repository, currentTag)
      return { ...result, checkedVia: 'current-repo' }
    }
    
    // For other registries (quay.io, etc.), we would need registry-specific logic
    // or use tools like skopeo/crane. For now, skip these images.
    
    console.log(`⚠️  Skipping update check for non-Docker Hub registry: ${registry}/${repository}:${currentTag}`)
    return { hasUpdate: false, checkedVia: 'current-repo' }
  } catch (err) {
    console.error(`Error checking ${registry}/${repository}:${currentTag}:`, err)
    return { hasUpdate: false, checkedVia: 'current-repo' }
  }
}

/**
 * Check Docker Hub for newer versions (via Harbor proxy if available)
 */
async function checkDockerHubForUpdate(
  repository: string,
  currentTag: string
): Promise<{ hasUpdate: boolean; newerVersion?: string }> {
  try {
    // First, try to get tags via Harbor's Docker Registry V2 API
    const settingsResult = await query(
      'SELECT key, value FROM settings WHERE key LIKE $1',
      ['harbor_%']
    )
    
    const harborSettings: Record<string, string> = {}
    settingsResult.rows.forEach((row: any) => {
      harborSettings[row.key] = row.value
    })
    
    let allTags: any[] = []
    
    // Try Harbor Registry V2 API first (if enabled)
    if (harborSettings.harbor_enabled === 'true' && harborSettings.harbor_url) {
      const harborUrl = harborSettings.harbor_url.replace(/\/$/, '')
      const project = harborSettings.harbor_project || 'nexus'
      
      // Harbor Registry V2 API: /v2/{project}/{repository}/tags/list
      const registryApiUrl = `https://${harborUrl}/v2/${project}/${repository}/tags/list`
      
      console.log(`Trying Harbor Registry V2 API: ${registryApiUrl}`)
      
      const headers: Record<string, string> = {
        'Accept': 'application/json'
      }
      
      if (harborSettings.harbor_username && harborSettings.harbor_password) {
        const authString = Buffer.from(`${harborSettings.harbor_username}:${harborSettings.harbor_password}`).toString('base64')
        headers['Authorization'] = `Basic ${authString}`
      }
      
      try {
        const response = await fetch(registryApiUrl, { headers })
        
        if (response.ok) {
          const data = await response.json() as { name: string; tags: string[] }
          const tags = data.tags || []
          
          console.log(`Harbor Registry V2 API returned ${tags.length} tags for ${repository}`)
          
          if (tags.length > 0) {
            // Convert to Docker Hub format for compatibility with existing logic
            allTags = tags.map(tag => ({ name: tag }))
          }
        } else {
          console.log(`Harbor Registry V2 API returned ${response.status} for ${repository}`)
        }
      } catch (err) {
        console.log(`Harbor Registry V2 API error for ${repository}:`, err)
      }
    }
    
    // Fallback to Docker Hub API if Harbor didn't return tags
    if (allTags.length === 0) {
      console.log(`Falling back to Docker Hub API for ${repository}`)
      
      // Fetch multiple pages to ensure we get recent tags
      let page = 1
      const maxPages = 5 // Check first 500 tags
      
      while (page <= maxPages) {
        const apiUrl = `https://hub.docker.com/v2/repositories/${repository}/tags?page=${page}&page_size=100`
        
        const response = await fetch(apiUrl, {
          headers: {
            'Accept': 'application/json'
          }
        })
        
        if (!response.ok) {
          console.error(`Docker Hub API returned ${response.status} for ${repository} page ${page}`)
          break
        }
        
        const data = await response.json()
        const pageTags = data.results || []
        allTags = allTags.concat(pageTags)
        
        console.log(`Fetched page ${page} for ${repository}: ${pageTags.length} tags (total: ${allTags.length})`)
        
        // Stop if no more pages
        if (!data.next) break
        page++
      }
    }
    
    const tags = allTags
    
    console.log(`\n=== Checking ${repository}:${currentTag} ===`)
    console.log(`Total tags found: ${tags.length}`)
    
    // Check for semantic version updates first (preferred)
    if (isSemanticVersion(currentTag)) {
      console.log(`✓ Current tag "${currentTag}" is a semantic version`)
      
      // Extract suffix from current tag (e.g., "-alpine" from "8.2.2-alpine")
      const currentSuffix = extractVersionSuffix(currentTag)
      console.log(`Current tag suffix: "${currentSuffix}"`)
      
      // Check if current tag is a pre-release (contains rc, beta, alpha, dev)
      const currentIsPreRelease = /-(rc|beta|alpha|dev|snapshot)/i.test(currentTag)
      
      // Filter tags that are semantic versions AND have the same suffix
      const semanticTags = tags
        .filter((t: any) => {
          const isSemantic = isSemanticVersion(t.name)
          const hasSameSuffix = extractVersionSuffix(t.name) === currentSuffix
          
          // If current tag is NOT a pre-release, exclude pre-release tags from comparison
          if (!currentIsPreRelease) {
            const isPreRelease = /-(rc|beta|alpha|dev|snapshot)/i.test(t.name)
            if (isPreRelease) {
              return false
            }
          }
          
          return isSemantic && hasSameSuffix
        })
      
      console.log(`Found ${semanticTags.length} semantic version tags with same suffix "${currentSuffix}"`)
      console.log(`Current tag is pre-release:`, currentIsPreRelease)
      console.log(`First 10 tags from API:`, tags.slice(0, 10).map((t: any) => t.name))
      console.log(`First 10 matching semantic tags:`, semanticTags.slice(0, 10).map((t: any) => t.name))
      
      if (semanticTags.length === 0) {
        console.log(`⚠️  No semantic tags found with suffix "${currentSuffix}"`)
        // Try again without suffix matching to see what's available
        const allSemanticTags = tags.filter((t: any) => isSemanticVersion(t.name))
        console.log(`Total semantic tags (any suffix): ${allSemanticTags.length}`)
        console.log(`First 10 semantic tags (any suffix):`, allSemanticTags.slice(0, 10).map((t: any) => t.name))
      }
      
      // Sort with newest first
      const sortedTags = semanticTags.sort((a: any, b: any) => compareSemanticVersions(b.name, a.name))
      
      console.log(`First 5 after sorting:`, sortedTags.slice(0, 5).map((t: any) => t.name))
      
      if (sortedTags.length > 0) {
        const newestVersion = sortedTags[0].name
        const comparison = compareSemanticVersions(newestVersion, currentTag)
        console.log(`*** VELERO/ANTREA DEBUG ***`)
        console.log(`Repository: ${repository}`)
        console.log(`Newest: "${newestVersion}", Current: "${currentTag}"`)
        console.log(`compareSemanticVersions("${newestVersion}", "${currentTag}") = ${comparison}`)
        
        if (comparison > 0) {
          console.log(`✓✓✓ UPDATE AVAILABLE: ${currentTag} -> ${newestVersion}`)
          return { hasUpdate: true, newerVersion: newestVersion }
        } else {
          console.log(`✗ No update (comparison result: ${comparison})`)
        }
      }
    } else {
      console.log(`✗ Current tag "${currentTag}" is not a semantic version`)
    }
    
    // Don't check 'latest' tag - it's unreliable as it might be rebuilt with the same version
    // Only rely on semantic version comparison above
    
    return { hasUpdate: false }
  } catch (err) {
    console.error(`Error checking Docker Hub for ${repository}:`, err)
    return { hasUpdate: false }
  }
}

/**
 * Check if a tag is a semantic version (e.g., 1.2.3, v1.2.3)
 */
function isSemanticVersion(tag: string): boolean {
  // Match semantic version patterns like: 1.2.3, v1.2.3, 1.2, v1.2, 1.0.158, v1.0.158
  const semverPattern = /^v?\d+(\.\d+){1,3}(-[a-zA-Z0-9.-]+)?$/
  return semverPattern.test(tag)
}

/**
 * Extract the suffix from a version tag (e.g., "-alpine" from "8.2.2-alpine")
 * Ignores architecture suffixes like -linux-amd64, -windows-ltsc2022-amd64
 * Returns empty string if no suffix or only architecture suffix
 */
function extractVersionSuffix(tag: string): string {
  // Remove 'v' prefix if present
  const cleanTag = tag.replace(/^v/, '')
  
  // Remove architecture suffixes (common patterns)
  const archPatterns = [
    /-linux-(amd64|arm64|arm|386|ppc64le|s390x)$/,
    /-windows-[a-z0-9]+-amd64$/,
    /-darwin-(amd64|arm64)$/,
    /-(amd64|arm64|arm|386)$/
  ]
  
  let tagWithoutArch = cleanTag
  for (const pattern of archPatterns) {
    tagWithoutArch = tagWithoutArch.replace(pattern, '')
  }
  
  // Split on first dash to separate version from suffix
  const dashIndex = tagWithoutArch.indexOf('-')
  if (dashIndex === -1) {
    return '' // No suffix
  }
  
  return '-' + tagWithoutArch.substring(dashIndex + 1)
}

/**
 * Compare two semantic version strings
 * Returns: 1 if v1 > v2, -1 if v1 < v2, 0 if equal
 */
function compareSemanticVersions(v1: string, v2: string): number {
  // Remove 'v' prefix if present
  const ver1 = v1.replace(/^v/, '')
  const ver2 = v2.replace(/^v/, '')
  
  // Split version and pre-release parts
  const splitVersion = (ver: string) => {
    const parts = ver.split('-')
    const versionParts = parts[0].split('.').map(x => parseInt(x) || 0)
    const preRelease = parts[1] || ''
    return { versionParts, preRelease }
  }
  
  const { versionParts: parts1, preRelease: pre1 } = splitVersion(ver1)
  const { versionParts: parts2, preRelease: pre2 } = splitVersion(ver2)
  
  // Compare version numbers (major, minor, patch, etc.)
  const maxLength = Math.max(parts1.length, parts2.length)
  for (let i = 0; i < maxLength; i++) {
    const num1 = parts1[i] || 0
    const num2 = parts2[i] || 0
    
    if (num1 > num2) return 1
    if (num1 < num2) return -1
  }
  
  // If version numbers are equal, check pre-release tags
  // Versions without pre-release > versions with pre-release
  if (!pre1 && pre2) return 1
  if (pre1 && !pre2) return -1
  if (pre1 && pre2) {
    return pre1.localeCompare(pre2)
  }
  
  return 0
}
