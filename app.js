"use strict";

/* -----------------------------------------------------------
   GLOBALS
----------------------------------------------------------- */

const canvas = document.getElementById("survey-canvas");
const ctx = canvas.getContext("2d");

let pdfDoc = null;
let pdfPage = null;
let pdfScale = 1;

let scaleFactor = 1;      // pixels per foot
let scaleIsSet = false;

const POLYGON_COLORS = {
  site: "#0070c0",
  building: "#c00000",
  driveway: "#808080",
  patio: "#c09040",
  impervious: "#aa5500",
  pervious: "#00a000"
};

let polygons = [];
let activePolygonId = null;

let isPickingScale = false;
let scalePoints = [];

let draggingPolygon = null;
let draggingVertexIndex = -1;
let dragStart = { x: 0, y: 0 };
let originalOrigin = null;
let originalPoint = null;

const rotationInput = document.getElementById("rotation-input");
const rotationValueSpan = document.getElementById("rotation-value");

/* -----------------------------------------------------------
   RESIZE CANVAS
----------------------------------------------------------- */

function resizeCanvas() {
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;
  setupPdfViewport();
  render();
}

window.addEventListener("resize", resizeCanvas);
resizeCanvas();

/* -----------------------------------------------------------
   PDF LOADING
----------------------------------------------------------- */

const pdfFileInput = document.getElementById("pdf-file-input");

pdfFileInput.addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async function () {
    try {
      const typedArray = new Uint8Array(this.result);
      pdfDoc = await pdfjsLib.getDocument({ data: typedArray }).promise;
      pdfPage = await pdfDoc.getPage(1);
      setupPdfViewport();
      render();
    } catch (err) {
      console.error("Error loading PDF:", err);
      alert("There was an error loading the PDF.");
    }
  };
  reader.readAsArrayBuffer(file);
});

function setupPdfViewport() {
  if (!pdfPage) return;
  if (canvas.width === 0 || canvas.height === 0) return;

  const unscaled = pdfPage.getViewport({ scale: 1 });
  const pdfWidth = unscaled.width;
  const pdfHeight = unscaled.height;

  pdfScale = Math.min(canvas.width / pdfWidth, canvas.height / pdfHeight);
}

async function drawPDF() {
  if (!pdfPage) return;
  const viewport = pdfPage.getViewport({ scale: pdfScale });
  await pdfPage.render({ canvasContext: ctx, viewport }).promise;
}

/* -----------------------------------------------------------
   SCALE PICKING
----------------------------------------------------------- */

const startScaleBtn = document.getElementById("start-scale-btn");
const scaleDisplay = document.getElementById("scale-display");

startScaleBtn.addEventListener("click", () => {
  isPickingScale = true;
  scalePoints = [];
  scaleDisplay.textContent = "picking...";
});

canvas.addEventListener("click", (e) => {
  if (!isPickingScale) return;

  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;

  scalePoints.push({ x, y });

  if (scalePoints.length === 1) {
    render();
    return;
  }

  if (scalePoints.length === 2) {
    const dx = scalePoints[1].x - scalePoints[0].x;
    const dy = scalePoints[1].y - scalePoints[0].y;
    const pixelDist = Math.sqrt(dx * dx + dy * dy);

    const input = prompt("Enter real-world distance between points (ft):", "20");
    const realDist = parseFloat(input);

    if (!isNaN(realDist) && realDist > 0) {
      scaleFactor = pixelDist / realDist;
      scaleIsSet = true;
      scaleDisplay.textContent = scaleFactor.toFixed(2) + " px/ft";
    } else {
      alert("Invalid distance.");
      scaleIsSet = false;
      scaleDisplay.textContent = "not set";
    }

    isPickingScale = false;
    scalePoints = [];
    render();
  }
});

/* -----------------------------------------------------------
   POLYGON MODEL & CREATION
----------------------------------------------------------- */

function createPolygon(type, lengthFeet, widthFeet, rotationDegrees) {
  const origin = {
    x: canvas.width * 0.5,
    y: canvas.height * 0.5
  };

  const len = Number.isFinite(lengthFeet) && lengthFeet > 0 ? lengthFeet : 20;
  const wid = Number.isFinite(widthFeet) && widthFeet > 0 ? widthFeet : 12;
  const rot = Number.isFinite(rotationDegrees) ? rotationDegrees : 0;

  return {
    id: "poly_" + Date.now() + "_" + Math.floor(Math.random() * 1000000),
    type,
    origin,
    rotation: rot,
    color: POLYGON_COLORS[type] || "#000000",
    points: [
      { x: 0, y: 0 },
      { x: len, y: 0 },
      { x: len, y: wid },
      { x: 0, y: wid }
    ]
  };
}

