const board = document.querySelector("#project-board");
const tableBody = document.querySelector("#task-table");
const completedTableBody = document.querySelector("#completed-table");
const taskCount = document.querySelector("#task-count");
const completedCount = document.querySelector("#completed-count");
const projectTemplate = document.querySelector("#project-template");
const sortButtons = document.querySelectorAll(".sort-button");
const projectAdd = document.querySelector("#project-add");
const newProject = document.querySelector("#new-project");
const tableAdd = document.querySelector("#table-add");
const tableTask = document.querySelector("#table-task");
const tableProject = document.querySelector("#table-project");
const tableDate = document.querySelector("#table-date");
const reorganizeToggle = document.querySelector("#reorganize-toggle");
const reorganizeModal = document.querySelector("#reorganize-modal");
const reorganizeClose = document.querySelector("#reorganize-close");
const projectOrderList = document.querySelector("#project-order-list");

let tasks = [];
let projects = [];
let sortKey = "project";
let reorganizing = false;
const completingTasks = new Set();
const exitingTasks = new Set();
const completionTimers = new Map();
const deletingTasks = new Set();

const defaultProjects = ["Product", "Design", "Engineering"];

function uid() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function todayString() {
  const now = new Date();
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function dateState(dueDate, done) {
  if (!dueDate || done) return "";
  const today = todayString();
  if (dueDate === today) return "today";
  return dueDate < today ? "overdue" : "";
}

function formatDate(dueDate) {
  if (!dueDate) return "No date";
  const [year, month, day] = dueDate.split("-");
  return `${month}/${day}/${year}`;
}

function makeDateLabel(dueDate, options = {}) {
  const date = document.createElement("div");
  date.className = `task-date${dueDate ? "" : " no-date"}`;
  date.textContent = dueDate ? formatDate(dueDate) : options.blankWhenMissing ? "" : "mm/dd/yyyy";
  return date;
}

function normalizedProject(project) {
  const trimmed = project.trim();
  return trimmed || "Inbox";
}

function activeTasks() {
  return tasks.filter((task) => !task.done);
}

function completedTasks() {
  return tasks.filter((task) => task.done);
}

async function loadTasks() {
  const [taskResponse, projectResponse] = await Promise.all([fetch("/api/tasks"), fetch("/api/projects")]);
  tasks = await taskResponse.json();
  projects = await projectResponse.json();
  const before = JSON.stringify(projects);
  syncProjectsFromTasks();
  if (JSON.stringify(projects) !== before) {
    await saveProjects();
  }
  render();
}

async function saveTasks() {
  await fetch("/api/tasks", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(tasks),
  });
}

async function saveProjects() {
  await fetch("/api/projects", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(projects),
  });
}

function syncProjectsFromTasks() {
  const ordered = [];
  const seedProjects = projects.length ? projects : defaultProjects;
  [...seedProjects, ...tasks.map((task) => task.project)].forEach((project) => {
    const normalized = normalizedProject(project);
    if (!ordered.some((item) => item.toLowerCase() === normalized.toLowerCase())) {
      ordered.push(normalized);
    }
  });
  projects = ordered;
}

async function addProject(name) {
  const project = normalizedProject(name);
  if (projects.some((item) => item.toLowerCase() === project.toLowerCase())) return;
  projects = [...projects, project];
  await saveProjects();
  render();
}

async function addTask({ name, project, dueDate = "" }) {
  const normalized = normalizedProject(project || projects[0] || "Inbox");
  if (!projects.includes(normalized)) {
    projects = [...projects, normalized];
    await saveProjects();
  }
  tasks.push({
    id: uid(),
    name: name.trim(),
    project: normalized,
    dueDate,
    done: false,
    order: tasks.length,
  });
  await saveTasks();
  render();
}

async function updateTask(id, patch) {
  tasks = tasks.map((task) => (task.id === id ? { ...task, ...patch } : task));
  await saveTasks();
  render();
}

function completeTask(id) {
  if (completingTasks.has(id)) return;
  completingTasks.add(id);
  document.querySelectorAll(`[data-task-id="${id}"]`).forEach((element) => {
    element.classList.add("completing-static");
    element.querySelectorAll(".task-check, .task-title").forEach((child) => child.classList.add("done"));
  });

  const exitTimer = window.setTimeout(() => {
    exitingTasks.add(id);
    document.querySelectorAll(`[data-task-id="${id}"]`).forEach((element) => {
      element.classList.add("completing-exit");
    });
  }, 750);

  const completeTimer = window.setTimeout(async () => {
    completionTimers.delete(id);
    completingTasks.delete(id);
    exitingTasks.delete(id);
    tasks = tasks.map((task) =>
      task.id === id ? { ...task, done: true, completedAt: new Date().toISOString() } : task
    );
    await saveTasks();
    render();
  }, 1000);
  completionTimers.set(id, [exitTimer, completeTimer]);
}

