export function formatBytes(bytes) {
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

export function formatDate(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  return d.toLocaleString();
}

export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function toNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const num = Number(String(value).trim());
  return Number.isFinite(num) ? num : null;
}

export function sumNums(nums) {
  const valid = nums.filter((n) => typeof n === "number" && Number.isFinite(n));
  if (!valid.length) return null;
  return valid.reduce((a, b) => a + b, 0);
}

export function toTabId(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "") || "disk";
}

export function toLabel(key) {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

export function detectKind(dev) {
  if (String(dev.name || "").startsWith("nvme")) return "nvme";
  if (dev.tran && String(dev.tran).toLowerCase() === "nvme") return "nvme";
  if (dev.rota === 1) return "hdd";
  if (dev.rota === 0) return "ssd";
  return "disk";
}

export function renderFsInfo(fs) {
  if (!fs) return { total: "-", avail: "-", use: "-" };
  return {
    total: formatBytes(fs.totalBytes),
    avail: formatBytes(fs.availBytes),
    use: fs.usePercent !== null && fs.usePercent !== undefined ? `${fs.usePercent}%` : "-"
  };
}

export function formatPerDiskAvail(items) {
  if (!items.length) return "-";
  return items
    .map((i) => `${i.name}: ${formatBytes(i.availBytes)}`)
    .join("; ");
}
