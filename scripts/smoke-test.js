#!/usr/bin/env node
const fs = require('fs/promises');
const path = require('path');

const REQUIRED_ELEVATIONS = ['base', 'mid', 'summit'];

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateElevations(elevations, index, errors, idLabel) {
  if (!elevations || typeof elevations !== 'object') {
    errors.push(`${idLabel}: missing elevations object`);
    return;
  }

  for (const key of REQUIRED_ELEVATIONS) {
    const entry = elevations[key];
    const ctx = `${idLabel} elevations.${key}`;
    if (!entry || typeof entry !== 'object') {
      errors.push(`${ctx} is missing`);
      continue;
    }

    if (!isNumber(entry.lat) || !isNumber(entry.lon)) {
      errors.push(`${ctx} lat/lon must be numbers`);
    }

    if (entry.elev_m != null && !isNumber(entry.elev_m)) {
      errors.push(`${ctx} elev_m must be a number when provided`);
    }
  }
}

function validateSources(sources, idLabel, errors) {
  if (!sources || typeof sources !== 'object') {
    errors.push(`${idLabel}: missing sources object`);
    return;
  }

  const hasValidFlag = ['nws', 'open_meteo', 'windy'].some(
    key => typeof sources[key] === 'boolean'
  );

  if (!hasValidFlag) {
    errors.push(`${idLabel}: sources should include at least one boolean flag`);
  }
}

function validateResort(resort, index, errors) {
  const idLabel = `resorts[${index}] (${resort?.id || 'unknown'})`;

  if (!isNonEmptyString(resort.id)) errors.push(`${idLabel}: missing id`);
  if (!isNonEmptyString(resort.name)) errors.push(`${idLabel}: missing name`);
  if (!isNonEmptyString(resort.region)) errors.push(`${idLabel}: missing region`);
  if (!isNonEmptyString(resort.country)) errors.push(`${idLabel}: missing country`);

  validateElevations(resort.elevations, index, errors, idLabel);
  validateSources(resort.sources, idLabel, errors);
}

async function loadJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf-8');
  try {
    return JSON.parse(raw);
  } catch (err) {
    throw new Error(`Failed to parse JSON: ${err.message}`);
  }
}

async function main() {
  const filePath = process.argv[2] || path.join(__dirname, '../public/resorts.json');
  const data = await loadJson(filePath);

  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('resorts.json must be a non-empty array');
  }

  const errors = [];
  data.forEach((resort, idx) => validateResort(resort, idx, errors));

  if (errors.length) {
    console.error('Smoke test failed:');
    errors.forEach(err => console.error(` - ${err}`));
    process.exit(1);
  }

  console.log(`Validated ${data.length} resorts from ${filePath}.`);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
