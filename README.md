# Disk Health - Cockpit Extension

A native extension for the **Cockpit Project** (https://cockpit-project.org) that provides a user-friendly UI to monitor disk health, SMART attributes, partition space usage, and zpools. It runs on the local server where Cockpit is installed, utilizing native browser APIs to interact with the host system.

<img width="1039" height="963" alt="image" src="https://github.com/user-attachments/assets/e1aeccec-683e-4bc1-99b2-2fd3d4982352" />

<img width="1039" height="963" alt="image" src="https://github.com/user-attachments/assets/ccaf6cfd-a339-40f4-a80f-2fd7347d8a29" />

<img width="1039" height="963" alt="image" src="https://github.com/user-attachments/assets/3119963e-7906-455d-94d9-7aad32ca1444" />



https://github.com/user-attachments/assets/129e0eec-dc84-4f6c-a97b-67d3da394497






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

Follow these steps to install and use the extension on your Proxmox node:

### 1. Connect to your Proxmox server via SSH
Log in to your Proxmox node terminal as `root` (or a user with `sudo` privileges).

### 2. Install prerequisites
Ensure that Cockpit, Git, and SMART utilities are installed on the Proxmox host (since Proxmox is based on Debian, we use `apt`):
```bash
apt update
apt install git cockpit smartmontools -y
```

### 3. Clone the extension repository
Clone the repository directly into Cockpit's system-wide package directory:
```bash
# Create the cockpit directory if it doesn't exist
mkdir -p /usr/share/cockpit

# Clone the repository from GitHub
git clone https://github.com/fbsis/disk-health.git /usr/share/cockpit/disk-health
```
No build steps or dependency installations are required, as the extension is client-side only.

### 4. Usage
1. Open your web browser and go to `https://<your-server-ip>:9090`.
2. Login with your standard Linux system credentials.
3. Select **"Disk Health"** in the sidebar.
4. Click **"Collect Now"** to execute the system commands and analyze the health of the drives.
5. Authorize administrative access when Cockpit asks for permission.
