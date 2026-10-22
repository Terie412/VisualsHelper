# -*- coding: utf-8 -*-
"""本地服务器 + 数据文件读写。

数据固定存在 data/layout.json，和启动方式无关。
用 python 直接跑这个文件，或者双击同目录的 start.bat。
"""
import http.server
import json
import os
import shutil
import socket
import socketserver
import sys
import threading
import urllib.parse
import webbrowser

try:
    sys.stdout.reconfigure(encoding="utf-8")
except Exception:
    pass

ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(ROOT)

HOST = "127.0.0.1"
BASE_PORT = 8777

DATA_DIR = os.path.join(ROOT, "data")
DATA_FILE = os.path.join(DATA_DIR, "layout.json")

# 图版：由使用者自己导入到这里（整个 temp/ 已在 .gitignore 中）
PLATE_DIR = os.path.join(ROOT, "temp", "plates")
PLATE_EXTS = ("jpg", "jpeg", "png", "webp")
PLATE_MAX_BYTES = 20 * 1024 * 1024

# 第一次启动时，如果浏览器里导出的备份躺在下载目录，自动搬过来
DOWNLOAD_DIR = os.path.join(os.path.expanduser("~"), "Downloads")
DOWNLOAD_BACKUP = os.path.join(DOWNLOAD_DIR, "visuals-helper-layout.json")


def migrate_backup():
    if os.path.exists(DATA_FILE):
        return False
    if not os.path.exists(DOWNLOAD_BACKUP):
        return False

    os.makedirs(DATA_DIR, exist_ok=True)
    shutil.copyfile(DOWNLOAD_BACKUP, DATA_FILE)
    print("  已从下载目录导入旧布局：")
    print("  " + DOWNLOAD_BACKUP)
    print()
    return True


def list_plates():
    """temp/plates 里已导入的图版，按图号排序。"""
    if not os.path.isdir(PLATE_DIR):
        return []

    out = []
    for name in os.listdir(PLATE_DIR):
        stem, ext = os.path.splitext(name)
        ext = ext.lower().lstrip(".")
        if stem.isdigit() and ext in PLATE_EXTS:
            out.append({"stem": stem, "ext": ext})

    out.sort(key=lambda it: int(it["stem"]))
    return out


def clear_plates():
    """清空已导入的图版，只删图片，不动别的文件。"""
    if not os.path.isdir(PLATE_DIR):
        return 0

    removed = 0
    for name in os.listdir(PLATE_DIR):
        stem, ext = os.path.splitext(name)
        if stem.isdigit() and ext.lower().lstrip(".") in PLATE_EXTS:
            try:
                os.remove(os.path.join(PLATE_DIR, name))
                removed += 1
            except OSError:
                pass
    return removed


def pick_port():
    for p in range(BASE_PORT, BASE_PORT + 30):
        with socket.socket() as s:
            try:
                s.bind((HOST, p))
                return p
            except OSError:
                continue
    return BASE_PORT


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    # ---------- /api/data ----------

    def _send_json(self, obj_or_text, code=200):
        if isinstance(obj_or_text, str):
            body = obj_or_text.encode("utf-8")
        else:
            body = json.dumps(obj_or_text, ensure_ascii=False).encode("utf-8")

        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    # ---------- /api/plates ----------

    def _handle_plate_upload(self, query):
        params = urllib.parse.parse_qs(query)
        stem = (params.get("stem") or [""])[0].strip()
        ext = (params.get("ext") or [""])[0].strip().lower().lstrip(".")

        if not stem.isdigit() or not (1 <= len(stem) <= 4):
            self._send_json({"ok": False, "error": "bad stem"}, 400)
            return
        if ext not in PLATE_EXTS:
            self._send_json({"ok": False, "error": "unsupported ext"}, 400)
            return

        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            length = 0

        if length <= 0:
            self._send_json({"ok": False, "error": "empty body"}, 400)
            return
        if length > PLATE_MAX_BYTES:
            self._send_json({"ok": False, "error": "too large"}, 413)
            return

        raw = self.rfile.read(length)
        if len(raw) != length:
            self._send_json({"ok": False, "error": "short body"}, 400)
            return

        try:
            os.makedirs(PLATE_DIR, exist_ok=True)

            # 同一图号只留一份：换扩展名重导入时把旧文件删掉
            for old in PLATE_EXTS:
                if old == ext:
                    continue
                stale = os.path.join(PLATE_DIR, "%s.%s" % (stem, old))
                if os.path.exists(stale):
                    os.remove(stale)

            with open(os.path.join(PLATE_DIR, "%s.%s" % (stem, ext)), "wb") as f:
                f.write(raw)
        except Exception as e:
            self._send_json({"ok": False, "error": str(e)}, 500)
            return

        self._send_json({"ok": True, "stem": stem, "ext": ext, "bytes": len(raw)})

    def do_GET(self):
        path = self.path.split("?")[0]

        if path == "/api/plates":
            self._send_json({"ok": True, "plates": list_plates()})
            return

        if path == "/api/data":
            try:
                with open(DATA_FILE, "r", encoding="utf-8") as f:
                    text = f.read()
            except FileNotFoundError:
                text = "{}"
            except Exception:
                text = "{}"
            self._send_json(text)
            return

        super().do_GET()

    def do_POST(self):
        path, _, query = self.path.partition("?")

        if path == "/api/plates/clear":
            try:
                length = int(self.headers.get("Content-Length", 0))
            except ValueError:
                length = 0
            if length:
                self.rfile.read(length)
            self._send_json({"ok": True, "removed": clear_plates()})
            return

        if path == "/api/plates":
            self._handle_plate_upload(query)
            return

        if path != "/api/data":
            self.send_error(404)
            return

        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            length = 0

        raw = self.rfile.read(length) if length else b""

        try:
            data = json.loads(raw.decode("utf-8"))
        except Exception:
            self._send_json({"ok": False, "error": "bad json"}, 400)
            return

        if not isinstance(data, dict):
            self._send_json({"ok": False, "error": "not an object"}, 400)
            return

        try:
            os.makedirs(DATA_DIR, exist_ok=True)
            tmp = DATA_FILE + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            os.replace(tmp, DATA_FILE)
        except Exception as e:
            self._send_json({"ok": False, "error": str(e)}, 500)
            return

        self._send_json({"ok": True})


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


def main():
    port = pick_port()
    url = "http://%s:%d/" % (HOST, port)

    moved = migrate_backup()

    threading.Timer(1.0, lambda: webbrowser.open(url)).start()

    print()
    print("  视觉自测工具已启动")
    print("  " + url)
    print()
    print("  数据文件：" + DATA_FILE)
    if not moved:
        print("  （布局和答案都存在这个文件里，换浏览器、换启动方式都不会丢）")
    print()
    print("  关掉这个窗口就会停止服务。")
    print()

    with Server((HOST, port), Handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == "__main__":
    main()
