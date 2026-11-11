import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  access,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, test } from "vitest";
const exec = promisify(execFile),
  commit = "b".repeat(40);
async function fixture(mode: string) {
  const temporary = await mkdtemp(join(tmpdir(), "dtv-rollback-")),
    root = join(temporary, "server"),
    bin = join(temporary, "bin"),
    payload = join(root, "releases", commit, "payload");
  for (const path of [
    bin,
    join(root, "auth"),
    join(root, "tianqing"),
    join(root, "migrations"),
    join(payload, "migrations"),
    join(payload, "licensing"),
    join(temporary, "empty"),
  ])
    await mkdir(path, { recursive: true });
  await writeFile(join(root, "compose.yaml"), "old compose\n");
  await writeFile(join(root, ".env"), "POSTGRES_PASSWORD=test-only\n");
  await writeFile(join(root, "config.json"), "{}");
  await writeFile(
    join(root, "auth/users.json"),
    JSON.stringify([{ id: "admin", tenantId: "test", role: "admin" }]),
  );
  await writeFile(join(payload, "compose.yaml"), "new compose\n");
  await writeFile(
    join(payload, "nginx.conf"),
    "proxy_pass http://core-api:3001;\n",
  );
  await writeFile(
    join(payload, "migrations/007_runtime_configuration.sql"),
    "CREATE TABLE example(id int);\n",
  );
  await writeFile(join(payload, "licensing/trust-roots.json"), "{}");
  await exec("tar", [
    "-czf",
    join(temporary, "files.tar.gz"),
    "-C",
    join(temporary, "empty"),
    ".",
  ]);
  const docker = `#!/usr/bin/env python3
import os,sys,json
args=sys.argv[1:]; version=os.environ.get('DTV_VERSION','')
with open(os.environ['FAKE_LOG'],'a') as f:f.write(version+' '+ ' '.join(args)+'\\n')
if args[:2]==['image','inspect']:print(os.environ['FAKE_COMMIT'])
elif args and args[0]=='inspect':
 if '--format' in args:
  print('true 0' if 'RestartCount' in args[args.index('--format')+1] else 'sha256:old-server')
 else:
  print(json.dumps([{'Config':{'Env':['PGHOST=postgres','AUTH_USERS_FILE=/run/dtv-auth/users.json'],'Image':'dtv-server:'+('a'*40)},'Mounts':[{'Destination':'/app/.data/files','Type':'volume','Name':'dtv_platform-files'}],'NetworkSettings':{'Networks':{'dtv_default':{}}}}]))
elif args and args[0]=='compose':
 if 'ps' in args:
  print('old-'+args[-1])
 elif 'up' in args and version==os.environ['FAKE_COMMIT'] and os.environ['FAKE_MODE']=='cutover':sys.exit(75)
 elif 'pg_dump' in args:print('test database dump')
elif args and args[0]=='run':
 if '--entrypoint' in args and 'tar' in args:sys.stdout.buffer.write(open(os.environ['FAKE_ARCHIVE'],'rb').read())
 elif os.environ['FAKE_MODE']=='preflight' and any('api-preflight' in v for v in args):sys.exit(76)
 else:print('preflight-container')
elif args and args[0]=='exec' and any('deploy-version.json' in v or '/api/health' in v for v in args):print(json.dumps({'commit':os.environ['FAKE_COMMIT']}))
`;
  await writeFile(join(bin, "docker"), docker, { mode: 0o700 });
  await writeFile(
    join(bin, "curl"),
    '#!/bin/sh\nprintf \'{"commit":"%s"}\\n\' "$FAKE_COMMIT"\n',
    { mode: 0o700 },
  );
  for (const name of ["sleep", "flock", "nohup"])
    await writeFile(join(bin, name), "#!/bin/sh\nexit 0\n", { mode: 0o700 });
  const env = {
    ...process.env,
    PATH: bin + ":" + process.env.PATH,
    DTV_REMOTE_DIR: root,
    DTV_COMPOSE_PROJECT_NAME: "dtv",
    FAKE_COMMIT: commit,
    FAKE_MODE: mode,
    FAKE_LOG: join(temporary, "commands.log"),
    FAKE_ARCHIVE: join(temporary, "files.tar.gz"),
  };
  return {
    root,
    temporary,
    env,
    run: (action = "deploy") =>
      exec("bash", ["scripts/deploy-platform-remote.sh", action, commit], {
        env,
      }),
    cleanup: () => rm(temporary, { recursive: true, force: true }),
  };
}
test("全栈切换失败恢复旧镜像与配置，备份保留且不恢复覆盖数据库卷", async () => {
  const f = await fixture("cutover");
  try {
    await expect(f.run()).rejects.toThrow();
    expect(await readFile(join(f.root, "compose.yaml"), "utf8")).toBe(
      "old compose\n",
    );
    expect(await readFile(join(f.root, ".env"), "utf8")).toContain(
      `DTV_VERSION=rollback-${commit}`,
    );
    await access(join(f.root, "releases", commit, "rolled-back"));
    await access(join(f.root, "releases", commit, "backup/database.dump"));
    const commands = await readFile(join(f.temporary, "commands.log"), "utf8");
    expect(commands).toContain(`rollback-${commit} compose`);
    expect(commands).not.toContain("pg_restore -c");
    expect(commands).not.toContain("volume rm");
  } finally {
    await f.cleanup();
  }
});
test("预检失败不切换线上配置，备份之后旧服务已恢复", async () => {
  const f = await fixture("preflight");
  try {
    await expect(f.run()).rejects.toThrow();
    expect(await readFile(join(f.root, "compose.yaml"), "utf8")).toBe(
      "old compose\n",
    );
    const commands = await readFile(join(f.temporary, "commands.log"), "utf8");
    expect(commands).toContain("start core-api worker web");
    expect(commands).not.toContain("--force-recreate");
  } finally {
    await f.cleanup();
  }
});
test("全栈预检成功更新三服务，公网失败可调用同一入口完整回退", async () => {
  const f = await fixture("success");
  try {
    await f.run();
    expect(await readFile(join(f.root, "compose.yaml"), "utf8")).toBe(
      "new compose\n",
    );
    await access(join(f.root, "releases", commit, "server-verified"));
    await f.run("finalize");
    await access(join(f.root, "releases", commit, "public-verified"));
    await f.run("rollback");
    expect(await readFile(join(f.root, "compose.yaml"), "utf8")).toBe(
      "old compose\n",
    );
  } finally {
    await f.cleanup();
  }
});

test("服务器公网路径确认不会伪装成外部入站验收", async () => {
  const f = await fixture("success");
  try {
    await f.run();
    await exec(
      "bash",
      ["scripts/deploy-platform-remote.sh", "finalize", commit],
      { env: { ...f.env, DTV_VERIFICATION_SCOPE: "server-public" } },
    );
    await access(join(f.root, "releases", commit, "deployment-confirmed"));
    await access(join(f.root, "releases", commit, "server-public-verified"));
    await expect(
      access(join(f.root, "releases", commit, "public-verified")),
    ).rejects.toThrow();
  } finally {
    await f.cleanup();
  }
});
