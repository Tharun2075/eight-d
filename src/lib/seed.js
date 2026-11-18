// Demo data set for a fresh site: one synthetic plant making BRKT-200 brackets.
// Every name here is invented: no real companies, carmakers, suppliers or trademarks.
import { STEPS } from './eightd.js';

export const DEMO_LABEL = 'eightd-demo';
export const PART_FAMILY = 'BRKT-200';
export const HERO_PART = 'BR-4417';
export const MACHINES = [
  { id: 'PR-3', name: 'Press 3 (PR-3)', label: 'machine-pr3' },
  { id: 'LC-1', name: 'Laser cell 1 (LC-1)', label: 'machine-lc1' },
  { id: 'WR-2', name: 'Weld robot 2 (WR-2)', label: 'machine-wr2' },
];
export const LOTS = [
  { id: 'L-2240', supplier: 'Northfield Stamping', label: 'lot-l2240' },
  { id: 'L-2252', supplier: 'Northfield Stamping', label: 'lot-l2252' },
  { id: 'L-2268', supplier: 'Northfield Stamping', label: 'lot-l2268' },
  { id: 'L-2291', supplier: 'Northfield Stamping', label: 'lot-l2291' },
];

const DAY = 86400000;
const iso = (now, daysAgo) => new Date(now - daysAgo * DAY).toISOString();

// summary, machine, lot, cause category, 5-Why chain, action, started N days ago.
const CASES = [
  ['Burr on mounting hole of BRKT-200', 'PR-3', 'L-2240', 'Machine',
    ['Burr height above 0.2 mm on hole 2', 'Punch edge worn', 'Punch past its stroke limit', 'Stroke counter not checked at shift start', 'No stroke limit in the press start-up checklist'],
    'Add punch stroke limit to the PR-3 start-up checklist | owner: Toolroom lead', 210],
  ['Hole position out of tolerance on BRKT-200', 'LC-1', 'L-2240', 'Method',
    ['Hole 1 shifted 0.4 mm', 'Sheet not seated against the datum pins', 'Datum pin worn flat', 'Pin wear not in the preventive maintenance plan', 'PM plan copied from an older cell'],
    'Add datum pin wear check to LC-1 maintenance plan | owner: Maintenance planner', 180],
  ['Weld spatter on BRKT-200 flange', 'WR-2', 'L-2252', 'Machine',
    ['Spatter on flange face', 'Wire feed speed too high', 'Program changed after nozzle swap', 'No sign-off after program edits', 'Change control does not cover robot programs'],
    'Bring robot program edits under change control | owner: Process engineer', 150],
  ['Cracked bend on BRKT-200 after forming', 'PR-3', 'L-2268', 'Material',
    ['Crack on outer bend radius', 'Coil hardness at top of range', 'Incoming check samples one coil in ten', 'Sampling plan set before supplier change', 'Supplier change did not trigger a sampling review'],
    'Raise incoming hardness sampling to every coil for lot L-2268 | owner: Incoming inspector', 120],
  ['Wrong gauge reading on BRKT-200 hole diameter', 'LC-1', 'L-2252', 'Measurement',
    ['Good parts rejected at final check', 'Pin gauge out of calibration', 'Calibration due date missed', 'Gauge not in the calibration list', 'New gauges are not registered at receipt'],
    'Register every new gauge at receipt | owner: Quality engineer', 90],
  ['Mixed revisions of BRKT-200 in one box', 'WR-2', 'L-2268', 'Management system',
    ['Rev B and Rev C parts in one box', 'Old stock not quarantined', 'Revision change had no stock purge step', 'Engineering change form lacks a stock step', 'Form owned by design only'],
    'Add a stock purge step to the engineering change form | owner: Quality manager', 75],
];

const OPEN = [
  // Started 40 days ago and still on D5: shows the "late on D5" flag.
  { summary: 'Missing weld nut on BRKT-200', machine: 'WR-2', lot: 'L-2252', daysAgo: 40, upTo: 'D4', cause: 'Method' },
  { summary: 'Scratches on BRKT-200 coating', machine: 'PR-3', lot: 'L-2268', daysAgo: 6, upTo: 'D2', cause: '' },
];

function fieldsFor(c, machine, lot) {
  return {
    D1: { roles: 'Champion: Quality manager. Members: Process engineer, Shift lead, Incoming inspector.', champion: 'Quality manager' },
    D2: {
      what: c.summary, where: `Northfield Stamping, ${machine.name}`, when: 'Found at final inspection', who: 'Final inspection',
      why: `Part family ${PART_FAMILY} ships to an assembly customer`, how: 'Visual and gauge check', howMany: `${c.count ?? 40} parts from ${lot.id}`,
    },
    D3: { actions: `Quarantine ${lot.id} stock and 100% check finished goods`, verification: 'No escapes in the next 3 shipments' },
    D4: { fiveWhys: (c.whys ?? []).map((w, i) => `${i + 1}. ${w}`).join('\n'), causeCategory: c.cause, escapePoint: 'Final inspection sampling' },
    D5: { actions: c.action ?? '', evidence: 'Trial run of 500 parts with no defect' },
    D6: { implementation: 'Done and trained on all shifts', validation: 'Zero defects in 30 days' },
    D7: { systemChanges: 'Control plan and FMEA updated', lessons: 'Shared with the other cells' },
    D8: { closure: 'Closed by the champion', recognition: 'Thanks to the cell team' },
  };
}

