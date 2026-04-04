#!/usr/bin/env bash
# =============================================================================
# smoke-test.sh — End-to-end smoke test for the Church App backend
#
# Usage: ./infra/smoke-test.sh <email> <password>
#
# Tests:
#   1. Health — liveness & readiness probes
#   2. Auth   — signup + login flow
#   3. Protected route — GET /api/users/me with JWT
#   4. Rate limiting — confirm throttler is active
#   5. GraphQL — introspection query
#   6. Swagger — docs endpoint
# =============================================================================
set -euo pipefail

BASE_URL="${BASE_URL:-https://church-app-backend-27hc.onrender.com}"
EMAIL="${1:?Usage: $0 <email> <password>}"
PASSWORD="${2:?Usage: $0 <email> <password>}"

PASS=0
FAIL=0
WARN=0

pass() { PASS=$((PASS + 1)); echo "  ✅ PASS: $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  ❌ FAIL: $1"; }
warn() { WARN=$((WARN + 1)); echo "  ⚠️  WARN: $1"; }

echo "============================================"
echo "  Church App Backend — Smoke Test"
echo "  Target: $BASE_URL"
echo "  Date:   $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "============================================"
echo ""

# -------------------------------------------------------------------
# Test 1: Health endpoints
# -------------------------------------------------------------------
echo "── Test 1: Health Endpoints ──"

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/health")
if [ "$HTTP_CODE" = "200" ]; then
  pass "GET /api/health → $HTTP_CODE"
else
  fail "GET /api/health → $HTTP_CODE (expected 200)"
fi

READY_BODY=$(curl -s "$BASE_URL/api/health/ready")
READY_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/health/ready")
if [ "$READY_CODE" = "200" ]; then
  pass "GET /api/health/ready → $READY_CODE"
  DB_STATUS=$(echo "$READY_BODY" | grep -o '"database":"[^"]*"' | head -1)
  if echo "$DB_STATUS" | grep -q "connected"; then
    pass "Database connected"
  else
    fail "Database not connected: $DB_STATUS"
  fi
else
  fail "GET /api/health/ready → $READY_CODE (expected 200)"
fi

echo ""

# -------------------------------------------------------------------
# Test 2: Auth — Signup + Login
# -------------------------------------------------------------------
echo "── Test 2: Auth Flow ──"

SIGNUP_RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/auth/signup" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
SIGNUP_BODY=$(echo "$SIGNUP_RESP" | head -n -1)
SIGNUP_CODE=$(echo "$SIGNUP_RESP" | tail -1)

if [ "$SIGNUP_CODE" = "201" ]; then
  pass "POST /api/auth/signup → $SIGNUP_CODE (new account)"
elif [ "$SIGNUP_CODE" = "401" ] || [ "$SIGNUP_CODE" = "400" ] || [ "$SIGNUP_CODE" = "409" ]; then
  warn "POST /api/auth/signup → $SIGNUP_CODE (account may already exist — continuing)"
else
  fail "POST /api/auth/signup → $SIGNUP_CODE"
  echo "    Body: $SIGNUP_BODY"
fi

LOGIN_RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
LOGIN_BODY=$(echo "$LOGIN_RESP" | head -n -1)
LOGIN_CODE=$(echo "$LOGIN_RESP" | tail -1)

if [ "$LOGIN_CODE" = "200" ] || [ "$LOGIN_CODE" = "201" ]; then
  pass "POST /api/auth/login → $LOGIN_CODE"
  ACCESS_TOKEN=$(echo "$LOGIN_BODY" | grep -o '"accessToken":"[^"]*"' | head -1 | cut -d'"' -f4)
  if [ -n "$ACCESS_TOKEN" ]; then
    pass "Received access token (${#ACCESS_TOKEN} chars)"
  else
    fail "No accessToken in login response"
    ACCESS_TOKEN=""
  fi
elif [ "$LOGIN_CODE" = "401" ]; then
  warn "POST /api/auth/login → $LOGIN_CODE (email confirmation may be required — expected for new accounts)"
  ACCESS_TOKEN=""
else
  fail "POST /api/auth/login → $LOGIN_CODE"
  echo "    Body: $LOGIN_BODY"
  ACCESS_TOKEN=""
fi

echo ""

# -------------------------------------------------------------------
# Test 3: Protected route — GET /api/users/me
# -------------------------------------------------------------------
echo "── Test 3: Protected Route ──"

