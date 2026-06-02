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

btnCollect.addEventListener("click", async () => {
  btnCollect.disabled = true;
  btnCollect.textContent = "Coletando...";
  try {
    const res = await fetch("/api/collect", { method: "POST" });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erro ao coletar");
    renderSnapshot(data);
    await refreshHistory();
  } catch (err) {
    alert(err.message || err);
  } finally {
    btnCollect.disabled = false;
    btnCollect.textContent = "Coletar agora";
  }
});

btnRefresh.addEventListener("click", async () => {
  await refreshHistory();
});

btnCompare.addEventListener("click", async () => {
  const idA = compareA.value;
  const idB = compareB.value;
  if (!idA || !idB) return;
  const res = await fetch(`/api/compare?idA=${idA}&idB=${idB}`);
  const data = await res.json();
  if (!res.ok) {
    compareResult.innerHTML = `<div class="text-danger">${data.error}</div>`;
    return;
  }
  renderCompare(data);
});

async function refreshHistory() {
  const res = await fetch("/api/snapshots");
  const data = await res.json();
  renderHistory(data.snapshots || []);
  fillCompare(data.snapshots || []);
}

function renderSnapshot(snapshot) {
  disksEl.innerHTML = "";
  lastTsEl.textContent = formatDate(snapshot.timestamp);
  diskCountEl.textContent = String(snapshot.disks.length);
  hostNameEl.textContent = snapshot.host || "-";
  totalUsedEl.textContent = snapshot.totals ? formatBytes(snapshot.totals.usedBytes) : "-";
  totalAvailEl.textContent = snapshot.totals ? formatBytes(snapshot.totals.availBytes) : "-";

  if (!snapshot.disks.length) {
    disksEl.innerHTML = "<div class='text-muted'>Nenhum disco encontrado.</div>";
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
    tabBtn.textContent = disk.path || disk.name || `Disco ${idx + 1}`;

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
              <div class="disk-meta">${disk.model || "Modelo desconhecido"} • ${disk.size || ""} • ${kindLabel}</div>
            </div>
            <span class="badge-health ${healthClass}">${health}</span>
          </div>
          <div class="mt-3 d-flex flex-wrap gap-3">
            <div>
              <div class="text-muted small">Temperatura</div>
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
              <div class="text-muted small">Disponível</div>
              <div class="fw-semibold">${fsInfo.avail}</div>
            </div>
            <div>
              <div class="text-muted small">Total</div>
              <div class="fw-semibold">${fsInfo.total}</div>
            </div>
            <div>
              <div class="text-muted small">Uso</div>
              <div class="fw-semibold">${fsInfo.use}</div>
            </div>
          </div>
          ${showAta ? `<details class="mt-3">
            <summary class="text-info">Ver atributos SMART</summary>
            ${renderAttrsTable(disk.smart?.attributes || [])}
          </details>` : ""}
          ${showNvme ? `<details class="mt-3">
            <summary class="text-info">NVMe SMART (campos principais)</summary>
            ${renderNvme(disk.smart?.nvme || {})}
          </details>` : ""}
          <div class="mt-3">
            <div class="text-muted small">Temperatura (histórico)</div>
            <canvas id="${chartId}" height="120"></canvas>
          </div>
          ${showAta ? `<div class="mt-3">
            <div class="text-muted small">Atributos críticos (histórico)</div>
            <canvas id="${chartAttrId}" height="120"></canvas>
          </div>` : ""}
          <div class="mt-3">
            <div class="d-flex align-items-center justify-content-between">
              <div class="fw-semibold">Detalhes SMART</div>
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
}

function renderAttrsTable(attrs) {
  if (!attrs.length) return "<div class=\"text-muted mt-2\">Sem dados SMART</div>";
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
            <th>Nome</th>
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
    ["Temperatura", disk.smart?.temperatureC ?? "-"],
    ["Modelo", disk.model || "-"],
    ["Tamanho", disk.size || "-"],
    ["Tipo", disk.kind ? disk.kind.toUpperCase() : "-"],
    ["Disponível", fsInfo.avail],
    ["Total", fsInfo.total],
    ["Uso", fsInfo.use],
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
    .map(([label, value]) => `<tr><th scope="row">${label}</th><td>${escapeHtml(value)}</td></tr>`)
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
  if (!health || health === "-" || health === "?") issues.push("Health indisponível");
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
  return `<span class="badge issue-badge danger" title="${title}">ATENÇÃO</span>`;
}

function renderNvme(nvme) {
  const keys = Object.keys(nvme || {});
  if (!keys.length) return "<div class=\"text-muted mt-2\">Sem dados NVMe</div>";
  const rows = keys
    .map((key) => `<tr><td>${toLabel(key)}</td><td>${escapeHtml(nvme[key])}</td></tr>`)
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
    historyEl.innerHTML = "<div class='text-muted'>Nenhum snapshot ainda.</div>";
    return;
  }
  const rows = snapshots
    .map(
      (s) => `
      <tr>
        <td>${s.id}</td>
        <td>${formatDate(s.timestamp)}</td>
        <td>${s.host || ""}</td>
        <td>${s.diskCount}</td>
        <td>${s.totals ? formatBytes(s.totals.usedBytes) : "-"}</td>
        <td>${s.totals ? formatBytes(s.totals.availBytes) : "-"}</td>
        <td>${formatPerDiskAvail(s.perDiskAvail || [])}</td>
      </tr>`
    )
    .join("");
  historyEl.innerHTML = `
    <table class="table table-striped table-sm">
      <thead>
        <tr>
          <th>ID</th>
          <th>Data</th>
          <th>Host</th>
          <th>Discos</th>
          <th>Total usado</th>
          <th>Total disponível</th>
          <th>Disponível por disco</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function fillCompare(snapshots) {
  const buildOptions = (target) => {
    target.innerHTML = "<option value=''>Selecione</option>";
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
    compareResult.innerHTML = "<div class='text-muted'>Sem discos em comum.</div>";
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
    const res = await fetch(`/api/timeseries?disk=${encodeURIComponent(diskName)}`);
    const data = await res.json();
    if (!res.ok) return;
    const labels = data.items.map((i) => formatDate(i.timestamp));
    const temps = data.items.map((i) => i.temperatureC ?? null);
    const reallocated = data.items.map((i) => i.reallocated_sector_ct ?? null);
    const pending = data.items.map((i) => i.current_pending_sector ?? null);
    const offline = data.items.map((i) => i.offline_uncorrectable ?? null);
    const crc = data.items.map((i) => i.udma_crc_error_count ?? null);

    const tempCtx = document.getElementById(tempCanvasId);
    if (tempCtx) {
      new Chart(tempCtx, {
        type: "line",
        data: {
          labels,
          datasets: [
            {
              label: "Temperatura °C",
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
    console.warn("chart error", err);
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
      legend: { labels: { color: "#0f172a" } }
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

// initial load
refreshHistory();
