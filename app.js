const canvas = document.getElementById("canvas");
const svg = document.getElementById("connections");
const toast = document.getElementById("toast");
let selected = document.querySelector(".word-block.active") || document.querySelector(".root-block");
let zoom = 1;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 1800);
}

function drawConnections() {
  svg.innerHTML = '<defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#b8beb3"></path></marker></defs>';
  const blocks = [...canvas.querySelectorAll(".word-block")].sort((a, b) => a.offsetLeft - b.offsetLeft);
  for (let i = 0; i < blocks.length - 1; i++) {
    const from = blocks[i].getBoundingRect ? blocks[i].getBoundingRect() : blocks[i].getBoundingClientRect();
    const to = blocks[i + 1].getBoundingRect ? blocks[i + 1].getBoundingRect() : blocks[i + 1].getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const x1 = from.right - canvasRect.left;
    const y1 = from.top - canvasRect.top + from.height / 2;
    const x2 = to.left - canvasRect.left;
    const y2 = to.top - canvasRect.top + to.height / 2;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", `M ${x1} ${y1} C ${(x1 + x2) / 2} ${y1}, ${(x1 + x2) / 2} ${y2}, ${x2} ${y2}`);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "#b8beb3");
    path.setAttribute("stroke-width", "1.5");
    path.setAttribute("stroke-dasharray", "5 5");
    path.setAttribute("marker-end", "url(#arrow)");
    svg.appendChild(path);
  }
}

function updatePreview() {
  const parts = [...document.querySelectorAll(".word-select")].map(select => select.value);
  document.getElementById("previewText").textContent = parts.join("");
}

function selectBlock(block) {
  document.querySelectorAll(".word-block").forEach(item => item.classList.remove("active"));
  selected = block;
  block.classList.add("active");
  const kind = block.dataset.kind;
  const title = kind === "prefix" ? "Prefix" : kind === "suffix" ? "Suffix" : "Progression";
  document.getElementById("selectedTitle").textContent = title;
  document.getElementById("blockName").value = title;
  document.getElementById("configPanel").style.display = "block";
}

document.querySelectorAll(".word-block").forEach(block => {
  block.addEventListener("pointerdown", event => {
    if (event.target.closest("select, button")) return;
    selectBlock(block);
    const canvasRect = canvas.getBoundingClientRect();
    const startX = event.clientX;
    const startY = event.clientY;
    const startLeft = block.offsetLeft;
    const startTop = block.offsetTop;
    block.setPointerCapture(event.pointerId);

    function move(moveEvent) {
      const left = Math.max(8, Math.min(canvasRect.width - block.offsetWidth - 8, startLeft + moveEvent.clientX - startX));
      const top = Math.max(8, Math.min(canvasRect.height - block.offsetHeight - 8, startTop + moveEvent.clientY - startY));
      block.style.left = `${left}px`;
      block.style.top = `${top}px`;
      drawConnections();
    }
    function stop() {
      block.removeEventListener("pointermove", move);
      block.removeEventListener("pointerup", stop);
      block.removeEventListener("pointercancel", stop);
    }
    block.addEventListener("pointermove", move);
    block.addEventListener("pointerup", stop);
    block.addEventListener("pointercancel", stop);
  });
});

document.querySelectorAll(".word-select").forEach(select => {
  select.addEventListener("change", updatePreview);
});

document.getElementById("applyButton").addEventListener("click", () => {
  if (selected) {
    const name = document.getElementById("blockName").value.trim();
    if (name) selected.querySelector(".block-head > span:nth-child(2)").textContent = name;
  }
  showToast("Changes saved");
});

document.getElementById("playButton").addEventListener("click", () => showToast("Challenge started"));
document.getElementById("undoButton").addEventListener("click", () => {
  location.reload();
});
document.getElementById("collapsePalette").addEventListener("click", () => {
  const palette = document.querySelector(".palette");
  palette.style.display = palette.style.display === "none" ? "block" : "none";
  document.querySelector(".workspace").style.gridTemplateColumns =
    palette.style.display === "none" ? "0 minmax(420px, 1fr) 270px" : "";
});
document.getElementById("closeConfig").addEventListener("click", () => {
  document.getElementById("configPanel").style.display = "none";
});
document.getElementById("addConnection").addEventListener("click", () => {
  showToast("Drag a block from the palette");
});

document.querySelectorAll(".palette-block").forEach(block => {
  block.addEventListener("dragstart", event => event.dataTransfer.setData("text/plain", block.dataset.kind));
  block.addEventListener("click", () => {
    const kind = block.dataset.kind;
    const existing = canvas.querySelector(`[data-kind="${kind}"]`);
    if (existing) {
      selectBlock(existing);
      showToast(`${kind[0].toUpperCase() + kind.slice(1)} block selected`);
    }
  });
});

canvas.addEventListener("dragover", event => event.preventEvent ? event.preventEvent() : event.preventDefault());
canvas.addEventListener("drop", event => {
  event.preventDefault();
  const kind = event.dataTransfer.getData("text/plain");
  const existing = canvas.querySelector(`[data-kind="${kind}"]`);
  if (existing) selectBlock(existing);
});

document.getElementById("zoomIn").addEventListener("click", () => {
  zoom = Math.min(1.2, zoom + 0.1);
  canvas.style.transform = `scale(${zoom})`;
  document.getElementById("zoomLabel").textContent = `${Math.round(zoom * 100)}%`;
});
document.getElementById("zoomOut").addEventListener("click", () => {
  zoom = Math.max(0.8, zoom - 0.1);
  canvas.style.transform = `scale(${zoom})`;
  document.getElementById("zoomLabel").textContent = `${Math.round(zoom * 100)}%`;
});

window.addEventListener("resize", drawConnections);
selectBlock(selected);
updatePreview();
window.requestAnimationFrame(drawConnections);
