#!/bin/bash
# ============================================================
# test-reactions.sh — Smoke test for the reactions API
#
# Usage:
#   1. Edit BASE_URL + BOOKMARK_ID + ADMIN_KEY below
#   2. chmod +x test-reactions.sh
#   3. ./test-reactions.sh
# ============================================================

set -e

BASE_URL="https://yaeli.me"
BOOKMARK_ID="0685d972-b2ef-4a88-83ba-f8c20fd226c0"  # דני רובס
ADMIN_KEY="ed5d0607061bbf0c7fb75b4ff6bcdb65dc92b1b8f161660559864a9073b3182f"

echo
echo "=== 1. Create a 'love' reaction (word) ==="
LOVE_ID=$(curl -s -X POST "$BASE_URL/api/reaction" \
  -H "content-type: application/json" \
  -d "{\"bookmark_id\":\"$BOOKMARK_ID\",\"reaction\":\"love\",\"scope\":\"word\",\"text\":\"יעלי\",\"anchor_id\":\"p0w0\"}" \
  | tee /dev/stderr | python3 -c "import sys, json; print(json.load(sys.stdin)['id'])")
echo "Created: $LOVE_ID"

echo
echo "=== 2. Create an 'improve' reaction (scene) ==="
IMPROVE_ID=$(curl -s -X POST "$BASE_URL/api/reaction" \
  -H "content-type: application/json" \
  -d "{\"bookmark_id\":\"$BOOKMARK_ID\",\"reaction\":\"improve\",\"scope\":\"scene\",\"text\":\"אז ככה. הסיפור התחיל באוטובוס. זה הכל.\",\"anchor_id\":\"p2w5\"}" \
  | tee /dev/stderr | python3 -c "import sys, json; print(json.load(sys.stdin)['id'])")
echo "Created: $IMPROVE_ID"

echo
echo "=== 3. List all reactions for this bookmark ==="
curl -s "$BASE_URL/api/reaction?bookmark_id=$BOOKMARK_ID" | python3 -m json.tool

echo
echo "=== 4. Hit the admin dashboard feed ==="
curl -s "$BASE_URL/api/admin/reactions" \
  -H "x-admin-key: $ADMIN_KEY" | python3 -m json.tool

echo
echo "=== 5. Delete the test reactions ==="
curl -s -X DELETE "$BASE_URL/api/reaction?bookmark_id=$BOOKMARK_ID&id=$LOVE_ID"
echo
curl -s -X DELETE "$BASE_URL/api/reaction?bookmark_id=$BOOKMARK_ID&id=$IMPROVE_ID"
echo

echo
echo "=== 6. Verify they're gone ==="
curl -s "$BASE_URL/api/reaction?bookmark_id=$BOOKMARK_ID" | python3 -m json.tool

echo
echo "Done."