async function restoreTask(id) {
  if (completionTimers.has(id)) {
    completionTimers.get(id).forEach((timer) => window.clearTimeout(timer));
    completionTimers.delete(id);
  }
  completingTasks.delete(id);
  exitingTasks.delete(id);
  await updateTask(id, { done: false, completedAt: "" });
}

async function moveTask(id, project, beforeId = "") {
  const movedTask = tasks.find((task) => task.id === id);
  if (!movedTask) return;

  const otherTasks = tasks.filter((task) => task.id !== id);
  const projectTasks = otherTasks
    .filter((task) => normalizedProject(task.project) === project)
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const insertAt = beforeId ? projectTasks.findIndex((task) => task.id === beforeId) : projectTasks.length;
  projectTasks.splice(insertAt < 0 ? projectTasks.length : insertAt, 0, { ...movedTask, project });

  const reordered = projectTasks.map((task, index) => ({ ...task, order: index }));
  tasks = otherTasks
    .filter((task) => normalizedProject(task.project) !== project)
    .concat(reordered);

  await saveTasks();
  render();
}

async function deleteTask(id) {
  if (deletingTasks.has(id)) return;
  const removedTask = tasks.find((task) => task.id === id);
  if (!removedTask) return;
  deletingTasks.add(id);

  animateTaskRemoval(id);
  tasks = tasks.filter((task) => task.id !== id);
  await saveTasks();
  window.setTimeout(() => {
    deletingTasks.delete(id);
    updateTaskSummary();
    updateProjectSummary(removedTask.project);
    updateEmptyStates();
  }, 260);
}

async function deleteProject(project) {
  const taskTotal = tasks.filter((task) => normalizedProject(task.project) === project).length;
  const suffix = taskTotal ? ` and ${taskTotal} task${taskTotal === 1 ? "" : "s"}` : "";
  if (!window.confirm(`Delete ${project}${suffix}?`)) return;
  projects = projects.filter((item) => item !== project);
  tasks = tasks.filter((task) => normalizedProject(task.project) !== project);
  await Promise.all([saveProjects(), saveTasks()]);
  render();
}

async function moveProject(project, beforeProject = "") {
  const current = projects.filter((item) => item !== project);
  const insertAt = beforeProject ? current.indexOf(beforeProject) : current.length;
  current.splice(insertAt < 0 ? current.length : insertAt, 0, project);
  projects = current;
  await saveProjects();
  render();
}

function projectNames() {
  return projects;
}

function sortedTasks() {
  return activeTasks().sort((a, b) => {
    if (sortKey === "project") {
      const firstIndex = projects.indexOf(normalizedProject(a.project));
      const secondIndex = projects.indexOf(normalizedProject(b.project));
      return (firstIndex - secondIndex) || a.name.localeCompare(b.name);
    }
    const first = String(a[sortKey] || "");
    const second = String(b[sortKey] || "");
    if (sortKey === "dueDate") {
      return (first || "9999-99-99").localeCompare(second || "9999-99-99") || a.name.localeCompare(b.name);
    }
    return first.localeCompare(second) || a.name.localeCompare(b.name);
  });
}

function sortedCompletedTasks() {
  return completedTasks().sort((a, b) => {
    const first = String(a.completedAt || "");
    const second = String(b.completedAt || "");
    return second.localeCompare(first) || a.name.localeCompare(b.name);
  });
}