function setActivePolygon(poly) {
  if (!poly) {
    activePolygonId = null;
    rotationInput.disabled = true;
    rotationInput.value = 0;
    rotationValueSpan.textContent = "0°";
    return;
  }

  activePolygonId = poly.id;
  rotationInput.disabled = false;
  rotationInput.value = poly.rotation;
  rotationValueSpan.textContent = poly.rotation + "°";
}

/* -----------------------------------------------------------
   POLYGON UI HOOKS
----------------------------------------------------------- */

const polygonTypeSelect = document.getElementById("polygon-type-select");
const lengthInput = document.getElementById("length-input");
const widthInput = document.getElementById("width-input");
const addPolygonBtn = document.getElementById("add-polygon-btn");
const deleteActivePolygonBtn = document.getElementById("delete-active-polygon-btn");

addPolygonBtn.addEventListener("click", () => {
  const type = polygonTypeSelect.value || "building";
  const lengthFeet = parseFloat(lengthInput.value);
  const widthFeet = parseFloat(widthInput.value);
  const rotation = parseFloat(rotationInput.value) || 0;

  const poly = createPolygon(type, lengthFeet, widthFeet, rotation);
  polygons.push(poly);
  setActivePolygon(poly);
  render();
});

deleteActivePolygonBtn.addEventListener("click", () => {
  if (!activePolygonId) return;
  polygons = polygons.filter(p => p.id !== activePolygonId);
  setActivePolygon(null);
  render();
});

rotationInput.addEventListener("input", () => {
  const val = parseFloat(rotationInput.value) || 0;
  rotationValueSpan.textContent = val + "°";
  const active = polygons.find(p => p.id === activePolygonId);
  if (active) {
    active.rotation = val;
    render();
  }
});

/* -----------------------------------------------------------
   GEOMETRY HELPERS
----------------------------------------------------------- */

function polygonAreaFeet(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    sum += points[i].x * points[j].y - points[j].x * points[i].y;
  }
  return Math.abs(sum) / 2;
}

function polygonBounds(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

/* -----------------------------------------------------------
   DRAWING BASICS (polygons only, used by later parts too)
----------------------------------------------------------- */

function drawPolygonShape(ctx, polygon, scale) {
  const { origin, rotation, points, color, id } = polygon;

  ctx.save();
  ctx.translate(origin.x, origin.y);
  ctx.rotate((rotation * Math.PI) / 180);

  ctx.beginPath();
  ctx.moveTo(points[0].x * scale, points[0].y * scale);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x * scale, points[i].y * scale);
  }
  ctx.closePath();

  ctx.strokeStyle = color;
  ctx.lineWidth = id === activePolygonId ? 3 : 2;
  ctx.stroke();

  ctx.restore();
}

function drawPolygonHandles(ctx, polygon, scale) {
  const { origin, rotation, points, id } = polygon;

  ctx.save();
  ctx.translate(origin.x, origin.y);
  ctx.rotate((rotation * Math.PI) / 180);

  ctx.fillStyle = id === activePolygonId ? "#ffffcc" : "white";
  ctx.strokeStyle = "black";
  ctx.lineWidth = 1.5;

  for (const p of points) {
    const px = p.x * scale;
    const py = p.y * scale;
    ctx.beginPath();
    ctx.arc(px, py, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}

/* -----------------------------------------------------------
   STUB RENDER (will be completed in Part 3)
----------------------------------------------------------- */

function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!pdfPage) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  const scale = scaleIsSet ? scaleFactor : 1;

  for (const poly of polygons) {
    drawPolygonShape(ctx, poly, scale);
    drawPolygonHandles(ctx, poly, scale);
  }
}



/* -----------------------------------------------------------
   HIT TESTING
----------------------------------------------------------- */

