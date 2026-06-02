import { loadSnapshots } from "./history_manager.js";
import { formatDate } from "./utils.js";

function getAttrRaw(disk, name) {
  const byName = disk.smart?.attributesByName || {};
  const item = byName[name] || (disk.smart?.attributes || []).find((a) => a.name.toLowerCase() === name);
  if (!item) return null;
  const num = Number(String(item.raw).replace(/[^\d.-]/g, ""));
  return Number.isFinite(num) ? num : item.raw;
}

export async function renderCharts(diskName, tempCanvasId, attrCanvasId) {
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
