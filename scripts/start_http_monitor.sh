#!/usr/bin/env bash
# start_http_monitor.sh - 启动 HTTP 流量监控
#
# 用法:
#   bash start_http_monitor.sh [网卡] [端口] [日志文件路径]
#
# 示例:
#   bash start_http_monitor.sh                    # 默认: eth0, 3000, /var/log/http_monitor.json
#   bash start_http_monitor.sh eth0 8080 /tmp/http.json

set -euo pipefail

INTERFACE="${1:-lo}"
PORT="${2:-3000}"
LOG_FILE="${3:-/var/log/http_monitor.json}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "========================================"
echo " HTTP 流量监控"
echo "========================================"
echo "  网卡:       $INTERFACE"
echo "  端口:       $PORT"
echo "  日志文件:   $LOG_FILE"
echo "  脚本:       $SCRIPT_DIR/http_monitor.py"
echo "========================================"
echo "按 Ctrl+C 停止监控"
echo ""

# 检查 tcpdump 是否安装
if ! command -v tcpdump &>/dev/null; then
    echo "错误: tcpdump 未安装。请执行: sudo apt install tcpdump 或 sudo yum install tcpdump" >&2
    exit 1
fi

# 检查 python3 是否安装
if ! command -v python3 &>/dev/null; then
    echo "错误: python3 未安装。" >&2
    exit 1
fi

# 检查是否有权限抓包
# 用 timeout 避免 tcpdump -c 1 在无流量时一直阻塞
TCPDUMP_ERR=$(timeout 2 tcpdump -i "$INTERFACE" -c 1 -l "port $PORT" 2>&1) || true
if echo "$TCPDUMP_ERR" | grep -qi "permission denied"; then
    echo "提示: 需要 root 权限抓包，请使用 sudo 运行此脚本。" >&2
    echo "  sudo bash $0 $*" >&2
    exit 1
fi
if echo "$TCPDUMP_ERR" | grep -qi "no such device\|network interface"; then
    echo "错误: 网卡 $INTERFACE 不存在。" >&2
    exit 1
fi

# 启动 tcpdump 并管道传给 Python 解析脚本
# 不使用 exec（exec 不能与管道配合），直接运行管道即可
tcpdump \
    -i "$INTERFACE" \
    -A \
    -s 0 \
    -l \
    "port $PORT" \
    2>/dev/null \
    | python3 "$SCRIPT_DIR/http_monitor.py" "$LOG_FILE"
