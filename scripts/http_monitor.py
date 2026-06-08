#!/usr/bin/env python3
"""
http_monitor.py - 解析 tcpdump ASCII 输出，提取 HTTP 请求/响应信息，输出 JSON lines。

用法:
    tcpdump -i lo -A -s 0 -l 'port 3000' 2>/dev/null | python3 http_monitor.py /var/log/http_monitor.json

输出格式 (JSON lines):
    {"timestamp":"2026-06-08T10:30:01+08:00","src_ip":"192.168.1.100","method":"GET","url":"/api/users","status":200}

解析原理:
    tcpdump -A 按数据包输出，每个数据包包含:
      1. IP 头部行: "IP src.host.src_port > dst.host.dst_port: Flags [..], ..."
      2. HTTP 内容行: "GET /path HTTP/1.1" 或 "HTTP/1.1 200 OK"

    对于进入 3000 端口的流量:
      - 客户端 → 服务端 (dst_port=3000): 包含 HTTP 请求行 → 提取源 IP、方法、URL
      - 服务端 → 客户端 (src_port=3000): 包含 HTTP 响应行 → 提取状态码

    通过 (src_ip, src_port) 作为流标识关联请求与响应。
"""

import sys
import re
import json
import time
from datetime import datetime, timezone, timedelta


# 匹配 tcpdump 的 IP 行
# tcpdump 默认带时间戳前缀: "22:32:00.123456 IP localhost.54321 > localhost.3000: Flags [P.], ..."
# 也兼容无时间戳: "IP 192.168.1.1.54321 > 10.0.0.1.3000: Flags [P.], ..."
# 注意: 主机标识可能是 IP 地址或主机名（如 localhost）
TIMESTAMP_PREFIX_RE = re.compile(r"^\d{2}:\d{2}:\d{2}\.\d+\s+")

IP_LINE_RE = re.compile(
    r"IP\s+"
    r"(\S+?)\.(\d+)"             # src_host, src_port（host 可能是 IP 或主机名）
    r"\s*>\s*"
    r"(\S+?)\.(\d+)"             # dst_host, dst_port
    r":\s+Flags\s+\["
)

# 匹配 HTTP 请求行: "GET /api/users HTTP/1.1"
# tcpdump -A 中 HTTP 内容拼接在 hex dump 行末尾，不在行首，因此用 search 而非 match
HTTP_REQUEST_RE = re.compile(
    r"(GET|POST|PUT|DELETE|PATCH|HEAD|OPTIONS|TRACE|CONNECT)\s+(\S+)\s+HTTP/\d\.\d"
)

# 匹配 HTTP 响应行: "HTTP/1.1 200 OK"
HTTP_RESPONSE_RE = re.compile(r"HTTP/\d\.\d\s+(\d{3})")

# TCP 流超时清理时间（秒）
STREAM_TIMEOUT = 30

# 本地时区偏移（小时），请根据实际服务器时区修改
LOCAL_TZ_OFFSET_HOURS = 8


def make_timestamp():
    return datetime.now(
        timezone(timedelta(hours=LOCAL_TZ_OFFSET_HOURS))
    ).isoformat()


def main():
    if len(sys.argv) < 2:
        print(f"用法: {sys.argv[0]} <输出日志文件路径>", file=sys.stderr)
        sys.exit(1)

    log_file_path = sys.argv[1]
    log_fh = None

    # 当前数据包的 IP 上下文
    cur_src_host = cur_src_port = cur_dst_host = cur_dst_port = None

    # 待匹配的请求: key = (src_host, src_port)
    pending = {}

    try:
        log_fh = open(log_file_path, "a", encoding="utf-8", buffering=1)

        for raw_line in sys.stdin:
            line = raw_line.rstrip("\n\r")
            stripped = TIMESTAMP_PREFIX_RE.sub("", line.strip())

            # 空行 → 数据包边界，重置上下文
            if not stripped:
                cur_src_host = cur_src_port = cur_dst_host = cur_dst_port = None
                continue

            # 解析 IP 头部行
            ip_match = IP_LINE_RE.match(stripped)
            if ip_match:
                cur_src_host = ip_match.group(1)
                cur_src_port = int(ip_match.group(2))
                cur_dst_host = ip_match.group(3)
                cur_dst_port = int(ip_match.group(4))
                continue

            # HTTP 请求行: 出现在客户端→服务端方向的包中 (dst_port=3000)
            req_match = HTTP_REQUEST_RE.search(stripped)
            if req_match:
                if cur_dst_port == 3000 and cur_src_host:
                    stream_key = (cur_src_host, cur_src_port)
                    pending[stream_key] = {
                        "src_ip": cur_src_host,
                        "method": req_match.group(1),
                        "url": req_match.group(2),
                        "_ts": time.time(),
                    }
                continue

            # HTTP 响应行: 出现在服务端→客户端方向的包中 (src_port=3000)
            resp_match = HTTP_RESPONSE_RE.search(stripped)
            if resp_match:
                if cur_src_port == 3000 and cur_dst_host:
                    status = int(resp_match.group(1))
                    stream_key = (cur_dst_host, cur_dst_port)
                    req = pending.pop(stream_key, None)
                    if req:
                        entry = {
                            "timestamp": make_timestamp(),
                            "src_ip": req["src_ip"],
                            "method": req["method"],
                            "url": req["url"],
                            "status": status,
                        }
                        log_fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
                        log_fh.flush()
                continue

            # 定期清理超时请求，防止内存泄漏
            if len(pending) > 1000:
                now = time.time()
                pending = {
                    k: v for k, v in pending.items()
                    if now - v["_ts"] <= STREAM_TIMEOUT
                }

    except KeyboardInterrupt:
        print("\n监控已停止。", file=sys.stderr)
    finally:
        if log_fh:
            log_fh.close()


if __name__ == "__main__":
    main()
