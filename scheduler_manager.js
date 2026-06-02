import { runCommand } from "./data_collector.js";

function generateCheckScriptContent() {
  return `#!/usr/bin/env bash

# Load configuration
CONFIG_FILE="/etc/disk-health-config.env"
if [ ! -f "\$CONFIG_FILE" ]; then
  echo "Configuration file \$CONFIG_FILE not found."
  exit 1
fi
source "\$CONFIG_FILE"

if [ "\$ENABLED" != "1" ]; then
  echo "Monitoring is disabled in configuration."
  exit 0
fi

# Get list of physical disks
DISKS=\$(lsblk -dno name,type | awk '\$2=="disk" {print \$1}' | grep -v '^zd' | grep -v '^loop')

ERRORS=""

for DEV in \$DISKS; do
  PATH_DEV="/dev/\$DEV"
  echo "Checking \$PATH_DEV..."

  # Trigger SMART self-test if configured
  if [ "\$TEST_TYPE" = "short" ]; then
    echo "Triggering short self-test for \$PATH_DEV"
    smartctl -t short "\$PATH_DEV" >/dev/null 2>&1
  elif [ "\$TEST_TYPE" = "long" ]; then
    echo "Triggering long self-test for \$PATH_DEV"
    smartctl -t long "\$PATH_DEV" >/dev/null 2>&1
  elif [ "\$TEST_TYPE" = "offline" ]; then
    echo "Triggering offline self-test for \$PATH_DEV"
    smartctl -t offline "\$PATH_DEV" >/dev/null 2>&1
  fi

  # 1. Check overall SMART health
  HEALTH_OUT=\$(smartctl -H "\$PATH_DEV" 2>/dev/null)
  if echo "\$HEALTH_OUT" | grep -qiE "FAIL|FAILED"; then
    ERRORS="\${ERRORS}\\n- *\${PATH_DEV}*: SMART Health FAILED!"
    echo "SMART Health FAILED on \$PATH_DEV"
  fi

  # 2. Check SATA attributes
  if smartctl -a "\$PATH_DEV" 2>/dev/null | grep -q "ID# ATTRIBUTE_NAME"; then
    ATTRS_OUT=\$(smartctl -A "\$PATH_DEV" 2>/dev/null)
    
    # ID 5: Reallocated Sector Count
    REALLOC=\$(echo "\$ATTRS_OUT" | awk '\$1==5 {print \$10}')
    if [ ! -z "\$REALLOC" ] && [ "\$REALLOC" -gt 0 ] 2>/dev/null; then
      ERRORS="\${ERRORS}\\n- *\${PATH_DEV}*: Reallocated Sectors = \${REALLOC}"
      echo "Reallocated Sectors = \$REALLOC on \$PATH_DEV"
    fi

    # ID 197: Current Pending Sector Count
    PENDING=\$(echo "\$ATTRS_OUT" | awk '\$1==197 {print \$10}')
    if [ ! -z "\$PENDING" ] && [ "\$PENDING" -gt 0 ] 2>/dev/null; then
      ERRORS="\${ERRORS}\\n- *\${PATH_DEV}*: Current Pending Sectors = \${PENDING}"
      echo "Pending Sectors = \$PENDING on \$PATH_DEV"
    fi

    # ID 198: Offline Uncorrectable
    OFFLINE=\$(echo "\$ATTRS_OUT" | awk '\$1==198 {print \$10}')
    if [ ! -z "\$OFFLINE" ] && [ "\$OFFLINE" -gt 0 ] 2>/dev/null; then
      ERRORS="\${ERRORS}\\n- *\${PATH_DEV}*: Offline Uncorrectable Sectors = \${OFFLINE}"
      echo "Offline Uncorrectable = \$OFFLINE on \$PATH_DEV"
    fi

    # ID 199: UDMA CRC Error Count
    CRC=\$(echo "\$ATTRS_OUT" | awk '\$1==199 {print \$10}')
    if [ ! -z "\$CRC" ] && [ "\$CRC" -gt 0 ] 2>/dev/null; then
      ERRORS="\${ERRORS}\\n- *\${PATH_DEV}*: UDMA CRC Errors = \${CRC}"
      echo "UDMA CRC Errors = \$CRC on \$PATH_DEV"
    fi
  fi

  # 3. Check NVMe-specific attributes
  if [[ "\$DEV" =~ ^nvme ]]; then
    NVME_OUT=\$(smartctl -a "\$PATH_DEV" 2>/dev/null)
    
    # Critical Warning
    CRIT_WARN=\$(echo "\$NVME_OUT" | grep -i "Critical Warning:" | awk '{print \$3}')
    if [ ! -z "\$CRIT_WARN" ] && [ "\$CRIT_WARN" != "0x00" ]; then
      ERRORS="\${ERRORS}\\n- *\${PATH_DEV}*: NVMe Critical Warning = \${CRIT_WARN}"
      echo "NVMe Critical Warning = \$CRIT_WARN on \$PATH_DEV"
    fi
    
    # Media and Data Integrity Errors
    MEDIA_ERR=\$(echo "\$NVME_OUT" | grep -i "Media and Data Integrity Errors:" | awk '{print \$6}')
    MEDIA_ERR_CLEAN=\$(echo "\$MEDIA_ERR" | tr -cd '0-9')
    if [ ! -z "\$MEDIA_ERR_CLEAN" ] && [ "\$MEDIA_ERR_CLEAN" -gt 0 ] 2>/dev/null; then
      ERRORS="\${ERRORS}\\n- *\${PATH_DEV}*: NVMe Media and Data Integrity Errors = \${MEDIA_ERR}"
      echo "NVMe Media Errors = \$MEDIA_ERR on \$PATH_DEV"
    fi
  fi
done

if [ -z "\$ERRORS" ]; then
  echo "All disks healthy. No errors detected."
fi

# Send Telegram notification if enabled
if [ ! -z "\$ERRORS" ] && [ "\$TELEGRAM_ENABLED" = "1" ] && [ ! -z "\$TELEGRAM_TOKEN" ] && [ ! -z "\$TELEGRAM_CHAT_ID" ]; then
  HOSTNAME=\$(hostname)
  MSG="⚠️ *Disk Health Warning on \${HOSTNAME}* ⚠️\\n\${ERRORS}"
  echo "Sending Telegram alert..."
  curl -s -X POST "https://api.telegram.org/bot\${TELEGRAM_TOKEN}/sendMessage" \\
    -d "chat_id=\${TELEGRAM_CHAT_ID}" \\
    --data-urlencode "text=\$(echo -e "\${MSG}")" \\
    -d "parse_mode=Markdown" >/dev/null
fi
`;
}

