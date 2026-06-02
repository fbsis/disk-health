import { collectSnapshot, runCommand } from "./data_collector.js";
import { parseHdparmPowerState } from "./parsers.js";
import { 
  setSnapshotFilePath, 
  saveSnapshot, 
  loadSnapshots, 
  setLoadedSnapshotsList,
  getLoadedSnapshotsList
} from "./history_manager.js";
import { 
  renderSnapshot, 
  renderHistory, 
  fillCompare, 
  renderCompare 
} from "./ui_renderer.js";
import { setupScheduler } from "./scheduler_manager.js";

const btnCollect = document.getElementById("btn-collect");
const btnCompare = document.getElementById("btn-compare");
const compareA = document.getElementById("compare-a");
const compareB = document.getElementById("compare-b");
const compareResult = document.getElementById("compare-result");

btnCollect.addEventListener("click", async () => {
  await triggerCollect();
});

btnCompare.addEventListener("click", () => {
  const idA = compareA.value;
  const idB = compareB.value;
  if (!idA || !idB) return;

  const snaps = getLoadedSnapshotsList();
  const snapA = snaps.find((s) => s.id === idA);
  const snapB = snaps.find((s) => s.id === idB);
  if (!snapA || !snapB) {
    compareResult.innerHTML = `<div class="text-danger">Snapshot not found</div>`;
    return;
  }

  const simplifyAttrs = (attrs) => {
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
  };

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

async function triggerCollect() {
  btnCollect.disabled = true;
  btnCollect.textContent = "Collecting...";
  try {
    const data = await collectSnapshot();
    renderSnapshot(data);
    startPowerStatusPolling();
    await saveSnapshot(data);
    await refreshHistory();
  } catch (err) {
    alert(err.message || err);
  } finally {
    btnCollect.disabled = false;
    btnCollect.textContent = "Collect Now";
  }
}

async function refreshHistory() {
  const snaps = await loadSnapshots(200);
  setLoadedSnapshotsList(snaps);
  renderHistory(snaps);
  fillCompare(snaps);
  
  if (snaps.length > 0) {
    renderSnapshot(snaps[0]);
    startPowerStatusPolling();
  }
}

let powerPollInterval = null;
let isPowerPolling = false;

async function pollDiskPowerStates() {
  if (isPowerPolling) return;
  
  const tabButtons = document.querySelectorAll("[data-power-poll-slug]");
  if (tabButtons.length === 0) return;
  
  isPowerPolling = true;
  
  try {
    for (const btn of tabButtons) {
      const slug = btn.dataset.powerPollSlug;
      const path = btn.dataset.powerPollPath;
      const kind = btn.dataset.powerPollKind;
      
      const badge = document.getElementById(`power-badge-${slug}`);
      const dot = document.getElementById(`tab-power-dot-${slug}`);
      
      if (kind === "nvme") {
        if (dot) {
          dot.className = "spinner-grow spinner-grow-sm text-info ms-1";
          dot.style.animation = "none";
        }
        if (badge) {
          badge.className = "badge bg-info text-uppercase ms-2";
          badge.textContent = "Active";
          badge.title = "NVMe SSD (Ready)";
        }
        continue;
      }
      
      const res = await runCommand(["hdparm", "-C", path], { superuser: "require" });
      const state = parseHdparmPowerState(res.stdout);
      
      if (state === "active") {
        if (dot) {
          dot.className = "spinner-grow spinner-grow-sm text-success ms-1";
          dot.style.animation = "none";
        }
        if (badge) {
          badge.className = "badge bg-success text-uppercase ms-2";
          badge.textContent = "Active";
          badge.title = "Drive platters are spinning (Active/Idle)";
        }
      } else if (state === "standby") {
        if (dot) {
          dot.className = "spinner-grow spinner-grow-sm text-warning ms-1";
          dot.style.animation = "none";
        }
        if (badge) {
          badge.className = "badge bg-warning text-dark text-uppercase ms-2";
          badge.textContent = "Standby";
          badge.title = "Drive has spun down (Low power standby mode)";
        }
      } else if (state === "sleep") {
        if (dot) {
          dot.className = "spinner-grow spinner-grow-sm text-secondary ms-1";
          dot.style.animation = "none";
        }
        if (badge) {
          badge.className = "badge bg-secondary text-uppercase ms-2";
          badge.textContent = "Sleeping";
          badge.title = "Drive is in deep sleep mode";
        }
      } else {
        if (dot) {
          dot.className = "spinner-grow spinner-grow-sm text-muted ms-1";
          dot.style.animation = "none";
        }
        if (badge) {
          badge.className = "badge bg-light text-muted text-uppercase border ms-2";
          badge.textContent = "Unknown";
          badge.title = res.error || "Failed to query state via hdparm";
        }
      }
    }
  } catch (err) {
    console.error("Error polling disk power states:", err);
  } finally {
    isPowerPolling = false;
  }
}

function startPowerStatusPolling() {
  if (powerPollInterval) {
    clearInterval(powerPollInterval);
  }
  pollDiskPowerStates();
  powerPollInterval = setInterval(pollDiskPowerStates, 5000);
}

async function init() {
  if (!window.cockpit) {
    console.warn("Cockpit bridge not ready yet. Retrying in 50ms...");
    setTimeout(init, 50);
    return;
  }

  let snapshotFilePath = "";
  try {
    const userInfo = await window.cockpit.user();
    snapshotFilePath = `${userInfo.home}/.local/share/disk-health/snapshots.jsonl`;
  } catch (err) {
    console.warn("Failed to get user home directory, using fallback path.", err);
    snapshotFilePath = "/tmp/snapshots.jsonl";
  }

  setSnapshotFilePath(snapshotFilePath);
  console.log("Disk Health extension initialized. History file path:", snapshotFilePath);
  await refreshHistory();

  // Setup schedule and alert configurations UI elements & event triggers
  setupScheduler();

  // Auto-collect if last run is > 24h old or no history exists
  const snaps = getLoadedSnapshotsList();
  let shouldCollect = false;
  if (!snaps || snaps.length === 0) {
    shouldCollect = true;
  } else {
    const lastTime = new Date(snaps[0].timestamp).getTime();
    const oneDayMs = 24 * 60 * 60 * 1000;
    if (Date.now() - lastTime > oneDayMs) {
      shouldCollect = true;
    }
  }

  if (shouldCollect) {
    console.log("Last collection was more than 1 day ago (or never). Starting auto-collect...");
    triggerCollect().catch((err) => console.error("Auto-collect failed:", err));
  }
}

// Start Initialization
init();
