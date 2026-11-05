import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { openDatabase } from '../src/core/database.ts';
import { createApp } from '../src/api/app.ts';
import { scanLibrary } from '../src/worker/scan.ts';

if (process.argv[2] === '--scan-worker') {
  const filename = process.argv[3]!; const root = process.argv[4]!;
  const db = openDatabase(filename);
  let running = true;
  process.on('SIGTERM', () => { running = false; });
  process.on('SIGINT', () => { running = false; });
  process.stdout.write('ready\n');
  try {
    while (running) {
      await scanLibrary(db, { id: 'fixture', root }, { allowedRoots: [root], batchSize: 64 });
      process.stdout.write('scan\n');
      if (running) await delay(50);
    }
  } finally { db.close(); }
} else {
  const count = Number(process.env.BENCH_COUNT ?? 1_000_000);
  const samples = Number(process.env.BENCH_SAMPLES ?? 30);
  if (!Number.isInteger(count) || count < 1 || count > 2_000_000 || !Number.isInteger(samples) || samples < 5 || samples > 1000) throw new Error('基准参数无效');
  const work = await mkdtemp(path.join(os.tmpdir(), 'luvia-bench-'));
  const filename = path.join(work, 'bench.db');
  const fixture = path.join(work, 'fixture');
  await mkdir(fixture);
  for (let index = 0; index < 100; index++) await writeFile(path.join(fixture, `${index}.jpg`), 'fixture');
  const db = openDatabase(filename);
  let child: ReturnType<typeof spawn> | undefined;
  let app: Awaited<ReturnType<typeof createApp>> | undefined;
  try {
    db.prepare("INSERT INTO libraries(id,name,root) VALUES ('bench','合成库',?),('fixture','扫描夹具',?)").run(path.join(work, 'synthetic'), fixture);
    const addFolder = db.prepare('INSERT INTO folders(path,library_id,parent,name,media_count,direct_media_count,child_count) VALUES (?,?,?,?,?,?,?)');
    const addFile = db.prepare(`INSERT INTO files(id,library_id,relative_path,folder,name,mime,media_type,size,modified_at,taken_at,taken_at_source,width,height)
      VALUES (?,'bench',?,?,?,'image/jpeg','image',?,?,?,'mtime',1920,1080)`);
    db.transaction(() => {
      const groupCount = Math.ceil(count / 5000);
      addFolder.run('bench', 'bench', null, '合成库', count, 0, groupCount);
      for (let group = 0; group < groupCount; group++) {
        const groupPath = `bench/g${String(group).padStart(4, '0')}`;
        const groupSize = Math.min(5000, count - group * 5000);
        addFolder.run(groupPath, 'bench', 'bench', `组 ${group}`, groupSize, 0, Math.ceil(groupSize / 50));
        for (let sub = 0; sub < Math.ceil(groupSize / 50); sub++) {
          const folder = `${groupPath}/d${String(sub).padStart(3, '0')}`;
          const size = Math.min(50, groupSize - sub * 50);
          addFolder.run(folder, 'bench', groupPath, `目录 ${sub}`, size, size, 0);
        }
      }
    }).immediate();
    const batch = db.transaction((start: number, end: number) => {
      for (let i = start; i < end; i++) {
        const group = Math.floor(i / 5000); const sub = Math.floor(i % 5000 / 50);
        const relativeFolder = `g${String(group).padStart(4, '0')}/d${String(sub).padStart(3, '0')}`;
        const name = `IMG_${String(i).padStart(8, '0')}.jpg`;
        const time = 1_609_459_200 + (i % 1825) * 86400;
        addFile.run(`file_${String(i).padStart(8, '0')}`, `${relativeFolder}/${name}`, `bench/${relativeFolder}`, name, 100000 + i % 100000, time, time);
      }
    });
    for (let start = 0; start < count; start += 5000) {
      batch.immediate(start, Math.min(start + 5000, count));
      if ((start + 5000) % 100000 === 0 || start + 5000 >= count) process.stderr.write(`已写入 ${Math.min(start + 5000, count)} 条\n`);
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    app = await createApp({ db, legacyPending: false });
    const setup = await app.inject({ method: 'POST', url: '/api/v2/auth/setup', headers: { 'x-luvia-request': '1' }, payload: { username: 'bench', password: 'synthetic-password' } });
    if (setup.statusCode !== 200) throw new Error('基准账户初始化失败');
    const cookie = (setup.headers['set-cookie'] as string).split(';')[0]!;
    child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--scan-worker', filename, fixture], { stdio: ['ignore', 'pipe', 'inherit'] });
    let scansCompleted = 0; let buffered = '';
    let signalFirstScan!: () => void;
    const firstScan = new Promise<void>((resolve) => { signalFirstScan = resolve; });
    child.stdout!.on('data', (chunk: Buffer) => {
      buffered += chunk.toString('utf8');
      const lines = buffered.split('\n'); buffered = lines.pop() ?? '';
      for (const line of lines) if (line === 'scan') { scansCompleted++; signalFirstScan(); }
    });
    await Promise.race([firstScan, delay(10000, undefined, { ref: false }).then(() => { throw new Error('扫描 worker 未完成首轮扫描'); })]);
    const get = async (url: string) => {
      const started = performance.now();
      const response = await app!.inject({ method: 'GET', url, headers: { cookie } });
      const duration = performance.now() - started;
      if (response.statusCode !== 200) throw new Error(`基准请求失败: ${response.statusCode}`);
      return { duration, body: response.json() };
    };
    const first = await get('/api/v2/media?limit=120');
    const cursor = first.body.nextCursor as string;
    if (!cursor && count > 120) throw new Error('基准续页游标缺失');
    const cold = await get('/api/v2/media/buckets');
    const paths: Record<string, string> = {
      homepage: '/api/v2/media?limit=120', nextPage: `/api/v2/media?limit=120&cursor=${encodeURIComponent(cursor)}`,
      buckets: '/api/v2/media/buckets', random: '/api/v2/media/random?count=24', folders: '/api/v2/folders?path=bench',
    };
    const data: Record<string, number[]> = Object.fromEntries(Object.keys(paths).map((key) => [key, []]));
    const loop = monitorEventLoopDelay({ resolution: 10 });
    loop.enable();
    const scansBefore = scansCompleted;
    for (let index = 0; index < samples; index++) {
      for (const [name, url] of Object.entries(paths)) {
        data[name]!.push((await get(url)).duration);
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
      await delay(20);
    }
    await delay(20);
    loop.disable();
    if (scansCompleted <= scansBefore) throw new Error('采样期间未观察到扫描完成');
    const percentile = (values: number[], p: number) => {
      const sorted = [...values].sort((a, b) => a - b);
      return Math.round(sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)]! * 100) / 100;
    };
    const results = Object.fromEntries(Object.entries(data).map(([name, values]) => [name, { p50Ms: percentile(values, .5), p95Ms: percentile(values, .95) }]));
    process.stdout.write(`${JSON.stringify({ count, samples, node: process.version, platform: `${os.platform()}-${os.arch()}`, cpu: os.cpus()[0]?.model, memoryBytes: os.totalmem(), concurrent: '独立进程反复扫描 100 个合成文件', scansCompleted, coldBucketsMs: Math.round(cold.duration * 100) / 100, eventLoopP99Ms: Math.round(loop.percentile(99) / 1e4) / 100, results }, null, 2)}\n`);
  } finally {
    if (child) {
      child.kill('SIGTERM');
      await Promise.race([once(child, 'exit').catch(() => {}), delay(5000, undefined, { ref: false }).then(() => { if (child?.exitCode === null) child.kill('SIGKILL'); })]);
    }
    await app?.close(); db.close();
    await rm(work, { recursive: true, force: true });
  }
}
