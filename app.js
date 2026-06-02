import { parseLsblk, parseSmartctl, parseZpoolList } from "./parsers.js";
import { smartDescriptions } from "./smart_descriptions.js";

const cockpit = window.cockpit;

function runCommand(args, options = {}) {
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

const disksEl = document.getElementById("disks");
const historyEl = document.getElementById("history");
const lastTsEl = document.getElementById("last-timestamp");
const diskCountEl = document.getElementById("disk-count");
const hostNameEl = document.getElementById("host-name");
const totalUsedEl = document.getElementById("total-used");
const totalAvailEl = document.getElementById("total-avail");
const btnCollect = document.getElementById("btn-collect");
const btnRefresh = document.getElementById("btn-refresh");
const compareA = document.getElementById("compare-a");
const compareB = document.getElementById("compare-b");
const btnCompare = document.getElementById("btn-compare");
const compareResult = document.getElementById("compare-result");

let snapshotFilePath = "";
let loadedSnapshotsList = [];

btnCollect.addEventListener("click", async () => {
  btnCollect.disabled = true;
  btnCollect.textContent = "Collecting...";
  try {
    const data = await collectSnapshot();
    renderSnapshot(data);
    await refreshHistory();
  } catch (err) {
    alert(err.message || err);
  } finally {
    btnCollect.disabled = false;
    btnCollect.textContent = "Collect Now";
  }
});

btnRefresh.addEventListener("click", async () => {
  await refreshHistory();
});

btnCompare.addEventListener("click", () => {
  const idA = compareA.value;
  const idB = compareB.value;
  if (!idA || !idB) return;

  const snapA = loadedSnapshotsList.find((s) => s.id === idA);
  const snapB = loadedSnapshotsList.find((s) => s.id === idB);
  if (!snapA || !snapB) {
    compareResult.innerHTML = `<div class="text-danger">Snapshot not found</div>`;
    return;
  }

  const mapByDisk = (snap) => {
    const map = new Map();
    for (const d of snap.disks) map.set(d.name, d);
    return map;
  };

  const mapA = mapByDisk(snapA);
  const mapB = mapByDisk(snapB);
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

  renderCompare({
    a: { id: snapA.id, timestamp: snapA.timestamp },
    b: { id: snapB.id, timestamp: snapB.timestamp },
    disks
  });
});

async function refreshHistory() {
  loadedSnapshotsList = await loadSnapshots(200);
  renderHistory(loadedSnapshotsList);
  fillCompare(loadedSnapshotsList);
  
  if (loadedSnapshotsList.length > 0) {
    renderSnapshot(loadedSnapshotsList[0]);
  }
}

async function collectSnapshot() {
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
  const snapshot = {
    id: `snap_${Date.now()}`,
    timestamp: new Date().toISOString(),
    host: hostname,
    totals,
    disks: disksWithSmart
  };

  await saveSnapshot(snapshot);
  return snapshot;
}

async function saveSnapshot(snapshot) {
  if (!snapshotFilePath) return;
  try {
    const dirPath = snapshotFilePath.substring(0, snapshotFilePath.lastIndexOf("/"));
    await runCommand(["mkdir", "-p", dirPath]);

    const file = window.cockpit.file(snapshotFilePath);
    let currentContent = "";
    try {
      currentContent = await file.read();
    } catch (e) {
      // File might not exist yet, ignore
    }

    let lines = currentContent ? currentContent.trim().split(/\r?\n/).filter(Boolean) : [];
    lines.push(JSON.stringify(snapshot));
    
    // Prune to last 500 entries
    if (lines.length > 500) {
      lines = lines.slice(lines.length - 500);
    }
    
    const newContent = lines.join("\n") + "\n";
    await file.replace(newContent);
  } catch (err) {
    console.error("Failed to save snapshot", err);
  }
}

async function loadSnapshots(limit = 100) {
  if (!snapshotFilePath) return [];
  try {
    const file = window.cockpit.file(snapshotFilePath);
    let content = "";
    try {
      content = await file.read();
    } catch (e) {
      // If file doesn't exist, return empty array
      return [];
    }

    const lines = content ? content.trim().split(/\r?\n/).filter(Boolean) : [];
    const parsed = lines.map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    }).filter(Boolean);
    return parsed.slice(-limit).reverse();
  } catch (err) {
    console.warn("Failed to load snapshots", err);
    return [];
  }
}

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