function makeTaskChip(task) {
  const chip = document.createElement("div");
  chip.className = "task-chip";
  chip.draggable = true;
  chip.dataset.id = task.id;
  chip.dataset.taskId = task.id;

  const check = document.createElement("button");
  check.type = "button";
  check.className = `task-check${task.done || completingTasks.has(task.id) ? " done" : ""}`;
  check.textContent = "✓";
  check.setAttribute("aria-label", "Mark complete");
  check.addEventListener("click", () => completeTask(task.id));

  const title = document.createElement("div");
  title.className = `task-title ${dateState(task.dueDate, task.done)}${task.done || completingTasks.has(task.id) ? " done" : ""}`;
  title.textContent = task.name;

  const date = makeDateLabel(task.dueDate, { blankWhenMissing: true });

  chip.addEventListener("dragstart", (event) => {
    if (completingTasks.has(task.id)) return;
    chip.classList.add("dragging");
    event.dataTransfer.setData("text/plain", task.id);
    event.dataTransfer.effectAllowed = "move";
  });
  chip.addEventListener("dragend", () => chip.classList.remove("dragging"));
  chip.classList.toggle("completing-static", completingTasks.has(task.id));
  chip.classList.toggle("completing-exit", exitingTasks.has(task.id));

  chip.append(check, title, date);
  return chip;
}

function projectTag(project) {
  const tag = document.createElement("span");
  tag.className = "project-tag";
  tag.textContent = normalizedProject(project);
  return tag;
}

function fillProjectSelect(select, selectedProject = "") {
  select.replaceChildren();
  projects.forEach((project) => {
    const option = document.createElement("option");
    option.value = project;
    option.textContent = project;
    option.selected = project === selectedProject;
    select.append(option);
  });
}

function getDropTarget(list, y) {
  const chips = [...list.querySelectorAll(".task-chip:not(.dragging)")];
  return chips.reduce(
    (closest, chip) => {
      const box = chip.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset, chip };
      }
      return closest;
    },
    { offset: Number.NEGATIVE_INFINITY, chip: null }
  ).chip;
}

function renderBoard() {
  board.replaceChildren();

  projectNames().forEach((project) => {
    const clone = projectTemplate.content.cloneNode(true);
    const card = clone.querySelector(".project-card");
    const deleteButton = clone.querySelector(".project-delete");
    const heading = clone.querySelector("h3");
    const count = clone.querySelector(".project-head span");
    const list = clone.querySelector(".project-list");
    const form = clone.querySelector(".project-add");
    const projectTasks = tasks
      .filter((task) => !task.done && normalizedProject(task.project) === project)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    heading.textContent = project;
    card.dataset.project = project;
    count.textContent = `${projectTasks.length} task${projectTasks.length === 1 ? "" : "s"}`;
    projectTasks.forEach((task) => list.append(makeTaskChip(task)));
    deleteButton.addEventListener("click", () => deleteProject(project));

    if (!projectTasks.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "Drop tasks here";
      list.append(empty);
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const name = String(data.get("name") || "").trim();
      if (!name) return;
      await addTask({ name, project, dueDate: String(data.get("dueDate") || "") });
      form.reset();
    });

    list.addEventListener("dragover", (event) => {
      event.preventDefault();
      card.classList.add("drag-over");
      const dragging = document.querySelector(".task-chip.dragging");
      const before = getDropTarget(list, event.clientY);
      if (!dragging) return;
      if (before) {
        list.insertBefore(dragging, before);
      } else {
        list.append(dragging);
      }
    });
    list.addEventListener("dragleave", () => card.classList.remove("drag-over"));
    list.addEventListener("drop", async (event) => {
      event.preventDefault();
      card.classList.remove("drag-over");
      const id = event.dataTransfer.getData("text/plain");
      const before = getDropTarget(list, event.clientY);
      await moveTask(id, project, before?.dataset.id || "");
    });

    board.append(clone);
  });
}

function renderTable() {
  tableBody.replaceChildren();

  sortedTasks().forEach((task) => {
    const row = document.createElement("tr");
    row.dataset.taskId = task.id;

    const statusCell = document.createElement("td");
    const check = document.createElement("button");
    check.type = "button";
    check.className = `task-check${task.done || completingTasks.has(task.id) ? " done" : ""}`;
    check.textContent = "✓";
    check.setAttribute("aria-label", "Mark complete");
    check.addEventListener("click", () => completeTask(task.id));
    statusCell.append(check);

    const nameCell = document.createElement("td");
    const taskLine = document.createElement("div");
    taskLine.className = "task-table-name";
    const nameInput = document.createElement("input");
    nameInput.value = task.name;
    nameInput.addEventListener("change", () => updateTask(task.id, { name: nameInput.value.trim() || task.name }));
    nameInput.className = dateState(task.dueDate, task.done);
    taskLine.append(nameInput, projectTag(task.project));
    nameCell.append(taskLine);

    const dateCell = document.createElement("td");
    const dateInput = document.createElement("input");
    dateInput.type = "date";
    dateInput.value = task.dueDate || "";
    dateInput.addEventListener("change", () => updateTask(task.id, { dueDate: dateInput.value }));
    dateCell.append(dateInput);

    const actionCell = document.createElement("td");
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "table-action";
    deleteButton.textContent = "X";
    deleteButton.setAttribute("aria-label", `Delete ${task.name}`);
    deleteButton.addEventListener("click", () => deleteTask(task.id));
    actionCell.append(deleteButton);

    row.append(statusCell, nameCell, dateCell, actionCell);
    row.classList.toggle("completing-static", completingTasks.has(task.id));
    row.classList.toggle("completing-exit", exitingTasks.has(task.id));
    tableBody.append(row);
  });

  if (!activeTasks().length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.className = "empty-state";
    cell.textContent = "No tasks yet";
    row.append(cell);
    tableBody.append(row);
  }
}

