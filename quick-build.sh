#!/bin/bash

set -e

DOCKER_USER=${DOCKER_USER:-"kubertinus"}
VERSION=${VERSION:-$(node -p "require('./package.json').version")}

echo "🚢 Building K8s Fleet Manager v${VERSION} for AMD64..."

# Build the image
docker build --platform linux/amd64 \
    -f Dockerfile.amd64 \
    -t ${DOCKER_USER}/k8s-fleet-manager:${VERSION} \
    -t ${DOCKER_USER}/k8s-fleet-manager:latest \
    .

echo "✅ Build complete!"
echo "🚀 Pushing to Docker Hub..."

# Push to Docker Hub
docker push ${DOCKER_USER}/k8s-fleet-manager:${VERSION}
docker push ${DOCKER_USER}/k8s-fleet-manager:latest

echo "🎉 Images pushed successfully!"
echo ""
echo "Available tags:"
echo "   ${DOCKER_USER}/k8s-fleet-manager:${VERSION}"
echo "   ${DOCKER_USER}/k8s-fleet-manager:latest"