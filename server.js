const { serveHTTP } = require("stremio-addon-sdk");

async function startServer() {
	const addonInterface = await require("./index")
	serveHTTP(addonInterface, { port: process.env.PORT || 7795 });
}

startServer()
