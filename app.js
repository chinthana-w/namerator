const LANGUAGES = [
  ["ar", "Arabic"], ["bn", "Bengali"], ["cs", "Czech"], ["da", "Danish"],
  ["de", "German"], ["el", "Greek"], ["en", "English"], ["es", "Spanish"],
  ["fa", "Persian"], ["fi", "Finnish"], ["fr", "French"], ["he", "Hebrew"],
  ["hi", "Hindi"], ["hu", "Hungarian"], ["id", "Indonesian"], ["it", "Italian"],
  ["ja", "Japanese"], ["ko", "Korean"], ["la", "Latin"], ["nl", "Dutch"],
  ["no", "Norwegian"], ["pl", "Polish"], ["pt", "Portuguese"], ["ro", "Romanian"],
  ["ru", "Russian"], ["sv", "Swedish"], ["th", "Thai"], ["tr", "Turkish"],
  ["uk", "Ukrainian"], ["vi", "Vietnamese"], ["zh", "Chinese"],
];

const canvas = document.getElementById("canvas");
const world = document.getElementById("canvasWorld");
const svg = document.getElementById("connections");
const emptyState = document.getElementById("emptyState");
const contextMenu = document.getElementById("contextMenu");
const wordDialog = document.getElementById("wordDialog");
const toast = document.getElementById("toast");
const nodes = new Map();
const edges = [];
const excludedWords = new Set();
const WORLD_WIDTH = 2400;
const WORLD_HEIGHT = 1800;
let nextId = 1;
let selectedId = null;
let contextNodeId = null;
let pendingJoinId = null;
let pendingAddPoint = null;
let zoom = 1;
let panX = 0;
let panY = 0;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 2800);
}

function normalizedWord(word) {
  return word.trim().toLocaleLowerCase().replace(/\s+/g, " ");
}

function languageName(code) {
  const language = LANGUAGES.find(item => item[0] === code);
  return language ? language[1] : code;
}

function createLanguageOptions(select, selectedCode) {
  LANGUAGES.forEach(([code, name]) => {
    const option = document.createElement("option");
    option.value = code;
    option.textContent = name;
    option.selected = code === selectedCode;
    select.appendChild(option);
  });
}

function initializeLanguageControls() {
  const languageSelect = document.getElementById("newWordLanguage");
  createLanguageOptions(languageSelect, "en");

  document.querySelectorAll(".language-list").forEach(list => {
    const group = list.dataset.languageGroup;
    LANGUAGES.forEach(([code, name]) => {
      const label = document.createElement("label");
      label.className = "language-option";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.value = code;
      checkbox.dataset.preferenceGroup = group;
      const text = document.createElement("span");
      text.textContent = name;
      label.append(checkbox, text);
      list.appendChild(label);
    });
  });
  updateLanguageSummaries();
}

function selectedLanguages(group) {
  return [...document.querySelectorAll(`input[data-preference-group="${group}"]:checked`)]
    .map(input => input.value);
}

function updateLanguageSummaries() {
  const preferred = selectedLanguages("preferred");
  const avoided = selectedLanguages("avoided");
  document.getElementById("preferredSummary").textContent =
    preferred.length ? preferred.map(languageName).join(", ") : "Any language";
  document.getElementById("avoidedSummary").textContent =
    avoided.length ? avoided.map(languageName).join(", ") : "None";
}

function pointFromClient(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left - panX) / zoom,
    y: (clientY - rect.top - panY) / zoom,
  };
}

function clampPosition(point, nodeId) {
  const node = nodes.get(nodeId);
  const width = node && node.element ? node.element.offsetWidth : 212;
  const height = node && node.element ? node.element.offsetHeight : 126;
  const maxX = WORLD_WIDTH - width - 12;
  const maxY = WORLD_HEIGHT - height - 12;
  return {
    x: Math.max(12, Math.min(maxX, point.x)),
    y: Math.max(12, Math.min(maxY, point.y)),
  };
}

function defaultAddPoint() {
  const offset = (nodes.size % 5) * 28;
  return {
    x: WORLD_WIDTH / 2 - 106 + offset,
    y: WORLD_HEIGHT / 2 - 65 + offset,
  };
}

