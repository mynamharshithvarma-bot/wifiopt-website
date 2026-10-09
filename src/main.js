import { CANVAS, PRESETS, roomsForPreset, generateCandidates, optimize, coverageForLocations } from './algorithm.js';

const $ = (selector) => document.querySelector(selector);
const canvas = $('#floorplan');
const ctx = canvas.getContext('2d');
const stage = $('#canvas-frame');
const state = {
  preset: 'engineering', rooms: [], budget: 5, radius: 140, density: 'medium', tool: 'move',
  candidates: [], result: null, visibleSteps: 0, busy: false, dragId: null, runToken: 0,
  cursor: null,
};
const ROOM_W = 70;
const ROOM_H = 43;

function loadPreset(key) {
  state.preset = key;
  state.rooms = roomsForPreset(key);
  clearResult();
  renderAll();
}
function clearResult() {
  state.runToken += 1;
  state.result = null;
  state.visibleSteps = 0;
  state.busy = false;
  setBusy(false);
}
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function setBusy(busy) {
  state.busy = busy;
  $('#run-button').disabled = busy;
  $('#step-button').disabled = busy;
  $('#run-button').innerHTML = busy ? '<span class="play-icon">◌</span> Running…' : '<span class="play-icon">▶</span> Run optimization';
}
function pointFromEvent(event) {
  const rect = canvas.getBoundingClientRect();
  return { x: ((event.clientX - rect.left) / rect.width) * CANVAS.width, y: ((event.clientY - rect.top) / rect.height) * CANVAS.height };
}
function updateScaleBar() {
  stage.style.setProperty('--scale-line-width', `${stage.getBoundingClientRect().width * 100 / CANVAS.width}px`);
}
function roomAt(point) {
  return [...state.rooms].reverse().find((room) => Math.abs(room.x - point.x) <= ROOM_W / 2 + 4 && Math.abs(room.y - point.y) <= ROOM_H / 2 + 4);
}
function roomName() {
  const prefix = ({ engineering: 'E', cs: 'CS', quad: 'A' })[state.preset] ?? 'R';
  let index = 1;
  const used = new Set(state.rooms.map((room) => room.name));
  while (used.has(`${prefix}-NEW${index}`)) index += 1;
  return `${prefix}-NEW${index}`;
}
function setTool(tool) {
  state.tool = tool;
  document.querySelectorAll('.tool-button').forEach((button) => button.classList.toggle('active', button.dataset.tool === tool));
  const descriptions = { move: ['Drag a classroom to reposition it.', 'Drag rooms to move · Choose Add room to place', 'MOVE ROOMS'], add: ['Click the blueprint to place a classroom.', 'Click an open space to add a room', 'ADD ROOM'], delete: ['Click a classroom to remove it.', 'Click a room to remove it', 'DELETE ROOM'] };
  $('#tool-helper').textContent = descriptions[tool][0];
  $('#canvas-instruction').textContent = descriptions[tool][1];
  $('#tool-hint').textContent = descriptions[tool][2];
  canvas.classList.toggle('cursor-add', tool === 'add');
  canvas.classList.toggle('cursor-delete', tool === 'delete');
}
function recomputeCandidates() {
  state.candidates = generateCandidates(state.rooms, state.radius, state.density);
  $('#candidate-count').textContent = `${state.candidates.length} candidate points`;
}
function renderAll() {
  $('#preset-select').value = state.preset;
  $('#budget-range').value = state.budget;
  $('#budget-output').textContent = state.budget;
  $('#radius-range').value = state.radius;
  $('#radius-output').textContent = `${state.radius} px`;
  $('#metric-budget').textContent = state.budget;
  $('#room-count-footer').textContent = `${state.rooms.length} ROOMS`;
  $('#metric-total').textContent = state.rooms.length;
  document.querySelectorAll('.density-button').forEach((button) => button.classList.toggle('active', button.dataset.density === state.density));
  recomputeCandidates();
  drawCanvas();
  updateMetrics();
  renderTrace();
}
function roundedRect(context, x, y, width, height, radius) {
  context.beginPath();
  context.roundRect(x, y, width, height, radius);
}
function drawGrid() {
  ctx.fillStyle = '#081522';
  ctx.fillRect(0, 0, CANVAS.width, CANVAS.height);
  ctx.lineWidth = 1;
  for (let x = 0; x <= CANVAS.width; x += 24) {
    ctx.strokeStyle = x % 120 === 0 ? '#254054' : '#152a3b';
    ctx.beginPath(); ctx.moveTo(x + .5, 0); ctx.lineTo(x + .5, CANVAS.height); ctx.stroke();
  }
  for (let y = 0; y <= CANVAS.height; y += 24) {
    ctx.strokeStyle = y % 120 === 0 ? '#254054' : '#152a3b';
    ctx.beginPath(); ctx.moveTo(0, y + .5); ctx.lineTo(CANVAS.width, y + .5); ctx.stroke();
  }
  ctx.strokeStyle = '#304d60'; ctx.lineWidth = 1.2;
  ctx.strokeRect(18.5, 18.5, CANVAS.width - 37, CANVAS.height - 37);
  ctx.fillStyle = '#426176'; ctx.font = '9px monospace';
  for (let x = 120; x < CANVAS.width; x += 120) ctx.fillText(String(x), x + 4, 15);
  for (let y = 120; y < CANVAS.height; y += 120) ctx.fillText(String(y), 4, y - 4);
}
function drawCandidates() {
  ctx.save();
  ctx.fillStyle = '#57c5d0';
  for (const candidate of state.candidates) {
    ctx.globalAlpha = candidate.source === 'grid' ? .24 : .46;
    ctx.beginPath(); ctx.arc(candidate.x, candidate.y, candidate.source === 'grid' ? 1.2 : 1.8, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}
function getVisibleSteps() { return state.result?.steps.slice(0, state.visibleSteps) ?? []; }
function drawCoverage(steps) {
  steps.forEach((step, index) => {
    const hue = index % 2 ? 181 : 169;
    const gradient = ctx.createRadialGradient(step.x, step.y, 1, step.x, step.y, state.radius);
    gradient.addColorStop(0, `hsla(${hue}, 76%, 55%, .21)`);
    gradient.addColorStop(.72, `hsla(${hue}, 74%, 45%, .12)`);
    gradient.addColorStop(1, `hsla(${hue}, 74%, 45%, .025)`);
    ctx.beginPath(); ctx.arc(step.x, step.y, state.radius, 0, Math.PI * 2);
    ctx.fillStyle = gradient; ctx.fill();
    ctx.save(); ctx.setLineDash([5, 6]); ctx.lineWidth = 1;
    ctx.strokeStyle = `hsla(${hue}, 81%, 69%, .36)`; ctx.stroke(); ctx.restore();
  });
  const roomMap = new Map(state.rooms.map((room) => [room.id, room]));
  steps.forEach((step, index) => {
    const newly = new Set(step.newlyCovered);
    for (const id of newly) {
      const room = roomMap.get(id); if (!room) continue;
      ctx.save(); ctx.setLineDash([3, 4]); ctx.strokeStyle = `rgba(85, 224, 194, ${.36 + index * .045})`; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(step.x, step.y); ctx.lineTo(room.x, room.y); ctx.stroke(); ctx.restore();
    }
  });
  steps.forEach((step, index) => {
    const active = index === steps.length - 1 && state.busy;
    ctx.save();
    ctx.shadowBlur = active ? 24 : 13; ctx.shadowColor = '#58e2df';
    ctx.beginPath(); ctx.arc(step.x, step.y, 9, 0, Math.PI * 2); ctx.fillStyle = '#67e2dd'; ctx.fill();
    ctx.shadowBlur = 0; ctx.beginPath(); ctx.arc(step.x, step.y, 4.6, 0, Math.PI * 2); ctx.fillStyle = '#09202a'; ctx.fill();
    ctx.beginPath(); ctx.arc(step.x, step.y, 13, 0, Math.PI * 2); ctx.strokeStyle = '#77e4dc77'; ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = '#d6fff8'; ctx.font = 'bold 9px monospace'; ctx.textAlign = 'center'; ctx.fillText(`AP${index + 1}`, step.x, step.y - 17);
    ctx.restore();
  });
}
function drawRooms(steps) {
  const covered = new Set(steps.flatMap((step) => step.allCovered));
  for (const room of state.rooms) {
    const isCovered = covered.has(room.id);
    const x = room.x - ROOM_W / 2; const y = room.y - ROOM_H / 2;
    ctx.save();
    if (isCovered) { ctx.shadowColor = '#46dfad'; ctx.shadowBlur = 12; }
    roundedRect(ctx, x, y, ROOM_W, ROOM_H, 4);
    ctx.fillStyle = isCovered ? '#123b38' : '#132536'; ctx.fill();
    ctx.lineWidth = isCovered ? 1.4 : 1; ctx.strokeStyle = isCovered ? '#50d4a9' : '#8fa7b8'; ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = isCovered ? '#b6ffe2' : '#c1d0d9'; ctx.font = '8px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(room.name, room.x, room.y);
    ctx.restore();
  }
}
function drawCursor() {
  if (!state.cursor || state.busy) return;
  const { x, y } = state.cursor;
  ctx.save(); ctx.strokeStyle = '#72d8e477'; ctx.setLineDash([3, 5]); ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, CANVAS.height); ctx.moveTo(0, y); ctx.lineTo(CANVAS.width, y); ctx.stroke();
  ctx.restore();
}
function drawCanvas() {
  ctx.clearRect(0, 0, CANVAS.width, CANVAS.height);
  drawGrid();
  drawCandidates();
  const steps = getVisibleSteps();
  drawCoverage(steps);
  drawRooms(steps);
  drawCursor();
}
function updateMetrics() {
  const total = state.rooms.length;
  const steps = getVisibleSteps();
  const covered = new Set(steps.flatMap((step) => step.allCovered)).size;
  const uncovered = Math.max(0, total - covered);
  const percent = total ? Math.round((covered / total) * 100) : 0;
  $('#coverage-percent').innerHTML = `${percent}<span>%</span>`;
  $('#coverage-ring').style.setProperty('--progress', `${percent}%`);
  $('#coverage-ring').setAttribute('aria-label', `${percent} percent classroom coverage`);
  $('#metric-total').textContent = total;
  $('#metric-used').textContent = steps.length;
  $('#metric-budget').textContent = state.budget;
  $('#metric-covered').textContent = covered;
  $('#metric-uncovered').textContent = uncovered;
  if (!state.result) {
    $('#coverage-line').textContent = 'Waiting for run';
    $('#coverage-subline').textContent = total ? `${total} classrooms ready to model` : 'Add a classroom to begin';
    $('#canvas-state').textContent = `${total} classrooms · Ready for optimization`;
  } else if (state.busy) {
    $('#coverage-line').textContent = `Step ${steps.length} of ${state.result.steps.length}`;
    $('#coverage-subline').textContent = `${covered} of ${total} classrooms reached`;
    $('#canvas-state').textContent = `Greedy placement ${steps.length} / ${state.result.steps.length}`;
  } else {
    $('#coverage-line').textContent = `${covered} of ${total} classrooms`;
    $('#coverage-subline').textContent = steps.length ? `Covered using ${steps.length} of ${state.budget} APs` : 'No candidate AP adds new coverage';
    $('#canvas-state').textContent = `Complete · ${covered} / ${total} classrooms covered`;
  }
}
function renderTrace() {
  const steps = getVisibleSteps();
  $('#trace-count').textContent = `${steps.length} ${steps.length === 1 ? 'STEP' : 'STEPS'}`;
  if (!state.result) {
    $('#trace-list').innerHTML = '<div class="empty-trace"><span class="empty-graph">⌁</span><span>Your decisions will appear here.</span></div>';
    return;
  }
  if (!steps.length) {
    $('#trace-list').innerHTML = '<div class="empty-trace"><span class="empty-graph">∅</span><span>No candidate adds new classroom coverage.</span></div>';
    return;
  }
  const rooms = new Map(state.rooms.map((room) => [room.id, room]));
  $('#trace-list').innerHTML = steps.map((step) => {
    const newly = step.newlyCovered.map((id) => rooms.get(id)?.name).filter(Boolean).join(', ');
    const remainingCandidates = Math.max(1, state.candidates.length - step.index + 1);
    return `<article class="trace-item"><div class="trace-top"><span class="trace-step-label">ITERATION ${String(step.index).padStart(2, '0')}</span><span class="trace-gain">+${step.marginalGain} ΔN</span></div><div class="trace-coords">AP at (${step.x}, ${step.y}) · ${step.source}</div><div class="trace-new">New: ${escapeHtml(newly || '—')}</div><div class="trace-reason">Largest marginal gain among ${remainingCandidates} remaining candidate positions.</div></article>`;
  }).join('');
  $('#trace-list').scrollTop = $('#trace-list').scrollHeight;
}
function escapeHtml(text) { return String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]); }
function refreshResultIfIdle() {
  if (!state.result || state.busy) return;
  const result = optimize(state.rooms, state.candidates, state.radius, state.budget);
  state.result = result;
  state.visibleSteps = result.steps.length;
}
function updateRangeFill(input) {
  const min = Number(input.min); const max = Number(input.max); const value = Number(input.value);
  input.style.background = `linear-gradient(90deg,#54d0df 0%,#54d0df ${(value - min) / (max - min) * 100}%,#26394a ${(value - min) / (max - min) * 100}%,#26394a 100%)`;
}
function runOptimization(animate) {
  if (state.busy || state.rooms.length === 0) {
    if (!state.rooms.length) showToast('Add a classroom before running the optimizer.');
    return;
  }
  recomputeCandidates();
  const result = optimize(state.rooms, state.candidates, state.radius, state.budget);
  state.result = result;
  state.visibleSteps = animate ? 0 : result.steps.length;
  drawCanvas(); updateMetrics(); renderTrace();
  if (!animate) return;
  if (!result.steps.length) { state.busy = false; updateMetrics(); showToast('No candidate location can add new coverage.'); return; }
  const token = ++state.runToken;
  setBusy(true);
  const revealNext = () => {
    if (token !== state.runToken) return;
    state.visibleSteps += 1;
    drawCanvas(); updateMetrics(); renderTrace();
    if (state.visibleSteps >= result.steps.length) {
      state.busy = false; setBusy(false); drawCanvas(); updateMetrics(); renderTrace();
      return;
    }
    window.setTimeout(revealNext, 900);
  };
  window.setTimeout(revealNext, 80);
}
function onCanvasMove(event) {
  const point = pointFromEvent(event);
  state.cursor = point;
  const px = Math.round(point.x); const py = Math.round(point.y);
  $('#coordinate-readout').textContent = `X ${String(px).padStart(3, ' ')}  Y ${String(py).padStart(3, ' ')}`;
  if (state.dragId) {
    const room = state.rooms.find((item) => item.id === state.dragId);
    if (room) { room.x = clamp(point.x, ROOM_W / 2 + 24, CANVAS.width - ROOM_W / 2 - 24); room.y = clamp(point.y, ROOM_H / 2 + 24, CANVAS.height - ROOM_H / 2 - 24); clearResult(); recomputeCandidates(); updateMetrics(); renderTrace(); }
  }
  drawCanvas();
}
function onCanvasDown(event) {
  if (state.busy) return;
  const point = pointFromEvent(event);
  if (state.tool === 'add') {
    const room = { id: `custom-${crypto.randomUUID()}`, name: roomName(), x: clamp(point.x, 60, CANVAS.width - 60), y: clamp(point.y, 55, CANVAS.height - 45) };
    state.rooms.push(room); clearResult(); renderAll(); return;
  }
  const room = roomAt(point);
  if (state.tool === 'delete') {
    if (!room) return;
    state.rooms = state.rooms.filter((item) => item.id !== room.id); clearResult(); renderAll(); return;
  }
  if (room) { state.dragId = room.id; canvas.classList.add('dragging'); canvas.setPointerCapture(event.pointerId); }
}
function onCanvasUp() {
  if (!state.dragId) return;
  state.dragId = null; canvas.classList.remove('dragging'); clearResult(); renderAll();
}
function runBenchmark() {
  recomputeCandidates();
  const greedyResult = optimize(state.rooms, state.candidates, state.radius, state.budget);
  const greedy = greedyResult.coveredIds.length;
  const trials = [];
  for (let trial = 0; trial < 20; trial += 1) {
    const shuffled = [...state.candidates];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1)); [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    trials.push(coverageForLocations(state.rooms, shuffled.slice(0, state.budget), state.radius));
  }
  const average = trials.reduce((sum, value) => sum + value, 0) / trials.length;
  const pct = (count) => state.rooms.length ? Math.round((count / state.rooms.length) * 100) : 0;
  const delta = pct(greedy) - pct(average);
  $('#benchmark-content').innerHTML = `<div class="benchmark-score"><div><small>GREEDY COVERAGE</small><strong>${pct(greedy)}%</strong></div><div class="score-delta">${delta >= 0 ? '+' : ''}${delta} pts<br /><span style="color:#7e95a5">vs. random average</span></div></div><div class="benchmark-cell"><small>GREEDY · ${greedy} / ${state.rooms.length} ROOMS</small><strong>${pct(greedy)}%</strong><div class="benchmark-bar"><span style="width:${pct(greedy)}%"></span></div></div><div class="benchmark-cell random"><small>RANDOM · MEAN OF 20</small><strong>${pct(average)}%</strong><div class="benchmark-bar"><span style="width:${pct(average)}%"></span></div></div><div class="trial-list">${trials.map((value, index) => `<div class="trial-tick ${value >= greedy ? 'best' : ''}" title="Trial ${index + 1}: ${value}/${state.rooms.length} rooms"><span style="height:${Math.max(4, pct(value))}%"></span></div>`).join('')}</div><div class="trial-caption"><span>TRIAL 01</span><span>20 RANDOM DEPLOYMENTS</span><span>TRIAL 20</span></div>`;
  openModal('benchmark-modal');
}
function openModal(id) { const modal = document.getElementById(id); modal.classList.remove('hidden'); modal.querySelector('.modal-close')?.focus(); document.body.style.overflow = 'hidden'; }
function closeModal(modal) { modal.classList.add('hidden'); document.body.style.overflow = ''; }
function renderTheory(tab = 'formulation') {
  document.querySelectorAll('.theory-tab').forEach((button) => button.classList.toggle('active', button.dataset.tab === tab));
  const content = $('#theory-content');
  if (tab === 'formulation') {
    content.innerHTML = `<div class="theory-grid"><article class="theory-box"><h3>Model</h3><p class="formula">U = {r₁, r₂, …, rₙ}<br />C = {c₁, c₂, …, cₘ}<br />R = coverage radius · K = AP budget<br /><br />dist(c, r) = √((xᶜ−xʳ)² + (yᶜ−yʳ)²)<br />r is covered ⇔ dist(c, r) ≤ R</p></article><article class="theory-box"><h3>Objective</h3><p class="formula">max | ⋃<sub>c∈S</sub> Cover(c) |<br />s.t. S ⊆ C, |S| ≤ K<br /><br />Coverage % = covered classrooms / total × 100</p></article><article class="theory-box"><h3>Greedy choice</h3><p>At each iteration, choose the candidate that reaches the greatest number of currently uncovered classrooms. Add it to the solution and update the covered set. Stop at zero marginal gain or full coverage.</p></article><article class="theory-box"><h3>Why the guarantee applies</h3><p>Maximum coverage is monotone submodular: marginal gains diminish as more rooms become covered. Greedy selection therefore achieves at least (1 − 1/e) ≈ 63.2% of the optimal value (Nemhauser, Wolsey &amp; Fisher, 1978).</p></article><article class="theory-box full-box"><h3>Complexity and model scope</h3><p>Candidate generation and distance precomputation: O(M·N). At most K iterations each evaluate up to M candidates across N rooms: O(K·M·N) overall. Storing coverage sets takes O(M·N) space. The geometric model uses Euclidean distance; it does not model walls, interference, or real-world RF propagation.</p></article></div>`;
  } else if (tab === 'pseudocode') {
    content.innerHTML = `<div class="pseudocode">GREEDY-MAX-COVERAGE(U, C, R, K)\n  Covered ← ∅; Selected ← []\n  For each candidate c in C:\n    Cover[c] ← { r ∈ U : dist(c, r) ≤ R }\n\n  Repeat at most K times:\n    best ← arg max(c ∈ C \\ Selected) |Cover[c] \\ Covered|\n    gain ← Cover[best] \\ Covered\n    If |gain| = 0: break\n    Selected.append(best)\n    Covered ← Covered ∪ gain\n    Record best, gain, and Covered\n    If |Covered| = |U|: break\n\n  Return Selected, Covered</div><div class="theory-grid" style="margin-top:10px"><article class="theory-box"><h3>Candidate generation</h3><p>Use a uniform floor-plan grid, classroom center coordinates, and midpoints between nearby classrooms to model shared/corridor placement options.</p></article><article class="theory-box"><h3>Implementation note</h3><p>Each classroom is added only once to the covered set, so overlapping AP circles never double-count coverage.</p></article></div>`;
  } else {
    const questions = [
      ['Why greedy rather than brute force or dynamic programming?', 'Brute force checks (M choose K) AP combinations and grows combinatorially. In a two-dimensional layout, overlapping coverage subsets create a large state space for dynamic programming. Greedy runs in polynomial O(K·M·N) time with a bounded approximation guarantee.'],
      ['What is the greedy choice property here?', 'At every step, choose the candidate AP c* maximizing |Cover(c) \ Covered|—the number of currently uncovered classrooms it can newly reach. Earlier placements are not revised.'],
      ['Why does the (1 − 1/e) guarantee apply?', 'The maximum-coverage objective is monotone submodular: adding an AP to a larger selected set cannot create greater marginal coverage than adding it to a smaller set. The Nemhauser–Wolsey–Fisher result gives greedy at least 63.2% of optimum under a cardinality budget.'],
      ['How are candidate AP locations generated?', 'From a regular coordinate lattice, classroom-center positions, and midpoints between nearby classroom centers. Grid density controls the lattice resolution.'],
      ['What if every room is covered before K APs are used?', 'The algorithm terminates early when all classrooms are covered, or when the best remaining marginal gain is zero. No redundant AP is added.'],
      ['How is classroom coverage determined?', 'A classroom center is covered if its Euclidean distance from the candidate AP is less than or equal to the chosen radius R. The model treats rooms as points.'],
      ['What happens when the coverage radius increases?', 'Each candidate can reach a superset of the rooms it covered before; coverage tends to increase, although the AP budget still limits selected locations.'],
      ['What does submodularity mean in plain language?', 'Diminishing returns: once nearby rooms are already covered, a later AP in that area adds fewer new classrooms than the same AP would have added earlier.'],
      ['How should the random benchmark be interpreted?', 'It compares greedy against the mean coverage of 20 random placements under the same layout, radius, candidate set, and AP budget. Random outcomes vary by trial, so the comparison is empirical, not a proof of optimality.'],
      ['What is a limitation of this model?', 'It uses idealized 2D Euclidean radius coverage. Real Wi-Fi performance depends on walls, materials, interference, antenna direction, client density, and radio propagation; those factors are outside this demonstration.'],
    ];
    content.innerHTML = `<div class="question-list">${questions.map(([question, answer], index) => `<details class="question" ${index === 0 ? 'open' : ''}><summary>Q${index + 1}. ${escapeHtml(question)}</summary><p>${escapeHtml(answer)}</p></details>`).join('')}</div>`;
  }
}
function showToast(message) {
  document.querySelector('.toast')?.remove();
  const toast = document.createElement('div'); toast.className = 'toast'; toast.textContent = message;
  document.body.append(toast); window.setTimeout(() => toast.remove(), 2500);
}

