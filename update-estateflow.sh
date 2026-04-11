#!/bin/bash
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
UPDATES_DIR="$SCRIPT_DIR/updates"

echo "Estateflow File Updater"
echo "=========================="

if [ ! -d "$UPDATES_DIR" ]; then
    echo "No 'updates' folder found. Create one next to this script."
    exit 1
fi

copy_file() {
    local filename="$1"
    local dest="$2"
    local src="$UPDATES_DIR/$filename"
    if [ -f "$src" ]; then
        mkdir -p "$(dirname "$dest")"
        cp "$src" "$dest"
        echo "OK $filename"
    fi
}

copy_file "App.jsx"                  "$SCRIPT_DIR/src/App.jsx"
copy_file "main.jsx"                 "$SCRIPT_DIR/src/main.jsx"
copy_file "index.html"               "$SCRIPT_DIR/index.html"
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
echo "Done! Go to GitHub Desktop and commit + push."
