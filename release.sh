#!/bin/bash

# K8s Fleet Manager Complete Build & Deploy Script
# This script handles version updates, building, and deployment in one go

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Functions
print_header() {
    echo -e "${BLUE}===========================================${NC}"
    echo -e "${BLUE}🚢 K8s Fleet Manager Build & Deploy Pipeline${NC}"
    echo -e "${BLUE}===========================================${NC}"
}

print_step() {
    echo -e "${YELLOW}🔄 $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

# Check if version argument is provided
if [ $# -eq 0 ]; then
    print_error "No version argument provided"
    echo "Usage: $0 <version>"
    echo "Example: $0 0.4.9"
    exit 1
fi

NEW_VERSION=$1

print_header

# Step 1: Update version in all files
print_step "Updating version to $NEW_VERSION in all files..."
./update-version.sh $NEW_VERSION
print_success "Version updated to $NEW_VERSION"

# Step 2: Git add changes
print_step "Staging changes for commit..."
git add package.json deploy/app.yaml quick-build.sh
print_success "Changes staged"

# Step 3: Build Docker image
print_step "Building Docker image for version $NEW_VERSION..."
./quick-build.sh
if [ $? -eq 0 ]; then
    print_success "Docker image built and pushed successfully"
else
    print_error "Docker build failed"
    exit 1
fi

# Step 4: Deploy to Kubernetes
print_step "Deploying to Kubernetes..."
kubectl apply -f deploy/
kubectl rollout restart deployment/k8s-fleet-manager-app -n k8s-fleet-manager
print_success "Deployment updated"

# Step 5: Wait for rollout
print_step "Waiting for rollout to complete..."
kubectl rollout status deployment/k8s-fleet-manager-app -n k8s-fleet-manager
print_success "Rollout completed successfully"

# Step 6: Verify deployment
print_step "Verifying deployment..."
sleep 5
HEALTH_CHECK=$(curl -k -s -o /dev/null -w "%{http_code}" https://k8s-fleet-manager.diersmann.com/api/health)
if [ "$HEALTH_CHECK" = "200" ]; then
    print_success "Application health check passed (HTTP $HEALTH_CHECK)"
else
    print_error "Application health check failed (HTTP $HEALTH_CHECK)"
fi

# Step 7: Commit changes
print_step "Committing changes to git..."
git commit -m "Release version $NEW_VERSION

- Updated package.json to version $NEW_VERSION
- Updated header display to v$NEW_VERSION
- Updated deployment manifest to use harbor.diersmann.com/library/k8s-fleet-manager:$NEW_VERSION
- Updated build scripts for version $NEW_VERSION
- Built and deployed to Kubernetes successfully"

print_success "Changes committed to git"

echo ""
print_success "🎉 K8s Fleet Manager $NEW_VERSION deployed successfully!"
echo -e "${BLUE}📱 Application URL: https://k8s-fleet-manager.diersmann.com${NC}"
echo -e "${BLUE}🔍 Health Check: https://k8s-fleet-manager.diersmann.com/api/health${NC}"
echo ""
echo -e "${YELLOW}📋 Deployment Summary:${NC}"
echo "   • Version: $NEW_VERSION"
echo "   • Image: harbor.diersmann.com/library/k8s-fleet-manager:$NEW_VERSION"
echo "   • Namespace: k8s-fleet-manager"
echo "   • Status: Ready and healthy"