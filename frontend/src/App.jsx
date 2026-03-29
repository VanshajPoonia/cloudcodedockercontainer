import React, { useState, useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { io } from 'socket.io-client';
import { Play, Loader2, Code2, TerminalSquare, ChevronDown } from 'lucide-react';

const BOILERPLATES = {
  javascript: "console.log('Hello from Distributed Platform!');\n\nconst calculateFact = (n) => n <= 1 ? 1 : n * calculateFact(n-1);\nconsole.log('Factorial of 5 is:', calculateFact(5));\n",
  python: "print('Hello from Distributed Platform!')\n\ndef calculate_fact(n):\n    return 1 if n <= 1 else n * calculate_fact(n-1)\n\nprint(f'Factorial of 5 is: {calculate_fact(5)}')\n",
  cpp: "#include <iostream>\n\nint factorial(int n) {\n    return (n <= 1) ? 1 : n * factorial(n - 1);\n}\n\nint main() {\n    std::cout << \"Hello from Distributed Platform!\\n\";\n    std::cout << \"Factorial of 5 is: \" << factorial(5) << \"\\n\";\n    return 0;\n}\n",
  go: "package main\n\nimport \"fmt\"\n\nfunc factorial(n int) int {\n\tif n <= 1 {\n\t\treturn 1\n\t}\n\treturn n * factorial(n-1)\n}\n\nfunc main() {\n\tfmt.Println(\"Hello from Distributed Platform!\")\n\tfmt.Printf(\"Factorial of 5 is: %d\\n\", factorial(5))\n}\n"
};

const socket = io('http://localhost:3001');

function App() {
  const [language, setLanguage] = useState('javascript');
  const [code, setCode] = useState(BOILERPLATES['javascript']);
  const [isRunning, setIsRunning] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const terminalRef = useRef(null);
  const termInstance = useRef(null);
  const fitAddon = useRef(null);

  useEffect(() => {
    // Initialize xterm
    const term = new Terminal({
      theme: { background: '#000000', foreground: '#f4f4f5' },
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 14,
      cursorBlink: true,
      scrollback: 1000,
    });
    
    fitAddon.current = new FitAddon();
    term.loadAddon(fitAddon.current);
    term.open(terminalRef.current);
    
    // Slight delay to ensure parent dimensions are calculated
    setTimeout(() => {
      fitAddon.current.fit();
    }, 100);

    term.writeln('\x1b[38;2;59;130;246mWelcome to CloudCode.\x1b[0m\r\nSelect a language and press Run.\r\n');

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
      // Convert normal newlines to carriage return + newline for xterm
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
    // Clear terminal on lang change if desired, or leave it
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
    <div className="app-container">
      <header className="header">
        <div className="brand">
          <Code2 className="brand-icon" size={28} />
          <span>CloudCode</span>
        </div>
        <div className="controls">
          <div className="select-wrapper">
            <select value={language} onChange={handleLanguageChange}>
              <option value="javascript">Node.js (JavaScript)</option>
              <option value="python">Python 3</option>
              <option value="cpp">C++ (GCC)</option>
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
            {isRunning ? 'Running...' : 'Run Code'}
          </button>
        </div>
      </header>
      
      <main className="workspace">
        <section className="editor-pane">
           <div className="pane-header">
             <Code2 size={16} /> <span style={{ textTransform: 'uppercase' }}>{language} Editor</span>
           </div>
           <Editor
             height="calc(100vh - 100px)"
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
        </section>
        <section className="terminal-pane">
          <div className="pane-header" style={{ borderLeft: '1px solid #27272a' }}>
             <TerminalSquare size={16} /> <span>Output Console</span>
          </div>
          <div className="terminal-container" ref={terminalRef}></div>
        </section>
      </main>
    </div>
  );
}

export default App;
