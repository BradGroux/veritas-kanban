#!/bin/sh
# The application image supplies Node and the shared bounded API transport.
set -eu
exec node "$(dirname "$0")/seed.mjs"
