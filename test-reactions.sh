#!/bin/bash
# ============================================================
# test-reactions.sh — Smoke test for the upsert reactions API
#
# What this exercises:
#   • One record per (bookmark_id, anchor_id) — keyed deterministically
#   • Reaction-only writes        (אהבתי / לשפר)
#   • Comment-only writes         (+טקסט)
#   • Combined writes             (reaction + comment on the same passage)
#   • Merge semantics             (PATCH-style: omitted fields stay)
#   • Auto-delete                 (record drops when both pieces empty)
#   • DELETE                      (manual reset)
#   • Admin dashboard feed        (Hebrew labels + icon URLs)
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

# Anchor IDs are stable strings stamped on each .word span by feedback.js.
# Format: p<paragraphIdx>w<wordIdx>. Pick three that won't collide.
ANCHOR_LOVE="p0w0"      # reaction-only
ANCHOR_SCENE="p2w5"     # combined reaction + comment
ANCHOR_TEXT="p3w2"      # comment-only

PP() { python3 -m json.tool; }

echo
echo "=== 1. Reaction-only: 'love' on a single word ==="
curl -s -X POST "$BASE_URL/api/reaction" \
  -H "content-type: application/json" \
  -d "{\"bookmark_id\":\"$BOOKMARK_ID\",\"anchor_id\":\"$ANCHOR_LOVE\",\"reaction\":\"love\",\"scope\":\"word\",\"text\":\"יעלי\"}" | PP

echo
echo "=== 2. Comment-only: free-text on a paragraph (no reaction) ==="
curl -s -X POST "$BASE_URL/api/reaction" \
  -H "content-type: application/json" \
  -d "{\"bookmark_id\":\"$BOOKMARK_ID\",\"anchor_id\":\"$ANCHOR_TEXT\",\"comment\":\"זה הקטע שהכי דיבר אליי\",\"scope\":\"paragraph\",\"text\":\"פסקה לדוגמה לבדיקה.\"}" | PP

echo
echo "=== 3. Combined (step A): create scene record with 'improve' reaction ==="
curl -s -X POST "$BASE_URL/api/reaction" \
  -H "content-type: application/json" \
  -d "{\"bookmark_id\":\"$BOOKMARK_ID\",\"anchor_id\":\"$ANCHOR_SCENE\",\"reaction\":\"improve\",\"scope\":\"scene\",\"text\":\"אז ככה. הסיפור התחיל באוטובוס. זה הכל.\"}" | PP

echo
echo "=== 4. Combined (step B): merge a comment onto the SAME passage ==="
echo "    (sending only 'comment' — reaction must stay 'improve')"
curl -s -X POST "$BASE_URL/api/reaction" \
  -H "content-type: application/json" \
  -d "{\"bookmark_id\":\"$BOOKMARK_ID\",\"anchor_id\":\"$ANCHOR_SCENE\",\"comment\":\"אהבתי את הקטע אבל יכול להיות יותר חד\"}" | PP

echo
echo "=== 5. Merge sanity check: list this bookmark's records ==="
echo "    (expect: love only, comment only, improve+comment combined)"
curl -s "$BASE_URL/api/reaction?bookmark_id=$BOOKMARK_ID" | PP

echo
echo "=== 6. Auto-delete: clear the comment AND the reaction → record vanishes ==="
echo "    (POST with empty strings; server sees both empty and drops the row)"
curl -s -X POST "$BASE_URL/api/reaction" \
  -H "content-type: application/json" \
  -d "{\"bookmark_id\":\"$BOOKMARK_ID\",\"anchor_id\":\"$ANCHOR_TEXT\",\"comment\":\"\",\"reaction\":\"\"}" | PP

echo
echo "=== 7. Admin dashboard feed — Hebrew labels + icon URLs ==="
curl -s "$BASE_URL/api/admin/reactions" \
  -H "x-admin-key: $ADMIN_KEY" | PP

echo
echo "=== 8. Manual DELETE — drop the remaining test rows ==="
curl -s -X DELETE "$BASE_URL/api/reaction?bookmark_id=$BOOKMARK_ID&anchor_id=$ANCHOR_LOVE"; echo
curl -s -X DELETE "$BASE_URL/api/reaction?bookmark_id=$BOOKMARK_ID&anchor_id=$ANCHOR_SCENE"; echo

echo
echo "=== 9. Verify they're gone ==="
curl -s "$BASE_URL/api/reaction?bookmark_id=$BOOKMARK_ID" | PP

echo
echo "Done."
