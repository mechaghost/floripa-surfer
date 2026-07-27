import { mkdir, writeFile } from 'node:fs/promises';
import type { IncomingMessage } from 'node:http';
import { dirname, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

const POSE_LIBRARY_PATH = resolve(process.cwd(), 'src/data/defaultPoseLibrary.json');
const POSE_SAVE_HEADER = 'x-floripa-local-save';
const POSE_SAVE_HEADER_VALUE = '1';
const MAX_POSE_LIBRARY_BYTES = 2_000_000;
const MAX_POSE_STATES = 32;
const MAX_TRANSFORM_ENTRIES = 320;

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
          assertPoseSaveRequest(request);
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
    let rejected = false;
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      if (rejected) {
        return;
      }
      body += chunk;
      if (body.length > MAX_POSE_LIBRARY_BYTES) {
        rejected = true;
        reject(new Error('Pose library payload is too large.'));
        request.destroy();
      }
    });
    request.on('end', () => {
      if (!rejected) {
        resolveBody(body);
      }
    });
    request.on('error', reject);
  });
}

function assertPoseSaveRequest(request: IncomingMessage): void {
  const contentType = request.headers['content-type'];
  if (!headerIncludes(contentType, 'application/json')) {
    throw new Error('Pose library saves must use application/json.');
  }

  if (request.headers[POSE_SAVE_HEADER] !== POSE_SAVE_HEADER_VALUE) {
    throw new Error('Pose library save header is missing.');
  }

  const fetchSite = request.headers['sec-fetch-site'];
  if (typeof fetchSite === 'string' && fetchSite !== 'same-origin' && fetchSite !== 'none') {
    throw new Error('Pose library saves must come from the local editor.');
  }

  const origin = request.headers.origin;
  if (typeof origin !== 'string') {
    return;
  }

  const host = request.headers.host;
  if (typeof host !== 'string') {
    throw new Error('Pose library save host is missing.');
  }

  try {
    if (new URL(origin).host !== host) {
      throw new Error('Pose library saves must be same-origin.');
    }
  } catch {
    throw new Error('Pose library save origin is invalid.');
  }
}

function headerIncludes(header: string | string[] | undefined, needle: string): boolean {
  if (Array.isArray(header)) {
    return header.some((value) => value.toLowerCase().includes(needle));
  }

  return typeof header === 'string' && header.toLowerCase().includes(needle);
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

  const stateEntries = Object.entries(library.states as Record<string, unknown>);
  if (stateEntries.length > MAX_POSE_STATES) {
    throw new Error('Pose library includes too many states.');
  }

  for (const [name, state] of stateEntries) {
    assertPoseStateName(name);
    assertSavedPose(state);
  }
}

function assertPoseStateName(value: string): void {
  if (!/^[a-z0-9_-]{1,64}$/.test(value)) {
    throw new Error(`Pose state "${value}" has an invalid name.`);
  }
}

function assertSavedPose(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Pose state must be an object.');
  }

  const pose = value as Record<string, unknown>;
  if (typeof pose.asset !== 'string' || typeof pose.savedAt !== 'string') {
    throw new Error('Pose state is missing required metadata.');
  }

  assertTransformRecord(pose.bones, 'bones');
  assertVectorRecord(pose.ikTargets, 'ik targets');
}

function assertTransformRecord(value: unknown, label: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Pose ${label} must be an object.`);
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_TRANSFORM_ENTRIES) {
    throw new Error(`Pose includes too many ${label}.`);
  }

  for (const [name, transform] of entries) {
    assertRigNodeName(name);
    if (!transform || typeof transform !== 'object' || Array.isArray(transform)) {
      throw new Error(`Pose ${label} entry "${name}" must be an object.`);
    }

    const record = transform as Record<string, unknown>;
    assertFiniteVector3(record.position, `${name} position`);
    assertFiniteVector3(record.rotation, `${name} rotation`);
    assertFiniteVector3(record.scale, `${name} scale`);
  }
}

function assertVectorRecord(value: unknown, label: string): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Pose ${label} must be an object.`);
  }

  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > MAX_TRANSFORM_ENTRIES) {
    throw new Error(`Pose includes too many ${label}.`);
  }

  for (const [name, vector] of entries) {
    assertRigNodeName(name);
    assertFiniteVector3(vector, `${name} target`);
  }
}

function assertRigNodeName(value: string): void {
  if (value.length === 0 || value.length > 96 || /[\u0000-\u001f]/.test(value)) {
    throw new Error('Pose contains an invalid rig node name.');
  }
}

function assertFiniteVector3(value: unknown, label: string): void {
  if (
    !Array.isArray(value) ||
    value.length !== 3 ||
    !value.every((item) => typeof item === 'number' && Number.isFinite(item))
  ) {
    throw new Error(`Pose ${label} must be a finite vector.`);
  }
}

export default defineConfig({
  plugins: [poseLibraryWriter()],
});
