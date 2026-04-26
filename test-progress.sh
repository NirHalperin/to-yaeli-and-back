#!/bin/bash
# ============================================================
# test-progress.sh — Smoke test for the bookmark progress API
# Usage:
#   bash test-progress.sh                    # uses default name "דני רובס"
#   bash test-progress.sh "ינשוף"            # override the name
# ============================================================

set -e

NAME="${1:-דני רובס}"
ADMIN_KEY="ed5d0607061bbf0c7fb75b4ff6bcdb65dc92b1b8f161660559864a9073b3182f"
BASE="https://yaeli.me"

echo "─────────────────────────────────────────────"
echo "Step 1: Looking up bookmark by name: $NAME"
echo "─────────────────────────────────────────────"
LOOKUP=$(curl -s -G "$BASE/api/bookmark" --data-urlencode "name=$NAME")
echo "$LOOKUP"
echo

# Extract the id field (works without jq — uses sed)
BM_ID=$(echo "$LOOKUP" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')

if [ -z "$BM_ID" ]; then
  echo "❌ Could not extract bookmark id. Check the lookup response above."
  exit 1
fi

echo "✓ Bookmark id: $BM_ID"
echo

echo "─────────────────────────────────────────────"
echo "Step 2: POST /api/bookmark/progress with gate_reached=1"
echo "─────────────────────────────────────────────"
curl -s -X POST "$BASE/api/bookmark/progress" \
  -H "content-type: application/json" \
  -d "{\"bookmark_id\":\"$BM_ID\",\"gate_reached\":1}"
echo
echo

echo "─────────────────────────────────────────────"
echo "Step 3: Try to DECREASE — should NOT change (monotonic)"
echo "─────────────────────────────────────────────"
curl -s -X POST "$BASE/api/bookmark/progress" \
  -H "content-type: application/json" \
  -d "{\"bookmark_id\":\"$BM_ID\",\"gate_reached\":0}"
echo
echo

echo "─────────────────────────────────────────────"
echo "Step 4: GET /api/admin/progress — author dashboard feed"
echo "─────────────────────────────────────────────"
curl -s "$BASE/api/admin/progress" -H "x-admin-key: $ADMIN_KEY"
echo
echo
echo "✓ Done."