function setWorldTransform() {
  const minX = Math.min(0, canvas.clientWidth - WORLD_WIDTH * zoom);
  const minY = Math.min(0, canvas.clientHeight - WORLD_HEIGHT * zoom);
  panX = Math.max(minX, Math.min(0, panX));
  panY = Math.max(minY, Math.min(0, panY));
  world.style.transform = `translate(${panX}px, ${panY}px) scale(${zoom})`;
  drawConnections();
}

function centerWorld() {
  panX = (canvas.clientWidth - WORLD_WIDTH * zoom) / 2;
  panY = (canvas.clientHeight - WORLD_HEIGHT * zoom) / 2;
  setWorldTransform();
}

function makeElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function renderWordNode(node) {
  const element = makeElement("article", "word-node");
  element.dataset.id = node.id;
  element.dataset.kind = node.kind;
  element.style.left = `${node.x}px`;
  element.style.top = `${node.y}px`;

  const header = makeElement("div", "node-header");
  const language = makeElement("select", "node-language");
  language.setAttribute("aria-label", "Word language");
  createLanguageOptions(language, node.language);
  language.addEventListener("change", () => {
    node.language = language.value;
    drawConnections();
  });
  const menuButton = makeElement("button", "node-menu", "•••");
  menuButton.type = "button";
  menuButton.setAttribute("aria-label", `Options for ${node.word}`);
  menuButton.addEventListener("click", event => {
    event.stopPropagation();
    showContextMenu(event, node.id);
  });
  header.append(language, menuButton);

  const relation = makeElement("div", "node-relation", node.relation || "");
  relation.hidden = !node.relation;
  const wordInput = makeElement("input", "node-word");
  wordInput.type = "text";
  wordInput.maxLength = 100;
  wordInput.value = node.word;
  wordInput.setAttribute("aria-label", "Editable word");
  wordInput.addEventListener("input", () => {
    const value = wordInput.value.trim();
    if (value) {
      node.word = value;
      menuButton.setAttribute("aria-label", `Options for ${node.word}`);
    }
  });
  wordInput.addEventListener("keydown", event => {
    if (event.key === "Enter") wordInput.blur();
  });
  wordInput.addEventListener("blur", () => {
    wordInput.value = node.word;
  });

  const description = makeElement("p", "node-description", node.description || "");
  const sourceList = makeElement("div", "node-source-list");
  (node.sources || []).forEach(source => {
    const sourceLink = makeElement("a", "node-details-link", `${source.name} · ${source.license}`);
    sourceLink.href = source.url;
    sourceLink.target = "_blank";
    sourceLink.rel = "noreferrer";
    sourceList.appendChild(sourceLink);
  });
  const detailContainer = makeElement("div");
  detailContainer.append(description, sourceList);
  element.append(header, relation, wordInput, detailContainer);
  node.element = element;
  world.appendChild(element);
  updateSelection();
}

function renderJoinNode(node) {
  const element = makeElement("article", "word-node junction");
  element.dataset.id = node.id;
  element.dataset.kind = node.kind;
  element.style.left = `${node.x}px`;
  element.style.top = `${node.y}px`;
  const header = makeElement("div", "node-header");
  const language = makeElement("span", "node-language", "Shared meaning");
  const menuButton = makeElement("button", "node-menu", "•••");
  menuButton.type = "button";
  menuButton.setAttribute("aria-label", "Options for shared-word node");
  menuButton.addEventListener("click", event => {
    event.stopPropagation();
    showContextMenu(event, node.id);
  });
  header.append(language, menuButton);
  const title = makeElement("div", "junction-title", "Together");
  const caption = makeElement("p", "junction-caption", "Explore all linked words");
  element.append(header, title, caption);
  node.element = element;
  world.appendChild(element);
  updateSelection();
}

function updateSelection() {
  nodes.forEach(node => {
    if (node.element) node.element.classList.toggle("selected", node.id === selectedId);
  });
}

function selectNode(id) {
  selectedId = id;
  updateSelection();
}

function updateEmptyState() {
  emptyState.hidden = nodes.size > 0;
}

