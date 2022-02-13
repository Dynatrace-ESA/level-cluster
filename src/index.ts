import axios from "axios";
import express from 'express';
import level, { LevelDB } from 'level';
import { MemoryLevel } from "memory-level";
import http from 'http';

export type SessionStoreOptions = {
    instanceId?: string,
    cacheOnDisk?: boolean,
    cachePath?: string,
    maxStoreTime?: number
}

type levelEntry<T = unknown> = {

    // Time when the value was stored.
    // Used to age the objects in storage.
    storeTime: number,

    // Session value
    value: T
}

interface dbStore<T> {
    [key: string]: LevelDB<string, levelEntry<T>> | MemoryLevel<string, levelEntry<T>>
}

export class SharedSessionStore<T = unknown>{

    private app: express; // application for storing the shared sessions.
    private server;

    // If we are storing the sessions.
    private db: dbStore<T> = {};

    /**
     * 
     * useful if you intend to use multiple session stores.
     * @param port port that the store will listen on.
     */
    constructor(port: number = 6801, options?: SessionStoreOptions) {
        
        if (options) {
            this.createInstance(options);
        }
        else 
            this.createInstance({instanceId: "default"});

        this.launchServer(port);
    }

    public createInstance(options?) {
        const { cacheOnDisk, cachePath, maxStoreTime, instanceId } = options;

        const levelOpts = { valueEncoding: 'json' };

        // Create a stored level instance if a cache path is defined.
        // Otherwise we just store all session in memory.
        let db = cacheOnDisk
            ? level(cachePath, levelOpts)
            : new MemoryLevel<string, levelEntry<T>>(levelOpts);

        if (this.db[instanceId]) 
            throw Error("Database with id " + instanceId + " already exists!");

        this.db[instanceId] = db;
    }

    /**
     * Method to release all handles and flush all writes to disk.
     * If the program terminates without this called, in rare cases data could be lost.
     */
    public destroy() {
        // Close all open databases. This flushes their contents to disk.
        // Of course, this doesn't do anything for memory db mode.
        Object.keys(this.db).forEach(store => this.db[store].close());
    }

    private launchServer(port: number) {
        const app = this.app = express();
        app.use(express.json());

        // Handle incoming connections.
        app.use((req, res, next) => {
            const { storeId, action, key, value } = req.body;

            if (!action || !key || (action == "put" && !value) || (action == "batch" && !value) )
                return next({ status: 400, message: "Bad request" });

            const db = this.db[storeId || "default"];

            const storeVal = {
                storeTime: new Date().getTime(),
                value: value
            } as levelEntry<T>;

            console.log(storeVal);

            // TBD batch
            console.log(`db[${action}](${key || value}, ${key ? storeVal : null})`);

            const p = 
                action == "get" ? db.get(key) :
                action == "put" ? db.put(key, storeVal) :
                action == "del" ? db.del(key) :
                db.batch(value);

            // If we don't have a key, directly pass in data
            p.then(data => {
                // Found data in store. we return subitem `value` from stored value.
                // This allows us to add extra attributes to the data without polluting the 
                // response.

                // Return data or 'true' if the action was successful.
                console.log("Sending response", data);
                res.send({ 
                    value: data ? data.value : true
                });
            }).catch(err => {

                // Missing data in store. We return `undefined`.
                if (err.code == "LEVEL_NOT_FOUND")
                    return res.send(undefined);

                // If there is some other error -- pass it back to the client.
                next(err);
            })
        });

        // Unmatched routes are a 404.
        app.use((req, res, next) => next({ status: 404, message: `Not Found: ${req.url}` }));

        // Handle any exceptions.
        app.use((err: any, req: any, res: any, next: any) => {

            const error = err.stack || err.message || err.toString();

            // Don't bother logging 404 errors in the general log.
            if (err.status != 404)
                console.error(error);

            // Render the error page.
            res.status(err.status || 500);

            // If the browser is accepting HTML in the request, we'll render a nice error page.
            // Otherwise: JSON.
            res.send(error);
        });

        const server = this.server = http.createServer(app);

        server.listen(port);
        server.on('error', (error: any) => {
            if (error.syscall !== 'listen')
                throw error;

            // Report friendly errors where we can.
            switch (error.code) {
                case 'EACCES':
                    console.error('Port ' + port + ' requires elevated privileges');
                    process.exit(1);
                case 'EADDRINUSE':
                    console.error('Port ' + port + ' is already in use');
                    process.exit(1);
                default:
                    throw error;
            }
        });
        server.on('listening', () => {
            const addr: any = server.address();
            console.log("Server %s listening on %s.", process.pid, addr.port || addr);
        });
    }
}

export class SessionStoreClient<T = unknown> {

    constructor(private port: number = 6801) {}

    public get(key: string): Promise<T> {
        return this.request("default", key, "get");
    }
    public put(key: string, value: T): Promise<boolean> {
        return this.request("default", key, "put", value);
    }
    public delete(key: string): Promise<boolean> {
        return this.request("default", key, "del");
    }
    public batch(entries: Array<{type: "put" | "del" | "get", key: string, value: T}>): Promise<unknown> {
        return this.request("default", null, "batch", entries);
    }

    private async request(storeId: string, key: string, action: string, value?: any): Promise<any> {

        try {
            let { data } = await axios.put(`http://127.0.0.1:${this.port}/`, {
                storeId,
                key,
                action,
                value
            });

            return data.value;
        }
        catch (ex) {
            // Something horrible happened.
            return {
                status: 500,
                message: "Internal Failure.",
                ex: {
                    target: ex.config.url,
                    payload: ex.config.data,
                    data: ex.response.data,
                    status: ex.response.status
                }
            }
        }
    }
}