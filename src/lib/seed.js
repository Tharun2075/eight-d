// Demo data set for a fresh site: one synthetic plant making BRKT-200 brackets.
// Every name here is invented: no real companies, carmakers, suppliers or trademarks.
import { STEPS } from './eightd.js';

export const DEMO_LABEL = 'eightd-demo';
export const PART_FAMILY = 'BRKT-200';
export const MACHINES = [
  { id: 'PR-3', name: 'Press PR-3', label: 'machine-pr3' },
  { id: 'LC-1', name: 'Laser cell LC-1', label: 'machine-lc1' },
  { id: 'WR-2', name: 'Weld robot WR-2', label: 'machine-wr2' },
];
export const LOTS = [
  { id: 'LOT-2609-A', supplier: 'Supplier A (coil steel)', label: 'lot-2609a' },
  { id: 'LOT-2610-B', supplier: 'Supplier B (fasteners)', label: 'lot-2610b' },
  { id: 'LOT-2611-A', supplier: 'Supplier A (coil steel)', label: 'lot-2611a' },
];

const DAY = 86400000;
const iso = (now, daysAgo) => new Date(now - daysAgo * DAY).toISOString();

// summary, machine, lot, cause category, 5-Why chain, action, started N days ago.
const CASES = [
  ['Burr on mounting hole of BRKT-200', 'PR-3', 'LOT-2609-A', 'Machine',
    ['Burr height above 0.2 mm on hole 2', 'Punch edge worn', 'Punch past its stroke limit', 'Stroke counter not checked at shift start', 'No stroke limit in the press start-up checklist'],
    'Add punch stroke limit to the PR-3 start-up checklist | owner: Toolroom lead', 210],
  ['Hole position out of tolerance on BRKT-200', 'LC-1', 'LOT-2609-A', 'Method',
    ['Hole 1 shifted 0.4 mm', 'Sheet not seated against the datum pins', 'Datum pin worn flat', 'Pin wear not in the preventive maintenance plan', 'PM plan copied from an older cell'],
    'Add datum pin wear check to LC-1 maintenance plan | owner: Maintenance planner', 180],
  ['Weld spatter on BRKT-200 flange', 'WR-2', 'LOT-2610-B', 'Machine',
    ['Spatter on flange face', 'Wire feed speed too high', 'Program changed after nozzle swap', 'No sign-off after program edits', 'Change control does not cover robot programs'],
    'Bring robot program edits under change control | owner: Process engineer', 150],
  ['Cracked bend on BRKT-200 after forming', 'PR-3', 'LOT-2611-A', 'Material',
    ['Crack on outer bend radius', 'Coil hardness at top of range', 'Incoming check samples one coil in ten', 'Sampling plan set before supplier change', 'Supplier change did not trigger a sampling review'],
    'Raise incoming hardness sampling to every coil for LOT-2611-A | owner: Incoming inspector', 120],
  ['Wrong gauge reading on BRKT-200 hole diameter', 'LC-1', 'LOT-2610-B', 'Measurement',
    ['Good parts rejected at final check', 'Pin gauge out of calibration', 'Calibration due date missed', 'Gauge not in the calibration list', 'New gauges are not registered at receipt'],
    'Register every new gauge at receipt | owner: Quality engineer', 90],
  ['Mixed revisions of BRKT-200 in one box', 'WR-2', 'LOT-2611-A', 'Management system',
    ['Rev B and Rev C parts in one box', 'Old stock not quarantined', 'Revision change had no stock purge step', 'Engineering change form lacks a stock step', 'Form owned by design only'],
    'Add a stock purge step to the engineering change form | owner: Quality manager', 75],
];

const OPEN = [
  // Started 40 days ago and still on D5: shows the "late on D5" flag.
  { summary: 'Missing weld nut on BRKT-200', machine: 'WR-2', lot: 'LOT-2610-B', daysAgo: 40, upTo: 'D4', cause: 'Method' },
  { summary: 'Scratches on BRKT-200 coating', machine: 'PR-3', lot: 'LOT-2611-A', daysAgo: 6, upTo: 'D2', cause: '' },
];

function fieldsFor(c, machine, lot) {
  return {
    D1: { roles: 'Champion: Quality manager. Members: Process engineer, Shift lead, Incoming inspector.', champion: 'Quality manager' },
    D2: {
      what: c.summary, where: `${machine.name}, Plant North`, when: 'Found at final inspection', who: 'Final inspection',
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

// Builds the 8 work item specs with their stored 8D state (all synthetic). `now` is a timestamp.
export function demoCases(now = Date.now()) {
  const closed = CASES.map(([summary, m, l, cause, whys, action, daysAgo]) => ({ summary, machine: m, lot: l, cause, whys, action, daysAgo, upTo: 'D8' }));
  return [...closed, ...OPEN].map((c, idx) => {
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
      state: { steps, closed: c.upTo === 'D8', startedAt: iso(now, c.daysAgo), updatedAt: iso(now, 0) },
      rootCause: c.upTo === 'D8' ? { whys: c.whys, cause: c.cause, machine, lot } : null,
    };
  });
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
