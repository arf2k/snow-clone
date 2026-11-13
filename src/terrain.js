// terrain.js — lift and trail status, normalised across resort feeds.
//
// Every parser returns the same shape (or null when the feed has nothing):
//   {
//     summary: { liftsOpen, liftsTotal, liftsHold, trailsOpen, trailsTotal,
//                groomed, acresOpen, acresTotal },
//     lifts:  [{ name, area, status, rawStatus, type, wait, note }],
//     trails: [{ name, area, status, rawStatus, level, levelLabel, groomed }],
//   }
// status is one of: open | hold | scheduled | closed | unknown
// level  is one of: green | blue | black | double | park | other

const num = (v) => {
  if (v == null || v === '' || v === '--') return null;
  const n = Number(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
};

const clean = (v) => {
  const s = v == null ? '' : String(v).trim();
  return s === '--' ? '' : s;
};

/** Map a feed's own wording onto one of five states. */
export function normalizeStatus(raw) {
  const s = clean(raw).toLowerCase().replace(/_/g, ' ');
  if (!s) return 'unknown';
  if (/hold|standby|delay|wind/.test(s)) return 'hold';
  if (/expect|schedul|planned|forecast|opening|pending/.test(s))
    return 'scheduled';
  if (/clos|out of period|season|^off/.test(s)) return 'closed';
  if (/open|running|operat/.test(s)) return 'open';
  return 'unknown';
}

const LEVEL_LABELS = {
  green: 'Beginner',
  blue: 'Intermediate',
  black: 'Advanced',
  double: 'Expert',
  park: 'Terrain park',
};

/** Map a feed's difficulty wording onto a trail-marker class. */
export function normalizeLevel(raw) {
  const s = clean(raw).toLowerCase().replace(/_/g, ' ');
  // Order matters: "double black" before "black", "advanced intermediate"
  // and "more difficult" before "advanced" / "difficult".
  if (/double black|extreme|expert|high exposure/.test(s)) return 'double';
  if (/intermediate|blue|more difficult|slightly difficult/.test(s))
    return 'blue';
  if (/black|difficult|advanced/.test(s)) return 'black';
  if (/green|eas|beginner|novice/.test(s)) return 'green';
  if (/park|freestyle|pipe/.test(s)) return 'park';
  return 'other';
}

function trail({ name, area, rawStatus, rawLevel, groomed }) {
  const level = normalizeLevel(rawLevel);
  return {
    name: clean(name) || 'Unnamed',
    area: clean(area),
    status: normalizeStatus(rawStatus),
    rawStatus: clean(rawStatus),
    level,
    rawLevel: clean(rawLevel),
    levelLabel: LEVEL_LABELS[level] || clean(rawLevel).replace(/_/g, ' '),
    groomed: Boolean(groomed),
  };
}

function lift({ name, area, rawStatus, type, wait, note }) {
  return {
    name: clean(name) || 'Unnamed',
    area: clean(area),
    status: normalizeStatus(rawStatus),
    rawStatus: clean(rawStatus),
    type: clean(type).replace(/_/g, ' '),
    wait: wait > 0 ? Math.round(wait) : null, // minutes
    note: clean(note),
  };
}

const count = (list, test) => list.filter(test).length;

/**
 * Totals come from the feed when it states them, otherwise from the lists.
 */
function build(lifts, trails, stated = {}) {
  if (!lifts.length && !trails.length && stated.liftsTotal == null) return null;

  // "Expert" means double-black at most resorts, but some (Stratton, Winter
  // Park) use Expert for single black and a separate "Extreme" tier above
  // it. Tell them apart by whether the feed has any other black-level label.
  const hasTierAboveExpert = trails.some((t) =>
    /extreme|double black|high exposure/i.test(t.rawLevel)
  );
  const hasBlack = trails.some((t) => t.level === 'black');
  if (hasTierAboveExpert && !hasBlack) {
    for (const t of trails) {
      if (/expert/i.test(t.rawLevel)) {
        t.level = 'black';
        t.levelLabel = LEVEL_LABELS.black;
      }
    }
  }

  const pick = (a, b) => (a != null ? a : b);
  return {
    summary: {
      liftsOpen: pick(
        stated.liftsOpen,
        count(lifts, (l) => l.status === 'open')
      ),
      liftsTotal: pick(stated.liftsTotal, lifts.length),
      liftsHold: pick(
        stated.liftsHold,
        count(lifts, (l) => l.status === 'hold')
      ),
      trailsOpen: pick(
        stated.trailsOpen,
        count(trails, (t) => t.status === 'open')
      ),
      trailsTotal: pick(stated.trailsTotal, trails.length),
      groomed: pick(
        stated.groomed,
        count(trails, (t) => t.groomed)
      ),
      acresOpen: stated.acresOpen ?? null,
      acresTotal: stated.acresTotal ?? null,
    },
    lifts,
    trails,
  };
}

/* ---- ReportPal (Brighton, Big Sky, Sugarloaf, Loon, Sunday River) ---- */
export function parseReportPalTerrain(data) {
  const areas = data?.facilities?.areas?.area;
  const list = Array.isArray(areas) ? areas : [];
  const lifts = [];
  const trails = [];
  for (const a of list) {
    for (const l of a?.lifts?.lift || []) {
      lifts.push(
        lift({
          name: l.name,
          area: a.name,
          rawStatus: l.status,
          type: l.type,
          wait: num(l.skierWaitTime),
          note: l.comment,
        })
      );
    }
    for (const t of a?.trails?.trail || []) {
      trails.push(
        trail({
          name: t.name,
          area: a.name,
          rawStatus: t.status,
          rawLevel: t.difficulty,
          groomed: t.groomed === true,
        })
      );
    }
  }
  const rw = data?.currentConditions?.resortwide || {};
  return build(lifts, trails, {
    liftsOpen: num(rw.numLiftsOpen),
    liftsTotal: num(rw.numLiftsTotal),
    liftsHold: num(rw.numLiftsOnHold),
    trailsOpen: num(rw.numTrailsOpen),
    trailsTotal: num(rw.numTrailsTotal),
    groomed: num(rw.numTrailsGroomed),
  });
}

/* ---- Jackson Hole ---- */
export function parseJacksonTerrain(data) {
  const lifts = Object.values(data?.lifts || {}).map((l) =>
    lift({
      name: l.name,
      rawStatus: l.openingStatus,
      type: l.liftType,
      note: l.message,
    })
  );
  const trails = Object.values(data?.trails || {}).map((t) =>
    trail({
      name: t.name,
      rawStatus: t.openingStatus,
      rawLevel: t.trailLevel,
      groomed: clean(t.groomingStatus) !== '',
    })
  );
  const ls = data?.liftStatus || {};
  const ts = data?.trailStatus || {};
  return build(lifts, trails, {
    liftsOpen: num(ls.openLifts),
    liftsTotal: num(ls.totalLifts),
    trailsOpen: num(ts.openTrails),
    trailsTotal: num(ts.totalTrails),
    groomed: num(ts.groomedTrails),
  });
}

/* ---- MtnPowder (Stratton, Sugarbush, Mammoth, Steamboat, ...) ---- */
export function parseMtnPowderTerrain(resort) {
  const areas = Array.isArray(resort?.MountainAreas)
    ? resort.MountainAreas
    : [];
  const lifts = [];
  const trails = [];
  for (const a of areas) {
    for (const l of a?.Lifts || []) {
      lifts.push(
        lift({
          name: l.Name,
          area: a.Name,
          rawStatus: l.StatusEnglish || l.Status,
          type: l.LiftType,
          wait: num(l.WaitTime),
        })
      );
    }
    for (const t of a?.Trails || []) {
      trails.push(
        trail({
          name: t.Name,
          area: a.Name,
          rawStatus: t.StatusEnglish || t.Status,
          rawLevel: t.Difficulty,
          groomed: /^yes$/i.test(clean(t.Grooming)),
        })
      );
    }
  }
  const r = resort?.SnowReport || {};
  return build(lifts, trails, {
    liftsOpen: num(r.TotalOpenLifts),
    liftsTotal: num(r.TotalLifts),
    trailsOpen: num(r.TotalOpenTrails),
    trailsTotal: num(r.TotalTrails),
    groomed: num(r.GroomedTrails),
    acresOpen: num(r.OpenTerrainAcres),
    acresTotal: num(r.TotalTerrainAcres),
  });
}

/* ---- Drupal (Snowbird, Copper, Mt. Bachelor, Eldora) ---- */
// Lifts and trails live at sibling endpoints of the snow report.
export function parseDrupalTerrain(liftsJson, trailsJson) {
  const lifts = (Array.isArray(liftsJson) ? liftsJson : [])
    .filter((l) => l?.season !== 'summer')
    .map((l) =>
      lift({
        name: l.name,
        area: l.sector?.name,
        rawStatus: l.status,
        type: l.type,
        wait: (num(l.waitTime?.waitTimeSecs) || 0) / 60,
        note: l.notes || l.hours,
      })
    );
  const trails = (Array.isArray(trailsJson) ? trailsJson : [])
    .filter(
      (t) =>
        t?.season !== 'summer' &&
        t?.include !== false &&
        (!t?.type || t.type === 'alpine_trail')
    )
    .map((t) =>
      trail({
        name: t.name,
        area: t.sector?.name,
        rawStatus: t.status,
        rawLevel: t.properties?.terrain_parks ? 'park' : t.difficulty,
        groomed: Boolean(t.groom_status) && t.groom_status !== 'not_groomed',
      })
    );
  return build(lifts, trails);
}

/**
 * @param {string} base proxy path ending in /api/v1/dor/drupal
 */
export async function fetchDrupalTerrain(base, { signal } = {}) {
  const get = async (name) => {
    const r = await fetch(`${base}/${name}`, { signal });
    if (!r.ok) throw new Error(`${name} fetch failed (${r.status})`);
    return r.json();
  };
  // Either list is useful on its own, so one failing doesn't sink the other
  const [lifts, trails] = await Promise.allSettled([
    get('lifts'),
    get('trails'),
  ]);
  if (lifts.status === 'rejected' && trails.status === 'rejected') {
    throw lifts.reason;
  }
  return parseDrupalTerrain(
    lifts.status === 'fulfilled' ? lifts.value : [],
    trails.status === 'fulfilled' ? trails.value : []
  );
}
