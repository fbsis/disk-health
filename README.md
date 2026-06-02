# Disk Health - Cockpit Extension

A native extension for the **Cockpit Project** (https://cockpit-project.org) that provides a user-friendly UI to monitor disk health, SMART attributes, partition space usage, and zpools. It runs on the local server where Cockpit is installed, utilizing native browser APIs to interact with the host system.

![Disk Health Dashboard](https://raw.githubusercontent.com/cockpit-project/starter-kit/main/screenshot.png) *(Placeholder)*

## Features

- **Local System Collection**: Executes commands locally using `cockpit.spawn` (no Node.js backend or SSH connection required).
- **SMART Health Check**: Retrieves and parses `smartctl` attributes for ATA/SATA and NVMe drives with secure elevation of privileges.
- **Filesystem & ZFS Pool Usage**: Shows total and available space across disk partitions and active ZFS pools (`zpools`).
- **History Tracker**: Persists snapshots to a local database file (`~/.local/share/disk-health/snapshots.jsonl`) to show temperature and critical attribute timelines.
- **Snapshot Comparison**: Compares SMART parameters of disks across two historical points in time.
- **Offline Compatibility**: All CSS and JS libraries (Bootstrap, Chart.js) are packed locally for environments without Internet access.

## Requirements

The extension triggers the following host commands. Ensure they are installed on the server:

- `lsblk` (standard in almost all Linux distributions)
- `smartctl` (provided by `smartmontools`)
- ZFS utilities (optional, required only if you want to monitor `zpools`)

*Note: The user accessing Cockpit needs permissions to run `smartctl` (typically as a superuser/root). Cockpit will prompt for authorization when administrative operations are requested.*

## Installation

### 1. Install Cockpit on your Host
Make sure Cockpit is installed and running on your machine:
*   **Debian/Ubuntu:**
    ```bash
    sudo apt update
    sudo apt install cockpit
    ```
*   **Fedora/RHEL/CentOS:**
    ```bash
    sudo dnf install cockpit
    sudo systemctl enable --now cockpit.socket
    ```

### 2. Install the Extension

#### Development / User-specific Mode (Recommended for testing)
Install it only for the currently logged-in user:
```bash
# Create the local cockpit share directory if it doesn't exist
mkdir -p ~/.local/share/cockpit

# Create a symlink to this project directory
ln -s /Users/felipebraga/dev/personal/disk-health-remote ~/.local/share/cockpit/disk-health-remote
```
*Any changes made in this repository will instantly be loaded when you refresh the Cockpit interface (F5).*

#### Production / System-wide Mode
Install it globally for all system users:
```bash
sudo cp -r /Users/felipebraga/dev/personal/disk-health-remote /usr/share/cockpit/disk-health-remote
```

### 3. Usage
1. Open your web browser and go to `https://<your-server-ip>:9090`.
2. Login with your standard Linux system credentials.
3. Select **"Disk Health"** in the sidebar.
4. Click **"Collect Now"** to execute the system commands and analyze the health of the drives.
5. Authorize administrative access when Cockpit asks for permission.
