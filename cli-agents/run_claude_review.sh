#!/bin/bash

# Exit on error and catch pipeline failures
set -e
set -o pipefail

# Take PR_NUMBER as argument or attempt to find it
PR_NUMBER="$1"

# if none is found we attempt to get an open pr within the current branch
if [ -z "$PR_NUMBER" ] || [ "$PR_NUMBER" = "null" ]; then
  PR_NUMBER=$(gh pr view --json number,isDraft 2>/dev/null | jq -r 'select(.isDraft == false) | .number')
fi

if [ -z "$PR_NUMBER" ] || [ "$PR_NUMBER" = "null" ]; then
  echo "Error: PR_NUMBER not provided and could not find an active (non-draft) PR for the current branch."
  exit 1
fi

echo "Running Claude review for PR #$PR_NUMBER..."
# Capture output to collect it before posting
if ! REVIEW_OUTPUT=$(claude -p "/review $PR_NUMBER"); then
  echo "Error: Claude review command failed" >&2
  exit 1
fi

echo "Review captured. Posting to PR #$PR_NUMBER..."
{
  echo "## Claude Review"
  echo ""
  echo "$REVIEW_OUTPUT"
} | gh pr comment "$PR_NUMBER" --body-file -

echo "Successfully posted Claude review to PR #$PR_NUMBER"


