import { SessionStoreClient } from "../src";


(async() => {
    let client = new SessionStoreClient();

    setTimeout(() => {
        client.get("foobar").then(res => {
            console.log("Retrieved data successfully.", res);
        }).catch(console.error);
    }, 20000);
})();