import React from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutDashboard, BookOpen, GraduationCap, Compass, HelpCircle, Code2, Hash, TerminalSquare } from 'lucide-react';
import './Dashboard.css';

const TEMPLATES = [
  { id: 'html', name: 'HTML/CSS', desc: 'Vanilla HTML/CSS/JS playground', icon: '🌐', color: '#e34f26' },
  { id: 'react', name: 'React', desc: 'React playground using Vite', icon: '⚛️', color: '#61dafb' },
  { id: 'python', name: 'Python', desc: 'Python 3 playground', icon: '🐍', color: '#3776ab' },
  { id: 'java', name: 'Java', desc: 'Java playground', icon: '☕', color: '#b07219' },
  { id: 'golang', name: 'Golang', desc: 'Golang playground', icon: '🐹', color: '#00add8' },
  { id: 'nodejs', name: 'Node.js', desc: 'Node.js 18 playground', icon: '🟢', color: '#339933' },
  { id: 'cpp', name: 'C++', desc: 'C++ playground', icon: '⚙️', color: '#f34b7d' },
  { id: 'c', name: 'C', desc: 'C playground', icon: '⚙️', color: '#555555' }
];

export default function Dashboard() {
  const navigate = useNavigate();

  const handleCreate = (templateId) => {
    navigate(`/workspace/${templateId}-demo`);
  };

  return (
    <div className="dashboard-layout">
      {/* Sidebar */}
      <aside className="dashboard-sidebar">
        <div className="sidebar-brand">
          <Code2 className="brand-icon" size={24} />
          <span>CloudCode</span>
        </div>
        
        <nav className="sidebar-nav">
          <a href="#" className="nav-item">
            <LayoutDashboard size={18} /> Dashboard
          </a>
          <a href="#" className="nav-item">
            <BookOpen size={18} /> My Courses
          </a>
          <a href="#" className="nav-item">
            <GraduationCap size={18} /> My Learning Paths
          </a>

          <h4 className="nav-heading">Learn</h4>
          <a href="#" className="nav-item">
            <Compass size={18} /> Explore all
          </a>
          <a href="#" className="nav-item text-gray">
            <HelpCircle size={18} /> AI Problem Solver
          </a>

          <h4 className="nav-heading">Practice</h4>
          <a href="#" className="nav-item">
            <Code2 size={18} /> Coding Labs
          </a>
          <a href="#" className="nav-item">
            <Hash size={18} /> Coding Challenges
          </a>
          <a href="#" className="nav-item active">
            <TerminalSquare size={18} /> Playgrounds (IDE)
          </a>
        </nav>
      </aside>

      {/* Main Content Area */}
      <div className="dashboard-main">
        <header className="dashboard-topbar">
          <div className="topbar-left">
            <span className="categories-link">Categories</span>
          </div>
          <div className="topbar-right">
            <button className="btn-secondary">Login</button>
            <button className="btn-primary">Register</button>
          </div>
        </header>

        <main className="dashboard-content">
          <div className="content-header">
            <h1>Create Playgrounds</h1>
            <p>Coding playgrounds on CloudCode are powered by remote computing and start within a few seconds. Practice coding while learning for free.</p>
          </div>

          <div className="templates-grid">
            {TEMPLATES.map((template) => (
              <div 
                key={template.id} 
                className="template-card"
                onClick={() => handleCreate(template.id)}
              >
                <div className="template-icon" style={{ color: template.color }}>
                  {template.icon}
                </div>
                <div className="template-info">
                  <h3>{template.name}</h3>
                  <p>{template.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </main>
      </div>
    </div>
  );
}
