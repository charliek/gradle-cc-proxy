#!/bin/sh
# Analyze TLS certificate chain through the proxy
# This will help identify if there's SSL/TLS interception

PROXY_HOST="21.0.0.17"
PROXY_PORT="15004"
TARGET_HOST="repo.maven.apache.org"
TARGET_PORT="443"

echo "=== TLS Certificate Chain Analysis ==="
echo "Proxy: $PROXY_HOST:$PROXY_PORT"
echo "Target: $TARGET_HOST:$TARGET_PORT"
echo ""

# Extract JWT token from environment
JWT_TOKEN=$(echo "$HTTPS_PROXY" | sed 's/.*:jwt_\([^@]*\)@.*/\1/')

# Test 1: Single connection - capture full certificate chain
echo "--- Test 1: Single TLS Connection ---"
echo | openssl s_client -connect "$TARGET_HOST:$TARGET_PORT" \
  -proxy "$PROXY_HOST:$PROXY_PORT" \
  -showcerts \
  2>&1 | tee /tmp/tls-chain-single.log | grep -E "(subject=|issuer=|verify return:|Verify return code:)"

echo ""
echo "--- Test 2: Multiple Concurrent Connections (capturing cert details) ---"

# Run 3 concurrent openssl connections
for i in 1 2 3; do
  (
    echo | openssl s_client -connect "$TARGET_HOST:$TARGET_PORT" \
      -proxy "$PROXY_HOST:$PROXY_PORT" \
      -showcerts \
      2>&1 > /tmp/tls-chain-concurrent-$i.log
    echo "Connection $i completed"
  ) &
done
wait

echo ""
echo "--- Comparing certificate chains ---"
for i in 1 2 3; do
  echo "Connection $i certificate count: $(grep -c 'BEGIN CERTIFICATE' /tmp/tls-chain-concurrent-$i.log)"
  echo "Connection $i verify result: $(grep 'Verify return code' /tmp/tls-chain-concurrent-$i.log)"
done

# Check if certificate chains differ
echo ""
echo "--- Certificate chain differences ---"
if diff /tmp/tls-chain-concurrent-1.log /tmp/tls-chain-concurrent-2.log > /dev/null 2>&1; then
  echo "Certificate chains are IDENTICAL between concurrent connections"
else
  echo "Certificate chains DIFFER between concurrent connections"
  echo "This may indicate inconsistent proxy behavior!"
fi

# Save full logs for detailed analysis
echo ""
echo "Full logs saved to:"
echo "  /tmp/tls-chain-single.log"
echo "  /tmp/tls-chain-concurrent-{1,2,3}.log"