function drawConnections() {
  svg.setAttribute("viewBox", `0 0 ${WORLD_WIDTH} ${WORLD_HEIGHT}`);
  svg.replaceChildren();
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  const marker = document.createElementNS("http://www.w3.org/2000/svg", "marker");
  marker.setAttribute("id", "arrow");
  marker.setAttribute("markerWidth", "8");
  marker.setAttribute("markerHeight", "8");
  marker.setAttribute("refX", "7");
  marker.setAttribute("refY", "4");
  marker.setAttribute("orient", "auto");
  const arrowPath = document.createElementNS("http://www.w3.org/2000/svg", "path");
  arrowPath.setAttribute("d", "M0,0 L8,4 L0,8 z");
  marker.appendChild(arrowPath);
  defs.appendChild(marker);
  svg.appendChild(defs);

  edges.forEach(edge => {
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    if (!from || !to || !from.element || !to.element) return;
    const x1 = from.x + from.element.offsetWidth / 2;
    const y1 = from.y + from.element.offsetHeight / 2;
    const x2 = to.x + to.element.offsetWidth / 2;
    const y2 = to.y + to.element.offsetHeight / 2;
    const bend = Math.max(45, Math.abs(x2 - x1) * 0.4);
    const direction = x2 >= x1 ? 1 : -1;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", `M ${x1} ${y1} C ${x1 + bend * direction} ${y1}, ${x2 - bend * direction} ${y2}, ${x2} ${y2}`);
    path.setAttribute("marker-end", "url(#arrow)");
    svg.appendChild(path);
  });
}

function createWordNode(word, language, point, details) {
  const normalized = normalizedWord(word);
  const existing = [...nodes.values()].find(node =>
    node.kind === "word" && normalizedWord(node.word) === normalized && node.language === language
  );
  if (existing) {
    selectNode(existing.id);
    showToast("That word is already on the canvas.");
    return existing;
  }
  const id = `word-${nextId++}`;
  const node = {
    id,
    kind: "word",
    word: word.trim(),
    language,
    x: point.x,
    y: point.y,
    description: details ? [details.definition, details.etymology].filter(Boolean).join("\n") : "",
    sources: details ? details.sources || (details.sourceUrl ? [{
      name: details.source || "Wiktionary",
      url: details.sourceUrl,
      license: details.license || "CC BY-SA 4.0 / GFDL",
    }] : []) : [],
  };
  const position = clampPosition(point, id);
  node.x = position.x;
  node.y = position.y;
  nodes.set(id, node);
  renderWordNode(node);
  updateEmptyState();
  drawConnections();
  return node;
}

function openAddDialog(point) {
  pendingAddPoint = point || null;
  document.getElementById("wordInput").value = "";
  document.getElementById("newWordLanguage").value = "en";
  contextMenu.hidden = true;
  wordDialog.showModal();
  document.getElementById("wordInput").focus();
}

function showContextMenu(event, nodeId) {
  contextNodeId = nodeId;
  const isNodeMenu = Boolean(nodeId);
  contextMenu.querySelectorAll("[data-action]").forEach(button => {
    button.hidden = isNodeMenu ? button.dataset.action === "add" : button.dataset.action !== "add";
  });
  const x = Math.min(event.clientX, window.innerWidth - 185);
  const y = Math.min(event.clientY, window.innerHeight - 215);
  contextMenu.style.left = `${Math.max(6, x)}px`;
  contextMenu.style.top = `${Math.max(6, y)}px`;
  contextMenu.hidden = false;
}

function closeContextMenu() {
  contextMenu.hidden = true;
  contextNodeId = null;
}

function wordIdsForNode(id) {
  const node = nodes.get(id);
  if (!node) return [];
  return node.kind === "word" ? [node.id] : [...node.wordIds];
}

function completeJoin(firstId, secondId) {
  const first = nodes.get(firstId);
  const second = nodes.get(secondId);
  if (!first || !second || firstId === secondId) return;
  const wordIds = [...new Set([...wordIdsForNode(firstId), ...wordIdsForNode(secondId)])];
  if (wordIds.length < 2) {
    showToast("Join two different word blocks.");
    return;
  }
  const x = (first.x + second.x) / 2 + 105;
  const y = (first.y + second.y) / 2 + 18;
  const id = `join-${nextId++}`;
  const node = {
    id,
    kind: "junction",
    sourceIds: [firstId, secondId],
    wordIds,
    x,
    y,
    element: null,
  };
  const position = clampPosition({ x, y }, id);
  node.x = position.x;
  node.y = position.y;
  nodes.set(id, node);
  renderJoinNode(node);
  node.sourceIds.forEach(sourceId => edges.push({ from: sourceId, to: id }));
  pendingJoinId = null;
  selectNode(id);
  updateEmptyState();
  drawConnections();
  showToast("Shared node created. Explore it to find words related to both.");
}