function hitTestPolygon(poly, mx, my) {
  const { origin, rotation, points } = poly;

  const dx = mx - origin.x;
  const dy = my - origin.y;
  const angle = -rotation * Math.PI / 180;

  const rx = dx * Math.cos(angle) - dy * Math.sin(angle);
  const ry = dx * Math.sin(angle) + dy * Math.cos(angle);

  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].x * scaleFactor;
    const yi = points[i].y * scaleFactor;
    const xj = points[j].x * scaleFactor;
    const yj = points[j].y * scaleFactor;

    const intersect =
      yi > ry !== yj > ry &&
      rx < ((xj - xi) * (ry - yi)) / (yj - yi) + xi;

    if (intersect) inside = !inside;
  }
  return inside;
}

function hitTestVertex(poly, mx, my) {
  const { origin, rotation, points } = poly;

  const dx = mx - origin.x;
  const dy = my - origin.y;
  const angle = -rotation * Math.PI / 180;

  const rx = dx * Math.cos(angle) - dy * Math.sin(angle);
  const ry = dx * Math.sin(angle) + dy * Math.cos(angle);

  for (let i = 0; i < points.length; i++) {
    const px = points[i].x * scaleFactor;
    const py = points[i].y * scaleFactor;
    const dist = Math.sqrt((rx - px) ** 2 + (ry - py) ** 2);
    if (dist < 10) return i;
  }
  return -1;
}

/* -----------------------------------------------------------
   MOUSE INTERACTION
----------------------------------------------------------- */

canvas.addEventListener("mousedown", (e) => {
  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  for (let i = polygons.length - 1; i >= 0; i--) {
    const poly = polygons[i];
    const hit = hitTestPolygon(poly, mx, my);

    if (hit) {
      setActivePolygon(poly);

      const vertexIndex = hitTestVertex(poly, mx, my);
      if (vertexIndex >= 0) {
        draggingPolygon = poly;
        draggingVertexIndex = vertexIndex;
        originalPoint = { ...poly.points[vertexIndex] };
        return;
      }

      draggingPolygon = poly;
      draggingVertexIndex = -1;
      dragStart = { x: mx, y: my };
      originalOrigin = { ...poly.origin };
      return;
    }
  }

  setActivePolygon(null);
  render();
});

canvas.addEventListener("mousemove", (e) => {
  if (!draggingPolygon) return;

  const rect = canvas.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  if (draggingVertexIndex >= 0) {
    const poly = draggingPolygon;
    const dx = (mx - poly.origin.x) / scaleFactor;
    const dy = (my - poly.origin.y) / scaleFactor;

    poly.points[draggingVertexIndex] = { x: dx, y: dy };
  } else {
    const dx = mx - dragStart.x;
    const dy = my - dragStart.y;
    draggingPolygon.origin = {
      x: originalOrigin.x + dx,
      y: originalOrigin.y + dy
    };
  }

  render();
});

canvas.addEventListener("mouseup", () => {
  draggingPolygon = null;
  draggingVertexIndex = -1;
});

/* -----------------------------------------------------------
   DIMENSION STRINGS
----------------------------------------------------------- */

function drawDimensionStrings(ctx, polygon, scale) {
  const { origin, rotation, points } = polygon;

  ctx.save();
  ctx.translate(origin.x, origin.y);
  ctx.rotate(rotation * Math.PI / 180);

  ctx.strokeStyle = "black";
  ctx.fillStyle = "black";
  ctx.lineWidth = 1;
  ctx.font = "12px sans-serif";

  function drawDim(p1, p2) {
    const dx = (p2.x - p1.x) * scale;
    const dy = (p2.y - p1.y) * scale;
    const lengthFeet = Math.sqrt(dx * dx + dy * dy) / scaleFactor;
    const label = Math.round(lengthFeet) + " ft";

    const mx = (p1.x + p2.x) * 0.5 * scale;
    const my = (p1.y + p2.y) * 0.5 * scale;

    ctx.save();
    ctx.translate(mx, my);
    ctx.rotate(0);
    ctx.fillText(label, 0, -4);
    ctx.restore();
  }

  for (let i = 0; i < points.length; i++) {
    const j = (i + 1) % points.length;
    drawDim(points[i], points[j]);
  }

  ctx.restore();
}

/* -----------------------------------------------------------
   SQUARE FOOTAGE LABELS
----------------------------------------------------------- */

