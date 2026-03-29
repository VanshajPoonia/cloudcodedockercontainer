import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { Queue } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';
import Redis from 'ioredis';
import Docker from 'dockerode';
import fs from 'fs';
import path from 'path';

const app = express();
app.use(cors());
app.use(express.json());

const server = createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const redisOptions = { host: '127.0.0.1', port: 6379 };
const executionQueue = new Queue('code-execution', { connection: redisOptions });
const subscriber = new Redis(redisOptions);

const docker = new Docker({ socketPath: '/var/run/docker.sock' });

// Maps jobId to socketId for old code-execution 
const jobSockets = new Map();

// Map workspace to their readiness promise
const pendingWorkspaces = new Map();

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  // Interactive Terminal PTY setup
  socket.on('attach_tty', async ({ containerId }) => {
    try {
      const container = docker.getContainer(containerId);
      const exec = await container.exec({
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: true,
        Cmd: ['/bin/sh']
      });

      const execStream = await exec.start({ stdin: true });
      
      // Pipe docker output to socket
      execStream.on('data', (chunk) => {
        socket.emit('tty_output', chunk.toString('utf-8'));
      });

      // Pipe socket input to docker
      socket.on('tty_input', (data) => {
        execStream.write(data);
      });

      socket.on('disconnect', () => {
        // execStream dies when socket disconnects usually, but we can explicitly end
        execStream.end();
      });

    } catch (e) {
      console.error('Failed to attach TTY', e);
      socket.emit('tty_output', '\r\n[Error attaching to terminal process]\r\n');
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

// REST API for starting a workspace
app.post('/api/workspace', async (req, res) => {
  try {
    const { language } = req.body;
    const workspaceId = uuidv4();

    // Setup a promise to wait for the worker to finish creating it
    const readinessPromise = new Promise((resolve) => {
      pendingWorkspaces.set(workspaceId, resolve);
      // Timeout after 30s
      setTimeout(() => resolve(null), 30000);
    });

    await executionQueue.add('create-workspace', { workspaceId, language });
    
    // Wait for redis message from worker
    const workspaceInfo = await readinessPromise;
    pendingWorkspaces.delete(workspaceId);

    if (!workspaceInfo) {
      return res.status(500).json({ error: 'Workspace creation timed out' });
    }

    res.json(workspaceInfo);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// File System APIs
app.get('/api/fs/read', (req, res) => {
  const { workspaceId, filePath } = req.query;
  try {
    const targetPath = path.join('/tmp/workspaces', workspaceId, filePath || '');
    if (!fs.existsSync(targetPath)) return res.status(404).json({ error: 'Not found' });
    
    const stat = fs.statSync(targetPath);
    if (stat.isDirectory()) {
      const files = fs.readdirSync(targetPath);
      return res.json({ type: 'directory', files });
    } else {
      const content = fs.readFileSync(targetPath, 'utf8');
      return res.json({ type: 'file', content });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/fs/write', (req, res) => {
  const { workspaceId, filePath, content } = req.body;
  try {
    const targetPath = path.join('/tmp/workspaces', workspaceId, filePath);
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, content, 'utf8');
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Legacy single-execution endpoint
app.post('/api/execute', async (req, res) => {
  try {
    const { code, language, socketId } = req.body;
    const jobId = uuidv4();
    jobSockets.set(jobId, socketId);
    await executionQueue.add('execute-job', { code, language, jobId }, { jobId });
    res.json({ success: true, jobId });
  } catch (error) {
    res.status(500).json({ error: 'Failed to enqueue job' });
  }
});

subscriber.subscribe('stream-output');
subscriber.subscribe('workspace-ready');

subscriber.on('message', (channel, message) => {
  try {
    const data = JSON.parse(message);
    if (channel === 'workspace-ready') {
      const resolver = pendingWorkspaces.get(data.workspaceId);
      if (resolver) resolver(data);
    }
    
    if (channel === 'stream-output') {
      const socketId = jobSockets.get(data.jobId);
      if (!socketId) return;
      if (data.status === 'stream') io.to(socketId).emit('execution_output', { output: data.output, type: data.type });
      else if (data.status === 'completed' || data.status === 'error') {
        io.to(socketId).emit('execution_status', { status: data.status });
        jobSockets.delete(data.jobId);
      }
    }
  } catch (e) {
    console.error('Redis message parse error', e);
  }
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Backend API listening on http://localhost:${PORT}`);
});
