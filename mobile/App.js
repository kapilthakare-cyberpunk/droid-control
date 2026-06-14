import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  SafeAreaView,
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  FlatList,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { Terminal } from 'react-native-xterm';
import AsyncStorage from '@react-native-async-storage/async-storage';

const DEFAULT_PORT = 8765;
const AUTH_TOKEN = 'dev-token-change-me';
const STORAGE_KEY = '@droidcontrol_server_url';
const RECONNECT_DELAY = 3000;
const MAX_RECONNECT_ATTEMPTS = 5;

export default function App() {
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [input, setInput] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const [statusMsg, setStatusMsg] = useState('');
  const [discoveredIPs, setDiscoveredIPs] = useState([]);
  const wsRef = useRef(null);
  const termRef = useRef(null);
  const reconnectAttempts = useRef(0);
  const reconnectTimer = useRef(null);
  const handleServerMessageRef = useRef(null);

  // Try to load saved server URL on mount
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((saved) => {
      if (saved) setServerUrl(saved);
    });
  }, []);

  const tryConnect = useCallback(async (url) => {
    if (!url) return false;

    setConnecting(true);
    setStatusMsg('Connecting...');

    return new Promise((resolve) => {
      const ws = new WebSocket(`${url}?token=${AUTH_TOKEN}`);
      const timeout = setTimeout(() => {
        ws.close();
        setConnecting(false);
        setStatusMsg('Connection timed out');
        resolve(false);
      }, 5000);

      ws.onopen = () => {
        clearTimeout(timeout);
        wsRef.current = ws;
        setConnected(true);
        setConnecting(false);
        setStatusMsg('Connected');
        reconnectAttempts.current = 0;
        AsyncStorage.setItem(STORAGE_KEY, url);
        resolve(true);
      };

      ws.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        handleServerMessageRef.current?.(msg);
      };

      ws.onclose = () => {
        clearTimeout(timeout);
        setConnected(false);
        setConnecting(false);
        setActiveSession(null);
        wsRef.current = null;
        resolve(false);
      };

      ws.onerror = () => {
        clearTimeout(timeout);
        setStatusMsg('Connection failed');
        resolve(false);
      };
    });
  }, []);

  const discoverServer = useCallback(async () => {
    setStatusMsg('Scanning for server...');
    setDiscoveredIPs([]);

    // Try common local network ranges
    const commonPrefixes = ['192.168.1', '192.168.0', '192.168.100', '10.0.0', '10.0.1'];
    const found = [];

    const checks = commonPrefixes.flatMap((prefix) =>
      Array.from({ length: 10 }, (_, i) => `${prefix}.${i + 1}`)
    );

    const results = await Promise.allSettled(
      checks.map(async (ip) => {
        try {
          const res = await fetch(`http://${ip}:${DEFAULT_PORT}/health`, {
            signal: AbortSignal.timeout(1500),
          });
          if (res.ok) {
            const data = await res.json();
            return { ip, data };
          }
        } catch {}
        return null;
      })
    );

    for (const r of results) {
      if (r.status === 'fulfilled' && r.value) {
        found.push(r.value);
      }
    }

    if (found.length > 0) {
      setDiscoveredIPs(found);
      const best = found[0];
      setServerUrl(`ws://${best.ip}:${DEFAULT_PORT}`);
      setStatusMsg(`Found server at ${best.ip}`);
      return best.ip;
    }

    setStatusMsg('No server found on network');
    return null;
  }, []);

  const connect = useCallback(async () => {
    let url = serverUrl.trim();

    // If no URL, try discovery first
    if (!url) {
      const discovered = await discoverServer();
      if (!discovered) return;
      url = `ws://${discovered}:${DEFAULT_PORT}`;
      setServerUrl(url);
    }

    // Ensure URL starts with ws://
    if (!url.startsWith('ws://') && !url.startsWith('wss://')) {
      url = `ws://${url}`;
      setServerUrl(url);
    }

    const success = await tryConnect(url);
    if (!success && reconnectAttempts.current < MAX_RECONNECT_ATTEMPTS) {
      reconnectAttempts.current++;
      setStatusMsg(`Retrying (${reconnectAttempts.current}/${MAX_RECONNECT_ATTEMPTS})...`);
      reconnectTimer.current = setTimeout(() => connect(), RECONNECT_DELAY);
    }
  }, [serverUrl, tryConnect, discoverServer]);

  const disconnect = useCallback(() => {
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current);
    }
    reconnectAttempts.current = MAX_RECONNECT_ATTEMPTS; // prevent auto-reconnect
    if (wsRef.current) {
      wsRef.current.close();
    }
  }, []);

  handleServerMessageRef.current = (msg) => {
    switch (msg.type) {
      case 'session-created':
        setSessions((prev) => [...prev, msg.sessionId]);
        setActiveSession(msg.sessionId);
        break;

      case 'output':
        if (termRef.current) {
          termRef.current.write(msg.data);
        }
        break;

      case 'session-list':
        setSessions(msg.sessions);
        break;

      case 'session-exit':
        setSessions((prev) => prev.filter((id) => id !== msg.sessionId));
        if (activeSession === msg.sessionId) {
          setActiveSession(null);
        }
        break;

      case 'pong':
        break;

      case 'error':
        setStatusMsg(`Error: ${msg.message}`);
        break;
    }
  };

  const sendMessage = useCallback((msg) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    }
  }, []);

  const createSession = () => {
    sendMessage({ type: 'create-session', cols: 80, rows: 24 });
  };

  const sendInput = () => {
    if (!activeSession || !input) return;
    sendMessage({ type: 'input', sessionId: activeSession, data: input });
    setInput('');
  };

  const killSession = (sessionId) => {
    sendMessage({ type: 'kill-session', sessionId });
  };

  // Ping keepalive
  useEffect(() => {
    if (!connected) return;
    const interval = setInterval(() => {
      sendMessage({ type: 'ping' });
    }, 30000);
    return () => clearInterval(interval);
  }, [connected, sendMessage]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>DroidControl</Text>
        <View style={styles.statusRow}>
          <View style={[styles.statusDot, connected ? styles.statusDotConnected : styles.statusDotDisconnected]} />
          <Text style={styles.status}>
            {connected ? 'Connected' : connecting ? 'Connecting...' : 'Disconnected'}
          </Text>
        </View>
      </View>

      {statusMsg ? (
        <View style={styles.statusBar}>
          <Text style={styles.statusText}>{statusMsg}</Text>
        </View>
      ) : null}

      {!connected ? (
        <View style={styles.connectSection}>
          <TextInput
            style={styles.input}
            value={serverUrl}
            onChangeText={setServerUrl}
            placeholder="ws://your-macbook-ip:8765"
            placeholderTextColor="#666"
            autoCapitalize="none"
            autoCorrect={false}
          />

          {discoveredIPs.length > 0 && (
            <View style={styles.discoveredSection}>
              <Text style={styles.discoveredLabel}>Discovered:</Text>
              {discoveredIPs.map(({ ip, data }) => (
                <TouchableOpacity
                  key={ip}
                  style={styles.discoveredIP}
                  onPress={() => setServerUrl(`ws://${ip}:${DEFAULT_PORT}`)}
                >
                  <Text style={styles.discoveredIPText}>{ip}</Text>
                  <Text style={styles.discoveredIPInfo}>{data?.name || 'DroidControl'}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <TouchableOpacity
            style={[styles.button, styles.scanButton]}
            onPress={discoverServer}
            disabled={connecting}
          >
            <Text style={styles.buttonText}>Scan Network</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, connecting && styles.buttonDisabled]}
            onPress={connect}
            disabled={connecting}
          >
            {connecting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.buttonText}>Connect</Text>
            )}
          </TouchableOpacity>
        </View>
      ) : (
        <>
          <View style={styles.sessionBar}>
            <TouchableOpacity style={styles.newSessionBtn} onPress={createSession}>
              <Text style={styles.buttonText}>+ New Session</Text>
            </TouchableOpacity>

            <FlatList
              horizontal
              data={sessions}
              keyExtractor={(item) => item}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[
                    styles.sessionTab,
                    activeSession === item && styles.activeSessionTab,
                  ]}
                  onPress={() => setActiveSession(item)}
                  onLongPress={() => {
                    Alert.alert('Kill Session', `Kill session ${item.substring(0, 8)}?`, [
                      { text: 'Cancel', style: 'cancel' },
                      { text: 'Kill', style: 'destructive', onPress: () => killSession(item) },
                    ]);
                  }}
                >
                  <Text style={styles.sessionTabText}>
                    {item.substring(0, 8)}
                  </Text>
                </TouchableOpacity>
              )}
            />
          </View>

          {activeSession ? (
            <View style={styles.terminalContainer}>
              <Terminal
                ref={termRef}
                style={styles.terminal}
                fontSize={14}
                colorScheme="dark"
              />

              <View style={styles.inputBar}>
                <TextInput
                  style={styles.commandInput}
                  value={input}
                  onChangeText={setInput}
                  onSubmitEditing={sendInput}
                  placeholder="Enter command..."
                  placeholderTextColor="#666"
                  autoCapitalize="none"
                  returnKeyType="send"
                />
                <TouchableOpacity style={styles.sendBtn} onPress={sendInput}>
                  <Text style={styles.buttonText}>Send</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : (
            <View style={styles.noSession}>
              <Text style={styles.noSessionText}>
                {sessions.length > 0 ? 'Select a session or create a new one' : 'Create a session to start'}
              </Text>
              <TouchableOpacity style={styles.disconnectBtn} onPress={disconnect}>
                <Text style={styles.buttonText}>Disconnect</Text>
              </TouchableOpacity>
            </View>
          )}
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#16213e',
  },
  title: {
    color: '#e94560',
    fontSize: 20,
    fontWeight: 'bold',
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  statusDotConnected: {
    backgroundColor: '#4ade80',
  },
  statusDotDisconnected: {
    backgroundColor: '#ef4444',
  },
  status: {
    color: '#aaa',
    fontSize: 14,
  },
  statusBar: {
    backgroundColor: '#0f3460',
    padding: 8,
    paddingHorizontal: 16,
  },
  statusText: {
    color: '#e94560',
    fontSize: 12,
  },
  connectSection: {
    flex: 1,
    justifyContent: 'center',
    padding: 20,
  },
  input: {
    backgroundColor: '#16213e',
    color: '#fff',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
    fontSize: 16,
  },
  button: {
    backgroundColor: '#e94560',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 10,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  scanButton: {
    backgroundColor: '#0f3460',
  },
  buttonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
  discoveredSection: {
    marginBottom: 12,
  },
  discoveredLabel: {
    color: '#aaa',
    fontSize: 12,
    marginBottom: 6,
  },
  discoveredIP: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: '#16213e',
    padding: 10,
    borderRadius: 6,
    marginBottom: 4,
  },
  discoveredIPText: {
    color: '#4ade80',
    fontSize: 14,
    fontFamily: 'monospace',
  },
  discoveredIPInfo: {
    color: '#666',
    fontSize: 12,
  },
  sessionBar: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    backgroundColor: '#16213e',
  },
  newSessionBtn: {
    backgroundColor: '#e94560',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    marginRight: 8,
  },
  sessionTab: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 6,
    backgroundColor: '#0f3460',
    marginRight: 6,
  },
  activeSessionTab: {
    backgroundColor: '#e94560',
  },
  sessionTabText: {
    color: '#fff',
    fontSize: 12,
    fontFamily: 'monospace',
  },
  terminalContainer: {
    flex: 1,
  },
  terminal: {
    flex: 1,
    backgroundColor: '#0d0d0d',
  },
  inputBar: {
    flexDirection: 'row',
    padding: 8,
    backgroundColor: '#16213e',
  },
  commandInput: {
    flex: 1,
    backgroundColor: '#0f3460',
    color: '#fff',
    padding: 10,
    borderRadius: 6,
    marginRight: 8,
    fontFamily: 'monospace',
  },
  sendBtn: {
    backgroundColor: '#e94560',
    paddingHorizontal: 16,
    borderRadius: 6,
    justifyContent: 'center',
  },
  noSession: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  noSessionText: {
    color: '#666',
    fontSize: 16,
    marginBottom: 20,
  },
  disconnectBtn: {
    backgroundColor: '#ef4444',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 6,
  },
});
