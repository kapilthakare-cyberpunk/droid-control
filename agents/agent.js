import WebSocket from 'ws';
import { spawn } from 'node-pty';
import { randomUUID } from 'crypto';

const SERVER_URL = process.env.SERVER_URL || 'ws://localhost:8765';
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'dev-token-change-me';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

const ws = new WebSocket(`${SERVER_URL}?token=${AUTH_TOKEN}`);
let sessionId = null;

ws.on('open', async () => {
  console.log('Connected to DroidControl server');
  
  // Create a terminal session
  ws.send(JSON.stringify({ type: 'create-session', cols: 120, rows: 40 }));
});

ws.on('message', async (data) => {
  const msg = JSON.parse(data.toString());

  switch (msg.type) {
    case 'session-created':
      sessionId = msg.sessionId;
      console.log(`Session created: ${sessionId}`);
      // Ready to accept natural language commands
      processNaturalLanguage('echo "DroidControl agent ready"');
      break;

    case 'output':
      process.stdout.write(msg.data);
      break;

    case 'session-exit':
      console.log(`Session exited with code ${msg.exitCode}`);
      process.exit(msg.exitCode);
      break;
  }
});

async function processNaturalLanguage(input) {
  if (!sessionId) return;

  // Simple command mapping - extend with LLM integration
  const command = await translateToCommand(input);
  
  ws.send(JSON.stringify({
    type: 'input',
    sessionId,
    data: command + '\n',
  }));
}

async function translateToCommand(naturalLanguage) {
  if (!OPENAI_API_KEY) {
    // Fallback: pass through as-is
    return naturalLanguage;
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You are a terminal command translator. Convert natural language to a single shell command. Return ONLY the command, no explanation.',
        },
        { role: 'user', content: naturalLanguage },
      ],
      temperature: 0,
      max_tokens: 200,
    }),
  });

  const data = await response.json();
  return data.choices[0].message.content.trim();
}