for (const [key, preset] of Object.entries(PRESETS)) {
  const option = document.createElement('option'); option.value = key; option.textContent = preset.label; $('#preset-select').append(option);
}
$('#preset-select').addEventListener('change', (event) => loadPreset(event.target.value));
document.querySelectorAll('.tool-button').forEach((button) => button.addEventListener('click', () => setTool(button.dataset.tool)));
document.querySelectorAll('.density-button').forEach((button) => button.addEventListener('click', () => { state.density = button.dataset.density; clearResult(); renderAll(); }));
$('#budget-range').addEventListener('input', (event) => { if (state.busy) clearResult(); state.budget = Number(event.target.value); $('#budget-output').textContent = state.budget; $('#metric-budget').textContent = state.budget; updateRangeFill(event.target); refreshResultIfIdle(); drawCanvas(); updateMetrics(); renderTrace(); });
$('#radius-range').addEventListener('input', (event) => { state.radius = Number(event.target.value); $('#radius-output').textContent = `${state.radius} px`; updateRangeFill(event.target); clearResult(); recomputeCandidates(); drawCanvas(); updateMetrics(); renderTrace(); });
$('#run-button').addEventListener('click', () => runOptimization(false));
$('#step-button').addEventListener('click', () => runOptimization(true));
$('#reset-button').addEventListener('click', () => { clearResult(); drawCanvas(); updateMetrics(); renderTrace(); $('#canvas-state').textContent = 'Ready for optimization'; });
$('#benchmark-open').addEventListener('click', runBenchmark);
$('#theory-open').addEventListener('click', () => { renderTheory('formulation'); openModal('theory-modal'); });
$('#theory-inline').addEventListener('click', () => { renderTheory('formulation'); openModal('theory-modal'); });
document.querySelectorAll('.theory-tab').forEach((button) => button.addEventListener('click', () => renderTheory(button.dataset.tab)));
document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => closeModal(button.closest('.modal-backdrop'))));
document.querySelectorAll('.modal-backdrop').forEach((modal) => modal.addEventListener('click', (event) => { if (event.target === modal) closeModal(modal); }));
document.addEventListener('keydown', (event) => { if (event.key === 'Escape') document.querySelectorAll('.modal-backdrop:not(.hidden)').forEach(closeModal); });
canvas.addEventListener('pointermove', onCanvasMove);
canvas.addEventListener('pointerdown', onCanvasDown);
canvas.addEventListener('pointerup', onCanvasUp);
canvas.addEventListener('pointercancel', onCanvasUp);
canvas.addEventListener('pointerleave', () => { if (!state.dragId) { state.cursor = null; drawCanvas(); } });
window.addEventListener('resize', () => { updateScaleBar(); drawCanvas(); });

loadPreset('engineering');
updateRangeFill($('#budget-range'));
updateRangeFill($('#radius-range'));
updateScaleBar();
setTool('move');
