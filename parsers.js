export function parseLsblk(jsonText) {
  try {
    const data = JSON.parse(jsonText);
    return data.blockdevices || [];
  } catch (err) {
    return [];
  }
}

export function flattenDisks(blockDevices) {
  const disks = [];
  for (const dev of blockDevices) {
    if (dev.type === "disk") {
      disks.push({
        name: dev.name,
        path: `/dev/${dev.name}`,
        model: dev.model || "",
        size: dev.size || "",
        tran: dev.tran || "",
        rota: dev.rota
      });
    }
  }
  return disks;
}

export function parseSmartctl(text) {
  const result = {
    health: null,
    temperatureC: null,
    attributes: [],
    meta: {},
    attributesByName: {},
    nvme: {}
  };

  const healthMatch =
    text.match(/SMART overall-health self-assessment test result:\s*(.+)/i) ||
    text.match(/SMART Health Status:\s*(.+)/i) ||
    text.match(/SMART overall-health:\s*(.+)/i);
  if (healthMatch) result.health = healthMatch[1].trim();

  const tempMatches = [
    /Temperature_Celsius\s+\S+\s+\d+\s+\d+\s+\d+\s+\S+\s+\S+\s+\S+\s+(-?\d+)/i,
    /Current Drive Temperature:\s*(\d+)/i,
    /Temperature:\s*(\d+)\s*C/i,
    /Temperature Sensor 1:\s*(\d+)\s*C/i
  ];
  for (const rx of tempMatches) {
    const m = text.match(rx);
    if (m) {
      result.temperatureC = Number(m[1]);
      break;
    }
  }

  // Key/value meta lines
  const metaKeys = [
    "Model Family",
    "Device Model",
    "Model Number",
    "Serial Number",
    "Firmware Version",
    "User Capacity",
    "Rotation Rate",
    "Form Factor",
    "SATA Version",
    "ATA Version",
    "NVMe Version",
    "Namespace 1 Size/Capacity",
    "Local Time is"
  ];
  for (const key of metaKeys) {
    const rx = new RegExp(`^${escapeRegex(key)}:\\s*(.+)$`, "im");
    const m = text.match(rx);
    if (m) result.meta[toCamel(key)] = m[1].trim();
  }

  // Parse SMART attributes table when present (ATA)
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    if (/^\s*\d+\s+\S+\s+\S+\s+\d+\s+\d+\s+\d+\s+\S+\s+\S+\s+\S+\s+\S+/.test(line)) {
      const parts = line.trim().split(/\s+/);
      const id = Number(parts[0]);
      const name = parts[1];
      const value = Number(parts[3]);
      const worst = Number(parts[4]);
      const thresh = Number(parts[5]);
      const raw = parts.slice(9).join(" ");
      const attr = { id, name, value, worst, thresh, raw };
      result.attributes.push(attr);
      result.attributesByName[name.toLowerCase()] = attr;
    }
  }

  // NVMe SMART log fields (Key: value)
  const nvmeKeys = [
    "Critical Warning",
    "Temperature",
    "Available Spare",
    "Available Spare Threshold",
    "Percentage Used",
    "Data Units Read",
    "Data Units Written",
    "Host Read Commands",
    "Host Write Commands",
    "Controller Busy Time",
    "Power Cycles",
    "Power On Hours",
    "Unsafe Shutdowns",
    "Media and Data Integrity Errors",
    "Error Information Log Entries",
    "Warning  Comp. Temperature Time",
    "Critical Comp. Temperature Time",
    "Thermal Temp. 1 Transition Count",
    "Thermal Temp. 2 Transition Count",
    "Thermal Temp. 1 Total Time",
    "Thermal Temp. 2 Total Time"
  ];
  for (const key of nvmeKeys) {
    const rx = new RegExp(`^${escapeRegex(key)}:\\s*(.+)$`, "im");
    const m = text.match(rx);
    if (m) result.nvme[toCamel(key)] = m[1].trim();
  }

  // Fallback for ATA temperature using attributes table
  if (result.temperatureC === null) {
    const tempAttr = result.attributes.find(a => a.id === 194 || a.id === 190);
    if (tempAttr && tempAttr.raw) {
      const m = tempAttr.raw.match(/^(-?\d+)/);
      if (m) {
        result.temperatureC = Number(m[1]);
      }
    }
  }

  // Fallback for NVMe temperature using nvme metadata
  if (result.temperatureC === null && result.nvme && result.nvme.temperature) {
    const m = result.nvme.temperature.match(/^(-?\d+)/);
    if (m) {
      result.temperatureC = Number(m[1]);
    }
  }

  return result;
}

export function parseZpoolList(stdout) {
  const map = new Map();
  if (!stdout) return map;
  const lines = stdout.trim().split(/\r?\n/);
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length >= 4) {
      const name = parts[0];
      const size = toNumber(parts[1]);
      const alloc = toNumber(parts[2]);
      const free = toNumber(parts[3]);
      map.set(name, { size, alloc, free });
    }
  }
  return map;
}

function toNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const num = Number(String(value).trim());
  return Number.isFinite(num) ? num : null;
}

function toCamel(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+(.)/g, (_, chr) => chr.toUpperCase())
    .replace(/[^a-z0-9]/g, "");
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
