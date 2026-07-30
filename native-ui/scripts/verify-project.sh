#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
project_root="${1:-$(cd "$script_dir/.." && pwd)}"

exec python3 "$script_dir/verify_project.py" "$project_root"