function removeNode(id) {
  const node = nodes.get(id);
  if (!node) return;
  const removedIds = new Set([id]);
  let changed = true;
  while (changed) {
    changed = false;
    nodes.forEach(candidate => {
      if (candidate.kind === "junction" &&
        candidate.sourceIds.some(sourceId => removedIds.has(sourceId)) &&
        !removedIds.has(candidate.id)) {
        removedIds.add(candidate.id);
        changed = true;
      }
    });
  }
  removedIds.forEach(removedId => {
    const removed = nodes.get(removedId);
    if (removed && removed.kind === "word") excludedWords.add(normalizedWord(removed.word));
    if (removed && removed.element) removed.element.remove();
    nodes.delete(removedId);
  });
  for (let index = edges.length - 1; index >= 0; index--) {
    if (removedIds.has(edges[index].from) || removedIds.has(edges[index].to)) edges.splice(index, 1);
  }
  if (removedIds.has(selectedId)) selectedId = null;
  if (removedIds.has(pendingJoinId)) pendingJoinId = null;
  updateSelection();
  updateEmptyState();
  drawConnections();
  showToast(node.kind === "word"
    ? `“${node.word}” removed and excluded for this page session.`
    : "Shared node removed.");
}

function sourceWords(node) {
  return node.kind === "word"
    ? [{ word: node.word, language: node.language }]
    : node.wordIds
      .map(id => nodes.get(id))
      .filter(source => source && source.kind === "word")
      .map(source => ({ word: source.word, language: source.language }));
}

async function requestApi(path, payload) {
  let response;
  try {
    response = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    throw new Error("Could not reach the local word generator. Start the app with npm start.");
  }
  let responseText;
  try {
    responseText = await response.text();
  } catch (error) {
    throw new Error("Could not read the local word generator response.");
  }
  let data;
  try {
    data = JSON.parse(responseText);
  } catch (error) {
    if (!response.ok) {
      throw new Error(
        `The local server returned an unexpected page (HTTP ${response.status}). Stop the old server and restart the app with npm start.`
      );
    }
    throw new Error("The local word generator returned a non-JSON response. Restart the app with npm start.");
  }
  if (!response.ok) {
    throw new Error(data.message || data.error || `Word generator failed (${response.status}).`);
  }
  return data;
}

async function exploreNode(id) {
  const node = nodes.get(id);
  if (!node) return;
  const words = sourceWords(node);
  if (!words.length) {
    showToast("This shared node no longer has linked words.");
    return;
  }
  const countInput = document.getElementById("resultCount");
  const count = Math.max(1, Math.min(12, Number.parseInt(countInput.value, 10) || 5));
  countInput.value = String(count);
  selectNode(id);
  closeContextMenu();
  showToast("Finding connected words…");
  try {
    const data = await requestApi("/api/explore", {
      words,
      count,
      mode: document.getElementById("exploreMode").value,
      preferredLanguages: selectedLanguages("preferred"),
      avoidedLanguages: selectedLanguages("avoided"),
      exclude: [...excludedWords],
    });
    const origin = nodes.get(id);
    if (!origin) return;
    const results = data.results || [];
    results.forEach((result, index) => {
      const row = index % 4;
      const column = Math.floor(index / 4);
      const point = {
        x: origin.x + 250 + column * 232,
        y: origin.y + (row - (Math.min(results.length, 4) - 1) / 2) * 150,
      };
      const added = createWordNode(result.word, result.language, point, {
        sources: result.sources || [],
        relation: (result.relations || []).join(" · "),
      });
      if (added && added.id !== origin.id && !edges.some(edge => edge.from === id && edge.to === added.id)) {
        edges.push({ from: id, to: added.id });
      }
    });
    drawConnections();
    updateEmptyState();
    if (!results.length) {
      showToast(data.warnings && data.warnings.length
        ? data.warnings.map(item => `${item.provider}: ${item.message}`).join(" ")
        : "No matches found. Try another word or exploration mode.");
    } else if (data.warnings && data.warnings.length) {
      showToast(`Added ${results.length} words. ${data.warnings.map(item =>
        `${item.provider}: ${item.message}`
      ).join(" ")}`);
    } else {
      showToast(`Added ${results.length} connected ${results.length === 1 ? "word" : "words"}.`);
    }
  } catch (error) {
    showToast(error.message);
  }
}