// Structured data (IS / IS NOT, causes, verification, look-across) so closed cases pass every gate.
function dataFor(c, machine, lot) {
  const whys = c.whys ?? [];
  return {
    isIsNot: [
      { dimension: 'What', is: c.summary, isNot: 'Other part families' },
      { dimension: 'Where', is: machine.name, isNot: 'Other cells' },
      { dimension: 'When', is: `Parts from ${lot.id}`, isNot: 'Earlier lots' },
      { dimension: 'How many', is: '40 parts', isNot: 'Whole lot' },
    ],
    causes: [
      { id: 'c1', kind: 'occurrence', text: whys[whys.length - 1] ?? '', status: 'confirmed', evidence: whys.slice(0, 3).join('; ') },
      { id: 'c2', kind: 'escape', text: 'Final inspection sampling did not cover the feature', status: 'confirmed', evidence: 'Known-bad parts run through the check' },
    ],
    verification: { before: '40 defective parts in one lot', after: 'Zero defects in 30 days' },
    lookAcross: ['Other cells running the same tooling', 'Sister part families'],
    fmeaRef: `PFMEA ${PART_FAMILY}, control plan updated`,
  };
}

// The hero case: BR-4417 rev C bend cracks from supplier lot L-2291, worked through to D6.
// Steps D1-D6 are approved; D7 is drafted with its look-across and FMEA filled, ready for the reviewer.
const HERO = {
  summary: 'Cracks on bend 2 of BR-4417 rev C, lot L-2291 (Northfield Stamping)',
  machine: 'PR-3', lot: 'L-2291', cause: 'Machine', daysAgo: 9,
  // Hours after the start at which each step was approved (D3 inside the 24 h target).
  approvedAfterH: { D1: 2, D2: 6, D3: 20, D4: 72, D5: 96, D6: 192 },
  fields: {
    D1: { roles: 'Champion: Supplier quality engineer. Members: Northfield Stamping quality lead, press 3 tool setter, OEM incoming inspector.', champion: 'Supplier quality engineer' },
    D2: {
      what: 'Crack on the outer radius of bend 2', where: 'Northfield Stamping, press 3; found at OEM incoming inspection',
      when: 'Lot L-2291, first OEM incoming check', who: 'OEM incoming inspection',
      why: 'Bracket BR-4417 rev C carries a load; a crack can grow in service', how: 'Visual check, then dye-penetrant on the sample',
      howMany: '6 of 250 sampled cracked; 1,800 pcs shipped in L-2291',
    },
    D3: {
      actions: 'Quarantine 640 pcs at Northfield Stamping and 310 pcs at the OEM; 100% dye-penetrant sort of all stock; 41 pcs scrapped',
      verification: 'Every sorted box tagged; no cracked part found in the next 3 shipments',
    },
    D4: {
      fiveWhys: ['1. Bend 2 cracks on the outer radius', '2. Press 3 die radius is 0.9 mm, minimum is 1.5 mm', '3. The die radius wore down unnoticed', '4. No die-wear check at tool change', '5. The control plan has no die-wear interval'].join('\n'),
      causeCategory: 'Machine', escapePoint: 'End-of-line visual check on 1 in 50 parts',
    },
    D5: {
      actions: 'Rework the press 3 die radius to 1.5 mm | owner: Tool room lead\nDie-wear gauge at every tool change | owner: Tool setter\nDye-penetrant / eddy-current check at end of line | owner: Quality lead',
      evidence: 'Trial lot of 500 pcs after die rework: 0 cracks under dye-penetrant',
    },
    D6: {
      implementation: 'Die reworked and gauged; wear gauge and end-of-line check live on all shifts',
      validation: '5 consecutive lots with 0 cracks; 60-day PPM trend running',
    },
    D7: {
      systemChanges: 'Control plan gets a die-wear interval; FMEA line "bend radius wear" added',
      lessons: 'Look-across to the 11 other bending dies at Northfield Stamping',
    },
  },
  data: {
    isIsNot: [
      { dimension: 'What', is: 'Crack on outer radius of bend 2', isNot: 'Bend 1, flat areas, holes' },
      { dimension: 'Where', is: 'Press 3', isNot: 'Press 1 and press 2' },
      { dimension: 'When', is: 'Lot L-2291', isNot: 'Lots L-2288 and L-2290' },
      { dimension: 'How many', is: '6 of 250 sampled', isNot: 'Whole lot' },
    ],
    causes: [
      { id: 'h1', kind: 'occurrence', text: 'Coil hardness too high', status: 'killed', evidence: 'Tensile and hardness certificates and retest in spec' },
      { id: 'h2', kind: 'occurrence', text: 'Press 3 die radius 0.9 mm against a 1.5 mm minimum', status: 'confirmed', evidence: 'Radius gauge on the die; cracks only on press 3 parts' },
      { id: 'h3', kind: 'occurrence', text: 'Operator set the wrong feed length', status: 'killed', evidence: 'Setup sheet matches; trial run at set feed gave no crack' },
      { id: 'h4', kind: 'escape', text: 'Visual check on 1 in 50 parts misses fine cracks', status: 'confirmed', evidence: 'Visual check found only 2 of 10 known-cracked parts' },
    ],
    verification: { before: '6 of 250 sampled cracked (24,000 PPM)', after: '5 consecutive lots, 0 cracks; 60-day PPM trend running' },
    lookAcross: ['11 other bending dies at Northfield Stamping: radius gauged', 'Press 1 and press 2 dies for BR-4417: in spec'],
    fmeaRef: 'PFMEA BR-4417 line "bend radius wear"; control plan die-wear interval added',
  },
};

