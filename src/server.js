import path from "path";
import express from "express";
import dotenv from "dotenv";
import { runSshCommand } from "./ssh.js";
import { parseLsblk, parseSmartctl, parseZpoolList } from "./parsers.js";
import { ensureDataDir, appendJsonl, appendCsv, loadSnapshots, findSnapshot } from "./storage.js";

dotenv.config();

const app = express();
app.use(express.json());

const ROOT = path.resolve(".");
const DATA_DIR = path.resolve(process.env.DATA_DIR || "./data");
const PORT = Number(process.env.PORT || 3000);

ensureDataDir(DATA_DIR);

const sshConfig = {
  host: process.env.SSH_HOST,
  port: Number(process.env.SSH_PORT || 22),
  username: process.env.SSH_USER,
  password: process.env.SSH_PASSWORD,
  privateKeyPath: process.env.SSH_PRIVATE_KEY,
  passphrase: process.env.SSH_PASSPHRASE
};

const LSBLK_PATH = process.env.LSBLK_PATH || "lsblk";
const SMARTCTL_PATH = process.env.SMARTCTL_PATH || "smartctl";
const SMARTCTL_USE_SUDO = String(process.env.SMARTCTL_USE_SUDO || "false").toLowerCase() === "true";
const DISK_INCLUDE_REGEX = process.env.DISK_INCLUDE_REGEX ? new RegExp(process.env.DISK_INCLUDE_REGEX) : null;
const SSH_READY_COMMAND = (process.env.SSH_READY_COMMAND || "").trim();
const SCHEDULE_ENABLED = String(process.env.SCHEDULE_ENABLED || "false").toLowerCase() === "true";
const SCHEDULE_DAILY_TIME = (process.env.SCHEDULE_DAILY_TIME || "14:00").trim();

app.use(express.static(path.join(ROOT, "public")));

app.get("/api/snapshots", (req, res) => {
  const snapshots = loadSnapshots(DATA_DIR, 200).map((s) => ({
    id: s.id,
    timestamp: s.timestamp,
    host: s.host,
    diskCount: s.disks.length,
    totals: s.totals || null,
    perDiskAvail: (s.disks || [])
      .filter((d) => d.fs && d.fs.availBytes !== null && d.fs.availBytes !== undefined)
      .map((d) => ({ name: d.name, availBytes: d.fs.availBytes }))
  }));
  res.json({ snapshots });
});

app.get("/api/snapshot/:id", (req, res) => {
  const snap = findSnapshot(DATA_DIR, req.params.id);
  if (!snap) return res.status(404).json({ error: "snapshot_not_found" });
  res.json(snap);
});

app.get("/api/compare", (req, res) => {
  const a = findSnapshot(DATA_DIR, req.query.idA);
  const b = findSnapshot(DATA_DIR, req.query.idB);
  if (!a || !b) return res.status(404).json({ error: "snapshot_not_found" });

  const mapByDisk = (snap) => {
    const map = new Map();
    for (const d of snap.disks) map.set(d.name, d);
    return map;
  };

  const mapA = mapByDisk(a);
  const mapB = mapByDisk(b);
  const disks = [];

  for (const [name, diskA] of mapA.entries()) {
    const diskB = mapB.get(name);
    if (!diskB) continue;
    disks.push({
      name,
      healthA: diskA.smart?.health || "",
      healthB: diskB.smart?.health || "",
      temperatureA: diskA.smart?.temperatureC ?? null,
      temperatureB: diskB.smart?.temperatureC ?? null,
      attrsA: simplifyAttrs(diskA.smart?.attributes || []),
      attrsB: simplifyAttrs(diskB.smart?.attributes || [])
    });
  }

  res.json({
    a: { id: a.id, timestamp: a.timestamp },
    b: { id: b.id, timestamp: b.timestamp },
    disks
  });
});

