#!/bin/bash

# K8s Fleet Manager AMD64 Build Script v0.6.1
# This script builds and pushes the K8s Fleet Manager Docker image for AMD64 architecture

set -e

# Configuration
IMAGE_NAME="k8s-fleet-manager"
VERSION="0.6.1"
REGISTRY_USER=${DOCKER_USER:-"kubertinus"}
DOCKERFILE="Dockerfile.amd64"

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚢 K8s Fleet Manager AMD64 Build Script v${VERSION}${NC}"
echo -e "${BLUE}===========================================${NC}"

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo -e "${RED}❌ Docker is not running. Please start Docker first.${NC}"
    exit 1
fi

# Check if we're in the right directory
if [ ! -f "package.json" ]; then
    echo -e "${RED}❌ package.json not found. Please run this script from the K8s Fleet Manager root directory.${NC}"
    exit 1
fi

# Build the image
echo -e "${YELLOW}🔨 Building AMD64 image for ${IMAGE_NAME}:${VERSION}...${NC}"
docker build --platform linux/amd64 \
    -f ${DOCKERFILE} \
    -t ${REGISTRY_USER}/${IMAGE_NAME}:${VERSION} \
    -t ${REGISTRY_USER}/${IMAGE_NAME}:latest \
    .

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ Image built successfully!${NC}"
else
    echo -e "${RED}❌ Image build failed!${NC}"
    exit 1
fi

# Show image info
echo -e "${BLUE}📊 Image information:${NC}"
docker images ${REGISTRY_USER}/${IMAGE_NAME}:${VERSION}

# Ask if user wants to push to registry
read -p "$(echo -e ${YELLOW}🚀 Push to registry? [y/N]: ${NC})" -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo -e "${YELLOW}📤 Pushing ${REGISTRY_USER}/${IMAGE_NAME}:${VERSION} to registry...${NC}"
    
    # Push versioned tag
    docker push ${REGISTRY_USER}/${IMAGE_NAME}:${VERSION}
    
    # Push latest tag
    docker push ${REGISTRY_USER}/${IMAGE_NAME}:latest
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Images pushed successfully!${NC}"
        echo -e "${GREEN}🎉 Available as: ${REGISTRY_USER}/${IMAGE_NAME}:${VERSION}${NC}"
        echo -e "${GREEN}🎉 Available as: ${REGISTRY_USER}/${IMAGE_NAME}:latest${NC}"
    else
        echo -e "${RED}❌ Push failed!${NC}"
        exit 1
    fi
else
    echo -e "${BLUE}📦 Image built locally. You can push later with:${NC}"
    echo -e "${BLUE}   docker push ${REGISTRY_USER}/${IMAGE_NAME}:${VERSION}${NC}"
    echo -e "${BLUE}   docker push ${REGISTRY_USER}/${IMAGE_NAME}:latest${NC}"
fi

# Update Kubernetes deployment file
echo -e "${YELLOW}🔄 Updating Kubernetes deployment...${NC}"
if [ -f "deploy/app.yaml" ]; then
    # Update the image reference in the deployment file
    sed -i.bak "s|image: .*|image: ${REGISTRY_USER}/${IMAGE_NAME}:${VERSION}|g" deploy/app.yaml
    echo -e "${GREEN}✅ Updated deploy/app.yaml with new image tag${NC}"
    
    # Show the change
    echo -e "${BLUE}📝 Updated image reference to:${NC}"
    grep "image:" deploy/app.yaml
else
    echo -e "${YELLOW}⚠️  deploy/app.yaml not found, skipping update${NC}"
fi

echo -e "${GREEN}🎉 Build complete! Next steps:${NC}"
echo -e "${BLUE}1. Review the updated deploy/app.yaml${NC}"
echo -e "${BLUE}2. Apply to Kubernetes: kubectl apply -f deploy/${NC}"
echo -e "${BLUE}3. Check deployment: kubectl get pods -n k8s-fleet-manager${NC}"