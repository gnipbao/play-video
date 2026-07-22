#!/usr/bin/env python3
"""本地开发服务器:serve web/ 展示应用并禁用浏览器缓存。

web/engine 是指向独立 engine/src 的静态挂载，因此页面仍通过 /engine/*.js 加载运行时，
但引擎源码不属于展示应用。

python3 -m http.server 只带 Last-Modified,Chrome 会按启发式缓存直接吃旧引擎
(改完代码刷新不生效,踩过:重播负 dt 修复后用户端仍跑旧 core.js)。
本服务器对每个响应发 Cache-Control: no-store,改代码后普通刷新即生效。

用法: tools/serve.py [端口=8123]
"""
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "web"))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *args):
        pass


print(f"serving {ROOT} → http://localhost:{PORT} (no-store)")
server = http.server.ThreadingHTTPServer(("", PORT), Handler)
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
