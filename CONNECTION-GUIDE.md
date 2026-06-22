# SSH Connection Configuration for Termius (Android)

## Tailscale Method (Recommended - Works Across Networks)

### Host Configuration
```
Host: 100.118.65.81
User: kapilthakare
Port: 22
Password: <your Mac login password>
```

### Connection String
```
kapilthakare@100.118.65.81
```

### Tailscale Setup
1. Install Tailscale on both devices
2. Login with same account on both
3. No firewall changes needed - Tailscale handles routing

---

## Direct IP Method (When on Same Network)

### Host Configuration
```
Host: 192.168.1.25
User: kapilthakare
Port: 22
Password: <your Mac login password>
```

### Connection String
```
kapilthakare@192.168.1.25
```

---

## DroidControl App Configuration (Mobile Terminal)

If using the DroidControl React Native app instead of Termius:

### WebSocket Configuration
```
URL: ws://100.118.65.81:8765?token=dev-token-change-me
```

Or for local network:
```
URL: ws://192.168.1.25:8765?token=dev-token-change-me
```

---

## Troubleshooting

### SSH Not Working?
- Ensure Remote Login is enabled: System Preferences → Sharing → Remote Login
- Check firewall: `sudo /usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate`
- Verify Tailscale: `tailscale status`

### DroidControl Server Not Responding?
- Start server: `cd /Users/kapilthakare/Projects/droid-control/server && npm start`
- Check port: `lsof -i :8765`
- Health check: `curl http://localhost:8765/health`

---

## Current Status (Generated)
- Tailscale IP: 100.118.65.81
- Local IP: 192.168.1.25
- SSH: Enabled and reachable
- DroidControl Server: Running on port 8765