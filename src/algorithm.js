export const CANVAS = { width: 960, height: 600 };

export const PRESETS = {
  engineering: {
    label: 'Engineering Block · L-shape',
    rooms: [
      ['E-101', 170, 145], ['E-102', 300, 145], ['E-103', 430, 145],
      ['E-104', 170, 270], ['E-105', 300, 270], ['E-106', 430, 270],
      ['E-107', 170, 395], ['E-108', 300, 395], ['E-109', 170, 520], ['E-110', 300, 520],
      ['LAB-1', 565, 145], ['LAB-2', 700, 145],
    ],
  },
  cs: {
    label: 'CS & AI Department · U-shape',
    rooms: [
      ['CS-101', 170, 150], ['CS-102', 170, 285], ['CS-103', 170, 420],
      ['AI-201', 790, 150], ['AI-202', 790, 285], ['AI-203', 790, 420],
      ['LAB-1', 300, 490], ['LAB-2', 430, 490], ['LAB-3', 560, 490], ['SEMINAR', 690, 490],
    ],
  },
  quad: {
    label: 'Academic Quad · 4 clusters',
    rooms: [
      ['A-101', 180, 150], ['A-102', 310, 150], ['A-103', 180, 275], ['A-104', 310, 275],
      ['B-201', 650, 150], ['B-202', 780, 150], ['B-203', 650, 275], ['B-204', 780, 275],
      ['C-301', 180, 395], ['C-302', 310, 395], ['C-303', 180, 520], ['C-304', 310, 520],
      ['D-401', 650, 395], ['D-402', 780, 395], ['D-403', 650, 520], ['D-404', 780, 520],
    ],
  },
};

export function roomsForPreset(key) {
  return PRESETS[key].rooms.map(([name, x, y], index) => ({ id: `${key}-${index + 1}`, name, x, y }));
}

const roundPoint = (x, y) => ({ x: Math.round(x), y: Math.round(y) });

export function generateCandidates(rooms, radius, density = 'medium', width = CANVAS.width, height = CANVAS.height) {
  const spacing = { coarse: 150, medium: 105, fine: 72 }[density] ?? 105;
  const points = [];
  for (let y = 70; y <= height - 55; y += spacing) {
    for (let x = 70; x <= width - 55; x += spacing) points.push({ ...roundPoint(x, y), source: 'grid' });
  }
  for (const room of rooms) points.push({ ...roundPoint(room.x, room.y), source: 'classroom' });
  for (let i = 0; i < rooms.length; i += 1) {
    for (let j = i + 1; j < rooms.length; j += 1) {
      const a = rooms[i];
      const b = rooms[j];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      if (distance <= radius * 2.7) points.push({ ...roundPoint((a.x + b.x) / 2, (a.y + b.y) / 2), source: 'midpoint' });
    }
  }
  const unique = new Map();
  for (const point of points) {
    const key = `${point.x}:${point.y}`;
    if (!unique.has(key)) unique.set(key, point);
  }
  return [...unique.values()].map((point, index) => ({ ...point, id: `candidate-${index + 1}` }));
}

export function optimize(rooms, candidates, radius, budget) {
  const candidatesWithCoverage = candidates.map((candidate) => ({
    ...candidate,
    coveredIds: rooms.filter((room) => Math.hypot(room.x - candidate.x, room.y - candidate.y) <= radius).map((room) => room.id),
  }));
  const covered = new Set();
  const selected = new Set();
  const steps = [];

  for (let iteration = 0; iteration < budget; iteration += 1) {
    let best = null;
    let bestNew = [];
    for (const candidate of candidatesWithCoverage) {
      if (selected.has(candidate.id)) continue;
      const newlyCovered = candidate.coveredIds.filter((id) => !covered.has(id));
      if (newlyCovered.length > bestNew.length) {
        best = candidate;
        bestNew = newlyCovered;
      }
    }
    if (!best || bestNew.length === 0) break;
    selected.add(best.id);
    bestNew.forEach((id) => covered.add(id));
    steps.push({
      index: iteration + 1,
      x: best.x,
      y: best.y,
      source: best.source,
      marginalGain: bestNew.length,
      newlyCovered: bestNew,
      allCovered: [...covered],
      totalCovered: covered.size,
      candidateId: best.id,
    });
    if (covered.size === rooms.length) break;
  }
  return { steps, coveredIds: [...covered], candidates: candidatesWithCoverage };
}

export function coverageForLocations(rooms, locations, radius) {
  const covered = new Set();
  for (const location of locations) {
    for (const room of rooms) {
      if (Math.hypot(room.x - location.x, room.y - location.y) <= radius) covered.add(room.id);
    }
  }
  return covered.size;
}
