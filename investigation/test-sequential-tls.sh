#!/bin/sh
# Test sequential TLS requests through upstream proxy
# Usage: ./test-sequential-tls.sh [num_requests]

NUM_REQUESTS=${1:-10}
PROXY_HOST="21.0.0.17"
PROXY_PORT="15004"
TEST_URL="https://repo.maven.apache.org/maven2/org/jdom/jdom2/2.0.6.1/jdom2-2.0.6.1.pom"

# Extract JWT token from environment
JWT_TOKEN=$(echo "$HTTPS_PROXY" | sed 's/.*:jwt_\([^@]*\)@.*/\1/')

echo "=== Sequential TLS Test ==="
echo "Number of requests: $NUM_REQUESTS"
echo "Proxy: $PROXY_HOST:$PROXY_PORT"
echo "Target: $TEST_URL"
echo ""

# Create output directory
mkdir -p /tmp/tls-tests

SUCCESS_COUNT=0
FAILED_COUNT=0

# Run sequential requests
for i in $(seq 1 $NUM_REQUESTS); do
  START=$(date +%s%N)
  HTTP_CODE=$(curl -x "http://user:jwt_${JWT_TOKEN}@${PROXY_HOST}:${PROXY_PORT}" \
    -s -w "%{http_code}" -o /tmp/tls-tests/seq-response-$i.xml \
    --connect-timeout 30 \
    --max-time 60 \
    "$TEST_URL" 2>/tmp/tls-tests/seq-error-$i.log)
  END=$(date +%s%N)
  DURATION=$(( (END - START) / 1000000 ))

  if [ "$HTTP_CODE" = "200" ]; then
    echo "Request $i: SUCCESS - HTTP $HTTP_CODE - ${DURATION}ms"
    SUCCESS_COUNT=$((SUCCESS_COUNT + 1))
  else
    echo "Request $i: FAILED  - HTTP $HTTP_CODE - ${DURATION}ms"
    FAILED_COUNT=$((FAILED_COUNT + 1))
    if [ -s /tmp/tls-tests/seq-error-$i.log ]; then
      echo "  Error: $(cat /tmp/tls-tests/seq-error-$i.log | head -n 1)"
    fi
  fi

  # Small delay between requests
  sleep 0.2
done

echo ""
echo "=== Results Summary ==="
echo "Successful: $SUCCESS_COUNT/$NUM_REQUESTS"
echo "Failed: $FAILED_COUNT/$NUM_REQUESTS"
echo "Failure rate: $(( FAILED_COUNT * 100 / NUM_REQUESTS ))%"