function getOrderDropTarget(list, y) {
  const items = [...list.querySelectorAll(".project-order-item:not(.dragging)")];
  return items.reduce(
    (closest, item) => {
      const box = item.getBoundingClientRect();
      const offset = y - box.top - box.height / 2;
      if (offset < 0 && offset > closest.offset) {
        return { offset, item };
      }
      return closest;
    },
    { offset: Number.NEGATIVE_INFINITY, item: null }
  ).item;
}

function renderProjectOrderModal() {
  reorganizeModal.hidden = !reorganizing;
  if (!reorganizing) {
    projectOrderList.replaceChildren();
    return;
  }

  projectOrderList.replaceChildren();
  projects.forEach((project, index) => {
    const item = document.createElement("div");
    item.className = "project-order-item";
    item.draggable = true;
    item.dataset.project = project;

    const handle = document.createElement("span");
    handle.className = "project-order-handle";
    handle.textContent = "=";
    handle.setAttribute("aria-hidden", "true");

    const name = document.createElement("span");
    name.className = "project-order-name";
    name.textContent = project;

    item.append(handle, name);

    item.addEventListener("dragstart", (event) => {
      item.classList.add("dragging");
      event.dataTransfer.setData("application/x-project", project);
      event.dataTransfer.effectAllowed = "move";
    });
    item.addEventListener("dragend", () => item.classList.remove("dragging"));

    projectOrderList.append(item);
  });
}

function renderCompletedTable() {
  completedTableBody.replaceChildren();

  sortedCompletedTasks().forEach((task) => {
    const row = document.createElement("tr");
    row.dataset.taskId = task.id;

    const statusCell = document.createElement("td");
    const check = document.createElement("button");
    check.type = "button";
    check.className = "task-check done";
    check.textContent = "✓";
    check.setAttribute("aria-label", `Move ${task.name} back to active tasks`);
    check.addEventListener("click", () => restoreTask(task.id));
    statusCell.append(check);

    const nameCell = document.createElement("td");
    const taskLine = document.createElement("div");
    taskLine.className = "task-table-name";
    const title = document.createElement("span");
    title.className = "completed-task-name";
    title.textContent = task.name;
    taskLine.append(title, projectTag(task.project));
    nameCell.append(taskLine);

    const dateCell = document.createElement("td");
    dateCell.append(makeDateLabel(task.dueDate));

    const actionCell = document.createElement("td");
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "table-action";
    deleteButton.textContent = "X";
    deleteButton.setAttribute("aria-label", `Delete ${task.name}`);
    deleteButton.addEventListener("click", () => deleteTask(task.id));
    actionCell.append(deleteButton);

    row.append(statusCell, nameCell, dateCell, actionCell);
    completedTableBody.append(row);
  });

  if (!completedTasks().length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.className = "empty-state";
    cell.textContent = "No completed tasks";
    row.append(cell);
    completedTableBody.append(row);
  }
}

function taskLabel(count) {
  return `${count} task${count === 1 ? "" : "s"}`;
}

function updateTaskSummary() {
  taskCount.textContent = taskLabel(activeTasks().length);
  completedCount.textContent = taskLabel(completedTasks().length);
}

function updateProjectSummary(project) {
  const normalized = normalizedProject(project);
  const card = [...board.querySelectorAll(".project-card")].find((item) => item.dataset.project === normalized);
  if (!card) return;
  const count = tasks.filter((task) => !task.done && normalizedProject(task.project) === normalized).length;
  const label = card.querySelector(".project-head span");
  if (label) label.textContent = taskLabel(count);
}

