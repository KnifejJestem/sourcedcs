'use strict';

const { app, BrowserWindow, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs   = require('fs');

const config = require('./config.json');
const { computePythonPkgDir, computeRuntimeCwd, ensureLxsrsVenv } = require('./lxsrs-setup');

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

async function spawnLxsrs() {
    const venvDir = path.join(app.getPath('userData'), 'lxsrs-venv');
    const venvPython = await ensureLxsrsVenv(venvDir, line => console.log('[lxsrs-setup]', line));
    if (!venvPython) return null;

    const freqArgs = config.freqs.flatMap(f => ['--freq', f]);
    const pythonPkgDir = computePythonPkgDir(app.isPackaged, process.resourcesPath, __dirname);
    const runtimeCwd   = computeRuntimeCwd(app.isPackaged, app.getPath('userData'), __dirname);

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