// Parsing of container image references such as
//   nginx, nginx:1.27, docker.io/library/nginx:1.27,
//   ghcr.io/org/app:v1.2.3, localhost:5000/app:dev, app@sha256:abc..., app:1.2@sha256:abc...

export interface ImageReference {
  // Normalised reference used as key in the database (registry/repository[:tag][@digest])
  image: string
  registry: string
  repository: string
  tag?: string
  digest?: string
}

export const DOCKER_HUB = 'docker.io'

export function parseImageReference(raw: string): ImageReference {
  let rest = raw.trim()

  let digest: string | undefined
  const at = rest.indexOf('@')
  if (at !== -1) {
    digest = rest.slice(at + 1)
    rest = rest.slice(0, at)
  }

  // A tag is the part after the last ':' unless that ':' belongs to a registry port.
  let tag: string | undefined
  const lastColon = rest.lastIndexOf(':')
  if (lastColon > rest.lastIndexOf('/')) {
    tag = rest.slice(lastColon + 1)
    rest = rest.slice(0, lastColon)
  }

  const parts = rest.split('/')
  let registry = DOCKER_HUB
  let repository = rest
  if (parts.length > 1 && (parts[0].includes('.') || parts[0].includes(':') || parts[0] === 'localhost')) {
    registry = parts[0]
    repository = parts.slice(1).join('/')
  }
  if (registry === 'index.docker.io' || registry === 'registry-1.docker.io') {
    registry = DOCKER_HUB
  }
  if (registry === DOCKER_HUB && !repository.includes('/')) {
    repository = `library/${repository}`
  }

  // Kubernetes pulls ":latest" when no tag and no digest is given.
  if (!tag && !digest) tag = 'latest'

  const image = `${registry}/${repository}${tag ? `:${tag}` : ''}${digest ? `@${digest}` : ''}`
  return { image, registry, repository, tag, digest }
}

// Short display name: drops docker.io and library/ like `docker` does.
export function displayRepository(registry: string, repository: string) {
  if (registry !== DOCKER_HUB) return `${registry}/${repository}`
  return repository.startsWith('library/') ? repository.slice('library/'.length) : repository
}
