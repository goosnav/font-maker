"""Serve the editor and device-local recovery, without accepting arbitrary paths."""
from __future__ import annotations

import json
import os
import secrets
import signal
import sys
import threading
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

MAX_PROJECT = 512 * 1024 * 1024

def data_directory() -> Path:
    override = os.environ.get("GOOSNAV_APP_DATA")
    if override:
        return Path(override)
    if sys.platform == "darwin":
        return Path.home() / "Library/Application Support/Goosnav Font"
    if os.name == "nt":
        return Path(os.environ.get("LOCALAPPDATA", Path.home())) / "Goosnav Font"
    return Path(os.environ.get("XDG_DATA_HOME", Path.home() / ".local/share")) / "Goosnav Font"

def atomic_write(path: Path, content: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".partial-" + secrets.token_hex(6))
    try:
        with temporary.open("xb") as output:
            if os.name != "nt":
                os.chmod(temporary, 0o600)
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)

def make_server(static: Path, data: Path, port: int = 0) -> ThreadingHTTPServer:
    token = secrets.token_urlsafe(32)
    recovery = data / "data" / "recovery.goosnavfont"
    write_lock = threading.Lock()

    class Handler(SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(static), **kwargs)

        def log_message(self, fmt, *args):
            # Never log request bodies, project names, paths, or tokens.
            if len(args) > 1 and str(args[1]).startswith("5"):
                print("HTTP request failed", flush=True)

        def end_headers(self):
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Cross-Origin-Resource-Policy", "same-origin")
            policy = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; img-src 'self' data: blob:; font-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'"
            if urlsplit(self.path).path == "/engine/scan.worker.js":
                policy = policy.replace("script-src 'self'", "script-src 'self' 'unsafe-eval'")
            self.send_header("Content-Security-Policy", policy)
            if self.path.startswith("/api/"):
                self.send_header("Cache-Control", "no-store")
            super().end_headers()

        def allowed_host(self):
            return self.headers.get("Host") == f"127.0.0.1:{self.server.server_port}"

        def authorized(self):
            expected = f"http://127.0.0.1:{self.server.server_port}"
            return self.allowed_host() and self.headers.get("Origin") == expected and secrets.compare_digest(self.headers.get("X-Goosnav-Token", ""), token)

        def payload(self, data: bytes, content_type="application/json", code=200):
            self.send_response(code)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def do_GET(self):
            if not self.allowed_host():
                return self.send_error(403)
            route = urlsplit(self.path).path
            if route == "/health/ready":
                return self.payload(b'{"ready":true,"app":"com.goosnav.font"}')
            if route == "/api/session":
                return self.payload(json.dumps({"token": token}).encode())
            if route == "/api/recovery":
                if not recovery.is_file():
                    return self.send_error(404)
                return self.payload(recovery.read_bytes(), "application/zip")
            if route.startswith("/api/"):
                return self.send_error(404)
            return super().do_GET()

        def list_directory(self, path):
            return self.send_error(404)

        def do_PUT(self):
            if not self.authorized():
                return self.send_error(403)
            if self.path != "/api/recovery":
                return self.send_error(404)
            try:
                length = int(self.headers.get("Content-Length", "0"))
            except ValueError:
                return self.send_error(400)
            if not 1 <= length <= MAX_PROJECT:
                return self.send_error(413)
            self.connection.settimeout(60)
            content = self.rfile.read(length)
            if len(content) != length or not content.startswith(b"PK\x03\x04"):
                return self.send_error(400)
            try:
                with write_lock:
                    if recovery.exists():
                        atomic_write(recovery.with_suffix(".previous"), recovery.read_bytes())
                    atomic_write(recovery, content)
            except OSError:
                return self.payload(b'{"error":"Recovery could not be saved. Save a project file."}', code=507)
            return self.payload(b'{"saved":true}')

        def do_POST(self):
            if not self.authorized():
                return self.send_error(403)
            if self.path != "/api/quit":
                return self.send_error(404)
            self.payload(b'{"closing":true}')
            threading.Thread(target=self.server.shutdown, daemon=True).start()

    try:
        server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    except OSError:
        server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    server.daemon_threads = True
    return server

def main():
    root = Path(os.environ.get("GOOSNAV_APP_ROOT", Path(__file__).resolve().parents[2]))
    static = root / "static"
    if not (static / "index.html").is_file():
        raise RuntimeError("APP-START: Built browser assets are missing.")
    data = data_directory()
    data.mkdir(parents=True, exist_ok=True)
    server = make_server(static, data, int(os.environ.get("GOOSNAV_PORT_PREFERENCE", "0")))
    url = f"http://127.0.0.1:{server.server_port}"
    state = os.environ.get("GOOSNAV_RUNTIME_STATE")
    if state:
        atomic_write(Path(state), json.dumps({"schema_version": 1, "pid": os.getpid(), "url": url}).encode())
    print(url, flush=True)
    if not state and os.environ.get("GOOSNAV_NO_BROWSER") != "1":
        webbrowser.open(url)
    def stop(*_):
        threading.Thread(target=server.shutdown, daemon=True).start()
    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        server.serve_forever(poll_interval=0.2)
    finally:
        server.server_close()

if __name__ == "__main__":
    main()
