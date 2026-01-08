#!/bin/sh
# Test concurrent TLS requests through upstream proxy
# Usage: ./test-concurrent-tls.sh [concurrency_level]

CONCURRENCY=${1:-3}
PROXY_HOST="21.0.0.17"
PROXY_PORT="15004"
TEST_URL="https://repo.maven.apache.org/maven2/org/jdom/jdom2/2.0.6.1/jdom2-2.0.6.1.pom"

# Extract JWT token from environment
JWT_TOKEN=$(echo "$HTTPS_PROXY" | sed 's/.*:jwt_\([^@]*\)@.*/\1/')

echo "=== Concurrent TLS Test ==="
echo "Concurrency level: $CONCURRENCY"
echo "Proxy: $PROXY_HOST:$PROXY_PORT"
echo "Target: $TEST_URL"
echo "Token length: ${#JWT_TOKEN} chars"
echo ""

# Create output directory
mkdir -p /tmp/tls-tests

# Run concurrent requests
echo "Starting $CONCURRENCY concurrent requests..."
for i in $(seq 1 $CONCURRENCY); do
  (
    START=$(date +%s%N)
    HTTP_CODE=$(curl -x "http://user:jwt_${JWT_TOKEN}@${PROXY_HOST}:${PROXY_PORT}" \
      -s -w "%{http_code}" -o /tmp/tls-tests/response-$i.xml \
      --connect-timeout 30 \
      --max-time 60 \
      "$TEST_URL" 2>/tmp/tls-tests/error-$i.log)
    END=$(date +%s%N)
    DURATION=$(( (END - START) / 1000000 ))

    if [ "$HTTP_CODE" = "200" ]; then
      echo "[$i] SUCCESS - HTTP $HTTP_CODE - ${DURATION}ms"
    else
      echo "[$i] FAILED  - HTTP $HTTP_CODE - ${DURATION}ms"
      if [ -s /tmp/tls-tests/error-$i.log ]; then
        echo "    Error: $(cat /tmp/tls-tests/error-$i.log | head -n 1)"
      fi
    fi
  ) &
done

# Wait for all background jobs
wait

echo ""
echo "=== Results Summary ==="
SUCCESS=$(ls /tmp/tls-tests/response-*.xml 2>/dev/null | wc -l)
FAILED=$(( CONCURRENCY - SUCCESS ))
echo "Successful: $SUCCESS/$CONCURRENCY"
echo "Failed: $FAILED/$CONCURRENCY"
echo "Failure rate: $(( FAILED * 100 / CONCURRENCY ))%"
