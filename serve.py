# -*- coding: utf-8 -*-
"""本地服务器 + 数据文件读写。

数据固定存在 data/layout.json，和启动方式无关。
用 python 直接跑这个文件，或者双击同目录的 start.bat。
"""
import http.server
import json
import os
import re
import shutil
import socket
import socketserver
import subprocess
import sys
import threading
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

# 图版映射目录：导入时把用户指定目录下的图片平铺复制到这里，页面只读这里。
# 整个 temp/ 已在 .gitignore 中，重导入会清空重建。
PLATE_DIR = os.path.join(ROOT, "temp", "plates")
PLATE_EXTS = ("jpg", "jpeg", "png", "webp", "bmp", "gif")
PLATE_MAX_FILES = 300
PLATE_MAX_BYTES = 30 * 1024 * 1024

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


def natural_key(name):
    """文件名自然排序：002.jpg 排在 10.jpg 前面。"""
    parts = re.split(r"(\d+)", name.lower())
    return [int(p) if p.isdigit() else p for p in parts]


def list_plates():
    """映射目录里现有的图版，按图号排序。"""
    if not os.path.isdir(PLATE_DIR):
        return []

    out = []
    for name in os.listdir(PLATE_DIR):
        stem, ext = os.path.splitext(name)
        ext = ext.lower().lstrip(".")
        if stem.isdigit() and ext in PLATE_EXTS:
            out.append({"idx": int(stem), "stem": stem, "ext": ext})

    out.sort(key=lambda it: it["idx"])
    return out


def clear_plates():
    """清空映射目录，只删图片，不动别的文件。"""
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


def import_dir(src):
    """把 src 目录下的图片平铺复制到映射目录，返回导入清单。

    不递归子目录，按文件名自然排序后编号 001、002 …
    """
    src = os.path.abspath(os.path.expanduser(str(src or "").strip().strip('"')))

    if not os.path.isdir(src):
        raise ValueError("目录不存在：%s" % src)

    # 源就是映射目录本身：不复制、不清空，直接按现有文件建清单
    if os.path.normcase(src) == os.path.normcase(os.path.abspath(PLATE_DIR)):
        existing = list_plates()
        if not existing:
            raise ValueError("映射目录是空的，请选择放图片的目录")
        return {"dir": src, "plates": existing}

    picked = []
    for name in os.listdir(src):
        path = os.path.join(src, name)
        if not os.path.isfile(path):
            continue
        ext = os.path.splitext(name)[1].lower().lstrip(".")
        if ext not in PLATE_EXTS:
            continue
        picked.append((name, path, ext))

    picked.sort(key=lambda it: natural_key(it[0]))

    if not picked:
        raise ValueError("这个目录下没有图片（支持 %s）" % " / ".join(PLATE_EXTS))
    if len(picked) > PLATE_MAX_FILES:
        raise ValueError("图片太多（%d 张），上限 %d 张" % (len(picked), PLATE_MAX_FILES))

    os.makedirs(PLATE_DIR, exist_ok=True)
    clear_plates()

    plates = []
    for i, (name, path, ext) in enumerate(picked, 1):
        if os.path.getsize(path) > PLATE_MAX_BYTES:
            raise ValueError("单张图超过 %d MB：%s"
                             % (PLATE_MAX_BYTES // 1024 // 1024, name))
        stem = "%03d" % i
        shutil.copyfile(path, os.path.join(PLATE_DIR, "%s.%s" % (stem, ext)))
        plates.append({"idx": i, "stem": stem, "ext": ext, "name": name})

    return {"dir": src, "plates": plates}


def pick_dir():
    """弹系统原生目录选择框，返回所选绝对路径；取消则返回空串。"""
    script = (
        "import tkinter as tk\n"
        "from tkinter import filedialog\n"
        "r = tk.Tk()\n"
        "r.withdraw()\n"
        "r.attributes('-topmost', True)\n"
        "p = filedialog.askdirectory(title='选择放图片的目录')\n"
        "r.destroy()\n"
        "print(p or '')\n"
    )

    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0) if os.name == "nt" else 0

    try:
        out = subprocess.run([sys.executable, "-c", script],
                             capture_output=True, text=True,
                             timeout=180, creationflags=flags)
    except Exception:
        return ""

    return (out.stdout or "").strip()


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

    def _read_body(self):
        try:
            length = int(self.headers.get("Content-Length", 0))
        except ValueError:
            length = 0
        return self.rfile.read(length) if length > 0 else b""

    def _handle_plate_import(self):
        raw = self._read_body()

        try:
            data = json.loads(raw.decode("utf-8")) if raw else {}
        except Exception:
            self._send_json({"ok": False, "error": "bad json"}, 400)
            return

        try:
            result = import_dir((data or {}).get("dir", ""))
        except ValueError as e:
            self._send_json({"ok": False, "error": str(e)}, 400)
            return
        except Exception as e:
            self._send_json({"ok": False, "error": str(e)}, 500)
            return

        self._send_json({"ok": True, "dir": result["dir"], "plates": result["plates"]})

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
        path = self.path.split("?")[0]

        if path == "/api/plates/clear":
            self._read_body()
            self._send_json({"ok": True, "removed": clear_plates()})
            return

        if path == "/api/plates/pick":
            self._read_body()
            self._send_json({"ok": True, "dir": pick_dir()})
            return

        if path == "/api/plates/import":
            self._handle_plate_import()
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
