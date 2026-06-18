# Bordash Task API

Local HTTP API for reading and managing the to-do list programmatically.

**Base URL:** `http://127.0.0.1:8000`  
**Format:** JSON (`Content-Type: application/json`)  
**Auth:** None — local server only

> **IMPORTANT for agents:** Never call `POST /api/tasks` or `POST /api/projects` directly — those are internal endpoints used by the browser UI that **overwrite the entire task/project list**. Always use the specific action endpoints below (`/api/tasks/add`, `/api/tasks/{id}/rename`, etc.). Calling the wrong endpoint will wipe all existing data.

---

## Task object

Every task is returned as a JSON object with the following fields:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique identifier |
| `name` | string | Task name |
| `project` | string | Project the task belongs to |
| `dueDate` | string | Due date in `YYYY-MM-DD` format, or `""` if not set |
| `done` | boolean | `true` if the task is completed |
| `completedAt` | string | ISO 8601 timestamp when completed, or `""` |
| `order` | number | Display order within its project |

---

## Endpoints

### List tasks

```
GET /api/tasks
```

Returns all tasks (both active and completed).

**Optional query parameters:**

| Parameter | Values | Description |
|-----------|--------|-------------|
| `done` | `true` / `false` | Filter by completion status |
| `project` | any string | Filter by exact project name |

**Response:** Array of task objects.

```bash
# All tasks
curl http://127.0.0.1:8000/api/tasks

# Only active (incomplete) tasks
curl "http://127.0.0.1:8000/api/tasks?done=false"

# Only completed tasks
curl "http://127.0.0.1:8000/api/tasks?done=true"

# Tasks in a specific project
curl "http://127.0.0.1:8000/api/tasks?project=Engineering"
```

**Example response:**

```json
[
  {
    "id": "abc123",
    "name": "Write unit tests",
    "project": "Engineering",
    "dueDate": "2026-06-20",
    "done": false,
    "completedAt": "",
    "order": 0
  },
  {
    "id": "def456",
    "name": "Review PR",
    "project": "Engineering",
    "dueDate": "",
    "done": true,
    "completedAt": "2026-06-17T14:30:00.000000+00:00",
    "order": 1
  }
]
```

---

### List projects

```
GET /api/projects
```

Returns the ordered list of project names.

```bash
curl http://127.0.0.1:8000/api/projects
```

**Example response:**

```json
["Product", "Engineering", "Research", "Design"]
```

---

### Add a task

```
POST /api/tasks/add
Content-Type: application/json
```

Creates a new task. Returns the created task object.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Task name |
| `project` | string | No | Project name. Defaults to the first project in the list. Created automatically if it doesn't exist. |
| `dueDate` | string | No | Due date as `YYYY-MM-DD`. Omit or pass `""` for no date. |

```bash
curl -X POST http://127.0.0.1:8000/api/tasks/add \
  -H "Content-Type: application/json" \
  -d '{"name": "Deploy to staging", "project": "Engineering", "dueDate": "2026-06-20"}'
```

**Example response:**

```json
{
  "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "name": "Deploy to staging",
  "project": "Engineering",
  "dueDate": "2026-06-20",
  "done": false,
  "completedAt": "",
  "order": 12
}
```

**Error responses:**

- `400 Bad Request` — missing or empty `name`, or invalid JSON

---

### Add a project

```
POST /api/projects/add
Content-Type: application/json
```

Creates a new project. If a project with the same name already exists, it is returned unchanged (idempotent).

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | Project name |

```bash
curl -X POST http://127.0.0.1:8000/api/projects/add \
  -H "Content-Type: application/json" \
  -d '{"name": "Infrastructure"}'
```

**Example response:**

```json
{
  "name": "Infrastructure",
  "projects": ["Product", "Engineering", "Research", "Design", "Infrastructure"]
}
```

**Error responses:**

- `400 Bad Request` — missing or empty `name`, or invalid JSON

---

### Rename a task

```
POST /api/tasks/{id}/rename
Content-Type: application/json
```

Updates the name of an existing task. Returns the updated task object.

**Request body:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | Yes | New task name |

```bash
curl -X POST http://127.0.0.1:8000/api/tasks/f47ac10b-58cc-4372-a567-0e02b2c3d479/rename \
  -H "Content-Type: application/json" \
  -d '{"name": "Deploy to production"}'
```

**Example response:**

```json
{
  "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "name": "Deploy to production",
  "project": "Engineering",
  "dueDate": "2026-06-20",
  "done": false,
  "completedAt": "",
  "order": 12
}
```

**Error responses:**

- `400 Bad Request` — missing or empty `name`, or invalid JSON
- `404 Not Found` — no task with that id

---

### Mark a task as complete

```
POST /api/tasks/{id}/complete
```

Marks a task as done and records the completion timestamp. Idempotent — calling it on an already-completed task returns the task unchanged.

```bash
curl -X POST http://127.0.0.1:8000/api/tasks/f47ac10b-58cc-4372-a567-0e02b2c3d479/complete
```

**Example response:**

```json
{
  "id": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
  "name": "Deploy to staging",
  "project": "Engineering",
  "dueDate": "2026-06-20",
  "done": true,
  "completedAt": "2026-06-17T21:45:00.123456+00:00",
  "order": 12
}
```

**Error responses:**

- `404 Not Found` — no task with that id

---

## Python examples

```python
import requests

BASE = "http://127.0.0.1:8000"

# List all active tasks
tasks = requests.get(f"{BASE}/api/tasks", params={"done": "false"}).json()

# Add a task
new_task = requests.post(f"{BASE}/api/tasks/add", json={
    "name": "Run regression suite",
    "project": "Engineering",
    "dueDate": "2026-06-21",
}).json()

# Mark it complete
done_task = requests.post(f"{BASE}/api/tasks/{new_task['id']}/complete").json()
```

---

## Notes

- The server stores data in `tasks.json` and `projects.json` in the same directory.
- Changes made via the API are immediately reflected in the browser UI (refresh the page).
- There is no pagination — all tasks are returned in a single response.
- `dueDate` uses the `YYYY-MM-DD` format (ISO 8601 date). Times are always UTC.
