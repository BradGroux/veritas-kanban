#!/usr/bin/env bash
#
# emit-telemetry.sh - Send telemetry events to the Veritas Kanban API
#
# Usage:
#   emit-telemetry.sh started <taskId> <agent> [model] [sessionKey]
#   emit-telemetry.sh completed <taskId> <agent> <success> [durationMs] [error]
#   emit-telemetry.sh tokens <taskId> <agent> <input> <output> [cache] [cost]
#   emit-telemetry.sh error <taskId> <agent> <error> [stackTrace]
#
# Requirements:
#   - Handles errors gracefully (won't exit 1 on telemetry failure)
#   - Logs to stderr on failure
#   - Always returns 0

set -o pipefail

TELEMETRY_URL="${TELEMETRY_URL:-http://localhost:3001/api/telemetry/events}"

# Helper: POST JSON to telemetry endpoint
# Logs error to stderr but always returns 0
emit_event() {
    local event_type="$1"
    local payload="$2"
    
    local response
    local http_code
    
    # Make the request, capture response and HTTP code
    response=$(curl -s -w "\n%{http_code}" -X POST "$TELEMETRY_URL" \
        -H "Content-Type: application/json" \
        -d "$payload" 2>&1)
    
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    
    # Check for curl failure or non-2xx HTTP status
    if [[ -z "$http_code" ]] || [[ ! "$http_code" =~ ^2[0-9][0-9]$ ]]; then
        echo "[telemetry] WARN: Failed to emit $event_type event (HTTP $http_code)" >&2
        echo "[telemetry] Payload: $payload" >&2
        [[ -n "$body" ]] && echo "[telemetry] Response: $body" >&2
    fi
    
    # Always succeed - telemetry failures shouldn't block workflows
    return 0
}

# Build JSON payload safely (handles special characters)
json_string() {
    printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null || printf '"%s"' "$1"
}

case "${1:-}" in
    started)
        # run.started: { taskId, agent, model?, sessionKey? }
        taskId="${2:?Usage: emit-telemetry.sh started <taskId> <agent> [model] [sessionKey]}"
        agent="${3:?Usage: emit-telemetry.sh started <taskId> <agent> [model] [sessionKey]}"
        model="${4:-}"
        sessionKey="${5:-}"
        
        payload="{\"type\":\"run.started\",\"taskId\":$(json_string "$taskId"),\"agent\":$(json_string "$agent")"
        [[ -n "$model" ]] && payload+=",\"model\":$(json_string "$model")"
        [[ -n "$sessionKey" ]] && payload+=",\"sessionKey\":$(json_string "$sessionKey")"
        payload+="}"
        
        emit_event "run.started" "$payload"
        ;;
        
    completed)
        # run.completed: { taskId, agent, success, durationMs?, error? }
        taskId="${2:?Usage: emit-telemetry.sh completed <taskId> <agent> <success> [durationMs] [error]}"
        agent="${3:?Usage: emit-telemetry.sh completed <taskId> <agent> <success> [durationMs] [error]}"
        success="${4:?Usage: emit-telemetry.sh completed <taskId> <agent> <success> [durationMs] [error]}"
        durationMs="${5:-}"
        error="${6:-}"
        
        # Convert success to boolean
        if [[ "$success" == "true" ]] || [[ "$success" == "1" ]]; then
            success_val="true"
        else
            success_val="false"
        fi
        
        payload="{\"type\":\"run.completed\",\"taskId\":$(json_string "$taskId"),\"agent\":$(json_string "$agent"),\"success\":$success_val"
        [[ -n "$durationMs" ]] && payload+=",\"durationMs\":$durationMs"
        [[ -n "$error" ]] && payload+=",\"error\":$(json_string "$error")"
        payload+="}"
        
        emit_event "run.completed" "$payload"
        ;;
        
    tokens)
        # run.tokens: { taskId, agent, inputTokens, outputTokens, cacheTokens?, cost? }
        taskId="${2:?Usage: emit-telemetry.sh tokens <taskId> <agent> <input> <output> [cache] [cost]}"
        agent="${3:?Usage: emit-telemetry.sh tokens <taskId> <agent> <input> <output> [cache] [cost]}"
        inputTokens="${4:?Usage: emit-telemetry.sh tokens <taskId> <agent> <input> <output> [cache] [cost]}"
        outputTokens="${5:?Usage: emit-telemetry.sh tokens <taskId> <agent> <input> <output> [cache] [cost]}"
        cacheTokens="${6:-}"
        cost="${7:-}"
        
        payload="{\"type\":\"run.tokens\",\"taskId\":$(json_string "$taskId"),\"agent\":$(json_string "$agent"),\"inputTokens\":$inputTokens,\"outputTokens\":$outputTokens"
        [[ -n "$cacheTokens" ]] && payload+=",\"cacheTokens\":$cacheTokens"
        [[ -n "$cost" ]] && payload+=",\"cost\":$cost"
        payload+="}"
        
        emit_event "run.tokens" "$payload"
        ;;
        
    error)
        # run.error: { taskId, agent, error, stackTrace? }
        taskId="${2:?Usage: emit-telemetry.sh error <taskId> <agent> <error> [stackTrace]}"
        agent="${3:?Usage: emit-telemetry.sh error <taskId> <agent> <error> [stackTrace]}"
        error="${4:?Usage: emit-telemetry.sh error <taskId> <agent> <error> [stackTrace]}"
        stackTrace="${5:-}"
        
        payload="{\"type\":\"run.error\",\"taskId\":$(json_string "$taskId"),\"agent\":$(json_string "$agent"),\"error\":$(json_string "$error")"
        [[ -n "$stackTrace" ]] && payload+=",\"stackTrace\":$(json_string "$stackTrace")"
        payload+="}"
        
        emit_event "run.error" "$payload"
        ;;
        
    *)
        echo "Usage: emit-telemetry.sh <command> [args...]" >&2
        echo "" >&2
        echo "Commands:" >&2
        echo "  started <taskId> <agent> [model] [sessionKey]" >&2
        echo "  completed <taskId> <agent> <success> [durationMs] [error]" >&2
        echo "  tokens <taskId> <agent> <input> <output> [cache] [cost]" >&2
        echo "  error <taskId> <agent> <error> [stackTrace]" >&2
        echo "" >&2
        echo "Environment:" >&2
        echo "  TELEMETRY_URL - Override endpoint (default: http://localhost:3001/api/telemetry/events)" >&2
        # Still exit 0 - don't let bad usage break workflows
        exit 0
        ;;
esac

exit 0
