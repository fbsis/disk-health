import { runCommand } from "./data_collector.js";

export let snapshotFilePath = "";
export let loadedSnapshotsList = [];

export function setSnapshotFilePath(path) {
  snapshotFilePath = path;
}

export function setLoadedSnapshotsList(list) {
  loadedSnapshotsList = list;
}

export async function saveSnapshot(snapshot) {
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

export async function loadSnapshots(limit = 100) {
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

export function getLoadedSnapshotsList() {
  return loadedSnapshotsList;
}
