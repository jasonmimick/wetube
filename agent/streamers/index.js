const KIND = process.env.STREAMER || "mock";

const streamers = {
  mock: () => require("./mock"),
  vmix: () => require("./vmix"),
  obs: () => require("./obs"),
};

if (!streamers[KIND]) {
  throw new Error(`Unknown STREAMER "${KIND}" — expected one of: ${Object.keys(streamers).join(", ")}`);
}

module.exports = streamers[KIND]();
