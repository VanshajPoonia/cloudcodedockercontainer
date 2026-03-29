import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { Queue } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';
import Redis from 'ioredis';

const app = express();
app.use(cors());
app.use(express.json());

const server = createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const redisOptions = { host: '127.0.0.1', port: 6379 };
const executionQueue = new Queue('code-execution', { connection: redisOptions });

// Maps jobId to socketId so we can send updates to the right client
const jobSockets = new Map();

io.on('connection', (socket) => {
  console.log('Client connected:', socket.id);
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

app.post('/api/execute', async (req, res) => {
  try {
    const { code, language, socketId } = req.body;
    
    if (!code || !language || !socketId) {
      return res.status(400).json({ error: 'Missing required fields: code, language, socketId' });
    }

    const jobId = uuidv4();
    jobSockets.set(jobId, socketId);

    // Enqueue the job for the worker
    await executionQueue.add('execute-job', {
      code,
      language,
      jobId
    }, {
      jobId
    });

    res.json({ success: true, jobId });
  } catch (error) {
    console.error('Queue error:', error);
    res.status(500).json({ error: 'Failed to enqueue job' });
  }
});

// Setup Redis subscriber to listen for stream output from the worker
const subscriber = new Redis(redisOptions);

subscriber.subscribe('stream-output', (err, count) => {
  if (err) {
    console.error('Failed to subscribe:', err);
  } else {
    console.log(`Subscribed to stream channel`);
  }
});

subscriber.on('message', (channel, message) => {
  if (channel === 'stream-output') {
    try {
      const { jobId, output, type, status } = JSON.parse(message);
      const socketId = jobSockets.get(jobId);
      
      if (!socketId) return;

      if (status === 'stream') {
        io.to(socketId).emit('execution_output', { output, type }); // type is 'stdout' or 'stderr'
      } else if (status === 'completed' || status === 'error') {
        io.to(socketId).emit('execution_status', { status });
        jobSockets.delete(jobId);
      }
    } catch (e) {
      console.error('Failed to parse redis message', e);
    }
  }
});

const PORT = 3001;
server.listen(PORT, () => {
  console.log(`Backend API listening on http://localhost:${PORT}`);
});