export async function loadConfig() {
  const res = await runCommand(["cat", "/etc/disk-health-config.env"]);
  const config = {
    enabled: false,
    testType: "none",
    frequency: "daily",
    telegramEnabled: false,
    telegramToken: "",
    telegramChatId: ""
  };
  if (res.code === 0 && res.stdout) {
    const lines = res.stdout.split(/\r?\n/);
    lines.forEach((line) => {
      const parts = line.split("=");
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const val = parts.slice(1).join("=").trim().replace(/^['"]|['"]$/g, "");
        if (key === "ENABLED") config.enabled = val === "1";
        if (key === "TEST_TYPE") config.testType = val;
        if (key === "FREQUENCY") config.frequency = val;
        if (key === "TELEGRAM_ENABLED") config.telegramEnabled = val === "1";
        if (key === "TELEGRAM_TOKEN") config.telegramToken = val;
        if (key === "TELEGRAM_CHAT_ID") config.telegramChatId = val;
      }
    });
  }
  return config;
}

export function setupScheduler() {
  const modalEl = document.getElementById("modal-settings");
  if (!modalEl) return;

  const btnSettings = document.getElementById("btn-settings");
  const schedEnabledCheck = document.getElementById("settings-sched-enabled");
  const schedOptionsGroup = document.getElementById("sched-options-group");
  const tgEnabledCheck = document.getElementById("settings-tg-enabled");
  const tgOptionsGroup = document.getElementById("tg-options-group");
  const btnTestTg = document.getElementById("btn-test-tg");
  const btnRunCheck = document.getElementById("btn-run-check");
  const btnSaveSettings = document.getElementById("btn-save-settings");

  const settingsTestType = document.getElementById("settings-test-type");
  const settingsFrequency = document.getElementById("settings-frequency");
  const settingsTgToken = document.getElementById("settings-tg-token");
  const settingsTgChatId = document.getElementById("settings-tg-chat-id");

  // Show modal handler
  if (btnSettings) {
    btnSettings.addEventListener("click", () => {
      const modalInstance = window.bootstrap.Modal.getOrCreateInstance(modalEl);
      modalInstance.show();
    });
  }

  // Toggle Visibility Handlers
  schedEnabledCheck.addEventListener("change", () => {
    if (schedEnabledCheck.checked) {
      schedOptionsGroup.classList.remove("d-none");
    } else {
      schedOptionsGroup.classList.add("d-none");
    }
  });

  tgEnabledCheck.addEventListener("change", () => {
    if (tgEnabledCheck.checked) {
      tgOptionsGroup.classList.remove("d-none");
      btnTestTg.classList.remove("d-none");
    } else {
      tgOptionsGroup.classList.add("d-none");
      btnTestTg.classList.add("d-none");
    }
  });

  // Populate form on show
  modalEl.addEventListener("show.bs.modal", async () => {
    try {
      const config = await loadConfig();
      schedEnabledCheck.checked = config.enabled;
      settingsTestType.value = config.testType;
      settingsFrequency.value = config.frequency;
      tgEnabledCheck.checked = config.telegramEnabled;
      settingsTgToken.value = config.telegramToken;
      settingsTgChatId.value = config.telegramChatId;

      schedEnabledCheck.dispatchEvent(new Event("change"));
      tgEnabledCheck.dispatchEvent(new Event("change"));
    } catch (err) {
      console.error("Failed to load settings configuration:", err);
    }
  });

  // Save Config handler
  btnSaveSettings.addEventListener("click", async () => {
    btnSaveSettings.disabled = true;
    btnSaveSettings.textContent = "Saving...";
    try {
      const enabled = schedEnabledCheck.checked ? "1" : "0";
      const testType = settingsTestType.value;
      const frequency = settingsFrequency.value;
      const tgEnabled = tgEnabledCheck.checked ? "1" : "0";
      const tgToken = settingsTgToken.value.trim();
      const tgChatId = settingsTgChatId.value.trim();

      const lines = [
        `ENABLED=${enabled}`,
        `TEST_TYPE="${testType}"`,
        `FREQUENCY="${frequency}"`,
        `TELEGRAM_ENABLED=${tgEnabled}`,
        `TELEGRAM_TOKEN="${tgToken}"`,
        `TELEGRAM_CHAT_ID="${tgChatId}"`
      ];
      const content = lines.join("\n") + "\n";

      // Save Config File
      const writeRes = await runCommand(["tee", "/etc/disk-health-config.env"], { 
        superuser: "require", 
        input: content 
      });

      if (writeRes.code !== 0) {
        throw new Error(`Failed to write config file: ${writeRes.error || "unknown error"}`);
      }

      // Save Check Script
      const scriptContent = generateCheckScriptContent();
      const scriptRes = await runCommand(["tee", "/usr/local/bin/disk-health-check.sh"], {
        superuser: "require",
        input: scriptContent
      });

      if (scriptRes.code !== 0) {
        throw new Error(`Failed to write check script: ${scriptRes.error || "unknown error"}`);
      }

      // Chmod script
      const chmodRes = await runCommand(["chmod", "+x", "/usr/local/bin/disk-health-check.sh"], {
        superuser: "require"
      });

      if (chmodRes.code !== 0) {
        throw new Error(`Failed to make check script executable: ${chmodRes.error || "unknown error"}`);
      }

      alert("Settings saved successfully!");
      const modalInstance = window.bootstrap.Modal.getInstance(modalEl);
      if (modalInstance) modalInstance.hide();
    } catch (err) {
      alert("Error saving settings: " + err.message);
    } finally {
      btnSaveSettings.disabled = false;
      btnSaveSettings.textContent = "Save Settings";
    }
  });

  // Run Check Now handler
  btnRunCheck.addEventListener("click", async () => {
    btnRunCheck.disabled = true;
    btnRunCheck.textContent = "Running...";
    try {
      const res = await runCommand(["/usr/local/bin/disk-health-check.sh"], { superuser: "require" });
      if (res.code === 0) {
        alert("Check script executed successfully!" + (res.stdout ? "\n\nOutput:\n" + res.stdout : ""));
      } else {
        alert("Error running check script: " + (res.error || res.stdout || "unknown error"));
      }
    } catch (err) {
      alert("Error: " + err.message);
    } finally {
      btnRunCheck.disabled = false;
      btnRunCheck.textContent = "Run Check Now";
    }
  });

  // Test Telegram handler
  btnTestTg.addEventListener("click", async () => {
    const token = settingsTgToken.value.trim();
    const chatId = settingsTgChatId.value.trim();
    if (!token || !chatId) {
      alert("Please fill in both Bot Token and Chat ID to test.");
      return;
    }
    btnTestTg.disabled = true;
    btnTestTg.textContent = "Testing...";
    try {
      let hostname = "localhost";
      const hostRes = await runCommand(["hostname"]);
      if (hostRes.code === 0) hostname = hostRes.stdout.trim();

      const msg = `🔔 *Test Message* 🔔\nTelegram alerts from Cockpit Disk Health are working correctly on *${hostname}*!`;
      const curlArgs = [
        "curl", "-s", "-X", "POST",
        `https://api.telegram.org/bot${token}/sendMessage`,
        "-d", `chat_id=${chatId}`,
        "--data-urlencode", `text=${msg}`,
        "-d", "parse_mode=Markdown"
      ];
      const res = await runCommand(curlArgs);
      if (res.code === 0) {
        alert("Telegram test alert sent successfully! Check your Telegram chat.");
      } else {
        alert("Failed to send Telegram message: " + (res.error || res.stdout || "unknown error"));
      }
    } catch (err) {
      alert("Error: " + err.message);
    } finally {
      btnTestTg.disabled = false;
      btnTestTg.textContent = "Test Telegram";
    }
  });
}
