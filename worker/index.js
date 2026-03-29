import { Worker } from 'bullmq';
import Redis from 'ioredis';
import Docker from 'dockerode';
import stream from 'stream';
import fs from 'fs';
import path from 'path';

const redisOptions = { host: '127.0.0.1', port: 6379 };
const publisher = new Redis(redisOptions);

// Connect to local docker daemon
// Note: on Mac with OrbStack or Docker Desktop, the socket is usually at /var/run/docker.sock
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

const LANG_CONFIG = {
  python: {
    image: 'python:3.9-alpine',
    cmd: (code) => ['python', '-c', code],
  },
  javascript: {
    image: 'node:18-alpine',
    cmd: (code) => ['node', '-e', code],
  },
  cpp: {
    image: 'gcc:12', // standard gcc debian latest
    cmd: (code) => {
      const eof = 'EOF_CODE';
      return ['sh', '-c', `cat << '${eof}' > main.cpp\n${code}\n${eof}\ng++ main.cpp -O3 -o main && ./main`];
    }
  },
  go: {
    image: 'golang:1.20-alpine',
    cmd: (code) => {
      const eof = 'EOF_CODE';
      return ['sh', '-c', `cat << '${eof}' > main.go\n${code}\n${eof}\ngo run main.go`];
    }
  }
};

async function ensureImage(imageName) {
  try {
    await docker.getImage(imageName).inspect();
  } catch (e) {
    if (e.statusCode === 404) {
      console.log(`Image ${imageName} not found. Pulling...`);
      await new Promise((resolve, reject) => {
        docker.pull(imageName, (err, passStream) => {
          if (err) return reject(err);
          docker.modem.followProgress(passStream, (error, res) => error ? reject(error) : resolve(res));
        });
      });
      console.log(`Finished pulling ${imageName}.`);
    } else {
      throw e;
    }
  }
}

async function startup() {
  console.log('Ensuring all languages images are downloaded...');
  for (const config of Object.values(LANG_CONFIG)) {
    await ensureImage(config.image).catch(err => console.error('Failed to pull image:', err));
  }

  const worker = new Worker('code-execution', async (job) => {
    if (job.name === 'create-workspace') {
      const { workspaceId, language } = job.data;
      const config = LANG_CONFIG[language];
      if (!config) throw new Error(`Unsupported language: ${language}`);

      console.log(`Creating persistent workspace ${workspaceId} for language ${language}`);
      const hostPath = path.join('/tmp/workspaces', workspaceId);
      fs.mkdirSync(hostPath, { recursive: true });

      // Create a persistent container running indefinitely
      const container = await docker.createContainer({
        Image: config.image,
        Cmd: ['tail', '-f', '/dev/null'],
        WorkingDir: '/workspace',
        Tty: true,
        HostConfig: {
          Binds: [`${hostPath}:/workspace`],
          PortBindings: { '3000/tcp': [{ HostPort: '0' }] }, // dynamic port for previews
          NetworkMode: 'bridge',
          Memory: 256 * 1024 * 1024, // 256 MB limit for persistent IDE
          CpuQuotota: 50000, 
        },
        ExposedPorts: { '3000/tcp': {} }
      });

      await container.start();
      const inspect = await container.inspect();
      let port = null;
      if (inspect.NetworkSettings.Ports && inspect.NetworkSettings.Ports['3000/tcp']) {
        port = inspect.NetworkSettings.Ports['3000/tcp'][0].HostPort;
      }

      console.log(`Workspace ${workspaceId} started! Container ID: ${container.id}, Port: ${port}`);
      
      // Notify backend that workspace is ready
      await publisher.publish('workspace-ready', JSON.stringify({ 
        workspaceId, 
        containerId: container.id, 
        port 
      }));

      return { containerId: container.id, port };
    }

    if (job.name === 'execute-job') {
      const { code, language, jobId } = job.data;
      const config = LANG_CONFIG[language];

      if (!config) {
        await publisher.publish('stream-output', JSON.stringify({ 
          jobId, type: 'stderr', status: 'stream', output: `\n[System Error: Unsupported language '${language}'. Ensure worker is restarted.]\n` 
        }));
        await publisher.publish('stream-output', JSON.stringify({ jobId, status: 'error' }));
        throw new Error(`Unsupported language: ${language}`);
      }

      console.log(`Starting job ${jobId} for language ${language}`);

      // Create stream publisher
      const createRedisStream = (type) => {
        return new stream.Writable({
          write(chunk, encoding, callback) {
            publisher.publish('stream-output', JSON.stringify({
              jobId, type, status: 'stream', output: chunk.toString()
            })).catch(console.error);
            callback();
          }
        });
      };

      const stdoutStream = createRedisStream('stdout');
      const stderrStream = createRedisStream('stderr');

      let container;
      try {
        container = await docker.createContainer({
          Image: config.image,
          Cmd: config.cmd(code),
          Tty: false,
          AttachStdout: true,
          AttachStderr: true,
          HostConfig: {
            NetworkMode: 'none', // Isolation
            Memory: 128 * 1024 * 1024,
            CpuQuotota: 50000,
            AutoRemove: true
          }
        });

        const execStream = await container.attach({ stream: true, stdout: true, stderr: true });
        container.modem.demuxStream(execStream, stdoutStream, stderrStream);

        await container.start();

        const TIMEOUT_MS = 5000;
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('EXECUTION_TIMEOUT')), TIMEOUT_MS);
        });

        const waitPromise = container.wait();

        await Promise.race([waitPromise, timeoutPromise]);

        await publisher.publish('stream-output', JSON.stringify({ jobId, status: 'completed' }));
        console.log(`Job ${jobId} finished.`);

      } catch (error) {
        console.error(`Job ${jobId} error:`, error.message);
        
        if (error.message === 'EXECUTION_TIMEOUT' && container) {
          try { await container.kill(); } catch (killErr) {}
          await publisher.publish('stream-output', JSON.stringify({ 
            jobId, type: 'stderr', status: 'stream', output: '\n[Error: Execution Timed Out after 5 seconds]\n' 
          }));
        }

        await publisher.publish('stream-output', JSON.stringify({ jobId, status: 'error' }));
      }
    }
  }, { connection: redisOptions });

  worker.on('failed', (job, err) => {
    console.error(`${job?.id} has failed with ${err.message}`);
  });

  console.log('Worker listening for jobs...');
}

startup();
