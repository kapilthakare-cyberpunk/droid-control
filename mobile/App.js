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
} from 'react-native';
import { Terminal } from 'react-native-xterm';

const SERVER_URL = 'ws://YOUR_MACBOOK_IP:8765';
const AUTH_TOKEN = 'dev-token-change-me';

export default function App() {
  const [connected, setConnected] = useState(false);
  const [sessions, setSessions] = useState([]);
  const [activeSession, setActiveSession] = useState(null);
  const [input, setInput] = useState('');
  const [serverUrl, setServerUrl] = useState(SERVER_URL);
  const wsRef = useRef(null);
  const termRef = useRef(null);

  const connect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
    }

    const ws = new WebSocket(`${serverUrl}?token=${AUTH_TOKEN}`);

    ws.onopen = () => {
      setConnected(true);
      console.log('Connected to server');
    };

    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      handleServerMessage(msg);
    };

    ws.onclose = () => {
      setConnected(false);
      setActiveSession(null);
    };

    ws.onerror = (error) => {
      Alert.alert('Connection Error', 'Could not connect to server');
    };

    wsRef.current = ws;
  }, [serverUrl]);

  const handleServerMessage = (msg) => {
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
    }
  };

  const createSession = () => {
    if (!connected) return;
    wsRef.current.send(JSON.stringify({
      type: 'create-session',
      cols: 80,
      rows: 24,
    }));
  };

  const sendInput = () => {
    if (!activeSession || !input) return;
    wsRef.current.send(JSON.stringify({
      type: 'input',
      sessionId: activeSession,
      data: input,
    }));
    setInput('');
  };

  const killSession = (sessionId) => {
    wsRef.current.send(JSON.stringify({
      type: 'kill-session',
      sessionId,
    }));
  };

  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>DroidControl</Text>
        <Text style={styles.status}>
          {connected ? 'Connected' : 'Disconnected'}
        </Text>
      </View>

      {!connected ? (
        <View style={styles.connectSection}>
          <TextInput
            style={styles.input}
            value={serverUrl}
            onChangeText={setServerUrl}
            placeholder="ws://your-macbook-ip:8765"
            autoCapitalize="none"
          />
          <TouchableOpacity style={styles.button} onPress={connect}>
            <Text style={styles.buttonText}>Connect</Text>
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
                >
                  <Text style={styles.sessionTabText}>
                    {item.substring(0, 8)}
                  </Text>
                </TouchableOpacity>
              )}
            />
          </View>

          {activeSession && (
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
                  autoCapitalize="none"
                  returnKeyType="send"
                />
                <TouchableOpacity style={styles.sendBtn} onPress={sendInput}>
                  <Text style={styles.buttonText}>Send</Text>
                </TouchableOpacity>
              </View>
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
  status: {
    color: '#0f3460',
    fontSize: 14,
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
  },
  button: {
    backgroundColor: '#e94560',
    padding: 14,
    borderRadius: 8,
    alignItems: 'center',
  },
  buttonText: {
    color: '#fff',
    fontWeight: 'bold',
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
  },
  sendBtn: {
    backgroundColor: '#e94560',
    paddingHorizontal: 16,
    borderRadius: 6,
    justifyContent: 'center',
  },
});
