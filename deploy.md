# Deployment Guide

## Stack

| Layer | Target | Cost |
|-------|--------|------|
| Frontend | Vercel | Free |
| Backend | Oracle Cloud Always-Free ARM VM | Free |
| Inference | NVIDIA NIM API | Pay-per-token |
| Vector Store | Turbovec (self-hosted on VM) | Free |

## 1. Oracle Cloud VM Setup

### Provision the VM
1. Go to https://cloud.oracle.com/free — sign up
2. Create an **Ampere A1** instance: 4 OCPUs, 24 GB RAM (always free)
3. OS: Ubuntu 22.04
4. Add your SSH key
5. Open ports: **8000** (Ingress rule in security list)

### Install on VM
```bash
ssh ubuntu@<vm-public-ip>

# Install Python & tools
sudo apt update && sudo apt install -y python3-pip python3-venv git

# Clone repo
git clone https://github.com/MIDAS-26/f1_project.git
cd f1_project/backend

# Setup
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt

# Add NVIDIA NIM key
echo 'NVIDIA_NIM_API_KEY=nvapi-xxxxx' > .env

# Enable FastF1 cache
mkdir -p /tmp/f1_cache

# Run (or use systemd for persistence)
python3 main.py
```

### Systemd Service (persistent)
```bash
sudo tee /etc/systemd/system/f1-backend.service << EOF
[Unit]
Description=F1 Telemetry AI Backend
After=network.target

[Service]
User=ubuntu
WorkingDirectory=/home/ubuntu/f1_project/backend
Environment="PATH=/home/ubuntu/f1_project/backend/venv/bin"
Environment="F1_CACHE_DIR=/home/ubuntu/f1_cache"
EnvironmentFile=/home/ubuntu/f1_project/backend/.env
ExecStart=/home/ubuntu/f1_project/backend/venv/bin/python main.py
Restart=always

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl enable f1-backend
sudo systemctl start f1-backend
```

## 2. Vercel Frontend

1. Go to https://vercel.com
2. New Project → Import `MIDAS-26/f1_project`
3. Root Directory: `frontend`
4. Framework: Next.js
5. Deploy

After deploy, update the WebSocket URL in `useRaceWebSocket.ts`:
```typescript
const BACKEND_URL = "wss://<oracle-vm-ip>:8000";
```
Or use an environment variable: `NEXT_PUBLIC_WS_URL`

## 3. Verify

```bash
# Check backend is up
curl http://<vm-ip>:8000/races

# Test replay
curl -s http://<vm-ip>:8000/races | python3 -m json.tool

# Open frontend at Vercel URL
```