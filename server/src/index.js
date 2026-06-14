import { WebSocketServer } from 'ws';
import { spawn } from 'node-pty';
import { randomUUID } from 'crypto';

const PORT = process.env.PORT || 8765;
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'dev-token-change-me';

const sessions = new Map();
const clientSessions = new Map();

function createSession(ws, cols = 80, rows = 24) {
  const id = randomUUID().slice(0, 8);
  let shell;
  try {
    shell = spawn('/bin/zsh', [], {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: process.env.HOME || '/tmp',
    });
  } catch (e) {
    throw new Error(`Failed to spawn shell: ${e.message}`);
  }

  const session = { pty: shell, ws, id, createdAt: Date.now() };
  sessions.set(id, session);

  const clientSessionsForWs = clientSessions.get(ws) || [];
  clientSessionsForWs.push(id);
  clientSessions.set(ws, clientSessionsForWs);

  shell.onData((data) => {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'output', sessionId: id, data }));
    }
  });

  shell.onExit(({ exitCode, signal }) => {
    if (ws.readyState === 1) {
      ws.send(JSON.stringify({ type: 'session-exit', sessionId: id, exitCode, signal }));
    }
    sessions.delete(id);
    const list = clientSessions.get(ws) || [];
    clientSessions.set(ws, list.filter((s) => s !== id));
  });

  console.log(`Session created: ${id}`);
  return id;
}

function killSession(id) {
  const session = sessions.get(id);
  if (session) {
    session.pty.kill();
    sessions.delete(id);
    console.log(`Session killed: ${id}`);
    return true;
  }
  return false;
}

function cleanupClientSessions(ws) {
  const list = clientSessions.get(ws) || [];
  for (const id of list) {
    const session = sessions.get(id);
    if (session) {
      session.pty.kill();
      sessions.delete(id);
    }
  }
  clientSessions.delete(ws);
}

function handleMessage(ws, msg) {
  switch (msg.type) {
    case 'create-session': {
      const id = createSession(ws, msg.cols, msg.rows);
      ws.send(JSON.stringify({ type: 'session-created', sessionId: id }));
      break;
    }

    case 'input': {
      const session = sessions.get(msg.sessionId);
      if (session && session.ws === ws) {
        session.pty.write(msg.data);
      }
      break;
    }

    case 'resize': {
      const session = sessions.get(msg.sessionId);
      if (session && session.ws === ws) {
        session.pty.resize(msg.cols, msg.rows);
      }
      break;
    }

    case 'kill-session': {
      if (killSession(msg.sessionId)) {
        ws.send(JSON.stringify({ type: 'session-killed', sessionId: msg.sessionId }));
      }
      break;
    }

    case 'list-sessions': {
      const list = clientSessions.get(ws) || [];
      ws.send(JSON.stringify({ type: 'session-list', sessions: list }));
      break;
    }

    case 'ping':
      ws.send(JSON.stringify({ type: 'pong' }));
      break;

    default:
      ws.send(JSON.stringify({ type: 'error', message: `Unknown type: ${msg.type}` }));
  }
}

const wss = new WebSocketServer({ port: PORT }, () => {
  console.log(`DroidControl server listening on ws://localhost:${PORT}`);
});

wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const token = url.searchParams.get('token');

  if (token !== AUTH_TOKEN) {
    ws.close(4001, 'Unauthorized');
    return;
  }

  const clientAddr = req.socket.remoteAddress;
  console.log(`Client connected from ${clientAddr}`);

  ws.on('message', (data) => {
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
      return;
    }
    try {
      handleMessage(ws, msg);
    } catch (e) {
      ws.send(JSON.stringify({ type: 'error', message: e.message }));
    }
  });

  ws.on('close', () => {
    console.log(`Client disconnected: ${clientAddr}`);
    cleanupClientSessions(ws);
  });

  ws.on('error', (err) => {
    console.error(`WebSocket error from ${clientAddr}:`, err.message);
  });
});

function shutdown() {
  console.log('\nShutting down...');
  for (const [id, session] of sessions) {
    session.pty.kill();
  }
  sessions.clear();
  clientSessions.clear();
  wss.close(() => {
    console.log('Server stopped');
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
