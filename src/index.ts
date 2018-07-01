import { app, BrowserWindow, ipcMain, IpcMessageEvent, Menu, nativeImage, Notification, Tray } from "electron";
import * as log from "electron-log";
import Store = require("electron-store");
import { autoUpdater } from "electron-updater";
import * as path from "path";
const uuidv4 = require("uuid/v4");
import AutoLaunch = require("auto-launch");

autoUpdater.logger = log;
log.transports.console.level = "warn";

const ICONS_DIR = "../assets/icons/";
const APP_ICON = path.join(__dirname, ICONS_DIR, getAppIcon());
const TRAY_ICON = path.join(__dirname, ICONS_DIR, getTrayIcon());
const ROOKOUT_LOGO = path.join(__dirname, ICONS_DIR, "logo.png");
const CLOSE_ICON = path.join(__dirname, ICONS_DIR, "baseline_close_black_18dp.png");
const SETTINGS_ICON = path.join(__dirname, ICONS_DIR, "baseline_settings_black_18dp.png");

let mainWindow: Electron.BrowserWindow;
let indexWorker: Electron.BrowserWindow;
let tray: Tray;
let token: string;
let store: Store<{}>;
const icon = nativeImage.createFromPath(APP_ICON);

// getAppIcon resolves the right icon for the running platform
function getAppIcon() {
    if (process.platform.match("win32")) {
        return "/win/icon.ico";
    } else if (process.platform.match("darwin")) {
        return "logo.png";
    } else {
        return "/logo.png";
    }
}

function getTrayIcon() {
    if (process.platform.match("darwin")) {
        return "logo@16x16.png";
    }
    return getAppIcon();
}

// registerIpc listens to ipc requests\event
function registerIpc() {
    const al = new AutoLaunch({ name: "Explorook" });
    ipcMain.on("hidden", showActiveOnBackgroundBalloon);
    ipcMain.on("get-platform", (e: IpcMessageEvent) => e.returnValue = process.platform.toString());
    ipcMain.on("version-request", (e: IpcMessageEvent) => e.returnValue = app.getVersion());
    ipcMain.on("token-request", (e: IpcMessageEvent) => e.returnValue = token);
    ipcMain.on("auto-launch-is-enabled-req", (e: IpcMessageEvent) => {
        al.isEnabled().then((enabled) => {
            e.sender.send("auto-launch-is-enabled-changed", enabled);
        });
    });
    ipcMain.on("auto-launch-set", (e: IpcMessageEvent, enable: boolean) => {
        if (enable) {
            al.enable().then(() => e.sender.send("auto-launch-is-enabled-changed", true));
        } else {
            al.disable().then(() => e.sender.send("auto-launch-is-enabled-changed", false));
        }
    });
}

function main() {
    const shouldQuit = app.makeSingleInstance((argv: any, workingDir: any) => {
        maximize();
    });
    if (shouldQuit) { app.quit(); }
    store = new Store({ name: "explorook" });
    token = store.get("token", null);
    if (!token) {
        token = uuidv4();
        store.set("token", token);
    }
    registerIpc();
    createWindows();
    openTray();
    autoUpdater.checkForUpdatesAndNotify();
}

function showActiveOnBackgroundBalloon() {
    if (tray != null) {
        if (!process.platform.match("win32")) {
            const notif = new Notification({
                title: "I'm still here!",
                body: "Files are still served in the background", icon: APP_ICON
            });
            notif.on("click", (e) => {
                maximize();
            });
            notif.show();
        } else {
            tray.displayBalloon({
                title: "I'm still here!",
                content: "Files are still served in the background", icon: ROOKOUT_LOGO
            });
        }
    }
}

function createWindows() {
    indexWorker = new BrowserWindow({width: 400, height: 400, show: !!process.env.development });
    ipcMain.on("index-worker-up", (e: IpcMessageEvent) => {
        createMainWindow(indexWorker);
    });
    indexWorker.loadFile(path.join(__dirname, "../index-worker.html"));
    if (process.env.development) {
        indexWorker.webContents.openDevTools();
    }
}

function createMainWindow(indexWorkerWindow: BrowserWindow) {
    mainWindow = new BrowserWindow({
        height: 550,
        width: 650,
        minWidth: 600,
        minHeight: 500,
        frame: false,
        icon,
    });
    indexWorkerWindow.webContents.send("main-window-id", token, mainWindow.webContents.id);
    ipcMain.once("app-window-up", (ev: IpcMessageEvent) => {
        ev.sender.send("indexer-worker-id", indexWorker.id);
    });

    // and load the index.html of the app.
    if (process.env.development) {
        mainWindow.loadURL("http://localhost:3000");
    } else {
        mainWindow.loadFile(path.join(__dirname, "index.html"));
    }

    // Open the DevTools.
    if (process.env.development) {
        mainWindow.webContents.openDevTools();
    }

    // Emitted when the window is closed.
    mainWindow.on("closed", () => {
        // Dereference the window object, usually you would store windows
        // in an array if your app supports multi windows, this is the time
        // when you should delete the corresponding element.
        mainWindow = null;
    });
}

function maximize() {
    if (!mainWindow) {
        createMainWindow(indexWorker);
        return;
    }
    if (mainWindow.isMinimized()) {
        mainWindow.restore();
        return;
    }
    if (process.platform.match("darwin")) {
        app.dock.show();
    }
    mainWindow.show();
    mainWindow.focus();
}

function openTray() {
    tray = new Tray(TRAY_ICON);
    const contextMenu = Menu.buildFromTemplate([
        { label: "Config...", icon: SETTINGS_ICON, click: maximize },
        { label: "Close", icon: CLOSE_ICON, click: app.quit },
    ]);
    tray.setToolTip("Rookout");
    tray.setContextMenu(contextMenu);
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.on("ready", () => {
    main();
});

// Quit when all windows are closed.
app.on("window-all-closed", () => {
    showActiveOnBackgroundBalloon();
});

app.on("activate", maximize);