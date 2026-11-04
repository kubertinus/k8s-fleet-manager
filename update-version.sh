#!/bin/bash

# K8s Fleet Manager Version Update Script
# This script updates the version in all relevant files to ensure consistency

set -e

# Check if version argument is provided
if [ $# -eq 0 ]; then
    echo "❌ Error: No version argument provided"
    echo "Usage: $0 <version>"
    echo "Example: $0 0.4.9"
    exit 1
fi

NEW_VERSION=$1

echo "🔄 Updating K8s Fleet Manager to version $NEW_VERSION..."

# Update package.json
echo "📦 Updating package.json..."
sed -E -i '' "s/\"version\": \"[0-9]+\.[0-9]+\.[0-9]+\"/\"version\": \"$NEW_VERSION\"/" package.json

# Update deployment manifest
echo "🚀 Updating deployment manifest..."
sed -E -i '' "s/kubertinus\/k8s-fleet-manager:[0-9]+\.[0-9]+\.[0-9]+/kubertinus\/k8s-fleet-manager:$NEW_VERSION/" deploy/app.yaml

# Update quick-build script
echo "🔨 Updating build script..."
sed -E -i '' "s/K8s Fleet Manager v[0-9]+\.[0-9]+\.[0-9]+/K8s Fleet Manager v$NEW_VERSION/g" quick-build.sh
sed -E -i '' "s/k8s-fleet-manager:[0-9]+\.[0-9]+\.[0-9]+/k8s-fleet-manager:$NEW_VERSION/g" quick-build.sh

echo "✅ Version update complete!"
echo ""
echo "📋 Updated files:"
echo "   - package.json"
echo "   - deploy/app.yaml"
echo "   - quick-build.sh"
echo ""
echo "🔍 Verification:"
echo "   Package version: $(grep '"version"' package.json | sed -E 's/.*"([0-9]+\.[0-9]+\.[0-9]+)".*/\1/')"
echo "   Docker image: $(grep 'kubertinus/k8s-fleet-manager:' deploy/app.yaml | sed -E 's/.*k8s-fleet-manager:([0-9]+\.[0-9]+\.[0-9]+).*/\1/')"
echo ""
echo "🏗️  Next steps:"
echo "   1. Review changes: git diff"
echo "   2. Build: ./quick-build.sh"
echo "   3. Deploy: kubectl apply -f deploy/ && kubectl rollout restart deployment/k8s-fleet-manager-app -n k8s-fleet-manager"
echo "   4. Commit: git add -A && git commit -m \"Update to version $NEW_VERSION\""