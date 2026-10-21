#!/usr/bin/env bash
# ==============================================================================
# Telemed Database Reset Script
#
# Clears all data from all PostgreSQL tables and resets auto-increment sequences.
# When the FastAPI server starts, only the default administrator account
# (admin / admin) will be created in the database, with NO other sample data.
# ==============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Load environment variables if .env exists
if [ -f "$SCRIPT_DIR/.env" ]; then
    export $(grep -v '^#' "$SCRIPT_DIR/.env" | xargs -d '\n' 2>/dev/null || true)
fi

DB_USER="${POSTGRES_USER:-postgres}"
DB_NAME="${POSTGRES_DB:-telemed_db}"
DB_PORT="${POSTGRES_PORT:-5434}"
DB_HOST="${POSTGRES_HOST:-localhost}"
DB_PASSWORD="${POSTGRES_PASSWORD:-postgres}"

echo "============================================================"
echo "🧹 TELEMED DATABASE RESET & PURGE"
echo "============================================================"
echo "Target Database: ${DB_NAME} on ${DB_HOST}:${DB_PORT} (User: ${DB_USER})"
echo ""

SQL_TRUNCATE_QUERY="
DO \$\$
DECLARE
    r RECORD;
BEGIN
    FOR r IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') LOOP
        EXECUTE 'TRUNCATE TABLE ' || quote_ident(r.tablename) || ' RESTART IDENTITY CASCADE;';
    END LOOP;
END \$\$;
"

RESET_SUCCESS=false

# Method 1: Try using backend Python virtual environment if available
if [ -x "$SCRIPT_DIR/backend/venv/bin/python" ]; then
    echo "[1/2] Connecting via Backend Python Engine..."
    if "$SCRIPT_DIR/backend/venv/bin/python" -c "
import os, sys
sys.path.insert(0, os.path.abspath('backend'))
from app.database import sync_engine
from sqlalchemy import text

with sync_engine.connect() as conn:
    conn.execute(text('''$SQL_TRUNCATE_QUERY'''))
    conn.commit()
print('✔ All database tables truncated and identity sequences reset via Python.')
" 2>/dev/null; then
        RESET_SUCCESS=true
    fi
fi

# Method 2: Fallback to docker exec if telemed-postgres container is running
if [ "$RESET_SUCCESS" = false ]; then
    if docker ps --format '{{.Names}}' | grep -q "^telemed-postgres$"; then
        echo "[2/2] Connecting via Docker container (telemed-postgres)..."
        docker exec -i telemed-postgres psql -U "$DB_USER" -d "$DB_NAME" -c "$SQL_TRUNCATE_QUERY" >/dev/null 2>&1
        if [ $? -eq 0 ]; then
            echo "✔ All database tables truncated and identity sequences reset via Docker psql."
            RESET_SUCCESS=true
        fi
    fi
fi

# Method 3: Fallback to local psql if available
if [ "$RESET_SUCCESS" = false ] && command -v psql >/dev/null 2>&1; then
    echo "[Fallback] Connecting via local psql..."
    PGPASSWORD="$DB_PASSWORD" psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "$SQL_TRUNCATE_QUERY" >/dev/null 2>&1
    if [ $? -eq 0 ]; then
        echo "✔ All database tables truncated and identity sequences reset via local psql."
        RESET_SUCCESS=true
    fi
fi

if [ "$RESET_SUCCESS" = true ]; then
    echo ""
    echo "============================================================"
    echo "✅ DATABASE RESET COMPLETE: 100% DATA PURGED"
    echo "============================================================"
    echo "All tables are now completely empty (0 rows)."
    echo ""
    echo "When you start the FastAPI backend server:"
    echo "  1. Database schema will be verified automatically."
    echo "  2. ONLY the default Admin account will be initialized:"
    echo "     - Username: ${ADMIN_USERNAME:-admin}"
    echo "     - Email:    ${ADMIN_EMAIL:-admin@telemed.com}"
    echo "     - Password: ${ADMIN_PASSWORD:-admin}"
    echo "     - Role:     ADMIN"
    echo "  3. NO doctors, NO patients, and NO fake appointments exist."
    echo "============================================================"
else
    echo "❌ Error: Could not connect to PostgreSQL database to reset tables."
    echo "Ensure the database is running with: docker compose up -d"
    exit 1
fi
