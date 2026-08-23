'use strict';

const { app, BrowserWindow, dialog } = require('electron');
const { autoUpdater } = require('electron-updater');
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

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

function spawnLxsrs() {
    const freqArgs = config.freqs.flatMap(f => ['--freq', f]);

    // extraResources (see package.json's build.linux.extraResources) puts
    // python-pkg under process.resourcesPath in a packaged app, not next to
    // main.js inside the asar — only the dev (unpackaged) run has it at
    // __dirname/python-pkg.
    const pythonPkgDir = app.isPackaged
        ? path.join(process.resourcesPath, 'python-pkg')
        : path.join(__dirname, 'python-pkg');

    const proc = spawn('python3', [
        '-m', 'lxsrs_v2',
        ...freqArgs,
        '--tx-freq',  config.txFreq,
        '--host',     config.srsHost,
        '--port',     String(config.srsPort),
        '--play-audio',
        '--api-port', String(config.srsApiPort),
    ], {
        cwd: path.join(__dirname),
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
    if (IS_LINUX) {
        pyProc = spawnLxsrs();
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
        title:  'CRC',
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