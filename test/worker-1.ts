import { SessionStoreClient } from "../src";


(async () => {
    let client = new SessionStoreClient();
    client.put("foobar", {
        name: "test",
        state: "pending",
        isAmazing: true,
        details: {
            keyboard: "cat",
            words: -65555,
            sanity: [
                "lost",
                "coffee"
            ]
        }
    })
    .then(res => {
        console.log("Storing data successful from client.", res);
    })
    .catch(console.error)
})();