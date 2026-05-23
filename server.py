from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import mimetypes
import os
import urllib.parse


ROOT = Path(__file__).resolve().parent
TASKS_FILE = ROOT / "tasks.json"
PROJECTS_FILE = ROOT / "projects.json"
STATIC_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
}


def ensure_tasks_file():
    if not TASKS_FILE.exists():
        TASKS_FILE.write_text("[]\n", encoding="utf-8")


def ensure_projects_file():
    if not PROJECTS_FILE.exists():
        PROJECTS_FILE.write_text(json.dumps(["Product", "Design", "Engineering"], indent=2) + "\n", encoding="utf-8")


def read_tasks():
    ensure_tasks_file()
    try:
        data = json.loads(TASKS_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        data = []
    return data if isinstance(data, list) else []


def read_projects():
    ensure_projects_file()
    try:
        data = json.loads(PROJECTS_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        data = []
    return data if isinstance(data, list) else []


def write_tasks(tasks):
    TASKS_FILE.write_text(json.dumps(tasks, indent=2) + "\n", encoding="utf-8")


def write_projects(projects):
    PROJECTS_FILE.write_text(json.dumps(projects, indent=2) + "\n", encoding="utf-8")


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/tasks":
            self.send_json(read_tasks())
            return
        if parsed.path == "/api/projects":
            self.send_json(read_projects())
            return

        path = "/index.html" if parsed.path == "/" else parsed.path
        target = (ROOT / path.lstrip("/")).resolve()

        if ROOT not in target.parents and target != ROOT:
            self.send_error(403)
            return
        if not target.exists() or not target.is_file():
            self.send_error(404)
            return

        content_type = STATIC_TYPES.get(target.suffix) or mimetypes.guess_type(target)[0] or "application/octet-stream"
        body = target.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        parsed_path = urllib.parse.urlparse(self.path).path
        if parsed_path not in ("/api/tasks", "/api/projects"):
            self.send_error(404)
            return

        length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            self.send_error(400, "Invalid JSON")
            return

        if not isinstance(payload, list):
            self.send_error(400, "Expected a list")
            return

        if parsed_path == "/api/tasks":
            write_tasks(payload)
        else:
            write_projects(payload)
        self.send_json({"ok": True})

    def send_json(self, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        print("%s - %s" % (self.address_string(), format % args))


if __name__ == "__main__":
    ensure_tasks_file()
    ensure_projects_file()
    port = int(os.environ.get("PORT", "8000"))
    server = ThreadingHTTPServer(("127.0.0.1", port), Handler)
    print(f"Task dashboard running at http://127.0.0.1:{port}")
    server.serve_forever()
