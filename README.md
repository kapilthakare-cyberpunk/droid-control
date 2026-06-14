# DroidControl

Remote terminal control for your MacBook Pro from your Android phone.

## Architecture

```
Android App  <---WebSocket--->  macOS Server  <---PTY--->  Terminal Sessions
```

## Components

### server/
Node.js WebSocket server that runs on the MacBook. Manages PTY sessions, exposes them over WebSocket, and handles authentication.

### mobile/
React Native Android app that connects to the server, displays terminal sessions, and accepts touch/keyboard input.

### agents/
AI agent integrations for natural language command execution, session management, and task automation.

## Quick Start

```bash
# Server (on MacBook)
cd server && npm install && npm start

# Mobile (on dev machine)
cd mobile && npx react-native run-android
```

## Features

- Real-time terminal session management
- Multi-session support (switch between terminals)
- Natural language command execution via AI agents
- Secure WebSocket connection with token auth
- File transfer between devices
- Session history and bookmarks
