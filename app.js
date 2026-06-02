import { collectSnapshot } from "./data_collector.js";
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

const btnCollect = document.getElementById("btn-collect");
const btnSettings = document.getElementById("btn-settings");
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
  }
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