app.get("/api/timeseries", (req, res) => {
  const diskName = String(req.query.disk || "").trim();
  if (!diskName) return res.status(400).json({ error: "missing_disk" });

  const items = loadSnapshots(DATA_DIR, 500)
    .map((s) => {
      const disk = s.disks.find((d) => d.name === diskName);
      if (!disk) return null;
      return {
        timestamp: s.timestamp,
        temperatureC: disk.smart?.temperatureC ?? null,
        reallocated_sector_ct: getAttrRaw(disk, "reallocated_sector_ct"),
        current_pending_sector: getAttrRaw(disk, "current_pending_sector"),
        offline_uncorrectable: getAttrRaw(disk, "offline_uncorrectable"),
        udma_crc_error_count: getAttrRaw(disk, "udma_crc_error_count"),
        power_on_hours: getAttrRaw(disk, "power_on_hours"),
        power_cycle_count: getAttrRaw(disk, "power_cycle_count")
      };
    })
    .filter(Boolean)
    .reverse();

  res.json({ disk: diskName, items });
});

app.post("/api/collect", async (req, res) => {
  try {
    if (!sshConfig.host || !sshConfig.username) {
      return res.status(400).json({ error: "missing_ssh_config" });
    }

    const snapshot = await collectSnapshot();
    res.json(snapshot);
  } catch (err) {
    res.status(500).json({ error: "collect_failed", detail: String(err?.message || err) });
  }
});

function simplifyAttrs(attrs) {
  const pick = (name) => {
    const item = attrs.find((a) => a.name.toLowerCase() === name);
    return item ? item.raw : null;
  };
  return {
    reallocated_sector_ct: pick("reallocated_sector_ct"),
    current_pending_sector: pick("current_pending_sector"),
    offline_uncorrectable: pick("offline_uncorrectable"),
    udma_crc_error_count: pick("udma_crc_error_count")
  };
}

app.listen(PORT, () => {
  console.log(`disk-health-remote listening on ${PORT}`);
});

let scheduleBusy = false;
if (SCHEDULE_ENABLED) {
  scheduleDaily(SCHEDULE_DAILY_TIME);
}

async function collectSnapshot() {
  if (!sshConfig.host || !sshConfig.username) {
    throw new Error("missing_ssh_config");
  }
  const readyPrefix = SSH_READY_COMMAND ? `${SSH_READY_COMMAND} && ` : "";

  let zpoolMap = null;
  try {
    const zpoolCmd = `${readyPrefix}zpool list -p -H -o name,size,alloc,free`;
    const zpoolResult = await runSshCommand(sshConfig, zpoolCmd);
    if (zpoolResult.code === 0 && zpoolResult.stdout) {
      zpoolMap = parseZpoolList(zpoolResult.stdout);
    }
  } catch (err) {
    console.warn("Failed to get zpool list:", err?.message || err);
  }

  const lsblkCmd = `${readyPrefix}${LSBLK_PATH} -J -b -o NAME,MODEL,SIZE,TYPE,TRAN,ROTA,MOUNTPOINT,FSTYPE,FSAVAIL,FSUSED,FSUSE%,LABEL`;
  const lsblkResult = await runSshCommand(sshConfig, lsblkCmd);

  if (lsblkResult.code !== 0) {
    throw new Error(`lsblk_failed: ${lsblkResult.stderr}`);
  }

  const blockdevices = parseLsblk(lsblkResult.stdout);
  let disks = buildDisks(blockdevices, zpoolMap);
  if (DISK_INCLUDE_REGEX) {
    disks = disks.filter((d) => DISK_INCLUDE_REGEX.test(d.name));
  }

  const disksWithSmart = [];
  for (const disk of disks) {
    const smartCmdBase = `${SMARTCTL_PATH} -a ${disk.path}`;
    const smartCmd = SMARTCTL_USE_SUDO ? `sudo -n ${smartCmdBase}` : smartCmdBase;
    const smartResult = await runSshCommand(sshConfig, `${readyPrefix}${smartCmd}`);
    const smartRaw = smartResult.stdout || "";
    const smart = smartRaw
      ? parseSmartctl(smartRaw)
      : { health: null, temperatureC: null, attributes: [], meta: {}, attributesByName: {} };
    disksWithSmart.push({
      ...disk,
      smart,
      smartRaw,
      smartError: smartResult.code === 0 ? null : smartResult.stderr.trim()
    });
  }

  const totals = buildTotals(disksWithSmart);
  const snapshot = {
    id: `snap_${Date.now()}`,
    timestamp: new Date().toISOString(),
    host: sshConfig.host,
    totals,
    disks: disksWithSmart
  };

  appendJsonl(DATA_DIR, snapshot);
  appendCsv(DATA_DIR, snapshot);

  return snapshot;
}

