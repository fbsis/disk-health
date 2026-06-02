import { parseLsblk, parseSmartctl, parseZpoolList } from "./parsers.js";
import { toNumber, formatBytes, detectKind, sumNums } from "./utils.js";

const cockpit = window.cockpit;

export function runCommand(args, options = {}) {
  return new Promise((resolve) => {
    if (!cockpit) {
      resolve({ stdout: "", code: -1, error: "Cockpit not loaded" });
      return;
    }
    cockpit.spawn(args, options)
      .done((stdout) => {
        resolve({ stdout, code: 0 });
      })
      .fail((exception, stdout) => {
        resolve({
          stdout: stdout || "",
          code: exception.exit_status || exception.close || -1,
          error: exception.message || String(exception)
        });
      });
  });
}

export async function collectSnapshot() {
  let hostname = "localhost";
  const hostnameRes = await runCommand(["hostname"]);
  if (hostnameRes.code === 0) {
    hostname = hostnameRes.stdout.trim();
  }

  let zpoolMap = null;
  const zpoolRes = await runCommand(["zpool", "list", "-p", "-H", "-o", "name,size,alloc,free"]);
  if (zpoolRes.code === 0 && zpoolRes.stdout) {
    zpoolMap = parseZpoolList(zpoolRes.stdout);
  }

  const lsblkRes = await runCommand([
    "lsblk", "-J", "-b", "-o", "NAME,MODEL,SIZE,TYPE,TRAN,ROTA,MOUNTPOINT,FSTYPE,FSAVAIL,FSUSED,FSUSE%,LABEL"
  ]);
  if (lsblkRes.code !== 0) {
    throw new Error(`lsblk failed: ${lsblkRes.error || "unknown error"}`);
  }
  
  const blockdevices = parseLsblk(lsblkRes.stdout);
  const disks = buildDisks(blockdevices, zpoolMap);

  const disksWithSmart = [];
  for (const disk of disks) {
    let smart = { health: null, temperatureC: null, attributes: [], meta: {}, attributesByName: {}, nvme: {} };
    let smartError = null;
    let smartRaw = "";
    
    const smartRes = await runCommand(["smartctl", "-a", disk.path], { superuser: "require" });
    smartRaw = smartRes.stdout;
    if (smartRaw) {
      smart = parseSmartctl(smartRaw);
    } else {
      smartError = smartRes.error || "Failed to retrieve SMART details";
    }

    disksWithSmart.push({
      ...disk,
      smart,
      smartRaw,
      smartError
    });
  }

  const totals = buildTotals(disksWithSmart);
  return {
    id: `snap_${Date.now()}`,
    timestamp: new Date().toISOString(),
    host: hostname,
    totals,
    disks: disksWithSmart
  };
}

function buildDisks(blockdevices, zpoolMap) {
  const disks = [];
  for (const dev of blockdevices) {
    if (dev.type !== "disk") continue;
    // Exclude loop devices and ZFS zvols (zd*)
    if (dev.name.startsWith("loop") || dev.name.startsWith("zd")) continue;
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
