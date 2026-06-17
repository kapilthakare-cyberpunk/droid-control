#!/bin/bash
set -euo pipefail

# ─────────────────────────────────────────────────────────
# droid-control tailscale-fix.sh
# Self-healing setup that ensures Tailscale + SSH Remote
# Login are configured and connected.  Idempotent.
# ─────────────────────────────────────────────────────────

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'
ok()   { echo -e "  ${GREEN}✓${NC} $1"; }
info() { echo -e "  ${CYAN}ℹ${NC} $1"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $1"; }
fail() { echo -e "  ${RED}✗${NC} $1"; }

# ── Step 1: Tailscale binary ────────────────────────────
echo -e "\n${CYAN}═══ Step 1: Tailscale binary ───${NC}"
if command -v tailscale &>/dev/null; then
  ok "tailscale found at $(command -v tailscale)"
else
  if command -v brew &>/dev/null; then
    warn "Installing tailscale via Homebrew..."
    brew install tailscale
  else
    fail "Homebrew not found. Install manually: https://tailscale.com/download"
    exit 1
  fi
fi

# ── Step 2: tailscaled running properly ─────────────────
echo -e "\n${CYAN}═══ Step 2: tailscaled service ───${NC}"
RUNNING="$(pgrep -x tailscaled 2>/dev/null || true)"
BREW_SVC="$(brew services list 2>/dev/null | awk '/^tailscale/{print $2}')"

if [[ -n "$RUNNING" ]]; then
  MODE="$(ps -o args= "$(pgrep -x tailscaled | head -1)" 2>/dev/null || true)"
  if echo "$MODE" | grep -q userspace-networking; then
    warn "tailscaled running in userspace-networking mode — restarting as system service"
    echo "prachi" | sudo -S brew services restart tailscale 2>/dev/null
    sleep 3
  else
    ok "tailscaled is running"
  fi
else
  warn "tailscaled not running — starting via brew services"
  echo "prachi" | sudo -S brew services start tailscale 2>/dev/null
  sleep 3
fi

# Wait for the daemon to come up
for i in {1..10}; do
  if pgrep -x tailscaled &>/dev/null; then ok "tailscaled daemon alive"; break; fi
  sleep 1
done

# ── Step 3: Authenticated? ──────────────────────────────
echo -e "\n${CYAN}═══ Step 3: Tailscale authentication ───${NC}"
STATUS="$(tailscale status --json 2>/dev/null || echo '{}')"
if echo "$STATUS" | python3 -c "import sys,json; d=json.load(sys.stdin); exit(0 if d.get('Self') else 1)" 2>/dev/null; then
  ME="$(echo "$STATUS" | python3 -c "import sys,json; d=json.load(sys.stdin); s=d['Self']; print(f\"{s['DNSName'].rstrip('.')} ({s['TailscaleIPs'][0]})\")" 2>/dev/null)"
  ok "Authenticated as $ME"
else
  fail "Not authenticated — running tailscale up"
  info "Open the URL below in your browser to authenticate:"
  echo ""
  tailscale up --ssh 2>&1 | grep -E '^https://' || true
  echo ""
  read -rp "Press Enter after authenticating..." _
fi

# ── Step 4: SSH Remote Login ────────────────────────────
echo -e "\n${CYAN}═══ Step 4: SSH Remote Login ───${NC}"
SSH_ON="$(echo "prachi" | sudo -S systemsetup -getremotelogin 2>/dev/null || true)"
if echo "$SSH_ON" | grep -qi "On"; then
  ok "Remote Login is On"
else
  warn "Remote Login is Off — enabling..."
  echo "prachi" | sudo -S systemsetup -setremotelogin on 2>/dev/null
  ok "Remote Login enabled"
fi

# ── Step 5: Verify SSH reachable via Tailscale ──────────
echo -e "\n${CYAN}═══ Step 5: Connectivity check ───${NC}"
MY_TS_IP="$(tailscale status --json 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['Self']['TailscaleIPs'][0])" 2>/dev/null || true)"
if [[ -n "$MY_TS_IP" ]]; then
  if ssh -o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new "$(whoami)@$MY_TS_IP" 'echo reachable' &>/dev/null; then
    ok "SSH reachable at $(whoami)@$MY_TS_IP"
  else
    warn "SSH to $MY_TS_IP failed — firewall may block port 22"
    info "Check System Settings → Privacy & Security → Firewall"
  fi
else
  fail "Could not determine Tailscale IP"
fi

echo ""
echo -e "${GREEN}┌─────────────────────────────────────────────┐${NC}"
echo -e "${GREEN}│${NC}  Connect from Android via Termius:            ${GREEN}│${NC}"
echo -e "${GREEN}│${NC}    Host: ${YELLOW}$MY_TS_IP${NC}                      ${GREEN}│${NC}"
echo -e "${GREEN}│${NC}    User: ${YELLOW}$(whoami)${NC}                       ${GREEN}│${NC}"
echo -e "${GREEN}│${NC}    Pass: ${YELLOW}(your Mac login password)${NC}       ${GREEN}│${NC}"
echo -e "${GREEN}└─────────────────────────────────────────────┘${NC}"
echo ""
