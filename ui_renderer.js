import { 
  formatDate, 
  formatBytes, 
  escapeHtml, 
  toTabId, 
  toLabel, 
  renderFsInfo, 
  formatPerDiskAvail 
} from "./utils.js";
import { smartDescriptions } from "./smart_descriptions.js";
import { renderCharts } from "./chart_renderer.js";

function getAttr(disk, name) {
  const attrs = disk.smart?.attributes || [];
  const item = attrs.find((a) => a.name.toLowerCase() === name);
  return item ? item.raw : "-";
}

export function renderSnapshot(snapshot) {
  const disksEl = document.getElementById("disks");
  const lastTsEl = document.getElementById("last-timestamp");
  const diskCountEl = document.getElementById("disk-count");
  const hostNameEl = document.getElementById("host-name");
  const totalUsedEl = document.getElementById("total-used");
  const totalAvailEl = document.getElementById("total-avail");

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

export function renderAttrsTable(attrs) {
  if (!attrs.length) return "<div class=\"text-muted mt-2\">No SMART data</div>";
  const rows = attrs
    .map(
      (a) => {
        const lookupKey = a.name.toLowerCase();
        const desc = smartDescriptions[lookupKey] || "";
        const tooltipHtml = desc 
          ? ` <span class="text-muted" style="cursor: help;" data-bs-toggle="tooltip" data-bs-placement="top" title="${escapeHtml(desc)}">ⓘ</span>`
          : "";
        return `
        <tr>
          <td>${a.id}</td>
          <td>${a.name}${tooltipHtml}</td>
          <td>${a.value}</td>
          <td>${a.worst}</td>
          <td>${a.thresh}</td>
          <td>${escapeHtml(a.raw)}</td>
        </tr>`;
      }
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

export function renderSmartDetailsTable(disk) {
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

export function renderIssuesBadge(disk) {
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

export function renderNvme(nvme) {
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

export function renderHistory(snapshots) {
  const historyEl = document.getElementById("history");
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

export function fillCompare(snapshots) {
  const compareA = document.getElementById("compare-a");
  const compareB = document.getElementById("compare-b");
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

export function renderCompare(data) {
  const compareResult = document.getElementById("compare-result");
  if (!data.disks.length) {
    compareResult.innerHTML = "<div class='text-muted'>No common disks.</div>";
    return;
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
