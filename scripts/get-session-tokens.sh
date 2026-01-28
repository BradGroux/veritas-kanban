#!/usr/bin/env bash
#
# get-session-tokens.sh - Pull token/cost data from Clawdbot sessions
#
# Usage:
#   get-session-tokens.sh <sessionKey> <taskId> [agent]
#   get-session-tokens.sh --emit <sessionKey> <taskId> [agent]
#
# Arguments:
#   sessionKey  - Clawdbot session key (e.g., "agent:main:subagent:uuid")
#   taskId      - Task ID for the telemetry event
#   agent       - Agent name (defaults to extracted from sessionKey)
#
# Options:
#   --emit      - Also emit the telemetry event via emit-telemetry.sh
#   --json      - Output JSON (default)
#   --quiet     - Suppress stderr warnings
#
# Output (JSON):
#   {"taskId":"...", "agent":"...", "inputTokens":N, "outputTokens":N, "cacheTokens":N, "cost":N, "model":"..."}
#
# Model Pricing (per 1M tokens, USD):
#   claude-opus-4-5:    input=$15.00, output=$75.00, cache_read=$1.50
#   claude-sonnet-4:    input=$3.00,  output=$15.00, cache_read=$0.30
#   claude-3-5-sonnet:  input=$3.00,  output=$15.00, cache_read=$0.30
#   claude-3-5-haiku:   input=$0.80,  output=$4.00,  cache_read=$0.08

set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EMIT_TELEMETRY=false
QUIET=false

# Parse flags
while [[ "${1:-}" =~ ^-- ]]; do
    case "$1" in
        --emit) EMIT_TELEMETRY=true; shift ;;
        --json) shift ;;  # Default, no-op
        --quiet) QUIET=true; shift ;;
        *) echo "Unknown option: $1" >&2; exit 1 ;;
    esac
done

# Args
sessionKey="${1:-}"
taskId="${2:-}"
agent="${3:-}"

if [[ -z "$sessionKey" ]] || [[ -z "$taskId" ]]; then
    echo "Usage: get-session-tokens.sh [--emit] <sessionKey> <taskId> [agent]" >&2
    echo "" >&2
    echo "Example:" >&2
    echo "  get-session-tokens.sh agent:main:subagent:abc123 task_123 veritas-worker" >&2
    echo "  get-session-tokens.sh --emit agent:main:subagent:abc123 task_123" >&2
    exit 1
fi

# Extract agent name from sessionKey if not provided
if [[ -z "$agent" ]]; then
    # sessionKey format: agent:main:subagent:uuid or agent:main:main
    if [[ "$sessionKey" =~ ^agent:main:subagent: ]]; then
        agent="subagent"
    elif [[ "$sessionKey" == "agent:main:main" ]]; then
        agent="main"
    else
        agent="unknown"
    fi
fi

# Model pricing function (returns input|output|cache prices)
get_model_pricing() {
    local model="$1"
    case "$model" in
        claude-opus-4-5|claude-opus-4-5-*)
            echo "15.00|75.00|1.50"
            ;;
        claude-sonnet-4|claude-sonnet-4-*)
            echo "3.00|15.00|0.30"
            ;;
        claude-3-5-sonnet|claude-3-5-sonnet-*)
            echo "3.00|15.00|0.30"
            ;;
        claude-3-5-haiku|claude-3-5-haiku-*)
            echo "0.80|4.00|0.08"
            ;;
        claude-3-haiku|claude-3-haiku-*)
            echo "0.25|1.25|0.03"
            ;;
        *)
            # Default to sonnet pricing for unknown models
            echo "3.00|15.00|0.30"
            ;;
    esac
}