function getAttrRaw(disk, name) {
  const byName = disk.smart?.attributesByName || {};
  const item = byName[name] || (disk.smart?.attributes || []).find((a) => a.name.toLowerCase() === name);
  if (!item) return null;
  const num = Number(String(item.raw).replace(/[^\d.-]/g, ""));
  return Number.isFinite(num) ? num : item.raw;
}

function buildDisks(blockdevices, zpoolMap) {
  const disks = [];
  for (const dev of blockdevices) {
    if (dev.type !== "disk") continue;
    const disk = {
      name: dev.name,
      path: `/dev/${dev.name}`,
      model: dev.model || "",
      sizeBytes: toNumber(dev.size),
      size: formatBytes(toNumber(dev.size)),
      tran: dev.tran || "",
      rota: dev.rota,
      kind: detectKind(dev),
      fs: buildFs(dev, zpoolMap)
    };
    disks.push(disk);
  }
  return disks;
}

function detectKind(dev) {
  if (String(dev.name || "").startsWith("nvme")) return "nvme";
  if (dev.tran && String(dev.tran).toLowerCase() === "nvme") return "nvme";
  if (dev.rota === 1) return "hdd";
  if (dev.rota === 0) return "ssd";
  return "disk";
}

function buildFs(dev, zpoolMap) {
  const entries = [];
  const collect = (node) => {
    const mountpoint = node.mountpoint || (Array.isArray(node.mountpoints) ? node.mountpoints.find(Boolean) : null);
    if (mountpoint) {
      entries.push({
        mountpoint,
        fstype: node.fstype || "",
        fsavail: toNumber(node.fsavail),
        fsused: toNumber(node.fsused)
      });
    } else if (node.fstype === "zfs_member" && node.label && zpoolMap && zpoolMap.has(node.label)) {
      const poolInfo = zpoolMap.get(node.label);
      entries.push({
        mountpoint: `[ZFS] ${node.label}`,
        fstype: "zfs",
        fsavail: poolInfo.free,
        fsused: poolInfo.alloc
      });
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) collect(child);
    }
  };
  collect(dev);

  if (!entries.length) return null;
  const usedBytes = sumNums(entries.map((e) => e.fsused));
  const availBytes = sumNums(entries.map((e) => e.fsavail));
  const totalBytes = usedBytes !== null && availBytes !== null ? usedBytes + availBytes : null;
  const usePercent = totalBytes ? Math.round((usedBytes / totalBytes) * 1000) / 10 : null;

  return {
    entries,
    usedBytes,
    availBytes,
    totalBytes,
    usePercent
  };
}

function buildTotals(disks) {
  const fsDisks = disks.filter((d) => d.fs && d.fs.usedBytes !== null && d.fs.availBytes !== null);
  if (!fsDisks.length) return null;
  const usedBytes = sumNums(fsDisks.map((d) => d.fs.usedBytes));
  const availBytes = sumNums(fsDisks.map((d) => d.fs.availBytes));
  const totalBytes = usedBytes + availBytes;
  const usePercent = totalBytes ? Math.round((usedBytes / totalBytes) * 1000) / 10 : null;
  return { usedBytes, availBytes, totalBytes, usePercent };
}

function toNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const num = Number(String(value).trim());
  return Number.isFinite(num) ? num : null;
}

function sumNums(nums) {
  const valid = nums.filter((n) => typeof n === "number" && Number.isFinite(n));
  if (!valid.length) return null;
  return valid.reduce((a, b) => a + b, 0);
}

function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return "";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(1)} ${units[i]}`;
}

function scheduleDaily(timeText) {
  const [hourStr, minStr] = timeText.split(":");
  const hour = clampInt(hourStr, 0, 23, 14);
  const minute = clampInt(minStr, 0, 59, 0);

  const scheduleNext = () => {
    const now = new Date();
    const next = new Date();
    next.setHours(hour, minute, 0, 0);
    if (next <= now) next.setDate(next.getDate() + 1);
    const delay = next.getTime() - now.getTime();

    setTimeout(async () => {
      if (!scheduleBusy) {
        scheduleBusy = true;
        try {
          await collectSnapshot();
        } catch (err) {
          console.error("scheduled collection failed:", err?.message || err);
        } finally {
          scheduleBusy = false;
        }
      }
      scheduleNext();
    }, delay);
  };

  scheduleNext();
}

function clampInt(value, min, max, fallback) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}
