#!/usr/bin/env python3
"""
SAQIB-MD — set Railway environment variables for the production service.

Usage:
    RAILWAY_TOKEN=<project-token> python3 scripts/railway-setenv.py

Never hard-code tokens here. The token is read from the environment.
"""
import json, os, urllib.request, urllib.error

TOKEN = os.environ.get("RAILWAY_TOKEN", "").strip()
if not TOKEN:
    raise SystemExit("Set RAILWAY_TOKEN env var first (Railway → Project → Settings → Tokens).")

# These IDs are public identifiers for the `saqib-md` Railway project.
PROJECT = os.environ.get("RAILWAY_PROJECT_ID", "0135b223-d2d9-4716-86ed-61b28c109cf4")
ENV = os.environ.get("RAILWAY_ENVIRONMENT_ID", "80293c4e-3a88-434a-80c3-0f3a358a3a0c")
SERVICE = os.environ.get("RAILWAY_SERVICE_ID", "24fe1022-2b05-42db-bcda-7b0b14d3cf61")

variables = {
    "PORT": "3000",
    "MODE": "public",            # public | private
    "MAX_SESSIONS": "50",        # up to 50 numbers
    "BOT_NAME": "SAQIB-MD",
    "OWNER_NAME": "Saqib",
    "OWNER_NUMBER": "",          # blank -> first linked number becomes owner
    "PREFIX": ".",
    "SESSION_DIR": "/data/session",   # Railway volume (persists logins)
    # --- all auto/anti features DEFAULT OFF ---
    "AUTO_READ": "false",
    "AUTO_TYPING": "false",
    "AUTO_REACT": "false",
    "WELCOME": "false",
    "GOODBYE": "false",
    "ANTILINK": "false",
    "ANTIDELETE": "false",
    "ANTIDELETE_INBOX": "false",
    "ANTISPAM": "false",
    "ANTICALL": "false",
    "AUTOSTATUS": "false",
    "AUTOVIEWONCE": "false",
    "AUTOBIO": "false",
    "CHATBOT": "false",
    "AUTOREAD_STATUS": "false",
    "ONLINE": "false",
    "RECORDING": "false",
    "STATUSVIEW": "false",
    "ADMINISTRATION": "false",
    "MENTION_REPLY": "false",
}

query = "mutation Upsert($input: VariableCollectionUpsertInput!) { variableCollectionUpsert(input: $input) }"
payload = {
    "query": query,
    "variables": {"input": {
        "projectId": PROJECT, "environmentId": ENV, "serviceId": SERVICE,
        "replace": False, "skipDeploys": True, "variables": variables,
    }},
}
req = urllib.request.Request(
    "https://backboard.railway.app/graphql/v2",
    data=json.dumps(payload).encode(),
    headers={
        "Authorization": f"Bearer {TOKEN}",
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36",
    },
    method="POST",
)
try:
    with urllib.request.urlopen(req, timeout=30) as r:
        print(r.read().decode())
except urllib.error.HTTPError as e:
    print("HTTP", e.code, e.read().decode())
