#!/bin/bash

set -e

IMAGE_NAME="k8s-fleet-manager"
DOCKER_USER=${DOCKER_USER:-"kubertinus"}
VERSION=${VERSION:-$(node -p "require('./package.json').version")}
DOCKERFILE=${DOCKERFILE:-"Dockerfile.amd64"}

if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Start Docker and try again."
    exit 1
fi

if [ ! -f "package.json" ]; then
    echo "❌ package.json not found. Run this script from the project root."
    exit 1
fi

echo "🔐 Logging into Docker Hub..."
docker login

echo "🔨 Building ${DOCKER_USER}/${IMAGE_NAME}:${VERSION} (amd64)..."
docker build --platform linux/amd64 \
    -f "${DOCKERFILE}" \
    -t "${DOCKER_USER}/${IMAGE_NAME}:${VERSION}" \
    -t "${DOCKER_USER}/${IMAGE_NAME}:latest" \
    .

echo "📤 Pushing tags to Docker Hub..."
docker push "${DOCKER_USER}/${IMAGE_NAME}:${VERSION}"
docker push "${DOCKER_USER}/${IMAGE_NAME}:latest"

echo "✅ Done"
echo "   ${DOCKER_USER}/${IMAGE_NAME}:${VERSION}"
echo "   ${DOCKER_USER}/${IMAGE_NAME}:latest"