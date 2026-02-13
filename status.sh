#!/bin/bash
# NanoClaw Status Checker
# Usage: ./status.sh [logs|watch]

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== NanoClaw Status ===${NC}\n"

# Check if main service is running
if pgrep -f "tsx src/index.ts" > /dev/null; then
    echo -e "Service: ${GREEN}Running${NC}"
else
    echo -e "Service: ${RED}Not Running${NC}"
fi

# Show running containers
echo -e "\n${YELLOW}Active Containers:${NC}"
docker ps --filter "name=nanoclaw" --format "  • {{.Names}} ({{.Status}})" 2>/dev/null || echo "  None"

# Show recent logs
echo -e "\n${YELLOW}Recent Activity (last 10 lines):${NC}"
tail -10 logs/nanoclaw.log 2>/dev/null | grep -E "INFO|ERROR|WARN" | tail -5 || echo "  No logs yet"

case "$1" in
    logs|log)
        echo -e "\n${GREEN}=== Container Logs ===${NC}"
        CONTAINER=$(docker ps -q --filter "name=nanoclaw")
        if [ -n "$CONTAINER" ]; then
            docker logs $CONTAINER 2>&1 | tail -30
        else
            echo "No active container"
        fi
        ;;
    watch)
        echo -e "\n${GREEN}=== Following logs (Ctrl+C to stop) ===${NC}"
        CONTAINER=$(docker ps -q --filter "name=nanoclaw")
        if [ -n "$CONTAINER" ]; then
            docker logs -f $CONTAINER 2>&1
        else
            echo "No active container to watch"
        fi
        ;;
    *)
        echo -e "\n${YELLOW}Commands:${NC}"
        echo "  ./status.sh logs  - Show container logs"
        echo "  ./status.sh watch - Follow container logs in real-time"
        ;;
esac