function drawSquareFootageNote(ctx, polygon, scale) {
  const { origin, rotation, points } = polygon;

  const areaFeet = polygonAreaFeet(points);
  const sqft = Math.round(areaFeet);

  const bounds = polygonBounds(points);
  const pxW = (bounds.maxX - bounds.minX) * scale;
  const pxH = (bounds.maxY - bounds.minY) * scale;

  const fitsInside = pxW > 80 && pxH > 80;

  ctx.save();
  ctx.translate(origin.x, origin.y);
  ctx.rotate(rotation * Math.PI / 180);

  ctx.fillStyle = "black";
  ctx.font = "14px sans-serif";
  ctx.textAlign = "center";

  if (fitsInside) {
    const cx = (bounds.minX + bounds.maxX) * 0.5 * scale;
    const cy = (bounds.minY + bounds.maxY) * 0.5 * scale;
    ctx.fillText(sqft + " SF", cx, cy);
  } else {
    ctx.fillText(sqft + " SF", 0, -10);
  }

  ctx.restore();
}

/* -----------------------------------------------------------
   IMPERVIOUS SUMMARY
----------------------------------------------------------- */

const maxImperviousInput = document.getElementById("max-impervious-input");
const siteAreaDisplay = document.getElementById("site-area-display");
const impAreaDisplay = document.getElementById("impervious-area-display");
const impPercentDisplay = document.getElementById("impervious-percent-display");
const impStatusDisplay = document.getElementById("impervious-status");

const expSiteArea = document.getElementById("exp-site-area");
const expImpArea = document.getElementById("exp-imp-area");
const expImpPercent = document.getElementById("exp-imp-percent");
const expStatus = document.getElementById("exp-status");

function updateImperviousSummary() {
  let siteArea = 0;
  let imperviousArea = 0;

  for (const poly of polygons) {
    const area = polygonAreaFeet(poly.points);

    if (poly.type === "site") siteArea += area;

    if (["building", "driveway", "patio", "impervious"].includes(poly.type)) {
      imperviousArea += area;
    }
  }

  const percent = siteArea > 0 ? (imperviousArea / siteArea) * 100 : 0;
  const maxAllowed = parseFloat(maxImperviousInput.value) || 40;

  siteAreaDisplay.textContent = Math.round(siteArea);
  impAreaDisplay.textContent = Math.round(imperviousArea);
  impPercentDisplay.textContent = percent.toFixed(1) + "%";
  impStatusDisplay.textContent = percent <= maxAllowed ? "OK" : "Exceeds";

  expSiteArea.textContent = Math.round(siteArea);
  expImpArea.textContent = Math.round(imperviousArea);
  expImpPercent.textContent = percent.toFixed(1) + "%";
  expStatus.textContent = percent <= maxAllowed ? "OK" : "Exceeds";
}

/* -----------------------------------------------------------
   RENDER LOOP (FINAL)
----------------------------------------------------------- */

async function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (!pdfPage) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  } else {
    const viewport = pdfPage.getViewport({ scale: pdfScale });
    // Center PDF in the canvas
    const pdfWidth = viewport.width;
    const pdfHeight = viewport.height;
    const offsetX = (canvas.width - pdfWidth) / 2;
    const offsetY = (canvas.height - pdfHeight) / 2;

    // Draw PDF into a temp canvas, then onto main canvas at offset
    const temp = document.createElement("canvas");
    temp.width = pdfWidth;
    temp.height = pdfHeight;
    const tctx = temp.getContext("2d");

    await pdfPage.render({ canvasContext: tctx, viewport }).promise;
    ctx.drawImage(temp, offsetX, offsetY);
  }

  const scale = scaleIsSet ? scaleFactor : 1;

  for (const poly of polygons) {
    drawPolygonShape(ctx, poly, scale);
    drawPolygonHandles(ctx, poly, scale);
    drawSquareFootageNote(ctx, poly, scale);
    if (scaleIsSet) {
      drawDimensionStrings(ctx, poly, scale);
    }
  }

  updateImperviousSummary();
}

/* -----------------------------------------------------------
   EXPORT TO PNG
----------------------------------------------------------- */

const exportBtn = document.getElementById("export-btn");
const exportPanel = document.getElementById("export-panel");

