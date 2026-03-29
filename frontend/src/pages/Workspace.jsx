import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
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
  // id helps us know if it originated from a specific language template e.g., 'python-161...'
  const defaultLang = id && id.includes('-') ? id.split('-')[0] : 'javascript';
  const supportedLang = BOILERPLATES[defaultLang] ? defaultLang : 'javascript';

  const [language, setLanguage] = useState(supportedLang);
  const [code, setCode] = useState(BOILERPLATES[supportedLang]);
  const [isRunning, setIsRunning] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  
  const terminalRef = useRef(null);
  const termInstance = useRef(null);
  const fitAddon = useRef(null);

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

    term.writeln('\x1b[38;2;59;130;246mWelcome to CloudCode Workspace.\x1b[0m\r\nTerminal connected.\r\n');

    termInstance.current = term;

    const resizeObserver = new ResizeObserver(() => fitAddon.current.fit());
    if (terminalRef.current) {
        resizeObserver.observe(terminalRef.current);
    }

    socket.on('connect', () => {
      console.log('Connected to socket stream');
      setIsConnected(true);
    });

    socket.on('disconnect', () => {
      setIsConnected(false);
    });

    const handleOutput = ({ output, type }) => {
      if (!termInstance.current) return;
      const formatted = output.replace(/\n/g, '\r\n');
      if (type === 'stderr') {
        termInstance.current.write(`\x1b[31m${formatted}\x1b[0m`);
      } else {
        termInstance.current.write(formatted);
      }
    };

    const handleStatus = ({ status }) => {
      if (!termInstance.current) return;
      if (status === 'completed' || status === 'error') {
        termInstance.current.writeln(`\r\n\x1b[38;2;161;161;170m[Process ${status}]\x1b[0m\r\n`);
        setIsRunning(false);
      }
    };

    socket.on('execution_output', handleOutput);
    socket.on('execution_status', handleStatus);

    return () => {
      term.dispose();
      resizeObserver.disconnect();
      socket.off('execution_output', handleOutput);
      socket.off('execution_status', handleStatus);
    };
  }, []);

  const handleLanguageChange = (e) => {
    const newLang = e.target.value;
    setLanguage(newLang);
    setCode(BOILERPLATES[newLang]);
  };

  const runCode = async () => {
    if (isRunning) return;
    setIsRunning(true);
    termInstance.current.clear();
    termInstance.current.writeln(`\x1b[38;2;59;130;246m> Running ${language} code...\x1b[0m\r\n`);

    try {
      const res = await fetch('http://localhost:3001/api/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          language,
          socketId: socket.id
        })
      });
      const data = await res.json();
      if (!res.ok) {
        termInstance.current.writeln(`\r\n\x1b[31mError: ${data.error}\x1b[0m`);
        setIsRunning(false);
      }
    } catch (err) {
      termInstance.current.writeln(`\r\n\x1b[31mSubmission failed: ${err.message}\x1b[0m`);
      setIsRunning(false);
    }
  };

  return (
    <div className="workspace-container">
      {/* Activity Bar */}
      <nav className="activity-bar">
        <div className="activity-bar-top">
          <div className="activity-icon brand-icon-small">
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
            <span className="file-name">Hello CloudCode! feat. {language === 'javascript' ? 'Node.js' : language === 'python' ? 'Python' : language === 'cpp' ? 'C++' : 'Go'}</span>
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
              disabled={isRunning || !isConnected}
            >
              {isRunning ? <Loader2 className="loader" size={18} /> : <Play size={18} fill="currentColor" />}
              {isRunning ? 'Running...' : 'Run'}
            </button>
          </div>
        </header>

        <main className="workspace-main" style={{display: 'flex', flex: 1, overflow: 'hidden'}}>
          <PanelGroup direction="horizontal">
            {/* Sidebar (Instructions/Explorer) */}
            <Panel defaultSize={25} minSize={20} className="sidebar-pane">
              <div className="sidebar-tabs">
                <div className="tab active">INSTRUCTIONS</div>
                <div className="tab">CHALLENGES</div>
                <div className="tab">DISCUSSIONS</div>
              </div>
              <div className="sidebar-content markdown-body">
                <h2>Hello CloudCode! feat. {language}</h2>
                <p>Welcome to your first-ever exercise Lab. Take a moment to explore the playground.</p>
                <p>This lab is designed to get you familiar with the Playgrounds. You should have an editor along with a terminal window below the editor on your playground.</p>
                <p>The editor is where all the code gets written, your code is then compiled by a currently running process in the terminal and the result is displayed.</p>
                <h3>Task</h3>
                <p>In this lab, you've been given a very simple Hello World Playground for <code>{language}</code>. Your task is to change the text and make sure to add an exclamation mark.</p>
                <p>Once you've changed the text, you can run your code using the Run button available in the top bar. You should see the output in the Terminal.</p>
              </div>
            </Panel>

            <PanelResizeHandle className="resize-handle-horizontal" />

            {/* Center Pane (Editor + Terminal) */}
            <Panel defaultSize={45} minSize={30}>
              <PanelGroup direction="vertical">
                {/* Editor */}
                <Panel defaultSize={70} minSize={20} className="editor-pane">
                  <div className="editor-tabs">
                    <div className="tab active">main.{language === 'javascript' ? 'js' : language === 'python' ? 'py' : language === 'cpp' ? 'cpp' : 'go'}</div>
                  </div>
                  <div className="editor-wrapper">
                    <Editor
                      height="100%"
                      language={language}
                      theme="vs-dark"
                      value={code}
                      onChange={setCode}
                      options={{
                        minimap: { enabled: false },
                        fontSize: 14,
                        fontFamily: 'JetBrains Mono',
                        padding: { top: 16 }
                      }}
                    />
                  </div>
                </Panel>

                <PanelResizeHandle className="resize-handle-vertical" />

                {/* Terminal */}
                <Panel defaultSize={30} minSize={15} className="terminal-pane">
                  <div className="terminal-tabs">
                    <div className="tab active"><TerminalSquare size={14} /> Terminal</div>
                    <div className="tab">Output</div>
                  </div>
                  <div className="terminal-container" ref={terminalRef}></div>
                </Panel>
              </PanelGroup>
            </Panel>

            <PanelResizeHandle className="resize-handle-horizontal" />

            {/* Right Pane (App Preview) */}
            <Panel defaultSize={30} minSize={20} className="preview-pane">
               <div className="pane-header preview-header" style={{ justifyContent: 'center' }}>
                 <div className="preview-tabs">
                    <div className="tab active">Browser</div>
                 </div>
               </div>
               <div className="preview-content">
                  <div className="preview-placeholder">
                    <MonitorPlay size={48} className="placeholder-icon" />
                    <h3>Deployed App</h3>
                    <p>App running on port 3000 will be shown here.</p>
                  </div>
               </div>
            </Panel>

          </PanelGroup>
        </main>
      </div>
    </div>
  );
}
