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
    .replace(/[^a-zA-Z0-9]/g, "");
}

function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function parseSelfTests(stdout) {
  const tests = [];
  let inProgress = null;
  let powerOnHours = null;
  
  if (!stdout) return { inProgress, history: tests, powerOnHours };

  // Look for active self-test status line
  const activeMatch = stdout.match(/Self-test in progress\s*\(?(\d+)%\s*remaining\)?/i) || 
                      stdout.match(/Self-test in progress\s+(\d+)%/i);
  if (activeMatch) {
    inProgress = {
      status: "In Progress",
      remaining: `${activeMatch[1]}%`
    };
  }

  // Parse Power On Hours if present
  const powerOnMatch = stdout.match(/Power On Hours:\s*([0-9,]+)/i) || 
                       stdout.match(/Power_On_Hours\s+\S+\s+\d+\s+\d+\s+\d+\s+\S+\s+\S+\s+\S+\s+(\d+)/i) ||
                       stdout.match(/Power_On_Hours\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+\S+\s+(\d+)/i);
  if (powerOnMatch) {
    powerOnHours = parseInt(powerOnMatch[1].replace(/,/g, ""), 10);
  }

  const lines = stdout.split(/\r?\n/);
  let tableStarted = false;
  lines.forEach((line) => {
    // Detect table headers
    if (line.includes("Test_Description") || line.includes("LBA_of_first_error") || line.includes("LBA_of_1st_error")) {
      tableStarted = true;
      return;
    }
    if (tableStarted) {
      // Line should start with # number, e.g. "# 1  Short offline..."
      const match = line.trim().match(/^#\s*(\d+)\s+([A-Za-z0-9\s._-]+?)\s{2,}(.+?)\s+(\d+%)\s+(\d+)\s+(.+)$/);
      if (match) {
        tests.push({
          num: match[1],
          description: match[2].trim(),
          status: match[3].trim(),
          remaining: match[4].trim(),
          lifetime: match[5].trim(),
          lba: match[6].trim()
        });
      } else {
        // Fallback match for shorter/different columns
        const simplerMatch = line.trim().match(/^#\s*(\d+)\s+([A-Za-z0-9\s._-]+?)\s{2,}(.+?)\s+(\d+%)/);
        if (simplerMatch) {
          tests.push({
            num: simplerMatch[1],
            description: simplerMatch[2].trim(),
            status: simplerMatch[3].trim(),
            remaining: simplerMatch[4].trim(),
            lifetime: "-",
            lba: "-"
          });
        }
      }
    }
  });

  return {
    inProgress,
    history: tests,
    powerOnHours
  };
}

export function parseNvmeCliSelfTest(jsonText) {
  try {
    const data = JSON.parse(jsonText);
    let inProgress = null;
    
    // current_operation: 0 = no active test, 1 = Short in progress, 2 = Extended in progress, etc.
    if (data.current_operation > 0) {
      inProgress = {
        status: "In Progress",
        remaining: `${100 - (data.completion_percentage || 0)}%`
      };
    }
    
    const results = (data.result_entries || []).map((entry, idx) => {
      const resultCode = entry.operation_result & 0xF;
      let status = "Unknown status";
      switch (resultCode) {
        case 0: status = "Completed without error"; break;
        case 1: status = "Aborted by Device Self-test command"; break;
        case 2: status = "Aborted by a Reset"; break;
        case 3: status = "Aborted due to electrical failure"; break;
        case 4: status = "Aborted due to fatal error"; break;
        case 5: status = "Aborted due to read error"; break;
        case 6: status = "Aborted due to write error"; break;
        case 7: status = "Aborted due to unknown error"; break;
        case 8: status = "Completed with error"; break;
        default: status = `Completed with error code ${resultCode}`;
      }
      
      const typeCode = entry.self_test_code;
      let description = "Unknown test";
      if (typeCode === 1) description = "Short device self-test";
      else if (typeCode === 2) description = "Extended device self-test";
      
      return {
        num: String(idx + 1),
        description,
        status,
        remaining: "00%",
        lifetime: String(entry.power_on_hours || "-"),
        lba: entry.failing_lba !== undefined ? String(entry.failing_lba) : "-"
      };
    });
    
    return {
      inProgress,
      history: results,
      powerOnHours: null // nvme-cli result has power_on_hours for each entry
    };
  } catch (err) {
    return null;
  }
}