function addTableEmptyState(body, message) {
  if (body.children.length) return;
  const row = document.createElement("tr");
  const cell = document.createElement("td");
  cell.colSpan = 4;
  cell.className = "empty-state";
  cell.textContent = message;
  row.append(cell);
  body.append(row);
}

function updateEmptyStates() {
  projectNames().forEach((project) => {
    const card = [...board.querySelectorAll(".project-card")].find((item) => item.dataset.project === project);
    const list = card?.querySelector(".project-list");
    if (!list || list.querySelector(".task-chip")) return;
    if (!list.querySelector(".empty-state")) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "Drop tasks here";
      list.append(empty);
    }
  });
  addTableEmptyState(tableBody, "No tasks yet");
  addTableEmptyState(completedTableBody, "No completed tasks");
}

function animateTaskChipRemoval(chip) {
  const height = chip.getBoundingClientRect().height;
  chip.style.height = `${height}px`;
  chip.style.minHeight = `${height}px`;
  chip.style.overflow = "hidden";
  window.requestAnimationFrame(() => {
    chip.classList.add("task-removing");
    chip.style.height = "0px";
    chip.style.minHeight = "0px";
  });
  window.setTimeout(() => chip.remove(), 260);
}

function animateTaskRowRemoval(row) {
  const height = row.getBoundingClientRect().height;
  const placeholder = document.createElement("tr");
  placeholder.className = "task-row-placeholder";
  const cell = document.createElement("td");
  cell.colSpan = row.children.length || 4;
  const spacer = document.createElement("div");
  spacer.className = "task-row-spacer";
  spacer.style.height = `${height}px`;
  cell.append(spacer);
  placeholder.append(cell);
  row.before(placeholder);
  row.classList.add("task-removing");
  window.setTimeout(() => row.remove(), 80);
  window.requestAnimationFrame(() => {
    spacer.style.height = "0px";
  });
  window.setTimeout(() => placeholder.remove(), 260);
}

function animateTaskRemoval(id) {
  document.querySelectorAll(`.task-chip[data-task-id="${id}"]`).forEach(animateTaskChipRemoval);
  document.querySelectorAll(`tr[data-task-id="${id}"]`).forEach(animateTaskRowRemoval);
}

function render() {
  const activeTotal = activeTasks().length;
  const completedTotal = completedTasks().length;
  taskCount.textContent = taskLabel(activeTotal);
  completedCount.textContent = taskLabel(completedTotal);
  reorganizeToggle.classList.toggle("active", reorganizing);
  reorganizeToggle.textContent = "Reorganize";
  renderBoard();
  renderTable();
  renderCompletedTable();
  fillProjectSelect(tableProject, tableProject.value || projects[0]);
  renderProjectOrderModal();
}

projectAdd.addEventListener("submit", async (event) => {
  event.preventDefault();
  const project = newProject.value.trim();
  if (!project) return;
  await addProject(project);
  projectAdd.reset();
});

sortButtons.forEach((button) => {
  button.addEventListener("click", () => {
    sortKey = button.dataset.sort;
    sortButtons.forEach((item) => item.classList.toggle("active", item === button));
    renderTable();
  });
});

tableAdd.addEventListener("click", async () => {
  const name = tableTask.value.trim();
  const project = tableProject.value;
  if (!name || !project) return;
  await addTask({ name, project, dueDate: tableDate.value });
  tableTask.value = "";
  tableDate.value = "";
  tableTask.focus();
});

reorganizeToggle.addEventListener("click", () => {
  reorganizing = true;
  render();
});

reorganizeClose.addEventListener("click", () => {
  reorganizing = false;
  render();
});

reorganizeModal.addEventListener("click", (event) => {
  if (event.target !== reorganizeModal) return;
  reorganizing = false;
  render();
});

projectOrderList.addEventListener("dragover", (event) => {
  event.preventDefault();
  const dragging = projectOrderList.querySelector(".project-order-item.dragging");
  const before = getOrderDropTarget(projectOrderList, event.clientY);
  if (!dragging) return;
  if (before) {
    projectOrderList.insertBefore(dragging, before);
  } else {
    projectOrderList.append(dragging);
  }
});

projectOrderList.addEventListener("drop", async (event) => {
  event.preventDefault();
  const project = event.dataTransfer.getData("application/x-project");
  if (!project) return;
  const before = getOrderDropTarget(projectOrderList, event.clientY);
  await moveProject(project, before?.dataset.project || "");
});

loadTasks();