function getAttrRaw(disk, name) {
  const byName = disk.smart?.attributesByName || {};
  const item = byName[name] || (disk.smart?.attributes || []).find((a) => a.name.toLowerCase() === name);
  if (!item) return null;
  const num = Number(String(item.raw).replace(/[^\d.-]/g, ""));
  return Number.isFinite(num) ? num : item.raw;
}

function renderSnapshot(snapshot) {
  disksEl.innerHTML = "";
  lastTsEl.textContent = formatDate(snapshot.timestamp);
  diskCountEl.textContent = String(snapshot.disks.length);
  hostNameEl.textContent = snapshot.host || "-";
  totalUsedEl.textContent = snapshot.totals ? formatBytes(snapshot.totals.usedBytes) : "-";
  totalAvailEl.textContent = snapshot.totals ? formatBytes(snapshot.totals.availBytes) : "-";

  if (!snapshot.disks.length) {
    disksEl.innerHTML = "<div class='text-muted'>No disks found.</div>";
    return;
  }

  const tabs = document.createElement("ul");
  tabs.className = "nav nav-tabs";
  tabs.role = "tablist";

  const content = document.createElement("div");
  content.className = "tab-content mt-3";

  snapshot.disks.forEach((disk, idx) => {
    const slug = toTabId(disk.name || disk.path || String(idx));
    const tabId = `disk-tab-${slug}`;
    const paneId = `disk-pane-${slug}`;

    const tabItem = document.createElement("li");
    tabItem.className = "nav-item";
    tabItem.role = "presentation";

    const tabBtn = document.createElement("button");
    tabBtn.className = `nav-link${idx === 0 ? " active" : ""}`;
    tabBtn.id = tabId;
    tabBtn.type = "button";
    tabBtn.role = "tab";
    tabBtn.dataset.bsToggle = "tab";
    tabBtn.dataset.bsTarget = `#${paneId}`;
    tabBtn.ariaControls = paneId;
    tabBtn.ariaSelected = idx === 0 ? "true" : "false";
    tabBtn.textContent = disk.path || disk.name || `Disk ${idx + 1}`;

    tabItem.appendChild(tabBtn);
    tabs.appendChild(tabItem);

    const pane = document.createElement("div");
    pane.className = `tab-pane fade${idx === 0 ? " show active" : ""}`;
    pane.id = paneId;
    pane.role = "tabpanel";
    pane.ariaLabelledby = tabId;

    const health = (disk.smart?.health || "?").toUpperCase();
    const healthClass = health.includes("PASS") ? "good" : health.includes("FAIL") ? "bad" : "warn";
    const chartId = `chart-${slug}`;
    const chartAttrId = `chart-attr-${slug}`;

    const kindLabel = disk.kind ? disk.kind.toUpperCase() : "DISK";
    const fsInfo = renderFsInfo(disk.fs);
    const showAta = disk.kind !== "nvme" && (disk.smart?.attributes || []).length > 0;
    const showNvme = disk.kind === "nvme" && disk.smart?.nvme && Object.keys(disk.smart.nvme).length > 0;

    pane.innerHTML = `
      <div class="card disk-card shadow-sm h-100 fade-in">
        <div class="card-body">
          <div class="d-flex align-items-center justify-content-between">
            <div>
              <h3 class="h5 mb-1">${disk.path}</h3>
              <div class="disk-meta">${disk.model || "Unknown Model"} • ${disk.size || ""} • ${kindLabel}</div>
            </div>
            <span class="badge-health ${healthClass}">${health}</span>
          </div>
          <div class="mt-3 d-flex flex-wrap gap-3">
            <div>
              <div class="text-muted small">Temperature</div>
              <div class="fw-semibold">${disk.smart?.temperatureC ?? "-"} °C</div>
            </div>
            ${showAta ? `
            <div>
              <div class="text-muted small">Reallocated</div>
              <div class="fw-semibold">${getAttr(disk, "reallocated_sector_ct")}</div>
            </div>
            <div>
              <div class="text-muted small">Pending</div>
              <div class="fw-semibold">${getAttr(disk, "current_pending_sector")}</div>
            </div>
            <div>
              <div class="text-muted small">Offline Unc.</div>
              <div class="fw-semibold">${getAttr(disk, "offline_uncorrectable")}</div>
            </div>
            ` : ""}
            <div>
              <div class="text-muted small">Available</div>
              <div class="fw-semibold">${fsInfo.avail}</div>
            </div>
            <div>
              <div class="text-muted small">Total</div>
              <div class="fw-semibold">${fsInfo.total}</div>
            </div>
            <div>
              <div class="text-muted small">Usage</div>
              <div class="fw-semibold">${fsInfo.use}</div>
            </div>
          </div>
          ${showAta ? `<details class="mt-3">
            <summary class="text-info">View SMART attributes</summary>
            ${renderAttrsTable(disk.smart?.attributes || [])}
          </details>` : ""}
          ${showNvme ? `<details class="mt-3">
            <summary class="text-info">NVMe SMART (Key fields)</summary>
            ${renderNvme(disk.smart?.nvme || {})}
          </details>` : ""}
          <div class="mt-3">
            <div class="text-muted small">Temperature (History)</div>
            <canvas id="${chartId}" height="120"></canvas>
          </div>
          ${showAta ? `<div class="mt-3">
            <div class="text-muted small">Critical Attributes (History)</div>
            <canvas id="${chartAttrId}" height="120"></canvas>
          </div>` : ""}
          <div class="mt-3">
            <div class="d-flex align-items-center justify-content-between">
              <div class="fw-semibold">SMART Details</div>
              ${renderIssuesBadge(disk)}
            </div>
            ${renderSmartDetailsTable(disk)}
          </div>
        </div>
      </div>
    `;
    content.appendChild(pane);

    tabBtn.addEventListener("shown.bs.tab", () => {
      if (pane.dataset.chartsReady) return;
      pane.dataset.chartsReady = "1";
      renderCharts(disk.name, chartId, showAta ? chartAttrId : null);
    });

    if (idx === 0) {
      pane.dataset.chartsReady = "1";
      renderCharts(disk.name, chartId, showAta ? chartAttrId : null);
    }
  });

  disksEl.appendChild(tabs);
  disksEl.appendChild(content);

  // Initialize Bootstrap Tooltips
  if (window.bootstrap && window.bootstrap.Tooltip) {
    const tooltipTriggerList = document.querySelectorAll('[data-bs-toggle="tooltip"]');
    [...tooltipTriggerList].forEach(tooltipTriggerEl => new window.bootstrap.Tooltip(tooltipTriggerEl));
  }
}

