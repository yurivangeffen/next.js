#!/bin/bash

# run a benchmark against this binary
# using heaptrack to extract memory
# usage numbers at g-max

set -e
 
COMMIT=${1:-HEAD} # the sha of the commit to benchmark
PAGES=${2:-0} # the number of pages to build

SCRIPTPATH="$( cd -- "$(dirname "$0")" >/dev/null 2>&1 ; pwd -P )"

# build the binary
cargo build --profile release-with-debug --manifest-path "$SCRIPTPATH/Cargo.toml"

# create the config file by loading the default config and adding the required fields
JS_CONFIG=$(cat "$SCRIPTPATH/jsConfig.json")
NEXT_CONFIG=$(cat "$SCRIPTPATH/nextConfig.json")

# create a temp dir and clone shadcn-ui into it
TMPDIR=$(mktemp -d)
git clone https://github.com/shadcn-ui/ui.git "$TMPDIR"
cd "$TMPDIR"
git checkout "$COMMIT"

# install the dependencies
pnpm install

# create the project options file
jq -n --arg jsConfig "$JS_CONFIG" --arg nextConfig "$NEXT_CONFIG" --arg tmpDir "$TMPDIR" '{
    rootPath: $tmpDir,
    projectPath: ($tmpDir + "/apps/www"),
    jsConfig: $jsConfig, 
    nextConfig: $nextConfig,
    watch: false,
    dev: false,
    env: [],
    defineEnv: {
        client: [],
        edge: [],
        nodejs: []
    }
}' > project_options.json

# heaptrack the binary with the project options in raw mode
heaptrack --record-only "$SCRIPTPATH/../../../../target/release-with-debug/next-build-test" concurrent 12 "$PAGES"

# get most recently created heaptrack profile and run it via heaptrack_print
PROFILE=$(ls -t "$TMPDIR/heaptrack.*" | head -n1)
heaptrack_print "$PROFILE" > "$SCRIPTPATH/result.log"
