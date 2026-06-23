from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import json
import mimetypes
import os
import urllib.parse
import uuid
from datetime import datetime, timezone, timedelta


ROOT = Path(__file__).resolve().parent
TASKS_FILE = ROOT / "tasks.json"
PROJECTS_FILE = ROOT / "projects.json"
FILES_META = ROOT / "files.json"
TEXT_FILE = ROOT / "text.json"
UPLOADS_DIR = ROOT / "uploads"
STATIC_TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
}

FILE_TTL_HOURS = 48


def ensure_tasks_file():
    if not TASKS_FILE.exists():
        TASKS_FILE.write_text("[]\n", encoding="utf-8")


def ensure_projects_file():
    if not PROJECTS_FILE.exists():
        PROJECTS_FILE.write_text(json.dumps(["Product", "Design", "Engineering"], indent=2) + "\n", encoding="utf-8")


def ensure_uploads_dir():
    UPLOADS_DIR.mkdir(exist_ok=True)


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


def read_files_meta():
    if not FILES_META.exists():
        return []
    try:
        data = json.loads(FILES_META.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        data = []
    return data if isinstance(data, list) else []


def write_files_meta(meta):
    FILES_META.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")


def purge_expired_files(meta):
    now = datetime.now(timezone.utc).isoformat()
    alive = []
    for entry in meta:
        expires = entry.get("expiresAt", "")
        if expires and expires < now:
            (UPLOADS_DIR / entry["id"]).unlink(missing_ok=True)
        else:
            alive.append(entry)
    if len(alive) != len(meta):
        write_files_meta(alive)
    return alive


def read_transfer_text():
    if not TEXT_FILE.exists():
        return {"content": ""}
    try:
        return json.loads(TEXT_FILE.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {"content": ""}


def write_transfer_text(content):
    TEXT_FILE.write_text(json.dumps({"content": content}, indent=2) + "\n", encoding="utf-8")


def parse_multipart(content_type_header, body):
    if "boundary=" not in content_type_header:
        return {}
    boundary = content_type_header.split("boundary=")[1].split(";")[0].strip().strip('"')
    delimiter = ("--" + boundary).encode()
    files = {}
    for part in body.split(delimiter)[1:]:
        if part.startswith(b"--"):
            break
        part = part.lstrip(b"\r\n")
        if not part or b"\r\n\r\n" not in part:
            continue
        header_section, body_part = part.split(b"\r\n\r\n", 1)
        body_part = body_part.rstrip(b"\r\n")
        hdrs = {}
        for line in header_section.decode("utf-8", errors="replace").split("\r\n"):
            if ":" in line:
                k, v = line.split(":", 1)
                hdrs[k.strip().lower()] = v.strip()
        disposition = hdrs.get("content-disposition", "")
        params = {}
        for item in disposition.split(";"):
            item = item.strip()
            if "=" in item:
                k, v = item.split("=", 1)
                params[k.strip()] = v.strip().strip('"')
        name = params.get("name", "")
        filename = params.get("filename", "")
        content_type_part = hdrs.get("content-type", "application/octet-stream")
        if filename and name:
            files[name] = {
                "filename": filename,
                "content": body_part,
                "content_type": content_type_part,
            }
    return files


class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        if path == "/api/tasks":
            qs = urllib.parse.parse_qs(parsed.query)
            result = read_tasks()
            if "done" in qs:
                want_done = qs["done"][0].lower() == "true"
                result = [t for t in result if bool(t.get("done")) == want_done]
            if "project" in qs:
                proj = qs["project"][0]
                result = [t for t in result if t.get("project", "") == proj]
            self.send_json(result)
            return
        if path == "/api/projects":
            self.send_json(read_projects())
            return
        if path == "/api/files":
            self.send_json(purge_expired_files(read_files_meta()))
            return
        if path.startswith("/api/files/") and path.endswith("/download"):
            file_id = path[len("/api/files/"):-len("/download")]
            meta = read_files_meta()
            entry = next((e for e in meta if e["id"] == file_id), None)
            if not entry:
                self.send_error(404)
                return
            blob = UPLOADS_DIR / file_id
            if not blob.exists():
                self.send_error(404)
                return
            body = blob.read_bytes()
            safe_name = entry["name"].replace('"', '\\"')
            encoded_name = urllib.parse.quote(entry["name"])
            self.send_response(200)
            self.send_header("Content-Type", entry.get("contentType", "application/octet-stream"))
            self.send_header(
                "Content-Disposition",
                f'attachment; filename="{safe_name}"; filename*=UTF-8\'\'{encoded_name}',
            )
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        if path == "/api/text":
            self.send_json(read_transfer_text())
            return

        static_path = "/index.html" if path == "/" else path
        target = (ROOT / static_path.lstrip("/")).resolve()
        if target.is_relative_to(UPLOADS_DIR):
            self.send_error(403)
            return
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

        if parsed_path == "/api/tasks":
            self.send_error(405, "Use POST /api/tasks/add to add a task")
            return

        if parsed_path in ("/api/internal/tasks", "/api/internal/projects"):
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
            if parsed_path == "/api/internal/tasks":
                write_tasks(payload)
            else:
                write_projects(payload)
            self.send_json({"ok": True})
            return

        if parsed_path == "/api/upload":
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length)
            content_type_header = self.headers.get("Content-Type", "")
            files = parse_multipart(content_type_header, raw)
            if "file" not in files:
                self.send_error(400, "No file field")
                return
            f = files["file"]
            ensure_uploads_dir()
            file_id = str(uuid.uuid4())
            (UPLOADS_DIR / file_id).write_bytes(f["content"])
            now = datetime.now(timezone.utc)
            entry = {
                "id": file_id,
                "name": f["filename"],
                "size": len(f["content"]),
                "contentType": f["content_type"],
                "uploadedAt": now.isoformat(),
                "expiresAt": (now + timedelta(hours=FILE_TTL_HOURS)).isoformat(),
            }
            meta = read_files_meta()
            meta.append(entry)
            write_files_meta(meta)
            self.send_json(entry)
            return

        if parsed_path == "/api/text":
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length)
            try:
                payload = json.loads(raw.decode("utf-8"))
            except json.JSONDecodeError:
                self.send_error(400, "Invalid JSON")
                return
            write_transfer_text(payload.get("content", ""))
            self.send_json({"ok": True})
            return

        if parsed_path == "/api/projects/add":
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length)
            try:
                payload = json.loads(raw.decode("utf-8"))
            except (json.JSONDecodeError, ValueError):
                self.send_error(400, "Invalid JSON")
                return
            name = str(payload.get("name", "")).strip()
            if not name:
                self.send_error(400, "name is required")
                return
            projects = read_projects()
            if name not in projects:
                projects.append(name)
                write_projects(projects)
            self.send_json({"name": name, "projects": projects})
            return

        if parsed_path == "/api/tasks/add":
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length)
            try:
                payload = json.loads(raw.decode("utf-8"))
            except (json.JSONDecodeError, ValueError):
                self.send_error(400, "Invalid JSON")
                return
            name = str(payload.get("name", "")).strip()
            if not name:
                self.send_error(400, "name is required")
                return
            projects = read_projects()
            project = str(payload.get("project", "")).strip() or (projects[0] if projects else "Inbox")
            due_date = str(payload.get("dueDate", ""))
            tasks = read_tasks()
            if project not in projects:
                projects.append(project)
                write_projects(projects)
            task = {
                "id": str(uuid.uuid4()),
                "name": name,
                "project": project,
                "dueDate": due_date,
                "done": False,
                "order": len(tasks),
                "completedAt": "",
            }
            tasks.append(task)
            write_tasks(tasks)
            self.send_json(task)
            return

        if parsed_path.startswith("/api/tasks/") and parsed_path.endswith("/rename"):
            task_id = parsed_path[len("/api/tasks/"):-len("/rename")]
            if not task_id:
                self.send_error(400, "Missing task id")
                return
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length)
            try:
                payload = json.loads(raw.decode("utf-8"))
            except (json.JSONDecodeError, ValueError):
                self.send_error(400, "Invalid JSON")
                return
            new_name = str(payload.get("name", "")).strip()
            if not new_name:
                self.send_error(400, "name is required")
                return
            tasks = read_tasks()
            task = next((t for t in tasks if t["id"] == task_id), None)
            if not task:
                self.send_error(404, "Task not found")
                return
            task["name"] = new_name
            write_tasks(tasks)
            self.send_json(task)
            return

        if parsed_path.startswith("/api/tasks/") and parsed_path.endswith("/complete"):
            task_id = parsed_path[len("/api/tasks/"):-len("/complete")]
            if not task_id:
                self.send_error(400, "Missing task id")
                return
            length = int(self.headers.get("Content-Length", "0"))
            if length > 0:
                self.rfile.read(length)
            tasks = read_tasks()
            task = next((t for t in tasks if t["id"] == task_id), None)
            if not task:
                self.send_error(404, "Task not found")
                return
            if task.get("done"):
                self.send_json(task)
                return
            task["done"] = True
            task["completedAt"] = datetime.now(timezone.utc).isoformat()
            write_tasks(tasks)
            self.send_json(task)
            return

        self.send_error(404)

    def do_DELETE(self):
        parsed_path = urllib.parse.urlparse(self.path).path

        if parsed_path.startswith("/api/tasks/"):
            task_id = parsed_path[len("/api/tasks/"):]
            if not task_id:
                self.send_error(400, "Missing task id")
                return
            tasks = read_tasks()
            task = next((t for t in tasks if t["id"] == task_id), None)
            if not task:
                self.send_error(404, "Task not found")
                return
            write_tasks([t for t in tasks if t["id"] != task_id])
            self.send_json({"ok": True})
            return

        if parsed_path.startswith("/api/files/"):
            file_id = parsed_path[len("/api/files/"):]
            if not file_id:
                self.send_error(400)
                return
            meta = read_files_meta()
            entry = next((e for e in meta if e["id"] == file_id), None)
            if not entry:
                self.send_error(404)
                return
            (UPLOADS_DIR / file_id).unlink(missing_ok=True)
            write_files_meta([e for e in meta if e["id"] != file_id])
            self.send_json({"ok": True})
            return

        if parsed_path == "/api/text":
            write_transfer_text("")
            self.send_json({"ok": True})
            return

        self.send_error(404)

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
    ensure_uploads_dir()
    port = int(os.environ.get("PORT", "8082"))
    host = os.environ.get("HOST", "0.0.0.0")
    server = ThreadingHTTPServer((host, port), Handler)
    print(f"Task dashboard running at http://{host}:{port}")
    server.serve_forever()
