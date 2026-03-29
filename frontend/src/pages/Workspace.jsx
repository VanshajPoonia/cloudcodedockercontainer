import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Panel, Group, Separator } from 'react-resizable-panels';
import Editor from '@monaco-editor/react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { io } from 'socket.io-client';
import { 
  Play, Loader2, Code2, TerminalSquare, 
  ChevronDown, FolderTree, FileCode, MonitorPlay, 
  Settings, User 
} from 'lucide-react';
import './Workspace.css';

const BOILERPLATES = {
  javascript: "console.log('Hello from Distributed Platform!');\n\nconst calculateFact = (n) => n <= 1 ? 1 : n * calculateFact(n-1);\nconsole.log('Factorial of 5 is:', calculateFact(5));\n",
  python: "print('Hello from Distributed Platform!')\n\ndef calculate_fact(n):\n    return 1 if n <= 1 else n * calculate_fact(n-1)\n\nprint(f'Factorial of 5 is: {calculate_fact(5)}')\n",
  cpp: "#include <iostream>\n\nint factorial(int n) {\n    return (n <= 1) ? 1 : n * factorial(n - 1);\n}\n\nint main() {\n    std::cout << \"Hello from Distributed Platform!\\n\";\n    std::cout << \"Factorial of 5 is: \" << factorial(5) << \"\\n\";\n    return 0;\n}\n",
  go: "package main\n\nimport \"fmt\"\n\nfunc factorial(n int) int {\n\tif n <= 1 {\n\t\treturn 1\n\t}\n\treturn n * factorial(n-1)\n}\n\nfunc main() {\n\tfmt.Println(\"Hello from Distributed Platform!\")\n\tfmt.Printf(\"Factorial of 5 is: %d\\n\", factorial(5))\n}\n"
};

const socket = io('http://localhost:3001');