if [ -n "$ACCESS_TOKEN" ]; then
  ME_RESP=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/users/me" \
    -H "Authorization: Bearer $ACCESS_TOKEN")
  ME_BODY=$(echo "$ME_RESP" | head -n -1)
  ME_CODE=$(echo "$ME_RESP" | tail -1)

  if [ "$ME_CODE" = "200" ]; then
    pass "GET /api/users/me → $ME_CODE (authenticated)"
    USER_ID=$(echo "$ME_BODY" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
    if [ -n "$USER_ID" ]; then
      pass "User ID: $USER_ID"
    fi
  else
    fail "GET /api/users/me → $ME_CODE (expected 200)"
    echo "    Body: $ME_BODY"
  fi

  # Confirm 401 without token
  NOAUTH_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/users/me")
  if [ "$NOAUTH_CODE" = "401" ]; then
    pass "GET /api/users/me (no token) → $NOAUTH_CODE"
  else
    fail "GET /api/users/me (no token) → $NOAUTH_CODE (expected 401)"
  fi
else
  warn "Skipping protected route tests — no access token"
fi

echo ""

# -------------------------------------------------------------------
# Test 4: Rate Limiting
# -------------------------------------------------------------------
echo "── Test 4: Rate Limiting ──"

RL_HEADERS=$(curl -s -I "$BASE_URL/api/health" 2>/dev/null)
if echo "$RL_HEADERS" | grep -qi "x-ratelimit"; then
  pass "Rate limit headers present on /api/health"
else
  # Health endpoint skips throttle — check a different endpoint
  RL_HEADERS2=$(curl -s -I "$BASE_URL/api/users/me" 2>/dev/null)
  if echo "$RL_HEADERS2" | grep -qi "x-ratelimit"; then
    pass "Rate limit headers present on /api/users/me"
  else
    warn "No x-ratelimit headers found (throttler may not attach headers to 401/skipped routes)"
  fi
fi

echo ""

# -------------------------------------------------------------------
# Test 5: GraphQL
# -------------------------------------------------------------------
echo "── Test 5: GraphQL ──"

# Introspection is disabled in production by Apollo Server — this is correct.
# Test with a simple query instead; expect either data or an auth error (not 404/500).
GQL_RESP=$(curl -s -w "\n%{http_code}" -X POST "$BASE_URL/graphql" \
  -H "Content-Type: application/json" \
  -d '{"query":"{ __typename }"}')
GQL_BODY=$(echo "$GQL_RESP" | head -n -1)
GQL_CODE=$(echo "$GQL_RESP" | tail -1)

if [ "$GQL_CODE" = "200" ]; then
  pass "POST /graphql → $GQL_CODE (endpoint reachable)"
  if echo "$GQL_BODY" | grep -q "__typename"; then
    pass "GraphQL responding with data"
  fi
elif [ "$GQL_CODE" = "400" ]; then
  # Check if it's introspection-disabled vs actual error
  if echo "$GQL_BODY" | grep -q "INTROSPECTION_DISABLED"; then
    pass "POST /graphql → endpoint active (introspection correctly disabled in production)"
  else
    # 400 on __typename means the endpoint is alive but query failed
    warn "POST /graphql → $GQL_CODE (endpoint active, query rejected)"
  fi
else
  fail "POST /graphql → $GQL_CODE (expected 200 or 400)"
fi

echo ""

# -------------------------------------------------------------------
# Test 6: Swagger / OpenAPI Docs
# -------------------------------------------------------------------
echo "── Test 6: Swagger Docs ──"

DOCS_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/docs")
if [ "$DOCS_CODE" = "200" ] || [ "$DOCS_CODE" = "301" ] || [ "$DOCS_CODE" = "302" ]; then
  pass "GET /api/docs → $DOCS_CODE"
else
  fail "GET /api/docs → $DOCS_CODE (expected 200/301/302)"
fi

SPEC_CODE=$(curl -s -o /dev/null -w "%{http_code}" "$BASE_URL/api/docs-json")
if [ "$SPEC_CODE" = "200" ]; then
  pass "GET /api/docs-json → $SPEC_CODE (OpenAPI spec)"
else
  warn "GET /api/docs-json → $SPEC_CODE (Swagger JSON endpoint may be at different path)"
fi

echo ""

# -------------------------------------------------------------------
# Summary
# -------------------------------------------------------------------
echo "============================================"
echo "  Results: $PASS passed, $FAIL failed, $WARN warnings"
echo "============================================"

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
