'use strict';

const { app, BrowserWindow, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs   = require('fs');

const config = require('./config.json');

const IS_LINUX = process.platform === 'linux';
const IS_WIN   = process.platform === 'win32';

let nodeProc = null;
let pyProc   = null;
let win      = null;

// ── Helpers ───────────────────────────────────────────────────────────────
function logLines(prefix, stream) {
    stream.setEncoding('utf8');
    stream.on('data', chunk => {
        chunk.split('\n').filter(Boolean).forEach(line => console.log(`[${prefix}] ${line}`));
    });
}

// ── Process launchers ─────────────────────────────────────────────────────

// lxsrs_v2's third-party deps (numpy, opuslib, ...) include compiled C
// extensions tied to the exact CPython ABI they were built against —
// bundling pre-built wheels at package time can't work reliably since we
// don't know which Python version an end user's system will have (Fedora,
// Ubuntu, Arch, ... all ship different ones, and none match whatever CI's
// runner happens to have). Instead, on first run we create a venv against
// whichever `python3` is actually on this machine and pip-install into
// that, so the compiled wheels pip resolves are always ABI-correct for the
// system that's about to run them. lxsrs_v2 itself stays PYTHONPATH-loaded
// from the bundled python-pkg source (see pythonPkgDir below) — only its
// third-party dependencies need the venv.
//
// pynput is deliberately NOT here: it's only used for the alternate
// --ptt-mode pynput (hold-to-talk) path, which we never pass (we use the
// default stdin/Enter-toggle PTT), and lxsrs_v2's client.py already
// lazy-imports it itself with its own error handling for that path. On
// Linux pynput hard-requires evdev, which has no prebuilt wheel on PyPI —
// every install would need a C compiler + matching kernel headers, which
// most end-user desktops don't have. Skipping it avoids that failure mode
// entirely for a dependency we don't use.
const LXSRS_VENV_DEPS = ['numpy', 'sounddevice', 'opuslib'];

function runCmd(cmd, args, opts) {
    return new Promise((resolve, reject) => {
        const proc = spawn(cmd, args, opts);
        logLines('lxsrs-setup', proc.stdout);
        logLines('lxsrs-setup', proc.stderr);
        proc.on('error', reject);
        proc.on('exit', code => {
            if (code === 0) resolve();
            else reject(new Error(`${cmd} ${args.join(' ')} exited with code ${code}`));
        });
    });
}

// Returns the venv's python3 path once its deps are installed, or null if
// setup failed (in which case the SRS radio feature is skipped rather than
// crashing the app).
async function ensureLxsrsVenv() {
    const venvDir      = path.join(app.getPath('userData'), 'lxsrs-venv');
    const venvPython    = path.join(venvDir, 'bin', 'python3');
    // Written only after pip install actually succeeds — venvPython alone
    // existing isn't proof setup finished (e.g. the app quit or lost
    // network mid pip-install on a previous run); checking just for that
    // would silently reuse a half-installed venv missing its deps forever.
    const completeMarker = path.join(venvDir, '.setup-complete');

    if (fs.existsSync(completeMarker)) return venvPython;

    console.log('[lxsrs-setup] setting up a Python environment for the SRS radio bridge...');
    try {
        await runCmd('python3', ['-m', 'venv', venvDir]);
        await runCmd(venvPython, ['-m', 'pip', 'install', '--no-input', '--disable-pip-version-check', ...LXSRS_VENV_DEPS]);
        fs.writeFileSync(completeMarker, new Date().toISOString());
        console.log('[lxsrs-setup] done.');
        return venvPython;
    } catch (err) {
        console.error(
            '[lxsrs-setup] failed to set up the SRS radio Python environment:', err.message,
            `— SRS radio will be unavailable this session. To fix manually, run:\n` +
            `  python3 -m venv "${venvDir}" && "${venvPython}" -m pip install ${LXSRS_VENV_DEPS.join(' ')}`
        );
        return null;
    }
}

async function spawnLxsrs() {
    const venvPython = await ensureLxsrsVenv();
    if (!venvPython) return null;

    const freqArgs = config.freqs.flatMap(f => ['--freq', f]);

    // extraResources (see package.json's build.linux.extraResources) puts
    // python-pkg under process.resourcesPath in a packaged app, not next to
    // main.js inside the asar — only the dev (unpackaged) run has it at
    // __dirname/python-pkg.
    const pythonPkgDir = app.isPackaged
        ? path.join(process.resourcesPath, 'python-pkg')
        : path.join(__dirname, 'python-pkg');

    // __dirname resolves inside app.asar when packaged, which is a single
    // file on disk (not a real directory) -- spawn()'s cwd can't chdir into
    // it (ENOTDIR). userData is also where lxsrs can actually write its
    // log/state files; resourcesPath is read-only inside the AppImage mount.
    const runtimeCwd = app.isPackaged ? app.getPath('userData') : path.join(__dirname);

    const proc = spawn(venvPython, [
        '-m', 'lxsrs_v2',
        ...freqArgs,
        '--tx-freq',  config.txFreq,
        '--host',     config.srsHost,
        '--port',     String(config.srsPort),
        '--play-audio',
        '--api-port', String(config.srsApiPort),
    ], {
        cwd: runtimeCwd,
        env: {
            ...process.env,
            PYTHONPATH: pythonPkgDir,
        },
    });

    logLines('lxsrs', proc.stdout);
    logLines('lxsrs', proc.stderr);
    proc.on('exit', code => console.log(`[lxsrs] exited (${code})`));
    return proc;
}


// ── App lifecycle ─────────────────────────────────────────────────────────

app.on('ready', async () => {
    console.log(`[crc] CRC v${app.getVersion()} starting (${process.platform})`);

    if (IS_LINUX) {
        // Not awaited: first-run venv setup (network pip install) can take
        // a while and must not block the window from appearing. SRS radio
        // simply becomes available a little later than the rest of the app.
        spawnLxsrs()
            .then(proc => { pyProc = proc; })
            .catch(err => console.error('[lxsrs] unexpected error:', err.message));
    }

    // set env vars that server.js reads
    // DCS_GRPC_*/SRS_HOST/SRS_PORT are gone — crc-sync is now the sole
    // gRPC/SRS-transponder client (see crc-sync/server.js); this local
    // server only proxies a handful of on-demand RPCs to it.
    process.env.CRC_SYNC_URL       = config.crcSyncUrl || 'wss://asacs.sourcedcs.page';
    process.env.CASDOOR_CLIENT_ID  = config.casdoorClientId || '';
    process.env.CASDOOR_ENDPOINT   = config.casdoorEndpoint || '';
    process.env.SRS_RADIO_API_PORT = String(config.srsApiPort);
    process.env.WS_PORT            = String(config.wsPort);
    process.env.SOURCEDCS_WEB_URL  = config.sourcedcsWebUrl || '';

    require('./app/server.js');

    win = new BrowserWindow({
        width:  1400,
        height: 900,
        title:  `CRC v${app.getVersion()}`,
        autoHideMenuBar: true,
        webPreferences: {
            contextIsolation: true,
        },
    });

    // Allow the renderer to pop up a Casdoor login window (app/public/js/sync.js
    // calls window.open on the Casdoor authorize URL) — everything else stays
    // blocked, matching Electron's secure-by-default posture.
    win.webContents.setWindowOpenHandler(({ url }) => {
        if (process.env.CASDOOR_ENDPOINT && url.startsWith(process.env.CASDOOR_ENDPOINT + '/login/oauth/authorize')) {
            return { action: 'allow', overrideBrowserWindowOptions: { width: 480, height: 640, parent: win, modal: true } };
        }
        return { action: 'deny' };
    });

    win.webContents.on('did-finish-load', () => {
        win.webContents.insertCSS('* { outline: none !important; }');
    });

    win.loadURL(`http://localhost:${config.wsPort}`);
    win.on('closed', () => { win = null; });

    // ── Autoupdate ────────────────────────────────────────────────────────
    // publish config (package.json's build.publish) points electron-updater
    // at sourcedcs-web's generic-provider /downloads endpoint. Errors are
    // swallowed to a console log only — a failed update check must never
    // block using the app.
    autoUpdater.on('error', err => console.error('[autoupdate] error:', err.message));
    autoUpdater.on('update-downloaded', (info) => {
        dialog.showMessageBox(win, {
            type: 'info',
            title: 'CRC Update Ready',
            message: `A new version (${info.version}) has been downloaded.`,
            detail: 'Restart CRC now to install it, or it will install automatically on next launch.',
            buttons: ['Restart Now', 'Later'],
            defaultId: 0,
            cancelId: 1,
        }).then(({ response }) => {
            if (response === 0) autoUpdater.quitAndInstall();
        });
    });
    // checkForUpdates() rather than checkForUpdatesAndNotify() — the
    // update-downloaded handler above already shows a dialog, no need for
    // electron-updater's own OS-notification on top of it.
    autoUpdater.checkForUpdates().catch(err => console.error('[autoupdate] check failed:', err.message));

});

app.on('window-all-closed', () => {
    app.quit();
});

app.on('before-quit', () => {
    pyProc?.kill();
});