#!/bin/sh
# Find the concurrency threshold where TLS failures start occurring

PROXY_HOST="21.0.0.17"
PROXY_PORT="15004"
TEST_URL="https://repo.maven.apache.org/maven2/org/jdom/jdom2/2.0.6.1/jdom2-2.0.6.1.pom"

# Extract JWT token from environment
JWT_TOKEN=$(echo "$HTTPS_PROXY" | sed 's/.*:jwt_\([^@]*\)@.*/\1/')

echo "=== Concurrency Threshold Test ==="
echo "Testing concurrency levels: 1, 2, 3, 4, 5, 10"
echo ""

mkdir -p /tmp/tls-tests

for CONCURRENCY in 1 2 3 4 5 10; do
  echo "--- Testing concurrency=$CONCURRENCY ---"

  # Clean up previous test files
  rm -f /tmp/tls-tests/threshold-*

  # Run concurrent requests
  for i in $(seq 1 $CONCURRENCY); do
    (
      HTTP_CODE=$(curl -x "http://user:jwt_${JWT_TOKEN}@${PROXY_HOST}:${PROXY_PORT}" \
        -s -w "%{http_code}" -o /tmp/tls-tests/threshold-$CONCURRENCY-$i.xml \
        --connect-timeout 30 \
        --max-time 60 \
        "$TEST_URL" 2>/tmp/tls-tests/threshold-error-$CONCURRENCY-$i.log)
      echo "$HTTP_CODE" > /tmp/tls-tests/threshold-result-$CONCURRENCY-$i.txt
    ) &
  done

  # Wait for all requests to complete
  wait

  # Count successes and failures
  SUCCESS=0
  FAILED=0
  for i in $(seq 1 $CONCURRENCY); do
    CODE=$(cat /tmp/tls-tests/threshold-result-$CONCURRENCY-$i.txt 2>/dev/null || echo "000")
    if [ "$CODE" = "200" ]; then
      SUCCESS=$((SUCCESS + 1))
    else
      FAILED=$((FAILED + 1))
    fi
  done

  FAILURE_PCT=$(( FAILED * 100 / CONCURRENCY ))
  echo "Results: $SUCCESS successful, $FAILED failed (${FAILURE_PCT}% failure rate)"
  echo ""

  # Sleep between concurrency tests to avoid rate limiting
  sleep 2
done

echo "=== Summary ==="
echo "Concurrency | Success | Failed | Failure %"
echo "----------- | ------- | ------ | ---------"
for CONCURRENCY in 1 2 3 4 5 10; do
  SUCCESS=0
  FAILED=0
  for i in $(seq 1 $CONCURRENCY); do
    CODE=$(cat /tmp/tls-tests/threshold-result-$CONCURRENCY-$i.txt 2>/dev/null || echo "000")
    if [ "$CODE" = "200" ]; then
      SUCCESS=$((SUCCESS + 1))
    else
      FAILED=$((FAILED + 1))
    fi
  done
  FAILURE_PCT=$(( FAILED * 100 / CONCURRENCY ))
  printf "%11d | %7d | %6d | %8d%%\n" $CONCURRENCY $SUCCESS $FAILED $FAILURE_PCT
done
