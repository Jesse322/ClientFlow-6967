#!/bin/bash
# Sync AIRTABLE_TOKEN from .env.local to .dev.vars
TOKEN=$(grep "^AIRTABLE_TOKEN=" .env.local 2>/dev/null | cut -d'=' -f2-)
if [ -n "$TOKEN" ]; then
  echo "AIRTABLE_TOKEN=$TOKEN" > .dev.vars
  echo "✓ Synced AIRTABLE_TOKEN to .dev.vars"
else
  echo "AIRTABLE_TOKEN=" > .dev.vars
  echo "⚠ No AIRTABLE_TOKEN found in .env.local"
fi
