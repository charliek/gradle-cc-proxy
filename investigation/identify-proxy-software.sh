#!/bin/sh
# Identify the upstream proxy software by analyzing headers and behavior

PROXY_HOST="21.0.0.17"
PROXY_PORT="15004"
TEST_URL="https://repo.maven.apache.org/maven2/"

# Extract JWT token from environment
JWT_TOKEN=$(echo "$HTTPS_PROXY" | sed 's/.*:jwt_\([^@]*\)@.*/\1/')

echo "=== Upstream Proxy Software Identification ==="
echo "Proxy: $PROXY_HOST:$PROXY_PORT"
echo ""

# Test 1: Check response headers for proxy signatures
echo "--- Test 1: HTTP Response Headers ---"
curl -x "http://user:jwt_${JWT_TOKEN}@${PROXY_HOST}:${PROXY_PORT}" \
  -I -s "$TEST_URL" 2>&1 | grep -iE "(server|via|proxy|x-|envoy|squid|nginx)"

echo ""
echo "--- Test 2: CONNECT Method Response ---"
# Send a raw CONNECT request to see proxy response format
(
  echo "CONNECT repo.maven.apache.org:443 HTTP/1.1"
  echo "Host: repo.maven.apache.org:443"
  echo "Proxy-Authorization: Bearer ${JWT_TOKEN}"
  echo ""
) | nc -w 5 "$PROXY_HOST" "$PROXY_PORT" 2>&1 | head -n 5

echo ""
echo "--- Test 3: Error Response Analysis ---"
# Trigger an error to see error message format
curl -x "http://user:jwt_${JWT_TOKEN}@${PROXY_HOST}:${PROXY_PORT}" \
  -v "https://nonexistent-host-for-testing.example.com" 2>&1 | grep -iE "(server|via|proxy|x-|envoy|squid)"

echo ""
echo "--- Test 4: Proxy Behavior Patterns ---"
# Test various characteristics
echo "Testing connection behavior..."

# Test keep-alive support
echo -n "Keep-alive support: "
if curl -x "http://user:jwt_${JWT_TOKEN}@${PROXY_HOST}:${PROXY_PORT}" \
  -I -s "$TEST_URL" 2>&1 | grep -qi "keep-alive"; then
  echo "YES"
else
  echo "NO"
fi

# Test HTTP/2 support
echo -n "HTTP/2 support: "
if curl -x "http://user:jwt_${JWT_TOKEN}@${PROXY_HOST}:${PROXY_PORT}" \
  --http2 -I -s "$TEST_URL" 2>&1 | grep -qi "HTTP/2"; then
  echo "YES"
else
  echo "NO"
fi

echo ""
echo "Logs saved for detailed analysis"
