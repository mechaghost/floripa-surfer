import { mkdir, writeFile } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { dirname, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const POSE_LIBRARY_PATH = resolve(process.cwd(), 'src/data/defaultPoseLibrary.json');

function poseLibraryWriter(): Plugin {
  return {
    name: 'floripa-pose-library-writer',
    configureServer(server) {
      server.middlewares.use('/__floripa/pose-library', async (request, response, next) => {
        if (request.method !== 'POST') {
          next();
          return;
        }

        try {
          const body = await readRequestBody(request);
          const poseLibrary = JSON.parse(body) as unknown;
          assertPoseLibrary(poseLibrary);
          await mkdir(dirname(POSE_LIBRARY_PATH), { recursive: true });
          await writeFile(POSE_LIBRARY_PATH, `${JSON.stringify(poseLibrary, null, 2)}\n`, 'utf8');
          response.statusCode = 200;
          response.setHeader('content-type', 'application/json');
          response.end(JSON.stringify({ ok: true, path: POSE_LIBRARY_PATH }));
        } catch (error) {
          response.statusCode = 400;
          response.setHeader('content-type', 'application/json');
          response.end(JSON.stringify({
            ok: false,
            error: error instanceof Error ? error.message : 'Could not save pose library.',
          }));
        }
      });
    },
  };
}

function readRequestBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolveBody, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error('Pose library payload is too large.'));
      }
    });
    request.on('end', () => resolveBody(body));
    request.on('error', reject);
  });
}

function assertPoseLibrary(value: unknown): asserts value is {
  asset: string;
  updatedAt: string;
  activeState: string;
  states: Record<string, unknown>;
} {
  if (!value || typeof value !== 'object') {
    throw new Error('Pose library must be an object.');
  }

  const library = value as Record<string, unknown>;
  if (typeof library.asset !== 'string' || typeof library.updatedAt !== 'string' || typeof library.activeState !== 'string') {
    throw new Error('Pose library is missing required metadata.');
  }

  if (!library.states || typeof library.states !== 'object' || Array.isArray(library.states)) {
    throw new Error('Pose library must include a states object.');
  }
}

export default defineConfig({
  plugins: [poseLibraryWriter()],
});