export default function Workspace() {
  const { id } = useParams();
  const defaultLang = id && id.includes('-') ? id.split('-')[0] : 'javascript';
  const supportedLang = BOILERPLATES[defaultLang] ? defaultLang : 'javascript';

  const [language, setLanguage] = useState(supportedLang);
  const [code, setCode] = useState(BOILERPLATES[supportedLang]);
  const [isRunning, setIsRunning] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [workspaceId, setWorkspaceId] = useState(null);
  const [containerPort, setContainerPort] = useState(null);
  
  const terminalRef = useRef(null);
  const termInstance = useRef(null);
  const fitAddon = useRef(null);
  const [saving, setSaving] = useState(false);

  // File extension helper
  const ext = language === 'javascript' ? 'js' : language === 'python' ? 'py' : language === 'cpp' ? 'cpp' : 'go';
  const mainFile = `main.${ext}`;

  useEffect(() => {
    // Initialize xterm
    const term = new Terminal({
      theme: { background: '#09090b', foreground: '#f4f4f5' },
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 14,
      cursorBlink: true,
      scrollback: 1000,
    });
    
    fitAddon.current = new FitAddon();
    term.loadAddon(fitAddon.current);
    term.open(terminalRef.current);
    
    setTimeout(() => {
      fitAddon.current.fit();
    }, 100);

    term.writeln('\x1b[38;2;59;130;246m[System] Booting CloudCode Persistent Workspace...\x1b[0m\r\n');
    termInstance.current = term;

    const resizeObserver = new ResizeObserver(() => fitAddon.current.fit());
    if (terminalRef.current) {
        resizeObserver.observe(terminalRef.current);
    }

    // Connect to WebSocket and create workspace
    socket.on('connect', () => setIsConnected(true));
    socket.on('disconnect', () => setIsConnected(false));

    // Handle incoming terminal data
    const handleTtyOutput = (data) => {
      if (termInstance.current) termInstance.current.write(data);
    };

    socket.on('tty_output', handleTtyOutput);

    // Initialise workspace on Mount
    fetch('http://localhost:3001/api/workspace', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ language: supportedLang })
    })
    .then(res => res.json())
    .then(data => {
      if (data.error) {
        throw new Error(data.error);
      }
      
      term.writeln('\x1b[32m[System] Container assigned! Attaching PTY...\x1b[0m\r\n');
      setWorkspaceId(data.workspaceId);
      setContainerPort(data.port);
      
      // Seed the workspace with the initial file
      fetch('http://localhost:3001/api/fs/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          workspaceId: data.workspaceId, 
          filePath: mainFile, 
          content: BOILERPLATES[supportedLang] 
        })
      });

      // Attach TTY
      socket.emit('attach_tty', { containerId: data.containerId });

      // Forward xterm input to backend
      term.onData(input => {
        socket.emit('tty_input', input);
      });
    })
    .catch(err => {
      term.writeln(`\r\n\x1b[31m[System Error] ${err.message}\x1b[0m\r\n`);
    });

    return () => {
      term.dispose();
      resizeObserver.disconnect();
      socket.off('tty_output', handleTtyOutput);
    };
  }, []);

  // Save the code automatically via FS API
  const handleEditorChange = (value) => {
    setCode(value);
    if (!workspaceId) return;

    setSaving(true);
    fetch('http://localhost:3001/api/fs/write', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        workspaceId, 
        filePath: mainFile, 
        content: value 
      })
    })
    .then(() => setSaving(false))
    .catch(console.error);
  };

  const handleLanguageChange = (e) => {
    const newLang = e.target.value;
    setLanguage(newLang);
    setCode(BOILERPLATES[newLang]);
    
    // Changing language mid-session implies we just update the file on disk to the new lang boilerplate
    if (workspaceId) {
       const newExt = newLang === 'javascript' ? 'js' : newLang === 'python' ? 'py' : newLang === 'cpp' ? 'cpp' : 'go';
       fetch('http://localhost:3001/api/fs/write', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          workspaceId, 
          filePath: `main.${newExt}`, 
          content: BOILERPLATES[newLang] 
        })
      });
    }
  };

  const runCode = () => {
    if (!isConnected || !workspaceId) return;
    
    // Focus terminal
    termInstance.current.focus();

    // Type the execution command into the PTY as if user typed it
    let cmd = '';
    if (language === 'javascript') cmd = `node main.js\r`;
    if (language === 'python') cmd = `python main.py\r`;
    if (language === 'cpp') cmd = `g++ main.cpp -o main && ./main\r`;
    if (language === 'go') cmd = `go run main.go\r`;

    socket.emit('tty_input', cmd);
  };

  return (
    <div className="workspace-container">
      {/* Activity Bar */}
      <nav className="activity-bar">
        <div className="activity-bar-top">
          <div className="activity-icon brand-icon-small" onClick={() => window.location.href = '/'}>
             <Code2 size={24} color="#ef4444" />
          </div>
          <div className="activity-icon active"><FolderTree size={20} /></div>
          <div className="activity-icon"><FileCode size={20} /></div>
          <div className="activity-icon"><Settings size={20} /></div>
        </div>
        <div className="activity-bar-bottom">
          <div className="activity-icon"><User size={20} /></div>
        </div>
      </nav>

      <div className="workspace-content">
        <header className="workspace-header">
          <div className="workspace-title">
            <span className="file-name">{mainFile}</span> <span style={{marginLeft: 8, fontSize: '0.75rem', color: '#858585'}}>{saving ? 'Saving...' : 'Saved'}</span>
          </div>

          <div className="controls">
            <div className="select-wrapper">
              <select value={language} onChange={handleLanguageChange}>
                <option value="javascript">Node.js</option>
                <option value="python">Python 3</option>
                <option value="cpp">C++</option>
                <option value="go">Go 1.20</option>
              </select>
              <ChevronDown className="select-arrow" size={16} />
            </div>
            <button 
              className="btn-run" 
              onClick={runCode} 
              disabled={!isConnected || !workspaceId}
            >
              <Play size={18} fill="currentColor" />
              Run
            </button>
          </div>
        </header>

        <main className="workspace-main" style={{display: 'flex', flex: 1, overflow: 'hidden'}}>
          <Group direction="horizontal">
            {/* Sidebar (Instructions/Explorer) */}
            <Panel defaultSize={20} minSize={15} className="sidebar-pane">
              <div className="sidebar-tabs">
                <div className="tab active">INSTRUCTIONS</div>
                <div className="tab">FILES</div>
              </div>
              <div className="sidebar-content markdown-body" style={{padding: '16px'}}>
                <h3 style={{marginTop: 0}}>Hello CloudCode! feat. {language}</h3>
                <p>Enjoy your persistent backend workspace! Your files are synchronized via the internal File System API.</p>
                <p>The terminal below is now a fully interactive `node-pty` docker shell. Try typing `ls -la`!</p>
              </div>
            </Panel>

            <Separator className="resize-handle-horizontal" />

            {/* Center Pane (Editor + Terminal) */}
            <Panel defaultSize={50} minSize={30}>
              <Group direction="vertical">
                {/* Editor */}
                <Panel defaultSize={70} minSize={20} className="editor-pane">
                  <div className="editor-tabs">
                    <div className="tab active">{mainFile}</div>
                  </div>
                  <div className="editor-wrapper">
                    <Editor
                      height="100%"
                      language={language}
                      theme="vs-dark"
                      value={code}
                      onChange={handleEditorChange}
                      options={{
                        minimap: { enabled: false },
                        fontSize: 14,
                        fontFamily: 'JetBrains Mono',
                        padding: { top: 16 }
                      }}
                    />
                  </div>
                </Panel>

                <Separator className="resize-handle-vertical" />

                {/* Terminal */}
                <Panel defaultSize={30} minSize={15} className="terminal-pane">
                  <div className="terminal-tabs">
                    <div className="tab active"><TerminalSquare size={14} /> Terminal</div>
                  </div>
                  <div className="terminal-container" ref={terminalRef}></div>
                </Panel>
              </Group>
            </Panel>

            <Separator className="resize-handle-horizontal" />

            {/* Right Pane (App Preview) */}
            <Panel defaultSize={30} minSize={20} className="preview-pane">
               <div className="pane-header preview-header" style={{ justifyContent: 'center' }}>
                 <div className="preview-tabs">
                    <div className="tab active">Browser</div>
                 </div>
               </div>
               <div className="preview-content" style={{ width: '100%', height: '100%' }}>
                  {containerPort ? (
                     <iframe 
                       src={`http://localhost:${containerPort}`} 
                       style={{ width: '100%', height: '100%', border: 'none', backgroundColor: '#fff' }}
                       title="App Preview"
                     />
                  ) : (
                    <div className="preview-placeholder">
                      <MonitorPlay size={48} className="placeholder-icon" />
                      <h3>Deployed App</h3>
                      <p>Start a web server (e.g., node server.js) on port 3000 inside the terminal to see it here.</p>
                    </div>
                  )}
               </div>
            </Panel>

          </Group>
        </main>
      </div>
    </div>
  );
}
