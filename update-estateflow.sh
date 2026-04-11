#!/bin/bash
# Estateflow auto-updater
# Usage: drag this script to your estateflow repo folder and double-click (or run in terminal)
# It will copy all updated files from a "updates" subfolder into the right places

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
UPDATES_DIR="$SCRIPT_DIR/updates"

echo "🏠 Estateflow File Updater"
echo "=========================="

# Check updates folder exists
if [ ! -d "$UPDATES_DIR" ]; then
    echo "❌ No 'updates' folder found next to this script."
    echo "   Create a folder called 'updates' and put the new files inside it."
    exit 1
fi

# Copy each file to the right place
copy_file() {
    local filename="$1"
    local dest="$2"
    local src="$UPDATES_DIR/$filename"
    
    if [ -f "$src" ]; then
        mkdir -p "$(dirname "$dest")"
        cp "$src" "$dest"
        echo "✓ $filename -> $dest"
    fi
}

# Source files
copy_file "App.jsx"                  "$SCRIPT_DIR/src/App.jsx"
copy_file "api.js"                   "$SCRIPT_DIR/src/lib/api.js"
copy_file "statementParser.js"       "$SCRIPT_DIR/src/lib/statementParser.js"
copy_file "supabase.js"              "$SCRIPT_DIR/src/lib/supabase.js"
copy_file "AuthContext.jsx"          "$SCRIPT_DIR/src/lib/AuthContext.jsx"
copy_file "DashboardComponents.jsx"  "$SCRIPT_DIR/src/components/DashboardComponents.jsx"
copy_file "FeatureComponents.jsx"    "$SCRIPT_DIR/src/components/FeatureComponents.jsx"
copy_file "StatementImporter.jsx"    "$SCRIPT_DIR/src/components/StatementImporter.jsx"
copy_file "LoginPage.jsx"            "$SCRIPT_DIR/src/components/LoginPage.jsx"
copy_file "vite.config.js"           "$SCRIPT_DIR/vite.config.js"
copy_file "package.json"             "$SCRIPT_DIR/package.json"

echo ""
echo "✅ Done! Now go to GitHub Desktop and commit + push."