# Get session data from Clawdbot
# Filter out any non-JSON prefix (warnings, etc.) by finding the first {
session_data_raw=$(clawdbot sessions --json 2>/dev/null)
session_data=$(echo "$session_data_raw" | sed -n '/^{/,$p')
if [[ -z "$session_data" ]]; then
    [[ "$QUIET" == "false" ]] && echo "[get-session-tokens] WARN: Failed to fetch sessions from Clawdbot" >&2
    # Return zeros as fallback
    echo "{\"taskId\":\"$taskId\",\"agent\":\"$agent\",\"inputTokens\":0,\"outputTokens\":0,\"cacheTokens\":0,\"cost\":0,\"model\":\"unknown\",\"error\":\"session_fetch_failed\"}"
    exit 0
fi

# Extract session by key using jq
session=$(echo "$session_data" | jq -r --arg key "$sessionKey" '.sessions[] | select(.key == $key)' 2>/dev/null)

if [[ -z "$session" ]] || [[ "$session" == "null" ]]; then
    [[ "$QUIET" == "false" ]] && echo "[get-session-tokens] WARN: Session not found: $sessionKey" >&2
    # Return zeros as fallback
    echo "{\"taskId\":\"$taskId\",\"agent\":\"$agent\",\"inputTokens\":0,\"outputTokens\":0,\"cacheTokens\":0,\"cost\":0,\"model\":\"unknown\",\"error\":\"session_not_found\"}"
    exit 0
fi

# Extract token data
inputTokens=$(echo "$session" | jq -r '.inputTokens // 0')
outputTokens=$(echo "$session" | jq -r '.outputTokens // 0')
totalTokens=$(echo "$session" | jq -r '.totalTokens // 0')
model=$(echo "$session" | jq -r '.model // "unknown"')

# Ensure numeric values
[[ "$inputTokens" == "null" ]] && inputTokens=0
[[ "$outputTokens" == "null" ]] && outputTokens=0
[[ "$totalTokens" == "null" ]] && totalTokens=0

# Calculate cache tokens (total - input - output, if positive)
# Note: Clawdbot reports totalTokens which includes cache reads
cacheTokens=0
if [[ "$totalTokens" -gt 0 ]]; then
    computed=$((totalTokens - inputTokens - outputTokens))
    [[ $computed -gt 0 ]] && cacheTokens=$computed
fi

# Calculate cost
cost=0
if [[ "$model" != "unknown" ]] && [[ "$model" != "null" ]]; then
    # Get prices
    pricing=$(get_model_pricing "$model")
    in_price=$(echo "$pricing" | cut -d'|' -f1)
    out_price=$(echo "$pricing" | cut -d'|' -f2)
    cache_price=$(echo "$pricing" | cut -d'|' -f3)
    
    # Cost = (input * input_price + output * output_price + cache * cache_price) / 1,000,000
    # Use awk for floating point
    cost=$(awk -v i="$inputTokens" -v ip="$in_price" \
               -v o="$outputTokens" -v op="$out_price" \
               -v c="$cacheTokens" -v cp="$cache_price" \
               'BEGIN { printf "%.6f", (i * ip + o * op + c * cp) / 1000000 }')
fi

# Build output JSON
output=$(jq -n \
    --arg taskId "$taskId" \
    --arg agent "$agent" \
    --argjson inputTokens "$inputTokens" \
    --argjson outputTokens "$outputTokens" \
    --argjson cacheTokens "$cacheTokens" \
    --argjson cost "$cost" \
    --arg model "$model" \
    '{taskId: $taskId, agent: $agent, inputTokens: $inputTokens, outputTokens: $outputTokens, cacheTokens: $cacheTokens, cost: $cost, model: $model}')

echo "$output"

# Optionally emit telemetry
if [[ "$EMIT_TELEMETRY" == "true" ]]; then
    if [[ -x "$SCRIPT_DIR/emit-telemetry.sh" ]]; then
        "$SCRIPT_DIR/emit-telemetry.sh" tokens "$taskId" "$agent" "$inputTokens" "$outputTokens" "$cacheTokens" "$cost"
    else
        [[ "$QUIET" == "false" ]] && echo "[get-session-tokens] WARN: emit-telemetry.sh not found or not executable" >&2
    fi
fi

exit 0