async function describeNode(id) {
  const node = nodes.get(id);
  if (!node || node.kind !== "word") {
    showToast("Describe is available for individual word blocks.");
    return;
  }
  closeContextMenu();
  showToast(`Looking up “${node.word}”…`);
  try {
    const details = await requestApi("/api/describe", { word: node.word, language: node.language });
    const description = [details.definition, details.etymology].filter(Boolean).join("\n");
    node.description = description || "No meaning or etymology details are available for this entry.";
    node.sources = details.sources || [];
    node.element.remove();
    renderWordNode(node);
    drawConnections();
    showToast("Description added from Wiktionary.");
  } catch (error) {
    showToast(error.message);
  }
}

function startJoin(id) {
  if (!nodes.has(id)) return;
  pendingJoinId = id;
  closeContextMenu();
  showToast("Click another block to create a shared node. Press Escape to cancel.");
}

initializeLanguageControls();

document.getElementById("addWordButton").addEventListener("click", () => openAddDialog(null));
document.getElementById("emptyAddWordButton").addEventListener("click", () => openAddDialog(null));
document.getElementById("wordForm").addEventListener("submit", event => {
  event.preventDefault();
  const word = document.getElementById("wordInput").value.trim();
  const language = document.getElementById("newWordLanguage").value;
  if (!word) return;
  const node = createWordNode(word, language, pendingAddPoint || defaultAddPoint());
  if (node) selectNode(node.id);
  pendingAddPoint = null;
  wordDialog.close();
});
document.getElementById("cancelDialog").addEventListener("click", () => wordDialog.close());
document.getElementById("closeDialog").addEventListener("click", () => wordDialog.close());

canvas.addEventListener("contextmenu", event => {
  event.preventDefault();
  const node = event.target.closest(".word-node");
  pendingAddPoint = node ? null : pointFromClient(event.clientX, event.clientY);
  showContextMenu(event, node ? node.dataset.id : null);
});

canvas.addEventListener("click", event => {
  const element = event.target.closest(".word-node");
  if (!element || event.target.closest("button, input, select")) return;
  const id = element.dataset.id;
  if (pendingJoinId) {
    completeJoin(pendingJoinId, id);
    return;
  }
  selectNode(id);
});

canvas.addEventListener("pointerdown", event => {
  const element = event.target.closest(".word-node");
  if (!element) {
    if (event.button !== 0 || event.target.closest("button, input, select")) return;
    const startX = event.clientX;
    const startY = event.clientY;
    const initialX = panX;
    const initialY = panY;
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add("is-panning");
    const move = moveEvent => {
      panX = initialX + moveEvent.clientX - startX;
      panY = initialY + moveEvent.clientY - startY;
      setWorldTransform();
    };
    const stop = () => {
      canvas.classList.remove("is-panning");
      canvas.removeEventListener("pointermove", move);
      canvas.removeEventListener("pointerup", stop);
      canvas.removeEventListener("pointercancel", stop);
    };
    canvas.addEventListener("pointermove", move);
    canvas.addEventListener("pointerup", stop);
    canvas.addEventListener("pointercancel", stop);
    return;
  }
  if (event.target.closest("button, input, select")) return;
  const node = nodes.get(element.dataset.id);
  if (!node) return;
  selectNode(node.id);
  const startX = event.clientX;
  const startY = event.clientY;
  const startLeft = node.x;
  const startTop = node.y;
  element.setPointerCapture(event.pointerId);
  element.style.cursor = "grabbing";
  const move = moveEvent => {
    const point = clampPosition({
      x: startLeft + (moveEvent.clientX - startX) / zoom,
      y: startTop + (moveEvent.clientY - startY) / zoom,
    }, node.id);
    node.x = point.x;
    node.y = point.y;
    element.style.left = `${node.x}px`;
    element.style.top = `${node.y}px`;
    drawConnections();
  };
  const stop = () => {
    element.style.cursor = "";
    element.removeEventListener("pointermove", move);
    element.removeEventListener("pointerup", stop);
    element.removeEventListener("pointercancel", stop);
  };
  element.addEventListener("pointermove", move);
  element.addEventListener("pointerup", stop);
  element.addEventListener("pointercancel", stop);
});

