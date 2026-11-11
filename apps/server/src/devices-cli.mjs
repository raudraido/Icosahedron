// Run on the server when the web UI cannot be used:
//   docker compose exec icosahedron node src/devices-cli.mjs invite <user>   a one-use code for that user's first device
//   docker compose exec icosahedron node src/devices-cli.mjs secure off      switch secure sign-in off (then restart the container)
import { createInvites } from "./invites.mjs";
import { fileSettings } from "./settings.mjs";

const dir = process.env.DATA_DIR ?? "/data";
const [cmd, arg, arg2] = process.argv.slice(2);

if (cmd === "invite" && arg) {
  console.log(createInvites({ dir }).create(arg));
  console.log(`Valid for 24 hours, once. Enter it with ${arg}'s Navidrome password when signing in on the new device.`);
} else if (cmd === "secure" && (arg === "off" || arg === "on")) {
  fileSettings(dir).set("secureSignIn", arg === "on");
  console.log(`Secure sign-in is now ${arg}. Restart the container for it to take effect: docker compose restart icosahedron`);
} else {
  console.log("usage: devices-cli.mjs invite <user> | secure on|off");
  process.exit(1);
}
void arg2;