function heroCase(now) {
  const machine = MACHINES.find((m) => m.id === HERO.machine);
  const lot = LOTS.find((l) => l.id === HERO.lot);
  const start = now - HERO.daysAgo * DAY;
  const steps = {};
  for (const s of STEPS) {
    const h = HERO.approvedAfterH[s.id];
    steps[s.id] = {
      fields: HERO.fields[s.id] ?? Object.fromEntries(s.fields.map((f) => [f, ''])),
      approvedBy: h === undefined ? null : 'demo-seed',
      approvedAt: h === undefined ? null : new Date(start + h * 3600000).toISOString(),
    };
  }
  return {
    ref: 'demo-hero',
    summary: HERO.summary,
    labels: [HERO_PART, DEMO_LABEL, machine.label, lot.label],
    closed: false,
    state: { steps, data: HERO.data, closed: false, startedAt: new Date(start).toISOString(), updatedAt: iso(now, 0) },
    rootCause: null,
  };
}

// Builds the 9 work item specs with their stored 8D state (all synthetic). `now` is a timestamp.
export function demoCases(now = Date.now()) {
  const closed = CASES.map(([summary, m, l, cause, whys, action, daysAgo]) => ({ summary, machine: m, lot: l, cause, whys, action, daysAgo, upTo: 'D8' }));
  const rest = [...closed, ...OPEN].map((c, idx) => {
    const machine = MACHINES.find((m) => m.id === c.machine);
    const lot = LOTS.find((l) => l.id === c.lot);
    const fields = fieldsFor(c, machine, lot);
    const last = STEPS.findIndex((s) => s.id === c.upTo);
    const steps = {};
    STEPS.forEach((s, i) => {
      const done = i <= last;
      // Steps are spread over the case so the overview has real ages to show.
      steps[s.id] = {
        fields: done || i === last + 1 ? fields[s.id] : Object.fromEntries(s.fields.map((f) => [f, ''])),
        approvedBy: done ? 'demo-seed' : null,
        approvedAt: done ? iso(now, Math.max(c.daysAgo - (i + 1) * 4, 0)) : null,
      };
    });
    return {
      ref: `demo-${idx + 1}`,
      summary: c.summary,
      labels: [PART_FAMILY, DEMO_LABEL, machine.label, lot.label],
      closed: c.upTo === 'D8',
      state: { steps, ...(c.upTo === 'D8' ? { data: dataFor(c, machine, lot) } : {}), closed: c.upTo === 'D8', startedAt: iso(now, c.daysAgo), updatedAt: iso(now, 0) },
      rootCause: c.upTo === 'D8' ? { whys: c.whys, cause: c.cause, machine, lot } : null,
    };
  });
  return [...rest, heroCase(now)];
}

// Confluence storage body for a closed case's root-cause page.
export function rootCausePage(key, c) {
  const items = c.rootCause.whys.map((w) => `<li>${w}</li>`).join('');
  return {
    title: `Root cause ${key}: ${c.summary}`,
    body: `<p>Work item ${key}. Part family ${PART_FAMILY}, ${c.rootCause.machine.name}, lot ${c.rootCause.lot.id} (${c.rootCause.lot.supplier}).</p>`
      + `<p>Cause category: ${c.rootCause.cause}.</p><ol>${items}</ol><p>Demo data, all names invented.</p>`,
    labels: ['root-cause', PART_FAMILY.toLowerCase(), DEMO_LABEL],
  };
}