exportBtn.addEventListener("click", async () => {

  if (!canvas.width || !canvas.height) return;

  // Ensure export panel is visible so layout is correct
  const previousDisplay = exportPanel.style.display || "";
  exportPanel.style.display = "block";

  // Let browser update layout
  await new Promise((resolve) => setTimeout(resolve, 50));

  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = canvas.width;
  exportCanvas.height = canvas.height;
  const ectx = exportCanvas.getContext("2d");

  // Draw PDF background
  if (pdfPage) {
    const viewport = pdfPage.getViewport({ scale: pdfScale });
    const pdfWidth = viewport.width;
    const pdfHeight = viewport.height;
    const offsetX = (canvas.width - pdfWidth) / 2;
    const offsetY = (canvas.height - pdfHeight) / 2;

    const temp = document.createElement("canvas");
    temp.width = pdfWidth;
    temp.height = pdfHeight;
    const tctx = temp.getContext("2d");
    await pdfPage.render({ canvasContext: tctx, viewport }).promise;
    ectx.drawImage(temp, offsetX, offsetY);
  } else {
    ectx.fillStyle = "#ffffff";
    ectx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
  }

  const scale = scaleIsSet ? scaleFactor : 1;

  // Draw polygons on export canvas
  for (const poly of polygons) {
    drawPolygonShape(ectx, poly, scale);
    drawPolygonHandles(ectx, poly, scale);
    drawSquareFootageNote(ectx, poly, scale);
    if (scaleIsSet) {
      drawDimensionStrings(ectx, poly, scale);
    }
  }

  // Draw export panel (title block) into export canvas
  const panelRect = exportPanel.getBoundingClientRect();
  const canvasRect = canvas.getBoundingClientRect();
  const px = panelRect.left - canvasRect.left;
  const py = panelRect.top - canvasRect.top;

  // Render the DOM export panel into an offscreen canvas via HTML-to-canvas pattern
  // Since we don't have html2canvas here, we'll do a simpler approach:
  // draw a styled box and text matching the panel content.

  // Background box
  const panelWidth = exportPanel.offsetWidth;
  const panelHeight = exportPanel.offsetHeight;

  ectx.save();
  ectx.translate(px, py);

  ectx.fillStyle = "#F7F7F7";
  ectx.strokeStyle = "#000000";
  ectx.lineWidth = 4;
  ectx.beginPath();
  ectx.roundRect(0, 0, panelWidth, panelHeight, 6);
  ectx.fill();
  ectx.stroke();

  // Logo placeholder (optional)
  // If you want actual logo rendering, you could load an Image and drawImage here.
  ectx.fillStyle = "#000000";
  ectx.font = "bold 16px sans-serif";
  ectx.fillText("MDI & Associates", 16, 32);

  // Text content from summary spans
  const siteAreaText = "Site Area: " + (expSiteArea.textContent || "—") + " SF";
  const impAreaText = "Impervious Area: " + (expImpArea.textContent || "—") + " SF";
  const impPercentText = "Impervious %: " + (expImpPercent.textContent || "—");
  const statusText = "Status: " + (expStatus.textContent || "—");

  ectx.font = "13px sans-serif";
  ectx.fillText("Impervious Summary", 16, 56);
  ectx.fillText(siteAreaText, 16, 78);
  ectx.fillText(impAreaText, 16, 96);
  ectx.fillText(impPercentText, 16, 114);
  ectx.fillText(statusText, 16, 132);

  // Legend
  let legendY = 160;
  const legendItems = [
    { label: "Site boundary", color: "#0070c0" },
    { label: "Building / Addition", color: "#c00000" },
    { label: "Driveway", color: "#808080" },
    { label: "Patio / Deck", color: "#c09040" },
    { label: "Other impervious", color: "#aa5500" },
    { label: "Pervious / Landscape", color: "#00a000" }
  ];

  for (const item of legendItems) {
    ectx.fillStyle = item.color;
    ectx.fillRect(16, legendY - 12, 16, 16);
    ectx.strokeStyle = "#000000";
    ectx.lineWidth = 1;
    ectx.strokeRect(16, legendY - 12, 16, 16);

    ectx.fillStyle = "#000000";
    ectx.font = "13px sans-serif";
    ectx.fillText(item.label, 40, legendY);
    legendY += 20;
  }

  ectx.restore();

  // Restore export panel visibility state
  exportPanel.style.display = previousDisplay;

  // Download PNG
  const dataURL = exportCanvas.toDataURL("image/png");
  const link = document.createElement("a");
  link.href = dataURL;
  link.download = "mdi-site-plan.png";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
});

/* -----------------------------------------------------------
   INITIAL RENDER
----------------------------------------------------------- */

render();
   INITIAL RENDER
----------------------------------------------------------- */

render();

