#!/bin/bash

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_header() {
  echo -e "${BLUE}===========================================${NC}"
  echo -e "${BLUE}🔎 K8s Fleet Manager Release Check${NC}"
  echo -e "${BLUE}===========================================${NC}"
}

print_ok() {
  echo -e "${GREEN}✅ $1${NC}"
}

print_warn() {
  echo -e "${YELLOW}⚠️  $1${NC}"
}

print_fail() {
  echo -e "${RED}❌ $1${NC}"
}

usage() {
  echo "Usage: $0 <version> [--check-dockerhub]"
  echo "Example: $0 0.6.1 --check-dockerhub"
}

if [[ $# -lt 1 ]]; then
  usage
  exit 1
fi

VERSION="$1"
CHECK_DOCKERHUB="false"

if [[ "${2:-}" == "--check-dockerhub" ]]; then
  CHECK_DOCKERHUB="true"
fi

if [[ ! -f "package.json" ]]; then
  print_fail "Run this script from the K8s Fleet Manager project root"
  exit 1
fi

print_header

FAILURES=0

expect_equals() {
  local label="$1"
  local actual="$2"
  local expected="$3"

  if [[ "$actual" == "$expected" ]]; then
    print_ok "$label"
  else
    print_fail "$label (expected: $expected, got: $actual)"
    FAILURES=$((FAILURES + 1))
  fi
}

# The UI and the build scripts read the version from package.json
PACKAGE_VERSION=$(grep -E '"version"' package.json | sed -E 's/.*"version": "([0-9]+\.[0-9]+\.[0-9]+)".*/\1/')
DEPLOY_TAG=$(grep -E 'image:\s*kubertinus/k8s-fleet-manager:' deploy/app.yaml | sed -E 's/.*k8s-fleet-manager:([0-9]+\.[0-9]+\.[0-9]+).*/\1/')

expect_equals "package.json version matches" "$PACKAGE_VERSION" "$VERSION"
expect_equals "Deployment image tag matches" "$DEPLOY_TAG" "$VERSION"

if npm test --silent > /tmp/k8s-fleet-manager-tests.log 2>&1; then
  print_ok "Unit tests pass ($(grep -Eo 'Tests +[0-9]+ passed' /tmp/k8s-fleet-manager-tests.log | grep -Eo '[0-9]+') tests)"
else
  print_fail "Unit tests fail (see /tmp/k8s-fleet-manager-tests.log)"
  FAILURES=$((FAILURES + 1))
fi

if grep -q "### v$VERSION" README.md; then
  print_ok "README changelog entry exists (v$VERSION)"
else
  print_fail "README changelog entry missing (### v$VERSION)"
  FAILURES=$((FAILURES + 1))
fi

if [[ "$CHECK_DOCKERHUB" == "true" ]]; then
  echo ""
  echo -e "${BLUE}Checking Docker Hub manifests...${NC}"
  if docker manifest inspect "kubertinus/k8s-fleet-manager:$VERSION" > /dev/null 2>&1; then
    print_ok "Docker Hub tag exists: kubertinus/k8s-fleet-manager:$VERSION"
  else
    print_fail "Docker Hub tag missing: kubertinus/k8s-fleet-manager:$VERSION"
    FAILURES=$((FAILURES + 1))
  fi

  if docker manifest inspect "kubertinus/k8s-fleet-manager:latest" > /dev/null 2>&1; then
    print_ok "Docker Hub tag exists: kubertinus/k8s-fleet-manager:latest"
  else
    print_warn "Docker Hub tag check failed for latest"
  fi
fi

echo ""
if [[ $FAILURES -eq 0 ]]; then
  print_ok "All release checks passed for v$VERSION"
  exit 0
else
  print_fail "$FAILURES check(s) failed for v$VERSION"
  exit 1
fi
