import fs from "fs";
import path from "path";

export function ensureDataDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function appendJsonl(dir, snapshot) {
  const filePath = path.join(dir, "snapshots.jsonl");
  fs.appendFileSync(filePath, JSON.stringify(snapshot) + "\n");
}

export function appendCsv(dir, snapshot) {
  const filePath = path.join(dir, "snapshots.csv");
  const header = [
    "id",
    "timestamp",
    "host",
    "disk",
    "disk_type",
    "model",
    "size",
    "size_bytes",
    "fs_total_bytes",
    "fs_used_bytes",
    "fs_avail_bytes",
    "fs_use_percent",
    "health",
    "temperature_c",
    "reallocated_sector_ct",
    "current_pending_sector",
    "offline_uncorrectable",
    "udma_crc_error_count",
    "power_on_hours",
    "power_cycle_count"
  ];

  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, header.join(",") + "\n");
  }

  for (const disk of snapshot.disks) {
    const attrs = disk.smart?.attributes || [];
    const byName = disk.smart?.attributesByName || {};
    const findRaw = (name) => {
      const item = byName[name] || attrs.find((a) => a.name.toLowerCase() === name);
      return item ? item.raw.replace(/,/g, " ") : "";
    };

    const row = [
      snapshot.id,
      snapshot.timestamp,
      snapshot.host,
      disk.name,
      disk.kind || "",
      escapeCsv(disk.model),
      escapeCsv(disk.size),
      disk.sizeBytes ?? "",
      disk.fs?.totalBytes ?? "",
      disk.fs?.usedBytes ?? "",
      disk.fs?.availBytes ?? "",
      disk.fs?.usePercent ?? "",
      escapeCsv(disk.smart?.health || ""),
      disk.smart?.temperatureC ?? "",
      escapeCsv(findRaw("reallocated_sector_ct")),
      escapeCsv(findRaw("current_pending_sector")),
      escapeCsv(findRaw("offline_uncorrectable")),
      escapeCsv(findRaw("udma_crc_error_count")),
      escapeCsv(findRaw("power_on_hours")),
      escapeCsv(findRaw("power_cycle_count"))
    ];

    fs.appendFileSync(filePath, row.join(",") + "\n");
  }
}

function escapeCsv(value) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
  return text;
}

export function loadSnapshots(dir, limit = 100) {
  const filePath = path.join(dir, "snapshots.jsonl");
  if (!fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, "utf8").trim().split(/\r?\n/).filter(Boolean);
  const parsed = lines.map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return null;
    }
  }).filter(Boolean);
  return parsed.slice(-limit).reverse();
}

export function findSnapshot(dir, id) {
  const items = loadSnapshots(dir, 1000);
  return items.find((s) => s.id === id) || null;
}