contextMenu.addEventListener("click", event => {
  const button = event.target.closest("[data-action]");
  if (!button) return;
  const action = button.dataset.action;
  const nodeId = contextNodeId;
  const point = pendingAddPoint;
  closeContextMenu();
  if (action === "add") {
    openAddDialog(point);
  } else if (action === "explore") {
    exploreNode(nodeId);
  } else if (action === "describe") {
    describeNode(nodeId);
  } else if (action === "join") {
    startJoin(nodeId);
  } else if (action === "remove") {
    removeNode(nodeId);
  }
});

document.addEventListener("click", event => {
  if (!event.target.closest("#contextMenu, .word-node")) closeContextMenu();
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    closeContextMenu();
    if (pendingJoinId) {
      pendingJoinId = null;
      showToast("Join cancelled.");
    }
  }
  if ((event.key === "Delete" || event.key === "Backspace") &&
    selectedId && !event.target.closest("input, textarea, select, [contenteditable=true]")) {
    removeNode(selectedId);
  }
});
document.querySelectorAll("input[data-preference-group]").forEach(input => {
  input.addEventListener("change", () => {
    if (input.checked) {
      const otherGroup = input.dataset.preferenceGroup === "preferred" ? "avoided" : "preferred";
      const opposite = document.querySelector(
        `input[data-preference-group="${otherGroup}"][value="${input.value}"]`
      );
      if (opposite) opposite.checked = false;
    }
    updateLanguageSummaries();
  });
});

document.getElementById("zoomIn").addEventListener("click", () => {
  const centerX = canvas.clientWidth / 2;
  const centerY = canvas.clientHeight / 2;
  const worldX = (centerX - panX) / zoom;
  const worldY = (centerY - panY) / zoom;
  zoom = Math.min(1.5, Math.round((zoom + 0.1) * 10) / 10);
  panX = centerX - worldX * zoom;
  panY = centerY - worldY * zoom;
  document.getElementById("zoomLabel").textContent = `${Math.round(zoom * 100)}%`;
  setWorldTransform();
});
document.getElementById("zoomOut").addEventListener("click", () => {
  const centerX = canvas.clientWidth / 2;
  const centerY = canvas.clientHeight / 2;
  const worldX = (centerX - panX) / zoom;
  const worldY = (centerY - panY) / zoom;
  zoom = Math.max(0.7, Math.round((zoom - 0.1) * 10) / 10);
  panX = centerX - worldX * zoom;
  panY = centerY - worldY * zoom;
  document.getElementById("zoomLabel").textContent = `${Math.round(zoom * 100)}%`;
  setWorldTransform();
});

document.getElementById("resetButton").addEventListener("click", () => {
  if (!nodes.size) {
    showToast("The canvas is already clear.");
    return;
  }
  if (!window.confirm("Clear all word blocks from this canvas? Removed-word exclusions will remain for this page session.")) return;
  nodes.forEach(node => node.element.remove());
  nodes.clear();
  edges.splice(0, edges.length);
  selectedId = null;
  pendingJoinId = null;
  updateEmptyState();
  drawConnections();
  showToast("Canvas cleared.");
});
document.getElementById("helpButton").addEventListener("click", () => {
  showToast("Right-click to add or open a block menu. Drag blocks to arrange them; use Join to explore shared words.");
});

window.addEventListener("resize", () => {
  if (!nodes.size) centerWorld();
  else setWorldTransform();
});
window.requestAnimationFrame(() => {
  world.style.width = `${WORLD_WIDTH}px`;
  world.style.height = `${WORLD_HEIGHT}px`;
  svg.style.width = `${WORLD_WIDTH}px`;
  svg.style.height = `${WORLD_HEIGHT}px`;
  centerWorld();
});
