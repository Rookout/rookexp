import {ipcRenderer} from "electron";
import * as Store from "electron-store";
import _ = require("lodash");
import { P4 } from "p4api";
import {Repository} from "./common/repository";
import {repStore} from "./repoStore";


export interface IPerforceView {
    map: string;
    name: string;
}

export interface IPerforceManager {
    getAllViews(): Promise<IPerforceView[]>;
    changeViews(views: string[]): Promise<boolean>;
    getCurrentViewRepos(): string[];
    switchChangelist(changelistId: string): Promise<boolean>;
    getCurrentClient(): any;
}
const store = new Store({ name: "explorook" });
const PERFORCE_ROOKOUT_CLIENT_PREFIX = "ROOKOUT_DESKTOP_";
// Currently supporting only Windows and OSX
const DARWIN_ROOT = `${process.env["HOME"]}/Library/Application\ Support/Rookout/Perforce_Root`;
const WINDOWS_ROOT = "%appdata%\\Rookout\\Perforce_Root";

class PerforceManager {
    private p4: any;
    constructor(perforceConnectionString: string) {
        this.p4 = new P4({
            P4PORT: perforceConnectionString
        });

        // Getting the current client of the connected perforce server. The result contains "stat" which is a list of all the actual results;
        const client = this.getCurrentClient();
        const currentRookoutClientName = `${PERFORCE_ROOKOUT_CLIENT_PREFIX}_${client?.Owner}_${client?.Host}`;

        // Checking if current client is not the wanted client. If so, changing it.
        if (client && client.Client !== currentRookoutClientName) {
            // Check if workspace exists. If not, create it.
            const allWorkspaces = this.p4.cmdSync("workspaces").stat;
            if (!_.find(allWorkspaces, workspace => workspace.Client === currentRookoutClientName)) {
                // Creating a new client for Rookout desktop app with out own root so we can change depots when needed
                const newClient = {...client, Client: currentRookoutClientName};
                this.p4.cmdSync(`client -i`, newClient);
            }

            this.p4 = new P4({
                P4PORT: perforceConnectionString,
                P4CLIENT: currentRookoutClientName
            });
        }
    }

    public async getAllViews(): Promise<IPerforceView[]> {
        const result = await this.p4.cmd("depots");

        return result.stat || [];
    }

    public async changeViews(views: string[]): Promise<boolean> {
        const client = this.getCurrentClient();

        const allViews = await this.getAllViews();
        const targetViews = _.filter(allViews, view => _.some(views, v => v === view.name));

        // Removing all existing views
        for (let i = 0;; i++) {
            const viewId = "View" + i;
            if (!client[viewId]) break;
            delete client[viewId];
        }

        // Making sure we create the folders in the right root.
        const isWin = process.platform === "win32";
        client.Root = isWin ? WINDOWS_ROOT : DARWIN_ROOT;

        // Remove all existing depots from the repStore
        const existingRepos = await repStore.getRepositories();
        _.forEach(existingRepos, repo => {
          if (repo.fullpath.includes(client.Root)) {
             repStore.remove(repo.id);
          }
        });

        // Adding all the repos from the given list to the client.
        for (let i = 0; i < targetViews.length; i++) {
            // Small hack here to handle weird views with triple slashes.
            client["View" + i] = `//${targetViews[i].name}/... //${client.Client}/${targetViews[i].map}`.replace("///", "/");
        }

        // Update the client. If successful sync the files
        let result = await this.p4.cmd("client -i", client);

        if (result.error) {
            return false;
        }

        result = await this.p4.cmd("sync -f");

        if (result.error) {
            return false;
        }

        const repoAddingPromises = [] as Array<Promise<string>>;

        _.forEach(targetViews, view => {
            repoAddingPromises.push(repStore.add({
                id: view.name,
                fullpath: `${client.Root}/${view.name}`,
                repoName: view.name,
            }));
        });

        await Promise.all(repoAddingPromises);

        ipcRenderer.send( "refresh-repos", await repStore.getRepositories());

        return true;
    }

    public getCurrentViewRepos(): string[] {
        const client = this.getCurrentClient();

        const views = [] as string[];

        for (let i = 0;; i++) {
            const currentView = client["View" + i];
            if (!currentView) break;

            views.push(client.Root + currentView.split(`//${client.Client}`)[1]);
        }

        return views;
    }

    public async switchChangelist(changelistId: string): Promise<boolean> {
        const result = await this.p4.cmd(`sync @${changelistId}`);

        return !result.error;
    }

    public getCurrentClient(): any {
        const stat = this.p4.cmdSync("client -o").stat;
        return stat ? stat[0] : undefined;
    }
}

let perforceManagerSingleton: IPerforceManager = null;

const connectionString = store.get("PerforceConnectionString", null);
if (connectionString) {
    perforceManagerSingleton = new PerforceManager(connectionString);
}

export const getPerforceManagerSingleton = (): IPerforceManager => {
    return perforceManagerSingleton;
};

export const changePerforceManagerSingleton = (newConnectionString: string): boolean => {
        perforceManagerSingleton = new PerforceManager(newConnectionString);

        // p4 client creation works no matter what so we make sure the client is created.
        const client = perforceManagerSingleton.getCurrentClient();
        if (!client) {
            return false;
        }
        store.set("PerforceConnectionString", newConnectionString);
        return true;
};