function renderAttrsTable(attrs) {
  if (!attrs.length) return "<div class=\"text-muted mt-2\">No SMART data</div>";
  const rows = attrs
    .map(
      (a) => `
      <tr>
        <td>${a.id}</td>
        <td>${a.name}</td>
        <td>${a.value}</td>
        <td>${a.worst}</td>
        <td>${a.thresh}</td>
        <td>${escapeHtml(a.raw)}</td>
      </tr>`
    )
    .join("");
  return `
    <div class="table-responsive mt-2">
      <table class="table table-sm table-striped">
        <thead>
          <tr>
            <th>ID</th>
            <th>Name</th>
            <th>Value</th>
            <th>Worst</th>
            <th>Thresh</th>
            <th>Raw</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderSmartDetailsTable(disk) {
  const fsInfo = renderFsInfo(disk.fs);
  const health = (disk.smart?.health || "-").toUpperCase();
  const rows = [
    ["Health", health],
    ["Temperature", disk.smart?.temperatureC ?? "-"],
    ["Model", disk.model || "-"],
    ["Size", disk.size || "-"],
    ["Type", disk.kind ? disk.kind.toUpperCase() : "-"],
    ["Available", fsInfo.avail],
    ["Total", fsInfo.total],
    ["Usage", fsInfo.use],
    ["Reallocated", getAttr(disk, "reallocated_sector_ct")],
    ["Pending", getAttr(disk, "current_pending_sector")],
    ["Offline Unc.", getAttr(disk, "offline_uncorrectable")],
    ["CRC Errors", getAttr(disk, "udma_crc_error_count")]
  ];

  const nvme = disk.smart?.nvme || {};
  Object.keys(nvme).forEach((key) => {
    rows.push([`NVMe ${toLabel(key)}`, nvme[key]]);
  });

  const body = rows
    .map(([label, value]) => {
      const lookupKey = label.startsWith("NVMe ") ? label.substring(5).toLowerCase() : label.toLowerCase();
      const desc = smartDescriptions[lookupKey] || "";
      const tooltipHtml = desc 
        ? ` <span class="text-muted" style="cursor: help;" data-bs-toggle="tooltip" data-bs-placement="top" title="${escapeHtml(desc)}">ⓘ</span>`
        : "";
      return `<tr><th scope="row">${label}${tooltipHtml}</th><td>${escapeHtml(value)}</td></tr>`;
    })
    .join("");

  return `
    <div class="table-responsive mt-2">
      <table class="table table-sm mb-0">
        <tbody>${body}</tbody>
      </table>
    </div>
  `;
}

function renderIssuesBadge(disk) {
  const issues = [];
  const health = (disk.smart?.health || "").toUpperCase();
  if (health.includes("FAIL")) issues.push("Health FAIL");
  if (!health || health === "-" || health === "?") issues.push("Health unavailable");
  if (disk.smartError) issues.push(disk.smartError);

  const reallocated = getAttr(disk, "reallocated_sector_ct");
  const pending = getAttr(disk, "current_pending_sector");
  const offline = getAttr(disk, "offline_uncorrectable");
  const crc = getAttr(disk, "udma_crc_error_count");
  const hasNumber = (v) => v !== "-" && v !== null && v !== undefined && String(v).trim() !== "";
  if (hasNumber(reallocated) && Number(reallocated) > 0) issues.push("Reallocated > 0");
  if (hasNumber(pending) && Number(pending) > 0) issues.push("Pending > 0");
  if (hasNumber(offline) && Number(offline) > 0) issues.push("Offline Unc. > 0");
  if (hasNumber(crc) && Number(crc) > 0) issues.push("CRC Errors > 0");

  if (!issues.length) return "<span class=\"badge issue-badge ok\">OK</span>";

  const title = escapeHtml(issues.join(" | "));
  return `<span class="badge issue-badge danger" title="${title}">WARNING</span>`;
}

function renderNvme(nvme) {
  const keys = Object.keys(nvme || {});
  if (!keys.length) return "<div class=\"text-muted mt-2\">No NVMe data</div>";
  const rows = keys
    .map((key) => {
      const label = toLabel(key);
      const desc = smartDescriptions[key.toLowerCase()] || smartDescriptions[label.toLowerCase()] || "";
      const tooltipHtml = desc 
        ? ` <span class="text-muted" style="cursor: help;" data-bs-toggle="tooltip" data-bs-placement="top" title="${escapeHtml(desc)}">ⓘ</span>`
        : "";
      return `<tr><td>${label}${tooltipHtml}</td><td>${escapeHtml(nvme[key])}</td></tr>`;
    })
    .join("");
  return `
    <div class="table-responsive mt-2">
      <table class="table table-sm table-striped">
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderHistory(snapshots) {
  if (!snapshots.length) {
    historyEl.innerHTML = "<div class='text-muted'>No snapshots yet.</div>";
    return;
  }
  const rows = snapshots
    .map(
      (s) => `
      <tr>
        <td>${s.id}</td>
        <td>${formatDate(s.timestamp)}</td>
        <td>${s.host || ""}</td>
        <td>${s.diskCount || (s.disks || []).length}</td>
        <td>${s.totals ? formatBytes(s.totals.usedBytes) : "-"}</td>
        <td>${s.totals ? formatBytes(s.totals.availBytes) : "-"}</td>
        <td>${formatPerDiskAvail(s.perDiskAvail || (s.disks || []).filter((d) => d.fs && d.fs.availBytes !== null).map((d) => ({ name: d.name, availBytes: d.fs.availBytes })))}</td>
      </tr>`
    )
    .join("");
  historyEl.innerHTML = `
    <table class="table table-striped table-sm">
      <thead>
        <tr>
          <th>ID</th>
          <th>Date</th>
          <th>Host</th>
          <th>Disks</th>
          <th>Total Used</th>
          <th>Total Available</th>
          <th>Available per Disk</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function fillCompare(snapshots) {
  const buildOptions = (target) => {
    target.innerHTML = "<option value=''>Select</option>";
    snapshots.forEach((s) => {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = `${formatDate(s.timestamp)} (${s.id})`;
      target.appendChild(opt);
    });
  };
  buildOptions(compareA);
  buildOptions(compareB);
}

function renderCompare(data) {
  if (!data.disks.length) {
    compareResult.innerHTML = "<div class='text-muted'>No common disks.</div>";
    return;
  }
  const blocks = data.disks
    .map((d) => {
      return `
      <div class="mb-3">
        <h3 class="h6">${d.name}</h3>
        <div class="row g-2">
          <div class="col-md-6">
            <div class="p-2 border rounded">Snapshot A: ${formatDate(data.a.timestamp)}<br />
              Health: ${d.healthA || "-"}<br />
              Temp: ${d.temperatureA ?? "-"} °C<br />
              Reallocated: ${d.attrsA.reallocated_sector_ct || "-"}<br />
              Pending: ${d.attrsA.current_pending_sector || "-"}<br />
              Offline Unc.: ${d.attrsA.offline_uncorrectable || "-"}
            </div>
          </div>
          <div class="col-md-6">
            <div class="p-2 border rounded">Snapshot B: ${formatDate(data.b.timestamp)}<br />
              Health: ${d.healthB || "-"}<br />
              Temp: ${d.temperatureB ?? "-"} °C<br />
              Reallocated: ${d.attrsB.reallocated_sector_ct || "-"}<br />
              Pending: ${d.attrsB.current_pending_sector || "-"}<br />
              Offline Unc.: ${d.attrsB.offline_uncorrectable || "-"}
            </div>
          </div>
        </div>
      </div>`;
    })
    .join("");

  compareResult.innerHTML = blocks;
}

function getAttr(disk, name) {
  const attrs = disk.smart?.attributes || [];
  const item = attrs.find((a) => a.name.toLowerCase() === name);
  return item ? item.raw : "-";
}

function formatDate(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleString();
}

function formatBytes(bytes) {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return "-";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let value = Number(bytes);
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(1)} ${units[i]}`;
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function renderCharts(diskName, tempCanvasId, attrCanvasId) {
  if (!window.Chart) return;
  try {
    const snaps = await loadSnapshots(500);
    const items = snaps
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

    const labels = items.map((i) => formatDate(i.timestamp));
    const temps = items.map((i) => i.temperatureC ?? null);
    const reallocated = items.map((i) => i.reallocated_sector_ct ?? null);
    const pending = items.map((i) => i.current_pending_sector ?? null);
    const offline = items.map((i) => i.offline_uncorrectable ?? null);
    const crc = items.map((i) => i.udma_crc_error_count ?? null);

    const tempCtx = document.getElementById(tempCanvasId);
    if (tempCtx) {
      new Chart(tempCtx, {
        type: "line",
        data: {
          labels,
          datasets: [
            {
              label: "Temperature °C",
              data: temps,
              borderColor: "#38bdf8",
              backgroundColor: "rgba(56,189,248,0.15)",
              tension: 0.2,
              fill: true,
              spanGaps: true
            }
          ]
        },
        options: chartOptions()
      });
    }

    const attrCtx = attrCanvasId ? document.getElementById(attrCanvasId) : null;
    if (attrCtx) {
      new Chart(attrCtx, {
        type: "line",
        data: {
          labels,
          datasets: [
            dataset("Reallocated", reallocated, "#fbbf24"),
            dataset("Pending", pending, "#f97316"),
            dataset("Offline Unc.", offline, "#f87171"),
            dataset("CRC Errors", crc, "#a3e635")
          ]
        },
        options: chartOptions()
      });
    }
  } catch (err) {
    console.warn("Chart rendering error", err);
  }
}

function dataset(label, data, color) {
  return {
    label,
    data,
    borderColor: color,
    backgroundColor: color + "22",
    tension: 0.2,
    fill: false,
    spanGaps: true
  };
}

function chartOptions() {
  return {
    responsive: true,
    plugins: {
      legend: { labels: { color: "#475569" } }
    },
    scales: {
      x: { ticks: { color: "#475569" }, grid: { color: "rgba(148,163,184,0.15)" } },
      y: { ticks: { color: "#475569" }, grid: { color: "rgba(148,163,184,0.15)" } }
    }
  };
}

function toTabId(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "disk";
}

function toLabel(key) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

function renderFsInfo(fs) {
  if (!fs) return { total: "-", avail: "-", use: "-" };
  return {
    total: formatBytes(fs.totalBytes),
    avail: formatBytes(fs.availBytes),
    use: fs.usePercent !== null && fs.usePercent !== undefined ? `${fs.usePercent}%` : "-"
  };
}

function formatPerDiskAvail(items) {
  if (!items.length) return "-";
  return items
    .map((i) => `${i.name}: ${formatBytes(i.availBytes)}`)
    .join("; ");
}

async function init() {
  if (!window.cockpit) {
    console.warn("Cockpit bridge not ready yet. Retrying in 50ms...");
    setTimeout(init, 50);
    return;
  }

  try {
    const userInfo = await window.cockpit.user();
    snapshotFilePath = `${userInfo.home}/.local/share/disk-health/snapshots.jsonl`;
  } catch (err) {
    console.warn("Failed to get user home directory, using fallback path.", err);
    snapshotFilePath = "/tmp/snapshots.jsonl";
  }

  console.log("Disk Health extension initialized. History file path:", snapshotFilePath);
  await refreshHistory();
}

// Start Initialization
init();
